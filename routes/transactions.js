const express = require("express");
const pool = require("../db/db");

const router = express.Router();

router.post("/", async (req, res) => {
  try {
    const {
      user_id,
      tx_hash,
      chain,
      token,
      amount,
      from_address,
      to_address,
    } = req.body;

    if (!user_id || !tx_hash || !amount) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const result = await pool.query(
      `
      INSERT INTO transactions
      (user_id, tx_hash, chain, token, amount, from_address, to_address)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (tx_hash) DO NOTHING
      RETURNING *
      `,
      [
        user_id,
        tx_hash,
        chain,
        token,
        amount,
        from_address,
        to_address,
      ]
    );

    res.json({ success: true, transaction: result.rows[0] });
  } catch (err) {
    console.error("TX SAVE ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/history/:userId", async (req, res) => {
  const { userId } = req.params;

  try {
    const query = `
    SELECT 
  id,
  title,
  message,
  created_at,

  COALESCE(
    (regexp_match(message, '[-]?[0-9]+(?:\\.[0-9]+)?'))[1]::numeric,
    0
  ) AS amount,

  CASE
    WHEN message ~ '-[0-9]' THEN 'debit'
    WHEN message ILIKE '%loss%' THEN 'debit'
    WHEN message ILIKE '%withdraw%' THEN 'debit'
    ELSE 'credit'
  END AS type,

  main_wallet_balance,
  trading_wallet_balance

FROM notifications

WHERE target_type='custom'
AND POSITION($1::text IN target_users) > 0
AND message NOT ILIKE '%rejected%'

ORDER BY created_at DESC
    `;

    const { rows } = await pool.query(query, [userId]);

    res.json(rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/:user_id", async (req, res) => {
  try {
    const { user_id } = req.params;

    const result = await pool.query(
      `
      SELECT * FROM transactions
      WHERE user_id = $1
      ORDER BY created_at DESC
      `,
      [user_id]
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});
module.exports = router;
