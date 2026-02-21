// backend/routes/trades.js
const express = require("express");
const router = express.Router();
const pool = require("../db/db");


// ==========================
// CREATE TRADE (BUY)
// ==========================
router.post("/buy", async (req, res) => {
  try {
    const {
      user_id,
      name,
      email,
      coin,
      price,
      quantity,
      total
    } = req.body;

    await pool.query(`
      INSERT INTO trades
      (user_id,name,email,coin,trade_type,price,quantity,total,status)
      VALUES($1,$2,$3,$4,'buy',$5,$6,$7,'open')
    `, [user_id, name, email, coin, price, quantity, total]);

    res.json({ success: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Buy failed" });
  }
});


// ==========================
// CLOSE TRADE
// ==========================
router.post("/close/:id", async (req, res) => {
  try {
    const tradeId = req.params.id;
    const { user_id } = req.body;

    await pool.query(`
      UPDATE trades
      SET status='closed',
          profit_loss = 50,
          closed_at = NOW()
      WHERE id=$1 AND user_id=$2
    `, [tradeId, user_id]);

    res.json({ success: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Close failed" });
  }
});

// ==========================
// GET OPEN TRADES (Assets)
// ==========================
router.get("/open/:userId", async (req, res) => {
  try {

    const { rows } = await pool.query(`
      SELECT 
        t.*,
        m.rate as base_rate
      FROM trades t
      LEFT JOIN market_custom_rates m
      ON LOWER(m.symbol) = LOWER(t.coin)
      WHERE t.user_id=$1 AND t.status='open'
      ORDER BY t.created_at DESC
    `, [req.params.userId]);

    res.json(rows);

  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Fetch failed" });
  }
});

// ==========================
// GET HISTORY
// ==========================
router.get("/history/:userId", async (req, res) => {
  try {

    const { rows } = await pool.query(`
      SELECT *
      FROM trades
      WHERE user_id=$1
      ORDER BY created_at DESC
    `, [req.params.userId]);

    res.json(rows);

  } catch (err) {
    res.status(500).json({ error: "History failed" });
  }
});
 
module.exports = router;
