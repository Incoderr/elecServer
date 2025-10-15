const express = require("express");
const { authMiddleware } = require("../middleware/auth");
const { supabase } = require("../config/supabase");

const router = express.Router();

router.get("/servers/:id", async (req, res) => {
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

router.get("/servers/:serverId/channels/:channelId/messages", authMiddleware, async (req, res) => {
  const { serverId, channelId } = req.params;
  try {
    const { data: membership, error: membershipError } = await supabase
      .from("server_members")
      .select("id")
      .eq("server_id", serverId)
      .eq("user_id", req.user.userId)
      .single();

    if (membershipError || !membership) {
      return res
        .status(401)
        .json({ message: "Unauthorized: Not a member of this server" });
    }

    const { data: messagesData, error } = await supabase
      .from("messages")
      .select(
        "id, content, created_at, username, avatar, og_site_name, og_title, og_description, og_image, og_url"
      )
      .eq("server_id", serverId)
      .eq("channel_id", channelId)
      .order("created_at", { ascending: true });

    if (error) throw error;

    res.json({ messages: messagesData });
  } catch (err) {
    console.error("Messages endpoint error:", err);
    res.status(401).json({ message: "Unauthorized", detail: err.message });
  }
});

module.exports = router;