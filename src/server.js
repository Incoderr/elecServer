const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const dotenv = require("dotenv");
const cors = require("cors");
const authRoutes = require("./routes/authRoutes");
const serverRoutes = require("./routes/serverRoutes");
const userRoutes = require("./routes/userRoutes");
const { setupSocketHandlers } = require("./sockets/socketHandlers");
const { redisClient } = require("./config/redis");  // Новое: импорт Redis

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

app.use(express.json());
app.use(
  cors({
    origin: ["http://localhost:5173", "https://tauriapp.vercel.app"],
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Подключение маршрутов
app.use(authRoutes);
app.use(serverRoutes);
app.use(userRoutes);

// Настройка Socket.IO
setupSocketHandlers(io);

// Новое: Graceful shutdown для Redis
process.on('SIGTERM', async () => {
  await redisClient.quit();
  server.close();
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Server listening ${PORT}`));