// server/routes/players.js
const express = require("express");
const { runQuery, recordToObject } = require("../db");
const Q = require("../queries");

const router = express.Router();
const toObjects = (records) => records.map(recordToObject);

// GET /api/players
router.get("/", async (req, res, next) => {
  try {
    const records = await runQuery(Q.LIST_PLAYERS);
    res.json(toObjects(records));
  } catch (err) {
    next(err);
  }
});

// GET /api/players/:name/ratings
router.get("/:name/ratings", async (req, res, next) => {
  try {
    const records = await runQuery(Q.PLAYER_RATINGS, { name: req.params.name });
    res.json(toObjects(records));
  } catch (err) {
    next(err);
  }
});

// GET /api/players/:name/recommendations — 3-hop weighted traversal
router.get("/:name/recommendations", async (req, res, next) => {
  try {
    const records = await runQuery(Q.RECOMMENDATIONS_FOR_PLAYER, { name: req.params.name });
    res.json(toObjects(records));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
