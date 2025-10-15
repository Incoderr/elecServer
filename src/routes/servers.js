const express = require("express");
const { authMiddleware } = require("../middleware/auth");
const { supabase } = require("../config/supabase");

const router = express.Router();

router.post("/", authMiddleware, async (req, res) => {
  const { name } = req.body;
  try {
    const invite_code = Math.random().toString(36).slice(2, 9);
    const { data: serverRow } = await supabase
      .from("servers")
      .insert([{ name, owner_id: req.user.userId, invite_code }])
      .select()
      .single();

    await supabase
      .from("server_members")
      .insert([{ server_id: serverRow.id, user_id: req.user.userId }]);

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

router.post("/join", authMiddleware, async (req, res) => {
  const { invite } = req.body;
  try {
    const { data: serverRow } = await supabase
      .from("servers")
      .select("*")
      .eq("invite_code", invite)
      .single();
    if (!serverRow) return res.status(404).json({ message: "Invalid invite" });

    const { data: existing } = await supabase
      .from("server_members")
      .select("*")
      .eq("server_id", serverRow.id)
      .eq("user_id", req.user.userId)
      .single()
      .maybeSingle();
    if (!existing) {
      await supabase
        .from("server_members")
        .insert([{ server_id: serverRow.id, user_id: req.user.userId }]);
    }
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

router.get("/user/servers", authMiddleware, async (req, res) => {
  try {
    const { data: memberships, error: memErr } = await supabase
      .from("server_members")
      .select("server_id")
      .eq("user_id", req.user.userId);

    if (memErr) throw memErr;

    const serverIds = (memberships || []).map((m) => m.server_id);
    if (serverIds.length === 0) return res.json({ servers: [] });

    const { data: servers, error: srvErr } = await supabase
      .from("servers")
      .select("*")
      .in("id", serverIds);

    if (srvErr) throw srvErr;

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

router.get("/:id/members", async (req, res) => {
  const serverId = req.params.id;
  try {
    const { data: memberships, error: memErr } = await supabase
      .from("server_members")
      .select("user_id, users!inner(id, username, avatar)")
      .eq("server_id", serverId);

    if (memErr) throw memErr;

    const formattedMembers = memberships.map((m) => ({
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