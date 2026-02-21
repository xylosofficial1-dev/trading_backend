const pool = require("../db/db");

async function runCommissionJob() {
  const users = await pool.query(`
    SELECT c.user_id, c.started_at, c.last_paid_at,
           u.trading_wallet_amount, u.auto_trade
    FROM trade_commission_cycles c
    JOIN users u ON u.id = c.user_id
  `);

  for (const u of users.rows) {
    const last = u.last_paid_at || u.started_at;
    const hours = (Date.now() - new Date(last)) / (1000 * 60 * 60);

    if (hours < 24) continue;
    if (Number(u.trading_wallet_amount) < 100) continue;

    // referral count
    const ref = await pool.query(
      `SELECT COUNT(*) FROM users WHERE parent_id = $1`,
      [u.user_id]
    );

    const totalRef = Number(ref.rows[0].count);

    let percent = 1.6 + totalRef * 0.05;
    const commission = (u.trading_wallet_amount * percent) / 100;

    if (u.auto_trade) {
      await pool.query(`
        UPDATE users
        SET trading_wallet_amount = trading_wallet_amount + $1
        WHERE id = $2
      `, [commission, u.user_id]);
    } else {
      await pool.query(`
        UPDATE users
        SET wallet_amount = wallet_amount + $1
        WHERE id = $2
      `, [commission, u.user_id]);
    }

    await pool.query(`
      INSERT INTO notifications (title, message, target_type, target_users)
      VALUES ('Daily Trade Commission',
              $1,
              'custom',
              $2)
    `, [
      `You received ${percent.toFixed(2)}% commission = ₹${commission.toFixed(2)}`,
      String(u.user_id)
    ]);

    await pool.query(`
      UPDATE trade_commission_cycles
      SET last_paid_at = NOW()
      WHERE user_id = $1
    `, [u.user_id]);

    console.log("💰 Commission paid to", u.user_id);
  }
}

setInterval(runCommissionJob, 60 * 1000);