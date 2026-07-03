require("dotenv").config();
const express = require("express");
const routes = require("./routes");
const db = require("./db");
const metrics = require("./metrics");

const app = express();
const PORT = process.env.PORT || 3000;

// Record request metrics first so timing covers the full request lifecycle.
app.use(metrics.metricsMiddleware);

app.use(express.json());

// Health check.
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// Prometheus scrape endpoint.
app.get("/metrics", metrics.metricsHandler);

app.use("/api", routes);

// 404 fallback.
app.use((req, res) => {
  res.status(404).json({ error: "Not found." });
});

// Central error handler (malformed JSON, DB errors, etc.).
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Invalid JSON body." });
  }
  console.error(err);
  res.status(500).json({ error: "Internal server error." });
});

async function start() {
  await db.initSchema();
  await db.seed();
  const server = app.listen(PORT, () => {
    console.log(`Redemption API listening on http://localhost:${PORT}`);
  });

  // Graceful shutdown.
  const shutdown = async () => {
    server.close();
    await db.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// Start only when run directly (not when imported for tests).
if (require.main === module) {
  start().catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
}

module.exports = app;
