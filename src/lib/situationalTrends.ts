/**
 * Situational ATS/O-U trend engine — deliberately different from a typical
 * trend site's raw "team is 9-1 ATS in November home games" style query,
 * which is vulnerable to two well-known problems: (1) it doesn't control
 * for team quality at all, so "good teams cover more" masquerades as a real
 * situational edge, and (2) with enough arbitrary filters, SOME will look
 * significant by pure chance (multiple-comparisons / p-hacking).
 *
 * This engine avoids (1) for free: every stat here is measured as
 * performance AGAINST THE SPREAD/TOTAL LINE, not against a flat 50% or
 * against this app's own (admittedly imperfect) Elo model. The spread/total
 * line already IS the market's best estimate of relative team quality for
 * that specific matchup — comparing actual results to it nets out team
 * strength automatically, without needing a separate adjustment step.
 *
 * It limits (2) by using a small, curated list of well-known situational
 * factors (favorite/dog, division game, rest, weather) rather than an
 * open-ended query builder, and by flagging every result's sample size —
 * `trusted: false` means "too few games to distinguish this from noise,"
 * not "no result."
 *
 * NFL has richer context (rest days, roof, temperature, wind — see
 * gameContext.ts) than CFB (spread/total + conference game only — see
 * cfbMarketLines.ts/cfbGameContext.ts), so several situations are NFL-only.
 */

import { moneylineToDecimalB, Sport } from "./espn";

export interface TrendGameRecord {
  gameId: string;
  date: string;
  season: number;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  /** Positive = home favored — same convention as gameContext.ts/cfbMarketLines.ts. Null if no real line is on file for this game. */
  spreadLine: number | null;
  totalLine: number | null;
  homeRest: number | null;
  awayRest: number | null;
  divisionGame: boolean | null;
  roof: string | null;
  temp: number | null;
  wind: number | null;
}

/** Exported for customTrends.ts's "Build Your Own" filters, which need the same favorite/underdog determination the curated situations use. */
export function favoriteSide(r: TrendGameRecord): "home" | "away" | null {
  if (r.spreadLine === null || r.spreadLine === 0) return null;
  return r.spreadLine > 0 ? "home" : "away";
}

export interface Situation {
  id: string;
  label: string;
  sports: Sport[];
  /** Which team-perspective(s) in this game qualify for ATS analysis — 0, 1 (the common case), or 2 entries (e.g. both teams on short rest). */
  atsSides: (r: TrendGameRecord) => Array<"home" | "away">;
  /** Whether this game as a whole qualifies for over/under analysis (totals aren't a per-team stat). */
  qualifiesForTotal: (r: TrendGameRecord) => boolean;
}

