const jwt = require("jsonwebtoken");
const { supabase } = require("../config/supabase");
const { redisClient } = require("../config/redis");
const { scrapeOgData } = require("../utils/ogScraper");

const setupSocketHandlers = (io) => {
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

  io.on("connection", async (socket) => {
    console.log("connected", socket.user.username);

    try {
      await redisClient.hSet("user_statuses", socket.user.userId, "online");
      await supabase
        .from("users")
        .update({ status: "online", last_seen: new Date().toISOString() })
        .eq("id", socket.user.userId);
      io.emit("user status changed", {
        userId: socket.user.userId,
        status: "online",
      });
    } catch (err) {
      console.error("Set online status error", err);
    }

    socket.on("join channel", ({ serverId, channelId }) => {
      const room = `${serverId}:${channelId}`;
      socket.join(room);
    });

    socket.on("leave channel", ({ serverId, channelId }) => {
      socket.leave(`${serverId}:${channelId}`);
    });

    socket.on(
      "chat message",
      async ({ serverId, channelId, content, replied_to_id }) => {
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
            const isGifUrl =
              url.match(/\.gif(\?.*)?$/i) ||
              url.includes("tenor") ||
              url.includes("giphy");

            const isSpotifyUrl = url.match(
              /https?:\/\/open\.spotify\.com\/(track|album|artist|playlist)\/[a-zA-Z0-9]+/i
            );

            if (!isGifUrl && !isSpotifyUrl) {
              ogData = await scrapeOgData(url);
            }
          }

          // Теперь insert в БД всегда выполняется, даже если ogs упал или пропущен
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
                replied_to_id: replied_to_id || null,
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
      }
    );

    socket.on(
      "edit message",
      async ({ serverId, channelId, messageId, newContent }) => {
        try {
          // Проверяем, что пользователь — автор сообщения
          const { data: msgCheck, error: checkError } = await supabase
            .from("messages")
            .select("user_id")
            .eq("id", messageId)
            .single();

          if (checkError || msgCheck.user_id !== socket.user.userId) {
            return socket.emit("error", {
              message: "Вы не можете редактировать это сообщение",
            });
          }

          // Обновляем сообщение с текущей датой и временем
          const { data: updatedMsg, error: updateError } = await supabase
            .from("messages")
            .update({
              content: newContent,
              updated_at: new Date().toISOString(), // Используем ISO формат
            })
            .eq("id", messageId)
            .select()
            .single();

          if (updateError) throw updateError;

          const room = `${serverId}:${channelId}`;
          io.to(room).emit("message updated", updatedMsg);
        } catch (err) {
          console.error("edit message error", err);
          socket.emit("error", { message: "Ошибка редактирования" });
        }
      }
    );

    socket.on("typing", ({ serverId, channelId }) => {
      const room = `${serverId}:${channelId}`;
      // Отправляем только другим в комнате (не отправителю)
      socket.to(room).emit("user typing", { username: socket.user.username });
    });

    socket.on("change status", async ({ newStatus }) => {
      if (!["online", "offline", "idle", "dnd"].includes(newStatus)) return;
      try {
        await redisClient.hSet("user_statuses", socket.user.userId, newStatus);
        await supabase
          .from("users")
          .update({ status: newStatus, last_seen: new Date().toISOString() })
          .eq("id", socket.user.userId);
        io.emit("user status changed", {
          userId: socket.user.userId,
          status: newStatus,
        });
      } catch (err) {
        console.error("Change status error", err);
      }
    });

    socket.on("disconnect", async () => {
      console.log("disconnected", socket.user?.username);
      // Новое: Установка 'offline' в Redis и DB
      try {
        await redisClient.hSet("user_statuses", socket.user.userId, "offline");
        await supabase
          .from("users")
          .update({ status: "offline", last_seen: new Date().toISOString() })
          .eq("id", socket.user.userId);
        io.emit("user status changed", {
          userId: socket.user.userId,
          status: "offline",
        });
      } catch (err) {
        console.error("Set offline status error", err);
      }
    });
  });
};

module.exports = { setupSocketHandlers };
