// backend/routes/userRoutes.js
const express = require("express");
const router = express.Router();
const pool = require("../db/db");
const { Resend } = require("resend");
const bcrypt = require("bcryptjs");

const multer = require("multer");
const upload = multer({ limits: { fileSize: 2 * 1024 * 1024 } });

const crypto = require("crypto");
const jwt = require("jsonwebtoken");

function generateReferralCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "XYL";
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function generateWallet() {
  return "bc1q" + crypto.randomBytes(20).toString("hex").slice(0, 39);
}

const resend = new Resend(process.env.RESEND_API_KEY);

/* ================= SEND OTP ================= */
router.post("/send-otp", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email required" });

    // 🚫 Already registered?
    const existingUser = await pool.query(
      "SELECT id FROM users WHERE email=$1 AND is_verified=true",
      [email]
    );

    if (existingUser.rowCount)
      return res.status(409).json({ error: "Mail already registered" });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Remove old OTPs
    await pool.query("DELETE FROM otp_verifications WHERE email=$1", [email]);

    await pool.query(
      "INSERT INTO otp_verifications(email, otp, expires_at) VALUES($1,$2,NOW()+INTERVAL '5 minutes')",
      [email, otp]
    );

  await resend.emails.send({
  from: process.env.FROM_EMAIL,
  to: email,
  subject: "Welcome to Xylos – Your Verification Code",
  html: `
  <div style="font-family: Arial, sans-serif; line-height:1.6; color:#333;">
    
    <h2 style="color:#2c7be5;">Welcome to Xylos 🚀</h2>

    <p>
      Thank you for joining <strong>Xylos</strong>. We’re excited to have you as part of our community. 
      To complete your verification and continue using the platform securely, please use the 
      One-Time Password (OTP) below.
    </p>

    <div style="margin:20px 0; padding:15px; background:#f4f6f8; text-align:center; border-radius:6px;">
      <h1 style="letter-spacing:5px; margin:0;">${otp}</h1>
    </div>

    <p>
      This verification code is valid for <strong>5 minutes</strong>. Please do not share this code 
      with anyone for security reasons.
    </p>

    <p>
      If you did not request this verification, you can safely ignore this email.
    </p>

    <p>
      Welcome aboard,<br>
      <strong>The Xylos Team</strong>
    </p>

  </div>
  `,
});

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to send OTP" });
  }
});

/* ================= VERIFY OTP ================= */
router.post("/verify-otp", async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ error: "Missing data" });

    const result = await pool.query(
      "SELECT id FROM otp_verifications WHERE email=$1 AND otp=$2 AND expires_at > NOW()",
      [email, otp]
    );

    if (!result.rowCount)
      return res.status(400).json({ error: "Invalid or expired OTP" });

    await pool.query(
      "UPDATE otp_verifications SET verified=true WHERE id=$1",
      [result.rows[0].id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "OTP verification failed" });
  }
});

