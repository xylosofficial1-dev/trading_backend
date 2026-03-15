const pool = require("../db/db");


// CREATE SELL LISTING
exports.createListing = async (req, res) => {
  try {
    const {
      user_id,
      coin_name,
      price,
      quantity,
      description,
      payment_method,
      bank_details,
      upi_id,
      wallet_address,
    } = req.body;

    const result = await pool.query(
      `INSERT INTO p2p_sell_listings
      (user_id, coin_name, price, quantity, description, payment_method, bank_details, upi_id, wallet_address)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *`,
      [
        user_id,
        coin_name,
        price,
        quantity,
        description,
        payment_method,
        bank_details,
        upi_id,
        wallet_address,
      ]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Server error" });
  }
};

// GET ALL ACTIVE LISTINGS
exports.getListings = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT l.*, u.name, u.is_online
      FROM p2p_sell_listings l
      JOIN users u ON u.id = l.user_id
      WHERE l.status='active'
      ORDER BY l.created_at DESC
    `);

    res.json(result.rows);
  } catch (err) {
    res.status(500).json(err);
  }
};

// SELLER ACCEPT REQUEST
exports.acceptRequest = async (req, res) => {
  try {
    const { request_id } = req.body;

    const result = await pool.query(
      `UPDATE p2p_buy_requests
      SET status='accepted',
      accepted_at = NOW(),
      expires_at = NOW() + INTERVAL '30 minutes'
      WHERE id=$1
      RETURNING *`,
      [request_id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json(err);
  }
};

// SELLER REJECT REQUEST
exports.rejectRequest = async (req, res) => {
  try {
    const { request_id } = req.body;

    await pool.query(
      `UPDATE p2p_buy_requests
       SET status='rejected'
       WHERE id=$1`,
      [request_id]
    );

    res.json({ message: "Request rejected" });
  } catch (err) {
    res.status(500).json(err);
  }
};

// UPLOAD PAYMENT PROOF
exports.uploadPayment = async (req, res) => {
  try {
    const { request_id, tx_id } = req.body;
    const screenshot = req.file.buffer;

    const result = await pool.query(
      `INSERT INTO p2p_payments
      (request_id, screenshot, tx_id)
      VALUES ($1,$2,$3)
      RETURNING *`,
      [request_id, screenshot, tx_id]
    );

    await pool.query(
      `UPDATE p2p_buy_requests
      SET status='paid'
      WHERE id=$1`,
      [request_id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json(err);
  }
};

// SELLER CONFIRM PAYMENT
exports.confirmPayment = async (req, res) => {
  try {
    const { request_id } = req.body;

    const request = await pool.query(
      `SELECT * FROM p2p_buy_requests WHERE id=$1`,
      [request_id]
    );

    const r = request.rows[0];

    await pool.query(
      `INSERT INTO p2p_trade_history
      (buyer_id,seller_id,listing_id,quantity,price,total)
      VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        r.buyer_id,
        r.seller_id,
        r.listing_id,
        r.quantity,
        r.price,
        r.total,
      ]
    );

    await pool.query(
      `UPDATE p2p_buy_requests
       SET status='completed'
       WHERE id=$1`,
      [request_id]
    );

    await pool.query(
      `UPDATE p2p_sell_listings
      SET status='completed'
      WHERE id=$1`,
      [r.listing_id]
    );

    res.json({ message: "Trade completed" });
  } catch (err) {
    res.status(500).json(err);
  }
};

exports.buyRequest = async (req, res) => {
  try {

    const { listing_id, buyer_id, quantity } = req.body;

    const listing = await pool.query(
      "SELECT * FROM p2p_sell_listings WHERE id=$1",
      [listing_id]
    );

    if (listing.rows.length === 0)
      return res.json({ success: false });

    const seller = listing.rows[0];

    const total = seller.price * quantity;

    const result = await pool.query(
      `INSERT INTO p2p_buy_requests
      (listing_id,buyer_id,seller_id,coin_name,price,quantity,total,status)
      VALUES($1,$2,$3,$4,$5,$6,$7,'pending')
      RETURNING *`,
      [
        listing_id,
        buyer_id,
        seller.user_id,
        seller.coin_name,
        seller.price,
        quantity,
        total
      ]
    );

    res.json({ success: true, request: result.rows[0] });

  } catch (err) {
    console.log(err);
    res.json({ success: false });
  }
};

