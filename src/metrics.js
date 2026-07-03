// Prometheus instrumentation. Exposes default Node.js process metrics plus an
// HTTP request-duration histogram. Scraped by the ServiceMonitor at /metrics.
const client = require("prom-client");

const register = new client.Registry();

// Default process metrics: CPU, memory, event-loop lag, GC, handles, etc.
client.collectDefaultMetrics({ register });

// One histogram covers latency (buckets), throughput (_count) and errors
// (status_code label) — the PrometheusRule alerts and the RPS HPA all derive
// from http_request_duration_seconds_*.
const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

// Times each request and records it when the response finishes.
function metricsMiddleware(req, res, next) {
  // Don't record scrapes of the metrics endpoint itself.
  if (req.path === "/metrics") return next();

  const end = httpRequestDuration.startTimer();
  res.on("finish", () => {
    // Use the matched route pattern (e.g. /api/codes) so label cardinality
    // stays bounded; unmatched requests (404s) collapse to a single series.
    const route = req.route ? (req.baseUrl || "") + req.route.path : "unmatched";
    end({ method: req.method, route, status_code: res.statusCode });
  });
  next();
}

// GET /metrics handler.
async function metricsHandler(req, res) {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
}

module.exports = { register, metricsMiddleware, metricsHandler, httpRequestDuration };
