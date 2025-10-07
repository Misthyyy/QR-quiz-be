import "dotenv/config";
import express from "express";
import cors from "cors";
import { pool, initSchema } from "./db.js";
import { loadDonorPhones, loadPools } from "./sheets.js";

async function main() {
  // ✅ Tạo bảng nếu chưa có
  try {
    await initSchema();
    console.log("Schema initialized");
  } catch (err) {
    console.error("Failed to init schema:", err);
    process.exit(1);
  }

  const app = express();
  app.use(express.json());

  // ✅ CORS setup
  const allowedOrigins = (process.env.CORS_ORIGIN || "").split(",");
  app.use(
    cors({
      origin: function (origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error("Not allowed by CORS"));
        }
      },
      methods: ["GET", "POST", "PUT", "DELETE"],
      credentials: true,
    })
  );

  // Cache tạm thời 60s
  let cached = { A: [], B: [], ts: 0 };
  async function getPools() {
    const now = Date.now();
    if (!cached.ts || now - cached.ts > 60_000) {
      cached = { ...(await loadPools()), ts: now };
    }
    return cached;
  }

  function getIP(req) {
    return (
      (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
      req.socket.remoteAddress
    );
  }

  function rewardFromScore(score) {
    if (score >= 3) return "GIFT_LARGE";
    if (score === 2) return "GIFT_MEDIUM";
    if (score === 1) return "GIFT_SMALL";
    return "NO_GIFT";
  }

  // 🟢 START GAME
  app.post("/api/start", async (req, res) => {
    const { deviceId, link } = req.body || {};
    if (!deviceId) return res.status(400).json({ error: "deviceId required" });

    const ip = getIP(req);
    const ua = req.headers["user-agent"] || "";

    const existing = await pool.query(
      "SELECT * FROM sessions WHERE device_id=$1",
      [deviceId]
    );

    if (existing.rows.length) {
      const row = existing.rows[0];

      // Nếu đã finish, trả kết quả
      if (row.finished_at) {
        return res.json({
          alreadyPlayed: true,
          result: { score: row.score, reward: row.reward },
        });
      }

      // Nếu chưa finish, update check-in nếu có link mới
      if (link) {
        await pool.query(
          `UPDATE sessions SET checkin_link=$1, checked_in=$2 WHERE device_id=$3`,
          [link, true, deviceId]
        );
      }

      return res.json({ ok: true, endTime: row.end_time });
    }

    // Nếu chưa có session, insert mới
    const endTime = new Date(Date.now() + 60_000);
    await pool.query(
      `INSERT INTO sessions(device_id, ip, ua, end_time, checked_in, checkin_link)
     VALUES($1,$2,$3,$4,$5,$6)`,
      [deviceId, ip, ua, endTime, !!link, link || null]
    );

    res.json({ ok: true, endTime });
  });

  // 🟢 GET QUESTIONS
  app.get("/api/questions", async (req, res) => {
    const { deviceId } = req.query;
    if (!deviceId) return res.status(400).json({ error: "deviceId required" });

    const sess = await pool.query("SELECT * FROM sessions WHERE device_id=$1", [
      deviceId,
    ]);
    if (!sess.rows.length)
      return res.status(400).json({ error: "call /api/start first" });

    const row = sess.rows[0];
    if (row.finished_at) {
      return res.json({
        alreadyPlayed: true,
        result: { score: row.score, reward: row.reward },
      });
    }

    const { A, B } = await getPools();
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

    let quiz = row.checked_in ? [pick(A)] : [pick(A), pick(A), pick(B)];

    await pool.query("UPDATE sessions SET quiz=$2 WHERE device_id=$1", [
      deviceId,
      JSON.stringify(quiz),
    ]);

    res.json({ quiz });
  });

  app.post("/api/finish", async (req, res) => {
    const { deviceId, score, link } = req.body || {};
    if (!deviceId || typeof score !== "number")
      return res.status(400).json({ error: "deviceId & score required" });

    const sess = await pool.query("SELECT * FROM sessions WHERE device_id=$1", [
      deviceId,
    ]);
    if (!sess.rows.length) return res.status(400).json({ error: "no session" });

    const row = sess.rows[0];
    if (row.finished_at) {
      return res.json({ score: row.score, reward: row.reward });
    }

    // Nếu frontend gửi link mới, update luôn
    let checkedIn = row.checked_in;
    let checkinLink = row.checkin_link;
    if (link) {
      checkedIn = true;
      checkinLink = link;
    }

    const reward = checkedIn ? "GIFT_LARGE" : rewardFromScore(score);
    const finishedAt = new Date();

    await pool.query(
      `UPDATE sessions 
       SET score=$2, reward=$3, finished_at=$4, checked_in=$5, checkin_link=$6
     WHERE device_id=$1`,
      [deviceId, score, reward, finishedAt, checkedIn, checkinLink]
    );

    res.json({ score, reward });
  });

  // 🟢 GET RESULT
  app.get("/api/result/:deviceId", async (req, res) => {
    const { deviceId } = req.params;
    const r = await pool.query(
      "SELECT score, reward FROM sessions WHERE device_id=$1",
      [deviceId]
    );
    if (!r.rows.length) return res.json(null);
    res.json(r.rows[0]);
  });

  // 🟢 GET DONOR PHONES
  app.get("/api/donors", async (req, res) => {
    try {
      const donors = await loadDonorPhones();
      res.json(donors.map((d) => d.phone));
    } catch (err) {
      console.error("Error loading donors:", err);
      res.status(500).json({ error: "Failed to load donor phones" });
    }
  });

  const port = process.env.PORT || 5000;
  app.listen(port, () => console.log("Backend listening on", port));
}

// Start backend
main().catch((err) => {
  console.error("Failed to start backend:", err);
  process.exit(1);
});
