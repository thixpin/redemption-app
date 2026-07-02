// Standalone script to create tables and seed demo codes.
// Usage: npm run db:init
require("dotenv").config();
const db = require("./db");

(async () => {
  try {
    await db.initSchema();
    await db.seed();
    console.log("Database initialized and seeded.");
  } catch (err) {
    console.error("DB init failed:", err);
    process.exitCode = 1;
  } finally {
    await db.close();
  }
})();
