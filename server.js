const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*', // Разрешить все origins для разработки; в продакшене укажите ваш домен
    methods: ['GET', 'POST']
  }
});

io.on('connection', (socket) => {
  console.log('Пользователь подключился:', socket.id);

  // Обработка получения сообщения от клиента
  socket.on('chat message', (msg) => {
    console.log('Сообщение:', msg);
    io.emit('chat message', msg); // Отправить всем подключенным клиентам
  });

  socket.on('disconnect', () => {
    console.log('Пользователь отключился:', socket.id);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});