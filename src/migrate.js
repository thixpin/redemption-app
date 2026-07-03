// Standalone schema migration: runs idempotent DDL, then exits.
// Executed as an Argo CD PreSync Job (see infra k8s/app/base/migrate-job.yaml)
// BEFORE new app pods roll out — never on application boot. This keeps a burst
// of HPA-scaled pods from running migrations concurrently during a 10x spike.
// Seeding is intentionally NOT done here (that's dev-only, via `npm run db:init`).
require("dotenv").config();
const db = require("./db");

(async () => {
  try {
    await db.initSchema();
    console.log("Schema migration complete.");
  } catch (err) {
    console.error("Migration failed:", err);
    process.exitCode = 1;
  } finally {
    await db.close();
  }
})();