export const SITUATIONS: Situation[] = [
  {
    id: "home-favorite",
    label: "Home favorites",
    sports: ["nfl", "cfb"],
    atsSides: (r) => (favoriteSide(r) === "home" ? ["home"] : []),
    qualifiesForTotal: () => false,
  },
  {
    id: "home-underdog",
    label: "Home underdogs",
    sports: ["nfl", "cfb"],
    atsSides: (r) => (favoriteSide(r) === "away" ? ["home"] : []),
    qualifiesForTotal: () => false,
  },
  {
    id: "road-favorite",
    label: "Road favorites",
    sports: ["nfl", "cfb"],
    atsSides: (r) => (favoriteSide(r) === "away" ? ["away"] : []),
    qualifiesForTotal: () => false,
  },
  {
    id: "road-underdog",
    label: "Road underdogs",
    sports: ["nfl", "cfb"],
    atsSides: (r) => (favoriteSide(r) === "home" ? ["away"] : []),
    qualifiesForTotal: () => false,
  },
  {
    id: "division-game",
    label: "Division/conference games (favorite ATS)",
    sports: ["nfl", "cfb"],
    atsSides: (r) => {
      if (r.divisionGame !== true) return [];
      const f = favoriteSide(r);
      return f ? [f] : [];
    },
    qualifiesForTotal: (r) => r.divisionGame === true,
  },
  {
    id: "non-division-game",
    label: "Non-division/conference games (favorite ATS)",
    sports: ["nfl", "cfb"],
    atsSides: (r) => {
      if (r.divisionGame !== false) return [];
      const f = favoriteSide(r);
      return f ? [f] : [];
    },
    qualifiesForTotal: (r) => r.divisionGame === false,
  },
  {
    id: "short-rest",
    label: "Team on short rest (≤6 days)",
    sports: ["nfl"],
    atsSides: (r) => {
      const sides: Array<"home" | "away"> = [];
      if (r.homeRest !== null && r.homeRest <= 6) sides.push("home");
      if (r.awayRest !== null && r.awayRest <= 6) sides.push("away");
      return sides;
    },
    qualifiesForTotal: (r) => (r.homeRest !== null && r.homeRest <= 6) || (r.awayRest !== null && r.awayRest <= 6),
  },
  {
    id: "extra-rest",
    label: "Team with extra rest (≥9 days)",
    sports: ["nfl"],
    atsSides: (r) => {
      const sides: Array<"home" | "away"> = [];
      if (r.homeRest !== null && r.homeRest >= 9) sides.push("home");
      if (r.awayRest !== null && r.awayRest >= 9) sides.push("away");
      return sides;
    },
    qualifiesForTotal: (r) => (r.homeRest !== null && r.homeRest >= 9) || (r.awayRest !== null && r.awayRest >= 9),
  },
  {
    id: "dome",
    label: "Dome/indoor games (favorite ATS)",
    sports: ["nfl"],
    atsSides: (r) => {
      if (r.roof !== "dome" && r.roof !== "closed") return [];
      const f = favoriteSide(r);
      return f ? [f] : [];
    },
    qualifiesForTotal: (r) => r.roof === "dome" || r.roof === "closed",
  },
  {
    id: "cold-weather",
    label: "Cold weather, outdoors, <40°F (favorite ATS)",
    sports: ["nfl"],
    atsSides: (r) => {
      if (r.temp === null || r.temp >= 40) return [];
      const f = favoriteSide(r);
      return f ? [f] : [];
    },
    qualifiesForTotal: (r) => r.temp !== null && r.temp < 40,
  },
  {
    id: "high-wind",
    label: "High wind, >15 mph (favorite ATS)",
    sports: ["nfl"],
    atsSides: (r) => {
      if (r.wind === null || r.wind <= 15) return [];
      const f = favoriteSide(r);
      return f ? [f] : [];
    },
    qualifiesForTotal: (r) => r.wind !== null && r.wind > 15,
  },
];

export type TrendOutcome = "win" | "loss" | "push";

interface DatedOutcome {
  date: string;
  season: number;
  outcome: TrendOutcome;
}

export interface RecordLine {
  wins: number;
  losses: number;
  pushes: number;
}

interface CommonTrendStats {
  n: number;
  pushes: number;
  trusted: boolean;
  /** Net units won/lost, one flat unit staked per qualifying game at standard -110 (see FLAT_BET_B) — a win nets +0.909u, a loss nets -1u, a push is 0. Same convention as every other EV/Kelly calculation in this app (moneylineToDecimalB), not TrendsCenter's own "risk-to-win 1u" convention, so this number is comparable to the rest of the app rather than to a screenshot from elsewhere. */
  units: number;
  /** units / (decided games), as a percentage — the standard "ROI" a bettor would have realized flat-betting every qualifying game. */
  roi: number;
  /** The most recent (up to) 10 qualifying games, chronological-most-recent-first record. */
  last10: RecordLine;
  /** Consecutive wins counting back from the most recent qualifying game; a push is skipped (neither extends nor breaks it), a loss stops it. 0 if the most recent game was a loss. */
  currentStreak: number;
  /** Distinct seasons this trend has any qualifying game in — a rough "how long has this actually been tracked" figure. */
  years: number;
  /** Running total of `units`, oldest to newest, one point per decided game — the raw material for a performance-over-time sparkline. */
  cumulativeUnits: number[];
}

export interface AtsStats extends CommonTrendStats {
  covers: number;
  losses: number;
  coverRate: number;
  /** Average (actual margin - the line), from the qualifying side's own perspective — positive means beating the spread on average. */
  avgMarginVsLine: number;
}

export interface TotalStats extends CommonTrendStats {
  overs: number;
  unders: number;
  overRate: number;
  avgTotalVsLine: number;
}

export interface SituationStats {
  situationId: string;
  label: string;
  ats: AtsStats | null;
  total: TotalStats | null;
}

/** Below this many decided (non-push) games, a cover/over rate away from 50% is not distinguishable from chance — don't sell it as a trend. */
export const MIN_TRUSTED_SAMPLE = 30;

