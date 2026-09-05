#!/usr/bin/env node
/**
 * One-off data prep script (Phase 4). Downloads public, no-API-key historical
 * game data for NFL and college football, strips it down to just what the
 * Elo/logistic-regression pipeline needs, and writes compact JSON into
 * public/data/ so the app can fetch it client-side at runtime.
 *
 * Re-run with `node scripts/prepare-data.mjs` to refresh with newer games.
 * Sources:
 *   NFL: https://github.com/nflverse/nfldata (games.csv) + nflverse-data (stats_team_week)
 *   CFB: https://github.com/sportsdataverse/cfbfastR-data (schedules/csv) for games;
 *        ESPN's site API (game-summary box scores) for team stats, backfilled
 *        incrementally since cfbfastR has no maintained per-game stats archive.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import zlib from "node:zlib";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "public", "data");

/** Minimal RFC4180-ish CSV parser (handles quoted fields with embedded commas). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c === "\r") {
      // skip
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function toObjects(rows) {
  const header = rows[0];
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

async function fetchCsv(url, encoding = "utf-8") {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  // cfbfastR-data's CSV is Latin-1 encoded (not UTF-8) despite being served
  // with no charset — decoding accented names (e.g. "San José State") as
  // UTF-8 corrupts them into replacement characters. Buffer supports
  // 'latin1' natively; res.text() always assumes UTF-8.
  const buf = Buffer.from(await res.arrayBuffer());
  return toObjects(parseCsv(buf.toString(encoding)));
}

function isNum(v) {
  return v !== undefined && v !== null && v !== "" && v !== "NA" && !Number.isNaN(Number(v));
}

/**
 * Compact schema: [gameId, date, season, homeTeam, awayTeam, homeScore, awayScore, neutral]
 * gameId is nflverse's own id (e.g. "2024_01_KC_BAL") for NFL, joining to
 * nfl-team-stats.json. For CFB it's cfbfastR's game_id, which is actually
 * ESPN's own numeric event id — useful for joining a completed historical
 * game directly to ESPN's odds/summary endpoint, but there's no per-game
 * box-score stats archive to join it to the way there is for NFL.
 */
const SCHEMA = ["gameId", "date", "season", "homeTeam", "awayTeam", "homeScore", "awayScore", "neutral"];

/** Compact schema shared by both sports' market-odds files: [gameId, homeMoneyline, awayMoneyline] — real historical sportsbook prices for the Probability Model's backtest, replacing its synthetic -110-both-sides assumption wherever a real price is available. */
const MARKET_ODDS_SCHEMA = ["gameId", "homeMoneyline", "awayMoneyline"];

async function prepareNfl() {
  console.log("Fetching NFL games...");
  const rows = await fetchCsv("https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv");
  const games = rows
    .filter((r) => isNum(r.home_score) && isNum(r.away_score) && r.gameday)
    .map((r) => [
      r.game_id,
      r.gameday,
      Number(r.season),
      r.home_team,
      r.away_team,
      Number(r.home_score),
      Number(r.away_score),
      r.location === "Neutral",
    ])
    .sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  console.log(`  ${games.length} completed games`);

  // nflverse's games.csv already carries real closing moneylines per game —
  // no extra fetch or matching needed, unlike CFB (see prepareCfbMarketOdds).
  const marketOddsRows = rows
    .filter((r) => isNum(r.home_score) && isNum(r.away_score) && isNum(r.home_moneyline) && isNum(r.away_moneyline))
    .map((r) => [r.game_id, Number(r.home_moneyline), Number(r.away_moneyline)]);
  console.log(`  ${marketOddsRows.length} completed games with a real historical moneyline`);

  return { schema: SCHEMA, games, marketOdds: { schema: MARKET_ODDS_SCHEMA, rows: marketOddsRows } };
}

// cfbfastR-data's old single-file archive (schedules/cfb_games_info.csv) was
// abandoned after the 2020 season — using it silently trained the model on
// five-year-stale rosters and conference alignments. schedules/csv/ is the
// maintained replacement: one file per season, updated through the current
// one (including already-played games from the current week).
const CFB_SEASONS = Array.from({ length: 2026 - 2001 + 1 }, (_, i) => 2001 + i);

