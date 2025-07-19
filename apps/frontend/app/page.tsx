"use client";
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

type Peers = Record<string, RTCPeerConnection>;

export default function App() {
    const [roomId, setRoomId] = useState('');
    const [userId] = useState(`user-${Math.random().toString(36).substring(2, 9)}`);
    const [isSharing, setIsSharing] = useState(false);
    const [isInRoom, setIsInRoom] = useState(false);
    const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});

    const socketRef = useRef<Socket | null>(null);
    const localStreamRef = useRef<MediaStream | null>(null);
    const peersRef = useRef<Peers>({});
    const localVideoRef = useRef<HTMLVideoElement>(null);

    // Initialize socket connection
    useEffect(() => {
        const socket = io('http://localhost:3001');
        socketRef.current = socket;

        return () => {
            socket.disconnect();
        };
    }, []);

    // Create peer connection with proper stream handling
    const createPeerConnection = useCallback((peerId: string) => {
        if (peersRef.current[peerId]) return peersRef.current[peerId];

        const peer = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
            ],
        });

        peer.onicecandidate = (event) => {
            if (event.candidate && socketRef.current) {
                socketRef.current.emit('ice-candidate', {
                    to: peerId,
                    candidate: event.candidate,
                });
            }
        };

        peer.ontrack = (event) => {
            setRemoteStreams(prev => ({
                ...prev,
                [peerId]: event.streams[0],
            }));
        };

        // Add local stream tracks if available
        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach(track => {
                peer.addTrack(track, localStreamRef.current!);
            });
        }

        peersRef.current[peerId] = peer;
        return peer;
    }, []);

    // Start screen sharing
    const startSharing = async () => {
        try {
            // Get display media
            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: true,
            });

            // Store the stream and update state
            localStreamRef.current = stream;
            setIsSharing(true);

            // Set the stream to the local video element
            if (localVideoRef.current) {
                localVideoRef.current.srcObject = stream;
            }

            // Handle when user stops sharing via browser UI
            stream.getVideoTracks()[0].onended = () => {
                stopSharing();
            };

            // Create peer connections for existing users and send offers
            for (const peerId in peersRef.current) {
                const peer = peersRef.current[peerId];

                // Add tracks to existing peer connections
                stream.getTracks().forEach(track => {
                    peer.addTrack(track, stream);
                });

                // Create and send offer
                const offer = await peer.createOffer();
                await peer.setLocalDescription(offer);
                socketRef.current?.emit('offer', {
                    to: peerId,
                    offer,
                });
            }

        } catch (err) {
            console.error('Error sharing screen:', err);
            setIsSharing(false);
        }
    };

    // Stop screen sharing
    const stopSharing = useCallback(() => {
        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach(track => track.stop());
            localStreamRef.current = null;

            if (localVideoRef.current) {
                localVideoRef.current.srcObject = null;
            }

            setIsSharing(false);
        }
    }, []);

    // Join room handler
    const joinRoom = () => {
        if (socketRef.current && roomId) {
            socketRef.current.emit('join-room', roomId, userId);
            setIsInRoom(true);
        }
    };

    // Leave room handler
    const leaveRoom = () => {
        if (socketRef.current && roomId) {
            stopSharing();
            socketRef.current.emit('leave-room', roomId, userId);

            // Close all peer connections
            Object.values(peersRef.current).forEach(peer => peer.close());
            peersRef.current = {};

            setRemoteStreams({});
            setIsInRoom(false);
        }
    };

    // Main signaling logic
    useEffect(() => {
        const socket = socketRef.current;
        if (!socket) return;

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
                    console.error('Error adding ICE candidate', e);
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
    }, [createPeerConnection]);

    return (
        <div className="min-h-screen bg-gray-900 text-white p-4 font-sans">
            <div className="max-w-7xl mx-auto">
                <header className="mb-6 text-center">
                    <h1 className="text-4xl font-bold text-cyan-400">Collaborate</h1>
                    <p className="text-gray-400">Real-time Screen Sharing</p>
                </header>

                <div className="bg-gray-800 p-6 rounded-xl shadow-lg mb-6">
                    <div className="flex flex-col sm:flex-row gap-4 items-center">
                        <input
                            type="text"
                            value={roomId}
                            onChange={(e) => setRoomId(e.target.value)}
                            placeholder="Enter Room ID"
                            className="flex-grow p-3 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
                            disabled={isInRoom}
                        />
                        {!isInRoom ? (
                            <button
                                onClick={joinRoom}
                                className="w-full sm:w-auto bg-cyan-500 text-white px-6 py-3 rounded-lg font-semibold hover:bg-cyan-600 transition-colors duration-300 disabled:bg-gray-500"
                                disabled={!roomId}
                            >
                                Join Room
                            </button>
                        ) : (
                            <button
                                onClick={leaveRoom}
                                className="w-full sm:w-auto bg-red-500 text-white px-6 py-3 rounded-lg font-semibold hover:bg-red-600 transition-colors duration-300"
                            >
                                Leave Room
                            </button>
                        )}
                    </div>
                    {isInRoom && <p className="text-sm text-gray-400 mt-4">Your User ID: <span className="font-mono bg-gray-700 p-1 rounded">{userId}</span></p>}
                </div>

                {isInRoom && (
                    <div className="text-center mb-6">
                        {!isSharing ? (
                            <button
                                onClick={startSharing}
                                className="bg-green-500 text-white px-8 py-3 rounded-lg font-semibold hover:bg-green-600 transition-colors duration-300 shadow-lg"
                            >
                                Start Sharing Screen
                            </button>
                        ) : (
                            <button
                                onClick={stopSharing}
                                className="bg-yellow-500 text-white px-8 py-3 rounded-lg font-semibold hover:bg-yellow-600 transition-colors duration-300 shadow-lg"
                            >
                                Stop Sharing
                            </button>
                        )}
                    </div>
                )}

                <main className="bg-gray-800 p-6 rounded-xl shadow-lg">
                    <h2 className="text-2xl font-semibold mb-4 text-cyan-300 border-b border-gray-700 pb-2">Shared Screens</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Local screen preview */}
                        {isSharing && (
                            <div className="bg-gray-700 p-3 rounded-lg">
                                <h3 className="font-medium mb-2 text-center text-gray-300">Your Screen Preview</h3>
                                <video
                                    ref={localVideoRef}
                                    autoPlay
                                    muted
                                    playsInline
                                    className="w-full h-auto border-2 border-cyan-500 rounded-lg"
                                />
                            </div>
                        )}

                        {/* Remote screens */}
                        {Object.keys(remoteStreams).map((peerId) => (
                            <div key={peerId} className="bg-gray-700 p-3 rounded-lg">
                                <h3 className="font-medium mb-2 text-center text-gray-300">Screen from <span className="font-mono text-sm">{peerId}</span></h3>
                                <video
                                    ref={(ref) => {
                                        if (ref && remoteStreams[peerId]) {
                                            ref.srcObject = remoteStreams[peerId];
                                        }
                                    }}
                                    autoPlay
                                    playsInline
                                    className="w-full h-auto border-2 border-gray-600 rounded-lg"
                                />
                            </div>
                        ))}
                    </div>
                    {isInRoom && Object.keys(remoteStreams).length === 0 && !isSharing && (
                        <div className="text-center py-10 text-gray-500">
                            <p>Waiting for others to share their screen...</p>
                        </div>
                    )}
                </main>
            </div>
        </div>
    );
}