exports.getSellerRequests = async (req, res) => {

  const { sellerId } = req.params;

  const data = await pool.query(
    `SELECT r.*,u.name as buyer_name
     FROM p2p_buy_requests r
     JOIN users u ON u.id=r.buyer_id
     WHERE r.seller_id=$1
     AND r.status='pending'
     ORDER BY r.created_at DESC`,
    [sellerId]
  );

  res.json(data.rows);
};

exports.acceptRequest = async (req, res) => {

  const { request_id } = req.body;

  const request = await pool.query(
    "SELECT * FROM p2p_buy_requests WHERE id=$1",
    [request_id]
  );

  if (!request.rows.length)
    return res.json({ success:false });

  const listing_id = request.rows[0].listing_id;

  await pool.query(
    `UPDATE p2p_buy_requests
     SET status='accepted',
     accepted_at=NOW(),
     expires_at=NOW()+INTERVAL '30 minutes'
     WHERE id=$1`,
    [request_id]
  );

  await pool.query(
    `UPDATE p2p_sell_listings
     SET status='locked'
     WHERE id=$1`,
    [listing_id]
  );

  res.json({ success:true });
};

exports.rejectRequest = async (req, res) => {

  const { request_id } = req.body;

  await pool.query(
    "UPDATE p2p_buy_requests SET status='rejected' WHERE id=$1",
    [request_id]
  );

  res.json({ success:true });
};

exports.getActiveTrade = async (req,res)=>{

  const { userId } = req.params;

  const data = await pool.query(
    `SELECT r.*,l.bank_details,l.upi_id,l.wallet_address,l.qr_image
     FROM p2p_buy_requests r
     JOIN p2p_sell_listings l ON l.id=r.listing_id
     WHERE (r.buyer_id=$1 OR r.seller_id=$1)
     AND r.status IN ('accepted','paid')
     LIMIT 1`,
    [userId]
  );

  res.json(data.rows[0] || null);
};

exports.paymentDone = async (req,res)=>{

 const { request_id, screenshot, tx_id } = req.body;

 await pool.query(
   `INSERT INTO p2p_payments
    (request_id,screenshot,tx_id,status)
    VALUES($1,$2,$3,'pending')`,
   [request_id,screenshot,tx_id]
 );

 await pool.query(
   `UPDATE p2p_buy_requests
    SET status='paid'
    WHERE id=$1`,
   [request_id]
 );

 res.json({success:true});
};

exports.confirmPayment = async (req,res)=>{

 const { request_id } = req.body;

 const request = await pool.query(
   "SELECT * FROM p2p_buy_requests WHERE id=$1",
   [request_id]
 );

 const r = request.rows[0];

 await pool.query(
  `INSERT INTO p2p_trade_history
   (buyer_id,seller_id,listing_id,quantity,price,total)
   VALUES($1,$2,$3,$4,$5,$6)`,
   [
     r.buyer_id,
     r.seller_id,
     r.listing_id,
     r.quantity,
     r.price,
     r.total
   ]
 );

 await pool.query(
   `UPDATE p2p_buy_requests
    SET status='completed'
    WHERE id=$1`,
   [request_id]
 );

 await pool.query(
   `UPDATE p2p_sell_listings
    SET status='completed'
    WHERE id=$1`,
   [r.listing_id]
 );

 res.json({success:true});
};

async function checkExpiredTrades(){

 const data = await pool.query(
   `SELECT * FROM p2p_buy_requests
    WHERE status IN ('accepted','paid')
    AND expires_at < NOW()`
 );

 for(const r of data.rows){

   await pool.query(
    `UPDATE users
     SET wallet_amount=wallet_amount-10
     WHERE id=$1 OR id=$2`,
     [r.buyer_id,r.seller_id]
   );

   await pool.query(
     `UPDATE p2p_buy_requests
      SET status='expired'
      WHERE id=$1`,
     [r.id]
   );

   await pool.query(
     `UPDATE p2p_sell_listings
      SET status='active'
      WHERE id=$1`,
     [r.listing_id]
   );

 }
}