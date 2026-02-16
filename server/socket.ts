import { Server } from 'socket.io';
import { Server as HttpServer } from 'http';
import { Server as HttpsServer } from 'https';

let io: Server | null = null;

export const initSocket = (server: HttpServer | HttpsServer) => {
    io = new Server(server, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"]
        }
    });

    io.on('connection', (socket) => {
        const terminalId = socket.handshake.query.terminalId as string;
        console.log(`🔌 New WebSocket connection: ${socket.id} (Terminal: ${terminalId})`);

        if (terminalId) {
            socket.join(terminalId);
        }

        socket.on('disconnect', () => {
            console.log(`🔌 WebSocket disconnected: ${socket.id}`);
        });
    });

    return io;
};

export const getIO = () => {
    if (!io) {
        // Fallback for cases where IO is called before init (e.g. during startup)
        console.warn('⚠️ getIO called before initSocket. Returns null.');
    }
    return io;
};

export const emitSyncEvent = (event: 'CATALOG_UPDATED' | 'PRICE_CHANGED', data: any, excludeTerminalId?: string) => {
    if (io) {
        if (excludeTerminalId) {
            // Efficient output exclusion using Socket.IO rooms
            io.except(excludeTerminalId).emit(event, { ...data, _origin: excludeTerminalId });
        } else {
            io.emit(event, data);
        }
        console.log(`📡 WebSocket Emit: ${event}`, { ...data, _origin: excludeTerminalId });
    }
};
