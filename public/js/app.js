// public/js/app.js
// Vanilla JS single-page app. No build step, no framework — fetch + DOM.
"use strict";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const cardTemplate = $("#game-card-template");

// ---------------------------------------------------------------------------
// Tiny fetch helper with a consistent "is the database reachable" story.
// Free hosting tiers (e.g. Render's free plan) spin the server down after
// inactivity, so the very first request or two after a cold start can fail
// even though the server is fine seconds later. Retrying a couple of times
// with a short backoff smooths that over instead of leaving the page empty.
// ---------------------------------------------------------------------------
async function api(path, { retries = 2, retryDelayMs = 1200 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`/api${path}`);
      if (res.status === 503) {
        showDbBanner();
        throw new Error("Database unreachable");
      }
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      hideDbBanner();
      return await res.json();
    } catch (err) {
      if (attempt >= retries) throw err;
      await new Promise((r) => setTimeout(r, retryDelayMs));
    }
  }
}

let bannerTimer = null;
function showDbBanner() {
  $("#db-banner").hidden = false;
  if (!bannerTimer) {
    bannerTimer = setInterval(() => api("/health").catch(() => {}), 5000);
  }
}
function hideDbBanner() {
  $("#db-banner").hidden = true;
  if (bannerTimer) {
    clearInterval(bannerTimer);
    bannerTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Tabs / views
// ---------------------------------------------------------------------------
function showView(name) {
  $$(".view").forEach((v) => (v.hidden = true));
  $(`#view-${name}`).hidden = false;
  $$(".tab").forEach((t) => {
    const active = t.dataset.view === name;
    t.classList.toggle("is-active", active);
    t.setAttribute("aria-selected", String(active));
  });
}

$$(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    showView(tab.dataset.view);
    if (tab.dataset.view === "recommend") loadPlayers();
    if (tab.dataset.view === "path") loadDesigners();
  });
});

// ---------------------------------------------------------------------------
// Stats strip
// ---------------------------------------------------------------------------
async function loadStats() {
  try {
    const s = await api("/stats");
    $("#stat-games").textContent = s.games ?? "—";
    $("#stat-designers").textContent = s.designers ?? "—";
    $("#stat-mechanics").textContent = s.mechanics ?? "—";
    $("#stat-ratings").textContent = s.ratings ?? "—";
  } catch {
    /* banner already shown by api() */
  }
}

// ---------------------------------------------------------------------------
// Game card rendering (shared by browse / similar / recommendations)
// ---------------------------------------------------------------------------
function renderGameCard(game, { extraTags = [], onClick } = {}) {
  const node = cardTemplate.content.cloneNode(true);
  const article = node.querySelector(".pin-card");
  node.querySelector(".pin-card__title").textContent = game.title;
  node.querySelector(".pin-card__meta").textContent =
    `${game.year} · ${game.minPlayers}–${game.maxPlayers} players · ${game.playTime} min · complexity ${Number(game.complexity).toFixed(1)}`;
  node.querySelector(".pin-card__desc").textContent = game.description || "";

  const tagWrap = node.querySelector(".pin-card__tags");
  extraTags.forEach(({ text, variant }) => {
    const span = document.createElement("span");
    span.className = variant ? `tag tag--${variant}` : "tag";
    span.textContent = text;
    tagWrap.appendChild(span);
  });

  article.tabIndex = 0;
  article.addEventListener("click", () => onClick?.(game.title));
  article.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onClick?.(game.title);
    }
  });
  return node;
}

// ---------------------------------------------------------------------------
// Browse view
// ---------------------------------------------------------------------------
let filterState = { search: "", category: "", mechanic: "" };
let debounceHandle = null;

async function loadFilters() {
  try {
    const { categories, mechanics } = await api("/games/filters");
    const catSel = $("#category-filter");
    const mechSel = $("#mechanic-filter");
    categories.forEach((c) => catSel.add(new Option(c, c)));
    mechanics.forEach((m) => mechSel.add(new Option(m, m)));
  } catch {
    /* handled by banner */
  }
}

