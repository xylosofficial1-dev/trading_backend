// routes/adminDataRoutes.js
const express = require("express");
const router = express.Router();
const pool = require("../db/db");

// GET ALL TABLE DATA
router.get("/all-data", async (req, res) => {
  try {
    const [
      sellListings,
      penaltySettings,
      buyRequests,
      payments,
      adminSettings,
      tradeHistory,
      withdrawals,
      notifications,
      commissionRuns,
      otpVerifications
    ] = await Promise.all([
      pool.query("SELECT * FROM p2p_sell_listings ORDER BY id DESC"),
      pool.query("SELECT * FROM p2p_penalty_settings"),
      pool.query("SELECT * FROM p2p_buy_requests ORDER BY id DESC"),
      pool.query("SELECT * FROM p2p_payments ORDER BY id DESC"),
      pool.query("SELECT * FROM admin_settings"),
      pool.query("SELECT * FROM p2p_trade_history ORDER BY id DESC"),
      pool.query("SELECT * FROM trading_wallet_withdrawals ORDER BY id DESC"),
      pool.query("SELECT * FROM notifications ORDER BY id DESC"),
      pool.query("SELECT * FROM commission_runs ORDER BY id DESC"),
      pool.query("SELECT * FROM otp_verifications ORDER BY id DESC")
    ]);

    res.json({
      success: true,
      data: {
        p2p_sell_listings: sellListings.rows,
        p2p_penalty_settings: penaltySettings.rows,
        p2p_buy_requests: buyRequests.rows,
        p2p_payments: payments.rows,
        admin_settings: adminSettings.rows,
        p2p_trade_history: tradeHistory.rows,
        trading_wallet_withdrawals: withdrawals.rows,
        notifications: notifications.rows,
        commission_runs: commissionRuns.rows,
        otp_verifications: otpVerifications.rows
      }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = router;