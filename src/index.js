import "dotenv/config";
import express from "express";
import cors from "cors";
import { pool, initSchema } from "./db.js";
import { loadPools } from "./sheets.js";

const app = express();
app.use(express.json());
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(",") || "*" }));

await initSchema();

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
  const { deviceId, checkedIn } = req.body || {};
  if (!deviceId) return res.status(400).json({ error: "deviceId required" });

  const ip = getIP(req);
  const ua = req.headers["user-agent"] || "";

  const existing = await pool.query(
    "SELECT * FROM sessions WHERE device_id=$1",
    [deviceId]
  );
  if (existing.rows.length) {
    const row = existing.rows[0];
    if (row.finished_at) {
      return res.json({
        alreadyPlayed: true,
        result: { score: row.score, reward: row.reward },
      });
    }
    return res.json({ ok: true, endTime: row.end_time });
  }

  const endTime = new Date(Date.now() + 60_000);
  await pool.query(
    `INSERT INTO sessions(device_id, ip, ua, end_time, checked_in)
     VALUES($1,$2,$3,$4,$5)`,
    [deviceId, ip, ua, endTime, !!checkedIn]
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

  // 🟡 Nếu đã check-in → chỉ 1 câu hỏi loại A
  let quiz = row.checked_in ? [pick(A)] : [pick(A), pick(A), pick(B)];

  await pool.query("UPDATE sessions SET quiz=$2 WHERE device_id=$1", [
    deviceId,
    JSON.stringify(quiz),
  ]);

  res.json({ quiz });
});

app.post("/api/finish", async (req, res) => {
  const { deviceId, score } = req.body || {};
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

  const reward = row.checked_in ? "GIFT_LARGE" : rewardFromScore(score);
  const finishedAt = new Date();

  await pool.query(
    "UPDATE sessions SET score=$2, reward=$3, finished_at=$4 WHERE device_id=$1",
    [deviceId, score, reward, finishedAt]
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

const port = process.env.PORT || 5000;
app.listen(port, () => console.log("Backend listening on", port));
