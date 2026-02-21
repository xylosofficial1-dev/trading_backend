const express = require("express");
const router = express.Router();
const pool = require("../db/db");
const bcrypt = require("bcryptjs");

/* ================= LOGIN ================= */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password)
      return res.status(400).json({ error: "Email & password required" });

    const result = await pool.query(
      "SELECT id, name, password_hash, is_verified, status FROM users WHERE email=$1",
      [email]
    );

    if (!result.rowCount)
      return res.status(401).json({ error: "Invalid email or password" });

    const user = result.rows[0];

    // 🚫 BLOCKED USER
    if (user.status === "block") {
      return res.status(403).json({
        error: "Your account has been blocked by admin"
      });
    }

    if (!user.is_verified)
      return res.status(403).json({ error: "Email not verified" });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match)
      return res.status(401).json({ error: "Invalid email or password" });

    res.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Login failed" });
  }
});

module.exports = router;
