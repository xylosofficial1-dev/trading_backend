const express = require("express");
const router = express.Router();
const pool = require("../db/db");


router.post("/create", async (req, res) => {
  const { phone, email, group_name, description } = req.body;

  try {
    if (!phone || !email || !description) {
      return res.status(400).json({ error: "Required fields missing" });
    }

    const result = await pool.query(
      `
      INSERT INTO support_requests 
      (id, phone, email, group_name, description)
      VALUES (1, $1, $2, $3, $4)
      ON CONFLICT (id)
      DO UPDATE SET
        phone = EXCLUDED.phone,
        email = EXCLUDED.email,
        group_name = EXCLUDED.group_name,
        description = EXCLUDED.description,
        created_at = CURRENT_TIMESTAMP
      RETURNING *;
      `,
      [phone, email, group_name, description]
    );

    res.json({
      message: "Saved successfully (single row)",
      data: result.rows[0],
    });
  } catch (err) {
    console.log("Support Create Error:", err);
    res.status(500).json({ error: "Server error" });
  }
});


router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM support_requests WHERE id = 1`
    );

    res.json(result.rows[0] || null);
  } catch (err) {
    console.log("Support Fetch Error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;