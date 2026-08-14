// server/routes/games.js
const express = require("express");
const { runQuery, recordToObject } = require("../db");
const Q = require("../queries");

const router = express.Router();

function recordsToObjects(records) {
  return records.map(recordToObject);
}

// GET /api/games?search=&category=&mechanic=
router.get("/", async (req, res, next) => {
  try {
    const { search = null, category = null, mechanic = null } = req.query;
    const records = await runQuery(Q.LIST_GAMES, { search, category, mechanic });
    res.json(recordsToObjects(records));
  } catch (err) {
    next(err);
  }
});

// GET /api/games/filters  — categories + mechanics for the filter dropdowns
router.get("/filters", async (req, res, next) => {
  try {
    const [categories, mechanics] = await Promise.all([
      runQuery(Q.ALL_CATEGORIES).then(recordsToObjects),
      runQuery(Q.ALL_MECHANICS).then(recordsToObjects),
    ]);
    res.json({
      categories: categories.map((c) => c.name),
      mechanics: mechanics.map((m) => m.name),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/games/:title
router.get("/:title", async (req, res, next) => {
  try {
    const records = await runQuery(Q.GAME_DETAIL, { title: req.params.title });
    if (records.length === 0) return res.status(404).json({ error: "Game not found" });
    res.json(recordToObject(records[0]));
  } catch (err) {
    next(err);
  }
});

// GET /api/games/:title/similar — 2-hop shared-mechanic/category traversal
router.get("/:title/similar", async (req, res, next) => {
  try {
    const records = await runQuery(Q.SIMILAR_GAMES, { title: req.params.title });
    res.json(recordsToObjects(records));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
