const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ['http://localhost:5173', 'https://elec-app.vercel.app/'],
    methods: ['GET', 'POST']
  }
});

// Store connected users
const users = new Map();

io.on('connection', (socket) => {
  // Handle user joining
  socket.on('join', (username) => {
    if (username && !Array.from(users.values()).includes(username)) {
      users.set(socket.id, username);
      io.emit('userList', Array.from(users.entries()).map(([id, name]) => ({ id, name })));
      socket.broadcast.emit('message', {
        user: 'System',
        text: `${username} joined the chat`,
        timestamp: new Date().toISOString()
      });
    } else {
      socket.emit('error', 'Username already taken or invalid');
    }
  });

  // Handle chat messages
  socket.on('chatMessage', (text) => {
    const username = users.get(socket.id);
    if (username && text.trim()) {
      io.emit('message', {
        user: username,
        text,
        timestamp: new Date().toISOString()
      });
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    const username = users.get(socket.id);
    if (username) {
      users.delete(socket.id);
      io.emit('userList', Array.from(users.entries()).map(([id, name]) => ({ id, name })));
      socket.broadcast.emit('message', {
        user: 'System',
        text: `${username} left the chat`,
        timestamp: new Date().toISOString()
      });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});