// routes/p2pRoutes.js
const express = require("express");
const router = express.Router();
const multer = require("multer");
const pool = require("../db/db");   

const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// =============================================
// HELPER: Send Push Notification
// =============================================
const sendPushNotification = async (expoPushToken, title, body, data = {}) => {
  if (!expoPushToken) return;
  
  try {
    const message = {
      to: expoPushToken,
      sound: 'default',
      title: title,
      body: body,
      data: data,
      priority: 'high',
    };

    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });

    const result = await response.json();
    console.log('Push notification sent:', result);
    return result;
  } catch (err) {
    console.error('Error sending push notification:', err);
  }
};

// =============================================
// HELPER: Get User's Push Token
// =============================================
const getUserPushToken = async (userId) => {
  try {
    const result = await pool.query(
      `SELECT expo_push_token FROM users WHERE id = $1`,
      [userId]
    );
    return result.rows[0]?.expo_push_token || null;
  } catch (err) {
    console.error('Error getting push token:', err);
    return null;
  }
};

// =============================================
// HELPER: Get User Name
// =============================================
const getUserName = async (userId) => {
  try {
    const result = await pool.query(
      `SELECT name FROM users WHERE id = $1`,
      [userId]
    );
    return result.rows[0]?.name || "User";
  } catch (err) {
    return "User";
  }
};

// =============================================
// 1. CREATE LISTING (Sell USDT)
// =============================================
router.post("/create-listing", upload.single('qr_image'), async (req, res) => {
  try {
    const {
      user_id,
      price,
      quantity,
      description,
      payment_method,
      bank_details,
      upi_id,
      wallet_address
    } = req.body;

    const qrImageBuffer = req.file ? req.file.buffer : null;
    const sellQty = parseFloat(quantity);

    if (!sellQty || sellQty <= 0) {
      return res.json({
        success: false,
        error: "Invalid quantity"
      });
    }

    const userWallet = await pool.query(
      `SELECT wallet_amount FROM users WHERE id = $1`,
      [user_id]
    );

    if (userWallet.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "User not found"
      });
    }

    const walletBalance = parseFloat(userWallet.rows[0].wallet_amount);

    const activeListings = await pool.query(
      `SELECT COALESCE(SUM(quantity), 0) as total
       FROM p2p_sell_listings
       WHERE user_id = $1 AND status = 'active'`,
      [user_id]
    );

    const alreadyListed = parseFloat(activeListings.rows[0].total);
    const totalAfterListing = alreadyListed + sellQty;

    if (totalAfterListing > walletBalance) {
      return res.json({
        success: false,
        error: `Insufficient balance. You have ${walletBalance} USDT, Already listed: ${alreadyListed}, You can list only ${(walletBalance - alreadyListed).toFixed(2)} USDT more`
      });
    }

    const result = await pool.query(
      `INSERT INTO p2p_sell_listings
      (user_id, coin_name, price, quantity, description, payment_method, 
       bank_details, upi_id, wallet_address, qr_image, status, created_at)
      VALUES($1, 'USDT', $2, $3, $4, $5, $6, $7, $8, $9, 'active', NOW())
      RETURNING *`,
      [
        user_id,
        price,
        quantity,
        description,
        payment_method,
        bank_details,
        upi_id,
        wallet_address,
        qrImageBuffer
      ]
    );

    res.json({
      success: true,
      message: "Listing created successfully",
      listing: result.rows[0]
    });

  } catch (err) {
    console.error("Create listing error:", err);
    res.status(500).json({
      success: false,
      error: "Server error: " + err.message
    });
  }
});

// =============================================
// 2. CHECK IF USER CAN CREATE REQUEST
// =============================================
router.get("/can-create-request/:userId/:listingId", async (req, res) => {
  try {
    const { userId, listingId } = req.params;

    const activeTrade = await pool.query(
      `SELECT * FROM p2p_buy_requests 
       WHERE buyer_id = $1 
       AND listing_id = $2 
       AND status IN ('accepted','paid')
       AND expires_at > NOW()
       LIMIT 1`,
      [userId, listingId]
    );

    if (activeTrade.rows.length > 0) {
      return res.json({ 
        canCreate: false, 
        status: activeTrade.rows[0].status,
        message: "You have an active trade for this listing"
      });
    }

    res.json({ canCreate: true });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Server error" });
  }
});

