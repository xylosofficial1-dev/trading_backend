const pool = require("../db/db");

module.exports = async function startCommissionCycle(userId) {
  try {
    // get trading wallet
    const { rows } = await pool.query(
      `SELECT trading_wallet_amount FROM users WHERE id = $1`,
      [userId]
    );

    if (!rows.length) return;

    const balance = Number(rows[0].trading_wallet_amount);

    // only start if >=100
    if (balance < 100) return;

    // check already started
    const existing = await pool.query(
      `SELECT * FROM trade_commission_cycles WHERE user_id = $1`,
      [userId]
    );

    if (existing.rows.length) return;

    // start cycle
    await pool.query(
      `INSERT INTO trade_commission_cycles (user_id, started_at)
       VALUES ($1, NOW())`,
      [userId]
    );

    console.log("🟢 Commission cycle started for user:", userId);

  } catch (err) {
    console.log("Commission starter error:", err.message);
  }
};