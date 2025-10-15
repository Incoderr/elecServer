const express = require("express");
const { body, validationResult } = require("express-validator");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { supabase } = require("../config/supabase");

const router = express.Router();

router.post(
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

router.post("/login", async (req, res) => {
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

module.exports = router;