// =============================================
// 3. DELETE LISTING
// =============================================
router.delete("/delete-listing/:listingId/:userId", async (req, res) => {
  try {
    const { listingId, userId } = req.params;

    const listing = await pool.query(
      `SELECT status, user_id 
       FROM p2p_sell_listings 
       WHERE id = $1`,
      [listingId]
    );

    if (listing.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Listing not found",
      });
    }

    const data = listing.rows[0];

    if (data.user_id != userId) {
      return res.status(403).json({
        success: false,
        error: "Unauthorized",
      });
    }

    if (data.status === "completed") {
      return res.status(400).json({
        success: false,
        error: "Completed listing cannot be deleted",
      });
    }

    await pool.query(
      `DELETE FROM p2p_sell_listings WHERE id = $1`,
      [listingId]
    );

    return res.json({
      success: true,
      message: "Listing deleted permanently",
    });

  } catch (err) {
    console.error("Delete listing error:", err);
    return res.status(500).json({
      success: false,
      error: "Server error",
    });
  }
});

// =============================================
// 4. GET PENDING REQUESTS FOR SELLER
// =============================================
router.get("/pending-requests/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const result = await pool.query(
      `SELECT 
        r.*,
        u.name as buyer_name,
        u.username as buyer_username
       FROM p2p_buy_requests r
       JOIN users u ON u.id = r.buyer_id
       WHERE r.seller_id = $1 
       AND r.status = 'pending'
       ORDER BY r.created_at DESC
       LIMIT 1`,
      [userId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Get pending requests error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// =============================================
// 5. CANCEL REQUEST (by buyer)
// =============================================
router.post("/cancel-request/:requestId", async (req, res) => {
  try {
    const { requestId } = req.params;

    const result = await pool.query(
      `UPDATE p2p_buy_requests
       SET status = 'cancelled'
       WHERE id = $1 AND status = 'pending'
       RETURNING *`,
      [requestId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: "Request not found or already processed" 
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Cancel request error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// =============================================
// 6. CREATE BUY REQUEST (with push notifications)
// =============================================
router.post("/create-buy-request", async (req, res) => {
  const { listing_id, buyer_id, quantity, seller_id, buyer_name } = req.body;

  try {
    // Check existing active trade
    const existing = await pool.query(
      `SELECT * FROM p2p_buy_requests
       WHERE listing_id=$1 
       AND buyer_id=$2
       AND status IN ('accepted','paid')
       AND expires_at > NOW()`,
      [listing_id, buyer_id]
    );

    if (existing.rows.length > 0) {
      return res.json({
        success: false,
        error: "You already have an active trade"
      });
    }

    // Get listing details
    const listingResult = await pool.query(
      "SELECT user_id, price FROM p2p_sell_listings WHERE id=$1",
      [listing_id]
    );

    if (listingResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Listing not found"
      });
    }

    const listing = listingResult.rows[0];
    const sellerId = listing.user_id;
    const price = listing.price;

    // Get buyer name if not provided
    let buyerName = buyer_name;
    if (!buyerName) {
      const userResult = await pool.query(
        "SELECT name FROM users WHERE id = $1",
        [buyer_id]
      );
      buyerName = userResult.rows[0]?.name || "Buyer";
    }

    // Create request with status 'pending'
    const trade = await pool.query(`
      INSERT INTO p2p_buy_requests
      (listing_id, buyer_id, seller_id, quantity, price, status, created_at)
      VALUES ($1, $2, $3, $4, $5, 'pending', NOW())
      RETURNING *
    `, [listing_id, buyer_id, sellerId, quantity, price]);

    const io = req.app.get("io");
    const onlineUsers = req.app.get("onlineUsers");

    const requestData = {
      ...trade.rows[0],
      buyer_name: buyerName
    };

    // Send socket event if seller is online (app open)
    const sellerSocket = onlineUsers[sellerId];
    if (sellerSocket) {
      io.to(sellerSocket).emit("new-buy-request", requestData);
      console.log(`📡 Socket event 'new-buy-request' sent to seller ${sellerId}`);
    } else {
      console.log(`📡 Seller ${sellerId} is offline, socket event not sent`);
    }

    // Send push notification regardless of online status
    const sellerPushToken = await getUserPushToken(sellerId);
    if (sellerPushToken) {
      await sendPushNotification(
        sellerPushToken,
        '🔔 New Buy Request',
        `${buyerName} wants to buy ${quantity} USDT`,
        {
          type: 'new-buy-request',
          requestData: JSON.stringify(requestData)
        }
      );
      console.log(`📱 Push notification sent to seller ${sellerId}`);
    } else {
      console.log(`📱 No push token for seller ${sellerId}`);
    }

    res.json({
      success: true,
      request: trade.rows[0]
    });

  } catch (err) {
    console.log("Create buy request error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// =============================================
// 7. ACCEPT REQUEST (with push notifications)
// =============================================
router.post("/accept-request", async (req, res) => {
  const { request_id } = req.body;

  try {
    // Update request status to 'accepted' and set expires_at (30 minutes from now)
    const result = await pool.query(
      `UPDATE p2p_buy_requests
       SET status='accepted',
           accepted_at=NOW(),
           expires_at=NOW() + INTERVAL '30 minutes'
       WHERE id=$1 AND status='pending'
       RETURNING *`,
      [request_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Request not found or already processed" });
    }

    const trade = result.rows[0];

    // Get listing details for payment info
    const listing = await pool.query(
      `SELECT * FROM p2p_sell_listings WHERE id=$1`,
      [trade.listing_id]
    );

    const io = req.app.get("io");
    const onlineUsers = req.app.get("onlineUsers");

    const tradeData = {
      ...trade,
      payment_method: listing.rows[0].payment_method,
      bank_details: listing.rows[0].bank_details,
      upi_id: listing.rows[0].upi_id,
      wallet_address: listing.rows[0].wallet_address,
      qr_image: listing.rows[0].qr_image?.toString('base64')
    };

    // Send socket event to buyer (app open)
    const buyerSocket = onlineUsers[trade.buyer_id];
    if (buyerSocket) {
      io.to(buyerSocket).emit("trade-accepted", tradeData);
      console.log(`📡 Socket event 'trade-accepted' sent to buyer ${trade.buyer_id}`);
    }

    // Send push notification to buyer
    const buyerPushToken = await getUserPushToken(trade.buyer_id);
    if (buyerPushToken) {
      await sendPushNotification(
        buyerPushToken,
        '✅ Trade Accepted',
        'Your practice trade request has been accepted! 30-minute timer started.',
        {
          type: 'trade-accepted',
          tradeData: JSON.stringify(tradeData)
        }
      );
      console.log(`📱 Push notification sent to buyer ${trade.buyer_id}`);
    }

    res.json({ success: true, trade });
  } catch (err) {
    console.error("Accept error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// =============================================
// 8. REJECT REQUEST (with push notifications)
// =============================================
router.post("/reject-request", async (req, res) => {
  const { request_id, reason } = req.body;

  try {
    const result = await pool.query(
      `UPDATE p2p_buy_requests
       SET status='rejected'
       WHERE id=$1 AND status='pending'
       RETURNING *`,
      [request_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Request not found or already processed" });
    }

    const trade = result.rows[0];
    const rejectReason = reason || "Seller rejected your request";

    const io = req.app.get("io");
    const onlineUsers = req.app.get("onlineUsers");

    const rejectData = {
      request_id: trade.id,
      sellerName: "Seller",
      coinName: "USDT",
      quantity: trade.quantity,
      reason: rejectReason
    };

    // Send socket event to buyer (app open)
    const buyerSocket = onlineUsers[trade.buyer_id];
    if (buyerSocket) {
      io.to(buyerSocket).emit("trade-rejected", rejectData);
      console.log(`📡 Socket event 'trade-rejected' sent to buyer ${trade.buyer_id}`);
    }

    // Send push notification to buyer
    const buyerPushToken = await getUserPushToken(trade.buyer_id);
    if (buyerPushToken) {
      await sendPushNotification(
        buyerPushToken,
        '❌ Request Rejected',
        `Your practice trade request was rejected by the seller`,
        {
          type: 'trade-rejected',
          rejectData: JSON.stringify(rejectData)
        }
      );
      console.log(`📱 Push notification sent to buyer ${trade.buyer_id}`);
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Reject error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// =============================================
// 9. PAYMENT DONE (with push notifications)
// =============================================
router.post(
  "/payment-done",
  upload.single("screenshot"),
  async (req, res) => {
    try {
      const { request_id, tx_id } = req.body;
      const screenshot = req.file.buffer;

      console.log("Payment received/resubmitted for request:", request_id);

      // Check if payment already exists
      const existingPayment = await pool.query(
        `SELECT * FROM p2p_payments WHERE request_id = $1`,
        [request_id]
      );

      if (existingPayment.rows.length > 0) {
        await pool.query(
          `UPDATE p2p_payments
           SET screenshot = $1, tx_id = $2, status = 'pending', created_at = NOW()
           WHERE request_id = $3`,
          [screenshot, tx_id, request_id]
        );
        console.log("Payment updated for request:", request_id);
      } else {
        await pool.query(
          `INSERT INTO p2p_payments
           (request_id, screenshot, tx_id, status)
           VALUES($1, $2, $3, 'pending')`,
          [request_id, screenshot, tx_id]
        );
        console.log("New payment inserted for request:", request_id);
      }

      // Update request status to 'paid'
      await pool.query(
        `UPDATE p2p_buy_requests
         SET status='paid'
         WHERE id=$1`,
        [request_id]
      );

      const trade = await pool.query(
        `SELECT seller_id, buyer_id FROM p2p_buy_requests WHERE id=$1`,
        [request_id]
      );

      const sellerId = trade.rows[0].seller_id;

      const io = req.app.get("io");
      const onlineUsers = req.app.get("onlineUsers");

      // Send socket to seller (app open)
      const sellerSocket = onlineUsers[sellerId];
      if (sellerSocket) {
        io.to(sellerSocket).emit("payment-submitted", {
          request_id,
          tx_id
        });
        console.log(`📡 Socket event 'payment-submitted' sent to seller ${sellerId}`);
      }

      // Send push notification to seller
      const sellerPushToken = await getUserPushToken(sellerId);
      if (sellerPushToken) {
        await sendPushNotification(
          sellerPushToken,
          '📸 Payment Submitted',
          `Buyer has submitted payment proof for trade #${request_id}`,
          {
            type: 'payment-submitted',
            request_id: request_id,
            tx_id: tx_id
          }
        );
        console.log(`📱 Push notification sent to seller ${sellerId}`);
      }

      res.json({ success: true });
    } catch (err) {
      console.log("Payment error:", err);
      res.status(500).json({ error: "Server error" });
    }
  }
);

// =============================================
// 10. CONFIRM PAYMENT (complete trade)
// =============================================
router.post("/confirm-payment", async (req, res) => {
  const client = await pool.connect();

  try {
    const { request_id } = req.body;

    await client.query("BEGIN");

    console.log("Confirming payment for request:", request_id);

    const request = await client.query(
      `SELECT r.*, l.quantity as listing_quantity
       FROM p2p_buy_requests r
       JOIN p2p_sell_listings l ON l.id = r.listing_id
       WHERE r.id=$1
       FOR UPDATE`,
      [request_id]
    );

    if (request.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Request not found" });
    }

    const r = request.rows[0];
    const qty = parseFloat(r.quantity);

    // Check seller balance
    const sellerWallet = await client.query(
      `SELECT wallet_amount FROM users WHERE id = $1 FOR UPDATE`,
      [r.seller_id]
    );

    const sellerBalance = parseFloat(sellerWallet.rows[0].wallet_amount);

    if (sellerBalance < qty) {
      await client.query("ROLLBACK");
      return res.json({
        success: false,
        error: "Seller has insufficient balance"
      });
    }

    // Deduct from seller
    await client.query(
      `UPDATE users
       SET wallet_amount = wallet_amount - $1
       WHERE id = $2`,
      [qty, r.seller_id]
    );

    // Add to buyer
    await client.query(
      `UPDATE users
       SET wallet_amount = wallet_amount + $1
       WHERE id = $2`,
      [qty, r.buyer_id]
    );

    // Save trade history
    await client.query(
      `INSERT INTO p2p_trade_history
       (buyer_id, seller_id, listing_id, quantity, total)
       VALUES($1, $2, $3, $4, $5)`,
      [
        r.buyer_id,
        r.seller_id,
        r.listing_id,
        qty,
        qty * 80
      ]
    );

    // Update request status to 'completed'
    await client.query(
      `UPDATE p2p_buy_requests
       SET status='completed'
       WHERE id=$1`,
      [request_id]
    );

    // Update listing quantity
    const remainingQty = parseFloat(r.listing_quantity) - qty;

    if (remainingQty <= 0) {
      await client.query(
        `UPDATE p2p_sell_listings
         SET status='completed', quantity=0
         WHERE id=$1`,
        [r.listing_id]
      );
    } else {
      await client.query(
        `UPDATE p2p_sell_listings
         SET quantity=$1
         WHERE id=$2`,
        [remainingQty, r.listing_id]
      );
    }

    await client.query("COMMIT");

    const io = req.app.get("io");
    const onlineUsers = req.app.get("onlineUsers");

    // Socket events to both parties
    const buyerSocket = onlineUsers[r.buyer_id];
    if (buyerSocket) {
      io.to(buyerSocket).emit("trade-completed", {
        request_id,
        message: "Trade completed successfully"
      });
    }

    const sellerSocket = onlineUsers[r.seller_id];
    if (sellerSocket) {
      io.to(sellerSocket).emit("trade-confirmed", {
        request_id,
        message: "Trade completed successfully"
      });
    }

    // Push notifications to both parties
    const buyerPushToken = await getUserPushToken(r.buyer_id);
    if (buyerPushToken) {
      await sendPushNotification(
        buyerPushToken,
        '🎉 Trade Completed',
        'Your practice trade has been completed successfully!',
        { type: 'trade-completed', request_id }
      );
    }

    const sellerPushToken = await getUserPushToken(r.seller_id);
    if (sellerPushToken) {
      await sendPushNotification(
        sellerPushToken,
        '🎉 Trade Completed',
        'Your practice trade has been completed successfully!',
        { type: 'trade-completed', request_id }
      );
    }

    res.json({ success: true });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Confirm error:", err);
    res.status(500).json({ error: "Server error: " + err.message });
  } finally {
    client.release();
  }
});

// =============================================
// 11. SET PENALTY
// =============================================
router.post("/set-penalty", async (req, res) => {
  try {
    const { penalty_amount } = req.body;

    if (!penalty_amount) {
      return res.status(400).json({ error: "Penalty amount required" });
    }

    await pool.query(`DELETE FROM p2p_penalty_settings`);

    const result = await pool.query(
      `INSERT INTO p2p_penalty_settings (penalty_amount)
       VALUES ($1)
       RETURNING *`,
      [penalty_amount]
    );

    res.json({
      success: true,
      message: "Penalty amount updated",
      data: result.rows[0]
    });

  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Server error" });
  }
});

// =============================================
// 12. GET PENALTY
// =============================================
router.get("/get-penalty", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT penalty_amount
       FROM p2p_penalty_settings
       ORDER BY id DESC
       LIMIT 1`
    );

    if (result.rows.length === 0) {
      return res.json({ penalty_amount: 10 });
    }

    res.json(result.rows[0]);

  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Server error" });
  }
});

// =============================================
// 13. PAYMENT REJECT (seller disputes)
// =============================================
router.post("/payment-reject", async (req, res) => {
  try {
    const { request_id, reason } = req.body;

    console.log("Payment rejected for request:", request_id, "Reason:", reason);

    // Update request status back to 'accepted' for resubmission
    await pool.query(
      `UPDATE p2p_buy_requests
       SET status='accepted'
       WHERE id=$1`,
      [request_id]
    );

    // Store dispute reason
    await pool.query(
      `INSERT INTO p2p_disputes
       (request_id, reason, created_at)
       VALUES($1, $2, NOW())`,
      [request_id, reason]
    );

    const trade = await pool.query(
      `SELECT buyer_id, seller_id FROM p2p_buy_requests WHERE id=$1`,
      [request_id]
    );

    const io = req.app.get("io");
    const onlineUsers = req.app.get("onlineUsers");

    // Socket to buyer
    const buyerSocket = onlineUsers[trade.rows[0].buyer_id];
    if (buyerSocket) {
      io.to(buyerSocket).emit("trade-disputed", {
        request_id,
        reason
      });
    }

    // Socket to seller
    const sellerSocket = onlineUsers[trade.rows[0].seller_id];
    if (sellerSocket) {
      io.to(sellerSocket).emit("dispute-raised", {
        request_id,
        reason,
        message: "You have raised a dispute. Buyer will be notified."
      });
    }

    // Push notification to buyer
    const buyerPushToken = await getUserPushToken(trade.rows[0].buyer_id);
    if (buyerPushToken) {
      await sendPushNotification(
        buyerPushToken,
        '⚠️ Dispute Raised',
        `Seller has raised a dispute. Reason: ${reason || 'No reason provided'}`,
        {
          type: 'dispute-raised',
          request_id,
          reason
        }
      );
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Reject error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// =============================================
// 14. ADMIN - GET ALL BUY REQUESTS
// =============================================
router.get("/admin/buy-requests", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        r.*,
        u1.name as buyer_name,
        u2.name as seller_name
      FROM p2p_buy_requests r
      JOIN users u1 ON u1.id = r.buyer_id
      JOIN users u2 ON u2.id = r.seller_id
      ORDER BY r.created_at DESC
    `);

    res.json({
      success: true,
      data: result.rows
    });

  } catch (err) {
    console.error("Admin buy requests error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// =============================================
// 15. GET ACTIVE TRADE
// =============================================
router.get("/active-trade/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const data = await pool.query(
      `SELECT 
        r.*,
        l.bank_details,
        l.upi_id,
        l.wallet_address,
        l.qr_image,
        l.price,
        l.quantity as listing_quantity
       FROM p2p_buy_requests r
       JOIN p2p_sell_listings l ON l.id=r.listing_id
       WHERE (r.buyer_id=$1 OR r.seller_id=$1)
       AND r.status IN ('accepted','paid')
       AND expires_at > NOW()
       LIMIT 1`,
      [userId]
    );

    if (data.rows[0] && data.rows[0].qr_image) {
      data.rows[0].qr_image = data.rows[0].qr_image.toString('base64');
    }

    res.json(data.rows[0] || null);
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Server error" });
  }
});

// =============================================
// 16. GET PAYMENT PROOF
// =============================================
router.get("/payment-proof/:requestId", async (req, res) => {
  try {
    const { requestId } = req.params;

    const result = await pool.query(
      `SELECT tx_id, screenshot
       FROM p2p_payments
       WHERE request_id = $1`,
      [requestId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Payment proof not found" });
    }

    const payment = result.rows[0];

    res.json({
      tx_id: payment.tx_id,
      screenshot: `data:image/png;base64,${payment.screenshot.toString("base64")}`
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Server error" });
  }
});

// =============================================
// 17. GET LISTINGS
// =============================================
router.get("/listings/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const result = await pool.query(
      `
      SELECT
        l.id,
        l.coin_name,
        l.price,
        l.quantity,
        l.payment_method,
        l.bank_details,
        l.upi_id,
        l.wallet_address,
        l.qr_image,
        u.name AS username,
        u.kyc_verify,
        COALESCE(ps.auto_renew, false) AS badge_enabled
      FROM p2p_sell_listings l
      JOIN users u ON u.id = l.user_id
      LEFT JOIN premium_subscriptions ps ON ps.user_id = u.id
      WHERE l.status = 'active'
      AND l.user_id != $1
      ORDER BY l.created_at DESC
      `,
      [userId]
    );

    const listings = result.rows.map(listing => {
      if (listing.qr_image) {
        listing.qr_image = listing.qr_image.toString("base64");
      }
      return listing;
    });

    res.json(listings);
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Server error" });
  }
});

// =============================================
// 18. GET TRADE HISTORY
// =============================================
router.get("/trade-history/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const result = await pool.query(
      `
      SELECT 
        h.id,
        h.buyer_id,
        h.seller_id,
        h.listing_id,
        h.quantity,
        h.price,
        h.total,
        h.completed_at,
        buyer.name AS buyer_name,
        seller.name AS seller_name
      FROM p2p_trade_history h
      JOIN users buyer ON buyer.id = h.buyer_id
      JOIN users seller ON seller.id = h.seller_id
      WHERE h.buyer_id = $1 
      OR h.seller_id = $1
      ORDER BY h.completed_at DESC
      `,
      [userId]
    );

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });

  } catch (err) {
    console.error("Trade history error:", err);
    res.status(500).json({
      success: false,
      error: "Server error"
    });
  }
});

// =============================================
// 19. GET MY LISTINGS
// =============================================
router.get("/my-listings/:userId", async (req, res) => {
  const { userId } = req.params;

  try {
    const result = await pool.query(
      `
      SELECT 
        id,
        coin_name,
        price,
        quantity,
        description,
        payment_method,
        bank_details,
        upi_id,
        wallet_address,
        qr_image,
        status,
        created_at
      FROM p2p_sell_listings
      WHERE user_id = $1
      ORDER BY created_at DESC
      `,
      [userId]
    );

    const listings = result.rows.map(listing => {
      if (listing.qr_image) {
        listing.qr_image = listing.qr_image.toString('base64');
      }
      return listing;
    });

    res.json(listings);
  } catch (err) {
    console.error("Fetch listings error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// =============================================
// 20. SAVE PUSH TOKEN
// =============================================
router.post("/save-push-token", async (req, res) => {
  try {
    const { userId, token } = req.body;

    if (!userId || !token) {
      return res.status(400).json({ 
        success: false, 
        error: "userId and token are required" 
      });
    }

    await pool.query(
      `UPDATE users SET expo_push_token = $1 WHERE id = $2`,
      [token, userId]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Save push token error:", err);
    res.status(500).json({ 
      success: false, 
      error: "Server error" 
    });
  }
});

// =============================================
// 21. GET PENDING TRADE STATUS (for buyer)
// =============================================
router.get("/pending-trade-status/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const result = await pool.query(
      `SELECT 
        r.*,
        u.name as seller_name
       FROM p2p_buy_requests r
       JOIN users u ON u.id = r.seller_id
       WHERE r.buyer_id = $1 
       AND r.status = 'pending'
       ORDER BY r.created_at DESC
       LIMIT 1`,
      [userId]
    );

    res.json(result.rows[0] || null);
  } catch (err) {
    console.error("Get pending trade status error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// =============================================
// 22. GET PENDING REQUEST AGE (for seller popup check)
// =============================================
router.get("/pending-request-age/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const result = await pool.query(
      `SELECT 
        r.*,
        u.name as buyer_name,
        EXTRACT(EPOCH FROM (NOW() - r.created_at)) as age_seconds
       FROM p2p_buy_requests r
       JOIN users u ON u.id = r.buyer_id
       WHERE r.seller_id = $1 
       AND r.status = 'pending'
       ORDER BY r.created_at DESC
       LIMIT 1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.json({ hasPending: false });
    }

    const request = result.rows[0];
    const ageSeconds = parseFloat(request.age_seconds);

    res.json({
      hasPending: true,
      request: request,
      ageSeconds: ageSeconds,
      showPopup: ageSeconds <= 120 // Show popup if less than 2 minutes
    });

  } catch (err) {
    console.error("Get pending request age error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// =============================================
// EXPIRED TRADES CHECKER
// =============================================
async function checkExpiredTrades(io, onlineUsers) {
  try {
    const FIXED_PENALTY = 10;

    const data = await pool.query(
      `
      SELECT *
      FROM p2p_buy_requests
      WHERE status IN ('accepted', 'paid')
      AND expires_at IS NOT NULL
      AND expires_at < NOW()
      `
    );

    for (const r of data.rows) {
      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        // Lock buyer and seller
        const buyerRes = await client.query(
          `SELECT wallet_amount FROM users WHERE id = $1 FOR UPDATE`,
          [r.buyer_id]
        );

        const sellerRes = await client.query(
          `SELECT wallet_amount FROM users WHERE id = $1 FOR UPDATE`,
          [r.seller_id]
        );

        const buyerBalance = Number(buyerRes.rows[0]?.wallet_amount || 0);
        const sellerBalance = Number(sellerRes.rows[0]?.wallet_amount || 0);

        const buyerPenalty = buyerBalance >= FIXED_PENALTY ? FIXED_PENALTY : buyerBalance;
        const sellerPenalty = sellerBalance >= FIXED_PENALTY ? FIXED_PENALTY : sellerBalance;

        // Deduct penalties
        await client.query(
          `UPDATE users SET wallet_amount = wallet_amount - $1 WHERE id = $2`,
          [buyerPenalty, r.buyer_id]
        );

        await client.query(
          `UPDATE users SET wallet_amount = wallet_amount - $1 WHERE id = $2`,
          [sellerPenalty, r.seller_id]
        );

        // Insert notifications
        await client.query(
          `INSERT INTO notifications
           (title, message, target_type, target_users)
           VALUES ($1, $2, 'custom', $3)`,
          [
            "Trade Expired",
            `$${buyerPenalty} deducted because P2P trade was not completed within 30 minutes.`,
            String(r.buyer_id)
          ]
        );

        await client.query(
          `INSERT INTO notifications
           (title, message, target_type, target_users)
           VALUES ($1, $2, 'custom', $3)`,
          [
            "Trade Expired",
            `$${sellerPenalty} deducted because P2P trade was not completed within 30 minutes.`,
            String(r.seller_id)
          ]
        );

        // Update request status to 'expired'
        await client.query(
          `UPDATE p2p_buy_requests SET status = 'expired' WHERE id = $1`,
          [r.id]
        );

        // Reactivate listing
        await client.query(
          `UPDATE p2p_sell_listings SET status = 'active' WHERE id = $1`,
          [r.listing_id]
        );

        await client.query("COMMIT");

        // Socket events
        const buyerSocket = onlineUsers[r.buyer_id];
        if (buyerSocket) {
          io.to(buyerSocket).emit("trade-expired", {
            request_id: r.id,
            message: `Trade expired. $${buyerPenalty} deducted`
          });
        }

        const sellerSocket = onlineUsers[r.seller_id];
        if (sellerSocket) {
          io.to(sellerSocket).emit("trade-expired", {
            request_id: r.id,
            message: `Trade expired. $${sellerPenalty} deducted`
          });
        }

        // Push notifications
        const buyerPushToken = await getUserPushToken(r.buyer_id);
        if (buyerPushToken) {
          await sendPushNotification(
            buyerPushToken,
            '⏰ Trade Expired',
            `$${buyerPenalty} deducted from your balance for incomplete trade`,
            { type: 'trade-expired', request_id: r.id }
          );
        }

        const sellerPushToken = await getUserPushToken(r.seller_id);
        if (sellerPushToken) {
          await sendPushNotification(
            sellerPushToken,
            '⏰ Trade Expired',
            `$${sellerPenalty} deducted from your balance for incomplete trade`,
            { type: 'trade-expired', request_id: r.id }
          );
        }

        console.log(
          `Expired trade ${r.id}. Buyer -$${buyerPenalty}, Seller -$${sellerPenalty}`
        );

      } catch (err) {
        await client.query("ROLLBACK");
        console.log("Expired trade error:", err);
      } finally {
        client.release();
      }
    }

  } catch (err) {
    console.log("checkExpiredTrades error:", err);
  }
}

module.exports = {
  router,
  checkExpiredTrades,
  getUserPushToken,
  sendPushNotification
};