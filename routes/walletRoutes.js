// backend/routes/walletRoutes.js
const express = require("express");
const router = express.Router();
const pool = require("../db/db");
const { distributeLevelCommission } = require("../services/commissionService");

// ⭐ START COMMISSION CYCLE
const startCommissionCycle = async (client, userId) => {
  await client.query(
    `
    INSERT INTO trade_commission_cycles (user_id, started_at, last_paid_at)
    VALUES ($1, NOW(), NULL)
    ON CONFLICT (user_id) DO NOTHING
    `,
    [userId]
  );
};
const precise = (num) => Number(num.toString());

const multiply = (a, b) => precise(a * b);

const divide = (a, b) => precise(a / b);

router.post("/send", async (req, res) => {
  const { senderId, recipientAddress, amount } = req.body;

  if (!senderId || !recipientAddress || Number(amount) <= 0) {
    return res.status(400).json({ error: "Invalid request" });
  }

  const client = await pool.connect();
  const normalizedRecipient = recipientAddress.trim().toLowerCase();

  try {
    await client.query("BEGIN");

    // 🔹 Sender
    const senderRes = await client.query(
      `SELECT id, name, wallet_amount, wallet_address
       FROM users
       WHERE id = $1
       FOR UPDATE`,
      [senderId]
    );

    if (!senderRes.rowCount) throw new Error("Sender not found");
    const sender = senderRes.rows[0];

    if (Number(sender.wallet_amount) < Number(amount))
      throw new Error("Insufficient balance");

    if (sender.wallet_address.toLowerCase() === normalizedRecipient)
      throw new Error("Cannot send to yourself");

    // 🔹 Receiver
    const receiverRes = await client.query(
      `SELECT id, name
       FROM users
       WHERE LOWER(wallet_address) = $1
       FOR UPDATE`,
      [normalizedRecipient]
    );

    if (!receiverRes.rowCount) throw new Error("Recipient not found");
    const receiver = receiverRes.rows[0];

    // 🔹 Update balances
    await client.query(
      "UPDATE users SET wallet_amount = wallet_amount - $1 WHERE id = $2",
      [amount, senderId]
    );

    await client.query(
      "UPDATE users SET wallet_amount = wallet_amount + $1 WHERE id = $2",
      [amount, receiver.id]
    );

    // 🔹 Message format
    const message = `${sender.name} sent ${receiver.name} $${amount} on ${new Date().toLocaleString()}`;

    // 🔹 Store SAME message for both users
    await client.query(`
  INSERT INTO notifications (title, message, target_type, target_users)
  VALUES ($1, $2, 'custom', $3)
`, [
  "Wallet Transfer",
  message,
  `${senderId},${receiver.id}`
]);


    await client.query("COMMIT");

    res.json({
      success: true,
      message: "Amount sent and notification saved"
    });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ WALLET ERROR:", err.message);
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.post("/transfer", async (req, res) => {
  const { userId, amount_usd, type } = req.body;
  const amount = Number(amount_usd);

  console.log("🔥 TRANSFER:", { userId, amount, type });

  if (!userId || !Number.isFinite(amount) || amount <= 0 || !type) {
    return res.status(400).json({ message: "Invalid transfer request" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

   // ================= MAIN → TRADE =================
if (type === "MAIN_TO_TRADE") {

  const { rows } = await client.query(
    `SELECT wallet_amount, trading_wallet_amount
     FROM users
     WHERE id = $1
     FOR UPDATE`,
    [userId]
  );

  if (!rows.length || Number(rows[0].wallet_amount) < amount) {
    throw new Error("Insufficient Primary Credit Balance balance");
  }

  // 1️⃣ Deduct from main
  await client.query(
    `UPDATE users
     SET wallet_amount = wallet_amount - $1,
         trading_wallet_amount = trading_wallet_amount + $1
     WHERE id = $2`,
    [amount, userId]
  );

  // 2️⃣ 🔥 ADD THIS LINE (VERY IMPORTANT)
  await distributeLevelCommission(client, userId, amount);

  // 🔔 Notify user about transfer
await client.query(
  `INSERT INTO notifications 
   (title, message, target_type, target_users)
   VALUES ($1, $2, 'custom', $3)`,
  [
    "Transfer Successful",
    `You transferred $${amount} from\n Primary Credit Balance to Strategy\n Allocation Balance.`,
    String(userId)   // store as text
  ]
);
}
    // ================= TRADE → MAIN =================
  else if (type === "TRADE_TO_MAIN") {

  // 🔒 Lock user row
  const userRes = await client.query(
    `SELECT trading_wallet_amount
     FROM users
     WHERE id = $1
     FOR UPDATE`,
    [userId]
  );

  if (!userRes.rows.length) {
    throw new Error("User not found");
  }

  const tradeBalance = Number(userRes.rows[0].trading_wallet_amount);
  const maxAllowed = tradeBalance * 0.05;

  if (amount > maxAllowed) {
    throw new Error("Daily withdrawal limit exceeded (5%)");
  }

  // 🔒 Check last withdrawal
  const lastReq = await client.query(
    `
    SELECT created_at, status
    FROM trading_wallet_withdrawals
    WHERE user_id = $1
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [userId]
  );

  if (lastReq.rows.length) {
    const { created_at, status } = lastReq.rows[0];

    if (status === "pending") {
      throw new Error("You already have a pending withdrawal request");
    }

    const diffHours =
      (Date.now() - new Date(created_at)) / (1000 * 60 * 60);

    if (diffHours < 24) {
      throw new Error("You can request withdrawal only once every 24 hours");
    }
  }

  // 🧾 Insert request (snapshot balance)
  await client.query(
    `
    INSERT INTO trading_wallet_withdrawals (
      user_id,
      wallet_amount,
      requested_amount,
      status
    ) VALUES ($1, $2, $3, 'pending')
    `,
    [userId, tradeBalance, amount]
  );
}
    await client.query("COMMIT");
    res.json({ success: true });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ TRANSFER ERROR:", err.message);
    res.status(400).json({ message: err.message });
  } finally {
    client.release();
  }
});

// backend/routes/walletRoutes.js
router.get("/last-withdrawal/:userId", async (req, res) => {
  const { userId } = req.params;

  const { rows } = await pool.query(`
    SELECT created_at, status
    FROM trading_wallet_withdrawals
    WHERE user_id = $1
    ORDER BY created_at DESC
    LIMIT 1
  `, [userId]);

  res.json(rows[0] || null);
});

router.get("/check/:userId", async (req, res) => {
  const { userId } = req.params;

  try {
    const { rows } = await pool.query(
      `SELECT 
         id,
         wallet_amount,
         trading_wallet_amount
       FROM users
       WHERE id = $1`,
      [userId]
    );

    if (!rows.length) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      success: true,
      data: rows[0],
    });
  } catch (err) {
    console.error("Wallet check error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/admin/settings", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT tw_to_mw_deduction_percent FROM admin_settings WHERE id = 1"
    );

    res.json({
      tw_to_mw_deduction_percent: result.rows[0]?.tw_to_mw_deduction_percent ?? 0
    });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

router.put("/admin/settings", async (req, res) => {
  const { tw_to_mw_deduction_percent } = req.body;

  if (tw_to_mw_deduction_percent < 0 || tw_to_mw_deduction_percent > 100) {
    return res.status(400).json({ message: "Invalid percentage" });
  }

  try {
    await pool.query(
      `
      INSERT INTO admin_settings (id, tw_to_mw_deduction_percent)
      VALUES (1, $1)
      ON CONFLICT (id)
      DO UPDATE SET tw_to_mw_deduction_percent = EXCLUDED.tw_to_mw_deduction_percent
      `,
      [tw_to_mw_deduction_percent]
    );

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/admin/trade-wallet/requests", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        tw.id,
        u.id AS user_id,
        u.name,
        u.email,
        u.trading_wallet_amount AS wallet_amount,
        tw.requested_amount,
        tw.sent_amount,
        tw.status,
        tw.reject_reason,
        tw.created_at
      FROM trading_wallet_withdrawals tw
      JOIN users u ON u.id = tw.user_id
      ORDER BY tw.created_at DESC
    `);

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/admin/trade-wallet/approve", async (req, res) => {
  const { withdrawal_id } = req.body;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 🔒 Lock withdrawal
    const withdrawalRes = await client.query(`
      SELECT *
      FROM trading_wallet_withdrawals
      WHERE id = $1 AND status = 'pending'
      FOR UPDATE
    `, [withdrawal_id]);

    if (!withdrawalRes.rows.length) {
      throw new Error("Withdrawal not found or already processed");
    }

    const withdrawal = withdrawalRes.rows[0];

    // 🔒 Lock user
    const userRes = await client.query(`
      SELECT wallet_amount, trading_wallet_amount
      FROM users
      WHERE id = $1
      FOR UPDATE
    `, [withdrawal.user_id]);

    if (!userRes.rows.length) {
      throw new Error("User not found");
    }

const sentAmount = Number(withdrawal.requested_amount);
    // 💰 UPDATE wallets (NO BALANCE CHECK)
    if (Number(userRes.rows[0].trading_wallet_amount) < withdrawal.requested_amount) {
  throw new Error("Insufficient Strategy Allocation Balance balance");
}

    await client.query(`
      UPDATE users
      SET
        trading_wallet_amount = trading_wallet_amount - $1,
        wallet_amount = wallet_amount + $2
      WHERE id = $3
    `, [
      withdrawal.requested_amount,
      sentAmount,
      withdrawal.user_id
    ]);

    // ✅ UPDATE withdrawal record
    await client.query(`
  UPDATE trading_wallet_withdrawals
  SET
    status = 'approved',
    sent_amount = $1,
    updated_at = NOW()
  WHERE id = $2
`, [sentAmount, withdrawal_id]);

    // 🔔 Notification
    await client.query(`
      INSERT INTO notifications (title, message, target_type, target_users)
      VALUES ($1, $2, 'custom', $3)
    `, [
      "Transfer Approved",
      `Your Strategy Allocation Balance withdrawal request of $${sentAmount} has been approved and credited to your Primary Credit Balance.`,
      String(withdrawal.user_id)
    ]);

    await client.query("COMMIT");
    res.json({ success: true });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("APPROVE ERROR:", err.message);
    res.status(400).json({ message: err.message });
  } finally {
    client.release();
  }
});

router.post("/distribute-commission", async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1️⃣ Ensure row exists
    await client.query(`
      INSERT INTO system_settings (key, value)
      VALUES ('last_commission_run', NULL)
      ON CONFLICT (key) DO NOTHING
    `);

    // 2️⃣ Lock row
    const settingRes = await client.query(
      `SELECT value
       FROM system_settings
       WHERE key = 'last_commission_run'
       FOR UPDATE`
    );

    const lastRun = settingRes.rows[0].value;

    // 3️⃣ 24 hour check
    if (lastRun) {
      const diffMs = Date.now() - new Date(lastRun).getTime();
      const diffHours = diffMs / (1000 * 60 * 60);

      if (diffHours < 24) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          message: `Already distributed. Try again in ${(
            24 - diffHours
          ).toFixed(2)} hours`,
        });
      }
    }

 const users = await client.query(`
  SELECT 
  u.id,
  u.trading_wallet_amount,
  u.auto_trade,
  (
    SELECT COUNT(*)
    FROM users r
    WHERE r.parent_id = u.id
  ) AS referral_count
FROM users u
WHERE u.trading_wallet_amount > 100
FOR UPDATE
`);

    let processed = 0;
for (const user of users.rows) {
  const tradingBalance = Number(user.trading_wallet_amount);
  const referralCount = Number(user.referral_count);

  // 🔥 Dynamic Rate
  const commissionRate = 1.6 + (referralCount * 0.05);

  const commissionAmount = divide(
  multiply(tradingBalance, commissionRate),
  100
);

  let walletType = "";

  if (user.auto_trade === true) {
    await client.query(
      `UPDATE users
       SET trading_wallet_amount = trading_wallet_amount + $1
       WHERE id = $2`,
      [commissionAmount, user.id]
    );

    walletType = "Strategy Allocation Balance";
  } else {
    await client.query(
      `UPDATE users
       SET wallet_amount = wallet_amount + $1
       WHERE id = $2`,
      [commissionAmount, user.id]
    );

    walletType = "Primary Credit Balance";
  }

  await client.query(
    `
    INSERT INTO notifications (title, message, target_type, target_users)
    VALUES ($1, $2, 'custom', $3)
    `,
    [
      "Daily Commission Credited",
      `$${commissionAmount} (${commissionRate}%) credited to your ${walletType}. You have ${referralCount} referrals.`,
      String(user.id)
    ]
  );

  processed++;
}
    // 4️⃣ Update timestamp
    await client.query(`
      UPDATE system_settings
      SET value = NOW()
      WHERE key = 'last_commission_run'
    `);

    await client.query("COMMIT");

    res.json({
      success: true,
      users: processed,
    });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ COMMISSION ERROR:", err.message);
    res.status(500).json({ message: err.message });
  } finally {
    client.release();
  }
});

router.post("/admin/trade-wallet/reject", async (req, res) => {
  const { withdrawal_id, reason } = req.body;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(`
      SELECT *
      FROM trading_wallet_withdrawals
      WHERE id = $1 AND status = 'pending'
      FOR UPDATE
    `, [withdrawal_id]);

    if (!result.rows.length) {
      throw new Error("Withdrawal not found or already processed");
    }

    const withdrawal = result.rows[0];

    await client.query(`
      UPDATE trading_wallet_withdrawals
      SET status = 'rejected',
          reject_reason = $1,
          updated_at = NOW()
      WHERE id = $2
    `, [reason, withdrawal_id]);

    await client.query(`
  INSERT INTO notifications (title, message, target_type, target_users)
  VALUES ($1, $2, 'custom', $3)
`, [
  "Withdrawal Rejected",
  `Your Strategy Allocation Balance withdrawal of $${withdrawal.requested_amount} was rejected. Reason: ${reason}`,
  String(withdrawal.user_id)
]);

    await client.query("COMMIT");
    res.json({ success: true });

  } catch (err) {
    await client.query("ROLLBACK");
    res.status(400).json({ message: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
