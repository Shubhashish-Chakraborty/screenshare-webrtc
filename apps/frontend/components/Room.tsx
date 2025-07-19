"use client";
import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

type RemoteStreams = {
    [peerId: string]: {
        video: MediaStream | null;
        audio: MediaStream | null;
    };
};

export default function RoomComponent({ params }: { params: { id: string } }) {
    const roomId = params.id;
    const [userId] = useState(`user-${Math.random().toString(36).substring(2, 9)}`);
    const [isSharing, setIsSharing] = useState(false);
    const [isMicOn, setIsMicOn] = useState(false);
    const [remoteStreams, setRemoteStreams] = useState<RemoteStreams>({});

    const socketRef = useRef<Socket | null>(null);
    const peersRef = useRef<{ [peerId: string]: RTCPeerConnection }>({});
    const localVideoStreamRef = useRef<MediaStream | null>(null);
    const localAudioStreamRef = useRef<MediaStream | null>(null);
    const localVideoRef = useRef<HTMLVideoElement>(null);
    const localAudioRef = useRef<HTMLAudioElement>(null);

    // Initialize socket connection
    useEffect(() => {
        const socket = io('http://localhost:3001');
        socketRef.current = socket;

        socket.emit('join-room', roomId, userId);

        return () => {
            socket.disconnect();
            stopAllStreams();
        };
    }, [roomId, userId]);

    // WebRTC peer connection logic
    useEffect(() => {
        if (!socketRef.current) return;

        const socket = socketRef.current;

        const createPeerConnection = (peerId: string) => {
            if (peersRef.current[peerId]) return peersRef.current[peerId];

            const peer = new RTCPeerConnection({
                iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
            });

            peer.onicecandidate = (event) => {
                if (event.candidate && socketRef.current) {
                    socket.emit('ice-candidate', {
                        to: peerId,
                        candidate: event.candidate,
                    });
                }
            };

            peer.ontrack = (event) => {
                const streamType = event.track.kind as 'video' | 'audio';

                setRemoteStreams(prev => {
                    const existing = prev[peerId] || { video: null, audio: null };
                    let stream = existing[streamType];

                    if (stream) {
                        stream.addTrack(event.track);
                    } else {
                        stream = new MediaStream([event.track]);
                    }

                    return {
                        ...prev,
                        [peerId]: {
                            ...existing,
                            [streamType]: stream
                        }
                    };
                });
            };

            // Add existing local streams if available
            if (localVideoStreamRef.current) {
                localVideoStreamRef.current.getTracks().forEach(track => {
                    peer.addTrack(track, localVideoStreamRef.current!);
                });
            }

            if (localAudioStreamRef.current) {
                localAudioStreamRef.current.getTracks().forEach(track => {
                    peer.addTrack(track, localAudioStreamRef.current!);
                });
            }

            peersRef.current[peerId] = peer;
            return peer;
        };

        const handleUserConnected = async (newUserId: string) => {
            const peer = createPeerConnection(newUserId);
            const offer = await peer.createOffer();
            await peer.setLocalDescription(offer);
            socket.emit('offer', { to: newUserId, offer });
        };

        const handleOffer = async ({ offer, from }: { offer: RTCSessionDescriptionInit; from: string }) => {
            const peer = createPeerConnection(from);
            await peer.setRemoteDescription(new RTCSessionDescription(offer));
            const answer = await peer.createAnswer();
            await peer.setLocalDescription(answer);
            socket.emit('answer', { to: from, answer });
        };

        const handleAnswer = async ({ answer, from }: { answer: RTCSessionDescriptionInit; from: string }) => {
            const peer = peersRef.current[from];
            if (peer) {
                await peer.setRemoteDescription(new RTCSessionDescription(answer));
            }
        };

        const handleIceCandidate = async ({ candidate, from }: { candidate: RTCIceCandidateInit; from: string }) => {
            const peer = peersRef.current[from];
            if (peer) {
                try {
                    await peer.addIceCandidate(new RTCIceCandidate(candidate));
                } catch (e) {
                    console.error('Error adding ICE candidate:', e);
                }
            }
        };

        const handleUserDisconnected = (disconnectedUserId: string) => {
            if (peersRef.current[disconnectedUserId]) {
                peersRef.current[disconnectedUserId].close();
                delete peersRef.current[disconnectedUserId];
            }
            setRemoteStreams(prev => {
                const newStreams = { ...prev };
                delete newStreams[disconnectedUserId];
                return newStreams;
            });
        };

        socket.on('user-connected', handleUserConnected);
        socket.on('offer', handleOffer);
        socket.on('answer', handleAnswer);
        socket.on('ice-candidate', handleIceCandidate);
        socket.on('user-disconnected', handleUserDisconnected);

        return () => {
            socket.off('user-connected', handleUserConnected);
            socket.off('offer', handleOffer);
            socket.off('answer', handleAnswer);
            socket.off('ice-candidate', handleIceCandidate);
            socket.off('user-disconnected', handleUserDisconnected);
        };
    }, []);

    const startScreenSharing = async () => {
        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: false,
            });

            localVideoStreamRef.current = stream;
            setIsSharing(true);

            if (localVideoRef.current) {
                localVideoRef.current.srcObject = stream;
            }

            stream.getVideoTracks()[0].onended = () => {
                stopScreenSharing();
            };

            // Add to existing peer connections
            Object.keys(peersRef.current).forEach(async (peerId) => {
                const peer = peersRef.current[peerId];
                stream.getTracks().forEach(track => {
                    peer.addTrack(track, stream);
                });

                const offer = await peer.createOffer();
                await peer.setLocalDescription(offer);
                socketRef.current?.emit('offer', { to: peerId, offer });
            });
        } catch (err) {
            console.error('Error sharing screen:', err);
        }
    };

    const stopScreenSharing = () => {
        if (localVideoStreamRef.current) {
            localVideoStreamRef.current.getTracks().forEach(track => track.stop());
            localVideoStreamRef.current = null;
            setIsSharing(false);

            if (localVideoRef.current) {
                localVideoRef.current.srcObject = null;
            }
        }
    };

    const toggleMic = async () => {
        if (isMicOn) {
            if (localAudioStreamRef.current) {
                localAudioStreamRef.current.getTracks().forEach(track => track.stop());
                localAudioStreamRef.current = null;
            }
            setIsMicOn(false);
        } else {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                localAudioStreamRef.current = stream;
                setIsMicOn(true);

                if (localAudioRef.current) {
                    localAudioRef.current.srcObject = stream;
                }

                // Add to existing peer connections
                Object.keys(peersRef.current).forEach(async (peerId) => {
                    const peer = peersRef.current[peerId];
                    stream.getTracks().forEach(track => {
                        peer.addTrack(track, stream);
                    });

                    const offer = await peer.createOffer();
                    await peer.setLocalDescription(offer);
                    socketRef.current?.emit('offer', { to: peerId, offer });
                });
            } catch (err) {
                console.error('Error accessing microphone:', err);
            }
        }
    };

    const stopAllStreams = () => {
        stopScreenSharing();
        if (localAudioStreamRef.current) {
            localAudioStreamRef.current.getTracks().forEach(track => track.stop());
            localAudioStreamRef.current = null;
            setIsMicOn(false);
        }

        // Close all peer connections
        Object.values(peersRef.current).forEach(peer => peer.close());
        peersRef.current = {};
    };

    return (
        <div className="min-h-screen bg-gray-100 p-4">
            <div className="max-w-6xl mx-auto">
                <h1 className="text-2xl font-bold mb-4">Room: {roomId}</h1>

                <div className="flex gap-4 mb-6">
                    {!isSharing ? (
                        <button
                            onClick={startScreenSharing}
                            className="bg-blue-500 text-white px-4 py-2 rounded"
                        >
                            Start Sharing
                        </button>
                    ) : (
                        <button
                            onClick={stopScreenSharing}
                            className="bg-red-500 text-white px-4 py-2 rounded"
                        >
                            Stop Sharing
                        </button>
                    )}

                    <button
                        onClick={toggleMic}
                        className={`px-4 py-2 rounded ${isMicOn ? 'bg-green-500 text-white' : 'bg-gray-300'
                            }`}
                    >
                        {isMicOn ? 'Mute Mic' : 'Unmute Mic'}
                    </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Local preview */}
                    <div className="bg-white p-4 rounded shadow">
                        <h2 className="font-semibold mb-2">Your Stream</h2>
                        <video
                            ref={localVideoRef}
                            autoPlay
                            muted
                            playsInline
                            className="w-full h-auto border rounded"
                        />
                        <audio ref={localAudioRef} autoPlay muted />
                    </div>

                    {/* Remote streams */}
                    {Object.entries(remoteStreams).map(([peerId, streams]) => (
                        <div key={peerId} className="bg-white p-4 rounded shadow">
                            <h2 className="font-semibold mb-2">User: {peerId}</h2>
                            {streams.video && (
                                <video
                                    
                                    ref={ref => {
                                        if (ref) {
                                            ref.srcObject = streams.video;
                                        }
                                    }}
                                    autoPlay
                                    playsInline
                                    className="w-full h-auto border rounded"
                                />
                            )}
                            <audio
                                ref={ref => {
                                    if (ref && streams.audio) {
                                        ref.srcObject = streams.audio;
                                    }
                                }}
                                autoPlay
                            />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}