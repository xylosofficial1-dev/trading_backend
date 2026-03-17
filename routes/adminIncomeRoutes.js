// backend/routes/adminIncomeRoutes.js

const express = require("express");
const router = express.Router();
const pool = require("../db/db");

router.get("/all-income-data", async (req, res) => {
  try {

    const monthlySalary = await pool.query(`
      SELECT *
      FROM monthly_salary_claims
      ORDER BY claimed_at DESC
    `);

    const referralRewards = await pool.query(`
      SELECT *
      FROM referral_task_rewards
      ORDER BY created_at DESC
    `);

    res.json({
      success: true,
      monthlySalary: monthlySalary.rows,
      referralRewards: referralRewards.rows
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      success:false,
      error:"Server error"
    });
  }
});

module.exports = router;