const express = require("express");
const router = express.Router();
const pool = require("../db/db");
const bcrypt = require("bcrypt");

/* ==========================
   SET MPIN
========================== */

router.post("/set", async (req, res) => {
  try {
    const { userId, mpin } = req.body;

    if (!userId || !mpin || mpin.length !== 4) {
      return res.status(400).json({ error: "Invalid MPIN" });
    }

    const hash = await bcrypt.hash(mpin, 10);

    await pool.query(
      `UPDATE users
       SET mpin_hash=$1
       WHERE id=$2`,
      [hash, userId]
    );

    res.json({ success: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to set MPIN" });
  }
});


/* ==========================
   VERIFY MPIN
========================== */

router.post("/verify", async (req, res) => {
  try {

    const { userId, mpin } = req.body;

    const user = await pool.query(
      `SELECT mpin_hash
       FROM users
       WHERE id=$1`,
      [userId]
    );

    if (!user.rows.length) {
      return res.status(404).json({ error: "User not found" });
    }

    const valid = await bcrypt.compare(
      mpin,
      user.rows[0].mpin_hash
    );

    if (!valid) {
      return res.status(401).json({ error: "Wrong MPIN" });
    }

    res.json({ success: true });

  } catch (err) {
    res.status(500).json({ error: "Verify failed" });
  }
});


/* ==========================
   CHECK MPIN EXISTS
========================== */

router.get("/exists/:userId", async (req, res) => {

  const { userId } = req.params;

  const result = await pool.query(
    `SELECT mpin_hash
     FROM users
     WHERE id=$1`,
    [userId]
  );

  res.json({
    exists: !!result.rows[0]?.mpin_hash
  });

});

module.exports = router;