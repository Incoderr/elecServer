const express = require("express");
const multer = require("multer");
const path = require("path");
const { authMiddleware } = require("../middleware/auth");
const { supabase } = require("../config/supabase");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post("/avatar", authMiddleware, async (req, res) => {
  const { avatar } = req.body;
  if (!avatar) return res.status(400).json({ message: "No avatar provided" });

  try {
    const { data, error } = await supabase
      .from("users")
      .update({ avatar })
      .eq("id", req.user.userId)
      .select()
      .single();

    if (error) throw error;
    return res.json({ user: data });
  } catch (err) {
    console.error("POST /api/user/avatar error", err);
    return res.status(500).json({ message: "Ошибка обновления аватара" });
  }
});

router.post("/avatar/upload", authMiddleware, upload.single("avatar"), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: "No file" });

  try {
    const file = req.file;
    const ext = path.extname(file.originalname) || "";
    const filePath = `avatars/${req.user.userId}-${Date.now()}${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        upsert: true,
      });

    if (uploadError) {
      console.error("Supabase upload error:", uploadError);
      return res.status(500).json({ message: "Storage upload error", detail: uploadError });
    }

    const { data: publicData } = supabase.storage
      .from("avatars")
      .getPublicUrl(filePath);
    const publicUrl = publicData?.publicUrl || null;

    const { data: userData, error: updateErr } = await supabase
      .from("users")
      .update({ avatar: publicUrl })
      .eq("id", req.user.userId)
      .select()
      .single();

    if (updateErr) {
      console.error("DB update error:", updateErr);
      return res.status(500).json({ message: "DB update error", detail: updateErr });
    }

    return res.json({ avatar: publicUrl, user: userData });
  } catch (err) {
    console.error("POST /api/user/avatar/upload error", err);
    return res.status(500).json({ message: "Ошибка обновления аватара" });
  }
});

module.exports = router;