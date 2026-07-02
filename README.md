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
npm run db:init   # optional — create tables + seed (also done on server start)
npm start         # http://localhost:3000
npm run dev       # auto-restart on changes
```

The server creates its tables and seeds demo codes automatically on startup.

## Endpoints

| Method | Path                | Description                          |
| ------ | ------------------- | ------------------------------------ |
| GET    | `/health`           | Health check                         |
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

## Seeded demo codes

`WELCOME10` (100 uses), `FREESHIP` (1 use), `GIFT50` (5 uses).

## Schema

- **codes** — `code` (PK), `reward`, `max_redemptions`, `redeemed_count`, `active`, `created_at`
- **redemptions** — `id`, `code` (FK), `user_id`, `reward`, `redeemed_at`, unique on `(code, user_id)`

## Structure

```
src/
  server.js    Express app, middleware, startup, graceful shutdown
  routes.js    Route handlers + validation
  store.js     Data-access layer (async, transactional redeem)
  db.js        pg connection pool + schema/seed
  init-db.js   Standalone `npm run db:init` script
docker-compose.yml   Local Postgres
.env                 Connection config (git-ignored, loaded via dotenv)
.env.example         Connection config template
```
