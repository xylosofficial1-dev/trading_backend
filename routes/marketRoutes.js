// routes/marketRoutes.js
const express = require("express");
const router = express.Router();
const pool = require("../db/db");

// ✅ GET all active coins
router.get("/coins", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT symbol FROM market_coins WHERE is_active = true ORDER BY id ASC`
    );

    res.json(result.rows);
  } catch (err) {
    console.error("GET /coins error:", err);
    res.status(500).json({ error: "Failed to fetch coins" });
  }
});

// ✅ ADD coin (Admin)
router.post("/coins/add", async (req, res) => {
  try {
    const { symbol } = req.body;

    if (!symbol) {
      return res.status(400).json({ error: "Symbol is required" });
    }

    await pool.query(
      `INSERT INTO market_coins (symbol)
       VALUES ($1)
       ON CONFLICT (symbol) DO NOTHING`,
      [symbol.toUpperCase()]
    );

    res.json({ success: true, message: "Coin added" });
  } catch (err) {
    console.error("POST /coins/add error:", err);
    res.status(500).json({ error: "Failed to add coin" });
  }
});

// ✅ REMOVE coin (soft delete)
router.post("/coins/remove", async (req, res) => {
  try {
    const { symbol } = req.body;

    if (!symbol) {
      return res.status(400).json({ error: "Symbol is required" });
    }

    await pool.query(
      `UPDATE market_coins SET is_active = false WHERE symbol = $1`,
      [symbol.toUpperCase()]
    );

    res.json({ success: true, message: "Coin removed" });
  } catch (err) {
    console.error("POST /coins/remove error:", err);
    res.status(500).json({ error: "Failed to remove coin" });
  }
});

// ✅ (Optional) GET all coins (for admin panel)
router.get("/coins/all", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM market_coins ORDER BY id DESC`
    );

    res.json(result.rows);
  } catch (err) {
    console.error("GET /coins/all error:", err);
    res.status(500).json({ error: "Failed to fetch all coins" });
  }
});

module.exports = router;