const express = require("express");
const router = express.Router();
const pool = require("../db/db");

const multer = require("multer");

const upload = multer({
  storage: multer.memoryStorage(),
});

router.get("/details/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const userResult = await pool.query(
      `SELECT wallet_amount, kyc_verify
FROM users
WHERE id = $1`,
      [userId]
    );

    const subscriptionResult = await pool.query(
      `SELECT *
       FROM premium_subscriptions
       WHERE user_id = $1`,
      [userId]
    );

    const faqResult = await pool.query(`
      SELECT id, question, answer
      FROM premium_faqs
      ORDER BY id DESC
    `);

    res.json({
      success: true,
      wallet_amount: userResult.rows[0]?.wallet_amount || 0,
      kyc_verify: userResult.rows[0]?.kyc_verify || false,
      subscription: subscriptionResult.rows[0] || null,
      faqs: faqResult.rows,
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

router.post(
  "/banner/upload",
  upload.single("banner"),
  async (req, res) => {
    try {
      const imageBuffer = req.file.buffer;
      await pool.query(
        `
        INSERT INTO premium_banner(image)
        VALUES($1)
        `,
        [imageBuffer]
      );
      res.json({
        success: true,
      });
    } catch (err) {
      console.log(err);
      res.status(500).json({
        success: false,
      });
    }
  }
);

router.post("/subscribe", async (req, res) => {
  const client = await pool.connect();

  try {
    const { userId, auto_renew } = req.body;

    await client.query("BEGIN");

    const user = await client.query(
      `
      SELECT wallet_amount, kyc_verify
      FROM users
      WHERE id = $1
      FOR UPDATE
      `,
      [userId]
    );

    if (!user.rows.length) {
      throw new Error("User not found");
    }

    if (!user.rows[0].kyc_verify) {
      await client.query("ROLLBACK");
      return res.json({
        success: false,
        message: "Complete KYC verification first",
      });
    }

    const wallet = Number(user.rows[0].wallet_amount);

    if (wallet < 5) {
      await client.query("ROLLBACK");
      return res.json({
        success: false,
        message: "Insufficient balance",
      });
    }

    const newBalance = wallet - 5;

    await client.query(
      `
      UPDATE users
      SET wallet_amount = $1
      WHERE id = $2
      `,
      [newBalance, userId]
    );

    // Insert or update subscription
    await client.query(
      `
      INSERT INTO premium_subscriptions (
        user_id,
        is_premium,
        auto_renew,
        badge_enabled,
        subscribed_at,
        expires_at,
        next_billing_date,
        last_payment_amount,
        last_payment_date
      )
      VALUES (
        $1,
        true,
        $2,
        true,
        NOW(),
        NOW() + INTERVAL '30 days',
        NOW() + INTERVAL '30 days',
        5,
        NOW()
      )
      ON CONFLICT (user_id)
      DO UPDATE SET
        is_premium = true,
        auto_renew = $2,
        badge_enabled = true,
        subscribed_at = NOW(),
        expires_at = NOW() + INTERVAL '30 days',
        next_billing_date = NOW() + INTERVAL '30 days',
        last_payment_amount = 5,
        last_payment_date = NOW(),
        updated_at = NOW()
      `,
      [userId, auto_renew]
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      message: "Blue Tick activated successfully",
      wallet_amount: newBalance,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Subscription failed",
    });
  } finally {
    client.release();
  }
});

// Updated deduction history route - fetches from premium_subscriptions
router.get("/deduction-history/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    // Get payment history from premium_subscriptions table
    const result = await pool.query(
      `
      SELECT 
        id,
        last_payment_amount as amount,
        last_payment_date as date,
        'success' as status,
        CASE 
          WHEN last_payment_amount = 5 THEN 'Blue Tick Subscription - Monthly Fee'
          ELSE 'Blue Tick Subscription Payment'
        END as description
      FROM premium_subscriptions
      WHERE user_id = $1 AND last_payment_date IS NOT NULL
      ORDER BY last_payment_date DESC
      `,
      [userId]
    );

    // If no payments found, return empty array
    if (result.rows.length === 0) {
      return res.json({
        success: true,
        history: [],
      });
    }

    res.json({
      success: true,
      history: result.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch history",
    });
  }
});