async function prepareCfb() {
  console.log("Fetching CFB games...");
  const games = [];
  // Every FBS-vs-FBS completed game (gameId, teams, season) — a superset of
  // `games` restricted to the division ESPN's box-score endpoint is worth
  // backfilling for (see prepareCfbTeamStats). Kept separate from `games`
  // itself so the historical/Elo dataset keeps including FCS opponents,
  // which do affect an FBS team's rating.
  const fbsGames = [];
  for (const season of CFB_SEASONS) {
    const url = `https://raw.githubusercontent.com/sportsdataverse/cfbfastR-data/main/schedules/csv/cfb_schedules_${season}.csv`;
    let rows;
    try {
      // Unlike the old abandoned cfb_games_info.csv (Latin-1), this
      // per-season replacement is UTF-8 — confirmed by inspecting the raw
      // bytes for "José" (0xC3 0xA9, the UTF-8 sequence, not Latin-1's 0xE9).
      rows = await fetchCsv(url);
    } catch {
      console.log(`  skipping ${season} (not available)`);
      continue;
    }
    for (const r of rows) {
      if (r.completed !== "TRUE" || !isNum(r.home_points) || !isNum(r.away_points) || !r.start_date) continue;
      games.push([
        r.game_id || null,
        r.start_date.slice(0, 10),
        Number(r.season),
        r.home_team,
        r.away_team,
        Number(r.home_points),
        Number(r.away_points),
        r.neutral_site === "TRUE",
      ]);
      if (r.game_id && r.home_division === "fbs" && r.away_division === "fbs") {
        fbsGames.push({ gameId: r.game_id, season: Number(r.season), homeTeam: r.home_team, awayTeam: r.away_team });
      }
    }
  }
  games.sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  console.log(`  ${games.length} completed games (${fbsGames.length} FBS vs. FBS)`);
  return { schema: SCHEMA, games, fbsGames };
}

/** "Away Team@Home Team" -> { away, home }, or null if it's not that shape. */
function parseGameDesc(desc) {
  const parts = (desc ?? "").split("@");
  if (parts.length !== 2) return null;
  const away = parts[0].trim();
  const home = parts[1].trim();
  if (!away || !home) return null;
  return { away, home };
}

/**
 * Real historical moneylines, backfilled from cfbfastR-data's standalone
 * betting-lines archive (2006-2025, several sportsbooks, gzipped CSV — not
 * updated in-season, so it never covers the current season). Unlike the box
 * scores above, there's no gameId+team join available: each row identifies
 * its team only by `abbr`, which for the 2020+ portion of the archive is the
 * team's full name (matches `game_desc`'s "Away@Home" names exactly) but for
 * 2006-2019 is a compressed sportsbook code ("UTH" for Utah) that isn't safe
 * to resolve without risking a silent mismatch — so only rows whose `abbr`
 * exactly matches one of `game_desc`'s two names are kept. That drops most
 * pre-2020 coverage but keeps every kept row unambiguous. Multiple books
 * reporting the same game are averaged into one consensus price.
 */
