// backend/routes/adminMarketRoutes.js
const express = require("express");
const router = express.Router();
const pool = require("../db/db");

/*
  DAILY RESET LOGIC:
  If rate was updated before today,
  reset it to 0 automatically.
*/

// ✅ Get all custom rates (with auto reset)
router.get("/custom-rates", async (req, res) => {
  try {
    // 🔥 Reset if last updated date is before today
    await pool.query(`
      UPDATE market_custom_rates
      SET rate = 0
      WHERE updated_at::date < CURRENT_DATE
    `);

    const { rows } = await pool.query(`
      SELECT symbol, rate
      FROM market_custom_rates
    `);

    res.json(rows);
  } catch (err) {
    console.error("Custom rates fetch error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ Update single rate (also update timestamp)
router.post("/custom-rate", async (req, res) => {
  try {
    const { symbol, rate } = req.body;

    await pool.query(
      `
      INSERT INTO market_custom_rates(symbol, rate, updated_at)
      VALUES($1,$2,NOW())
      ON CONFLICT(symbol)
      DO UPDATE SET
        rate = EXCLUDED.rate,
        updated_at = NOW()
      `,
      [symbol, rate]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Save custom rate error:", err);
    res.status(500).json({ error: "Update failed" });
  }
});


// ================= ADMIN COINS =================

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

// 🔥 MANUAL RESET ALL CUSTOM RATES
router.post("/custom-rates/reset-all", async (req, res) => {
  try {
    await pool.query(`
      UPDATE market_custom_rates
      SET rate = 0,
          updated_at = NOW()
    `);

    res.json({ success: true, message: "All custom rates reset to 0" });
  } catch (err) {
    console.error("Manual reset error:", err);
    res.status(500).json({ error: "Reset failed" });
  }
});
// DELETE
router.delete("/admin-coins/:id", async (req,res)=>{
  await pool.query(
    `DELETE FROM admin_coins WHERE id=$1`,
    [req.params.id]
  );
  res.json({success:true});
});

module.exports = router;