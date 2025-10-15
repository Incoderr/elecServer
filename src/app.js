const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");
const dotenv = require("dotenv");
const authRoutes = require("./routes/auth");
const serverRoutes = require("./routes/servers");
const channelRoutes = require("./routes/channels");
const userRoutes = require("./routes/users");
const { setupSocket } = require("./sockets");

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
app.use("/api/auth", authRoutes);
app.use("/api/servers", serverRoutes);
app.use("/api", channelRoutes);
app.use("/api/user", userRoutes);

// Инициализация Socket.IO
setupSocket(io);

module.exports = { startServer: (port) => server.listen(port, () => console.log(`Server listening ${port}`)) };