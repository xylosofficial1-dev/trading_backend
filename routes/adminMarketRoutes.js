// backend/routes/adminMarketRoutes.js
const express = require("express");
const router = express.Router();
const pool = require("../db/db");

// Get all custom rates
router.get("/custom-rates", async (req, res) => {
  const { rows } = await pool.query(
    `SELECT symbol, rate FROM market_custom_rates`
  );
  res.json(rows);
});

// Update single rate
router.post("/custom-rate", async (req, res) => {
  const { symbol, rate } = req.body;

  await pool.query(`
    INSERT INTO market_custom_rates(symbol, rate)
    VALUES($1,$2)
    ON CONFLICT(symbol)
    DO UPDATE SET rate = EXCLUDED.rate
  `,[symbol, rate]);

  res.json({ success:true });
});

router.get("/admin-coins", async (req,res)=>{
  try {
    const { rows } = await pool.query(
      `SELECT * FROM admin_coins ORDER BY id DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error("Admin coins error:", err);
    res.status(500).json({error:"Server error"});
  }
});

// ADD
router.post("/admin-coins", async (req,res)=>{
  try {
    const { name,symbol,rate,quantity,total_value } = req.body;

    await pool.query(`
      INSERT INTO admin_coins(name,symbol,rate,quantity,total_value)
      VALUES($1,$2,$3,$4,$5)
    `,[name,symbol,rate,quantity,total_value]);

    res.json({success:true});
  } catch(err){
    console.error(err);
    res.status(500).json({error:"Insert failed"});
  }
});

// UPDATE
router.put("/admin-coins/:id", async (req,res)=>{
  try {
    const { rate,quantity,total_value } = req.body;

    await pool.query(`
      UPDATE admin_coins
      SET rate=$1, quantity=$2, total_value=$3
      WHERE id=$4
    `,[rate,quantity,total_value,req.params.id]);

    res.json({success:true});
  } catch(err){
    console.error(err);
    res.status(500).json({error:"Update failed"});
  }
});

// DELETE
router.delete("/admin-coins/:id", async (req,res)=>{
  await pool.query(`DELETE FROM admin_coins WHERE id=$1`,[req.params.id]);
  res.json({success:true});
});

module.exports = router;
