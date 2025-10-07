// ...existing code...
const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { body, validationResult } = require("express-validator");
const dotenv = require("dotenv");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

app.use(express.json());
app.use(
  cors({
    origin: ['http://localhost:5173', 'https://tauriapp.vercel.app'],
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Регистрация в Supabase.users (локальная регистрация, не Supabase Auth)
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
    if (!errors.isEmpty())
      return res.status(400).json({ errors: errors.array() });

    const { username, password } = req.body;
    try {
      // Проверка существующего
      const { data: existing } = await supabase
        .from("users")
        .select("*")
        .eq("username", username)
        .single()
        .maybeSingle();
      if (existing) return res.status(400).json({ message: "Никнейм занят" });

      const hashed = await bcrypt.hash(password, 10);
      const { data: newUser } = await supabase
        .from("users")
        .insert([{ username, password: hashed }])
        .select()
        .single();

      const token = jwt.sign(
        { userId: newUser.id, username: newUser.username },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
      );
      return res
        .status(201)
        .json({
          message: "OK",
          token,
          username: newUser.username,
          id: newUser.id,
        });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ message: "Ошибка сервера" });
    }
  }
);

// Логин (проверка по таблице users)
app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  try {
    const { data: user } = await supabase
      .from("users")
      .select("*")
      .eq("username", username)
      .single();
    if (!user) return res.status(400).json({ message: "Неверный никнейм" });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(400).json({ message: "Неверный пароль" });
    const token = jwt.sign(
      { userId: user.id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );
    res.json({ message: "OK", token, username: user.username, id: user.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
});

// Create server
app.post("/api/servers", async (req, res) => {
  const { name } = req.body;
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ message: "Unauthorized" });
  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // create server with random invite code
    const invite_code = Math.random().toString(36).slice(2, 9);
    const { data: serverRow } = await supabase
      .from("servers")
      .insert([{ name, owner_id: decoded.userId, invite_code }])
      .select()
      .single();

    // add owner to server_members
    await supabase
      .from("server_members")
      .insert([{ server_id: serverRow.id, user_id: decoded.userId }]);

    // create default channel
    const { data: channel } = await supabase
      .from("channels")
      .insert([{ server_id: serverRow.id, name: "общий", type: "text" }])
      .select()
      .single();

    return res.status(201).json({ server: serverRow, defaultChannel: channel });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Ошибка создания сервера" });
  }
});

// Join by invite
app.post("/api/servers/join", async (req, res) => {
  const { invite } = req.body;
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ message: "Unauthorized" });
  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const { data: serverRow } = await supabase
      .from("servers")
      .select("*")
      .eq("invite_code", invite)
      .single();
    if (!serverRow) return res.status(404).json({ message: "Invalid invite" });

    // add membership if not exists
    const { data: existing } = await supabase
      .from("server_members")
      .select("*")
      .eq("server_id", serverRow.id)
      .eq("user_id", decoded.userId)
      .single()
      .maybeSingle();
    if (!existing) {
      await supabase
        .from("server_members")
        .insert([{ server_id: serverRow.id, user_id: decoded.userId }]);
    }
    // return server + channels
    const { data: channels } = await supabase
      .from("channels")
      .select("*")
      .eq("server_id", serverRow.id);
    return res.json({ server: serverRow, channels });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Ошибка присоединения" });
  }
});

// Get server data (channels + last messages for each channel optional)
app.get("/api/servers/:id", async (req, res) => {
  const serverId = req.params.id;
  try {
    const { data: serverRow } = await supabase
      .from("servers")
      .select("*")
      .eq("id", serverId)
      .single();
    if (!serverRow)
      return res.status(404).json({ message: "Server not found" });
    const { data: channels } = await supabase
      .from("channels")
      .select("*")
      .eq("server_id", serverId);
    return res.json({ server: serverRow, channels });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Ошибка" });
  }
});

// Get messages for channel
app.get(
  "/api/servers/:serverId/channels/:channelId/messages",
  async (req, res) => {
    const { serverId, channelId } = req.params;
    try {
      const { data: messages } = await supabase
        .from("messages")
        .select("*")
        .eq("server_id", serverId)
        .eq("channel_id", channelId)
        .order("created_at", { ascending: true });
      res.json({ messages });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Ошибка" });
    }
  }
);

app.get("/api/user/servers", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ message: "Unauthorized" });
  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Получаем server_ids из server_members
    const { data: memberships, error: memErr } = await supabase
      .from("server_members")
      .select("server_id")
      .eq("user_id", decoded.userId);

    if (memErr) throw memErr;

    const serverIds = (memberships || []).map((m) => m.server_id);
    if (serverIds.length === 0) return res.json({ servers: [] });

    // Получаем сервера
    const { data: servers, error: srvErr } = await supabase
      .from("servers")
      .select("*")
      .in("id", serverIds);

    if (srvErr) throw srvErr;

    // Получаем каналы для этих серверов, чтобы вернуть default/first channel id
    const { data: channels } = await supabase
      .from("channels")
      .select("*")
      .in("server_id", serverIds);

    const serversWithChannel = (servers || []).map((s) => {
      const ch = (channels || []).find((c) => c.server_id === s.id);
      return { ...s, defaultChannelId: ch ? ch.id : null };
    });

    return res.json({ servers: serversWithChannel });
  } catch (err) {
    console.error("GET /api/user/servers error", err);
    return res.status(500).json({ message: "Ошибка получения серверов" });
  }
});

// Socket.IO: join room and persist messages
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error("Токен обязателен"));
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.user = decoded;
    next();
  } catch (err) {
    next(new Error("Аутентификация не удалась"));
  }
});

io.on("connection", (socket) => {
  console.log("connected", socket.user.username);

  socket.on("join channel", ({ serverId, channelId }) => {
    const room = `${serverId}:${channelId}`;
    socket.join(room);
  });

  socket.on("leave channel", ({ serverId, channelId }) => {
    socket.leave(`${serverId}:${channelId}`);
  });

  socket.on("chat message", async ({ serverId, channelId, content }) => {
    try {
      // persist in Supabase
      const { data: msg } = await supabase
        .from("messages")
        .insert([
          {
            server_id: serverId,
            channel_id: channelId,
            user_id: socket.user.userId,
            username: socket.user.username,
            content,
          },
        ])
        .select()
        .single();

      const room = `${serverId}:${channelId}`;
      io.to(room).emit("chat message", msg);
    } catch (err) {
      console.error("save message error", err);
    }
  });

  socket.on("disconnect", () => {
    console.log("disconnected", socket.user?.username);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Server listening ${PORT}`));
