const express = require("express");
const router = express.Router();
const pool = require("../db/db");

const rewardRules = [
  { deposit: 100, referrals: 10, reward: 75 },
  { deposit: 100, referrals: 35, reward: 275 },
  { deposit: 100, referrals: 85, reward: 755 },
  { deposit: 100, referrals: 185, reward: 1755 },

  { deposit: 350, referrals: 10, reward: 300 },
  { deposit: 350, referrals: 35, reward: 1000 },
  { deposit: 350, referrals: 85, reward: 2700 },
  { deposit: 350, referrals: 185, reward: 6500 },

  { deposit: 850, referrals: 10, reward: 700 },
  { deposit: 850, referrals: 35, reward: 2200 },
  { deposit: 850, referrals: 85, reward: 5200 },
  { deposit: 850, referrals: 185, reward: 12200 },

  { deposit: 1850, referrals: 10, reward: 1200 },
  { deposit: 1850, referrals: 35, reward: 4200 },
  { deposit: 1850, referrals: 85, reward: 11200 },
  { deposit: 1850, referrals: 185, reward: 23200 },
];

router.get("/run/:parentId", async (req, res) => {

  const { parentId } = req.params;

  try {

    for (const rule of rewardRules) {

      const result = await pool.query(
        `
        SELECT COUNT(*) 
        FROM users
        WHERE parent_id = $1
        AND trading_wallet_amount >= $2
        `,
        [parentId, rule.deposit]
      );

      const activeReferrals = parseInt(result.rows[0].count);

      if (activeReferrals >= rule.referrals) {

        await pool.query(
          `
          UPDATE users
          SET wallet_amount = wallet_amount + $1
          WHERE id = $2
          `,
          [rule.reward, parentId]
        );

        await pool.query(
          `
          INSERT INTO notifications
          (title,message,target_type,target_users)
          VALUES ($1,$2,'custom',$3)
          `,
          [
            "Referral Task Income",
            `🎉 You received $${rule.reward} reward for ${rule.referrals} active referrals.`,
            parentId.toString()
          ]
        );

      }

    }

    res.json({
      success: true,
      message: "Referral task income checked"
    });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: "Server error"
    });

  }

});

router.get("/test/add-referral/:parentId", async (req, res) => {
  const { parentId } = req.params;

  try {

    const newUser = await pool.query(
      `
      INSERT INTO users (name, phone, email, password_hash, parent_id)
      VALUES (
        'TestUser',
        'test' || FLOOR(RANDOM()*1000000),
        'test' || FLOOR(RANDOM()*1000000) || '@mail.com',
        'test',
        $1
      )
      RETURNING id
      `,
      [parentId]
    );

    res.json({
      success: true,
      message: "Referral added",
      referralUserId: newUser.rows[0].id
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to add referral" });
  }
});

router.get("/test/remove-referral/:parentId", async (req, res) => {
  const { parentId } = req.params;

  try {

    const ref = await pool.query(
      `
      SELECT id
      FROM users
      WHERE parent_id = $1
      ORDER BY id DESC
      LIMIT 1
      `,
      [parentId]
    );

    if (ref.rowCount === 0) {
      return res.json({ message: "No referrals found" });
    }

    await pool.query(
      `DELETE FROM users WHERE id=$1`,
      [ref.rows[0].id]
    );

    res.json({
      success: true,
      message: "Referral removed"
    });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: "Failed to remove referral"
    });

  }
});

router.get("/test/add-referral-deposit/:parentId", async (req, res) => {
  const { parentId } = req.params;

  try {

    const newUser = await pool.query(
      `
      INSERT INTO users
      (name, phone, email, password_hash, parent_id, trading_wallet_amount)
      VALUES
      (
        'TestReferral',
        'test' || FLOOR(RANDOM()*1000000),
        'test' || FLOOR(RANDOM()*1000000) || '@mail.com',
        '1234',
        $1,
        100
      )
      RETURNING id
      `,
      [parentId]
    );

    res.json({
      success: true,
      message: "Referral added with $100 trading wallet",
      referralUserId: newUser.rows[0].id
    });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: "Test referral creation failed"
    });

  }

});

module.exports = router;