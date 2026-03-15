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

async function processReferralTask(userId) {

  const client = await pool.connect();

  try {

    const parentRes = await client.query(
      `SELECT parent_id FROM users WHERE id=$1`,
      [userId]
    );

    const parentId = parentRes.rows[0]?.parent_id;

    if (!parentId) return;

    for (const rule of rewardRules) {

      const countRes = await client.query(
        `
        SELECT COUNT(*)
        FROM users
        WHERE parent_id=$1
        AND trading_wallet_amount >= $2
        `,
        [parentId, rule.deposit]
      );

      const count = parseInt(countRes.rows[0].count);

      if (count >= rule.referrals) {

        const already = await client.query(
          `
          SELECT id FROM referral_task_rewards
          WHERE user_id=$1
          AND deposit_required=$2
          AND referral_required=$3
          `,
          [parentId, rule.deposit, rule.referrals]
        );

        if (already.rowCount > 0) continue;

        await client.query(
          `
          UPDATE users
          SET wallet_amount = wallet_amount + $1
          WHERE id=$2
          `,
          [rule.reward, parentId]
        );

        await client.query(
          `
          INSERT INTO referral_task_rewards
          (user_id, deposit_required, referral_required, reward_amount)
          VALUES ($1,$2,$3,$4)
          `,
          [parentId, rule.deposit, rule.referrals, rule.reward]
        );

        await client.query(
          `
          INSERT INTO notifications
          (title,message,target_type,target_users)
          VALUES ($1,$2,'custom',$3)
          `,
          [
            "Referral Task Reward",
            `🎉 You received $${rule.reward} for ${rule.referrals} referrals.`,
            parentId.toString()
          ]
        );

      }

    }

  } catch (err) {

    console.error(err);

  } finally {

    client.release();

  }

}

module.exports = processReferralTask;