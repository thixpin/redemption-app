# Redemption API

A simple redemption API built with Express.js and PostgreSQL. Users redeem promo/reward codes; each code has a redemption limit and can be redeemed only once per user. Redemptions are atomic and safe under concurrent requests.

## Setup

### 1. Start PostgreSQL

A `docker-compose.yml` is included:

```bash
docker compose up -d          # starts Postgres on localhost:5432
```

Or point the app at your own Postgres via env vars (see below).

### 2. Configure connection

The app loads a `.env` file automatically (via `dotenv`). A ready-to-use `.env`
is included and matches the Docker Compose credentials:

```bash
DATABASE_URL=postgres://redemption:redemption@localhost:5432/redemption
PORT=3000
```

Edit it to point at your own Postgres, or instead set `DATABASE_URL` /
the standard `PGHOST`/`PGUSER`/... vars in your environment. See `.env.example`
for all options. `.env` is git-ignored so real credentials aren't committed.

### 3. Install & run

```bash
npm install
npm run db:init   # create tables + seed demo codes (dev only)
npm start         # http://localhost:3000
npm run dev       # auto-restart on changes
```

The server does **not** touch the schema on startup — run `npm run db:init`
once locally. In Kubernetes, `npm run migrate` runs as an Argo CD PreSync Job
before each rollout (migrations are decoupled from the app lifecycle so a burst
of autoscaled pods never runs them concurrently).

## Endpoints

| Method | Path                | Description                          |
| ------ | ------------------- | ------------------------------------ |
| GET    | `/health`           | Health check                         |
| GET    | `/metrics`          | Prometheus metrics (request histogram + process metrics) |
| GET    | `/api/codes`        | List all codes                       |
| POST   | `/api/codes`        | Create a code                        |
| POST   | `/api/redeem`       | Redeem a code for a user             |
| GET    | `/api/redemptions`  | List redemptions (`?userId=` filter) |

### Create a code

```bash
curl -X POST localhost:3000/api/codes \
  -H 'Content-Type: application/json' \
  -d '{"code":"NEW5","reward":"5 points","maxRedemptions":2}'
```

`maxRedemptions` is optional (defaults to `1`).

### Redeem a code

```bash
curl -X POST localhost:3000/api/redeem \
  -H 'Content-Type: application/json' \
  -d '{"code":"WELCOME10","userId":"user-1"}'
```

Redemption fails with a clear status code when the code is unknown (404),
inactive (410), already redeemed by that user (409), or over its limit (409).
The redeem operation runs in a transaction with `SELECT ... FOR UPDATE`, so
concurrent requests can never exceed a code's limit.

## Testing

Automated end-to-end tests (Node's built-in test runner + `supertest`) cover
every endpoint, validation, the per-user and per-code limits, error cases, and
concurrent-redemption safety.

The tests need a running Postgres. They use `TEST_DATABASE_URL` if set,
otherwise `DATABASE_URL`, and **truncate** that database's tables on each run —
so point it at a throwaway DB. The included `.env` uses `redemption_test`:

```bash
docker compose up -d
# one-time: create the test database
docker compose exec db psql -U redemption -d redemption -c "CREATE DATABASE redemption_test;"

npm test
```

### Smoke test (any live environment)

`scripts/smoke-test.sh` exercises **every endpoint** against a running instance —
12 checks covering happy paths and error paths (duplicate code, double redeem,
unknown code/route, malformed JSON), asserting the expected HTTP status for
each. It creates one timestamped throwaway code/user per run and exits non-zero
on any failure, so it doubles as a post-deploy gate in CI.

```bash
./scripts/smoke-test.sh                                      # local (http://localhost:3000)
./scripts/smoke-test.sh https://redemption-dev.thixpin.me    # dev
./scripts/smoke-test.sh https://redemption-api.thixpin.me    # prod
```

A Postman collection with the same coverage lives in
`postman/Redemption-API.postman_collection.json` (set the `baseUrl` variable;
runnable top-to-bottom in the Collection Runner or `newman`).

## Docker

```bash
docker build -t redemption-api:latest .
docker run -p 3000:3000 \
  -e DATABASE_URL="postgres://redemption:redemption@host.docker.internal:5432/redemption" \
  redemption-api:latest
```

## Seeded demo codes (dev only, via `npm run db:init`)

`WELCOME10` (100 uses), `FREESHIP` (1 use), `GIFT50` (5 uses).
Production is never seeded — load real codes through the API.

## Schema

- **codes** — `code` (PK), `reward`, `max_redemptions`, `redeemed_count`, `active`, `created_at`
- **redemptions** — `id`, `code` (FK), `user_id`, `reward`, `redeemed_at`, unique on `(code, user_id)`

## Structure

```
src/
  server.js    Express app, middleware, startup, graceful shutdown
  routes.js    Route handlers + validation
  store.js     Data-access layer (async, transactional redeem)
  db.js        pg connection pool + schema/seed helpers
  metrics.js   Prometheus instrumentation (/metrics, request histogram)
  migrate.js   Schema migration entrypoint (`npm run migrate`, k8s PreSync Job)
  init-db.js   Standalone `npm run db:init` script (dev: tables + demo seed)
test/
  api.test.js  End-to-end API tests (npm test)
scripts/
  smoke-test.sh          12-check live-endpoint smoke test (local/dev/prod)
postman/                 Postman collection (same coverage)
.github/workflows/       ci (PR tests) · deploy-dev (develop) · deploy-prod (v* tags)
Dockerfile           Multi-stage production image (non-root, multi-arch via CI)
.dockerignore
docker-compose.yml   Local Postgres
.env                 Connection config (git-ignored, loaded via dotenv)
.env.example         Connection config template
```
