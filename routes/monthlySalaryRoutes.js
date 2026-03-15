const express = require("express");
const router = express.Router();
const pool = require("../db/db");

const getDirectBusiness = require("../utils/directBusinessCalculator");
const getSalary = require("../utils/monthlySalaryRules");

router.post("/claim/:userId", async (req, res) => {

  const { userId } = req.params;

  try {

    const business = await getDirectBusiness(userId);
    const { salary, level } = getSalary(business);

    if (salary === 0) {
      return res.json({
        success: false,
        canClaim: false,
        message: "Business not enough for salary"
      });
    }

    const lastClaim = await pool.query(
      `SELECT claimed_at
       FROM monthly_salary_claims
       WHERE user_id=$1
       ORDER BY claimed_at DESC
       LIMIT 1`,
      [userId]
    );

    if (lastClaim.rowCount > 0) {

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
          remainingDays: remaining,
          nextClaimDate: nextDate
        });

      }

    }

    await pool.query(
      `UPDATE users
       SET wallet_amount = wallet_amount + $1
       WHERE id=$2`,
      [salary, userId]
    );

    await pool.query(
      `INSERT INTO monthly_salary_claims
       (user_id, salary_amount, business_level)
       VALUES ($1,$2,$3)`,
      [userId, salary, level]
    );

    await pool.query(
      `INSERT INTO notifications
       (title,message,target_type,target_users)
       VALUES ($1,$2,'custom',$3)`,
      [
        "Monthly Salary",
        `🎉 You received $${salary} monthly salary.`,
        userId.toString()
      ]
    );

    res.json({
      success: true,
      canClaim: true,
      salary
    });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: "Server error"
    });

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