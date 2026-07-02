const { Pool } = require("pg");

// Connection is configured via environment variables:
//   DATABASE_URL=postgres://user:pass@host:5432/dbname
// or the standard PG* vars (PGHOST, PGUSER, PGPASSWORD, PGDATABASE, PGPORT).
const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {} // falls back to PG* env vars / libpq defaults
);

// Thin query helper so callers don't touch the pool directly.
function query(text, params) {
  return pool.query(text, params);
}

// Create tables if they don't already exist.
async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS codes (
      code             TEXT PRIMARY KEY,
      reward           TEXT NOT NULL,
      max_redemptions  INTEGER NOT NULL CHECK (max_redemptions >= 1),
      redeemed_count   INTEGER NOT NULL DEFAULT 0,
      active           BOOLEAN NOT NULL DEFAULT TRUE,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS redemptions (
      id           SERIAL PRIMARY KEY,
      code         TEXT NOT NULL REFERENCES codes(code),
      user_id      TEXT NOT NULL,
      reward       TEXT NOT NULL,
      redeemed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (code, user_id)
    );
  `);
}

// Insert demo codes; ignore ones that already exist.
async function seed() {
  const demo = [
    ["WELCOME10", "10% off", 100],
    ["FREESHIP", "Free shipping", 1],
    ["GIFT50", "$50 gift card", 5],
  ];
  for (const [code, reward, max] of demo) {
    await pool.query(
      `INSERT INTO codes (code, reward, max_redemptions)
       VALUES ($1, $2, $3)
       ON CONFLICT (code) DO NOTHING`,
      [code, reward, max]
    );
  }
}

function close() {
  return pool.end();
}

module.exports = { pool, query, initSchema, seed, close };
