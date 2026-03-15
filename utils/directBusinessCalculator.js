const pool = require("../db/db");

async function getDirectBusiness(userId) {

  const result = await pool.query(
    `
    SELECT COALESCE(SUM(trading_wallet_amount),0) AS total
    FROM users
    WHERE parent_id = $1
    `,
    [userId]
  );

  return Number(result.rows[0].total);

}

module.exports = getDirectBusiness;