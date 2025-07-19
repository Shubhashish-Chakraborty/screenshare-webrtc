"use client";
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function Home() {
    const [roomId, setRoomId] = useState('');
    const router = useRouter();

    const joinRoom = () => {
        if (roomId.trim()) {
            router.push(`/room/${roomId}`);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-100">
            <div className="bg-white p-8 rounded shadow-md w-96">
                <h1 className="text-2xl font-bold mb-6 text-center">Join a Room</h1>
                <div className="mb-4">
                    <input
                        type="text"
                        value={roomId}
                        onChange={(e) => setRoomId(e.target.value)}
                        placeholder="Enter Room ID"
                        className="w-full p-2 border rounded"
                    />
                </div>
                <button
                    onClick={joinRoom}
                    className="w-full bg-blue-500 text-white py-2 rounded hover:bg-blue-600"
                >
                    Join Room
                </button>
            </div>
        </div>
    );
}