/** Standard -110 juice, assumed for every qualifying game (this app has no per-game historical ATS/total PRICE archive, only the line itself) — same assumption GameResearch.tsx's spread/total check defaults to. Disclosed in the UI, not hidden. */
const FLAT_BET_B = moneylineToDecimalB(-110);

/** Shared math behind AtsStats and TotalStats — both are just "a list of dated win/loss/push outcomes," the market-specific diff-from-line average is computed separately by the caller. */
function deriveTrendStats(outcomes: DatedOutcome[]): CommonTrendStats {
  const sorted = [...outcomes].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const n = sorted.length;
  const pushes = sorted.filter((o) => o.outcome === "push").length;
  const decided = sorted.filter((o) => o.outcome !== "push");
  const wins = decided.filter((o) => o.outcome === "win").length;
  const losses = decided.length - wins;

  const cumulativeUnits: number[] = [];
  let running = 0;
  for (const o of sorted) {
    if (o.outcome === "win") running += FLAT_BET_B;
    else if (o.outcome === "loss") running -= 1;
    if (o.outcome !== "push") cumulativeUnits.push(running);
  }
  const units = running;
  const roi = decided.length > 0 ? (units / decided.length) * 100 : NaN;

  const mostRecentFirst = [...sorted].reverse();
  const last10Outcomes = mostRecentFirst.filter((o) => o.outcome !== "push").slice(0, 10);
  const last10: RecordLine = {
    wins: last10Outcomes.filter((o) => o.outcome === "win").length,
    losses: last10Outcomes.filter((o) => o.outcome === "loss").length,
    pushes: mostRecentFirst.slice(0, 10).filter((o) => o.outcome === "push").length,
  };

  let currentStreak = 0;
  for (const o of mostRecentFirst) {
    if (o.outcome === "push") continue;
    if (o.outcome === "win") currentStreak++;
    else break;
  }

  return {
    n,
    pushes,
    trusted: decided.length >= MIN_TRUSTED_SAMPLE,
    units,
    roi,
    last10,
    currentStreak,
    years: new Set(sorted.map((o) => o.season)).size,
    cumulativeUnits,
  };
}

export function computeSituationStats(records: TrendGameRecord[], situation: Situation): SituationStats {
  const atsOutcomes: DatedOutcome[] = [];
  let sumMarginDiff = 0;
  let covers = 0;
  let losses = 0;

  const totalOutcomes: DatedOutcome[] = [];
  let sumTotalDiff = 0;
  let overs = 0;
  let unders = 0;

  for (const r of records) {
    if (r.spreadLine !== null) {
      for (const side of situation.atsSides(r)) {
        const actualMargin = r.homeScore - r.awayScore;
        const teamMargin = side === "home" ? actualMargin : -actualMargin;
        const teamLine = side === "home" ? r.spreadLine : -r.spreadLine;
        const diff = teamMargin - teamLine;
        sumMarginDiff += diff;
        const outcome: TrendOutcome = diff > 0 ? "win" : diff < 0 ? "loss" : "push";
        if (outcome === "win") covers++;
        else if (outcome === "loss") losses++;
        atsOutcomes.push({ date: r.date, season: r.season, outcome });
      }
    }
    if (r.totalLine !== null && situation.qualifiesForTotal(r)) {
      const total = r.homeScore + r.awayScore;
      const diff = total - r.totalLine;
      sumTotalDiff += diff;
      const outcome: TrendOutcome = diff > 0 ? "win" : diff < 0 ? "loss" : "push";
      if (outcome === "win") overs++;
      else if (outcome === "loss") unders++;
      totalOutcomes.push({ date: r.date, season: r.season, outcome });
    }
  }

  const atsDecided = covers + losses;
  const ouDecided = overs + unders;

  return {
    situationId: situation.id,
    label: situation.label,
    ats:
      atsOutcomes.length > 0
        ? {
            ...deriveTrendStats(atsOutcomes),
            covers,
            losses,
            coverRate: atsDecided > 0 ? covers / atsDecided : NaN,
            avgMarginVsLine: sumMarginDiff / atsOutcomes.length,
          }
        : null,
    total:
      totalOutcomes.length > 0
        ? {
            ...deriveTrendStats(totalOutcomes),
            overs,
            unders,
            overRate: ouDecided > 0 ? overs / ouDecided : NaN,
            avgTotalVsLine: sumTotalDiff / totalOutcomes.length,
          }
        : null,
  };
}
