const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { body, validationResult } = require("express-validator");
const dotenv = require("dotenv");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");
const path = require("path");
const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage() });
const ogs = require("open-graph-scraper");

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
    origin: ["http://localhost:5173", "https://tauriapp.vercel.app"],
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
      return res.status(201).json({
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
      .select("id, username, password, avatar")
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
    res.json({
      message: "OK",
      token,
      username: user.username,
      id: user.id,
      avatar: user.avatar,
    });
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

app.get(
  "/api/servers/:serverId/channels/:channelId/messages",
  async (req, res) => {
    const { serverId, channelId } = req.params;
    const authHeader = req.headers.authorization;
    console.log(
      "Messages request: serverId=",
      serverId,
      "channelId=",
      channelId,
      "authHeader=",
      authHeader || "none"
    );

    if (!authHeader) {
      console.log("No auth header - returning 401");
      return res
        .status(401)
        .json({ message: "Unauthorized: No token provided" });
    }

    const token = authHeader.split(" ")[1];
    console.log("Extracted token:", token ? "present" : "absent");

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      console.log("Decoded token:", decoded.userId, decoded.username);

      // Проверка, что пользователь является членом сервера (опционально, но рекомендуется)
      const { data: membership, error: membershipError } = await supabase
        .from("server_members")
        .select("id")
        .eq("server_id", serverId)
        .eq("user_id", decoded.userId)
        .single();

      if (membershipError || !membership) {
        console.log("User not in server - returning 401");
        return res
          .status(401)
          .json({ message: "Unauthorized: Not a member of this server" });
      }

      // Запрос сообщений
      const { data: messagesData, error } = await supabase
        .from("messages")
        .select("id, content, created_at, username, avatar, og_site_name, og_title, og_description, og_image, og_url")
        .eq("server_id", serverId)
        .eq("channel_id", channelId)
        .order("created_at", { ascending: true });

      if (error) {
        console.error("Supabase query error:", error.message);
        throw error;
      }

      console.log("Messages fetched successfully, count:", messagesData.length);
      res.json({ messages: messagesData });
    } catch (err) {
      console.error("Messages endpoint error:", err.message, err.name);
      res.status(401).json({ message: "Unauthorized", detail: err.message });
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

app.get("/api/servers/:id/members", async (req, res) => {
  const serverId = req.params.id;
  try {
    // Получаем user_id из server_members
    const { data: memberships, error: memErr } = await supabase
      .from("server_members")
      .select("user_id")
      .eq("server_id", serverId);

    if (memErr) {
      console.error("memberships query error:", memErr);
      return res.status(500).json({ message: "DB error reading memberships" });
    }

    const userIds = (memberships || []).map((m) => m.user_id).filter(Boolean);

    if (userIds.length === 0) {
      return res.json({ members: [] });
    }

    // dedupe & normalize
    const uniq = [...new Set(userIds.map((id) => String(id)))];

    // chunking to avoid too-large IN(...) queries
    const chunkSize = 100;
    let users = [];
    for (let i = 0; i < uniq.length; i += chunkSize) {
      const chunk = uniq.slice(i, i + chunkSize);
      const { data: chunkUsers, error: userErr } = await supabase
        .from("users")
        .select("id, username, avatar")
        .in("id", chunk);

      if (userErr) {
        console.error("users query error:", userErr, { chunk });
        return res.status(500).json({ message: "DB error reading users" });
      }

      users = users.concat(chunkUsers || []);
    }

    return res.json({ members: users });
  } catch (err) {
    console.error("GET /api/servers/:id/members error:", err);
    return res.status(500).json({ message: "Ошибка получения участников" });
  }
});

app.post("/api/user/avatar", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ message: "Unauthorized" });
  const token = authHeader.split(" ")[1];
  const { avatar } = req.body;
  if (!avatar) return res.status(400).json({ message: "No avatar provided" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const { data, error } = await supabase
      .from("users")
      .update({ avatar })
      .eq("id", decoded.userId)
      .select()
      .single();

    if (error) throw error;
    return res.json({ user: data });
  } catch (err) {
    console.error("POST /api/user/avatar error", err);
    return res.status(500).json({ message: "Ошибка обновления аватара" });
  }
});

app.post(
  "/api/user/avatar/upload",
  upload.single("avatar"),
  async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ message: "Unauthorized" });
    const token = authHeader.split(" ")[1];
    if (!req.file) return res.status(400).json({ message: "No file" });

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const file = req.file;
      const ext = path.extname(file.originalname) || "";
      const filePath = `avatars/${decoded.userId}-${Date.now()}${ext}`;

      // Загружаем буфер в Supabase Storage (service role key на сервере)
      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(filePath, file.buffer, {
          contentType: file.mimetype,
          upsert: true,
        });

      if (uploadError) {
        console.error("Supabase upload error:", uploadError);
        return res
          .status(500)
          .json({ message: "Storage upload error", detail: uploadError });
      }

      const { data: publicData } = supabase.storage
        .from("avatars")
        .getPublicUrl(filePath);
      const publicUrl = publicData?.publicUrl || null;

      // Сохраняем URL в таблице users
      const { data: userData, error: updateErr } = await supabase
        .from("users")
        .update({ avatar: publicUrl })
        .eq("id", decoded.userId)
        .select()
        .single();

      if (updateErr) {
        console.error("DB update error:", updateErr);
        return res
          .status(500)
          .json({ message: "DB update error", detail: updateErr });
      }

      return res.json({ avatar: publicUrl, user: userData });
    } catch (err) {
      console.error("POST /api/user/avatar/upload error", err);
      return res.status(500).json({ message: "Ошибка обновления аватара" });
    }
  }
);

