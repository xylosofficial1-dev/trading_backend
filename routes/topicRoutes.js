const express = require("express");
const router = express.Router();
const pool = require("../db/db");

router.get("/", async (_, res) => {
  const result = await pool.query(`
    SELECT t.id, t.name,
    COUNT(v.id)::int AS count
    FROM video_topics t
    LEFT JOIN videos v ON v.topic_id = t.id
    GROUP BY t.id
    ORDER BY t.id
  `);
  res.json(result.rows);
});

router.post("/", async (req, res) => {
  const { name } = req.body;
  const result = await pool.query(
    "INSERT INTO video_topics (name) VALUES ($1) RETURNING *",
    [name]
  );
  res.json(result.rows[0]);
});

module.exports = router;
