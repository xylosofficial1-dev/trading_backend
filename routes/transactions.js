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
