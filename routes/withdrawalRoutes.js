const express = require("express");
const router = express.Router();
const pool = require("../db/db");

// ===============================
// ✅ CREATE WITHDRAWAL REQUEST
// ===============================
router.post("/create", async (req, res) => {
  const { user_id, wallet_address, description, amount } = req.body;

  try {
    if (!user_id || !wallet_address || !amount) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Check if user has a pending withdrawal request
    const pendingCheck = await pool.query(
      `SELECT id FROM withdrawal_requests 
       WHERE user_id = $1 AND status = 'pending'`,
      [user_id]
    );

    if (pendingCheck.rows.length > 0) {
      return res.status(400).json({ 
        error: "You already have a pending withdrawal request. Please wait for it to be processed." 
      });
    }

    // Check user balance
    const userRes = await pool.query(
      "SELECT wallet_amount FROM users WHERE id = $1",
      [user_id]
    );

    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const balance = Number(userRes.rows[0].wallet_amount);

    if (amount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    if (amount > balance) {
      return res.status(400).json({
        error: "Amount exceeds main wallet balance",
      });
    }

    // Insert request (status = pending by default)
    const result = await pool.query(
      `INSERT INTO withdrawal_requests 
      (user_id, wallet_address, description, amount) 
      VALUES ($1, $2, $3, $4) 
      RETURNING *`,
      [user_id, wallet_address, description, amount]
    );

    res.json({
      success: true,
      data: result.rows[0],
    });

  } catch (err) {
    console.error("Create withdrawal error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ===============================
// 📄 GET USER WITHDRAW HISTORY
// ===============================
router.get("/user/:user_id", async (req, res) => {
  const { user_id } = req.params;

  try {
    const result = await pool.query(
      `SELECT * FROM withdrawal_requests 
       WHERE user_id = $1 
       ORDER BY created_at DESC`,
      [user_id]
    );

    res.json(result.rows);

  } catch (err) {
    console.error("Fetch history error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ===============================
// 📄 GET ALL REQUESTS (ADMIN)
// ===============================
router.get("/all", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT wr.*, u.name, u.email, u.wallet_amount 
       FROM withdrawal_requests wr
       JOIN users u ON wr.user_id = u.id
       ORDER BY wr.created_at DESC`
    );

    res.json(result.rows);

  } catch (err) {
    console.error("Fetch all error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ===============================
// ✅ APPROVE WITHDRAWAL (ADMIN)
// ===============================
router.post("/approve/:id", async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const request = await client.query(
      "SELECT * FROM withdrawal_requests WHERE id = $1 FOR UPDATE",
      [id]
    );

    if (request.rows.length === 0) {
      throw new Error("Request not found");
    }

    const reqData = request.rows[0];

    if (reqData.status !== "pending") {
      throw new Error("Already processed");
    }

    // Check balance again (important)
    const user = await client.query(
      "SELECT wallet_amount FROM users WHERE id = $1 FOR UPDATE",
      [reqData.user_id]
    );

    const balance = Number(user.rows[0].wallet_amount);

    if (reqData.amount > balance) {
      throw new Error("Insufficient balance at approval time");
    }

    // Deduct from main_wallet
    await client.query(
      `UPDATE users 
       SET wallet_amount = wallet_amount - $1 
       WHERE id = $2`,
      [reqData.amount, reqData.user_id]
    );

    // Update request status
    await client.query(
      `UPDATE withdrawal_requests 
       SET status = 'completed', updated_at = NOW() 
       WHERE id = $1`,
      [id]
    );

    // Create notification for user
    await client.query(
      `INSERT INTO notifications (title, message, target_type, target_users, created_at)
       VALUES ($1, $2, 'custom', $3, NOW())`,
      [
        "Withdrawal Approved",
        `Your withdrawal request of $${reqData.amount} has been approved and processed. Amount deducted from your Primary Credit Balance.`,
        reqData.user_id.toString(),
      ]
    );

    await client.query("COMMIT");

    res.json({ 
      success: true, 
      message: "Withdrawal approved and amount deducted from main wallet" 
    });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Approve error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ===============================
// ❌ REJECT WITHDRAWAL (ADMIN)
// ===============================
router.post("/reject/:id", async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;

  try {
    if (!reason) {
      return res.status(400).json({ error: "Reject reason required" });
    }

    const request = await pool.query(
      "SELECT * FROM withdrawal_requests WHERE id = $1",
      [id]
    );

    if (request.rows.length === 0) {
      return res.status(404).json({ error: "Request not found" });
    }

    const reqData = request.rows[0];

    if (reqData.status !== "pending") {
      return res.status(400).json({ error: "Already processed" });
    }

    // Update status with reject reason
    await pool.query(
      `UPDATE withdrawal_requests 
       SET status = 'rejected', reject_reason = $1, updated_at = NOW() 
       WHERE id = $2`,
      [reason, id]
    );

    // Create notification for user with reject reason
    await pool.query(
      `INSERT INTO notifications (title, message, target_type, target_users, created_at)
       VALUES ($1, $2, 'custom', $3, NOW())`,
      [
        "Withdrawal Rejected",
        `Your withdrawal request of $${reqData.amount} has been rejected. Reason: ${reason}`,
        reqData.user_id.toString(),
      ]
    );

    res.json({ success: true, message: "Withdrawal rejected successfully" });

  } catch (err) {
    console.error("Reject error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ===============================
// 📊 GET PENDING REQUESTS COUNT
// ===============================
router.get("/pending/count/:user_id", async (req, res) => {
  const { user_id } = req.params;

  try {
    const result = await pool.query(
      `SELECT COUNT(*) as count FROM withdrawal_requests 
       WHERE user_id = $1 AND status = 'pending'`,
      [user_id]
    );

    res.json({ hasPending: result.rows[0].count > 0 });

  } catch (err) {
    console.error("Check pending error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;