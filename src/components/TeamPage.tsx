"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { BetEntry, summarizeBankroll } from "@/lib/bankroll";
import { Game, runElo } from "@/lib/elo";
import { fetchOddsForGames, fetchUpcomingGames, GameOdds, Sport, UpcomingGame } from "@/lib/espn";
import { loadGames } from "@/lib/loadGames";
import { predictProba, trainLogisticRegression } from "@/lib/logisticRegression";
import { formatMoneyline } from "@/lib/odds";
import { formatStatLine, loadPlayerUsage, primaryStarter, PlayerUsageRow, UsageCategory, USAGE_CATEGORY_LABELS } from "@/lib/playerUsage";
import { computeRankings } from "@/lib/rankings";
import { seasonAverage, teamStatTrend } from "@/lib/research";
import { classifyPick, pickSide } from "@/lib/scanner";
import { fitMarginModel, predictMargin, predictTotal, seasonScoringAverage } from "@/lib/spreadModel";
import { SCHEDULE_LOOKAHEAD_DAYS, SPORT_ELO_OPTIONS, SPORT_LABELS } from "@/lib/sportConfig";
import { matchKeyFor, matchTeamName } from "@/lib/teamMatch";
import { computeTeamStatDiffs, loadTeamStats, NEUTRAL_TEAM_STAT_FEATURES, TeamGameStat } from "@/lib/teamStats";
import { useLocalStorageState } from "@/lib/useLocalStorageState";
import { LineChart } from "./LineChart";
import { StatTile } from "./StatTile";
import { TeamAutocomplete } from "./TeamAutocomplete";

const RECENT_GAMES_SHOWN = 8;

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" });
  } catch {
    return iso;
  }
}

