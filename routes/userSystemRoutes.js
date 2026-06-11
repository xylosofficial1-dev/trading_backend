// backend/routes/userSystemRoutes.js
const express = require("express");
const router = express.Router();
const pool = require("../db/db");

function getCommissionRate(referralCount) {
  const base = 1.6;
  const increment = 0.05;
  return base + referralCount * increment;
}

const precise = (num) => Number(num.toString());

const multiply = (a, b) => precise(a * b);

const divide = (a, b) => precise(a / b);

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

      if (diffHours < 16) {
        const remaining = (16 - diffHours).toFixed(2);
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
  u.commission_enabled,
  u.wallet_amount,
  u.trading_wallet_amount,
  COUNT(r.id) AS referrals
FROM users u
LEFT JOIN users r
  ON r.parent_id = u.id
  AND r.status = 'ok'
WHERE
  u.status = 'ok'
  AND u.commission_enabled = TRUE
GROUP BY u.id;
    `);

    const commissionRate = 1.6;
    const commissionHistoryRecords = [];

    for (const user of users.rows) {
      if (!user.commission_enabled) {
  console.log(`Skipping user ${user.id} - commission disabled`);
  continue;
}

console.log(`Processing user ${user.id} - commission enabled`);

const baseAmount = parseFloat(user.trading_wallet_amount);
      const isEligibleForSelf = baseAmount >= 100;

      if (!isEligibleForSelf) continue;

      const commissionAmount = (baseAmount * commissionRate) / 100;
      
      let beforeBalance, afterBalance, walletType;

      /* ===============================
         ✅ 1. SELF COMMISSION
      =============================== */
      if (user.auto_trade) {
        // Get before balance
        const beforeResult = await client.query(
          `SELECT trading_wallet_amount FROM users WHERE id = $1`,
          [user.id]
        );
        beforeBalance = parseFloat(beforeResult.rows[0].trading_wallet_amount);
        
        // Update trading wallet
        const update = await client.query(
          `UPDATE users 
           SET trading_wallet_amount = trading_wallet_amount + $1
           WHERE id = $2
           RETURNING trading_wallet_amount`,
          [commissionAmount, user.id]
        );
        
        afterBalance = parseFloat(update.rows[0].trading_wallet_amount);
        walletType = 'trading_wallet';
        
        // Add to history records with commission_source = 'self'
        commissionHistoryRecords.push({
          user_id: user.id,
          commission_percent: commissionRate,
          commission_amount: commissionAmount,
          wallet_type: walletType,
          before_balance: beforeBalance,
          after_balance: afterBalance,
          commission_source: 'self'
        });

        // Notification
        await client.query(
          `INSERT INTO notifications 
           (title, message, target_type, target_users, trading_wallet_balance)
           VALUES ($1, $2, 'custom', $3, $4)`,
          [
            "Commission Added",
            `$${commissionAmount.toFixed(2)} added to Strategy Allocation Balance (${commissionRate}%)`,
            String(user.id),
            afterBalance
          ]
        );
      } else {
        // Get before balance
        const beforeResult = await client.query(
          `SELECT wallet_amount FROM users WHERE id = $1`,
          [user.id]
        );
        beforeBalance = parseFloat(beforeResult.rows[0].wallet_amount);
        
        // Update main wallet
        const update = await client.query(
          `UPDATE users 
           SET wallet_amount = wallet_amount + $1
           WHERE id = $2
           RETURNING wallet_amount`,
          [commissionAmount, user.id]
        );
        
        afterBalance = parseFloat(update.rows[0].wallet_amount);
        walletType = 'main_wallet';
        
        // Add to history records with commission_source = 'self'
        commissionHistoryRecords.push({
          user_id: user.id,
          commission_percent: commissionRate,
          commission_amount: commissionAmount,
          wallet_type: walletType,
          before_balance: beforeBalance,
          after_balance: afterBalance,
          commission_source: 'self'
        });

        // Notification
        await client.query(
          `INSERT INTO notifications 
           (title, message, target_type, target_users, main_wallet_balance)
           VALUES ($1, $2, 'custom', $3, $4)`,
          [
            "Commission Added",
            `$${commissionAmount.toFixed(2)} added to Primary Credit Balance (${commissionRate}%)`,
            String(user.id),
            afterBalance
          ]
        );
      }

      /* ===============================
         🔗 2. REFERRAL LEVEL COMMISSIONS (Only for auto_trade users)
      =============================== */
      if (user.auto_trade && commissionAmount > 0) {
        const levels = [
          { percent: 5, name: "Level 1" },
          { percent: 2.5, name: "Level 2" },
          { percent: 1.25, name: "Level 3" },
          { percent: 0.75, name: "Level 4" },
          { percent: 0.37, name: "Level 5" },
        ];

        let currentUserId = user.id;
        const visited = new Set();

        for (let i = 0; i < levels.length; i++) {
          if (visited.has(currentUserId)) break;
          visited.add(currentUserId);

          const parentResult = await client.query(
            `SELECT parent_id FROM users WHERE id = $1`,
            [currentUserId]
          );

          if (!parentResult.rowCount || !parentResult.rows[0].parent_id) break;

          const parentId = parentResult.rows[0].parent_id;

          const parentInfo = await client.query(
            `SELECT id, wallet_amount FROM users WHERE id = $1 AND status = 'ok'`,
            [parentId]
          );

          if (!parentInfo.rowCount) {
            currentUserId = parentId;
            continue;
          }

          const parent = parentInfo.rows[0];
          const reward = (commissionAmount * levels[i].percent) / 100;

          if (reward <= 0) {
            currentUserId = parent.id;
            continue;
          }

          // Get before balance
          const beforeResult = await client.query(
            `SELECT wallet_amount FROM users WHERE id = $1`,
            [parent.id]
          );
          const beforeBalanceReferral = parseFloat(beforeResult.rows[0].wallet_amount);
          
          // Update parent's main wallet (referral commissions always go to main wallet)
          const updateParent = await client.query(
            `UPDATE users 
             SET wallet_amount = wallet_amount + $1
             WHERE id = $2
             RETURNING wallet_amount`,
            [reward, parent.id]
          );
          
          const afterBalanceReferral = parseFloat(updateParent.rows[0].wallet_amount);
          

          // Notification for referral commission
          await client.query(
            `INSERT INTO notifications 
             (title, message, target_type, target_users, main_wallet_balance)
             VALUES ($1, $2, 'custom', $3, $4)`,
            [
              "Referral Commission",
              `You earned $${reward.toFixed(2)} from ${levels[i].name} referral (${levels[i].percent}%)`,
              String(parent.id),
              afterBalanceReferral
            ]
          );

          currentUserId = parent.id;
        }
      }
    }

    /* ===============================
       📝 INSERT ALL COMMISSION HISTORY (UPDATED WITH commission_source)
    =============================== */
    if (commissionHistoryRecords.length > 0) {
      const historyQuery = `
        INSERT INTO commission_history 
        (user_id, commission_percent, commission_amount, wallet_type, before_balance, after_balance, commission_source, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      `;
      
      for (const record of commissionHistoryRecords) {
        await client.query(historyQuery, [
          record.user_id,
          record.commission_percent,
          record.commission_amount,
          record.wallet_type,
          record.before_balance,
          record.after_balance,
          record.commission_source
        ]);
      }
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
      users_processed: users.rowCount,
      commission_records: commissionHistoryRecords.length
    });

  } catch (err) {
  await client.query("ROLLBACK");

  console.error("COMMISSION ERROR FULL:", err);

  return res.status(500).json({
    success: false,
    message: err.message,
    detail: err.detail,
    hint: err.hint,
    code: err.code,
    stack: err.stack
  });
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
      LEFT JOIN users r ON r.parent_id = u.id AND r.status = 'ok'
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
    const baseAmount = parseFloat(user.trading_wallet_amount);

    if (baseAmount < 100) {
      return res.json({ 
        success: false, 
        message: "Minimum 100 required in trading wallet for commission" 
      });
    }

    const commissionAmount = (baseAmount * commissionRate) / 100;
    
    let beforeBalance, afterBalance, walletType;

    if (user.auto_trade) {
      // Get before balance
      const beforeResult = await client.query(
        `SELECT trading_wallet_amount FROM users WHERE id = $1`,
        [id]
      );
      beforeBalance = parseFloat(beforeResult.rows[0].trading_wallet_amount);
      
      // Update trading wallet
      const update = await client.query(
        `UPDATE users 
         SET trading_wallet_amount = trading_wallet_amount + $1
         WHERE id = $2
         RETURNING trading_wallet_amount`,
        [commissionAmount, id]
      );
      
      afterBalance = parseFloat(update.rows[0].trading_wallet_amount);
      walletType = 'trading_wallet';
      
      // Insert commission history with commission_source = 'self'
      await client.query(
        `INSERT INTO commission_history 
         (user_id, commission_percent, commission_amount, wallet_type, before_balance, after_balance, commission_source, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
        [id, commissionRate, commissionAmount, walletType, beforeBalance, afterBalance, 'self']
      );
      
      // Notification
      await client.query(
        `INSERT INTO notifications 
         (title, message, target_type, target_users, trading_wallet_balance)
         VALUES ($1, $2, 'custom', $3, $4)`,
        [
          "Commission Added",
          `$${commissionAmount.toFixed(2)} added to Strategy Allocation Balance (${commissionRate.toFixed(2)}%)`,
          String(id),
          afterBalance
        ]
      );
    } else {
      // Get before balance
      const beforeResult = await client.query(
        `SELECT wallet_amount FROM users WHERE id = $1`,
        [id]
      );
      beforeBalance = parseFloat(beforeResult.rows[0].wallet_amount);
      
      // Update main wallet
      const update = await client.query(
        `UPDATE users 
         SET wallet_amount = wallet_amount + $1
         WHERE id = $2
         RETURNING wallet_amount`,
        [commissionAmount, id]
      );
      
      afterBalance = parseFloat(update.rows[0].wallet_amount);
      walletType = 'main_wallet';
      
      // Insert commission history with commission_source = 'self'
      await client.query(
        `INSERT INTO commission_history 
         (user_id, commission_percent, commission_amount, wallet_type, before_balance, after_balance, commission_source, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
        [id, commissionRate, commissionAmount, walletType, beforeBalance, afterBalance, 'self']
      );
      
      // Notification
      await client.query(
        `INSERT INTO notifications 
         (title, message, target_type, target_users, main_wallet_balance)
         VALUES ($1, $2, 'custom', $3, $4)`,
        [
          "Commission Added",
          `$${commissionAmount.toFixed(2)} added to Primary Credit Balance (${commissionRate.toFixed(2)}%)`,
          String(id),
          afterBalance
        ]
      );
    }

    await client.query("COMMIT");

    res.json({
      success: true,
      commission: commissionAmount,
      rate: commissionRate,
      wallet_type: walletType,
      before_balance: beforeBalance,
      after_balance: afterBalance
    });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("APPLY COMMISSION ERROR:", err);
    res.status(500).json({ error: "Failed to apply commission" });
  } finally {
    client.release();
  }
});

/* =========================================================
   GET COMMISSION HISTORY FOR USER
   GET /api/system/commission-history/:userId
   ========================================================= */
router.get("/commission-history/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const history = await pool.query(
      `
      SELECT
        id,
        commission_percent,
        commission_amount,
        wallet_type,
        before_balance,
        after_balance,
        commission_source,
        created_at
      FROM commission_history
      WHERE user_id = $1
      ORDER BY created_at DESC
      `,
      [userId]
    );

    res.json({
      success: true,
      history: history.rows,
    });

  } catch (err) {
    console.log(err);

    res.status(500).json({
      success: false,
      error: "Server error",
    });
  }
});

/* =========================================================
   GET COMMISSION HISTORY FOR SPECIFIC USER
   GET /api/system/commission-history/user/:userId
   ========================================================= */
router.get("/commission-history/user/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const result = await pool.query(
      `
      SELECT 
        id,
        commission_percent,
        commission_amount,
        wallet_type,
        before_balance,
        after_balance,
        commission_source,
        created_at
      FROM commission_history
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 500
      `,
      [userId]
    );

    res.json({
      success: true,
      count: result.rowCount,
      history: result.rows
    });

  } catch (err) {
    console.error("USER COMMISSION HISTORY ERROR:", err);
    res.status(500).json({ error: "Failed to fetch user commission history" });
  }
});

/* =========================================
   CHECK COMMISSION LOCK
   GET /api/system/commission-status
========================================= */
// router.get("/commission-status", async (req, res) => {
//   try {
//     const result = await pool.query(
//       `SELECT last_run FROM commission_runs ORDER BY id DESC LIMIT 1`
//     );

//     if (!result.rowCount) {
//       return res.json({ locked: false });
//     }

//     const lastRun = new Date(result.rows[0].last_run);
//     const now = new Date();

//     const diff = (now - lastRun) / (1000 * 60 * 60);

//     if (diff < 16) {
//       const remaining = (16 - diff).toFixed(2);
//       return res.json({
//         locked: true,
//         remaining,
//       });
//     }

//     res.json({ locked: false });
//   } catch (err) {
//     console.error("COMMISSION STATUS ERROR:", err);
//     res.status(500).json({ error: "Failed to check status" });
//   }
// });

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

    if (diff < 16) {
      return res.json({
        locked: true,
        remaining: (16 - diff).toFixed(2),
      });
    }

    return res.json({ locked: false });

  } catch (err) {
    console.error("COMMISSION STATUS ERROR FULL:", err);

    return res.status(500).json({
      message: err.message,
      detail: err.detail,
      code: err.code
    });
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
   GET ALL COMMISSION HISTORY (ADMIN)
   GET /api/system/commission-history/all
   ========================================================= */
router.get("/commission-history/all", async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT 
        ch.id,
        ch.user_id,
        u.name as user_name,
        u.email as user_email,
        ch.commission_percent,
        ch.commission_amount,
        ch.wallet_type,
        ch.before_balance,
        ch.after_balance,
        ch.commission_source,
        ch.created_at
      FROM commission_history ch
      JOIN users u ON u.id = ch.user_id
      ORDER BY ch.created_at DESC
      LIMIT 1000
      `
    );

    res.json({
      success: true,
      count: result.rowCount,
      history: result.rows
    });

  } catch (err) {
    console.error("ALL COMMISSION HISTORY ERROR:", err);
    res.status(500).json({ error: "Failed to fetch commission history" });
  }
});

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

router.post("/maintenance/toggle", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT maintenance FROM system_settings LIMIT 1"
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ message: "No settings found" });
    }

    const current = result.rows[0].maintenance;
    const newValue = !current;

    await pool.query(
      "UPDATE system_settings SET maintenance = $1",
      [newValue]
    );

    res.json({
      success: true,
      maintenance: newValue,
    });
  } catch (err) {
    console.error("TOGGLE ERROR:", err);
    res.status(500).json({ message: "Toggle failed" });
  }
});

router.get("/maintenance", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT maintenance FROM system_settings LIMIT 1"
    );

    res.json({
      maintenance: result.rows[0].maintenance,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;