/*
CANCEL
*/
router.post("/cancel", async (req, res) => {
  try {
    const { userId } = req.body;

    await pool.query(
      `
      UPDATE premium_subscriptions
      SET
        auto_renew = false,
        updated_at = NOW()
      WHERE user_id = $1
      `,
      [userId]
    );

    res.json({
      success: true,
      message: "Subscription cancelled",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Failed to cancel subscription",
    });
  }
});

router.get("/premium-subscriptions", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        p.*,
        u.name,
        u.email,
        u.phone,
        u.wallet_amount
      FROM premium_subscriptions p
      JOIN users u ON u.id = p.user_id
      ORDER BY p.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/faqs", async (req, res) => {
  try {
    const { question, answer } = req.body;
    const result = await pool.query(
      `
      INSERT INTO premium_faqs(question, answer)
      VALUES($1, $2)
      RETURNING *
      `,
      [question, answer]
    );
    res.json({
      success: true,
      faq: result.rows[0],
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({
      success: false,
      message: "Failed to create FAQ",
    });
  }
});

router.put("/faqs/:id", async (req, res) => {
  try {
    const { question, answer } = req.body;
    const result = await pool.query(
      `
      UPDATE premium_faqs
      SET question = $1,
          answer = $2
      WHERE id = $3
      RETURNING *
      `,
      [question, answer, req.params.id]
    );
    res.json({
      success: true,
      faq: result.rows[0],
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({
      success: false,
    });
  }
});

router.delete("/faqs/:id", async (req, res) => {
  try {
    await pool.query(
      `
      DELETE FROM premium_faqs
      WHERE id = $1
      `,
      [req.params.id]
    );
    res.json({
      success: true,
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({
      success: false,
    });
  }
});

router.get("/faqs", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM premium_faqs
      ORDER BY id DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/banner", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT image
      FROM premium_banner
      ORDER BY id DESC
      LIMIT 1
    `);
    if (!result.rows.length) {
      return res.status(404).send("Banner not found");
    }
    const imageBuffer = result.rows[0].image;
    res.setHeader("Content-Type", "image/jpeg");
    res.send(imageBuffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

router.get("/banner/image/:id", async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT image
      FROM premium_banner
      WHERE id = $1
      `,
      [req.params.id]
    );
    if (!result.rows.length) {
      return res.status(404).send("Not found");
    }
    res.set("Content-Type", "image/jpeg");
    res.send(result.rows[0].image);
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});

router.post("/process-subscriptions", async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query("BEGIN");

        const control = await client.query(
      `
      SELECT last_run
      FROM subscription_process_control
      WHERE id = 1
      `
    );

    const lastRun = control.rows[0]?.last_run;

    if (lastRun) {
      const hoursPassed =
        (Date.now() - new Date(lastRun).getTime()) /
        (1000 * 60 * 60);

      if (hoursPassed < 24) {
        await client.query("ROLLBACK");

        return res.status(400).json({
          success: false,
          locked: true,
          remaining: Math.ceil(24 - hoursPassed),
          message: `Already processed. Try again after ${Math.ceil(
            24 - hoursPassed
          )} hour(s)`
        });
      }
    }
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Get all active premium subscriptions
    const subscriptions = await client.query(
      `
      SELECT 
        ps.*,
        u.wallet_amount,
        u.id as user_id,
        u.name,
        u.email
      FROM premium_subscriptions ps
      JOIN users u ON u.id = ps.user_id
      WHERE ps.is_premium = true
      `,
      []
    );
    
    const results = {
      processed: 0,
      renewed: 0,
      failed: 0,
      expired: 0,
      notifications: 0,
      details: []
    };
    
    for (const sub of subscriptions.rows) {
      const expiryDate = new Date(sub.expires_at);
      expiryDate.setHours(0, 0, 0, 0);
      
      const daysUntilExpiry = Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24));
      const isExpiryToday = daysUntilExpiry === 0;
      const isExpired = daysUntilExpiry < 0;
      const isNearExpiry = daysUntilExpiry > 0 && daysUntilExpiry <= 3;
      
      // Skip if already expired
      if (isExpired) {
        // Already expired, just ensure it's marked as inactive
        if (sub.is_premium === true) {
          await client.query(
            `
            UPDATE premium_subscriptions
            SET 
              badge_enabled = false,
              is_premium = false,
              updated_at = NOW()
            WHERE user_id = $1
            `,
            [sub.user_id]
          );
          
          results.expired++;
          results.details.push({
            user_id: sub.user_id,
            action: 'expired',
            message: 'Subscription already expired - marked inactive'
          });
        }
        continue;
      }
      
      // 1. Send reminder notifications for subscriptions expiring in 1-3 days
      if (isNearExpiry && !isExpiryToday) {
        const notificationTitle = `Blue Tick Expires in ${daysUntilExpiry} Day${daysUntilExpiry > 1 ? 's' : ''}`;
        const notificationMessage = `Your Blue Tick verification will expire in ${daysUntilExpiry} day${daysUntilExpiry > 1 ? 's' : ''}. ${
          sub.auto_renew ? 'Auto-renewal is enabled. Please ensure sufficient balance ($5) in your wallet.' : 'Auto-renewal is disabled. Please renew manually to continue enjoying Blue Tick benefits.'
        }`;
        
        await client.query(
          `
          INSERT INTO notifications (title, message, target_type, target_users, created_at)
          VALUES ($1, $2, 'custom', $3, NOW())
          `,
          [notificationTitle, notificationMessage, String(sub.user_id)]
        );
        
        results.notifications++;
        results.details.push({
          user_id: sub.user_id,
          action: 'reminder_sent',
          days_until_expiry: daysUntilExpiry,
          auto_renew: sub.auto_renew,
          message: `Reminder sent for expiry in ${daysUntilExpiry} days`
        });
      }
      
      // 2. Process expiry today - ONLY extend if auto_renew = true AND balance sufficient
      if (isExpiryToday) {
        console.log(`Processing subscription for user ${sub.user_id}, auto_renew: ${sub.auto_renew}, balance: ${sub.wallet_amount}`);
        
        if (sub.auto_renew === true) {
          // Auto-renewal enabled - try to deduct balance
          const walletBalance = Number(sub.wallet_amount || 0);
          
          if (walletBalance >= 5) {
            // ✅ SUFFICIENT BALANCE - Process renewal (EXTEND DATE)
            const newBalance = walletBalance - 5;
            
            // Update user wallet
            await client.query(
              `
              UPDATE users 
              SET wallet_amount = $1 
              WHERE id = $2
              `,
              [newBalance, sub.user_id]
            );
            
            // Update subscription - EXTEND by 30 days (ONLY HERE!)
            await client.query(
              `
              UPDATE premium_subscriptions
              SET 
                expires_at = NOW() + INTERVAL '30 days',
                next_billing_date = NOW() + INTERVAL '30 days',
                last_payment_amount = 5,
                last_payment_date = NOW(),
                badge_enabled = true,
                is_premium = true,
                updated_at = NOW()
              WHERE user_id = $1
              `,
              [sub.user_id]
            );
            
            const newExpiryDate = new Date();
            newExpiryDate.setDate(newExpiryDate.getDate() + 30);
            
            // Create notification for successful renewal
            await client.query(
              `
              INSERT INTO notifications (title, message, target_type, target_users, created_at)
              VALUES ($1, $2, 'custom', $3, NOW())
              `,
              [
                '✅ Blue Tick Auto-Renewed Successfully',
                `Your Blue Tick has been automatically renewed for another 30 days. $5 has been deducted from your wallet. New expiry date: ${newExpiryDate.toLocaleDateString()}`,
                String(sub.user_id)
              ]
            );
            
            results.renewed++;
            results.details.push({
              user_id: sub.user_id,
              action: 'auto_renewed',
              amount_deducted: 5,
              old_balance: walletBalance,
              new_balance: newBalance,
              new_expiry_date: newExpiryDate.toISOString(),
              message: 'Auto-renewal successful - Subscription extended by 30 days'
            });
            
            console.log(`✅ Auto-renewed user ${sub.user_id}, new balance: ${newBalance}`);
          } else {
            // ❌ INSUFFICIENT BALANCE - Do NOT extend date, just expire
            await client.query(
              `
              UPDATE premium_subscriptions
              SET 
                auto_renew = false,
                badge_enabled = false,
                is_premium = false,
                updated_at = NOW()
              WHERE user_id = $1
              `,
              [sub.user_id]
            );
            
            // Create notification for failed renewal
            await client.query(
              `
              INSERT INTO notifications (title, message, target_type, target_users, created_at)
              VALUES ($1, $2, 'custom', $3, NOW())
              `,
              [
                '❌ Blue Tick Renewal Failed - Insufficient Balance',
                `Your Blue Tick auto-renewal failed due to insufficient balance ($${walletBalance}). No amount was deducted and your subscription has expired. Please add $5 or more to your wallet and reactivate your Blue Tick subscription.`,
                String(sub.user_id)
              ]
            );
            
            results.failed++;
            results.details.push({
              user_id: sub.user_id,
              action: 'renewal_failed',
              wallet_balance: walletBalance,
              required_amount: 5,
              message: 'Insufficient balance - No deduction made, subscription expired (date NOT extended)'
            });
            
            console.log(`❌ Auto-renewal failed for user ${sub.user_id}, balance: ${walletBalance} - Expired, date unchanged`);
          }
        } else {
          // ❌ AUTO-RENEW DISABLED - Do NOT extend date, just expire
          await client.query(
            `
            UPDATE premium_subscriptions
            SET 
              badge_enabled = false,
              is_premium = false,
              updated_at = NOW()
            WHERE user_id = $1
            `,
            [sub.user_id]
          );
          
          // Create notification for expiry
          await client.query(
            `
            INSERT INTO notifications (title, message, target_type, target_users, created_at)
            VALUES ($1, $2, 'custom', $3, NOW())
            `,
            [
              '⚠️ Blue Tick Expired',
              `Your Blue Tick verification has expired on ${expiryDate.toLocaleDateString()}. Auto-renewal was disabled, so no amount was deducted. To renew, please go to the Blue Tick section and subscribe again.`,
              String(sub.user_id)
            ]
          );
          
          results.expired++;
          results.details.push({
            user_id: sub.user_id,
            action: 'expired',
            auto_renew: false,
            expiry_date: expiryDate.toISOString(),
            message: 'Subscription expired (auto-renew disabled) - Date NOT changed, no deduction made'
          });
          
          console.log(`⚠️ Subscription expired for user ${sub.user_id} (auto-renew disabled) - Date unchanged`);
        }
      }
      
      results.processed++;
    }

        await client.query(
      `
      UPDATE subscription_process_control
      SET last_run = NOW()
      WHERE id = 1
      `
    );
    
    await client.query("COMMIT");
    
    res.json({
      success: true,
      message: "Premium subscriptions processed successfully",
      timestamp: new Date().toISOString(),
      summary: {
        total_processed: results.processed,
        auto_renewed: results.renewed,
        renewal_failed: results.failed,
        expired: results.expired,
        reminders_sent: results.notifications
      },
      details: results.details
    });
    
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error processing subscriptions:", err);
    res.status(500).json({
      success: false,
      message: "Failed to process subscriptions",
      error: err.message
    });
  } finally {
    client.release();
  }
});

