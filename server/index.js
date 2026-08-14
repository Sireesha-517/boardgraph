// server/index.js
require("dotenv").config();

const path = require("path");
const express = require("express");
const cors = require("cors");

const { verifyConnectivity, closeDriver, runQuery, recordToObject } = require("./db");
const Q = require("./queries");

const gamesRouter = require("./routes/games");
const playersRouter = require("./routes/players");
const designersRouter = require("./routes/designers");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

// --- Health check -----------------------------------------------------------
// A dashboard or uptime monitor (and the frontend's own "database offline"
// banner) can poll this without needing to know any Cypher.
app.get("/api/health", async (req, res) => {
  try {
    await verifyConnectivity();
    res.json({ status: "ok" });
  } catch (err) {
    res.status(503).json({ status: "unreachable", message: err.message });
  }
});

app.get("/api/stats", async (req, res, next) => {
  try {
    const records = await runQuery(Q.STATS);
    res.json(records[0] ? recordToObject(records[0]) : {});
  } catch (err) {
    next(err);
  }
});

app.use("/api/games", gamesRouter);
app.use("/api/players", playersRouter);
app.use("/api/designers", designersRouter);

// --- Error handling ----------------------------------------------------------
// Any failure to reach CognoDB (bad credentials, instance asleep, network
// blip) lands here rather than crashing the process or leaking a stack trace
// to the client.
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  const isConnError = /ServiceUnavailable|Neo4jError|ECONNREFUSED|connect/i.test(
    `${err.name} ${err.message}`
  );
  res.status(isConnError ? 503 : 500).json({
    error: isConnError
      ? "The graph database is unreachable right now. Please try again shortly."
      : "Something went wrong handling that request.",
  });
});

// Fall back to the SPA shell for any non-API route.
app.get(/^(?!\/api\/).*/, (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

const server = app.listen(PORT, async () => {
  console.log(`BoardGraph listening on http://localhost:${PORT}`);
  try {
    await verifyConnectivity();
    console.log("Connected to CognoDB.");
  } catch (err) {
    console.warn(
      `Warning: could not reach CognoDB at startup (${err.message}). ` +
        "The server will still run — check your .env and CognoDB Cloud instance."
    );
  }
});

async function shutdown() {
  console.log("\nShutting down...");
  server.close();
  await closeDriver();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
