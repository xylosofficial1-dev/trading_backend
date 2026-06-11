// // backend/routes/monthlySalaryRoutes.js
const express = require("express");
const router = express.Router(); 
const pool = require("../db/db");

const getDirectBusiness = require("../utils/directBusinessCalculator");
const { getSalary, rules } = require("../utils/monthlySalaryRules");

router.post("/claim/:userId", async (req, res) => {
  const client = await pool.connect();

  try {

    await client.query("BEGIN");

    const userId = parseInt(req.params.userId);

    if (!userId || isNaN(userId)) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        success: false,
        message: "Invalid user id"
      });
    }

    // =========================
    // CURRENT BUSINESS
    // =========================

    const business = await getDirectBusiness(userId);

    const currentRule = rules
      .filter(r => business >= r.business)
      .pop();

    if (!currentRule) {

      await client.query("ROLLBACK");

      return res.json({
        success: false,
        message: "Build $1000 direct business"
      });
    }

    // =========================
    // GET STATUS
    // =========================

    const statusResult = await client.query(
      `
      SELECT *
      FROM monthly_salary_status
      WHERE user_id = $1
      FOR UPDATE
      `,
      [userId]
    );

    if (statusResult.rowCount === 0) {

      await client.query("ROLLBACK");

      return res.json({
        success: false,
        message: "Reward not initialized"
      });
    }

    const status = statusResult.rows[0];

    const now = new Date();

    const nextClaimAt =
      new Date(status.next_claim_at);

    // =========================
    // CLAIM CHECK
    // =========================

    if (now < nextClaimAt) {

      await client.query("ROLLBACK");

      return res.json({
        success: false,
        message: "Claim not available yet"
      });
    }

    // =========================
    // CREDIT WALLET
    // =========================

    const salary =
      Number(status.current_salary);

    await client.query(
      `
      UPDATE users
      SET wallet_amount =
      COALESCE(wallet_amount,0) + $1
      WHERE id = $2
      `,
      [salary, userId]
    );

    // =========================
    // SAVE CLAIM HISTORY
    // =========================

    await client.query(
      `
      INSERT INTO monthly_salary_claims
      (
        user_id,
        salary_amount,
        business_level
      )
      VALUES ($1,$2,$3)
      `,
      [
        userId,
        salary,
        status.current_business_level
      ]
    );

    // =========================
    // IMPORTANT FIX
    // NEXT DATE FROM PREVIOUS DATE
    // NOT FROM TODAY
    // =========================

    const nextDate = new Date(
      status.next_claim_at
    );

    nextDate.setDate(
      nextDate.getDate() + 30
    );

    // =========================
    // CHECK LEVEL UPGRADE
    // =========================

    let updatedBusiness =
      status.current_business_level;

    let updatedSalary =
      status.current_salary;

    if (
      Number(currentRule.business) >
      Number(status.current_business_level)
    ) {

      updatedBusiness =
        currentRule.business;

      updatedSalary =
        currentRule.salary;
    }

    // =========================
    // UPDATE STATUS
    // =========================

    await client.query(
      `
      UPDATE monthly_salary_status
      SET
        current_business_level = $1,
        current_salary = $2,
        next_claim_at = $3
      WHERE user_id = $4
      `,
      [
        updatedBusiness,
        updatedSalary,
        nextDate,
        userId
      ]
    );

    // =========================
    // NOTIFICATION
    // =========================

    await client.query(
      `
      INSERT INTO notifications
      (
        title,
        message,
        target_type,
        target_users
      )
      VALUES ($1,$2,$3,$4)
      `,
      [
        "Monthly Reward Claimed 🎉",
        `🔥 $${salary} credited to wallet`,
        "custom",
        userId.toString()
      ]
    );

    await client.query("COMMIT");

    return res.json({
      success: true,
      amount: salary,
      nextClaimAt: nextDate
    });

  } catch (err) {

    await client.query("ROLLBACK");

    console.log(err);

    return res.status(500).json({
      success: false,
      error: "Server error"
    });

  } finally {

    client.release();

  }
});

// GET ALL MONTHLY SALARY STATUS DATA
router.get("/all-status", async (req, res) => {
  try {

    const result = await pool.query(
      `
      SELECT
        s.user_id,
        u.name,
        u.phone,
        s.current_business_level,
        s.current_salary,
        s.level_started_at,
        s.next_claim_at
      FROM monthly_salary_status s
      LEFT JOIN users u
        ON u.id = s.user_id
      ORDER BY s.user_id ASC
      `
    );

    res.json({
      success: true,
      total: result.rowCount,
      data: result.rows
    });

  } catch (err) {

    console.log(err);

    res.status(500).json({
      success: false,
      error: "Server error"
    });

  }
});

