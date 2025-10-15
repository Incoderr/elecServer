const jwt = require("jsonwebtoken");
const { supabase } = require("../config/supabase");
const { scrapeOG } = require("../utils/ogScraper");

const setupSocket = (io) => {
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("Токен обязателен"));
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = decoded;
      next();
    } catch (err) {
      next(new元年Error("Аутентификация не удалась"));
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
        const { data: user, error: userError } = await supabase
          .from("users")
          .select("avatar")
          .eq("id", socket.user.userId)
          .single();

        if (userError) throw userError;

        const urlRegex = /(https?:\/\/[^\s]+)/g;
        const match = content.match(urlRegex);
        const url = match ? match[0] : null;

        let ogData = {};
        if (url) {
          const isGifUrl =
            url.match(/\.gif(\?.*)?$/i) ||
            url.includes("tenor") ||
            url.includes("giphy");
          if (!isGifUrl) {
            ogData = await scrapeOG(url);
          }
        }

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

        if (insertError) throw insertError;

        const room = `${serverId}:${channelId}`;
        io.to(room).emit("chat message", msg);
      } catch (err) {
        console.error("save message error", err);
      }
    });

    socket.on("typing", ({ serverId, channelId }) => {
      const room = `${serverId}:${channelId}`;
      socket.to(room).emit("user typing", { username: socket.user.username });
    });

    socket.on("disconnect", () => {
      console.log("disconnected", socket.user?.username);
    });
  });
};

module.exports = { setupSocket };