// backend/routes/referralTaskIncomeRoutes.js
const express = require("express");
const router = express.Router();
const pool = require("../db/db");

const {checkReferralFundReward} = require("../services/referralFundService");

const rewardRules = [

{ deposit:100, referrals:10, reward:75 },
{ deposit:100, referrals:35, reward:275 },
{ deposit:100, referrals:85, reward:755 },
{ deposit:100, referrals:185, reward:1755 },

{ deposit:350, referrals:10, reward:300 },
{ deposit:350, referrals:35, reward:1000 },
{ deposit:350, referrals:85, reward:2700 },
{ deposit:350, referrals:185, reward:6500 },

{ deposit:850, referrals:10, reward:700 },
{ deposit:850, referrals:35, reward:2200 },
{ deposit:850, referrals:85, reward:5200 },
{ deposit:850, referrals:185, reward:12200 },

{ deposit:1850, referrals:10, reward:1200 },
{ deposit:1850, referrals:35, reward:4200 },
{ deposit:1850, referrals:85, reward:11200 },
{ deposit:1850, referrals:185, reward:23200 }

];

router.get("/check-rewards/:parentId", async (req, res) => {

const { parentId } = req.params;

try {

const rewardsEarned = [];

for (const rule of rewardRules) {

const exist = await pool.query(
`
SELECT id FROM referral_fund_rewards
WHERE parent_id = $1
AND fund_level = $2
AND referral_target = $3
`,
[parentId, rule.deposit, rule.referrals]
);

if (exist.rows.length > 0) continue;

const refs = await pool.query(
`
SELECT COUNT(*) 
FROM users
WHERE parent_id = $1
AND trading_wallet_amount >= $2
`,
[parentId, rule.deposit]
);

const count = Number(refs.rows[0].count);

if (count >= rule.referrals) {

await pool.query("BEGIN");

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
INSERT INTO referral_fund_rewards
(parent_id, fund_level, referral_target, reward_amount)
VALUES ($1,$2,$3,$4)
`,
[parentId, rule.deposit, rule.referrals, rule.reward]
);
await pool.query(
`
INSERT INTO referral_fund_rewards
(parent_id, fund_level, referral_target, reward_amount)
VALUES ($1,$2,$3,$4)
`,
[parentId, rule.deposit, rule.referrals, rule.reward]
);

await pool.query(
`
INSERT INTO notifications
(title,message,target_type,target_users)
VALUES ($1,$2,'custom',$3)
`,
[
"Referral Reward Earned",
`You earned $${rule.reward} for completing ${rule.referrals} referrals with $${rule.deposit} deposits.`,
String(parentId)
]
);

await pool.query("COMMIT");

rewardsEarned.push(rule);

}

}

res.json({
success:true,
rewardsEarned
});

} catch (err) {

await pool.query("ROLLBACK");
console.error(err);

res.status(500).json({error:"server error"});
}

});

// Get dashboard data
router.get("/dashboard/:parentId", async (req, res) => {
  const { parentId } = req.params;

  try {
    // Get user info
    const userInfo = await pool.query(
      `SELECT id, name, email, wallet_amount 
       FROM users WHERE id = $1`,
      [parentId]
    );

    // Get total referrals count
    const totalRefs = await pool.query(
      `SELECT COUNT(*) as count 
       FROM users WHERE parent_id = $1`,
      [parentId]
    );

    // Get deposit stats for each level
    const depositStats = await pool.query(
      `SELECT 
        COUNT(*) FILTER (WHERE trading_wallet_amount >= 100) as level1,
COUNT(*) FILTER (WHERE trading_wallet_amount >= 350) as level2,
COUNT(*) FILTER (WHERE trading_wallet_amount >= 850) as level3,
COUNT(*) FILTER (WHERE trading_wallet_amount >= 1850) as level4
       FROM users
       WHERE parent_id = $1`,
      [parentId]
    );

    // Get reward history
    const rewards = await pool.query(
      `SELECT * FROM referral_fund_rewards 
WHERE parent_id = $1 
ORDER BY created_at DESC`,
      [parentId]
    );

    // Get recent notifications
    const notifications = await pool.query(
      `SELECT *
FROM notifications
WHERE
target_type = 'all'
OR (
  target_type = 'custom'
  AND target_users LIKE '%' || $1 || '%'
)
ORDER BY created_at DESC
LIMIT 10`,
      [parentId]
    );

   const levels = [
{ name: "$100 Task", deposit:100, targets:[10,35,85,185], rewards:[75,275,755,1755] },

{ name: "$250 Task", deposit:350, targets:[10,35,85,185], rewards:[300,1000,2700,6500] },

{ name: "$500 Task", deposit:850, targets:[10,35,85,185], rewards:[700,2200,5200,12200] },

{ name: "$1000 Task", deposit:1850, targets:[10,35,85,185], rewards:[1200,4200,11200,23200] }
];

    const progress = levels.map(level => {
      const count = parseInt(depositStats.rows[0][`level${levels.indexOf(level) + 1}`] || 0);
      const nextTarget = level.targets.find(t => t > count) || level.targets[level.targets.length - 1];
      const currentReward = level.targets.reduce((reward, target, index) => {
        return count >= target ? level.rewards[index] : reward;
      }, 0);
      
      return {
        ...level,
        currentCount: count,
        nextTarget,
        progress: Math.min((count / nextTarget) * 100, 100),
        currentReward,
        completed: count >= level.targets[level.targets.length - 1]
      };
    });

    res.json({
      user: userInfo.rows[0],
      totalReferrals: parseInt(totalRefs.rows[0].count),
      depositStats: depositStats.rows[0],
      rewards: rewards.rows,
      notifications: notifications.rows,
      progress
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// Get referral list with deposit status
router.get("/referrals/:parentId", async (req, res) => {
  const { parentId } = req.params;

  try {
    const referrals = await pool.query(
      `SELECT id, name, email, trading_wallet_amount, 
              created_at, last_active
       FROM users 
       WHERE parent_id = $1
       ORDER BY created_at DESC`,
      [parentId]
    );

    res.json({
      referrals: referrals.rows
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/deposit", async(req,res)=>{

const {userId,amount} = req.body;

await pool.query(
`
UPDATE users
SET trading_wallet_amount = trading_wallet_amount + $1
WHERE id=$2
`,
[amount,userId]
);

// check rewards
await checkReferralFundReward(userId);

res.json({message:"Deposit added"});

});

router.get("/test/:userId", async (req, res) => {
  try {

    const { userId } = req.params;
    const fund = Number(req.query.fund || 250);

    let requiredWallet = 350;

    if (fund == 150) requiredWallet = 100;
    if (fund == 250) requiredWallet = 350;
    if (fund == 500) requiredWallet = 850;
    if (fund == 1000) requiredWallet = 1850;

    const result = await pool.query(
      `
      SELECT COUNT(*) AS total
      FROM users
      WHERE parent_id = $1
      AND trading_wallet_amount >= $2
      `,
      [userId, requiredWallet]
    );

    const eligible = Number(result.rows[0].total);

    const tiers = [
      { target: 10, reward: 300 },
      { target: 35, reward: 1000 },
      { target: 85, reward: 2700 },
      { target: 185, reward: 6500 }
    ].map(t => ({
      ...t,
      progress: Math.min(Math.floor((eligible / t.target) * 100), 100)
    }));

    res.json({
      fundTier: `$${fund}`,
      requiredWallet,
      eligibleReferrals: eligible,
      tiers
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/fake/:parentId", async (req, res) => {
  try {

    const parentId = Number(req.params.parentId);

    // 1️⃣ create fake user
    const fakeUser = await pool.query(
      `
      INSERT INTO users
      (name, phone, email, password_hash, referral_code, parent_id, trading_wallet_amount)
      VALUES (
        'Test User',
        CONCAT('999', FLOOR(RANDOM()*1000000)),
        CONCAT('test', FLOOR(RANDOM()*1000000), '@mail.com'),
        'test',
        CONCAT('REF', FLOOR(RANDOM()*100000)),
        $1,
        350
      )
      RETURNING id
      `,
      [parentId]
    );

    const newUserId = fakeUser.rows[0].id;

    // 2️⃣ count eligible referrals
    const countResult = await pool.query(
      `
      SELECT COUNT(*) AS total
      FROM users
      WHERE parent_id = $1
      AND trading_wallet_amount >= 350
      `,
      [parentId]
    );

    const eligible = Number(countResult.rows[0].total);

    // 3️⃣ reward tiers
    const tiers = [
      { referrals: 10, reward: 300 },
      { referrals: 35, reward: 1000 },
      { referrals: 85, reward: 2700 },
      { referrals: 185, reward: 6500 }
    ];

    const rewardsCredited = [];

    for (let tier of tiers) {

      if (eligible >= tier.referrals) {

        const exist = await pool.query(
          `
          SELECT id FROM referral_fund_rewards
WHERE parent_id=$1
AND referral_target=$2
          `,
          [parentId, tier.referrals]
        );

        if (exist.rows.length === 0) {

          await pool.query(
            `
           UPDATE users
SET wallet_amount = wallet_amount + $1
WHERE id=$2
            `,
            [tier.reward, parentId]
          );

          await pool.query(
            `
            INSERT INTO referral_fund_rewards
(parent_id, fund_level, referral_target, reward_amount)
VALUES ($1,$2,$3,$4)
            `,
            [parentId, 350, tier.referrals, tier.reward]
          );
          await pool.query(
` 
INSERT INTO notifications
(title,message,target_type,target_users)
VALUES ($1,$2,'custom',$3)
`,
[
"Referral Reward Earned",
`You earned $${tier.reward} referral reward.`,
String(parentId)
]
);

          rewardsCredited.push(tier);
        }
      }
    }

    res.json({
      message: "Fake referral created",
      newReferralId: newUserId,
      eligibleReferrals: eligible,
      rewardsCredited
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server error" });
  }
});

router.get("/delete-last/:parentId", async (req, res) => {
  try {

    const parentId = Number(req.params.parentId);

    // find last referral
    const lastUser = await pool.query(
      `
      SELECT id
      FROM users
      WHERE parent_id = $1
      ORDER BY id DESC
      LIMIT 1
      `,
      [parentId]
    );

    if (lastUser.rows.length === 0) {
      return res.json({
        message: "No referrals found"
      });
    }

    const deleteId = lastUser.rows[0].id;

    // delete user
    await pool.query(
      `
      DELETE FROM users
      WHERE id = $1
      `,
      [deleteId]
    );

    res.json({
      message: "Last referral deleted",
      deletedUserId: deleteId
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server error" });
  }
});
module.exports = router;