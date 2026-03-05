const express = require("express");
const router = express.Router();
const pool = require("../db/db");
const bcrypt = require("bcryptjs");
const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

/* SEND RESET CODE */
router.post("/forgot-password", async (req, res) => {
  const { email } = req.body;

  const user = await pool.query("SELECT id FROM users WHERE email=$1", [email]);
  if (!user.rowCount) return res.status(404).json({ error: "Email not registered" });

  const code = Math.floor(100000 + Math.random() * 900000).toString();

  await pool.query("DELETE FROM password_resets WHERE email=$1", [email]);

  await pool.query(
    "INSERT INTO password_resets(email, code, expires_at) VALUES($1,$2,NOW()+INTERVAL '10 minutes')",
    [email, code]
  );

 await resend.emails.send({
  from: process.env.FROM_EMAIL,
  to: email,
  subject: "Xylos Password Reset Verification Code",
  html: `
  <div style="font-family: Arial, sans-serif; background:#f4f6f8; padding:30px;">
    <div style="max-width:520px; margin:auto; background:#ffffff; padding:30px; border-radius:8px;">
      
      <h2 style="color:#222;">Password Reset Request</h2>

      <p>
        We received a request to reset the password for your <strong>Xylos</strong> account.
        To continue with the password reset process, please use the verification code below.
      </p>

      <div style="text-align:center; margin:25px 0;">
        <div style="display:inline-block; padding:15px 25px; font-size:28px; letter-spacing:6px; 
        background:#f1f3f5; border-radius:6px; font-weight:bold;">
          ${code}
        </div>
      </div>

      <p>
        This verification code will remain valid for <strong>10 minutes</strong>.
        For security reasons, please do not share this code with anyone.
      </p>

      <p>
        If you did not request a password reset, you can safely ignore this email.
        Your account will remain secure.
      </p>

      <p style="margin-top:30px;">
        Regards,<br>
        <strong>Xylos Support Team</strong>
      </p>

    </div>
  </div>
  `,
});

  res.json({ success: true });
});

/* VERIFY CODE */
router.post("/verify-reset-code", async (req, res) => {
  const { email, code } = req.body;

  const result = await pool.query(
    "SELECT id FROM password_resets WHERE email=$1 AND code=$2 AND expires_at > NOW()",
    [email, code]
  );

  if (!result.rowCount) return res.status(400).json({ error: "Invalid or expired code" });

  await pool.query("UPDATE password_resets SET verified=true WHERE id=$1", [result.rows[0].id]);
  res.json({ success: true });
});

/* RESET PASSWORD */
router.post("/reset-password", async (req, res) => {
  const { email, password } = req.body;

  const check = await pool.query(
    "SELECT id FROM password_resets WHERE email=$1 AND verified=true",
    [email]
  );
  if (!check.rowCount) return res.status(403).json({ error: "Code not verified" });

  const hash = await bcrypt.hash(password, 10);
  await pool.query("UPDATE users SET password_hash=$1 WHERE email=$2", [hash, email]);
  await pool.query("DELETE FROM password_resets WHERE email=$1", [email]);

  res.json({ success: true });
});

module.exports = router;
