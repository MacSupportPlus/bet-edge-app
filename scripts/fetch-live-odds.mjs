#!/usr/bin/env node
/**
 * Live multi-book odds + player props from The Odds API
 * (https://the-odds-api.com) — forward-looking data for upcoming games, so
 * this runs on its own, more-frequent schedule (see
 * .github/workflows/refresh-data.yml) separate from prepare-data.mjs's
 * once-daily HISTORICAL refresh.
 *
 * Needs ODDS_API_KEY in the environment (see .env.example) — a server-side
 * secret only. NEVER reference this key from client-side code: this app is
 * a static export with no server to hide it behind, so anything in the
 * browser bundle is world-readable.
 *
 * Output files use ESPN's own `displayName` convention for team names (e.g.
 * "Seattle Seahawks", "Ohio State Buckeyes") — verified live to match The
 * Odds API's home_team/away_team fields exactly for both NFL and CFB, so
 * the client can join a live-odds/props entry to an UpcomingGame via
 * homeTeamDisplayName/awayTeamDisplayName (see espn.ts) with no alias table
 * needed, unlike the ESPN-vs-historical-archive matching in teamMatch.ts.
 *
 * Unlike prepare-data.mjs's archives, these files are small (a season's
 * worth of upcoming games, not years of history) and not size-sensitive, so
 * they use plain nested objects instead of the schema+rows tuple format.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "public", "data");

const ODDS_API_KEY = process.env.ODDS_API_KEY;
const ODDS_API_BASE = "https://api.the-odds-api.com/v4";

const SPORT_KEYS = { nfl: "americanfootball_nfl", cfb: "americanfootball_ncaaf" };

/**
 * The Odds API/ESPN's displayName convention ("Seattle Seahawks") vs. the
 * historical archive's own NFL naming (nflverse's short codes, e.g. "SEA")
 * have zero string overlap — bridged here with a small, stable, hand-
 * written table (32 fixed entries, standard NFL team names, not expected to
 * change) rather than any fuzzy matching. CFB doesn't need this: the
 * historical archive's CFB names are already prefixes of the Odds API's
 * (e.g. "Ohio State" vs "Ohio State Buckeyes" — see resolveHistoricalName).
 */
const NFL_DISPLAY_NAME_TO_CODE = {
  "Arizona Cardinals": "ARI",
  "Atlanta Falcons": "ATL",
  "Baltimore Ravens": "BAL",
  "Buffalo Bills": "BUF",
  "Carolina Panthers": "CAR",
  "Chicago Bears": "CHI",
  "Cincinnati Bengals": "CIN",
  "Cleveland Browns": "CLE",
  "Dallas Cowboys": "DAL",
  "Denver Broncos": "DEN",
  "Detroit Lions": "DET",
  "Green Bay Packers": "GB",
  "Houston Texans": "HOU",
  "Indianapolis Colts": "IND",
  "Jacksonville Jaguars": "JAX",
  "Kansas City Chiefs": "KC",
  "Las Vegas Raiders": "LV",
  "Los Angeles Chargers": "LAC",
  "Los Angeles Rams": "LA",
  "Miami Dolphins": "MIA",
  "Minnesota Vikings": "MIN",
  "New England Patriots": "NE",
  "New Orleans Saints": "NO",
  "New York Giants": "NYG",
  "New York Jets": "NYJ",
  "Philadelphia Eagles": "PHI",
  "Pittsburgh Steelers": "PIT",
  "San Francisco 49ers": "SF",
  "Seattle Seahawks": "SEA",
  "Tampa Bay Buccaneers": "TB",
  "Tennessee Titans": "TEN",
  "Washington Commanders": "WAS",
};