function fmtKickoff(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function fmtSignedRating(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}`;
}

function researchUrl(sport: Sport, home: string, away: string, espnId?: string): string {
  const query = new URLSearchParams({ dataset: sport, home, away });
  if (espnId) query.set("espnId", espnId);
  return `/research?${query.toString()}`;
}

interface Snapshot {
  sport: Sport;
  games: Game[];
  teamGameStats: TeamGameStat[] | null;
  playerUsage: PlayerUsageRow[];
  upcomingGames: UpcomingGame[];
  oddsByEspnId: Map<string, GameOdds | null>;
  error: string | null;
}

const USAGE_CATEGORIES: UsageCategory[] = ["passing", "rushing", "receiving", "defensive"];

export function TeamPage() {
  const router = useRouter();
  const params = useSearchParams();
  const sport: Sport = params.get("sport") === "nfl" ? "nfl" : "cfb";
  const team = params.get("name") ?? "";

  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);

  const [startingBankroll] = useLocalStorageState("bankroll-tracker:starting", 10000);
  const [bets] = useLocalStorageState<BetEntry[]>("bankroll-tracker:bets", []);
  const [fractionalMultiplier] = useLocalStorageState("weekly-edges:fractional", 0.5);
  const currentBankroll = useMemo(() => summarizeBankroll(startingBankroll, bets).currentBankroll, [startingBankroll, bets]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [games, teamGameStats, playerUsage, schedule] = await Promise.all([
          loadGames(sport),
          loadTeamStats(sport),
          loadPlayerUsage(sport),
          fetchUpcomingGames(sport, SCHEDULE_LOOKAHEAD_DAYS[sport]),
        ]);
        const upcomingGames = schedule.games.filter((g) => {
          const home = matchTeamName(matchKeyFor(sport, g, "home"), new Set([team]));
          const away = matchTeamName(matchKeyFor(sport, g, "away"), new Set([team]));
          return home === team || away === team;
        });
        const oddsByEspnId = await fetchOddsForGames(sport, upcomingGames.map((g) => g.espnId));
        if (!cancelled) setSnapshot({ sport, games, teamGameStats, playerUsage, upcomingGames, oddsByEspnId, error: null });
      } catch (e) {
        if (!cancelled)
          setSnapshot({ sport, games: [], teamGameStats: null, playerUsage: [], upcomingGames: [], oddsByEspnId: new Map(), error: String(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sport, team]);

  const loading = team !== "" && (snapshot === null || snapshot.sport !== sport || (snapshot.games.length === 0 && snapshot.error === null));

  const analysis = useMemo(() => {
    if (!snapshot || snapshot.sport !== sport || !team) return null;
    const { games, teamGameStats, playerUsage, upcomingGames, oddsByEspnId } = snapshot;

    const eloOptions = SPORT_ELO_OPTIONS[sport];
    const { records, finalRatings, ratingHistory } = runElo(games, eloOptions);
    const history = ratingHistory.get(team);
    if (!history || history.length === 0) return null;

    const statDiffs = teamGameStats ? computeTeamStatDiffs(games, teamGameStats) : new Map();
    const hasTeamStats = statDiffs.size > 0;
    const statFeaturesFor = (r: { gameId?: string }) => (r.gameId && statDiffs.get(r.gameId)) || NEUTRAL_TEAM_STAT_FEATURES;
    const featuresFor = (r: (typeof records)[number]) => {
      const base = [r.eloDiff];
      if (!hasTeamStats) return base;
      const f = statFeaturesFor(r);
      return [...base, f.totalYardsDiff, f.turnoverMarginDiff, f.offEpaDiff];
    };
    const model = trainLogisticRegression(
      records.map(featuresFor),
      records.map((r) => r.homeWin),
      { iterations: 300, learningRate: 0.5 },
    );

    const currentSeason = games[games.length - 1].season;
    const statTrend = hasTeamStats && teamGameStats ? teamStatTrend(games, teamGameStats, team) : [];
    const teamSeasonAvg = hasTeamStats ? seasonAverage(statTrend, currentSeason) : null;

    // Informational only (see spreadModel.ts for the measured accuracy behind
    // these) — this team's own season scoring average, for the total estimate.
    const marginModel = fitMarginModel(records);
    const teamScoringAvg = seasonScoringAverage(history, currentSeason);

    // Who's actually been playing this season, from real box scores — context
    // for a human to weigh, not a model feature (see playerUsage.ts for why).
    const keyPlayers = USAGE_CATEGORIES.map((category) => ({
      category,
      starter: primaryStarter(playerUsage, games, team, category, currentSeason),
    })).filter((k) => k.starter !== null);

    const knownTeams = new Set<string>();
    for (const g of games) {
      knownTeams.add(g.homeTeam);
      knownTeams.add(g.awayTeam);
    }

    const upcoming = upcomingGames.map((game) => {
      const isHome = matchTeamName(matchKeyFor(sport, game, "home"), new Set([team])) === team;
      const opponentKey = matchKeyFor(sport, game, isHome ? "away" : "home");
      const matchedOpponent = matchTeamName(opponentKey, knownTeams);
      if (!matchedOpponent) {
        return {
          game,
          isHome,
          opponent: opponentKey,
          matchedOpponent: null as string | null,
          pTeam: null as number | null,
          teamMoneyline: null as number | null,
          status: "unmatched" as const,
          stake: 0,
          predictedMargin: null as number | null,
          predictedTotal: null as number | null,
        };
      }

      const teamElo = finalRatings.get(team) ?? eloOptions.initialRating;
      const oppElo = finalRatings.get(matchedOpponent) ?? eloOptions.initialRating;
      const homeAdv = game.neutralSite ? 0 : eloOptions.homeAdvantage;
      const eloDiff = isHome ? teamElo + homeAdv - oppElo : oppElo + homeAdv - teamElo;
      let features = [eloDiff];
      if (hasTeamStats) {
        const oppAvg = seasonAverage(teamStatTrend(games, teamGameStats!, matchedOpponent), currentSeason);
        const f =
          teamSeasonAvg && oppAvg
            ? {
                totalYardsDiff: isHome ? teamSeasonAvg.totalYards - oppAvg.totalYards : oppAvg.totalYards - teamSeasonAvg.totalYards,
                turnoverMarginDiff: isHome
                  ? teamSeasonAvg.turnoverMargin - oppAvg.turnoverMargin
                  : oppAvg.turnoverMargin - teamSeasonAvg.turnoverMargin,
                offEpaDiff: isHome ? teamSeasonAvg.offEpa - oppAvg.offEpa : oppAvg.offEpa - teamSeasonAvg.offEpa,
              }
            : NEUTRAL_TEAM_STAT_FEATURES;
        features = [eloDiff, f.totalYardsDiff, f.turnoverMarginDiff, f.offEpaDiff];
      }
      const pHomeSide = predictProba(model, features);
      const pTeam = isHome ? pHomeSide : 1 - pHomeSide;

      const odds = oddsByEspnId.get(game.espnId);
      let status: "edge" | "flagged" | "no-edge" | "no-odds" | "unmatched" = "no-odds";
      let teamMoneyline: number | null = null;
      let stake = 0;
      if (odds?.homeMoneyline !== null && odds?.homeMoneyline !== undefined && odds?.awayMoneyline !== null && odds?.awayMoneyline !== undefined) {
        const pick = pickSide(pHomeSide, odds.homeMoneyline, odds.awayMoneyline, "home", "away");
        const classification = classifyPick(pick, currentBankroll, fractionalMultiplier);
        status = classification.status;
        teamMoneyline = pick.side === (isHome ? "home" : "away") ? pick.moneyline : isHome ? odds.awayMoneyline : odds.homeMoneyline;
        if (classification.status === "edge" && pick.side === (isHome ? "home" : "away")) stake = classification.stake;
      }

      const homeMargin = predictMargin(marginModel, eloDiff);
      const predictedMargin = isHome ? homeMargin : -homeMargin; // this team's own perspective, positive = favored
      const oppScoringAvg = seasonScoringAverage(ratingHistory.get(matchedOpponent), currentSeason);
      const predictedTotal = teamScoringAvg && oppScoringAvg ? predictTotal(teamScoringAvg, oppScoringAvg) : null;

      return { game, isHome, opponent: matchedOpponent, matchedOpponent, pTeam, teamMoneyline, status, stake, predictedMargin, predictedTotal };
    });

    const ranked = computeRankings(sport, games, teamGameStats, eloOptions);
    const rankIndex = ranked?.rows.findIndex((r) => r.team === team) ?? -1;
    const rankedRow = rankIndex >= 0 ? ranked!.rows[rankIndex] : null;

    return {
      currentElo: finalRatings.get(team) ?? eloOptions.initialRating,
      hasTeamStats,
      recent: [...history].reverse().slice(0, RECENT_GAMES_SHOWN),
      statTrend,
      upcoming,
      keyPlayers,
      rank: rankIndex >= 0 ? rankIndex + 1 : null,
      rankOf: ranked?.rows.length ?? null,
      offenseRating: rankedRow?.offenseRating ?? null,
      defenseRating: rankedRow?.defenseRating ?? null,
      offenseRank: rankedRow?.offenseRank ?? null,
      defenseRank: rankedRow?.defenseRank ?? null,
    };
  }, [snapshot, sport, team, currentBankroll, fractionalMultiplier]);

  const [pickSportDraft, setPickSportDraft] = useState<Sport>("cfb");
  const [pickTeamDraft, setPickTeamDraft] = useState("");
  const [teamListResult, setTeamListResult] = useState<{ sport: Sport; names: string[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadGames(pickSportDraft).then((games) => {
      if (cancelled) return;
      const names = [...new Set(games.flatMap((g) => [g.homeTeam, g.awayTeam]))].sort();
      setTeamListResult({ sport: pickSportDraft, names });
    });
    return () => {
      cancelled = true;
    };
  }, [pickSportDraft]);

  const teamOptions = teamListResult?.sport === pickSportDraft ? teamListResult.names : [];
  const pickTeamValid = pickTeamDraft !== "" && teamOptions.includes(pickTeamDraft);

  function goToPicked() {
    if (!pickTeamValid) return;
    router.push(`/team?${new URLSearchParams({ sport: pickSportDraft, name: pickTeamDraft }).toString()}`);
  }

  if (!team) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-10">
        <h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
          Team Page
        </h1>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          Everything the model knows about one team, without needing an opponent picked yet —
          rating trend, recent form, season stats, and what it thinks about their upcoming games.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {(["cfb", "nfl"] as Sport[]).map((s) => (
            <button
              key={s}
              onClick={() => {
                setPickSportDraft(s);
                setPickTeamDraft("");
              }}
              className="rounded-full border px-3 py-1.5 text-sm transition-colors"
              style={{
                borderColor: pickSportDraft === s ? "var(--series-1)" : "var(--card-border)",
                background: pickSportDraft === s ? "var(--series-1)" : "transparent",
                color: pickSportDraft === s ? "white" : "var(--text-secondary)",
              }}
            >
              {SPORT_LABELS[s]}
            </button>
          ))}
        </div>
        <div
          className="grid grid-cols-1 gap-3 rounded-lg border p-4 sm:grid-cols-3"
          style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}
        >
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span style={{ color: "var(--text-secondary)" }}>Team</span>
            <TeamAutocomplete value={pickTeamDraft} onChange={setPickTeamDraft} options={teamOptions} placeholder="Type or choose…" />
          </label>
          <div className="flex items-end">
            <button
              onClick={goToPicked}
              disabled={!pickTeamValid}
              className="w-full rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              style={{ background: "var(--series-1)" }}
            >
              View team →
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-10">
      <div>
        <Link href="/team" className="text-xs underline" style={{ color: "var(--text-muted)" }}>
          ← Choose a different team
        </Link>
        <h1 className="mt-1 text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
          {team}
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
          {SPORT_LABELS[sport]} — rating trend, recent form, and what the model thinks about their
          next games, all in one place.
        </p>
      </div>

      {loading && (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Loading {SPORT_LABELS[sport]} history…
        </p>
      )}
      {snapshot?.error && (
        <div className="rounded-lg border px-4 py-3 text-sm" style={{ borderColor: "var(--status-critical)", color: "var(--status-critical)" }}>
          Failed to load data: {snapshot.error}
        </div>
      )}
      {!loading && !snapshot?.error && !analysis && (
        <div className="rounded-lg border px-4 py-3 text-sm" style={{ borderColor: "var(--status-critical)", color: "var(--status-critical)" }}>
          Couldn&apos;t find &quot;{team}&quot; in the historical data — the link that brought you
          here may be using a name that doesn&apos;t match our records.
        </div>
      )}

      {analysis && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Current Elo" value={analysis.currentElo.toFixed(0)} sub="rating right now" />
            <StatTile
              label="Rank"
              value={analysis.rank ? `#${analysis.rank}` : "—"}
              sub={analysis.rank ? `of ${analysis.rankOf} this season` : "no games yet this season"}
            />
            <StatTile label="Last 5" value={analysis.recent.slice(-5).map((g) => g.result).join("-") || "—"} sub="most recent first" />
            {analysis.offenseRating !== null && (
              <StatTile
                label="Offense rtg"
                value={analysis.offenseRank ? `#${analysis.offenseRank}` : `${analysis.offenseRating >= 0 ? "+" : ""}${analysis.offenseRating.toFixed(1)}`}
                sub={analysis.offenseRank ? `of ${analysis.rankOf} · ${fmtSignedRating(analysis.offenseRating)} pts/g vs. exp.` : "pts/g vs. expected"}
                accent={analysis.offenseRating >= 0 ? "good" : "critical"}
              />
            )}
            {analysis.defenseRating !== null && (
              <StatTile
                label="Defense rtg"
                value={analysis.defenseRank ? `#${analysis.defenseRank}` : `${analysis.defenseRating >= 0 ? "+" : ""}${analysis.defenseRating.toFixed(1)}`}
                sub={analysis.defenseRank ? `of ${analysis.rankOf} · ${fmtSignedRating(analysis.defenseRating)} pts/g vs. exp.` : "pts/g vs. expected"}
                accent={analysis.defenseRating >= 0 ? "good" : "critical"}
              />
            )}
          </div>
          {(analysis.offenseRating !== null || analysis.defenseRating !== null) && (
            <p className="-mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
              Offense/Defense rtg: points scored/allowed per game compared to what an average team
              would do against the same strength of opponent this season — see Rankings for the
              full board.
            </p>
          )}
          {analysis.rank && (
            <p className="-mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
              <Link href={`/rankings/${sport}`} className="underline" style={{ color: "var(--series-1)" }}>
                See the full {SPORT_LABELS[sport]} rankings →
              </Link>
            </p>
          )}

          <div className="rounded-lg border p-4" style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}>
            <h2 className="mb-1 text-sm font-medium" style={{ color: "var(--text-primary)" }}>
              Elo rating trend — last {RECENT_GAMES_SHOWN} games
            </h2>
            <p className="mb-2 text-xs" style={{ color: "var(--text-muted)" }}>
              Each point is the rating right after that game — climbing means beating
              expectations lately, flattening or dropping means the opposite.
            </p>
            <LineChart
              ariaLabel={`Elo rating trend for ${team}`}
              baseline={SPORT_ELO_OPTIONS[sport].initialRating}
              yFormat={(v) => v.toFixed(0)}
              xFormat={(v) => fmtDate(new Date(v).toISOString())}
              series={[
                {
                  label: team,
                  color: "var(--series-1)",
                  points: [...analysis.recent].reverse().map((p) => ({ x: new Date(p.date).getTime(), y: p.ratingAfter })),
                },
              ]}
            />
          </div>

          <div className="rounded-lg border p-4" style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}>
            <h2 className="mb-1 text-sm font-medium" style={{ color: "var(--text-primary)" }}>
              Recent form
            </h2>
            <p className="mb-2 text-xs" style={{ color: "var(--text-muted)" }}>
              The number after each opponent is <em>their</em> Elo rating going into that game —
              a win over a 1650-rated team says a lot more than a win over a 1350 one.
            </p>
            <div className="flex flex-col gap-1 text-xs">
              {analysis.recent.map((g, i) => (
                <div key={i} className="flex items-center justify-between gap-2" style={{ color: "var(--text-secondary)" }}>
                  <span>
                    {fmtDate(g.date)} {g.isHome ? "vs" : "at"} {g.opponent} ({g.opponentRatingBefore.toFixed(0)})
                  </span>
                  <span
                    className="font-medium"
                    style={{ color: g.result === "W" ? "var(--status-good)" : g.result === "L" ? "var(--status-critical)" : "var(--text-muted)" }}
                  >
                    {g.result} {g.pointsFor}-{g.pointsAgainst}
                  </span>
                </div>
              ))}
              {analysis.recent.length === 0 && <span style={{ color: "var(--text-muted)" }}>No games in the dataset yet.</span>}
            </div>
          </div>

          <div className="rounded-lg border p-4" style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}>
            <h2 className="mb-1 text-sm font-medium" style={{ color: "var(--text-primary)" }}>
              Key players this season
            </h2>
            <p className="mb-3 text-xs" style={{ color: "var(--text-muted)" }}>
              Who&apos;s actually been on the field, from real box scores — not fed into the
              model (there&apos;s no reliable way to know before kickoff whether this week&apos;s
              usual leader is playing), just context for you to weigh yourself.
            </p>
            {analysis.keyPlayers.length === 0 ? (
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                No games played yet this season — check back once they&apos;ve played.
              </p>
            ) : (
              <div className="flex flex-col gap-2 text-xs">
                {analysis.keyPlayers.map(({ category, starter }) => (
                  <div key={category} className="flex flex-col gap-0.5 rounded-md border px-2.5 py-1.5" style={{ borderColor: "var(--card-border)" }}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span style={{ color: "var(--text-muted)" }}>{USAGE_CATEGORY_LABELS[category]}</span>
                      <span>
                        <strong style={{ color: "var(--text-primary)" }}>{starter!.player}</strong>{" "}
                        <span style={{ color: "var(--text-muted)" }}>
                          (led {starter!.gamesLed} of {starter!.totalGames} game{starter!.totalGames === 1 ? "" : "s"})
                        </span>
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span style={{ color: "var(--text-secondary)" }}>{formatStatLine(category, starter!.statLine)}</span>
                      {!starter!.ledMostRecentGame && (
                        <span style={{ color: "var(--status-critical)" }}>someone else led most recently</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {analysis.hasTeamStats && analysis.statTrend.length > 0 && (
            <div className="rounded-lg border p-4" style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}>
              <h2 className="mb-1 text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                Team stat trends
              </h2>
              <p className="mb-3 text-xs" style={{ color: "var(--text-muted)" }}>
                Same stats the model trains on — total yards, turnover margin, and (NFL only)
                offensive efficiency (EPA), one point per game played.
              </p>
              {[
                {
                  label: "Total yards",
                  key: "totalYards" as const,
                  baseline: undefined as number | undefined,
                  description:
                    "Yards gained that game, offense + special teams. The raw measure of output — higher is generally better, but it doesn't capture efficiency: a team can pile up yards without scoring.",
                },
                {
                  label: "Turnover margin",
                  key: "turnoverMargin" as const,
                  baseline: 0,
                  description:
                    "Takeaways minus giveaways. Positive (above the dashed line) means they gained the ball more than they lost it — one of the strongest single predictors of winning, since turnovers hand the opponent free scoring chances.",
                },
                // CFB's archive has no EPA figure (ESPN's box score doesn't publish it), so
                // every point is exactly 0 — a flat, uninformative line, not a real trend.
                // Only include this chart when at least one game actually has a nonzero value.
                ...(analysis.statTrend.some((p) => p.offEpa !== 0)
                  ? [
                      {
                        label: "Offensive EPA",
                        key: "offEpa" as const,
                        baseline: 0,
                        description:
                          "Expected Points Added per play, summed across the game. Positive (above the dashed line) means the offense added value on average; negative means it lost value relative to what an average play would do in that situation.",
                      },
                    ]
                  : []),
              ].map(({ label, key, baseline, description }) => (
                <div key={key} className="mb-4 last:mb-0">
                  <div className="mb-1 text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                    {label}
                  </div>
                  <p className="mb-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
                    {description}
                  </p>
                  <LineChart
                    ariaLabel={`${label} trend for ${team}`}
                    baseline={baseline}
                    yFormat={(v) => v.toFixed(key === "totalYards" ? 0 : 1)}
                    xFormat={(v) => fmtDate(new Date(v).toISOString())}
                    series={[
                      {
                        label: team,
                        color: "var(--series-1)",
                        points: analysis.statTrend.slice(-RECENT_GAMES_SHOWN).map((p) => ({ x: new Date(p.date).getTime(), y: p[key] })),
                      },
                    ]}
                  />
                </div>
              ))}
            </div>
          )}

          <div className="rounded-lg border p-4" style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}>
            <h2 className="mb-1 text-sm font-medium" style={{ color: "var(--text-primary)" }}>
              Upcoming games
            </h2>
            <p className="mb-3 text-xs" style={{ color: "var(--text-muted)" }}>
              Same model as This Week and Research, scoped to just this team&apos;s next{" "}
              {SCHEDULE_LOOKAHEAD_DAYS[sport]} days. Margin/total are informational estimates only
              (typically ~8 and ~4 points off real market lines, respectively) — not a bet
              recommendation the way the moneyline edge is.
            </p>
            {analysis.upcoming.length === 0 && (
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                Nothing scheduled in that window right now.
              </p>
            )}
            <div className="flex flex-col gap-2">
              {analysis.upcoming.map((row, i) => (
                <div
                  key={i}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs"
                  style={{
                    borderColor: row.status === "edge" ? "var(--status-good)" : "var(--card-border)",
                  }}
                >
                  <span style={{ color: "var(--text-secondary)" }}>
                    {fmtKickoff(row.game.date)} — {row.isHome ? "vs" : "at"} {row.opponent}
                    {row.pTeam !== null && (
                      <> · model {(row.pTeam * 100).toFixed(0)}% {team}</>
                    )}
                    {row.teamMoneyline !== null && <> ({formatMoneyline(row.teamMoneyline)})</>}
                    {row.predictedMargin !== null && (
                      <> · {row.predictedMargin >= 0 ? `${team} -${row.predictedMargin.toFixed(1)}` : `${row.opponent} -${(-row.predictedMargin).toFixed(1)}`}</>
                    )}
                    {row.predictedTotal !== null && <> · O/U {row.predictedTotal.toFixed(1)}</>}
                  </span>
                  <span className="flex items-center gap-2">
                    {row.status === "edge" && (
                      <span className="rounded-full px-2 py-0.5 font-medium text-white" style={{ background: "var(--status-good)" }}>
                        edge
                      </span>
                    )}
                    {row.status === "flagged" && <span style={{ color: "var(--status-critical)" }}>flagged</span>}
                    {row.matchedOpponent ? (
                      <Link href={researchUrl(sport, row.isHome ? team : row.matchedOpponent, row.isHome ? row.matchedOpponent : team, row.game.espnId)} target="_blank" rel="noopener noreferrer" style={{ color: "var(--series-1)" }}>
                        Research →
                      </Link>
                    ) : (
                      <span style={{ color: "var(--text-muted)" }}>opponent not matched</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
