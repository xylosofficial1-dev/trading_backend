// const { Pool } = require("pg");
// require("dotenv").config();

// const pool = new Pool({
//   host: process.env.DB_HOST,
//   user: process.env.DB_USER,
//   password: process.env.DB_PASSWORD,
//   database: process.env.DB_NAME,
//   port: process.env.DB_PORT,
// });

// pool.on("connect", () => {
//   console.log("📦 PostgreSQL Connected (db/db.js)");
//   console.log("🗄️ DB NAME:", process.env.DB_NAME);

// });

// module.exports = pool;

const { Pool } = require("pg");
require("dotenv").config();

const isProduction = process.env.NODE_ENV === "production";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
});

pool.on("connect", () => {
  console.log("📦 PostgreSQL Connected");
});

module.exports = pool;