/*
PROFILE BADGES
*/
router.get("/profile-badges/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const result = await pool.query(
      `
      SELECT
        u.kyc_verify,
        COALESCE(ps.badge_enabled, false) AS badge_enabled,
        COALESCE(ps.is_premium, false) AS is_premium
      FROM users u
      LEFT JOIN premium_subscriptions ps
        ON ps.user_id = u.id
      WHERE u.id = $1
      `,
      [userId]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.json({
      success: true,
      kyc_verify: result.rows[0].kyc_verify,
      badge_enabled: result.rows[0].badge_enabled,
      is_premium: result.rows[0].is_premium,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

router.get("/process-subscriptions-status", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT last_run
       FROM subscription_process_control
       WHERE id = 1`
    );

    const lastRun = result.rows[0]?.last_run;

    if (!lastRun) {
      return res.json({
        locked: false,
      });
    }

    const unlockTime =
      new Date(lastRun).getTime() + 24 * 60 * 60 * 1000;

    const remaining = unlockTime - Date.now();

    if (remaining > 0) {
      return res.json({
        locked: true,
        unlockTime,
      });
    }

    return res.json({
      locked: false,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      locked: false,
    });
  }
});

/*
GET NOTIFICATIONS FOR A USER
*/
router.get("/notifications/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    
    const notifications = await pool.query(
      `
      SELECT * FROM notifications
      WHERE target_type = 'all' 
      OR (target_type = 'custom' AND target_users LIKE $1)
      ORDER BY created_at DESC
      LIMIT 50
      `,
      [`%${userId}%`]
    );
    
    res.json({
      success: true,
      notifications: notifications.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch notifications"
    });
  }
});

/*
GET ALL NOTIFICATIONS (Admin)
*/
router.get("/notifications", async (req, res) => {
  try {
    const notifications = await pool.query(
      `
      SELECT n.*, 
        COUNT(CASE WHEN u.id IS NOT NULL THEN 1 END) as user_count
      FROM notifications n
      LEFT JOIN users u ON n.target_type = 'all' OR (n.target_type = 'custom' AND n.target_users LIKE '%' || u.id || '%')
      GROUP BY n.id
      ORDER BY n.created_at DESC
      `
    );
    
    res.json({
      success: true,
      notifications: notifications.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch notifications"
    });
  }
});

/*
CREATE NOTIFICATION (Admin)
*/
router.post("/notifications", async (req, res) => {
  try {
    const { title, message, target_type, target_users, main_wallet_balance, trading_wallet_balance } = req.body;
    
    const result = await pool.query(
      `
      INSERT INTO notifications (title, message, target_type, target_users, main_wallet_balance, trading_wallet_balance)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
      `,
      [title, message, target_type, target_users || null, main_wallet_balance || null, trading_wallet_balance || null]
    );
    
    res.json({
      success: true,
      notification: result.rows[0]
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Failed to create notification"
    });
  }
});

/*
DELETE NOTIFICATION (Admin)
*/
router.delete("/notifications/:id", async (req, res) => {
  try {
    await pool.query(
      `
      DELETE FROM notifications WHERE id = $1
      `,
      [req.params.id]
    );
    
    res.json({
      success: true,
      message: "Notification deleted successfully"
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Failed to delete notification"
    });
  }
});
/*
AUTO RENEW
*/
router.post("/auto-renew", async (req, res) => {
  try {
    const { userId, auto_renew } = req.body;
    await pool.query(
      `
      UPDATE premium_subscriptions
      SET
        auto_renew = $1,
        updated_at = NOW()
      WHERE user_id = $2
      `,
      [auto_renew, userId]
    );
    res.json({
      success: true,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
    });
  }
});

module.exports = router;