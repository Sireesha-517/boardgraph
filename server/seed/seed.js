// server/seed/seed.js
//
// Loads the BoardGraph dataset into CognoDB. Safe to re-run: constraints use
// IF NOT EXISTS, and every MERGE is keyed on a natural unique property, so
// running `npm run seed` twice does not create duplicates.
//
// Usage:  npm run seed

require("dotenv").config();
const { runQuery, closeDriver, verifyConnectivity, recordToObject } = require("../db");
const { games, players } = require("./data");

const CONSTRAINTS = [
  "CREATE CONSTRAINT game_title IF NOT EXISTS FOR (g:Game) REQUIRE g.title IS UNIQUE",
  "CREATE CONSTRAINT designer_name IF NOT EXISTS FOR (d:Designer) REQUIRE d.name IS UNIQUE",
  "CREATE CONSTRAINT publisher_name IF NOT EXISTS FOR (p:Publisher) REQUIRE p.name IS UNIQUE",
  "CREATE CONSTRAINT mechanic_name IF NOT EXISTS FOR (m:Mechanic) REQUIRE m.name IS UNIQUE",
  "CREATE CONSTRAINT category_name IF NOT EXISTS FOR (c:Category) REQUIRE c.name IS UNIQUE",
  "CREATE CONSTRAINT player_name IF NOT EXISTS FOR (p:Player) REQUIRE p.name IS UNIQUE",
];

// One UNWIND per statement keeps this to a handful of round trips instead of
// one query per row — the standard pattern for bulk-loading via the driver.
const LOAD_GAMES = `
  UNWIND $games AS row
  MERGE (g:Game {title: row.title})
    SET g.year = row.year,
        g.minPlayers = row.minPlayers,
        g.maxPlayers = row.maxPlayers,
        g.playTime = row.playTime,
        g.complexity = row.complexity,
        g.description = row.description
  WITH g, row
  UNWIND row.designers AS designerName
    MERGE (d:Designer {name: designerName})
    MERGE (g)-[:DESIGNED_BY]->(d)
  WITH g, row
  MERGE (p:Publisher {name: row.publisher})
  MERGE (g)-[:PUBLISHED_BY]->(p)
  WITH g, row
  UNWIND row.mechanics AS mechName
    MERGE (m:Mechanic {name: mechName})
    MERGE (g)-[:HAS_MECHANIC]->(m)
  WITH g, row
  UNWIND row.categories AS catName
    MERGE (c:Category {name: catName})
    MERGE (g)-[:IN_CATEGORY]->(c)
`;

const LOAD_PLAYER_NODES = `
  UNWIND $players AS row
  MERGE (p:Player {name: row.name})
    SET p.bio = row.bio
`;

// Flattened to one row per (player, game) pair so this is a single-level
// UNWIND — no chained UNWINDs, so there's no row-multiplication and no
// risk of duplicate relationships being created.
const LOAD_RATINGS = `
  UNWIND $ratings AS row
  MATCH (p:Player {name: row.player})
  MATCH (g:Game {title: row.title})
  MERGE (p)-[r:RATED]->(g)
    SET r.score = row.score
`;

const LOAD_OWNERSHIP = `
  UNWIND $owns AS row
  MATCH (p:Player {name: row.player})
  MATCH (g:Game {title: row.title})
  MERGE (p)-[:OWNS]->(g)
`;

// A previous version of this script chained UNWIND row.rated and UNWIND
// row.owns inside one statement per player. That multiplies rows (5 ratings
// x 3 owned games = 15 passes instead of 3), and on this CognoDB version
// MERGE did not dedupe the resulting repeats, producing duplicate
// relationships. This clears any such leftovers before reloading cleanly.
const CLEAR_PLAYERS = `MATCH (p:Player) DETACH DELETE p`;

async function seed() {
  console.log("Connecting to CognoDB...");
  await verifyConnectivity();
  console.log("Connected. Applying constraints...");

  for (const stmt of CONSTRAINTS) {
    await runQuery(stmt);
  }

  console.log(`Loading ${games.length} games (with designers, publishers, mechanics, categories)...`);
  await runQuery(LOAD_GAMES, { games });

  console.log("Clearing any previously-loaded players (removes stale/duplicate RATED and OWNS edges)...");
  await runQuery(CLEAR_PLAYERS);

  // Flatten the nested seed data into one row per (player, game) pair so
  // each load statement is a single, unambiguous UNWIND.
  const ratings = players.flatMap((p) =>
    p.rated.map(([title, score]) => ({ player: p.name, title, score }))
  );
  const owns = players.flatMap((p) => p.owns.map((title) => ({ player: p.name, title })));

  console.log(`Loading ${players.length} demo players...`);
  await runQuery(LOAD_PLAYER_NODES, { players: players.map(({ name, bio }) => ({ name, bio })) });

  console.log(`Loading ${ratings.length} ratings...`);
  await runQuery(LOAD_RATINGS, { ratings });

  console.log(`Loading ${owns.length} ownership links...`);
  await runQuery(LOAD_OWNERSHIP, { owns });

  const records = await runQuery(`
    MATCH (g:Game) WITH count(g) AS games
    MATCH (d:Designer) WITH games, count(d) AS designers
    MATCH (m:Mechanic) WITH games, designers, count(m) AS mechanics
    MATCH (p:Player) WITH games, designers, mechanics, count(p) AS players
    MATCH ()-[r:RATED]->() WITH games, designers, mechanics, players, count(r) AS ratings
    MATCH ()-[o:OWNS]->() WITH games, designers, mechanics, players, ratings, count(o) AS owns
    RETURN games, designers, mechanics, players, ratings, owns
  `);
  console.log("Seed complete:", recordToObject(records[0]));
}

seed()
  .catch((err) => {
    console.error("Seed failed:", err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDriver();
  });
