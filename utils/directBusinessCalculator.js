// const pool = require("../db/db");

// async function getDirectBusiness(userId) {

//   const result = await pool.query(
//     `
//     SELECT COALESCE(SUM(trading_wallet_amount),0) AS total
//     FROM users
//     WHERE parent_id = $1
//     `,
//     [userId]
//   );

//   return Number(result.rows[0].total);

// }

// module.exports = getDirectBusiness;

const pool = require("../db/db");

async function getAllDownlines(userId) {
  const result = await pool.query(
    `
    WITH RECURSIVE downline AS (
      SELECT id, parent_id
      FROM users
      WHERE parent_id = $1

      UNION ALL

      SELECT u.id, u.parent_id
      FROM users u
      INNER JOIN downline d
        ON u.parent_id = d.id
    )
    SELECT id FROM downline
    `,
    [userId]
  );

  return result.rows.map(r => r.id);
}

async function getDirectBusiness(userId) {

  // include self
  const ids = [Number(userId)];

  // all levels
  const downlines = await getAllDownlines(userId);

  ids.push(...downlines);

  const result = await pool.query(
    `
    SELECT COALESCE(SUM(amount),0) AS total
    FROM wallet_transfers
    WHERE transfer_type = 'MAIN_TO_TRADE'
    AND user_id = ANY($1)
    `,
    [ids]
  );

  return Number(result.rows[0].total || 0);
}

module.exports = getDirectBusiness;