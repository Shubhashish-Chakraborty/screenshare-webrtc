import express from 'express';
import http from 'http';
import { Server, Socket } from 'socket.io';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "http://localhost:3000", // Be more specific in production, e.g., 'http://localhost:3000'
        methods: ["GET", "POST"]
    }
});

/**
 * This is the crucial part that was missing.
 * We need to map our custom user IDs to the underlying socket IDs.
 */
const userIdToSocketIdMap = new Map<string, string>();
const socketIdToUserIdMap = new Map<string, string>();

// In-memory store for rooms. For production, consider a more persistent store like Redis.
const rooms: Record<string, Set<string>> = {};

io.on('connection', (socket: Socket) => {
    console.log(`User connected with socket ID: ${socket.id}`);

    // Event to join a room
    socket.on('join-room', (roomId: string, userId: string) => {
        // Associate userId with socket.id for lookups
        userIdToSocketIdMap.set(userId, socket.id);
        socketIdToUserIdMap.set(socket.id, userId);

        socket.join(roomId);

        // Initialize room if it's new
        if (!rooms[roomId]) {
            rooms[roomId] = new Set();
        }

        // Add the user to the room's list of participants
        rooms[roomId].add(userId);

        console.log(`User ${userId} (Socket: ${socket.id}) joined room ${roomId}`);

        // Notify everyone else in the room that a new user has connected.
        // The existing users will receive this and initiate the WebRTC connection.
        socket.to(roomId).emit('user-connected', userId);
    });

    // --- WebRTC Signaling Handlers ---
    // These now correctly route messages using the userId-to-socketId map.

    socket.on('offer', (data: { to: string; offer: RTCSessionDescriptionInit }) => {
        const fromUserId = socketIdToUserIdMap.get(socket.id);
        const targetSocketId = userIdToSocketIdMap.get(data.to);
        if (targetSocketId && fromUserId) {
            console.log(`Forwarding offer from ${fromUserId} to ${data.to}`);
            io.to(targetSocketId).emit('offer', { offer: data.offer, from: fromUserId });
        }
    });

    socket.on('answer', (data: { to: string; answer: RTCSessionDescriptionInit }) => {
        const fromUserId = socketIdToUserIdMap.get(socket.id);
        const targetSocketId = userIdToSocketIdMap.get(data.to);
        if (targetSocketId && fromUserId) {
            console.log(`Forwarding answer from ${fromUserId} to ${data.to}`);
            io.to(targetSocketId).emit('answer', { answer: data.answer, from: fromUserId });
        }
    });

    socket.on('ice-candidate', (data: { to: string; candidate: RTCIceCandidateInit }) => {
        const fromUserId = socketIdToUserIdMap.get(socket.id);
        const targetSocketId = userIdToSocketIdMap.get(data.to);
        if (targetSocketId && fromUserId) {
            // No need to log every ICE candidate, it's very noisy.
            io.to(targetSocketId).emit('ice-candidate', { candidate: data.candidate, from: fromUserId });
        }
    });

    // Event to handle a user explicitly leaving a room
    socket.on('leave-room', (roomId: string, userId: string) => {
        handleDisconnect(socket, roomId, userId);
    });

    // Event for when a socket disconnects (e.g., user closes tab)
    socket.on('disconnect', () => {
        handleDisconnect(socket);
    });
});

// Centralized function to handle user disconnection logic
const handleDisconnect = (socket: Socket, specificRoomId?: string, specificUserId?: string) => {
    const disconnectedUserId = specificUserId || socketIdToUserIdMap.get(socket.id);

    if (disconnectedUserId) {
        console.log(`User ${disconnectedUserId} (Socket: ${socket.id}) disconnected.`);

        // Clean up mappings
        userIdToSocketIdMap.delete(disconnectedUserId);
        socketIdToUserIdMap.delete(socket.id);

        // Function to process leaving a room
        const leaveRoom = (roomId: string) => {
            if (rooms[roomId]) {
                rooms[roomId].delete(disconnectedUserId);
                console.log(`User ${disconnectedUserId} removed from room ${roomId}.`);
                // Notify remaining users in the room
                socket.to(roomId).emit('user-disconnected', disconnectedUserId);

                // If the room is now empty, delete it
                if (rooms[roomId].size === 0) {
                    delete rooms[roomId];
                    console.log(`Room ${roomId} is now empty and has been deleted.`);
                }
            }
        }

        // If a specific room is provided, just leave that one
        if (specificRoomId) {
            leaveRoom(specificRoomId);
        } else {
            // Otherwise, find all rooms the user was in and remove them
            for (const roomId in rooms) {
                if (rooms[roomId].has(disconnectedUserId)) {
                    leaveRoom(roomId);
                }
            }
        }
    } else {
        console.log(`Socket ${socket.id} disconnected without a registered user ID.`);
    }
};


// Note: The Prisma schema and client are not used in this signaling logic.
// You can integrate them later to persist room information if needed.

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`✅ Signaling server running on port ${PORT}`);
});
