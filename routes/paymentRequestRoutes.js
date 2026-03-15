// backend/routes/paymentRequestRoutes.js
const express = require("express");
const router = express.Router();
const pool = require("../db/db");
const multer = require("multer");
const processReferralTask = require("../utils/referralTaskProcessor");

const upload = multer({ storage: multer.memoryStorage() });

router.post( "/submit",
  upload.single("screenshot"),
  async (req, res) => {
    try {
      const { userId, amount_usd } = req.body;
const tx_hash = req.body.tx_hash.trim().toLowerCase();


      if (!userId || !tx_hash || !amount_usd || !req.file) {
        return res.status(400).json({ message: "Missing data" });
      }

      // 🔒 Check pending request
      const pending = await pool.query(
        `SELECT id FROM payment_requests
         WHERE user_id=$1 AND status='pending'`,
        [userId]
      );

      if (pending.rowCount > 0) {
        return res.status(409).json({
          message: "Please wait minimum 1 hour for admin approval",
        });
      }

      await pool.query(
        `
        INSERT INTO payment_requests
          (user_id, tx_hash, amount_usd, screenshot)
        VALUES ($1,$2,$3,$4)
        `,
        [userId, tx_hash, amount_usd, req.file.buffer]
      );

      res.json({ success: true });
   } catch (err) {
  console.error("SUBMIT ERROR:", err);

  // 🔁 Duplicate tx_hash
  if (err.code === "23505") {
    return res.status(409).json({
      message: "This transaction hash is already used"
    });
  }

  res.status(500).json({ message: "Server error" });
}
  }
);

router.get("/admin/pending", async (req, res) => {
  const result = await pool.query(`
    SELECT pr.*, u.email
    FROM payment_requests pr
    JOIN users u ON u.id = pr.user_id
    WHERE pr.status='pending'
    ORDER BY pr.created_at ASC
  `);

  res.json(result.rows);
});

router.post("/admin/update-status", async (req, res) => {
  const { requestId, status, reason } = req.body;

  if (!["approved", "rejected"].includes(status)) {
    return res.status(400).json({ message: "Invalid status" });
  }

  const result = await pool.query(
    `
    UPDATE payment_requests
    SET status=$1,
        admin_reason=$2,
        updated_at=NOW()
    WHERE id=$3
    RETURNING user_id
    `,
    [status, reason || null, requestId]
  );

  const userId = result.rows[0].user_id;

  // 🔔 Notification
  await pool.query(
    `
    INSERT INTO notifications
      (title, message, target_type, target_users)
    VALUES ($1,$2,'custom',$3)
    `,
    [
      "Payment Update",
      status === "approved"
        ? "Admin accepted your payment"
        : `Admin rejected your payment: ${reason}`,
      userId.toString()
    ]
  );

  res.json({ success: true });
});

router.get("/status/:userId", async (req, res) => {
  const { userId } = req.params;

  const result = await pool.query(
    `SELECT id FROM payment_requests WHERE user_id=$1 AND status='pending'`,
    [userId]
  );

  res.json({ pending: result.rowCount > 0 });
});

// 🔐 Admin: fetch all payment requests
router.get("/admin/all", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        pr.id,
        pr.user_id,
        u.email,
        pr.tx_hash,
        pr.amount_usd,
        pr.screenshot,
        pr.status,
        pr.admin_reason,
        pr.created_at,
        pr.updated_at
      FROM payment_requests pr
      JOIN users u ON u.id = pr.user_id
      ORDER BY pr.created_at DESC
    `);

    const data = result.rows.map(row => ({
      ...row,
      screenshot: row.screenshot
        ? Buffer.from(row.screenshot).toString("base64")
        : null
    }));

    res.json(data);
  } catch (err) {
    console.error("ADMIN FETCH ALL ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
});

router.put("/:id/approve", async (req, res) => {
  const paymentId = req.params.id;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1️⃣ Lock payment row
    const paymentRes = await client.query(
      `SELECT * FROM payment_requests WHERE id = $1 FOR UPDATE`,
      [paymentId]
    );

    if (paymentRes.rowCount === 0) {
      throw new Error("Payment request not found");
    }

    const payment = paymentRes.rows[0];

    if (payment.status !== "pending") {
      throw new Error("Payment already processed");
    }

    // 2️⃣ Update payment status
    await client.query(
      `UPDATE payment_requests
       SET status = 'approved', updated_at = NOW()
       WHERE id = $1`,
      [paymentId]
    );

    // 3️⃣ Add amount to user wallet
    await client.query(
      `UPDATE users
       SET wallet_amount = wallet_amount + $1
       WHERE id = $2`,
      [payment.amount_usd, payment.user_id]
    );
    await processReferralTask(payment.user_id);

    // 4️⃣ Insert notification
    await client.query(
  `
  INSERT INTO notifications
    (title, message, target_type, target_users)
  VALUES ($1, $2, 'custom', $3)
  `,
  [
    "Wallet Credited",
    `✅ Your wallet has been credited with $${payment.amount_usd}.`,
    payment.user_id.toString()
  ]
);

    await client.query("COMMIT");

    res.json({ message: "Payment approved successfully" });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);

    res.status(400).json({
      message: err.message || "Failed to approve payment"
    });
  } finally {
    client.release();
  }
});

router.put("/:id/reject", async (req, res) => {
  const paymentId = req.params.id;
  const { reason } = req.body;

  if (!reason || !reason.trim()) {
    return res.status(400).json({
      message: "Rejection reason is required"
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1️⃣ Lock payment row
    const paymentRes = await client.query(
      `SELECT * FROM payment_requests WHERE id = $1 FOR UPDATE`,
      [paymentId]
    );

    if (paymentRes.rowCount === 0) {
      throw new Error("Payment request not found");
    }

    const payment = paymentRes.rows[0];

    if (payment.status !== "pending") {
      throw new Error("Payment already processed");
    }

    // 2️⃣ Update payment status + reason
    await client.query(
      `UPDATE payment_requests
       SET status = 'rejected',
           admin_reason = $1,
           updated_at = NOW()
       WHERE id = $2`,
      [reason.trim(), paymentId]
    );

    // 3️⃣ Insert notification
   await client.query(
  `
  INSERT INTO notifications
    (title, message, target_type, target_users)
  VALUES ($1, $2, 'custom', $3)
  `,
  [
    "Payment Rejected",
    `❌ Your payment request was rejected. Reason: ${reason}`,
    payment.user_id.toString()
  ]
);

    await client.query("COMMIT");

    res.json({ message: "Payment rejected successfully" });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);

    res.status(400).json({
      message: err.message || "Failed to reject payment"
    });
  } finally {
    client.release();
  }
});


module.exports = router;