router.post("/register", async (req, res) => {
  try {
    const {
      name, phone, email, password, dob, gender,
      countryCode, referralCode
    } = req.body;

    // OTP verified check
    const verified = await pool.query(
      "SELECT id FROM otp_verifications WHERE email=$1 AND verified=true",
      [email]
    );
    if (!verified.rowCount)
      return res.status(403).json({ error: "Email not verified" });

    // already exists
    const existing = await pool.query(
      "SELECT id FROM users WHERE email=$1 OR phone=$2",
      [email, phone]
    );
    if (existing.rowCount)
      return res.status(409).json({ error: "User already exists" });

    let parentId = null;

    if (referralCode) {
      const parent = await pool.query(
        "SELECT id FROM users WHERE referral_code=$1",
        [referralCode]
      );

      if (!parent.rowCount)
        return res.status(400).json({ error: "Invalid referral code" });

      parentId = parent.rows[0].id;
    }

    const hash = await bcrypt.hash(password, 10);
    const walletAddress = generateWallet();
    const myReferral = generateReferralCode();

    const newUser = await pool.query(
      `INSERT INTO users
      (name, phone, email, password_hash, dob, gender, country_code,
       is_verified, wallet_address, wallet_amount, referral_code, parent_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,true,$8,0,$9,$10)
       RETURNING id, name, email, phone, wallet_address, wallet_amount`,
      [
        name, phone, email, hash, dob, gender, countryCode,
        walletAddress, myReferral, parentId
      ]
    );

    await pool.query("DELETE FROM otp_verifications WHERE email=$1", [email]);

    const user = newUser.rows[0];

    // 🔐 Generate JWT
    const token = jwt.sign(
      { id: user.id },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      success: true,
      token,
      user,
      referralCode: myReferral
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Registration failed" });
  }
});

router.get("/profile/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);

    if (!id) {
      return res.status(400).json({ error: "Invalid user id" });
    }

    const result = await pool.query(
      `SELECT 
          u.*,
          p.referral_code AS parent_referral_code
       FROM users u
       LEFT JOIN users p ON u.parent_id = p.id
       WHERE u.id = $1`,
      [id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json(result.rows[0]);

  } catch (err) {
    console.error("PROFILE ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/profile/upload-image/:id", upload.single("image"), async (req, res) => {
  try {
    const buffer = req.file.buffer;
    const { id } = req.params;

    await pool.query("UPDATE users SET profile_image=$1 WHERE id=$2", [buffer, id]);

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Image upload failed" });
  }
});

/* ================= UPDATE PROFILE ================= */
router.put("/profile/update/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name, dob, gender } = req.body;

    await pool.query(
      `UPDATE users 
       SET name=$1, dob=$2, gender=$3
       WHERE id=$4`,
      [name, dob, gender, id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Profile update failed" });
  }
});

/* ================= GET ALL USERS ================= */
router.get("/all", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id,
        name,
        phone,
        email,
        dob,
        gender,
        country_code,
        is_verified,
        status,
        wallet_address,
        wallet_amount,
        trading_wallet_amount,
        tw_to_mw,
        created_at
      FROM users
      ORDER BY id DESC
    `);

    res.status(200).json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (err) {
    console.error("Fetch users error:", err);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

router.put("/users/:id/status", async (req, res) => {
  const { id } = req.params;
  const { status } = req.body; // ok | block

  try {
    await pool.query(
      "UPDATE users SET status = $1 WHERE id = $2",
      [status, id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to update status" });
  }
});

router.get("/user-status/:id", async (req, res) => {
  const { id } = req.params;

  const result = await pool.query(
    "SELECT status FROM users WHERE id = $1",
    [id]
  );

  if (!result.rowCount) {
    return res.status(404).json({ error: "User not found" });
  }

  if (result.rows[0].status === "block") {
    return res.status(403).json({ error: "User blocked" });
  }

  res.json({ success: true });
});


router.post("/wallet/send", async (req, res) => {
  const { senderId, recipientAddress, amount } = req.body;

  if (!amount || Number(amount) <= 0)
    return res.status(400).json({ error: "Invalid amount" });

  try {
    // Sender wallet
    const sender = await pool.query(
      "SELECT wallet_amount FROM users WHERE id=$1",
      [senderId]
    );

    if (!sender.rowCount)
      return res.status(404).json({ error: "Sender not found" });

    if (Number(sender.rows[0].wallet_amount) < Number(amount))
      return res.status(400).json({ error: "Insufficient wallet balance" });

    // Recipient by wallet_address
    const recipient = await pool.query(
      "SELECT id FROM users WHERE wallet_address=$1",
      [recipientAddress]
    );

    if (!recipient.rowCount)
      return res.status(404).json({ error: "Check recipient address" });

    // Transaction
    await pool.query("BEGIN");

    await pool.query(
      "UPDATE users SET wallet_amount = wallet_amount - $1 WHERE id=$2",
      [amount, senderId]
    );

    await pool.query(
      "UPDATE users SET wallet_amount = wallet_amount + $1 WHERE id=$2",
      [amount, recipient.rows[0].id]
    );

    await pool.query("COMMIT");

    res.json({ success: true, message: "Transfer successful" });
  } catch (err) {
    await pool.query("ROLLBACK");
    res.status(500).json({ error: "Wallet transfer failed" });
  }
});

/* =========================================
   CHECK COMMISSION LOCK
   GET /api/system/commission-status
========================================= */
router.get("/commission-status", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT last_run FROM commission_runs ORDER BY id DESC LIMIT 1`
    );

    if (!result.rowCount) {
      return res.json({ locked: false });
    }

    const lastRun = new Date(result.rows[0].last_run);
    const now = new Date();

    const diff = (now - lastRun) / (1000 * 60 * 60);

    if (diff < 24) {
      const remaining = (24 - diff).toFixed(2);
      return res.json({
        locked: true,
        remaining,
      });
    }

    res.json({ locked: false });
  } catch (err) {
    console.error("COMMISSION STATUS ERROR:", err);
    res.status(500).json({ error: "Failed to check status" });
  }
});
router.post("/trade", async (req, res) => {
  const { userId, coin, tradeType, price, quantity } = req.body;
  const total = price * quantity;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const userRes = await client.query(
      "SELECT name, email, trading_wallet_amount FROM users WHERE id = $1 FOR UPDATE",
      [userId]
    );

    if (userRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "User not found" });
    }

    const { name, email, trading_wallet_amount } = userRes.rows[0];
let walletAmount = Number(trading_wallet_amount);

    // ❌ BUY CHECK
    if (tradeType === "buy" && walletAmount < total) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Insufficient balance" });
    }

