const express = require("express");
const router = express.Router();
const pool = require("../db/db");
const processReferralTask = require("../utils/referralTaskProcessor");

router.get("/add-referral-deposit/:parentId", async (req, res) => {

  const { parentId } = req.params;

  try {

    const user = await pool.query(
      `
      INSERT INTO users
      (name, phone, email, password_hash, parent_id, trading_wallet_amount)
      VALUES
      (
        'TestUser',
        'test' || FLOOR(RANDOM()*100000),
        'test' || FLOOR(RANDOM()*100000) || '@mail.com',
        '1234',
        $1,
        100
      )
      RETURNING id
      `,
      [parentId]
    );

    await processReferralTask(user.rows[0].id);

    res.json({
      success: true,
      referralUserId: user.rows[0].id
    });

  } catch (err) {

    console.error(err);

    res.status(500).json({ error: "test failed" });

  }

});

module.exports = router;