async function loadGames() {
  const grid = $("#games-grid");
  const empty = $("#games-empty");
  try {
    const params = new URLSearchParams();
    if (filterState.search) params.set("search", filterState.search);
    if (filterState.category) params.set("category", filterState.category);
    if (filterState.mechanic) params.set("mechanic", filterState.mechanic);
    const games = await api(`/games?${params.toString()}`);

    grid.innerHTML = "";
    empty.hidden = games.length > 0;
    games.forEach((g) => {
      grid.appendChild(
        renderGameCard(g, {
          extraTags: [],
          onClick: showGameDetail,
        })
      );
    });
  } catch {
    grid.innerHTML = "";
  }
}

$("#search-input").addEventListener("input", (e) => {
  filterState.search = e.target.value;
  clearTimeout(debounceHandle);
  debounceHandle = setTimeout(loadGames, 250);
});
$("#category-filter").addEventListener("change", (e) => {
  filterState.category = e.target.value;
  loadGames();
});
$("#mechanic-filter").addEventListener("change", (e) => {
  filterState.mechanic = e.target.value;
  loadGames();
});

// ---------------------------------------------------------------------------
// Game detail + similar games
// ---------------------------------------------------------------------------
async function showGameDetail(title) {
  showView("detail-hidden-marker"); // no-op guard, replaced below
  $("#view-browse").hidden = true;
  $("#view-detail").hidden = false;
  $$(".tab").forEach((t) => t.classList.remove("is-active"));

  const content = $("#detail-content");
  content.innerHTML = "<p>Pulling the pin…</p>";
  try {
    const g = await api(`/games/${encodeURIComponent(title)}`);
    content.innerHTML = `
      <h2>${g.title}</h2>
      <p class="detail-meta">${g.year} · designed by ${g.designers.filter(Boolean).join(", ") || "Unknown"} · published by ${g.publisher || "Unknown"}</p>
      <p class="detail-desc">${g.description || ""}</p>
      <dl class="detail-facts">
        <div><dt>Players</dt><dd>${g.minPlayers}–${g.maxPlayers}</dd></div>
        <div><dt>Play time</dt><dd>${g.playTime} min</dd></div>
        <div><dt>Complexity</dt><dd>${Number(g.complexity).toFixed(1)} / 5</dd></div>
        <div><dt>Mechanics</dt><dd>${g.mechanics.filter(Boolean).join(", ") || "—"}</dd></div>
        <div><dt>Categories</dt><dd>${g.categories.filter(Boolean).join(", ") || "—"}</dd></div>
      </dl>
    `;

    const similar = await api(`/games/${encodeURIComponent(title)}/similar`);
    const simGrid = $("#similar-grid");
    simGrid.innerHTML = "";
    if (similar.length === 0) {
      simGrid.innerHTML = '<p class="empty-state">No close relatives on the board yet.</p>';
    }
    similar.forEach((s) => {
      simGrid.appendChild(
        renderGameCard(
          { ...s },
          {
            extraTags: [
              ...s.sharedMechanics.slice(0, 3).map((m) => ({ text: m })),
              { text: `score ${s.score}`, variant: "score" },
            ],
            onClick: showGameDetail,
          }
        )
      );
    });
  } catch {
    content.innerHTML = '<p class="empty-state">Could not load this game right now.</p>';
  }
}

$("#detail-back").addEventListener("click", () => {
  $("#view-detail").hidden = true;
  $("#view-browse").hidden = false;
  $(`.tab[data-view="browse"]`).classList.add("is-active");
});

// ---------------------------------------------------------------------------
// Recommendations view
// ---------------------------------------------------------------------------
let playersLoaded = false;
async function loadPlayers() {
  if (playersLoaded) return;
  try {
    const players = await api("/players");
    const picker = $("#player-picker");
    picker.innerHTML = "";
    players.forEach((p) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "player-chip";
      chip.textContent = p.name;
      chip.title = p.bio;
      chip.addEventListener("click", () => selectPlayer(p.name, chip));
      picker.appendChild(chip);
    });
    playersLoaded = true;
  } catch {
    /* banner handles it */
  }
}

