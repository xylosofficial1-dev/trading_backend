const express = require("express");
const router = express.Router();
const axios = require("axios");
const pool = require("../db/db");

const BINANCE_SYMBOLS = [
  "BTCUSDT",
  "ETHUSDT",
  "BNBUSDT",
  "SOLUSDT",
  "DOGEUSDT",
  "PEPEUSDT",
  "SHIBUSDT",
  "ADAUSDT",
  "DOTUSDT",
  "AVAXUSDT",
];

const COIN_MAP = {
  BTC: "bitcoin",
  ETH: "ethereum",
  BNB: "binancecoin",
  SOL: "solana",
  DOGE: "dogecoin",
  PEPE: "pepe",
  SHIB: "shiba-inu",
  ADA: "cardano",
  DOT: "polkadot",
  AVAX: "avalanche-2"
};

async function getPrice(symbol) {

  const id = COIN_MAP[symbol];

  const res = await axios.get(
    `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`
  );

  return res.data[id].usd;
}

/*
BUY COIN
*/
router.post("/buy", async (req, res) => {

  const { userId, coin, quantity } = req.body;

  try {

    const price = await getPrice(coin);
    const totalCost = price * quantity;

    const user = await pool.query(
      "SELECT wallet_amount FROM users WHERE id=$1",
      [userId]
    );

    const wallet = Number(user.rows[0].wallet_amount);

    if (wallet < totalCost) {
      return res.status(400).json({
        message: "Insufficient wallet balance"
      });
    }

    /* deduct wallet */
    await pool.query(
      `UPDATE users 
       SET wallet_amount = wallet_amount - $1 
       WHERE id=$2`,
      [totalCost, userId]
    );

    /* add coin */
    await pool.query(
      `INSERT INTO user_coin_balances(user_id,coin_symbol,quantity)
       VALUES($1,$2,$3)
       ON CONFLICT(user_id,coin_symbol)
       DO UPDATE SET quantity = user_coin_balances.quantity + $3`,
      [userId, coin, quantity]
    );

    /* history */
    await pool.query(
      `INSERT INTO swap_history(user_id,coin_symbol,type,quantity,price_usd,total_usd)
       VALUES($1,$2,'BUY',$3,$4,$5)`,
      [userId, coin, quantity, price, totalCost]
    );

    res.json({
      success: true,
      price,
      totalCost
    });

  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Swap failed" });
  }

});

/*
SELL COIN
*/
router.post("/sell", async (req, res) => {

  const { userId, coin, quantity } = req.body;

  try {

    const price = await getPrice(coin);
    const total = price * quantity;

    const coinBal = await pool.query(
      `SELECT quantity FROM user_coin_balances
       WHERE user_id=$1 AND coin_symbol=$2`,
      [userId, coin]
    );

    if (!coinBal.rows.length || coinBal.rows[0].quantity < quantity) {
      return res.status(400).json({
        message: "Not enough coin balance"
      });
    }

    /* subtract coin */
    await pool.query(
      `UPDATE user_coin_balances
       SET quantity = quantity - $1
       WHERE user_id=$2 AND coin_symbol=$3`,
      [quantity, userId, coin]
    );

    /* add wallet */
    await pool.query(
      `UPDATE users
       SET wallet_amount = wallet_amount + $1
       WHERE id=$2`,
      [total, userId]
    );

    /* history */
    await pool.query(
      `INSERT INTO swap_history(user_id,coin_symbol,type,quantity,price_usd,total_usd)
       VALUES($1,$2,'SELL',$3,$4,$5)`,
      [userId, coin, quantity, price, total]
    );

    res.json({
      success: true,
      price,
      total
    });

  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Sell failed" });
  }

});

