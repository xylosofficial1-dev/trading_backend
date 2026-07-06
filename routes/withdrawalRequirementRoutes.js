const express = require("express");
const router = express.Router();
const pool = require("../db/db");

// 1. GET all users for admin list & filtering
router.get("/withdrawal-requirements/all-users", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, email, created_at, withdraw_req_count, withdraw_req_completed, withdraw_req_started_at, transfer_blocked 
       FROM users 
       ORDER BY created_at DESC`
    );
    res.json({ success: true, users: result.rows });
  } catch (err) {
    console.error("Fetch all users error:", err);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

// 2. GET users grouped by status (Pending vs Done)
router.get("/withdrawal-requirements/users", async (req, res) => {
  try {
    // Pending: Completed = false and count > 0
    const pendingResult = await pool.query(
      `SELECT id, name, email, created_at, withdraw_req_count, withdraw_req_started_at
       FROM users 
       WHERE withdraw_req_completed = FALSE AND withdraw_req_count > 0
       ORDER BY created_at DESC`
    );

    // Done: Completed = true and count > 0
    const doneResult = await pool.query(
      `SELECT id, name, email, created_at, withdraw_req_count, withdraw_req_started_at
       FROM users 
       WHERE withdraw_req_completed = TRUE AND withdraw_req_count > 0
       ORDER BY created_at DESC`
    );

    res.json({
      success: true,
      pending: pendingResult.rows,
      done: doneResult.rows
    });
  } catch (err) {
    console.error("Fetch grouped users error:", err);
    res.status(500).json({ error: "Failed to fetch users lists" });
  }
});

// 3. POST apply referral requirement configuration
router.post("/withdrawal-requirements/apply", async (req, res) => {
  try {
    const { target, requirementCount, fromDate, toDate, userIds } = req.body;
    
    const count = Number(requirementCount);
    if (isNaN(count) || count < 0 || count > 10) {
      return res.status(400).json({ error: "Requirement count must be between 0 and 10" });
    }

    let query = "";
    let params = [];

    if (target === "all") {
      query = `
        UPDATE users 
        SET withdraw_req_count = $1,
            withdraw_req_started_at = NOW(),
            withdraw_req_completed = CASE WHEN $1 = 0 THEN TRUE ELSE FALSE END
        RETURNING id;
      `;
      params = [count];
    } else if (target === "date_range") {
      if (!fromDate || !toDate) {
        return res.status(400).json({ error: "From and To dates are required for date_range target" });
      }
      query = `
        UPDATE users 
        SET withdraw_req_count = $1,
            withdraw_req_started_at = NOW(),
            withdraw_req_completed = CASE WHEN $1 = 0 THEN TRUE ELSE FALSE END
        WHERE created_at >= $2 AND created_at <= $3
        RETURNING id;
      `;
      params = [count, new Date(fromDate), new Date(toDate)];
    } else if (target === "specific") {
      if (!Array.isArray(userIds) || userIds.length === 0) {
        return res.status(400).json({ error: "User IDs array is required for specific target" });
      }
      query = `
        UPDATE users 
        SET withdraw_req_count = $1,
            withdraw_req_started_at = NOW(),
            withdraw_req_completed = CASE WHEN $1 = 0 THEN TRUE ELSE FALSE END
        WHERE id = ANY($2)
        RETURNING id;
      `;
      params = [count, userIds];
    } else {
      return res.status(400).json({ error: "Invalid target type" });
    }

    const result = await pool.query(query, params);
    
    res.json({
      success: true,
      message: `Successfully applied requirement to ${result.rowCount} users.`,
      updatedCount: result.rowCount
    });
  } catch (err) {
    console.error("Apply withdrawal requirements error:", err);
    res.status(500).json({ error: "Failed to apply requirements" });
  }
});

// 4. POST re-enable referral requirement for completed users
router.post("/withdrawal-requirements/re-enable", async (req, res) => {
  try {
    const { userIds, requirementCount } = req.body;

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: "User IDs array is required" });
    }

    const count = Number(requirementCount);
    if (isNaN(count) || count < 0 || count > 10) {
      return res.status(400).json({ error: "Requirement count must be between 0 and 10" });
    }

    const result = await pool.query(
      `UPDATE users 
       SET withdraw_req_count = $1,
           withdraw_req_started_at = NOW(),
           withdraw_req_completed = CASE WHEN $1 = 0 THEN TRUE ELSE FALSE END
       WHERE id = ANY($2)
       RETURNING id`,
      [count, userIds]
    );

    res.json({
      success: true,
      message: `Successfully re-enabled requirement for ${result.rowCount} users.`,
      updatedCount: result.rowCount
    });
  } catch (err) {
    console.error("Re-enable requirements error:", err);
    res.status(500).json({ error: "Failed to re-enable requirements" });
  }
});

module.exports = router;