// Same normalization teamMatch.ts's normalizeTeamName does (duplicated here
// since this is a standalone script) — verified live this catches a real
// mismatch: Odds API's "Hawaii" vs. the historical archive's "Hawai'i".
// Unicode "combining diacritical marks" block, written as an escape (not a
// literal character) so this source file stays plain ASCII.
const COMBINING_DIACRITICS = /[̀-ͯ]/g;
function normalizeName(name) {
  return name
    .normalize("NFD")
    .replace(COMBINING_DIACRITICS, "")
    .toLowerCase()
    .replace(/['.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Resolves an Odds-API team name to the historical archive's own naming convention, or null if it can't be confidently matched. */
function resolveHistoricalName(oddsApiName, sport, knownCfbTeams) {
  if (sport === "nfl") return NFL_DISPLAY_NAME_TO_CODE[oddsApiName] ?? null;
  // CFB: the historical archive's plain school name is a prefix of the Odds
  // API's "{School} {Mascot}" name (e.g. "Ohio State" / "Ohio State Buckeyes").
  const normalized = normalizeName(oddsApiName);
  for (const known of knownCfbTeams) {
    const normalizedKnown = normalizeName(known);
    if (normalized === normalizedKnown || normalized.startsWith(`${normalizedKnown} `)) return known;
  }
  return null;
}

/** Reads public/data/{sport}-games.json's own team names, for CFB's prefix-matching in resolveHistoricalName. */
async function readKnownTeams(sport) {
  try {
    const raw = JSON.parse(await readFile(path.join(OUT_DIR, `${sport}-games.json`), "utf-8"));
    const teams = new Set();
    for (const g of raw.games) {
      teams.add(g[3]); // homeTeam
      teams.add(g[4]); // awayTeam
    }
    return teams;
  } catch {
    return new Set();
  }
}

/** Best (highest payout) American moneyline for each side across every book. */
function bestMoneylines(game) {
  let home = null;
  let away = null;
  for (const b of game.books) {
    if (b.homeMoneyline !== null && (home === null || b.homeMoneyline > home)) home = b.homeMoneyline;
    if (b.awayMoneyline !== null && (away === null || b.awayMoneyline > away)) away = b.awayMoneyline;
  }
  return { home, away };
}

// A game kicking off sooner than this counts as "closing" — slightly more
// than the workflow's 2-hour poll interval, so we don't miss the last
// realistic chance to capture it before kickoff.
const CLOSING_WINDOW_HOURS = 3;

/** Reads the existing closing-lines archive (or [] if none yet). */
async function readExistingClosingLines(sport) {
  try {
    const raw = JSON.parse(await readFile(path.join(OUT_DIR, `${sport}-closing-lines.json`), "utf-8"));
    return raw.lines ?? [];
  } catch {
    return [];
  }
}

/**
 * Captures a "closing-ish" line for every game kicking off within
 * CLOSING_WINDOW_HOURS, resolved to the historical archive's team-name
 * convention (so a logged bet's own homeTeam/awayTeam fields — see
 * bankroll.ts — can look this up directly, no matching needed at CLV-compute
 * time). Merges into the existing archive (keyed by team names + game date)
 * rather than overwriting it, since games drop out of the live-odds window
 * once they've started — this is the only place their closing line survives.
 */
async function captureClosingLines(sport, liveOddsGames) {
  const knownCfbTeams = sport === "cfb" ? await readKnownTeams(sport) : null;
  const existing = await readExistingClosingLines(sport);
  const byKey = new Map(existing.map((l) => [`${l.homeTeam}|${l.awayTeam}|${l.commenceTime.slice(0, 10)}`, l]));

  const now = Date.now();
  let captured = 0;
  for (const g of liveOddsGames) {
    const hoursToKickoff = (new Date(g.commenceTime).getTime() - now) / (1000 * 60 * 60);
    if (hoursToKickoff > CLOSING_WINDOW_HOURS || hoursToKickoff < -1) continue; // not close enough yet, or already well underway
    const homeTeam = resolveHistoricalName(g.homeTeam, sport, knownCfbTeams);
    const awayTeam = resolveHistoricalName(g.awayTeam, sport, knownCfbTeams);
    if (!homeTeam || !awayTeam) continue;
    const { home: homeMoneylineClose, away: awayMoneylineClose } = bestMoneylines(g);
    if (homeMoneylineClose === null || awayMoneylineClose === null) continue;

    const key = `${homeTeam}|${awayTeam}|${g.commenceTime.slice(0, 10)}`;
    byKey.set(key, { homeTeam, awayTeam, commenceTime: g.commenceTime, homeMoneylineClose, awayMoneylineClose, capturedAt: new Date().toISOString() });
    captured++;
  }

  console.log(`  captured/updated ${captured} closing line(s) (${byKey.size} total on file)`);
  return [...byKey.values()];
}

// How far ahead to fetch — matches espn.ts's fetchUpcomingGames default
// window, since these two sources are joined client-side by team name.
const DAYS_AHEAD = 8;

// Curated set of the most commonly-bet player prop markets. Verified live
// against both NFL and CFB games before shipping this list — CFB coverage
// is real but thinner for lower-profile games (fewer books post it).
const PROP_MARKETS = [
  "player_pass_yds",
  "player_rush_yds",
  "player_reception_yds",
  "player_receptions",
  "player_pass_tds",
  "player_anytime_td",
];

function isoWindow(daysAhead) {
  const from = new Date();
  const to = new Date();
  to.setDate(to.getDate() + daysAhead);
  const iso = (d) => d.toISOString().slice(0, 19) + "Z";
  return { from: iso(from), to: iso(to) };
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url.replace(ODDS_API_KEY, "***")} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/** Bulk odds (moneyline/spread/total) across all books for one sport's upcoming games. */
async function fetchLiveOdds(sportKey, from, to) {
  const url =
    `${ODDS_API_BASE}/sports/${sportKey}/odds/?apiKey=${ODDS_API_KEY}` +
    `&regions=us,us2&markets=h2h,spreads,totals&oddsFormat=american&dateFormat=iso` +
    `&commenceTimeFrom=${from}&commenceTimeTo=${to}`;
  const events = await fetchJson(url);

  return events.map((e) => ({
    eventId: e.id,
    commenceTime: e.commence_time,
    homeTeam: e.home_team,
    awayTeam: e.away_team,
    books: (e.bookmakers ?? []).map((b) => {
      const market = (key) => b.markets?.find((m) => m.key === key);
      const outcome = (m, name) => m?.outcomes?.find((o) => o.name === name);
      const h2h = market("h2h");
      const spreads = market("spreads");
      const totals = market("totals");
      const homeSpreadOutcome = outcome(spreads, e.home_team);
      const awaySpreadOutcome = outcome(spreads, e.away_team);
      const overOutcome = outcome(totals, "Over");
      const underOutcome = outcome(totals, "Under");
      return {
        book: b.title,
        lastUpdate: b.last_update,
        homeMoneyline: outcome(h2h, e.home_team)?.price ?? null,
        awayMoneyline: outcome(h2h, e.away_team)?.price ?? null,
        // Odds API convention: `point` on the home team's own spread outcome is already home-perspective (negative = home favored) — flip sign to land on this app's positive-= -home-favored convention (see gameContext.ts).
        homeSpread: typeof homeSpreadOutcome?.point === "number" ? -homeSpreadOutcome.point : null,
        homeSpreadOdds: homeSpreadOutcome?.price ?? null,
        awaySpreadOdds: awaySpreadOutcome?.price ?? null,
        total: overOutcome?.point ?? underOutcome?.point ?? null,
        overOdds: overOutcome?.price ?? null,
        underOdds: underOutcome?.price ?? null,
      };
    }),
  }));
}

/** Player-prop odds for one event, pooled across books — one fetch per event, so callers should only call this for a bounded/near-term set of games. */
async function fetchEventProps(sportKey, eventId) {
  const url =
    `${ODDS_API_BASE}/sports/${sportKey}/events/${eventId}/odds/?apiKey=${ODDS_API_KEY}` +
    `&regions=us&markets=${PROP_MARKETS.join(",")}&oddsFormat=american`;
  let data;
  try {
    data = await fetchJson(url);
  } catch {
    return []; // some events have no props posted yet — not an error
  }

  const props = [];
  for (const b of data.bookmakers ?? []) {
    for (const m of b.markets ?? []) {
      // Most prop markets (yardage/receptions) post one Over and one Under
      // outcome per player, keyed by `point` (the line). "Anytime TD" is
      // shaped differently — a single "Yes" outcome per player with no line
      // at all, just a moneyline-style price — verified live before writing
      // this, rather than assuming every prop market pairs like Over/Under.
      const byPlayer = new Map();
      for (const o of m.outcomes ?? []) {
        const key = o.description ?? "";
        if (!key) continue;
        const entry = byPlayer.get(key) ?? { player: key, line: null, overOdds: null, underOdds: null, yesOdds: null };
        if (o.name === "Over") {
          entry.line = o.point ?? null;
          entry.overOdds = o.price;
        } else if (o.name === "Under") {
          entry.line = o.point ?? null;
          entry.underOdds = o.price;
        } else if (o.name === "Yes") {
          entry.yesOdds = o.price;
        }
        byPlayer.set(key, entry);
      }
      for (const entry of byPlayer.values()) {
        props.push({ market: m.key, book: b.title, ...entry });
      }
    }
  }
  return props;
}

async function mapWithConcurrency(items, limit, fn) {
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => worker()));
}

async function processSport(sport) {
  const sportKey = SPORT_KEYS[sport];
  const { from, to } = isoWindow(DAYS_AHEAD);

  console.log(`[${sport}] Fetching live odds...`);
  const games = await fetchLiveOdds(sportKey, from, to);
  console.log(`  ${games.length} upcoming games with odds`);
  await writeFile(
    path.join(OUT_DIR, `${sport}-live-odds.json`),
    JSON.stringify({ fetchedAt: new Date().toISOString(), games }),
  );
  console.log(`  Wrote public/data/${sport}-live-odds.json`);

  console.log(`[${sport}] Capturing closing lines for games near kickoff...`);
  const closingLines = await captureClosingLines(sport, games);
  await writeFile(path.join(OUT_DIR, `${sport}-closing-lines.json`), JSON.stringify({ lines: closingLines }));
  console.log(`  Wrote public/data/${sport}-closing-lines.json`);

  console.log(`[${sport}] Fetching player props for ${games.length} games...`);
  const propsGames = [];
  await mapWithConcurrency(games, 4, async (g) => {
    const props = await fetchEventProps(sportKey, g.eventId);
    if (props.length > 0) propsGames.push({ eventId: g.eventId, homeTeam: g.homeTeam, awayTeam: g.awayTeam, props });
  });
  console.log(`  ${propsGames.length}/${games.length} games have posted player props`);
  await writeFile(
    path.join(OUT_DIR, `${sport}-player-props.json`),
    JSON.stringify({ fetchedAt: new Date().toISOString(), games: propsGames }),
  );
  console.log(`  Wrote public/data/${sport}-player-props.json`);
}

async function main() {
  if (!ODDS_API_KEY) {
    console.error("ODDS_API_KEY is not set (see .env.example) — skipping live-odds fetch.");
    process.exit(1);
  }
  await mkdir(OUT_DIR, { recursive: true });
  for (const sport of Object.keys(SPORT_KEYS)) {
    await processSport(sport);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
