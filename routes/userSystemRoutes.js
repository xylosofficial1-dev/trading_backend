const express = require("express");
const router = express.Router();
const pool = require("../db/db");

/* =========================================================
   REFERRAL COUNT
   GET /api/system/referrals/:id/count
   ========================================================= */
router.get("/referrals/:id/count", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      "SELECT COUNT(*) FROM users WHERE parent_id = $1",
      [id]
    );

    res.json({ total: Number(result.rows[0].count) });
  } catch (err) {
    console.error("REFERRAL COUNT ERROR:", err);
    res.status(500).json({ error: "Failed to get referral count" });
  }
});


/* =========================================================
   MAX DEPOSIT LIMIT BASED ON REFERRAL
   GET /api/system/trade-limit/:id
   RULE:
   base max = 1000
   +100 per direct referral
   min always = 100 (if trading wallet = 0)
   ========================================================= */
router.get("/trade-limit/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const referral = await pool.query(
      "SELECT COUNT(*) FROM users WHERE parent_id = $1",
      [id]
    );

    const count = Number(referral.rows[0].count);

    const max = 1000 + count * 100;
    const min = 100;

    res.json({
      min,
      max,
      referrals: count
    });

  } catch (err) {
    console.error("TRADE LIMIT ERROR:", err);
    res.status(500).json({ error: "Failed to calculate limit" });
  }
});


/* =========================================================
   GET AUTO TRADE STATUS
   GET /api/system/auto-trade/:id
   ========================================================= */
router.get("/auto-trade/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const user = await pool.query(
      "SELECT auto_trade FROM users WHERE id=$1",
      [id]
    );

    if (!user.rowCount)
      return res.status(404).json({ error: "User not found" });

    res.json({ auto_trade: user.rows[0].auto_trade });

  } catch (err) {
    console.error("AUTO TRADE FETCH ERROR:", err);
    res.status(500).json({ error: "Failed to fetch auto trade status" });
  }
});


/* =========================================================
   TOGGLE AUTO TRADE
   POST /api/system/auto-trade/toggle
   BODY: { userId }
   ========================================================= */
router.post("/auto-trade/toggle", async (req, res) => {
  try {
    const { userId } = req.body;

    const user = await pool.query(
      "SELECT auto_trade FROM users WHERE id=$1",
      [userId]
    );

    if (!user.rowCount)
      return res.status(404).json({ error: "User not found" });

    const newValue = !user.rows[0].auto_trade;

    await pool.query(
      "UPDATE users SET auto_trade=$1 WHERE id=$2",
      [newValue, userId]
    );

    res.json({
      success: true,
      auto_trade: newValue,
      message: newValue
        ? "Auto trade enabled. Your commission will add in trading wallet."
        : "Auto trade disabled."
    });

  } catch (err) {
    console.error("AUTO TRADE TOGGLE ERROR:", err);
    res.status(500).json({ error: "Failed to toggle auto trade" });
  }
});

module.exports = router;