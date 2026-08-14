// server/db.js
//
// CognoDB speaks openCypher over Bolt, so the official Neo4j JavaScript driver
// talks to it with zero custom code — we just point it at the CognoDB URI.
//
// This module exposes:
//   - getDriver()      a lazily-created, reused driver instance
//   - runQuery(cypher, params)   convenience wrapper that opens/closes a session
//   - verifyConnectivity()       used at boot and by /api/health
//   - closeDriver()              graceful shutdown

const neo4j = require("neo4j-driver");

let driver = null;

function getDriver() {
  if (driver) return driver;

  const { COGNODB_URI, COGNODB_USER, COGNODB_PASSWORD } = process.env;

  if (!COGNODB_URI || !COGNODB_USER || !COGNODB_PASSWORD) {
    throw new Error(
      "Missing CognoDB connection details. Set COGNODB_URI, COGNODB_USER and " +
        "COGNODB_PASSWORD (see .env.example) before starting the server."
    );
  }

  driver = neo4j.driver(
    COGNODB_URI,
    neo4j.auth.basic(COGNODB_USER, COGNODB_PASSWORD),
    { maxConnectionPoolSize: 20 } // stay well under the c0 free-tier's 200 connection cap
  );

  return driver;
}

/**
 * Runs a single Cypher statement with parameters, inside its own session,
 * and always returns plain JS records (no need for callers to manage sessions).
 */
async function runQuery(cypher, params = {}, { database } = {}) {
  const session = getDriver().session(database ? { database } : undefined);
  try {
    const result = await session.run(cypher, params);
    return result.records;
  } finally {
    await session.close();
  }
}

async function verifyConnectivity() {
  await getDriver().getServerInfo();
}

async function closeDriver() {
  if (driver) {
    await driver.close();
    driver = null;
  }
}

/**
 * Neo4j/CognoDB returns count(), sum() etc as a lossless Integer object
 * ({ low, high }) rather than a plain JS number, to avoid silently losing
 * precision on very large values. Left unconverted, that object serializes
 * over JSON as {"low":36,"high":0} and renders as "[object Object]" in the
 * browser. This walks a record's data and converts every such Integer to a
 * plain number (or a string, for the rare value too large to represent
 * safely as a JS number) so every route can just return native JS values.
 */
function toNativeTypes(value) {
  if (neo4j.isInt(value)) {
    return value.inSafeRange() ? value.toNumber() : value.toString();
  }
  if (Array.isArray(value)) {
    return value.map(toNativeTypes);
  }
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value)) {
      out[key] = toNativeTypes(value[key]);
    }
    return out;
  }
  return value;
}

/** Converts a full driver Record into a plain, JSON-safe JS object. */
function recordToObject(record) {
  return toNativeTypes(record.toObject());
}

module.exports = { getDriver, runQuery, verifyConnectivity, closeDriver, recordToObject };
