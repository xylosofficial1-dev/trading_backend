// // backend/routes/monthlySalaryRoutes.js
const express = require("express");
const router = express.Router();
const pool = require("../db/db");

const getDirectBusiness = require("../utils/directBusinessCalculator");
const { getSalary, rules } = require("../utils/monthlySalaryRules");

router.post("/claim/:userId", async (req, res) => {

  const { userId } = req.params;

  try {

    const business = await getDirectBusiness(userId);

    const lastClaim = await pool.query(
      `SELECT business_level, claimed_at
       FROM monthly_salary_claims
       WHERE user_id=$1
       ORDER BY claimed_at DESC
       LIMIT 1`,
      [userId]
    );

    let lastLevel = 0;

    if (lastClaim.rowCount > 0) {

      lastLevel = Number(lastClaim.rows[0].business_level);

      const lastDate = new Date(lastClaim.rows[0].claimed_at);
      const nextDate = new Date(lastDate);
      nextDate.setDate(nextDate.getDate() + 30);

      if (new Date() < nextDate) {

        const remaining = Math.ceil(
          (nextDate - new Date()) / (1000 * 60 * 60 * 24)
        );

        return res.json({
          success: false,
          canClaim: false,
          message: "Claim not available yet",
          remainingDays: remaining
        });

      }

    }

    // eligible levels not yet claimed
    const eligible = rules.filter(
      r => business >= r.business && r.business > lastLevel
    );

    if (eligible.length === 0) {
      return res.json({
        success: false,
        message: "No new salary level reached"
      });
    }

    const totalSalary = eligible.reduce(
      (sum, r) => sum + r.salary,
      0
    );

    const highestLevel = eligible[eligible.length - 1].business;

    await pool.query(
      `UPDATE users
       SET wallet_amount = wallet_amount + $1
       WHERE id=$2`,
      [totalSalary, userId]
    );

    await pool.query(
      `INSERT INTO monthly_salary_claims
       (user_id, salary_amount, business_level)
       VALUES ($1,$2,$3)`,
      [userId, totalSalary, highestLevel]
    );

    res.json({
      success: true,
      salary: totalSalary
    });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: "Server error"
    });

  }

});
 
router.get("/dashboard/:userId", async (req, res) => {

  const { userId } = req.params;

  try {

    const business = await getDirectBusiness(userId);

    const lastClaim = await pool.query(
      `SELECT business_level, claimed_at
       FROM monthly_salary_claims
       WHERE user_id=$1
       ORDER BY claimed_at DESC
       LIMIT 1`,
      [userId]
    );

    let lastLevel = 0;
    let nextClaimDate = null;

    if (lastClaim.rowCount > 0) {
      lastLevel = Number(lastClaim.rows[0].business_level);

      const lastDate = new Date(lastClaim.rows[0].claimed_at);
      nextClaimDate = new Date(lastDate);
      nextClaimDate.setDate(nextClaimDate.getDate() + 30);
    }

    const eligible = rules.filter(
      r => business >= r.business && r.business > lastLevel
    );

    const claimableAmount = eligible.reduce(
      (sum, r) => sum + r.salary,
      0
    );

    const history = await pool.query(`
      SELECT *
      FROM monthly_salary_claims
      WHERE user_id=$1
      ORDER BY claimed_at DESC
    `, [userId]);

    res.json({
      directBusiness: business,
      claimableAmount,
      history: history.rows,
      nextClaimDate
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }

});

router.get("/status/:userId", async (req, res) => {
  const { userId } = req.params;

  try {

    const business = await getDirectBusiness(userId);
    const { salary } = getSalary(business);

    if (salary === 0) {
      return res.json({
        canClaim: false,
        remainingTime: "Build $1000 direct business"
      });
    }

    const lastClaim = await pool.query(
      `
      SELECT claimed_at
      FROM monthly_salary_claims
      WHERE user_id=$1
      ORDER BY claimed_at DESC
      LIMIT 1
      `,
      [userId]
    );

    // First claim available immediately
    if (lastClaim.rowCount === 0) {
      return res.json({
        canClaim: true,
        remainingTime: ""
      });
    }

    const lastDate = new Date(lastClaim.rows[0].claimed_at);
    const nextDate = new Date(lastDate);
    nextDate.setDate(nextDate.getDate() + 30);

    const now = new Date();

    if (now >= nextDate) {
      return res.json({
        canClaim: true,
        remainingTime: ""
      });
    }

    const diff = nextDate - now;

    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));

    res.json({
      canClaim: false,
      remainingTime: `${days} days`
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/history/:userId", async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);

    if (!userId || isNaN(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid userId"
      });
    }

    const result = await pool.query(
      `SELECT id, salary_amount, claimed_at
       FROM monthly_salary_claims
       WHERE user_id = $1
       ORDER BY claimed_at DESC`,
      [userId]
    );

    res.json({
      success: true,
      data: result.rows
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});

router.get("/test-status/:type", (req, res) => {

  const { type } = req.params;

  if (type === "business") {
    return res.json({
      canClaim: false,
      remainingTime: "Build $1000 direct business"
    });
  }

  if (type === "waiting") {
    return res.json({
      canClaim: false,
      remainingTime: "17 days"
    });
  }

  if (type === "ready") {
    return res.json({
      canClaim: true,
      remainingTime: ""
    });
  }

  res.json({
    error: "Invalid test type"
  });

});

module.exports = router;