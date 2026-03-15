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

// Create listing (sell USDT)
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

    console.log("Creating listing with data:", {
      user_id,
      price,
      quantity,
      payment_method,
      hasQR: !!qrImageBuffer
    });

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

    console.log("Listing created successfully:", result.rows[0].id);
    
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

// Check if user can create request
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

// Create buy request
router.post("/create-buy-request", async (req, res) => {
  const { listing_id, buyer_id, quantity } = req.body;

  try {
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

    const listing = await pool.query(
      "SELECT user_id, price FROM p2p_sell_listings WHERE id=$1",
      [listing_id]
    );

    const sellerId = listing.rows[0].user_id;

    const trade = await pool.query(`
      INSERT INTO p2p_buy_requests
      (listing_id, buyer_id, seller_id, quantity, price, status, created_at)
      VALUES ($1, $2, $3, $4, 80, 'pending', NOW())
      RETURNING *
    `, [listing_id, buyer_id, sellerId, quantity]);

    const io = req.app.get("io");
    const onlineUsers = req.app.get("onlineUsers");

    const sellerSocket = onlineUsers[sellerId];

    if (sellerSocket) {
      io.to(sellerSocket).emit("new-buy-request", {
        ...trade.rows[0],
        buyer_name: "Buyer" // You can fetch actual name if needed
      });
    }

    res.json({
      success: true,
      request: trade.rows[0]
    });

  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Server error" });
  }
});

