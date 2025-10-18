const express = require("express");
const path = require("path");
const { verifyToken } = require("../utils/auth");
const { supabase } = require("../config/supabase");
const { upload } = require("../middleware/multer");

const router = express.Router();

router.post("/api/user/avatar", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ message: "Unauthorized" });
  const token = authHeader.split(" ")[1];
  const { avatar } = req.body;
  if (!avatar) return res.status(400).json({ message: "No avatar provided" });

  try {
    const decoded = verifyToken(token);
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

router.post(
  "/api/user/avatar/upload",
  upload.single("avatar"),
  async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ message: "Unauthorized" });
    const token = authHeader.split(" ")[1];
    if (!req.file) return res.status(400).json({ message: "No file" });

    try {
      const decoded = verifyToken(token);
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

module.exports = router;