router.post("/swap", async (req,res)=>{

  const { userId, fromCoin, toCoin, amount, quantity } = req.body;

  try{

    const client = await pool.connect();
    await client.query("BEGIN");

    let price = 0;

    if(toCoin !== "USDT"){
      price = await getPrice(toCoin);
    } else {
      price = await getPrice(fromCoin);
    }

    let totalCost = 0;

    if(fromCoin === "USDT"){
      totalCost = amount;
    }else{
      totalCost = quantity;
    }

    // CHECK WALLET
    if(fromCoin === "USDT"){

      const wallet = await client.query(
        `SELECT wallet_amount FROM users WHERE id=$1`,
        [userId]
      );

      if(wallet.rows[0].wallet_amount < totalCost){
        throw new Error("Not enough balance");
      }

      await client.query(
        `UPDATE users
         SET wallet_amount = wallet_amount - $1
         WHERE id=$2`,
        [totalCost,userId]
      );

    }else{

      const bal = await client.query(
        `SELECT quantity FROM user_coin_balances
         WHERE user_id=$1 AND coin_symbol=$2`,
        [userId,fromCoin]
      );

      if(!bal.rows.length || bal.rows[0].quantity < amount){
        throw new Error("Not enough coin balance");
      }

      await client.query(
        `UPDATE user_coin_balances
         SET quantity = quantity - $1
         WHERE user_id=$2 AND coin_symbol=$3`,
        [amount,userId,fromCoin]
      );

    }

    // ADD COIN
    if(toCoin === "USDT"){

      await client.query(
        `UPDATE users
         SET wallet_amount = wallet_amount + $1
         WHERE id=$2`,
        [quantity,userId]
      );

    }else{

      await client.query(
        `INSERT INTO user_coin_balances(user_id,coin_symbol,quantity)
         VALUES($1,$2,$3)
         ON CONFLICT(user_id,coin_symbol)
         DO UPDATE SET quantity = user_coin_balances.quantity + $3`,
        [userId,toCoin,quantity]
      );

    }

    // HISTORY
    await client.query(
      `INSERT INTO swap_history
       (user_id,coin_symbol,type,quantity,price_usd,total_usd)
       VALUES($1,$2,'BUY',$3,$4,$5)`,
      [userId,toCoin,quantity,price,totalCost]
    );

    await client.query("COMMIT");

    res.json({ success:true });

  }catch(err){

    console.log(err);
    res.status(400).json({message:err.message});

  }

});

router.get("/balances/:userId", async (req, res) => {

  const { userId } = req.params;

  try {

    const coins = await pool.query(
      `SELECT coin_symbol, quantity
       FROM user_coin_balances
       WHERE user_id=$1`,
      [userId]
    );

    const wallet = await pool.query(
      `SELECT wallet_amount FROM users WHERE id=$1`,
      [userId]
    );

    const balances = coins.rows;

    balances.push({
      coin_symbol: "USDT",
      quantity: wallet.rows[0]?.wallet_amount || 0
    });

    res.json(balances);

  } catch (err) {

    console.log(err);
    res.status(500).json({ message: "Balance fetch failed" });

  }

});

router.get("/history/:userId", async (req, res) => {

  const { userId } = req.params;

  try {

    const result = await pool.query(
      `SELECT *
       FROM swap_history
       WHERE user_id=$1
       ORDER BY created_at DESC`,
      [userId]
    );

    res.json(result.rows);

  } catch (err) {

    console.log(err);
    res.status(500).json({ message: "History fetch failed" });

  }

});

router.get("/history", async (req, res) => {

  try {

    const result = await pool.query(
      `SELECT *
       FROM swap_history
       ORDER BY created_at DESC`
    );

    res.json(result.rows);

  } catch (err) {

    console.error(err);
    res.status(500).json({
      message: "Failed to fetch history"
    });

  }

});

router.get("/market", async (req, res) => {

  try {

    const result = await axios.get(
      "https://api.binance.com/api/v3/ticker/price"
    );

    const prices = {};

    result.data.forEach(p => {

      if (BINANCE_SYMBOLS.includes(p.symbol)) {

        const coin = p.symbol.replace("USDT","");

        prices[coin] = Number(p.price);

      }

    });

    res.json(prices);

  } catch (err) {

    console.log(err);
    res.status(500).json({ message: "Market fetch failed" });

  }

});

module.exports = router;