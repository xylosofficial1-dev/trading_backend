// routes/tradingWalletRoutes.js

const express = require("express");
const router = express.Router();
const pool = require("../db/db");

/*
GET /api/trading-wallet/history/:userId
*/
router.get("/history/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const result = await pool.query(
      `
      SELECT
        id,
        wallet_amount,
        requested_amount,
        sent_amount,
        status,
        reject_reason,
        created_at,
        updated_at
      FROM trading_wallet_withdrawals
      WHERE user_id = $1
      ORDER BY created_at DESC
      `,
      [userId]
    );

    res.json({
      success: true,
      history: result.rows,
    });
  } catch (error) {
    console.error("Withdrawal history error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch withdrawal history",
    });
  }
});

module.exports = router;