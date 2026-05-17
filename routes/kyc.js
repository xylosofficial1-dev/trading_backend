const express = require("express");
const router = express.Router();
const multer = require("multer");

const pool = require("../db/db");

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

router.post(
  "/submit",
  upload.fields([
    { name: "gov_id_image", maxCount: 1 },
    { name: "face_image", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const { user_id } = req.body;

      if (!user_id) {
        return res.status(400).json({
          error: "User ID required",
        });
      }

      const govImage = req.files?.gov_id_image?.[0];
      const faceImage = req.files?.face_image?.[0];

      if (!govImage || !faceImage) {
        return res.status(400).json({
          error: "Both images required",
        });
      }

      /*
      check existing
      */
      const existing = await pool.query(
        `
        SELECT * FROM kyc_requests
        WHERE user_id = $1
        `,
        [user_id]
      );

      if (existing.rows.length > 0) {

        /*
        update existing
        */
        await pool.query(
          `
          UPDATE kyc_requests
          SET
            gov_id_image = $1,
            face_image = $2,
            status = 'pending',
            reject_reason = NULL,
            updated_at = NOW()
          WHERE user_id = $3
          `,
          [
            govImage.buffer,
            faceImage.buffer,
            user_id,
          ]
        );

      } else {

        /*
        insert new
        */
        await pool.query(
          `
          INSERT INTO kyc_requests
          (
            user_id,
            gov_id_image,
            face_image
          )
          VALUES ($1,$2,$3)
          `,
          [
            user_id,
            govImage.buffer,
            faceImage.buffer,
          ]
        );
      }

      res.json({
        success: true,
        message: "KYC submitted",
      });

    } catch (err) {
      console.log(err);

      res.status(500).json({
        error: "Server error",
      });
    }
  }
);

router.get("/status/:userId", async (req, res) => {
  try {

    const { userId } = req.params;

    const result = await pool.query(
      `
      SELECT
        id,
        status,
        reject_reason,
        created_at
      FROM kyc_requests
      WHERE user_id = $1
      `,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.json({
        submitted: false,
      });
    }

    res.json({
      submitted: true,
      data: {
        ...result.rows[0],

       gov_image_url:
  `/api/kyc/gov-image/${userId}`,

face_image_url:
  `/api/kyc/face-image/${userId}`,
      },
    });

  } catch (err) {
    console.log(err);

    res.status(500).json({
      error: "Server error",
    });
  }
});

router.put("/approve/:id", async (req, res) => {
  try {

    const { id } = req.params;

    /*
    get kyc request
    */
    const kycResult = await pool.query(
      `
      SELECT user_id
      FROM kyc_requests
      WHERE id = $1
      `,
      [id]
    );

    if (kycResult.rows.length === 0) {
      return res.status(404).json({
        error: "KYC request not found",
      });
    }

    const userId = kycResult.rows[0].user_id;

    /*
    approve kyc
    */
    await pool.query(
      `
      UPDATE kyc_requests
      SET
        status = 'approved',
        reject_reason = NULL,
        updated_at = NOW()
      WHERE id = $1
      `,
      [id]
    );

    /*
    update users table
    */
    await pool.query(
      `
      UPDATE users
      SET kyc_verify = true
      WHERE id = $1
      `,
      [userId]
    );

    /*
    store notification
    */
    await pool.query(
      `
      INSERT INTO notifications
      (
        title,
        message,
        target_type,
        target_users
      )
      VALUES ($1,$2,$3,$4)
      `,
      [
        "KYC Approved",
        "Your KYC verification has been approved successfully.",
        "custom",
        userId.toString(),
      ]
    );

    res.json({
      success: true,
      message: "KYC approved",
    });

  } catch (err) {
    console.log(err);

    res.status(500).json({
      error: "Server error",
    });
  }
});

router.put("/reject/:id", async (req, res) => {
  try {

    const { id } = req.params;

    const { reason } = req.body;

    /*
    get kyc request
    */
    const kycResult = await pool.query(
      `
      SELECT user_id
      FROM kyc_requests
      WHERE id = $1
      `,
      [id]
    );

    if (kycResult.rows.length === 0) {
      return res.status(404).json({
        error: "KYC request not found",
      });
    }

    const userId = kycResult.rows[0].user_id;

    /*
    reject kyc
    */
    await pool.query(
      `
      UPDATE kyc_requests
      SET
        status = 'rejected',
        reject_reason = $1,
        updated_at = NOW()
      WHERE id = $2
      `,
      [
        reason,
        id,
      ]
    );

    /*
    update users table
    */
    await pool.query(
      `
      UPDATE users
      SET kyc_verify = false
      WHERE id = $1
      `,
      [userId]
    );

    /*
    store notification
    */
    await pool.query(
      `
      INSERT INTO notifications
      (
        title,
        message,
        target_type,
        target_users
      )
      VALUES ($1,$2,$3,$4)
      `,
      [
        "KYC Rejected",
        `Your KYC verification was rejected. Reason: ${reason}`,
        "custom",
        userId.toString(),
      ]
    );

    res.json({
      success: true,
      message: "KYC rejected",
    });

  } catch (err) {
    console.log(err);

    res.status(500).json({
      error: "Server error",
    });
  }
});

router.get("/gov-image/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const result = await pool.query(
      `
      SELECT gov_id_image
      FROM kyc_requests
      WHERE user_id = $1
      `,
      [userId]
    );

    if (result.rows.length === 0 || !result.rows[0].gov_id_image) {
      return res.status(404).send("Image not found");
    }

    res.set("Content-Type", "image/jpeg");

    res.send(result.rows[0].gov_id_image);

  } catch (err) {
    console.log(err);

    res.status(500).json({
      error: "Server error",
    });
  }
});

