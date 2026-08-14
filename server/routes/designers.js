// server/routes/designers.js
const express = require("express");
const { runQuery, recordToObject } = require("../db");
const Q = require("../queries");

const router = express.Router();
const toObjects = (records) => records.map(recordToObject);

// GET /api/designers
router.get("/", async (req, res, next) => {
  try {
    const records = await runQuery(Q.ALL_DESIGNERS);
    res.json(toObjects(records).map((d) => d.name));
  } catch (err) {
    next(err);
  }
});

// GET /api/designers/:name/network — 2-hop collaborator traversal
router.get("/:name/network", async (req, res, next) => {
  try {
    const records = await runQuery(Q.DESIGNER_NETWORK, { name: req.params.name });
    if (records.length === 0) {
      return res.json({ directCollaborators: [], extendedNetwork: [] });
    }
    res.json(recordToObject(records[0]));
  } catch (err) {
    next(err);
  }
});

// GET /api/path?from=A&to=B — variable-length shortest path between two designers
router.get("/path", async (req, res, next) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) {
      return res.status(400).json({ error: "Both 'from' and 'to' query parameters are required." });
    }
    const records = await runQuery(Q.DESIGNER_PATH, { from, to });
    if (records.length === 0) {
      return res.json({ found: false, nodes: [], hops: null });
    }
    const { nodes, hops } = recordToObject(records[0]);
    res.json({ found: true, nodes, hops });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
