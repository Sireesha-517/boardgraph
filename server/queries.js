// server/queries.js
//
// All Cypher lives here, one statement per named export, so the routes stay
// thin and every query used by the app can be reviewed in one place. Every
// statement takes its inputs as parameters (never string-concatenated).

module.exports = {
  // --- Browse -------------------------------------------------------------

  // Simple filtered list. A single-label scan with optional predicates —
  // included mainly as the "boring" baseline the graph queries are compared
  // against in the README.
  LIST_GAMES: `
    MATCH (g:Game)
    WHERE ($search IS NULL OR toLower(g.title) CONTAINS toLower($search))
      AND ($category IS NULL OR exists( (g)-[:IN_CATEGORY]->(:Category {name: $category}) ))
      AND ($mechanic IS NULL OR exists( (g)-[:HAS_MECHANIC]->(:Mechanic {name: $mechanic}) ))
    RETURN g.title AS title, g.year AS year, g.minPlayers AS minPlayers,
           g.maxPlayers AS maxPlayers, g.playTime AS playTime,
           g.complexity AS complexity, g.description AS description
    ORDER BY g.title
  `,

  ALL_CATEGORIES: `MATCH (c:Category) RETURN c.name AS name ORDER BY name`,
  ALL_MECHANICS: `MATCH (m:Mechanic) RETURN m.name AS name ORDER BY name`,

  // --- Game detail ----------------------------------------------------------

  GAME_DETAIL: `
    MATCH (g:Game {title: $title})
    OPTIONAL MATCH (g)-[:DESIGNED_BY]->(d:Designer)
    OPTIONAL MATCH (g)-[:PUBLISHED_BY]->(p:Publisher)
    OPTIONAL MATCH (g)-[:HAS_MECHANIC]->(m:Mechanic)
    OPTIONAL MATCH (g)-[:IN_CATEGORY]->(c:Category)
    RETURN g.title AS title, g.year AS year, g.minPlayers AS minPlayers,
           g.maxPlayers AS maxPlayers, g.playTime AS playTime,
           g.complexity AS complexity, g.description AS description,
           collect(DISTINCT d.name) AS designers,
           p.name AS publisher,
           collect(DISTINCT m.name) AS mechanics,
           collect(DISTINCT c.name) AS categories
  `,

  // "Games like this" — a genuine 2-hop traversal: game -> mechanic -> other
  // games, aggregated by how many mechanics they share. Doing this in SQL
  // needs a self-join of a game_mechanics bridge table against itself plus a
  // GROUP BY / HAVING, and gets worse the more shared-attribute types you add
  // (mechanics AND categories AND designer). Here it's one pattern match.
  SIMILAR_GAMES: `
    MATCH (g:Game {title: $title})-[:HAS_MECHANIC]->(m:Mechanic)<-[:HAS_MECHANIC]-(other:Game)
    WHERE other <> g
    WITH other, collect(DISTINCT m.name) AS sharedMechanics
    OPTIONAL MATCH (g:Game {title: $title})-[:IN_CATEGORY]->(c:Category)<-[:IN_CATEGORY]-(other)
    WITH other, sharedMechanics, collect(DISTINCT c.name) AS sharedCategories
    RETURN other.title AS title, other.year AS year, other.complexity AS complexity,
           sharedMechanics, sharedCategories,
           size(sharedMechanics) + size(sharedCategories) AS score
    ORDER BY score DESC, other.title
    LIMIT 8
  `,

  // --- Designer network ------------------------------------------------------

  // "People who designed with people who designed with X" — a 2-hop
  // co-designer traversal through shared Game nodes. Awkward in SQL because
  // it is a self-join of a bridge table two levels deep with de-duplication.
  DESIGNER_NETWORK: `
    MATCH (d:Designer {name: $name})<-[:DESIGNED_BY]-(:Game)-[:DESIGNED_BY]->(collab:Designer)
    WHERE collab <> d
    WITH d, collect(DISTINCT collab.name) AS directCollaborators
    UNWIND directCollaborators AS collabName
    MATCH (c:Designer {name: collabName})<-[:DESIGNED_BY]-(:Game)-[:DESIGNED_BY]->(extended:Designer)
    WHERE NOT extended.name IN directCollaborators AND extended <> d
    RETURN directCollaborators, collect(DISTINCT extended.name) AS extendedNetwork
  `,

  ALL_DESIGNERS: `MATCH (d:Designer) RETURN d.name AS name ORDER BY name`,

  // Variable-length shortest path between two designers, hopping through
  // shared games and co-designers. This is the clearest "SQL would really
  // struggle here" query in the app: an unbounded recursive traversal with a
  // shortest-path guarantee, expressed as one pattern.
  DESIGNER_PATH: `
    MATCH (a:Designer {name: $from}), (b:Designer {name: $to})
    MATCH path = shortestPath((a)-[:DESIGNED_BY*..10]-(b))
    RETURN [n IN nodes(path) | {label: head(labels(n)), name: coalesce(n.name, n.title)}] AS nodes,
           length(path) AS hops
  `,

  // --- Recommendations --------------------------------------------------------

  // 3-hop personalised recommendation: player -> highly rated game ->
  // mechanic -> candidate game, weighted by the player's own rating and how
  // many of their favourite mechanics the candidate shares, excluding games
  // already owned. This is a weighted, multi-attribute graph traversal that
  // would require several joins and a hand-rolled scoring CASE expression in
  // SQL; here the weighting falls out of the pattern match naturally.
  RECOMMENDATIONS_FOR_PLAYER: `
    MATCH (p:Player {name: $name})-[r:RATED]->(liked:Game)
    WHERE r.score >= 4
    MATCH (liked)-[:HAS_MECHANIC]->(m:Mechanic)<-[:HAS_MECHANIC]-(rec:Game)
    WHERE NOT (p)-[:OWNS]->(rec) AND rec <> liked
    WITH rec, p, sum(r.score) AS weightedScore, collect(DISTINCT m.name) AS viaMechanics
    RETURN rec.title AS title, rec.year AS year, rec.complexity AS complexity,
           rec.description AS description, weightedScore, viaMechanics
    ORDER BY weightedScore DESC, rec.title
    LIMIT 8
  `,

  // --- Players ---------------------------------------------------------------

  LIST_PLAYERS: `
    MATCH (p:Player)
    OPTIONAL MATCH (p)-[:OWNS]->(owned:Game)
    RETURN p.name AS name, p.bio AS bio, collect(DISTINCT owned.title) AS owns
    ORDER BY p.name
  `,

  PLAYER_RATINGS: `
    MATCH (p:Player {name: $name})-[r:RATED]->(g:Game)
    RETURN g.title AS title, r.score AS score
    ORDER BY r.score DESC, g.title
  `,

  // --- Stats for the dashboard header ----------------------------------------

  STATS: `
    MATCH (g:Game) WITH count(g) AS games
    MATCH (d:Designer) WITH games, count(d) AS designers
    MATCH (p:Publisher) WITH games, designers, count(p) AS publishers
    MATCH (m:Mechanic) WITH games, designers, publishers, count(m) AS mechanics
    MATCH ()-[r:RATED]->() WITH games, designers, publishers, mechanics, count(r) AS ratings
    RETURN games, designers, publishers, mechanics, ratings
  `,
};
