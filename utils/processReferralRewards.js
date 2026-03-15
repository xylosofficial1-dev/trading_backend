const pool = require("../db/db");
const rewardRules = require("./referralRewards");

const processReferralRewards = async (userId) => {
  const client = await pool.connect();

  try {

    // get parent
    const parentRes = await client.query(
      `SELECT parent_id FROM users WHERE id=$1`,
      [userId]
    );

    const parentId = parentRes.rows[0]?.parent_id;

    if (!parentId) return;

    // count referrals with deposit
    for (let rule of rewardRules) {

      const res = await client.query(
        `
        SELECT COUNT(*) 
        FROM users
        WHERE parent_id=$1
        AND trading_wallet_amount >= $2
        `,
        [parentId, rule.deposit]
      );

      const count = parseInt(res.rows[0].count);

      if (count === rule.referrals) {

        // add reward
        await client.query(
          `
          UPDATE users
          SET wallet_amount = wallet_amount + $1
          WHERE id=$2
          `,
          [rule.reward, parentId]
        );

        // notification
        await client.query(
          `
          INSERT INTO notifications
          (title,message,target_type,target_users)
          VALUES ($1,$2,'custom',$3)
          `,
          [
            "Referral Reward",
            `You received $${rule.reward} reward for ${rule.referrals} active referrals.`,
            parentId.toString(),
          ]
        );
      }
    }

  } catch (err) {
    console.log("Referral reward error:", err);
  } finally {
    client.release();
  }
};

module.exports = processReferralRewards;