app.get("/api/servers/:serverId/members", async (req, res) => {
  const { serverId } = req.params;
  try {
    const { data: members, error } = await supabase
      .from("server_members")
      .select("user_id, users!inner(id, username, avatar)")
      .eq("server_id", serverId);

    if (error) throw error;

    const formattedMembers = members.map((m) => ({
      id: m.user_id,
      username: m.users.username,
      avatar: m.users.avatar,
    }));

    res.json({ members: formattedMembers });
  } catch (err) {
    console.error("Load members error:", err);
    res.status(500).json({ message: "Ошибка загрузки членов" });
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
      // Получить avatar пользователя из таблицы users
      const { data: user, error: userError } = await supabase
        .from("users")
        .select("avatar")
        .eq("id", socket.user.userId)
        .single();

      if (userError) {
        console.error("Error fetching user avatar:", userError);
        throw userError; // Или обработайте ошибку по-другому
      }

      const urlRegex = /(https?:\/\/[^\s]+)/g;
      const match = content.match(urlRegex);
      const url = match ? match[0] : null;

      let ogData = {};
      if (url) {
        const { result } = await ogs({ url });
        if (result.success) {
          ogData = {
            og_site_name: result.ogSiteName,
            og_title: result.ogTitle,
            og_description: result.ogDescription,
            og_image: result.ogImage?.[0]?.url || result.ogImage?.url,
            og_url: result.requestUrl || url,
          };
        }
      }

      // Теперь persist in Supabase с полученным avatar
      const { data: msg, error: insertError } = await supabase
        .from("messages")
        .insert([
          {
            server_id: serverId,
            channel_id: channelId,
            user_id: socket.user.userId,
            username: socket.user.username,
            avatar: user?.avatar || null,
            content,
            og_site_name: ogData.og_site_name || null,
            og_title: ogData.og_title || null,
            og_description: ogData.og_description || null,
            og_image: ogData.og_image || null,
            og_url: ogData.og_url || null,
          },
        ])
        .select()
        .single();

      if (insertError) {
        console.error("Insert message error:", insertError);
        throw insertError;
      }

      const room = `${serverId}:${channelId}`;
      io.to(room).emit("chat message", msg);
    } catch (err) {
      console.error("save message error", err);
    }
  });

  socket.on("typing", ({ serverId, channelId }) => {
    const room = `${serverId}:${channelId}`;
    // Отправляем только другим в комнате (не отправителю)
    socket.to(room).emit("user typing", { username: socket.user.username });
  });

  socket.on("disconnect", () => {
    console.log("disconnected", socket.user?.username);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Server listening ${PORT}`));