router.get("/face-image/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const result = await pool.query(
      `
      SELECT face_image
      FROM kyc_requests
      WHERE user_id = $1
      `,
      [userId]
    );

    if (result.rows.length === 0 || !result.rows[0].face_image) {
      return res.status(404).send("Image not found");
    }

    res.set("Content-Type", "image/jpeg");

    res.send(result.rows[0].face_image);

  } catch (err) {
    console.log(err);

    res.status(500).json({
      error: "Server error",
    });
  }
});

router.get("/admin/all", async (req, res) => {
  try {

    const result = await pool.query(
      `
      SELECT
        k.id,
        k.user_id,
        k.status,
        k.reject_reason,
        k.created_at,

        u.name,
        u.email,
        u.phone

      FROM kyc_requests k
      JOIN users u
      ON u.id = k.user_id

      ORDER BY k.created_at DESC
      `
    );

    const formatted = result.rows.map((item) => ({
      id: item.id,
      userId: item.user_id,
      userName: item.name,
      userEmail: item.email,
      phone: item.phone,
      status: item.status,
      rejectionReason: item.reject_reason,
      submittedAt: item.created_at,

      govImage:
        `${req.protocol}://${req.get("host")}/api/kyc/gov-image/${item.user_id}`,

      faceImage:
        `${req.protocol}://${req.get("host")}/api/kyc/face-image/${item.user_id}`,
    }));

    res.json({
      success: true,
      data: formatted,
    });

  } catch (err) {
    console.log(err);

    res.status(500).json({
      error: "Server error",
    });
  }
});

router.get("/image/gov/:id", async (req, res) => {
  try {

    const { id } = req.params;

    const result = await pool.query(
      `
      SELECT gov_id_image
      FROM kyc_requests
      WHERE id = $1
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).send("Not found");
    }

    res.set("Content-Type", "image/jpeg");

    res.send(result.rows[0].gov_id_image);

  } catch (err) {
    console.log(err);

    res.status(500).send("Server error");
  }
});

router.get("/image/face/:id", async (req, res) => {
  try {

    const { id } = req.params;

    const result = await pool.query(
      `
      SELECT face_image
      FROM kyc_requests
      WHERE id = $1
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).send("Not found");
    }

    res.set("Content-Type", "image/jpeg");

    res.send(result.rows[0].face_image);

  } catch (err) {
    console.log(err);

    res.status(500).send("Server error");
  }
});

module.exports = router;