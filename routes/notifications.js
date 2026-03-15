// backend/routes/notifications.js
const express = require("express");
const router = express.Router();
const pool = require("../db/db");

router.get("/", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        id,
        title,
        message,
        target_type,
        target_users,
        created_at
      FROM notifications
      ORDER BY created_at DESC
    `);

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/", async (req, res) => {
  const { title, message, target, customIds } = req.body;

  try {

    const target_type = target === "custom" ? "custom" : "all";
    const target_users = target_type === "custom" ? customIds : null;

    let mainWallet = 0;
    let tradingWallet = 0;

    if (target_type === "custom" && customIds) {

      // get first user id from "3" or "3,5,7"
      const firstUserId = customIds.split(",")[0];

      const userRes = await pool.query(
        `SELECT wallet_amount, trading_wallet_amount
         FROM users
         WHERE id = $1`,
        [firstUserId]
      );

      if (userRes.rows.length > 0) {
        mainWallet = userRes.rows[0].wallet_amount;
        tradingWallet = userRes.rows[0].trading_wallet_amount;
      }
    }

    const notifRes = await pool.query(
      `INSERT INTO notifications
       (title, message, target_type, target_users,
        main_wallet_balance, trading_wallet_balance)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [title, message, target_type, target_users, mainWallet, tradingWallet]
    );

    res.json(notifRes.rows[0]);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.put("/:id", async (req, res) => {
  const { title, message, target, customIds } = req.body;

  try {
    const target_type = target === "custom" ? "custom" : "all";
    const target_users = target_type === "custom" ? customIds : null;

    const result = await pool.query(
      `UPDATE notifications
       SET title=$1,
           message=$2,
           target_type=$3,
           target_users=$4,
           updated_at=NOW()
       WHERE id=$5
       RETURNING *`,
      [title, message, target_type, target_users, req.params.id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM notifications WHERE id=$1", [
      req.params.id,
    ]);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ UNREAD COUNT (must be FIRST)
router.get("/unread/:userId", async (req, res) => {
  const { userId } = req.params;

  try {
    const userRes = await pool.query(
      `SELECT notifications_seen_at FROM users WHERE id=$1`,
      [userId]
    );

    const lastSeen = userRes.rows[0]?.notifications_seen_at;

    const notifRes = await pool.query(
      `
      SELECT MAX(created_at) AS latest
      FROM notifications
      WHERE
        target_type = 'all'
        OR (
          target_type = 'custom'
          AND $1 = ANY(string_to_array(target_users, ',')::int[])
        )
      `,
      [userId]
    );

    const latestNotif = notifRes.rows[0].latest;

    const hasUnread =
      latestNotif &&
      (!lastSeen || new Date(latestNotif) > new Date(lastSeen));

    res.json({ success: true, count: hasUnread ? 1 : 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ MARK AS SEEN (must be BEFORE /:userId)
router.put("/seen/:userId", async (req, res) => {
  const { userId } = req.params;

  try {
    await pool.query(
      `UPDATE users SET notifications_seen_at = NOW() WHERE id=$1`,
      [userId]
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ FETCH USER NOTIFICATIONS (keep LAST)
router.get("/:userId", async (req, res) => {
  const { userId } = req.params;
  const limit = parseInt(req.query.limit) || 50;

  try {
    const result = await pool.query(
      `
      SELECT id, title, message, created_at
      FROM notifications
      WHERE
        target_type = 'all'
        OR (
          target_type = 'custom'
          AND $1 = ANY(string_to_array(target_users, ',')::int[])
        )
      ORDER BY created_at DESC
      LIMIT $2
      `,
      [userId, limit]
    );

    res.json({ success: true, notifications: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