async function prepareCfbMarketOdds() {
  console.log("Fetching CFB historical market odds...");
  const url = "https://raw.githubusercontent.com/sportsdataverse/cfbfastR-data/main/betting/csv/cfb_line_odds.csv.gz";
  let rows;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status}`);
    const gz = Buffer.from(await res.arrayBuffer());
    const csvText = zlib.gunzipSync(gz).toString("utf-8");
    rows = toObjects(parseCsv(csvText));
  } catch (e) {
    console.log(`  skipping (failed to fetch/parse: ${e})`);
    return { schema: MARKET_ODDS_SCHEMA, rows: [] };
  }

  const byGame = new Map(); // gameId -> { home: {sum, count}, away: {sum, count} }
  for (const r of rows) {
    if (r.market_type !== "money_line" || !r.game_id || !isNum(r.odds)) continue;
    const desc = parseGameDesc(r.game_desc);
    if (!desc) continue;
    const abbr = (r.abbr ?? "").trim().toLowerCase();
    let side;
    if (abbr === desc.home.toLowerCase()) side = "home";
    else if (abbr === desc.away.toLowerCase()) side = "away";
    else continue;

    let entry = byGame.get(r.game_id);
    if (!entry) {
      entry = { home: { sum: 0, count: 0 }, away: { sum: 0, count: 0 } };
      byGame.set(r.game_id, entry);
    }
    entry[side].sum += Number(r.odds);
    entry[side].count += 1;
  }

  const marketOddsRows = [];
  for (const [gameId, entry] of byGame) {
    if (entry.home.count === 0 || entry.away.count === 0) continue;
    marketOddsRows.push([gameId, Math.round(entry.home.sum / entry.home.count), Math.round(entry.away.sum / entry.away.count)]);
  }
  console.log(`  ${marketOddsRows.length} games with a real historical moneyline (both sides matched)`);
  return { schema: MARKET_ODDS_SCHEMA, rows: marketOddsRows };
}

/**
 * Per-team-per-game box score stats. NFL's comes from nflverse's weekly
 * archive; CFB has no equivalent bulk file (cfbfastR's own play-by-play
 * archive was abandoned after the 2021 season), so it's backfilled directly
 * from ESPN's game-summary endpoint instead — the same one already used for
 * live odds, keyed by the same numeric game_id cfbfastR's schedule carries.
 * Compact schema: [gameId, team, totalYards, turnoverMargin, offEpa]
 * (offEpa is always 0 for CFB rows — ESPN's box score doesn't publish it.)
 */
const TEAM_STAT_SCHEMA = ["gameId", "team", "totalYards", "turnoverMargin", "offEpa"];

async function prepareNflTeamStats(seasons) {
  console.log("Fetching NFL weekly team stats...");
  const rows = [];
  for (const season of seasons) {
    const url = `https://github.com/nflverse/nflverse-data/releases/download/stats_team/stats_team_week_${season}.csv`;
    let objs;
    try {
      objs = await fetchCsv(url);
    } catch {
      console.log(`  skipping ${season} (not published yet)`);
      continue;
    }
    const num = (v) => (isNum(v) ? Number(v) : 0);
    for (const r of objs) {
      if (!r.game_id || !r.team) continue;
      const totalYards = num(r.passing_yards) + num(r.rushing_yards);
      const turnoversLost =
        num(r.passing_interceptions) + num(r.rushing_fumbles_lost) + num(r.receiving_fumbles_lost) + num(r.sack_fumbles_lost);
      const takeaways = num(r.def_interceptions) + num(r.fumble_recovery_opp);
      const offEpa = num(r.passing_epa) + num(r.rushing_epa);
      rows.push([r.game_id, r.team, totalYards, takeaways - turnoversLost, Number(offEpa.toFixed(3))]);
    }
  }
  console.log(`  ${rows.length} team-game stat rows`);
  return { schema: TEAM_STAT_SCHEMA, rows };
}

/** Runs `fn` over `items` with at most `limit` in flight at once — polite to ESPN's unofficial API for a several-thousand-game backfill. */
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

/**
 * Compact schema: [gameId, team, category, player, value] — just the USAGE
 * LEADER in each category, per team per game (not a full box score), enough
 * to answer "who's actually starting/leading this team" without shipping
 * every player's full stat line to the browser.
 *
 * "defense" specifically only works because ESPN's box score carries real
 * total-tackle counts per player — cfbfastR's own player_stats archive has
 * no tackle stat at all and was checked and rejected for this: most games
 * showed 0-1 total defenders credited with anything (sacks/INTs/PBUs are
 * too sparse to represent a defense), so it's ESPN's box score or nothing.
 */
const PLAYER_USAGE_SCHEMA = ["gameId", "team", "category", "player", "value"];

/** Categories to extract a usage leader from, and how to read that category's first relevant stat. */
const PLAYER_USAGE_CATEGORIES = [
  { category: "passing", statIndex: 0, parse: parseAttemptsFromSplit }, // "13/20" -> 20 attempts
  { category: "rushing", statIndex: 0, parse: parsePlainNumber }, // CAR
  { category: "receiving", statIndex: 0, parse: parsePlainNumber }, // REC
  { category: "defensive", statIndex: 0, parse: parsePlainNumber }, // TOT tackles
];

