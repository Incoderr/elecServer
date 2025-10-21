const express = require("express");
const { verifyToken } = require("../utils/auth");
const { supabase } = require("../config/supabase");

const router = express.Router();

// Create server
router.post("/api/servers", async (req, res) => {
  const { name } = req.body;
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ message: "Unauthorized" });
  const token = authHeader.split(" ")[1];
  try {
    const decoded = verifyToken(token);
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
router.post("/api/servers/join", async (req, res) => {
  const { invite } = req.body;
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ message: "Unauthorized" });
  const token = authHeader.split(" ")[1];
  try {
    const decoded = verifyToken(token);
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
router.get("/api/servers/:id", async (req, res) => {
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

router.get(
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
      const decoded = verifyToken(token);
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
        .select(
          `
        id,
        content,
        created_at,
        updated_at,
        username,
        avatar,
        og_site_name,
        og_title,
        og_description,
        og_image,
        og_url,
        replied_to_id,  
        replied_to:replied_to_id(content, username)
        `
        )
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

router.get("/api/user/servers", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ message: "Unauthorized" });
  const token = authHeader.split(" ")[1];
  try {
    const decoded = verifyToken(token);

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

router.get("/api/servers/:id/members", async (req, res) => {
  const serverId = req.params.id;
  const { redisClient } = require("../config/redis");
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

    const membersWithStatus = await Promise.all(users.map(async (user) => {
      let status = await redisClient.hGet('user_statuses', user.id);
      if (!status) {
        // Fallback из DB
        const { data: dbUser } = await supabase.from("users").select("status, last_seen").eq("id", user.id).single();
        status = dbUser?.status || 'offline';
      }
      return { ...user, status };
    }));

    return res.json({ members: membersWithStatus });
  } catch (err) {
    console.error("GET /api/servers/:id/members error:", err);
    return res.status(500).json({ message: "Ошибка получения участников" });
  }
});

router.get("/api/servers/:serverId/members", async (req, res) => {
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

module.exports = router;
