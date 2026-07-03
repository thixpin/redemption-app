// End-to-end API tests using Node's built-in test runner + supertest.
//
// Requires a running PostgreSQL. Tests run against TEST_DATABASE_URL if set,
// otherwise DATABASE_URL. The chosen database's `codes` and `redemptions`
// tables are TRUNCATED before the suite runs, so point it at a throwaway DB.
require("dotenv").config();

// db.js reads DATABASE_URL when the pool is created, so override it *before*
// requiring the app.
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const app = require("../src/server");
const db = require("../src/db");

before(async () => {
  await db.initSchema();
});

// Fresh, seeded state before every test for isolation.
beforeEach(async () => {
  await db.query("TRUNCATE redemptions, codes RESTART IDENTITY CASCADE");
  await db.seed();
});

after(async () => {
  await db.close();
});

test("GET /health returns ok", async () => {
  const res = await request(app).get("/health");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { status: "ok" });
});

test("GET /api/codes lists seeded codes", async () => {
  const res = await request(app).get("/api/codes");
  assert.equal(res.status, 200);
  const codes = res.body.codes.map((c) => c.code).sort();
  assert.deepEqual(codes, ["FREESHIP", "GIFT50", "WELCOME10"]);
});

test("POST /api/codes creates a code", async () => {
  const res = await request(app)
    .post("/api/codes")
    .send({ code: "NEW5", reward: "5 points", maxRedemptions: 2 });
  assert.equal(res.status, 201);
  assert.equal(res.body.code.code, "NEW5");
  assert.equal(res.body.code.maxRedemptions, 2);
  assert.equal(res.body.code.redeemedCount, 0);
});

test("POST /api/codes defaults maxRedemptions to 1", async () => {
  const res = await request(app)
    .post("/api/codes")
    .send({ code: "ONCE", reward: "one time" });
  assert.equal(res.status, 201);
  assert.equal(res.body.code.maxRedemptions, 1);
});

test("POST /api/codes rejects missing fields", async () => {
  const res = await request(app).post("/api/codes").send({ reward: "x" });
  assert.equal(res.status, 400);
});

test("POST /api/codes rejects invalid maxRedemptions", async () => {
  const res = await request(app)
    .post("/api/codes")
    .send({ code: "BAD", reward: "x", maxRedemptions: 0 });
  assert.equal(res.status, 400);
});

test("POST /api/codes rejects duplicate code", async () => {
  const res = await request(app)
    .post("/api/codes")
    .send({ code: "WELCOME10", reward: "x" });
  assert.equal(res.status, 409);
});

test("POST /api/redeem succeeds and returns remaining", async () => {
  const res = await request(app)
    .post("/api/redeem")
    .send({ code: "WELCOME10", userId: "user-1" });
  assert.equal(res.status, 201);
  assert.equal(res.body.redemption.code, "WELCOME10");
  assert.equal(res.body.redemption.userId, "user-1");
  assert.equal(res.body.remaining, 99);
});

test("POST /api/redeem rejects a second redemption by the same user", async () => {
  await request(app).post("/api/redeem").send({ code: "WELCOME10", userId: "u" });
  const res = await request(app)
    .post("/api/redeem")
    .send({ code: "WELCOME10", userId: "u" });
  assert.equal(res.status, 409);
});

test("POST /api/redeem enforces the redemption limit", async () => {
  // FREESHIP has a limit of 1.
  const first = await request(app)
    .post("/api/redeem")
    .send({ code: "FREESHIP", userId: "a" });
  assert.equal(first.status, 201);

  const second = await request(app)
    .post("/api/redeem")
    .send({ code: "FREESHIP", userId: "b" });
  assert.equal(second.status, 409);
});

test("POST /api/redeem returns 404 for an unknown code", async () => {
  const res = await request(app)
    .post("/api/redeem")
    .send({ code: "NOPE", userId: "a" });
  assert.equal(res.status, 404);
});

test("POST /api/redeem validates input", async () => {
  const res = await request(app).post("/api/redeem").send({ code: "WELCOME10" });
  assert.equal(res.status, 400);
});

test("POST /api/redeem rejects malformed JSON", async () => {
  const res = await request(app)
    .post("/api/redeem")
    .set("Content-Type", "application/json")
    .send("{bad");
  assert.equal(res.status, 400);
});

test("concurrent redemptions never exceed the limit", async () => {
  // GIFT50 has a limit of 5; fire 20 concurrent requests with distinct users.
  const requests = Array.from({ length: 20 }, (_, i) =>
    request(app).post("/api/redeem").send({ code: "GIFT50", userId: `u${i}` })
  );
  const results = await Promise.all(requests);

  const ok = results.filter((r) => r.status === 201).length;
  const rejected = results.filter((r) => r.status === 409).length;
  assert.equal(ok, 5, "exactly 5 redemptions should succeed");
  assert.equal(rejected, 15, "the other 15 should be rejected");

  const code = await request(app).get("/api/codes");
  const gift = code.body.codes.find((c) => c.code === "GIFT50");
  assert.equal(gift.redeemedCount, 5);
});

test("GET /api/redemptions filters by userId", async () => {
  await request(app).post("/api/redeem").send({ code: "WELCOME10", userId: "alice" });
  await request(app).post("/api/redeem").send({ code: "GIFT50", userId: "bob" });

  const all = await request(app).get("/api/redemptions");
  assert.equal(all.body.redemptions.length, 2);

  const alice = await request(app).get("/api/redemptions?userId=alice");
  assert.equal(alice.body.redemptions.length, 1);
  assert.equal(alice.body.redemptions[0].userId, "alice");
});

test("GET /metrics exposes Prometheus metrics", async () => {
  // Generate a request so the histogram has at least one sample.
  await request(app).get("/health");

  const res = await request(app).get("/metrics");
  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"], /text\/plain/);
  // Default process metrics + our HTTP histogram are present.
  assert.match(res.text, /process_cpu_seconds_total/);
  assert.match(res.text, /http_request_duration_seconds_count/);
  // The /health request was recorded with its route + status label.
  assert.match(res.text, /route="\/health"[^}]*status_code="200"/);
});
