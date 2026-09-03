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
  return { schema: SCHEMA, games };
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

/** One completed game's box score from ESPN's summary endpoint, as [home row, away row] in TEAM_STAT_SCHEMA shape — or null if ESPN has nothing usable for it. */
async function fetchCfbBoxScoreRows(gameId, homeTeam, awayTeam) {
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
  return [
    [gameId, homeTeam, homeYards, awayTurnovers - homeTurnovers, 0],
    [gameId, awayTeam, awayYards, homeTurnovers - awayTurnovers, 0],
  ];
}

// ESPN's box scores are confirmed available back to at least 2005, but
// backfilling all ~20 seasons of FBS games in one run is a lot to ask of an
// unofficial API — start with a recent window (still ~8000+ games) and lower
// this later to extend it. Each daily run only fetches games not already in
// the existing file, so this cost is paid once per season added, not repeatedly.
const CFB_TEAM_STATS_MIN_SEASON = 2018;

async function prepareCfbTeamStats(fbsGames, existingRows) {
  console.log("Fetching CFB box-score team stats (FBS vs. FBS, backfilled from ESPN)...");
  const covered = new Set(existingRows.map((r) => r[0])); // gameId — both teams' rows are always written together
  const eligible = fbsGames.filter((g) => g.season >= CFB_TEAM_STATS_MIN_SEASON && !covered.has(g.gameId));
  console.log(`  ${covered.size} games already cached, ${eligible.length} new to fetch`);

  const newRows = [];
  let done = 0;
  await mapWithConcurrency(eligible, 6, async (g) => {
    const rows = await fetchCfbBoxScoreRows(g.gameId, g.homeTeam, g.awayTeam);
    if (rows) newRows.push(...rows);
    done++;
    if (done % 500 === 0) console.log(`  ...${done}/${eligible.length}`);
  });

  console.log(`  +${newRows.length / 2} games fetched successfully (${eligible.length - newRows.length / 2} unavailable)`);
  return { schema: TEAM_STAT_SCHEMA, rows: [...existingRows, ...newRows] };
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

  const nfl = await prepareNfl();
  await writeFile(path.join(OUT_DIR, "nfl-games.json"), JSON.stringify(nfl));
  console.log(`Wrote public/data/nfl-games.json`);

  const nflSeasons = [...new Set(nfl.games.map((g) => g[2]))].sort((a, b) => a - b);
  const nflTeamStats = await prepareNflTeamStats(nflSeasons);
  await writeFile(path.join(OUT_DIR, "nfl-team-stats.json"), JSON.stringify(nflTeamStats));
  console.log(`Wrote public/data/nfl-team-stats.json`);

  const { schema, games, fbsGames } = await prepareCfb();
  await writeFile(path.join(OUT_DIR, "cfb-games.json"), JSON.stringify({ schema, games }));
  console.log(`Wrote public/data/cfb-games.json`);

  const existingCfbTeamStatRows = await readExistingRows("cfb-team-stats.json");
  const cfbTeamStats = await prepareCfbTeamStats(fbsGames, existingCfbTeamStatRows);
  await writeFile(path.join(OUT_DIR, "cfb-team-stats.json"), JSON.stringify(cfbTeamStats));
  console.log(`Wrote public/data/cfb-team-stats.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
