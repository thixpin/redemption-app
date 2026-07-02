// Data-access layer backed by PostgreSQL.
// Row shapes are mapped to camelCase so the rest of the app stays DB-agnostic.

const db = require("./db");

function mapCode(row) {
  if (!row) return undefined;
  return {
    code: row.code,
    reward: row.reward,
    maxRedemptions: row.max_redemptions,
    redeemedCount: row.redeemed_count,
    active: row.active,
    createdAt: row.created_at,
  };
}

function mapRedemption(row) {
  return {
    id: row.id,
    code: row.code,
    userId: row.user_id,
    reward: row.reward,
    redeemedAt: row.redeemed_at,
  };
}

async function getCode(code) {
  const { rows } = await db.query("SELECT * FROM codes WHERE code = $1", [code]);
  return mapCode(rows[0]);
}

async function listCodes() {
  const { rows } = await db.query("SELECT * FROM codes ORDER BY created_at");
  return rows.map(mapCode);
}

async function createCode({ code, reward, maxRedemptions }) {
  const { rows } = await db.query(
    `INSERT INTO codes (code, reward, max_redemptions)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [code, reward, maxRedemptions]
  );
  return mapCode(rows[0]);
}

// Atomically redeem a code inside a transaction.
// Returns a result object: { status, redemption?, remaining? }
// status is one of: ok | not_found | inactive | already | limit
async function redeem(code, userId) {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");

    // Lock the code row so concurrent redemptions serialize on it.
    const { rows } = await client.query(
      "SELECT * FROM codes WHERE code = $1 FOR UPDATE",
      [code]
    );
    const entry = rows[0];

    if (!entry) {
      await client.query("ROLLBACK");
      return { status: "not_found" };
    }
    if (!entry.active) {
      await client.query("ROLLBACK");
      return { status: "inactive" };
    }

    const dup = await client.query(
      "SELECT 1 FROM redemptions WHERE code = $1 AND user_id = $2",
      [code, userId]
    );
    if (dup.rowCount > 0) {
      await client.query("ROLLBACK");
      return { status: "already" };
    }

    if (entry.redeemed_count >= entry.max_redemptions) {
      await client.query("ROLLBACK");
      return { status: "limit" };
    }

    await client.query(
      "UPDATE codes SET redeemed_count = redeemed_count + 1 WHERE code = $1",
      [code]
    );
    const inserted = await client.query(
      `INSERT INTO redemptions (code, user_id, reward)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [code, userId, entry.reward]
    );

    await client.query("COMMIT");
    return {
      status: "ok",
      redemption: mapRedemption(inserted.rows[0]),
      remaining: entry.max_redemptions - (entry.redeemed_count + 1),
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function listRedemptions(userId) {
  if (userId) {
    const { rows } = await db.query(
      "SELECT * FROM redemptions WHERE user_id = $1 ORDER BY id",
      [userId]
    );
    return rows.map(mapRedemption);
  }
  const { rows } = await db.query("SELECT * FROM redemptions ORDER BY id");
  return rows.map(mapRedemption);
}

module.exports = {
  getCode,
  listCodes,
  createCode,
  redeem,
  listRedemptions,
};
