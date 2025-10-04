const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { body, validationResult } = require("express-validator");
const dotenv = require("dotenv");
const cors = require("cors");

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

app.use(express.json());
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json());

// Подключение к MongoDB
mongoose
  .connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("MongoDB подключена"))
  .catch((err) => console.error("Ошибка MongoDB:", err));

// Модель пользователя
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
});
const User = mongoose.model("User", UserSchema);

// Route для регистрации
app.post(
  "/register",
  [
    body("username").trim().notEmpty().withMessage("Никнейм обязателен"),
    body("password")
      .isLength({ min: 6 })
      .withMessage("Пароль минимум 6 символов"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { username, password } = req.body;

    try {
      const existingUser = await User.findOne({ username });
      if (existingUser) {
        return res.status(400).json({ message: "Никнейм занят" });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      const newUser = new User({ username, password: hashedPassword });
      await newUser.save();

      // Генерация JWT
      const token = jwt.sign(
        { userId: newUser._id, username: newUser.username },
        process.env.JWT_SECRET,
        { expiresIn: "1h" }
      );

      res.status(201).json({
        message: "Регистрация успешна",
        token,
        username: newUser.username,
      });
    } catch (err) {
      res.status(500).json({ message: "Ошибка сервера" });
    }
  }
);

// Route для логина (для полноты, если нужно выводить ник после входа)
app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  try {
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(400).json({ message: "Неверный никнейм" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Неверный пароль" });
    }

    const token = jwt.sign(
      { userId: user._id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    res.json({ message: "Вход успешен", token, username: user.username });
  } catch (err) {
    res.status(500).json({ message: "Ошибка сервера" });
  }
});

// Socket.IO (добавим аутентификацию сокетов по JWT)
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = decoded; // Сохраняем пользователя в сокете
      next();
    } catch (err) {
      next(new Error("Аутентификация не удалась"));
    }
  } else {
    next(new Error("Токен обязателен"));
  }
});

io.on("connection", (socket) => {
  console.log("Пользователь подключился:", socket.user.username); // Выводим ник в консоль сервера

  socket.on("chat message", (msg) => {
    const fullMsg = {
      username: socket.user.username, // Ник отправителя из JWT
      content: msg,
      timestamp: new Date().toISOString(), // Опционально: время для сортировки
    };
    console.log("Сообщение:", fullMsg);
    io.emit("chat message", fullMsg); // Отправляем объект, а не строку
  });

  socket.on("disconnect", () => {
    console.log("Пользователь отключился:", socket.user.username);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Сервер запущен на ${PORT}`);
});