async function selectPlayer(name, chipEl) {
  $$(".player-chip").forEach((c) => c.classList.remove("is-active"));
  chipEl.classList.add("is-active");
  $("#recommend-results").hidden = false;

  const ratingsList = $("#player-ratings");
  const recGrid = $("#recommend-grid");
  ratingsList.innerHTML = "<li>Loading…</li>";
  recGrid.innerHTML = "";

  try {
    const [ratings, recs] = await Promise.all([
      api(`/players/${encodeURIComponent(name)}/ratings`),
      api(`/players/${encodeURIComponent(name)}/recommendations`),
    ]);

    ratingsList.innerHTML = "";
    ratings.forEach((r) => {
      const li = document.createElement("li");
      li.innerHTML = `<span>${r.title}</span><span class="score">${"★".repeat(r.score)}</span>`;
      ratingsList.appendChild(li);
    });

    if (recs.length === 0) {
      recGrid.innerHTML = '<p class="empty-state">No new recommendations — they already own everything on the board that matches their taste!</p>';
    }
    recs.forEach((rec) => {
      recGrid.appendChild(
        renderGameCard(rec, {
          extraTags: [
            { text: `match ${rec.weightedScore}`, variant: "score" },
            ...rec.viaMechanics.slice(0, 2).map((m) => ({ text: m })),
          ],
          onClick: (title) => {
            showView("browse");
            showGameDetail(title);
          },
        })
      );
    });
  } catch {
    ratingsList.innerHTML = "";
    recGrid.innerHTML = '<p class="empty-state">Could not load recommendations right now.</p>';
  }
}

// ---------------------------------------------------------------------------
// Path finder view
// ---------------------------------------------------------------------------
let designersLoaded = false;
async function loadDesigners() {
  if (designersLoaded) return;
  try {
    const names = await api("/designers");
    const fromSel = $("#path-from");
    const toSel = $("#path-to");
    names.forEach((n) => {
      fromSel.add(new Option(n, n));
      toSel.add(new Option(n, n));
    });
    if (names.length > 1) toSel.selectedIndex = 1;
    designersLoaded = true;
  } catch {
    /* banner handles it */
  }
}

$("#path-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const from = $("#path-from").value;
  const to = $("#path-to").value;
  const result = $("#path-result");
  const btn = e.target.querySelector("button");
  btn.disabled = true;
  result.innerHTML = "<p>Pinning the string…</p>";

  try {
    if (from === to) {
      result.innerHTML = '<p class="path-empty">Pick two different designers to trace a path between.</p>';
      return;
    }
    const data = await api(`/designers/path?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    if (!data.found) {
      result.innerHTML = `<p class="path-empty">No chain of shared games connects ${from} and ${to} yet.</p>`;
      return;
    }
    const chain = document.createElement("div");
    chain.className = "string-chain";
    data.nodes.forEach((n, i) => {
      if (i > 0) {
        const link = document.createElement("div");
        link.className = "string-link";
        chain.appendChild(link);
      }
      const node = document.createElement("div");
      node.className = "string-node";
      node.innerHTML = `<span class="string-node__label">${n.label}</span><span class="string-node__name">${n.name}</span>`;
      chain.appendChild(node);
    });
    result.innerHTML = "";
    result.appendChild(chain);
    const meta = document.createElement("p");
    meta.className = "path-meta";
    meta.textContent = `${data.hops} hop${data.hops === 1 ? "" : "s"} of shared games connect them.`;
    result.appendChild(meta);
  } catch {
    result.innerHTML = '<p class="path-empty">Could not trace a path right now.</p>';
  } finally {
    btn.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
(async function init() {
  await loadStats();
  await loadFilters();
  await loadGames();
})();
