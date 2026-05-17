const express = require("express");
const router = express.Router();
const pool = require("../db/db");
const crypto = require("crypto");
const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

/* =========================================================
   SEND WITHDRAW OTP
========================================================= */
router.post("/send-otp", async (req, res) => {
  try {
    const { user_id } = req.body;

    if (!user_id) {
      return res.status(400).json({
        error: "User id required",
      });
    }

    // get user email
    const userResult = await pool.query(
      `SELECT email, name FROM users WHERE id = $1`,
      [user_id]
    );

    if (!userResult.rowCount) {
      return res.status(404).json({
        error: "User not found",
      });
    }

    const user = userResult.rows[0];

    // generate otp
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // delete old otp
    await pool.query(
      `DELETE FROM withdrawal_otp 
       WHERE user_id = $1`,
      [user_id]
    );

    // insert new otp
    await pool.query(
      `INSERT INTO withdrawal_otp
      (user_id, otp, expires_at)
      VALUES ($1, $2, NOW() + INTERVAL '5 minutes')`,
      [user_id, otp]
    );

    // send email
    await resend.emails.send({
      from: process.env.FROM_EMAIL,
      to: user.email,
      subject: "Withdrawal OTP Verification",
      html: `
      <div style="font-family:Arial;padding:20px;">
        <h2>Withdrawal Verification</h2>

        <p>Hello ${user.name},</p>

        <p>
          Your withdrawal verification OTP is:
        </p>

        <div style="
          font-size:32px;
          font-weight:bold;
          letter-spacing:8px;
          background:#f4f4f4;
          padding:20px;
          text-align:center;
          border-radius:8px;
        ">
          ${otp}
        </div>

        <p style="margin-top:20px;">
          This OTP will expire in 5 minutes.
        </p>

        <p>
          If you did not request this withdrawal,
          please secure your account immediately.
        </p>

        <br>

        <p>
          Team Xylos
        </p>
      </div>
      `,
    });

    res.json({
      success: true,
      message: "OTP sent successfully",
    });
  } catch (err) {
    console.log("SEND OTP ERROR:", err);

    res.status(500).json({
      error: "Failed to send OTP",
    });
  }
});

/* =========================================================
   RESEND OTP
========================================================= */
router.post("/resend-otp", async (req, res) => {
  try {
    const { user_id } = req.body;

    if (!user_id) {
      return res.status(400).json({
        error: "User id required",
      });
    }

    // remove old otp
    await pool.query(
      `DELETE FROM withdrawal_otp
       WHERE user_id = $1`,
      [user_id]
    );

    // call send otp logic again
    const userResult = await pool.query(
      `SELECT email, name FROM users WHERE id = $1`,
      [user_id]
    );

    if (!userResult.rowCount) {
      return res.status(404).json({
        error: "User not found",
      });
    }

    const user = userResult.rows[0];

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    await pool.query(
      `INSERT INTO withdrawal_otp
      (user_id, otp, expires_at)
      VALUES ($1, $2, NOW() + INTERVAL '5 minutes')`,
      [user_id, otp]
    );

    await resend.emails.send({
      from: process.env.FROM_EMAIL,
      to: user.email,
      subject: "Resend Withdrawal OTP",
      html: `
      <div style="font-family:Arial;padding:20px;">
        <h2>Withdrawal OTP</h2>

        <p>Your new OTP is:</p>

        <div style="
          font-size:32px;
          font-weight:bold;
          letter-spacing:8px;
          background:#f4f4f4;
          padding:20px;
          text-align:center;
          border-radius:8px;
        ">
          ${otp}
        </div>

        <p>Expires in 5 minutes.</p>
      </div>
      `,
    });

    res.json({
      success: true,
      message: "OTP resent successfully",
    });
  } catch (err) {
    console.log("RESEND OTP ERROR:", err);

    res.status(500).json({
      error: "Failed to resend OTP",
    });
  }
});

/* =========================================================
   VERIFY OTP
========================================================= */
router.post("/verify-otp", async (req, res) => {
  try {
    const { user_id, otp } = req.body;

    if (!user_id || !otp) {
      return res.status(400).json({
        error: "Missing fields",
      });
    }

    const result = await pool.query(
      `SELECT *
       FROM withdrawal_otp
       WHERE user_id = $1
       AND otp = $2
       AND expires_at > NOW()`,
      [user_id, otp]
    );

    if (!result.rowCount) {
      return res.status(400).json({
        error: "Invalid or expired OTP",
      });
    }

    // mark verified
    await pool.query(
      `UPDATE withdrawal_otp
       SET verified = true
       WHERE id = $1`,
      [result.rows[0].id]
    );

    res.json({
      success: true,
      message: "OTP verified",
    });
  } catch (err) {
    console.log("VERIFY OTP ERROR:", err);

    res.status(500).json({
      error: "OTP verification failed",
    });
  }
});


router.post("/create", async (req, res) => {
  const {
    user_id,
    wallet_address,
    description,
    amount,
    otp,
  } = req.body;

  try {
    if (
      !user_id ||
      !wallet_address ||
      !amount ||
      !otp
    ) {
      return res.status(400).json({
        error: "Missing required fields",
      });
    }

    // ===============================
    // ✅ VERIFY OTP FIRST
    // ===============================
  const otpCheck = await pool.query(
  `SELECT *
   FROM withdrawal_otp
   WHERE user_id = $1
   AND otp = $2
   AND expires_at > NOW()
   LIMIT 1`,
  [user_id, otp]
);

if (!otpCheck.rowCount) {
  return res.status(400).json({
    error: "Invalid or expired OTP",
  });
}

// prevent OTP reuse
await pool.query(
  `DELETE FROM withdrawal_otp
   WHERE id = $1`,
  [otpCheck.rows[0].id]
);

    // ===============================
    // ✅ CHECK PENDING REQUEST
    // ===============================
    const pendingCheck = await pool.query(
      `SELECT id
       FROM withdrawal_requests
       WHERE user_id = $1
       AND status = 'pending'`,
      [user_id]
    );

    if (pendingCheck.rows.length > 0) {
      return res.status(400).json({
        error:
          "You already have a pending withdrawal request",
      });
    }

    // ===============================
    // ✅ CHECK BALANCE
    // ===============================
    const userRes = await pool.query(
      "SELECT wallet_amount FROM users WHERE id = $1",
      [user_id]
    );

    if (userRes.rows.length === 0) {
      return res.status(404).json({
        error: "User not found",
      });
    }

    const balance = Number(
      userRes.rows[0].wallet_amount
    );

    if (Number(amount) <= 0) {
      return res.status(400).json({
        error: "Invalid amount",
      });
    }

    if (Number(amount) > balance) {
      return res.status(400).json({
        error: "Amount exceeds main wallet balance",
      });
    }

    // ===============================
    // ✅ INSERT REQUEST
    // ===============================
    const result = await pool.query(
      `INSERT INTO withdrawal_requests
      (user_id, wallet_address, description, amount)
      VALUES ($1, $2, $3, $4)
      RETURNING *`,
      [
        user_id,
        wallet_address,
        description,
        amount,
      ]
    );

    // ===============================
    // ✅ DELETE OTP AFTER SUCCESS
    // ===============================
    await pool.query(
      `DELETE FROM withdrawal_otp
       WHERE user_id = $1`,
      [user_id]
    );

    res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (err) {
    console.error("Create withdrawal error:", err);

    res.status(500).json({
      error: "Server error",
    });
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