const newWallet = walletAmount - total; // always deduct

    await client.query(
      "UPDATE users SET trading_wallet_amount = $1 WHERE id = $2",
      [newWallet, userId]
    );

    // ✅ STORE TRADE HISTORY
    await client.query(
      `INSERT INTO trades
      (user_id, name, email, coin, trade_type, price, quantity, total)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [userId, name, email, coin, tradeType, price, quantity, total]
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      newWallet,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ message: "Trade failed" });
  } finally {
    client.release();
  }
});

router.get("/referrals/:id/count", async (req, res) => {
  const { id } = req.params;

  const result = await pool.query(
    "SELECT COUNT(*) FROM users WHERE parent_id=$1",
    [id]
  );

  res.json({ total: result.rows[0].count });
});

router.get("/referrals/:id/tree", async (req, res) => {
  const { id } = req.params;

  const result = await pool.query(`
    WITH RECURSIVE referral_tree AS (
      SELECT id, name, parent_id
      FROM users
      WHERE parent_id = $1   -- ⭐ start from children (NOT self)

      UNION ALL

      SELECT u.id, u.name, u.parent_id
      FROM users u
      INNER JOIN referral_tree rt ON u.parent_id = rt.id
    )
    SELECT * FROM referral_tree;
  `, [id]);

  res.json(result.rows);
});

router.post("/referrals/set-parent", async (req, res) => {
  const { userId, referralCode } = req.body;

  try {
    // get own code
    const me = await pool.query(
      "SELECT referral_code, parent_id FROM users WHERE id=$1",
      [userId]
    );

    if (!me.rowCount)
      return res.status(404).json({ error: "User not found" });

    // already linked
    if (me.rows[0].parent_id)
      return res.status(400).json({ error: "Referrer already set" });

    // ❌ own code
    if (me.rows[0].referral_code === referralCode)
      return res.status(400).json({ error: "You cannot use your own referral code" });

    // check exists
    const parent = await pool.query(
      "SELECT id FROM users WHERE referral_code=$1",
      [referralCode]
    );

    if (!parent.rowCount)
      return res.status(404).json({ error: "Invalid referral code" });

    await pool.query(
      "UPDATE users SET parent_id=$1 WHERE id=$2",
      [parent.rows[0].id, userId]
    );

    res.json({ success: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to set referrer" });
  }
});

router.post("/online", async (req, res) => {
  try {
    const { user_id, status } = req.body;

    console.log("USER:", user_id);
    console.log("STATUS:", status);

    if (status === undefined) {

      // heartbeat → only update last_seen
      await pool.query(
        `UPDATE users
         SET last_seen = NOW()
         WHERE id = $1`,
        [user_id]
      );

    } else {

      // manual online/offline
      await pool.query(
        `UPDATE users
         SET is_online = $2,
             last_seen = NOW()
         WHERE id = $1`,
        [user_id, status]
      );

    }

    res.json({ success: true });

  } catch (err) {
    console.log(err);
    res.status(500).json({ success: false });
  }
});

router.get("/account-status/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT 
        last_seen,
        is_online,
        CASE
          WHEN last_seen < NOW() - INTERVAL '30 seconds'
          THEN false
          ELSE is_online
        END AS computed_online
      FROM users
      WHERE id=$1`,
      [id]
    );

    const row = result.rows[0];

    if (!row) return res.status(404).json({ error: "User not found" });

    // auto set offline if heartbeat stopped
    if (row.last_seen < new Date(Date.now() - 30000)) {
      await pool.query(
        `UPDATE users SET is_online = false WHERE id=$1`,
        [id]
      );
    }

    res.json({
      is_online: row.computed_online,
      last_seen: row.last_seen
    });

  } catch (err) {
    console.log(err);
  }
});



module.exports = router;
