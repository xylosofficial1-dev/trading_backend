// services/commissionService.js

const distributeLevelCommission = async (client, userId, amount) => {
  const levelRates = [5, 2.5, 1.25, 0.75, 0.37];

  let currentUserId = userId;

  for (let level = 0; level < levelRates.length; level++) {

    // Get parent
    const parentRes = await client.query(
      `SELECT parent_id FROM users WHERE id = $1`,
      [currentUserId]
    );

    const parentId = parentRes.rows[0]?.parent_id;

    if (!parentId) break;

    const rate = levelRates[level];
    const commission = Number(((amount * rate) / 100).toFixed(2));

    // ✅ Add commission to parent wallet
    await client.query(
      `UPDATE users
       SET wallet_amount = wallet_amount + $1
       WHERE id = $2`,
      [commission, parentId]
    );

    // ✅ Insert ONE notification only
    await client.query(
      `INSERT INTO notifications
       (title, message, target_type, target_users)
       VALUES ($1, $2, 'custom', $3)`,
      [
        `Level ${level + 1} Commission Earned`,
        `You received ₹${commission} (${rate}%) from your level ${level + 1} referral.`,
        String(parentId),
      ]
    );

    // Move up
    currentUserId = parentId;
  }
};

module.exports = { distributeLevelCommission };