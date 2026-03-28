// services/commissionService.js

const distributeLevelCommission = async (client, userId, amount) => {
  const levelRates = [5, 2.5, 1.25, 0.75, 0.37];

  let currentUserId = userId;

  for (let level = 0; level < levelRates.length; level++) {

    // 🔹 Get parent + auto_trade
    const parentRes = await client.query(
      `SELECT parent_id FROM users WHERE id = $1`,
      [currentUserId]
    );

    const parentId = parentRes.rows[0]?.parent_id;

    if (!parentId) break;

    // 🔹 Get parent's auto_trade
    const parentData = await client.query(
      `SELECT auto_trade FROM users WHERE id = $1`,
      [parentId]
    );

    const autoTrade = parentData.rows[0]?.auto_trade;

    const rate = levelRates[level];
    const commission = Number(((amount * rate) / 100).toFixed(2));

    // 🔥 MAIN FIX: Dynamic wallet
    const column = autoTrade
      ? "trading_wallet_amount"
      : "wallet_amount";

  // ✅ Level commission always goes to Primary Wallet
await client.query(
  `UPDATE users
   SET wallet_amount = wallet_amount + $1
   WHERE id = $2`,
  [commission, parentId]
);

    // 🔔 Notification
    const walletName = autoTrade
      ? "Strategy Allocation Balance"
      : "Primary Credit Balance";

    await client.query(
      `INSERT INTO notifications
       (title, message, target_type, target_users)
       VALUES ($1, $2, 'custom', $3)`,
      [
        `Level ${level + 1} Commission Earned`,
        `You received $${commission} (${rate}%) in your ${walletName} from level ${level + 1}.`,
        String(parentId),
      ]
    );

    // 🔁 Move up
    currentUserId = parentId;
  }
};

module.exports = { distributeLevelCommission };