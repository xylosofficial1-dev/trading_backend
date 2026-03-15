const express = require("express");
const router = express.Router();
const pool = require("../db/db");
const bcrypt = require("bcryptjs");
const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

// store OTP temporarily
const otpStore = new Map();

/*
SEND OTP
*/
router.post("/send-otp", async (req, res) => {
  try {
    const { email } = req.body;

    const user = await pool.query(
      "SELECT id FROM users WHERE email=$1",
      [email]
    );

    if (user.rows.length === 0) {
      return res.status(404).json({ message: "Email not registered" });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    otpStore.set(email, {
      otp,
      expires: Date.now() + 5 * 60 * 1000, // 5 minutes
    });

    await resend.emails.send({
  from: process.env.FROM_EMAIL,
  to: email,
  subject: "Xylos MPIN Reset OTP",
  html: `
  <div style="font-family: Arial, sans-serif; background:#f4f4f4; padding:40px 20px;">
    <div style="max-width:500px; margin:auto; background:#ffffff; border-radius:10px; padding:30px; text-align:center; box-shadow:0 4px 12px rgba(0,0,0,0.1);">
      
      <h2 style="color:#111; margin-bottom:10px;">MPIN Reset Request</h2>
      
      <p style="color:#555; font-size:15px; margin-bottom:25px;">
        We received a request to reset your <strong>Xylos MPIN</strong>.
        Use the OTP below to continue the process.
      </p>

      <div style="
        font-size:28px;
        letter-spacing:6px;
        font-weight:bold;
        color:#000;
        background:#FFD700;
        padding:14px 20px;
        border-radius:8px;
        display:inline-block;
        margin-bottom:25px;
      ">
        ${otp}
      </div>

      <p style="color:#666; font-size:14px; margin-bottom:10px;">
        This OTP is valid for <strong>5 minutes</strong>.
      </p>

      <p style="color:#999; font-size:13px; margin-top:20px;">
        If you did not request this, please ignore this email.
      </p>

      <hr style="margin:30px 0; border:none; border-top:1px solid #eee;" />

      <p style="color:#aaa; font-size:12px;">
        © ${new Date().getFullYear()} Xylos. All rights reserved.
      </p>

    </div>
  </div>
  `
});

    res.json({ success: true, message: "OTP sent" });

  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Server error" });
  }
});

/*
VERIFY OTP
*/
router.post("/verify-otp", (req, res) => {
  const { email, otp } = req.body;

  const record = otpStore.get(email);

  if (!record) {
    return res.status(400).json({ message: "OTP not found" });
  }

  if (Date.now() > record.expires) {
    otpStore.delete(email);
    return res.status(400).json({ message: "OTP expired" });
  }

  if (record.otp !== otp) {
    return res.status(400).json({ message: "Invalid OTP" });
  }

  res.json({ success: true });
});
  
/*
RESET MPIN
*/
router.post("/reset", async (req, res) => {
  try {
    const { email, newMpin } = req.body;

    const hashed = await bcrypt.hash(newMpin, 10);

   await pool.query(
  "UPDATE users SET mpin_hash=$1 WHERE email=$2",
  [hashed, email]
);

    otpStore.delete(email);

    res.json({ success: true, message: "MPIN updated" });

  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;