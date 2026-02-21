// backend/routes/payOptionsRoutes.js
const express = require("express");
const router = express.Router();
const pool = require("../db/db");
const multer = require("multer");

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
});

/* ADD / REPLACE PAY OPTION */
router.post("/", upload.single("qrCode"), async (req, res) => {
  try {
    const { coinName, address } = req.body;
    const qrImage = req.file ? req.file.buffer : null;

    if (!coinName || !address) {
      return res.status(400).json({ error: "Missing data" });
    }

    await pool.query(
      `
      INSERT INTO pay_options (id, coin_name, wallet_address, qr_image)
      VALUES (1, $1, $2, $3)
      ON CONFLICT (id)
      DO UPDATE SET
        coin_name = EXCLUDED.coin_name,
        wallet_address = EXCLUDED.wallet_address,
        qr_image = EXCLUDED.qr_image
      `,
      [coinName, address, qrImage]
    );

    res.json({ success: true, message: "Pay option updated" });
  } catch (err) {
    console.error("PAY OPTION ERROR:", err);
    res.status(500).json({ error: "Failed to save pay option" });
  }
});

router.get("/", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        coin_name,
        wallet_address,
        encode(qr_image, 'base64') AS qr_image
      FROM pay_options
      WHERE id = 1
    `);

    res.json(result.rows[0] || null);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch pay option" });
  }
});

module.exports = router;
