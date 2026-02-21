// backend/routes/videoRoutes.js
const express = require("express");
const router = express.Router();
const pool = require("../db/db");
const multer = require("multer");

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    if (
      file.mimetype === "video/mp4" ||
      file.mimetype.startsWith("image/")
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only MP4 videos and image thumbnails allowed"));
    }
  },
});

router.post("/topics", async (req, res) => {
  const { name } = req.body;

  if (!name) {
    return res.status(400).json({ error: "Topic name required" });
  }

  const result = await pool.query(
    "INSERT INTO video_topics (name) VALUES ($1) RETURNING *",
    [name]
  );

  res.json(result.rows[0]);
});

router.get("/topics", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, created_at
       FROM video_topics
       ORDER BY name ASC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post(
  "/youtube",
  upload.single("thumbnail"),
  async (req, res) => {
    const { topic_id, title, link } = req.body;

    const thumbnailBuffer = req.file ? req.file.buffer : null;

    const result = await pool.query(
      `INSERT INTO videos (topic_id, title, type, link, thumbnail)
       VALUES ($1, $2, 'youtube', $3, $4)
       RETURNING id, title, type, created_at`,
      [topic_id, title, link, thumbnailBuffer]
    );

    res.json(result.rows[0]);
  }
);

router.post(
  "/file",
  upload.fields([
    { name: "video", maxCount: 1 },
    { name: "thumbnail", maxCount: 1 },
  ]),
  async (req, res) => {
    const { topic_id, title } = req.body;

    if (!req.files?.video) {
      return res.status(400).json({ error: "Video is required" });
    }

    const videoBuffer = req.files.video[0].buffer;
    const thumbnailBuffer = req.files.thumbnail
      ? req.files.thumbnail[0].buffer
      : null;

    const result = await pool.query(
      `INSERT INTO videos (topic_id, title, type, video_data, thumbnail)
       VALUES ($1, $2, 'file', $3, $4)
       RETURNING id, title, type, created_at`,
      [topic_id, title, videoBuffer, thumbnailBuffer]
    );

    res.json(result.rows[0]);
  }
);

router.get("/thumbnail/:id", async (req, res) => {
  const result = await pool.query(
    "SELECT thumbnail FROM videos WHERE id=$1",
    [req.params.id]
  );

  if (!result.rows.length || !result.rows[0].thumbnail) {
    return res.status(404).send("Thumbnail not found");
  }

  res.setHeader("Content-Type", "image/*");
  res.send(result.rows[0].thumbnail);
});


router.delete("/:id", async (req, res) => {
  await pool.query("DELETE FROM videos WHERE id=$1", [req.params.id]);
  res.json({ success: true });
});

router.get("/stream/:id", async (req, res) => {
  const result = await pool.query(
    "SELECT video_data FROM videos WHERE id=$1",
    [req.params.id]
  );

  if (!result.rows.length || !result.rows[0].video_data) {
    return res.status(404).send("Video not found");
  }

  const buffer = result.rows[0].video_data;

  res.writeHead(200, {
    "Content-Type": "video/mp4",
    "Content-Length": buffer.length,
    "Accept-Ranges": "bytes",
  });

  res.end(buffer);
});

// GET all videos
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, topic_id, title, type, link, created_at
      FROM videos
      ORDER BY created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:topicId", async (req, res) => {
  const result = await pool.query(
    `SELECT id, title, type, link, created_at
     FROM videos
     WHERE topic_id=$1
     ORDER BY created_at DESC`,
    [req.params.topicId]
  );
  res.json(result.rows);
});

module.exports = router;