router.get("/status/:userId", async (req, res) => {
  try {

    const userId = parseInt(req.params.userId);

    const business = await getDirectBusiness(userId);

    const currentRule = rules
      .filter(r => business >= r.business)
      .pop();

    if (!currentRule) {
      return res.json({
        canClaim: false,
        remainingTime: "Build $1000 direct business"
      });
    }

    let statusResult = await pool.query(
      `
      SELECT *
      FROM monthly_salary_status
      WHERE user_id = $1
      `,
      [userId]
    );

    // =====================================
    // FIRST TIME USER
    // =====================================

    if (statusResult.rowCount === 0) {

      // check old claim history first

      const oldClaim = await pool.query(
        `
        SELECT claimed_at
        FROM monthly_salary_claims
        WHERE user_id = $1
        ORDER BY claimed_at DESC
        LIMIT 1
        `,
        [userId]
      );

      let nextClaim;

      // existing live user
      if (oldClaim.rowCount > 0) {

        nextClaim = new Date(
          oldClaim.rows[0].claimed_at
        );

        nextClaim.setDate(
          nextClaim.getDate() + 30
        );

      } else {

        // fresh user
        nextClaim = new Date();

        nextClaim.setDate(
          nextClaim.getDate() + 30
        );
      }

      await pool.query(
        `
        INSERT INTO monthly_salary_status (
          user_id,
          current_business_level,
          current_salary,
          level_started_at,
          next_claim_at
        )
        VALUES ($1,$2,$3,NOW(),$4)
        `,
        [
          userId,
          currentRule.business,
          currentRule.salary,
          nextClaim
        ]
      );

      const now = new Date();

      if (now >= nextClaim) {
        return res.json({
          canClaim: true,
          remainingTime: ""
        });
      }

      const diff = nextClaim - now;

      const days = Math.ceil(
        diff / (1000 * 60 * 60 * 24)
      );

      return res.json({
        canClaim: false,
        remainingTime: `${days} days`
      });
    }

    let status = statusResult.rows[0];

    // =====================================
    // LEVEL UPGRADE
    // DO NOT RESET TIMER
    // =====================================

if (
  Number(currentRule.business) >
  Number(status.current_business_level)
) {

  await pool.query(
    `
    UPDATE monthly_salary_status
    SET
      current_business_level = $1,
      current_salary = $2
    WHERE user_id = $3
    `,
    [
      currentRule.business,
      currentRule.salary,
      userId
    ]
  );

  status.current_business_level =
    currentRule.business;

  status.current_salary =
    currentRule.salary;

  // IMPORTANT:
  // DO NOT CHANGE next_claim_at
  // ONLY CHANGE SALARY LEVEL
}

    // =====================================
    // NORMAL TIMER
    // =====================================

    const now = new Date();

    const nextClaim = new Date(
      status.next_claim_at
    );

    if (now >= nextClaim) {

      return res.json({
        canClaim: true,
        remainingTime: ""
      });
    }

    const diff = nextClaim - now;

    const days = Math.floor(
      diff / (1000 * 60 * 60 * 24)
    );

    const hours = Math.floor(
      (diff % (1000 * 60 * 60 * 24)) /
      (1000 * 60 * 60)
    );

    return res.json({
      canClaim: false,
      remainingTime: `${days}d ${hours}h`
    });

  } catch (err) {

    console.log(err);

    res.status(500).json({
      error: "Server error"
    });
  }
});

router.get("/dashboard/:userId", async (req, res) => {

  try {

    const userId = parseInt(req.params.userId);

    if (!userId || isNaN(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid userId"
      });
    }

    // =========================
    // DIRECT BUSINESS ONLY
    // =========================

    const business = await getDirectBusiness(userId);

    // =========================
    // CURRENT LEVEL
    // =========================

    const currentRule = rules
      .filter(r => business >= r.business)
      .pop();

    const claimableAmount =
      currentRule?.salary || 0;

    // =========================
    // DIRECT REFERRALS ONLY
    // =========================

    const referralsResult = await pool.query(
      `
      SELECT
        id,
        name,
        phone,
        trading_wallet_amount,
        created_at
      FROM users
      WHERE parent_id = $1
      ORDER BY trading_wallet_amount DESC
      `,
      [userId] 
    );
    

    // =========================
    // CLAIM HISTORY
    // =========================

    const historyResult = await pool.query(
      `
      SELECT
        id,
        salary_amount,
        business_level,
        claimed_at
      FROM monthly_salary_claims
      WHERE user_id = $1
      ORDER BY claimed_at DESC
      `,
      [userId]
    );

    // =========================
    // NEXT CLAIM DATE
    // FROM LAST claimed_at
    // =========================

    // let nextClaimDate = null;

    // if (historyResult.rowCount > 0) {

    //   const lastClaimDate = new Date(
    //     historyResult.rows[0].claimed_at
    //   );

    //   lastClaimDate.setDate(
    //     lastClaimDate.getDate() + 30
    //   );

    //   nextClaimDate = lastClaimDate;
    // }
    const statusResult = await pool.query(
  `
  SELECT next_claim_at
  FROM monthly_salary_status
  WHERE user_id = $1
  `,
  [userId]
);

let nextClaimDate = null;

if (statusResult.rowCount > 0) {
  nextClaimDate =
    statusResult.rows[0].next_claim_at;
}

    // =========================
    // RESPONSE
    // =========================

    res.json({

      success: true,

      directBusiness: business,

      totalMembers:
        referralsResult.rows.length,

      claimableAmount,

      nextClaimDate,

      history: historyResult.rows,

      referrals: referralsResult.rows,

      topLeaders: referralsResult.rows

    });

  } catch (err) {

    console.log(err);

    res.status(500).json({ 
      success: false,
      error: "Server error"
    });

  }

});

router.get("/test-business/:userId", async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);

    // example: make direct business 1000
    await pool.query(
      `
      UPDATE users
      SET trading_wallet_amount = 1000
      WHERE id = $1
      `,
      [userId]
    );

    res.json({
      success: true,
      message: "Business updated"
    });

  } catch (err) {
    console.log(err);

    res.status(500).json({
      success: false
    });
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