function parsePlainNumber(raw) {
  const v = Number(raw);
  return Number.isFinite(v) ? v : null;
}

function parseAttemptsFromSplit(raw) {
  if (typeof raw !== "string") return null;
  const parts = raw.split("/");
  if (parts.length !== 2) return null;
  const v = Number(parts[1]);
  return Number.isFinite(v) ? v : null;
}

/** The usage leader (highest value) in one team's one statistical category this game, or null if nobody qualifies. */
function categoryLeader(categoryBlock, statIndex, parse) {
  let best = null;
  for (const a of categoryBlock?.athletes ?? []) {
    const value = parse(a.stats?.[statIndex]);
    const name = a.athlete?.displayName;
    if (value === null || !name) continue;
    if (!best || value > best.value) best = { player: name, value };
  }
  return best;
}

/**
 * One completed game's box score from ESPN's summary endpoint — team totals
 * (TEAM_STAT_SCHEMA shape) and per-team usage leaders (PLAYER_USAGE_SCHEMA
 * shape), from the same fetch. Returns null if ESPN has nothing usable.
 */
async function fetchCfbGameBoxScore(gameId, homeTeam, awayTeam) {
  let res;
  try {
    res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event=${gameId}`);
  } catch {
    return null;
  }
  if (!res.ok) return null;
  let data;
  try {
    data = await res.json();
  } catch {
    return null;
  }
  const teams = data?.boxscore?.teams;
  if (!Array.isArray(teams) || teams.length !== 2) return null;
  const home = teams.find((t) => t.homeAway === "home");
  const away = teams.find((t) => t.homeAway === "away");
  if (!home || !away) return null;
  const stat = (teamBox, name) => {
    const entry = teamBox.statistics?.find((s) => s.name === name);
    const v = entry ? Number(entry.displayValue) : NaN;
    return Number.isFinite(v) ? v : null;
  };
  const homeYards = stat(home, "totalYards");
  const awayYards = stat(away, "totalYards");
  const homeTurnovers = stat(home, "turnovers");
  const awayTurnovers = stat(away, "turnovers");
  if (homeYards === null || awayYards === null || homeTurnovers === null || awayTurnovers === null) return null;
  const teamRows = [
    [gameId, homeTeam, homeYards, awayTurnovers - homeTurnovers, 0],
    [gameId, awayTeam, awayYards, homeTurnovers - awayTurnovers, 0],
  ];

  const playerRows = [];
  const roleByTeamId = { [home.team?.id]: homeTeam, [away.team?.id]: awayTeam };
  const playerBlocks = data?.boxscore?.players;
  if (Array.isArray(playerBlocks)) {
    for (const block of playerBlocks) {
      const team = roleByTeamId[block.team?.id];
      if (!team) continue;
      for (const { category, statIndex, parse } of PLAYER_USAGE_CATEGORIES) {
        const categoryBlock = block.statistics?.find((s) => s.name === category);
        const leader = categoryLeader(categoryBlock, statIndex, parse);
        if (leader) playerRows.push([gameId, team, category, leader.player, leader.value]);
      }
    }
  }

  return { teamRows, playerRows };
}

// ESPN's box scores are confirmed available back to at least 2005, but
// backfilling all ~20 seasons of FBS games in one run is a lot to ask of an
// unofficial API — start with a recent window (still ~8000+ games) and lower
// this later to extend it. Each daily run only fetches games not already in
// the existing file, so this cost is paid once per season added, not repeatedly.
const CFB_TEAM_STATS_MIN_SEASON = 2018;

/**
 * Backfills both team-box-score stats and per-team player-usage leaders from
 * one pass of ESPN fetches. Driven by player-usage coverage (the newer,
 * incomplete dataset) rather than team-stats coverage, so a game already
 * cached for team stats but not yet for player usage gets re-fetched once to
 * pick up the player data too — its team-stat rows are then replaced with
 * the fresh copy rather than duplicated.
 */
async function prepareCfbBoxScoreData(fbsGames, existingTeamRows, existingPlayerRows) {
  console.log("Fetching CFB box scores (team stats + player-usage leaders, FBS vs. FBS, backfilled from ESPN)...");
  const playerCovered = new Set(existingPlayerRows.map((r) => r[0]));
  const eligible = fbsGames.filter((g) => g.season >= CFB_TEAM_STATS_MIN_SEASON && !playerCovered.has(g.gameId));
  console.log(`  ${playerCovered.size} games already cached, ${eligible.length} new to fetch`);

  const newTeamRows = [];
  const newPlayerRows = [];
  const refetchedGameIds = new Set();
  let done = 0;
  await mapWithConcurrency(eligible, 6, async (g) => {
    const result = await fetchCfbGameBoxScore(g.gameId, g.homeTeam, g.awayTeam);
    if (result) {
      newTeamRows.push(...result.teamRows);
      newPlayerRows.push(...result.playerRows);
      refetchedGameIds.add(g.gameId);
    }
    done++;
    if (done % 500 === 0) console.log(`  ...${done}/${eligible.length}`);
  });

  console.log(`  +${refetchedGameIds.size} games fetched successfully (${eligible.length - refetchedGameIds.size} unavailable)`);
  const keptTeamRows = existingTeamRows.filter((r) => !refetchedGameIds.has(r[0]));
  return {
    teamStats: { schema: TEAM_STAT_SCHEMA, rows: [...keptTeamRows, ...newTeamRows] },
    playerUsage: { schema: PLAYER_USAGE_SCHEMA, rows: [...existingPlayerRows, ...newPlayerRows] },
  };
}

/** Reads an existing public/data JSON file's `rows`, or [] if it doesn't exist yet (first run). */
async function readExistingRows(filename) {
  try {
    const raw = await readFile(path.join(OUT_DIR, filename), "utf-8");
    return JSON.parse(raw).rows ?? [];
  } catch {
    return [];
  }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const { schema: nflSchema, games: nflGames, marketOdds: nflMarketOdds } = await prepareNfl();
  await writeFile(path.join(OUT_DIR, "nfl-games.json"), JSON.stringify({ schema: nflSchema, games: nflGames }));
  console.log(`Wrote public/data/nfl-games.json`);
  await writeFile(path.join(OUT_DIR, "nfl-market-odds.json"), JSON.stringify(nflMarketOdds));
  console.log(`Wrote public/data/nfl-market-odds.json`);

  const nflSeasons = [...new Set(nflGames.map((g) => g[2]))].sort((a, b) => a - b);
  const nflTeamStats = await prepareNflTeamStats(nflSeasons);
  await writeFile(path.join(OUT_DIR, "nfl-team-stats.json"), JSON.stringify(nflTeamStats));
  console.log(`Wrote public/data/nfl-team-stats.json`);

  const { schema, games, fbsGames } = await prepareCfb();
  await writeFile(path.join(OUT_DIR, "cfb-games.json"), JSON.stringify({ schema, games }));
  console.log(`Wrote public/data/cfb-games.json`);

  const existingCfbTeamStatRows = await readExistingRows("cfb-team-stats.json");
  const existingCfbPlayerUsageRows = await readExistingRows("cfb-player-usage.json");
  const { teamStats: cfbTeamStats, playerUsage: cfbPlayerUsage } = await prepareCfbBoxScoreData(
    fbsGames,
    existingCfbTeamStatRows,
    existingCfbPlayerUsageRows,
  );
  await writeFile(path.join(OUT_DIR, "cfb-team-stats.json"), JSON.stringify(cfbTeamStats));
  console.log(`Wrote public/data/cfb-team-stats.json`);
  await writeFile(path.join(OUT_DIR, "cfb-player-usage.json"), JSON.stringify(cfbPlayerUsage));
  console.log(`Wrote public/data/cfb-player-usage.json`);

  const cfbMarketOdds = await prepareCfbMarketOdds();
  await writeFile(path.join(OUT_DIR, "cfb-market-odds.json"), JSON.stringify(cfbMarketOdds));
  console.log(`Wrote public/data/cfb-market-odds.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