// Accept buy request
router.post("/accept-request", async (req, res) => {
  const { request_id } = req.body;

  try {
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
      return res.status(404).json({ error: "Request not found" });
    }

    const trade = result.rows[0];

    const listing = await pool.query(
      `SELECT * FROM p2p_sell_listings WHERE id=$1`,
      [trade.listing_id]
    );

    const io = req.app.get("io");
    const onlineUsers = req.app.get("onlineUsers");

    const buyerSocket = onlineUsers[trade.buyer_id];
    if (buyerSocket) {
      io.to(buyerSocket).emit("trade-accepted", {
        ...trade,
        payment_method: listing.rows[0].payment_method,
        bank_details: listing.rows[0].bank_details,
        upi_id: listing.rows[0].upi_id,
        wallet_address: listing.rows[0].wallet_address,
        qr_image: listing.rows[0].qr_image?.toString('base64')
      });
    }

    res.json({ success: true, trade });
  } catch (err) {
    console.error("Accept error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Reject request
router.post("/reject-request", async (req, res) => {
  const { request_id } = req.body;

  try {
    const result = await pool.query(
      `UPDATE p2p_buy_requests
       SET status='rejected'
       WHERE id=$1
       RETURNING *`,
      [request_id]
    );

    const trade = result.rows[0];

    const io = req.app.get("io");
    const onlineUsers = req.app.get("onlineUsers");

    const buyerSocket = onlineUsers[trade.buyer_id];

    if (buyerSocket) {
      io.to(buyerSocket).emit("trade-rejected", {
        request_id: trade.id,
        sellerName: "Seller",
        coinName: "USDT",
        quantity: trade.quantity,
        reason: "Seller rejected your request"
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Reject error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// In p2pRoutes.js, update the /payment-done endpoint:

// Upload payment proof (with update capability)
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
        // Update existing payment
        await pool.query(
          `UPDATE p2p_payments
           SET screenshot = $1, tx_id = $2, status = 'pending', created_at = NOW()
           WHERE request_id = $3`,
          [screenshot, tx_id, request_id]
        );
        console.log("Payment updated for request:", request_id);
      } else {
        // Insert new payment
        await pool.query(
          `INSERT INTO p2p_payments
           (request_id, screenshot, tx_id, status)
           VALUES($1, $2, $3, 'pending')`,
          [request_id, screenshot, tx_id]
        );
        console.log("New payment inserted for request:", request_id);
      }

      // Update request status to paid
      await pool.query(
        `UPDATE p2p_buy_requests
         SET status='paid'
         WHERE id=$1`,
        [request_id]
      );

      // Get trade details to find seller
      const trade = await pool.query(
        `SELECT seller_id FROM p2p_buy_requests WHERE id=$1`,
        [request_id]
      );

      const sellerId = trade.rows[0].seller_id;

      const io = req.app.get("io");
      const onlineUsers = req.app.get("onlineUsers");

      const sellerSocket = onlineUsers[sellerId];

      if (sellerSocket) {
        // Emit payment-resubmitted event with the new data
        io.to(sellerSocket).emit("payment-resubmitted", {
          request_id,
          tx_id
        });
        console.log("Emitted payment-resubmitted to seller:", sellerId);
      }

      res.json({ success: true });
    } catch (err) {
      console.log("Payment error:", err);
      res.status(500).json({ error: "Server error" });
    }
  }
);

// In p2pRoutes.js, update the confirm-payment endpoint:

// Confirm payment (seller approves) - FIXED VERSION
router.post("/confirm-payment", async (req, res) => {
  try {
    const { request_id } = req.body;

    console.log("Confirming payment for request:", request_id);

    // Get trade details
    const request = await pool.query(
      `SELECT r.*, l.quantity as listing_quantity, l.user_id as listing_owner
       FROM p2p_buy_requests r
       JOIN p2p_sell_listings l ON l.id = r.listing_id
       WHERE r.id=$1`,
      [request_id]
    );

    if (request.rows.length === 0) {
      return res.status(404).json({ error: "Request not found" });
    }

    const r = request.rows[0];
    console.log("Trade details:", r);

    // Insert into trade history
    await pool.query(
      `INSERT INTO p2p_trade_history
       (buyer_id, seller_id, listing_id, quantity, total)
       VALUES($1, $2, $3, $4, $5)`,
      [
        r.buyer_id,
        r.seller_id,
        r.listing_id,
        r.quantity,
        r.quantity * 80  // Fixed rate: 1 USDT = ₹80
      ]
    );

    // Update request status to completed
    await pool.query(
      `UPDATE p2p_buy_requests
       SET status='completed'
       WHERE id=$1`,
      [request_id]
    );

    // Update listing status to completed
    await pool.query(
      `UPDATE p2p_sell_listings
       SET status='completed'
       WHERE id=$1`,
      [r.listing_id]
    );

    const io = req.app.get("io");
    const onlineUsers = req.app.get("onlineUsers");

    // Notify buyer
    // Notify buyer
const buyerSocket = onlineUsers[r.buyer_id];
if (buyerSocket) {
  console.log("Emitting trade-completed to buyer:", r.buyer_id);
  io.to(buyerSocket).emit("trade-completed", {
    request_id,
    message: "Trade completed successfully"
  });
}

    // Notify seller
    const sellerSocket = onlineUsers[r.seller_id];
    if (sellerSocket) {
      console.log("Emitting trade-confirmed to seller:", r.seller_id);
      io.to(sellerSocket).emit("trade-confirmed", {
        request_id,
        message: "Trade completed successfully"
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Confirm error:", err);
    res.status(500).json({ error: "Server error: " + err.message });
  }
});

router.post("/set-penalty", async (req, res) => {
  try {

    const { penalty_amount } = req.body;

    if (!penalty_amount) {
      return res.status(400).json({ error: "Penalty amount required" });
    }

    // Remove old setting
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

router.get("/get-penalty", async (req, res) => {
  try {

    const result = await pool.query(
      `SELECT penalty_amount
       FROM p2p_penalty_settings
       ORDER BY id DESC
       LIMIT 1`
    );

    if (result.rows.length === 0) {
      return res.json({ penalty_amount: 10 }); // default fallback
    }

    res.json(result.rows[0]);

  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Server error" });
  }
});

// Reject payment (seller disputes) - FIXED VERSION
router.post("/payment-reject", async (req, res) => {
  try {
    const { request_id, reason } = req.body;

    console.log("Payment rejected for request:", request_id, "Reason:", reason);

    // Update request status back to accepted (for resubmission)
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

    // Get trade details
    const trade = await pool.query(
      `SELECT buyer_id, seller_id FROM p2p_buy_requests WHERE id=$1`,
      [request_id]
    );

    const io = req.app.get("io");
    const onlineUsers = req.app.get("onlineUsers");

    // Notify buyer
    const buyerSocket = onlineUsers[trade.rows[0].buyer_id];
    if (buyerSocket) {
      console.log("Emitting trade-disputed to buyer:", trade.rows[0].buyer_id);
      io.to(buyerSocket).emit("trade-disputed", {
        request_id,
        reason
      });
    }

    // Also notify seller that dispute was raised
    const sellerSocket = onlineUsers[trade.rows[0].seller_id];
    if (sellerSocket) {
      console.log("Emitting dispute-raised to seller:", trade.rows[0].seller_id);
      io.to(sellerSocket).emit("dispute-raised", {
        request_id,
        reason,
        message: "You have raised a dispute. Buyer will be notified."
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Reject error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Get active trade
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

// Get payment proof
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
      screenshot: payment.screenshot.toString("base64")
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Server error" });
  }
});

// Get all active listings for buyer
router.get("/listings/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const result = await pool.query(
      `SELECT 
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
        u.is_online
       FROM p2p_sell_listings l
       JOIN users u ON u.id = l.user_id
       WHERE l.status='active'
       AND l.user_id != $1
       ORDER BY l.created_at DESC`,
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
    console.log(err);
    res.status(500).json({ error: "Server error" });
  }
});

// Get my sell listings
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

    console.log(`Found ${listings.length} listings for user ${userId}`);
    res.json(listings);
  } catch (err) {
    console.error("Fetch listings error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

async function checkExpiredTrades(io, onlineUsers) {
  try {
    // GET PENALTY AMOUNT FROM ADMIN SETTING
    const penaltySetting = await pool.query(
      `SELECT penalty_amount
       FROM p2p_penalty_settings
       ORDER BY id DESC
       LIMIT 1`
    );

    const penalty = penaltySetting.rows.length > 0 
      ? parseFloat(penaltySetting.rows[0].penalty_amount) 
      : 10; // fallback if admin not set

    console.log(`Checking expired trades with penalty amount: ${penalty}`);

    const data = await pool.query(
      `SELECT * FROM p2p_buy_requests
       WHERE status IN ('accepted', 'paid')
       AND expires_at IS NOT NULL
       AND expires_at < NOW()`
    );

    for (const r of data.rows) {
      // Start a transaction to ensure all operations succeed or fail together
      const client = await pool.connect();
      
      try {
        await client.query('BEGIN');

        // Deduct penalty from both users
        await client.query(
          `UPDATE users
           SET wallet_amount = wallet_amount - $1
           WHERE id = $2`,
          [penalty, r.buyer_id]
        );

        await client.query(
          `UPDATE users
           SET wallet_amount = wallet_amount - $1
           WHERE id = $2`,
          [penalty, r.seller_id]
        );

        // Add penalty notifications
        const notificationMessage = `₹${penalty} deducted due to incomplete P2P trade`;
        
        await client.query(
          `INSERT INTO notifications (user_id, title, message, created_at)
           VALUES ($1, 'Penalty Deducted', $2, NOW())`,
          [r.buyer_id, notificationMessage]
        );

        await client.query(
          `INSERT INTO notifications (user_id, title, message, created_at)
           VALUES ($1, 'Penalty Deducted', $2, NOW())`,
          [r.seller_id, notificationMessage]
        );

        // Update request status
        await client.query(
          `UPDATE p2p_buy_requests
           SET status = 'expired'
           WHERE id = $1`,
          [r.id]
        );

        // Activate listing again
        await client.query(
          `UPDATE p2p_sell_listings
           SET status = 'active'
           WHERE id = $1`,
          [r.listing_id]
        );

        await client.query('COMMIT');

        // Notify buyer
        const buyerSocket = onlineUsers[r.buyer_id];
        if (buyerSocket) {
          io.to(buyerSocket).emit("trade-expired", {
            request_id: r.id,
            message: `Trade expired. ₹${penalty} penalty deducted`
          });
        }

        // Notify seller
        const sellerSocket = onlineUsers[r.seller_id];
        if (sellerSocket) {
          io.to(sellerSocket).emit("trade-expired", {
            request_id: r.id,
            message: `Trade expired. ₹${penalty} penalty deducted`
          });
        }

        console.log(`Trade ${r.id} expired, ₹${penalty} penalty deducted from users ${r.buyer_id} and ${r.seller_id}`);

      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`Error processing expired trade ${r.id}:`, err);
      } finally {
        client.release();
      }
    }

  } catch (err) {
    console.log("Error in checkExpiredTrades:", err);
  }
}

module.exports = {
  router,
  checkExpiredTrades
};