const express = require("express");
const router = express.Router();
const pool = require("../db/db");

function getCommissionRate(referralCount) {
  const base = 1.6;
  const increment = 0.05;
  return base + referralCount * increment;
}

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
   min always = 100 (if Strategy Allocation Balance = 0)
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
   DISTRIBUTE COMMISSION (ADMIN)
   POST /api/system/distribute-commission
   ========================================================= */
router.post("/distribute-commission", async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    /* ===============================
       🔐 CHECK 24 HOUR LOCK
    =============================== */
    const lastRunResult = await client.query(
      `SELECT last_run FROM commission_runs ORDER BY id DESC LIMIT 1`
    );

    if (lastRunResult.rowCount) {
      const lastRun = new Date(lastRunResult.rows[0].last_run);
      const now = new Date();

      const diffHours = (now - lastRun) / (1000 * 60 * 60);

      if (diffHours < 24) {
        const remaining = (24 - diffHours).toFixed(2);

        await client.query("ROLLBACK");

        return res.status(400).json({
          success: false,
          message: `Commission already distributed. Try again after ${remaining} hours.`,
        });
      }
    }

    /* ===============================
       💰 DISTRIBUTE COMMISSION
    =============================== */

    const users = await client.query(`
      SELECT 
        u.id,
        u.auto_trade,
        u.wallet_amount,
        u.trading_wallet_amount,
        COUNT(r.id) AS referrals
      FROM users u
      LEFT JOIN users r ON r.parent_id = u.id
      WHERE u.status = 'ok'
      GROUP BY u.id
    `);

    for (const user of users.rows) {
      const referralCount = Number(user.referrals);
      const commissionRate = getCommissionRate(referralCount);
      const baseAmount = Number(user.trading_wallet_amount);

      if (baseAmount <= 0) continue;

      const commissionAmount = Number(
        ((baseAmount * commissionRate) / 100).toFixed(2)
      );

      let updatedBalance;
      let walletType;

      if (user.auto_trade) {
        const update = await client.query(
          `UPDATE users 
           SET trading_wallet_amount = trading_wallet_amount + $1
           WHERE id = $2
           RETURNING trading_wallet_amount`,
          [commissionAmount, user.id]
        );

        updatedBalance = update.rows[0].trading_wallet_amount;
        walletType = "Strategy Allocation Balance";
      } else {
        const update = await client.query(
          `UPDATE users 
           SET wallet_amount = wallet_amount + $1
           WHERE id = $2
           RETURNING wallet_amount`,
          [commissionAmount, user.id]
        );

        updatedBalance = update.rows[0].wallet_amount;
        walletType = "Primary Credit Balance";
      }

      await client.query(
        `
        INSERT INTO notifications (title, message, target_type, target_users)
        VALUES ($1, $2, 'custom', $3)
        `,
        [
          "Commission Added",
          `$${commissionAmount.toFixed(2)} added to ${walletType}.
Rate: ${commissionRate.toFixed(2)}%
New ${walletType} Balance: $${Number(updatedBalance).toFixed(2)}`,
          String(user.id),
        ]
      );
    }

    /* ===============================
       📝 SAVE LAST RUN TIME
    =============================== */
    await client.query(
      `INSERT INTO commission_runs (last_run) VALUES (NOW())`
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      message: "Commission distributed successfully",
      users: users.rowCount,
    });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("COMMISSION ERROR:", err);
    res.status(500).json({ error: "Commission distribution failed" });
  } finally {
    client.release();
  }
});

/* =========================================================
   APPLY COMMISSION FOR SINGLE USER
   POST /api/system/apply-commission/:id
   ========================================================= */
router.post("/apply-commission/:id", async (req, res) => {
  const client = await pool.connect();

  try {
    const { id } = req.params;

    await client.query("BEGIN");

    const userResult = await client.query(
      `
      SELECT 
        u.id,
        u.auto_trade,
        u.wallet_amount,
        u.trading_wallet_amount,
        COUNT(r.id) AS referrals
      FROM users u
      LEFT JOIN users r ON r.parent_id = u.id
      WHERE u.id = $1
      GROUP BY u.id
      `,
      [id]
    );

    if (!userResult.rowCount) {
      return res.status(404).json({ error: "User not found" });
    }

    const user = userResult.rows[0];
    const referralCount = Number(user.referrals);

    const commissionRate = 1.6 + referralCount * 0.05;

    const baseAmount = Number(user.trading_wallet_amount);

    if (baseAmount <= 0) {
      return res.json({ message: "No balance for commission" });
    }

    const commissionAmount = (baseAmount * commissionRate) / 100;

   if (user.auto_trade) {
  await client.query(
    `UPDATE users 
     SET trading_wallet_amount = trading_wallet_amount + $1
     WHERE id = $2`,
    [commissionAmount, id]
  );
} else {
  await client.query(
    `UPDATE users 
     SET wallet_amount = wallet_amount + $1
     WHERE id = $2`,
    [commissionAmount, id]
  );
}

    // notification
    await client.query(
      `
      INSERT INTO notifications (title, message, target_type, target_users)
      VALUES ($1, $2, 'custom', $3)
      `,
      [
        "Commission Added",
        `$${commissionAmount.toFixed(2)} commission added at ${commissionRate.toFixed(2)}%`,
        String(id),
      ]
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      commission: commissionAmount,
      rate: commissionRate,
    });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("APPLY COMMISSION ERROR:", err);
    res.status(500).json({ error: "Failed to apply commission" });
  } finally {
    client.release();
  }
});

/* =========================================
   CHECK COMMISSION LOCK
   GET /api/system/commission-status
========================================= */
router.get("/commission-status", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT last_run FROM commission_runs ORDER BY id DESC LIMIT 1`
    );

    if (!result.rowCount) {
      return res.json({ locked: false });
    }

    const lastRun = new Date(result.rows[0].last_run);
    const now = new Date();

    const diff = (now - lastRun) / (1000 * 60 * 60);

    if (diff < 24) {
      const remaining = (24 - diff).toFixed(2);
      return res.json({
        locked: true,
        remaining,
      });
    }

    res.json({ locked: false });
  } catch (err) {
    console.error("COMMISSION STATUS ERROR:", err);
    res.status(500).json({ error: "Failed to check status" });
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
        ? "Auto trade enabled. Your commission will add in Strategy Allocation Balance."
        : "Auto trade disabled."
    });

  } catch (err) {
    console.error("AUTO TRADE TOGGLE ERROR:", err);
    res.status(500).json({ error: "Failed to toggle auto trade" });
  }
});

module.exports = router;