// backend/routes/trades.js
const express = require("express");
const router = express.Router();
const pool = require("../db/db");

router.post("/buy", async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const {
      user_id,
      name,
      email,
      coin,
      price,
      quantity,
      total
    } = req.body;

    // 1️⃣ Lock user row & check balance
    const balanceRes = await client.query(
      `SELECT trading_wallet_amount 
       FROM users 
       WHERE id=$1 
       FOR UPDATE`,
      [user_id]
    );

    if (balanceRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "User not found" });
    }

    const currentBalance = Number(balanceRes.rows[0].trading_wallet_amount);

    // 2️⃣ Prevent insufficient balance
    if (currentBalance < total) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Insufficient trading balance" });
    }

    // 3️⃣ Deduct from trading wallet
    await client.query(
      `UPDATE users
       SET trading_wallet_amount = trading_wallet_amount - $1
       WHERE id=$2`,
      [total, user_id]
    );

    // 4️⃣ Insert trade
    await client.query(
      `INSERT INTO trades
       (user_id,name,email,coin,trade_type,price,quantity,total,status)
       VALUES($1,$2,$3,$4,'buy',$5,$6,$7,'open')`,
      [user_id, name, email, coin, price, quantity, total]
    );

    await client.query("COMMIT");

    res.json({ success: true });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Buy failed" });
  } finally {
    client.release();
  }
});

router.post("/close/:id", async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const tradeId = req.params.id;
    const { user_id, live_price } = req.body;

    const tradeRes = await client.query(
      `SELECT * FROM trades
       WHERE id=$1 AND user_id=$2 AND status='open'`,
      [tradeId, user_id]
    );

    if (tradeRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Trade not found" });
    }

    const trade = tradeRes.rows[0];

    const buyPrice = Number(trade.price);
    const qty = Number(trade.quantity);
    const total = Number(trade.total);
    const currentPrice = Number(live_price);

    let profit = 0;

    if (trade.trade_type === "buy") {
      profit = (currentPrice - buyPrice) * qty;
    } else {
      profit = (buyPrice - currentPrice) * qty;
    }

    profit = Number(profit.toFixed(2));

    const finalAmount = Number((total + profit).toFixed(2));
    const resultType = profit >= 0 ? "profit" : "loss";

    // 1️⃣ Close trade
    await client.query(
      `UPDATE trades
       SET status='closed',
           profit_loss=$1,
           result_type=$2,
           closed_at=NOW()
       WHERE id=$3`,
      [profit, resultType, tradeId]
    );

    // 2️⃣ Update TRADING wallet (NOT main wallet)
    await client.query(
      `UPDATE users
       SET trading_wallet_amount = trading_wallet_amount + $1
       WHERE id=$2`,
      [finalAmount, user_id]
    );

    // 3️⃣ Insert notification
    await client.query(
      `INSERT INTO notifications
       (title, message, target_type, target_users)
       VALUES ($1,$2,'custom',$3)`,
      [
        "Trade Closed",
        `Your ${trade.coin} trade closed with ${resultType.toUpperCase()} of ${profit} USD`,
        user_id.toString()
      ]
    );

    await client.query("COMMIT");

    res.json({ success: true, profit, resultType });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Close failed" });
  } finally {
    client.release();
  }
});

router.get("/closed/:userId", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT 
         t.*
       FROM trades t
       WHERE t.user_id = $1
       AND t.status = 'closed'
       ORDER BY t.closed_at DESC`,
      [req.params.userId]
    );

    res.json(rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch closed trades" });
  }
});

router.get("/open/:userId", async (req, res) => {
  try {

    const { rows } = await pool.query(`
      SELECT 
        t.*,
       m.rate as custom_rate
      FROM trades t
      LEFT JOIN market_custom_rates m
      ON LOWER(m.symbol) = LOWER(t.coin)
      WHERE t.user_id=$1 AND t.status='open'
      ORDER BY t.created_at DESC
    `, [req.params.userId]);

    res.json(rows);

  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Fetch failed" });
  }
});

router.get("/history/:userId", async (req, res) => {
  try {

    const { rows } = await pool.query(`
      SELECT *
      FROM trades
      WHERE user_id=$1
      ORDER BY created_at DESC
    `, [req.params.userId]);

    res.json(rows);

  } catch (err) {
    res.status(500).json({ error: "History failed" });
  }
});
 
module.exports = router;
