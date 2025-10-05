import pg from "pg";
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

export async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      device_id TEXT PRIMARY KEY,
      ip TEXT,
      ua TEXT,
      started_at TIMESTAMPTZ DEFAULT now(),
      finished_at TIMESTAMPTZ,
      score INT,
      reward TEXT,
      quiz JSONB,
      end_time TIMESTAMPTZ,
      checked_in BOOLEAN DEFAULT false
    );
  `);
}

export { pool };
