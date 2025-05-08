const { Server } = require('socket.io');
const { handleJoin, handleChatMessage, handleDisconnect } = require('./handlers');

const users = new Map();

const initSocket = (server) => {
  const io = new Server(server, {
    cors: {
      origin: ['http://localhost:5173', 'https://elec-app.vercel.app'],
      methods: ['GET', 'POST']
    },
    transports: ['websocket', 'polling']
  });

  io.on('connection', (socket) => {
    socket.on('join', (username) => handleJoin(socket, username, users, io));
    socket.on('chatMessage', (data) => handleChatMessage(socket, data, users, io));
    socket.on('disconnect', () => handleDisconnect(socket, users, io));
  });

  return io;
};

module.exports = { initSocket, users };