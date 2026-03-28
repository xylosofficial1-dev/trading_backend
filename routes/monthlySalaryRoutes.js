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

    // 🔹 Get last claim
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

  const now = new Date();

  // 🔥 Get current level
  const current = rules.filter(r => business >= r.business).pop();

  // ✅ CONDITION 1: Level upgraded → allow claim instantly
  if (current && current.business > lastLevel) {
    // allow claim (skip 30 days)
  }
  // ❌ CONDITION 2: No level upgrade → enforce 30 days
  else if (now < nextDate) {
    const remaining = Math.ceil(
      (nextDate - now) / (1000 * 60 * 60 * 24)
    );

    return res.json({
      success: false,
      canClaim: false,
      message: "Claim not available yet",
      remainingDays: remaining
    });
  }
}

    // 🔹 Get current level based on business
    const current = rules.filter(r => business >= r.business).pop();

    if (!current) {
      return res.json({
        success: false,
        message: "No salary level reached"
      });
    }

    // 🔥 CORE FIXED LOGIC
    const allEligibleLevels = rules.filter(r => business >= r.business);

    let payoutLevels;

    if (lastLevel === 0) {
      // ✅ First claim → give ALL pending levels
      payoutLevels = allEligibleLevels;
    } else {
      // ✅ Only give levels NOT yet claimed
      payoutLevels = allEligibleLevels.filter(
        r => r.business > lastLevel
      );
    }

    if (payoutLevels.length === 0) {
      return res.json({
        success: false,
        message: "Nothing new to claim"
      });
    }

    // ✅ Calculate payout
    const payout = payoutLevels.reduce(
      (sum, r) => sum + r.salary,
      0
    );

    const highestLevel = current.business;

    // ✅ Update wallet
    await pool.query(
      `UPDATE users
       SET wallet_amount = wallet_amount + $1
       WHERE id=$2`,
      [payout, userId]
    );

    // ✅ Insert claim history
    await pool.query(
      `INSERT INTO monthly_salary_claims
       (user_id, salary_amount, business_level)
       VALUES ($1,$2,$3)`,
      [userId, payout, highestLevel]
    );

    // ✅ Notification
    await pool.query(
      `INSERT INTO notifications (title, message, target_type, target_users)
       VALUES ($1, $2, $3, $4)`,
      [
        "Monthly Reward Claimed 🎉",
        `🔥 $${payout} credited to your wallet!`,
        "custom",
        userId.toString()
      ]
    );

    return res.json({
      success: true,
      salary: payout
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

   const allEligibleLevels = rules.filter(r => business >= r.business);

let claimableLevels;

if (lastLevel === 0) {
  claimableLevels = allEligibleLevels;
} else {
  claimableLevels = allEligibleLevels.filter(
    r => r.business > lastLevel
  );
}

const claimableAmount = claimableLevels.reduce(
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

    const current = rules.filter(r => business >= r.business).pop();

    if (!current) {
      return res.json({
        canClaim: false,
        remainingTime: "Build $1000 direct business"
      });
    }

    const lastClaim = await pool.query(
      `SELECT business_level, claimed_at
       FROM monthly_salary_claims
       WHERE user_id=$1
       ORDER BY claimed_at DESC
       LIMIT 1`,
      [userId]
    );

    // ✅ First claim
    if (lastClaim.rowCount === 0) {
      return res.json({
        canClaim: true,
        remainingTime: ""
      });
    }

    const lastLevel = Number(lastClaim.rows[0].business_level);
    const lastDate = new Date(lastClaim.rows[0].claimed_at);

    const nextDate = new Date(lastDate);
    nextDate.setDate(nextDate.getDate() + 30);

    const now = new Date();

    // 🔥 KEY FIX: Allow claim if level increased
    if (current.business > lastLevel) {
      return res.json({
        canClaim: true,
        remainingTime: ""
      });
    }

    // ⛔ Otherwise apply 30-day rule
    if (now >= nextDate) {
      return res.json({
        canClaim: true,
        remainingTime: ""
      });
    }

    const diff = nextDate - now;
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));

    return res.json({
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