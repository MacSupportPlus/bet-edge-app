#!/usr/bin/env node
/**
 * One-off data prep script (Phase 4). Downloads public, no-API-key historical
 * game data for NFL and college football, strips it down to just what the
 * Elo/logistic-regression pipeline needs, and writes compact JSON into
 * public/data/ so the app can fetch it client-side at runtime.
 *
 * Re-run with `node scripts/prepare-data.mjs` to refresh with newer games.
 * Sources:
 *   NFL: https://github.com/nflverse/nfldata (games.csv)
 *   CFB: https://github.com/sportsdataverse/cfbfastR-data (schedules/cfb_games_info.csv)
 */

import { mkdir, writeFile } from "node:fs/promises";
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

async function fetchCsv(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  const text = await res.text();
  return toObjects(parseCsv(text));
}

function isNum(v) {
  return v !== undefined && v !== null && v !== "" && v !== "NA" && !Number.isNaN(Number(v));
}

/** Compact schema: [date, season, homeTeam, awayTeam, homeScore, awayScore, neutral] */
const SCHEMA = ["date", "season", "homeTeam", "awayTeam", "homeScore", "awayScore", "neutral"];

async function prepareNfl() {
  console.log("Fetching NFL games...");
  const rows = await fetchCsv("https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv");
  const games = rows
    .filter((r) => isNum(r.home_score) && isNum(r.away_score) && r.gameday)
    .map((r) => [
      r.gameday,
      Number(r.season),
      r.home_team,
      r.away_team,
      Number(r.home_score),
      Number(r.away_score),
      r.location === "Neutral",
    ])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  console.log(`  ${games.length} completed games`);
  return { schema: SCHEMA, games };
}

async function prepareCfb() {
  console.log("Fetching CFB games...");
  const rows = await fetchCsv(
    "https://raw.githubusercontent.com/sportsdataverse/cfbfastR-data/main/schedules/cfb_games_info.csv",
  );
  const games = rows
    .filter((r) => isNum(r.home_points) && isNum(r.away_points) && r.start_date)
    .map((r) => [
      r.start_date.slice(0, 10),
      Number(r.season),
      r.home_team,
      r.away_team,
      Number(r.home_points),
      Number(r.away_points),
      r.neutral_site === "TRUE",
    ])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  console.log(`  ${games.length} completed games`);
  return { schema: SCHEMA, games };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const nfl = await prepareNfl();
  await writeFile(path.join(OUT_DIR, "nfl-games.json"), JSON.stringify(nfl));
  console.log(`Wrote public/data/nfl-games.json`);

  const cfb = await prepareCfb();
  await writeFile(path.join(OUT_DIR, "cfb-games.json"), JSON.stringify(cfb));
  console.log(`Wrote public/data/cfb-games.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
