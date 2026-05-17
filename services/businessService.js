// utils/directBusinessCalculator.js

const pool = require("../db/db");

const getDirectBusiness = async (userId) => {

  const result = await pool.query(
    `
    WITH RECURSIVE downline AS (

      SELECT id
      FROM users
      WHERE id = $1

      UNION

      SELECT u.id
      FROM users u
      INNER JOIN downline d
        ON u.parent_id = d.id
    )

    SELECT COALESCE(SUM(wt.amount), 0) AS total
    FROM wallet_transfers wt
    WHERE wt.user_id IN (
      SELECT id FROM downline
    )
    AND wt.transfer_type = 'MAIN_TO_TRADE'
    `,
    [userId]
  );

  return Number(result.rows[0].total);
};

module.exports = getDirectBusiness;