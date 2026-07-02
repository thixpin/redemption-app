const express = require("express");
const store = require("./store");

const router = express.Router();

// Wrap async handlers so rejected promises reach the error middleware.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// List all redemption codes.
router.get(
  "/codes",
  wrap(async (req, res) => {
    res.json({ codes: await store.listCodes() });
  })
);

// Create a new redemption code.
router.post(
  "/codes",
  wrap(async (req, res) => {
    const { code, reward, maxRedemptions } = req.body || {};

    if (!code || typeof code !== "string") {
      return res.status(400).json({ error: "`code` is required and must be a string." });
    }
    if (!reward || typeof reward !== "string") {
      return res.status(400).json({ error: "`reward` is required and must be a string." });
    }

    const limit = maxRedemptions === undefined ? 1 : Number(maxRedemptions);
    if (!Number.isInteger(limit) || limit < 1) {
      return res.status(400).json({ error: "`maxRedemptions` must be a positive integer." });
    }

    if (await store.getCode(code)) {
      return res.status(409).json({ error: `Code "${code}" already exists.` });
    }

    const created = await store.createCode({ code, reward, maxRedemptions: limit });
    res.status(201).json({ code: created });
  })
);

// Redeem a code for a user.
const REDEEM_ERRORS = {
  not_found: [404, "Code not found."],
  inactive: [410, "This code is no longer active."],
  already: [409, "This user has already redeemed this code."],
  limit: [409, "This code has reached its redemption limit."],
};

router.post(
  "/redeem",
  wrap(async (req, res) => {
    const { code, userId } = req.body || {};

    if (!code || typeof code !== "string") {
      return res.status(400).json({ error: "`code` is required and must be a string." });
    }
    if (!userId || typeof userId !== "string") {
      return res.status(400).json({ error: "`userId` is required and must be a string." });
    }

    const result = await store.redeem(code, userId);

    if (result.status !== "ok") {
      const [status, error] = REDEEM_ERRORS[result.status];
      return res.status(status).json({ error });
    }

    res.status(201).json({
      message: "Code redeemed successfully.",
      redemption: result.redemption,
      remaining: result.remaining,
    });
  })
);

// List all redemptions (optionally filter by userId).
router.get(
  "/redemptions",
  wrap(async (req, res) => {
    const { userId } = req.query;
    res.json({ redemptions: await store.listRedemptions(userId) });
  })
);

module.exports = router;
