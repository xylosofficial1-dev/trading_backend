const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

async function sendKycApprovedEmail(email, name) {
  try {
    await resend.emails.send({
      from: process.env.FROM_EMAIL,
      to: email,
      subject: "KYC Approved Successfully",
      html: `
        <div style="font-family:Arial,sans-serif">
          <h2>Congratulations ${name || "User"} 🎉</h2>

          <p>Your KYC verification has been approved successfully.</p>

          <p>You can now access all verified features of your account.</p>

          <br>

          <p>Regards,<br>Xylos Team</p>
        </div>
      `,
    });

    console.log("KYC approval email sent:", email);
  } catch (err) {
    console.error("Email send error:", err);
  }
}

module.exports = {
  sendKycApprovedEmail,
};