const express = require("express");
const router = express.Router();
const pool = require("../db/db");
const cron = require("node-cron");

/* % based on referrals */
function getCommissionRate(ref) {
  if (ref >= 2) return 1.7;
  if (ref === 1) return 1.65;
  return 1.6;
}

/* Notification */
async function notify(userId, amount) {
  await pool.query(
    `INSERT INTO notifications(title,message,target_type,target_users)
     VALUES ($1,$2,'custom',$3)`,
    [
      "Daily Commission",
      `₹${amount.toFixed(2)} commission credited`,
      String(userId),
    ]
  );
}

/*
=====================================================
MAIN ENGINE (EVERY MINUTE CHECK)
=====================================================
*/
cron.schedule("* * * * *", async () => {
  try {
    const users = await pool.query(`
      SELECT id, trade_wallet, auto_trade, next_commission_at
      FROM users
      WHERE next_commission_at IS NOT NULL
      AND next_commission_at <= NOW()
    `);

    for (const user of users.rows) {
      if (Number(user.trade_wallet) < 100) continue;

      // count referrals
      const ref = await pool.query(
        `SELECT COUNT(*) FROM users WHERE parent_id=$1`,
        [user.id]
      );

      const percent = getCommissionRate(Number(ref.rows[0].count));
      const commission = (Number(user.trade_wallet) * percent) / 100;

      if (user.auto_trade) {
        await pool.query(
          `UPDATE users SET trade_wallet = trade_wallet + $1 WHERE id=$2`,
          [commission, user.id]
        );
      } else {
        await pool.query(
          `UPDATE users SET main_wallet = main_wallet + $1 WHERE id=$2`,
          [commission, user.id]
        );
      }

      // save history
      await pool.query(
        `INSERT INTO wallet_transactions(user_id,amount,type,description)
         VALUES ($1,$2,'commission','24h trade commission')`,
        [user.id, commission]
      );

      await notify(user.id, commission);

      // set next cycle
      await pool.query(
        `UPDATE users
         SET next_commission_at = next_commission_at + INTERVAL '24 hours'
         WHERE id=$1`,
        [user.id]
      );

      console.log(`Commission given to user ${user.id}`);
    }
  } catch (err) {
    console.error("Commission engine error", err);
  }
});

module.exports = router;