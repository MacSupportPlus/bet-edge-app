"use client";

import { useEffect, useMemo, useState } from "react";
import { Game } from "@/lib/elo";
import { Sport } from "@/lib/espn";
import { NflGameContext, loadNflGameContext } from "@/lib/gameContext";
import { CfbGameContext, loadCfbGameContext } from "@/lib/cfbGameContext";
import { CfbMarketLines, loadCfbMarketLines } from "@/lib/cfbMarketLines";
import { buildCustomSituation, CustomFilters, DEFAULT_CUSTOM_FILTERS, LocationFilter, RestFilter, RoleFilter, RoofFilter, TriState, WeatherFilter } from "@/lib/customTrends";
import { loadGames } from "@/lib/loadGames";
import { loadLiveOdds } from "@/lib/liveOdds";
import { isTrendSaved, removeSavedTrend, SAVED_TRENDS_KEY, SavedTrend, SavedTrendDescriptor, toggleSavedTrend } from "@/lib/savedTrends";
import { AtsStats, computeSituationStats, MIN_TRUSTED_SAMPLE, SITUATIONS, SituationStats, TotalStats, TrendGameRecord } from "@/lib/situationalTrends";
import { teamPresetFilters, TEAM_TREND_PRESETS } from "@/lib/teamTrendPresets";
import { buildTodaysGameTrends, TodaysGameTrends } from "@/lib/todaysTrends";
import { buildCfbTrendRecords, buildNflTrendRecords } from "@/lib/trendRecords";
import { SPORT_LABELS } from "@/lib/sportConfig";
import { useLocalStorageState } from "@/lib/useLocalStorageState";
import { Callout } from "./Callout";
import { TeamAutocomplete } from "./TeamAutocomplete";
import { TrendSparkline } from "./TrendSparkline";

interface Snapshot {
  sport: Sport;
  games: Game[];
  nflContext: Map<string, NflGameContext> | null;
  cfbMarketLines: Map<string, CfbMarketLines> | null;
  cfbContext: Map<string, CfbGameContext> | null;
  error: string | null;
}

function fmtPct(v: number): string {
  return Number.isNaN(v) ? "—" : `${(v * 100).toFixed(1)}%`;
}
function fmtSigned(v: number, decimals = 1): string {
  return Number.isNaN(v) ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(decimals)}`;
}

interface DisplayStats {
  record: string;
  rateLabel: string;
  rate: number;
  avgVsLine: number;
}

function atsDisplay(ats: AtsStats): DisplayStats {
  return {
    record: `${ats.covers}-${ats.losses}${ats.pushes ? `-${ats.pushes}` : ""}`,
    rateLabel: "Cover rate",
    rate: ats.coverRate,
    avgVsLine: ats.avgMarginVsLine,
  };
}

function totalDisplay(total: TotalStats): DisplayStats {
  return {
    record: `${total.overs}-${total.unders}${total.pushes ? `-${total.pushes}` : ""}`,
    rateLabel: "Over rate",
    rate: total.overRate,
    avgVsLine: total.avgTotalVsLine,
  };
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: "good" | "critical" }) {
  return (
    <div>
      <div className="text-sm font-semibold tabular-nums" style={{ color: accent ? `var(--status-${accent})` : "var(--text-primary)" }}>
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
        {label}
      </div>
    </div>
  );
}

/** A star toggle for saving a trend — purpose-built rather than reusing FavoriteStar (which is shaped for team/player, not an arbitrary trend descriptor). */
function SaveTrendButton({ saved, onToggle }: { saved: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-label={saved ? "Remove from My Trends" : "Save to My Trends"}
      aria-pressed={saved}
      title={saved ? "Remove from My Trends" : "Save to My Trends"}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className="shrink-0 text-base leading-none transition-transform hover:scale-110"
      style={{ color: saved ? "var(--series-2)" : "var(--text-muted)" }}
    >
      {saved ? "★" : "☆"}
    </button>
  );
}

/** One market's worth of a trend, in TrendsCenter's own card format (record/ROI/win-rate/units/streak/last-10/games/years, plus a performance sparkline) — but honest about sample size instead of hiding it behind an opaque score. */
function TrendCard({
  title,
  subtitle,
  marketLabel,
  sport,
  stats,
  display,
  saved,
  onToggleSave,
}: {
  title: string;
  subtitle?: string;
  marketLabel: string;
  sport: Sport;
  stats: AtsStats | TotalStats;
  display: DisplayStats;
  saved?: boolean;
  onToggleSave?: () => void;
}) {
  return (
    <div
      className="rounded-lg border p-4"
      style={{ background: "var(--card-bg)", borderColor: stats.trusted ? "var(--status-good)" : "var(--card-border)" }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              {title}
            </span>
            {onToggleSave && <SaveTrendButton saved={!!saved} onToggle={onToggleSave} />}
          </div>
          <div className="text-xs" style={{ color: "var(--text-muted)" }}>
            {subtitle ?? `${SPORT_LABELS[sport]} · ${marketLabel}`}
          </div>
        </div>
        {!stats.trusted && (
          <span className="shrink-0 rounded-full px-2 py-0.5 text-xs" style={{ background: "var(--gridline)", color: "var(--text-secondary)" }}>
            small sample
          </span>
        )}
      </div>

      <div className="mt-3 grid grid-cols-4 gap-y-3">
        <Stat label="Record" value={display.record} />
        <Stat label="ROI" value={fmtPct(stats.roi / 100)} accent={stats.roi > 0 ? "good" : stats.roi < 0 ? "critical" : undefined} />
        <Stat label={display.rateLabel} value={fmtPct(display.rate)} />
        <Stat label="Units" value={`${fmtSigned(stats.units)}u`} accent={stats.units > 0 ? "good" : stats.units < 0 ? "critical" : undefined} />
        <Stat label="Streak" value={stats.currentStreak > 0 ? `W${stats.currentStreak}` : "—"} />
        <Stat label="Last 10" value={`${stats.last10.wins}-${stats.last10.losses}${stats.last10.pushes ? `-${stats.last10.pushes}` : ""}`} />
        <Stat label="Games" value={String(stats.n)} />
        <Stat label="Years" value={String(stats.years)} />
      </div>

      <div className="mt-3">
        <TrendSparkline values={stats.cumulativeUnits} />
      </div>

      <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
        Avg vs. line: {fmtSigned(display.avgVsLine)} pts.
      </p>
    </div>
  );
}

export function SituationalTrends({ sport }: { sport: Sport }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetches: Promise<unknown>[] =
      sport === "nfl" ? [loadGames(sport), loadNflGameContext()] : [loadGames(sport), loadCfbMarketLines(), loadCfbGameContext()];
    Promise.all(fetches)
      .then((results) => {
        if (cancelled) return;
        if (sport === "nfl") {
          const [games, nflContext] = results as [Game[], Map<string, NflGameContext>];
          setSnapshot({ sport, games, nflContext, cfbMarketLines: null, cfbContext: null, error: null });
        } else {
          const [games, cfbMarketLines, cfbContext] = results as [Game[], Map<string, CfbMarketLines>, Map<string, CfbGameContext>];
          setSnapshot({ sport, games, nflContext: null, cfbMarketLines, cfbContext, error: null });
        }
      })
      .catch((e) => {
        if (!cancelled) setSnapshot({ sport, games: [], nflContext: null, cfbMarketLines: null, cfbContext: null, error: String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [sport]);

  const loading = snapshot === null || snapshot.sport !== sport;

  const records = useMemo((): TrendGameRecord[] | null => {
    if (loading || !snapshot || snapshot.error || snapshot.games.length === 0) return null;
    return sport === "nfl"
      ? buildNflTrendRecords(snapshot.games, snapshot.nflContext ?? new Map())
      : buildCfbTrendRecords(snapshot.games, snapshot.cfbMarketLines ?? new Map(), snapshot.cfbContext ?? new Map());
  }, [snapshot, loading, sport]);

  const rows = useMemo((): SituationStats[] | null => {
    if (!records) return null;
    return SITUATIONS.filter((s) => s.sports.includes(sport)).map((s) => computeSituationStats(records, s));
  }, [records, sport]);

  const knownTeams = useMemo(() => {
    const set = new Set<string>();
    for (const r of records ?? []) {
      set.add(r.homeTeam);
      set.add(r.awayTeam);
    }
    return [...set].sort();
  }, [records]);

  const [tab, setTab] = useState<"trusted" | "team" | "today" | "custom" | "saved">("trusted");
  const [filters, setFilters] = useState<CustomFilters>(DEFAULT_CUSTOM_FILTERS);
  const [teamDraft, setTeamDraft] = useState("");
  const [teamTrendsDraft, setTeamTrendsDraft] = useState("");

  const [saved, setSaved] = useLocalStorageState<SavedTrend[]>(SAVED_TRENDS_KEY, []);
  function toggleSave(descriptor: SavedTrendDescriptor) {
    setSaved((prev) => toggleSavedTrend(prev, descriptor));
  }

  // Reset the filter/team draft when switching sport so a CFB team name
  // doesn't linger as a (silently non-matching) filter after switching to NFL.
  useEffect(() => {
    setFilters(DEFAULT_CUSTOM_FILTERS);
    setTeamDraft("");
    setTeamTrendsDraft("");
  }, [sport]);

  const [todaysGames, setTodaysGames] = useState<{ sport: Sport; games: TodaysGameTrends[]; fetchedAt: string } | null>(null);
  useEffect(() => {
    if (!records) return;
    let cancelled = false;
    const known = new Set(records.flatMap((r) => [r.homeTeam, r.awayTeam]));
    loadLiveOdds(sport).then((result) => {
      if (cancelled) return;
      setTodaysGames({ sport, games: buildTodaysGameTrends(sport, [...result.byMatchup.values()], known), fetchedAt: result.fetchedAt });
    });
    return () => {
      cancelled = true;
    };
  }, [sport, records]);
  const todaysGamesForSport = todaysGames?.sport === sport ? todaysGames.games : null;

  const customStats = useMemo((): SituationStats | null => {
    if (!records) return null;
    return computeSituationStats(records, buildCustomSituation(filters));
  }, [records, filters]);

  const rowsById = useMemo(() => new Map((rows ?? []).map((r) => [r.situationId, r])), [rows]);

  const teamTrendResults = useMemo(() => {
    if (!records || !teamTrendsDraft || !knownTeams.includes(teamTrendsDraft)) return null;
    return TEAM_TREND_PRESETS.filter((p) => p.sports.includes(sport)).map((preset) => ({
      preset,
      stats: computeSituationStats(records, buildCustomSituation(teamPresetFilters(teamTrendsDraft, preset))),
    }));
  }, [records, teamTrendsDraft, knownTeams, sport]);

  const customLabel = useMemo(() => {
    const parts: string[] = [];
    if (filters.team) parts.push(filters.team);
    if (filters.role !== "any") parts.push(filters.role);
    if (filters.location !== "any") parts.push(filters.location);
    if (filters.divisionGame !== "any") parts.push(filters.divisionGame === "yes" ? "division game" : "non-division game");
    if (filters.rest !== "any") parts.push(`${filters.rest} rest`);
    if (filters.roof !== "any") parts.push(filters.roof);
    if (filters.weather !== "any") parts.push(filters.weather);
    return parts.length > 0 ? parts.join(", ") : "Custom (no filters)";
  }, [filters]);

  const filterSentences = useMemo(() => {
    const s: string[] = [];
    if (filters.team) s.push(`The team is the ${filters.team}.`);
    if (filters.role !== "any") s.push(`The team is the ${filters.role}.`);
    if (filters.location !== "any") s.push(`The team is playing at ${filters.location}.`);
    if (filters.divisionGame !== "any") s.push(`The game is${filters.divisionGame === "no" ? " not" : ""} a division/conference game.`);
    if (filters.rest === "short") s.push("The team is on short rest (≤6 days).");
    if (filters.rest === "extra") s.push("The team has extra rest (≥9 days).");
    if (filters.roof === "dome") s.push("The game is in a dome or closed roof.");
    if (filters.roof === "outdoor") s.push("The game is outdoors.");
    if (filters.weather === "cold") s.push("The temperature is below 40°F.");
    if (filters.weather === "wind") s.push("Wind is above 15 mph.");
    return s;
  }, [filters]);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-10">
      <div>
        <h1 className="text-2xl font-semibold" style={{ color: "var(--text-primary)" }}>
          Situational Trends — {SPORT_LABELS[sport]}
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
          Every result here is measured against the REAL closing spread/total, not a flat 50% —
          the line already prices in team quality, so a real deviation from it (not just "good
          teams cover more") is what a genuine situational edge looks like.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["trusted", "Trusted Trends"],
            ["team", "Team Trends"],
            ["today", "Today"],
            ["custom", "Build Your Own"],
            ["saved", "My Trends"],
          ] as const
        ).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="rounded-full border px-3 py-1.5 text-sm transition-colors"
            style={{
              borderColor: t === tab ? "var(--series-1)" : "var(--card-border)",
              background: t === tab ? "var(--series-1)" : "transparent",
              color: t === tab ? "white" : "var(--text-secondary)",
            }}
          >
            {label}
            {t === "saved" && saved.filter((s) => s.descriptor.sport === sport).length > 0 && (
              <span className="ml-1.5 text-xs opacity-80">({saved.filter((s) => s.descriptor.sport === sport).length})</span>
            )}
          </button>
        ))}
      </div>

      {loading && (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Loading historical archive…
        </p>
      )}
      {snapshot?.error && (
        <div className="rounded-lg border px-4 py-3 text-sm" style={{ borderColor: "var(--status-critical)", color: "var(--status-critical)" }}>
          Couldn&apos;t load trend data: {snapshot.error}
        </div>
      )}

      {tab === "trusted" && (
        <Callout kind="warning">
          A trend needs at least {MIN_TRUSTED_SAMPLE} decided games before it&apos;s marked{" "}
          <strong>trusted</strong> (a green border below) — below that, a cover rate away from 50%
          is not statistically distinguishable from chance, no matter how dramatic the record
          looks. &quot;Units&quot; and &quot;ROI&quot; assume a flat 1-unit bet at standard -110 odds
          on every qualifying game (we don&apos;t have a historical per-game price archive) — a real,
          disclosed approximation, not hidden in fine print.
        </Callout>
      )}

      {tab === "trusted" && rows && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {rows.flatMap((r) => {
            const curatedDescriptor: SavedTrendDescriptor = { kind: "curated", sport, situationId: r.situationId };
            const cards = [];
            if (r.ats) {
              cards.push(
                <TrendCard
                  key={`${r.situationId}-ats`}
                  title={r.label}
                  marketLabel="Spread bet"
                  sport={sport}
                  stats={r.ats}
                  display={atsDisplay(r.ats)}
                  saved={isTrendSaved(saved, curatedDescriptor)}
                  onToggleSave={() => toggleSave(curatedDescriptor)}
                />,
              );
            }
            if (r.total) {
              cards.push(
                <TrendCard
                  key={`${r.situationId}-total`}
                  title={r.label}
                  marketLabel="Total (O/U) bet"
                  sport={sport}
                  stats={r.total}
                  display={totalDisplay(r.total)}
                  saved={isTrendSaved(saved, curatedDescriptor)}
                  onToggleSave={() => toggleSave(curatedDescriptor)}
                />,
              );
            }
            return cards;
          })}
        </div>
      )}

      {tab === "trusted" && (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Every card is from the labeled side&apos;s own perspective (e.g. &quot;Home favorites&quot;
          counts only how home favorites did against the spread).
          {sport === "cfb" && " College football's rest/weather columns aren't available, so those situations only appear for NFL."}
        </p>
      )}

      {tab === "custom" && !loading && !snapshot?.error && (
        <>
          <Callout kind="tip">
            Combine your own filters below — every combination still runs through the same{" "}
            {MIN_TRUSTED_SAMPLE}-game trust gate and the same ROI/units math as the curated list, so
            a thin custom slice reads as &quot;small sample,&quot; not a false edge.
          </Callout>

          <div className="grid grid-cols-1 gap-3 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-3" style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}>
            <label className="flex flex-col gap-1 text-sm">
              <span style={{ color: "var(--text-secondary)" }}>Team (optional)</span>
              <TeamAutocomplete
                value={teamDraft}
                onChange={(v) => {
                  setTeamDraft(v);
                  setFilters((f) => ({ ...f, team: knownTeams.includes(v) ? v : null }));
                }}
                options={knownTeams}
                placeholder="Any team"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span style={{ color: "var(--text-secondary)" }}>Role</span>
              <select
                value={filters.role}
                onChange={(e) => setFilters((f) => ({ ...f, role: e.target.value as RoleFilter }))}
                className="rounded-md border px-2 py-1.5"
                style={{ borderColor: "var(--card-border)", background: "var(--background)", color: "var(--text-primary)" }}
              >
                <option value="any">Any</option>
                <option value="favorite">Favorite</option>
                <option value="underdog">Underdog</option>
              </select>
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span style={{ color: "var(--text-secondary)" }}>Location</span>
              <select
                value={filters.location}
                onChange={(e) => setFilters((f) => ({ ...f, location: e.target.value as LocationFilter }))}
                className="rounded-md border px-2 py-1.5"
                style={{ borderColor: "var(--card-border)", background: "var(--background)", color: "var(--text-primary)" }}
              >
                <option value="any">Any</option>
                <option value="home">Home</option>
                <option value="away">Away</option>
              </select>
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span style={{ color: "var(--text-secondary)" }}>Division/conference game</span>
              <select
                value={filters.divisionGame}
                onChange={(e) => setFilters((f) => ({ ...f, divisionGame: e.target.value as TriState }))}
                className="rounded-md border px-2 py-1.5"
                style={{ borderColor: "var(--card-border)", background: "var(--background)", color: "var(--text-primary)" }}
              >
                <option value="any">Any</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </label>

            {sport === "nfl" && (
              <>
                <label className="flex flex-col gap-1 text-sm">
                  <span style={{ color: "var(--text-secondary)" }}>Rest</span>
                  <select
                    value={filters.rest}
                    onChange={(e) => setFilters((f) => ({ ...f, rest: e.target.value as RestFilter }))}
                    className="rounded-md border px-2 py-1.5"
                    style={{ borderColor: "var(--card-border)", background: "var(--background)", color: "var(--text-primary)" }}
                  >
                    <option value="any">Any</option>
                    <option value="short">Short (≤6 days)</option>
                    <option value="extra">Extra (≥9 days)</option>
                  </select>
                </label>

                <label className="flex flex-col gap-1 text-sm">
                  <span style={{ color: "var(--text-secondary)" }}>Roof</span>
                  <select
                    value={filters.roof}
                    onChange={(e) => setFilters((f) => ({ ...f, roof: e.target.value as RoofFilter }))}
                    className="rounded-md border px-2 py-1.5"
                    style={{ borderColor: "var(--card-border)", background: "var(--background)", color: "var(--text-primary)" }}
                  >
                    <option value="any">Any</option>
                    <option value="dome">Dome/closed</option>
                    <option value="outdoor">Outdoor</option>
                  </select>
                </label>

                <label className="flex flex-col gap-1 text-sm">
                  <span style={{ color: "var(--text-secondary)" }}>Weather</span>
                  <select
                    value={filters.weather}
                    onChange={(e) => setFilters((f) => ({ ...f, weather: e.target.value as WeatherFilter }))}
                    className="rounded-md border px-2 py-1.5"
                    style={{ borderColor: "var(--card-border)", background: "var(--background)", color: "var(--text-primary)" }}
                  >
                    <option value="any">Any</option>
                    <option value="cold">Cold, &lt;40°F</option>
                    <option value="wind">High wind, &gt;15mph</option>
                  </select>
                </label>
              </>
            )}
          </div>

          <div className="rounded-lg border p-4 text-sm" style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}>
            <div className="mb-1 text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
              Criteria
            </div>
            {filterSentences.length === 0 ? (
              <p style={{ color: "var(--text-secondary)" }}>No filters applied — every game counts.</p>
            ) : (
              <ul className="flex flex-col gap-1" style={{ color: "var(--text-secondary)" }}>
                {filterSentences.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {customStats?.ats ? (
              <TrendCard
                title="Custom — ATS"
                marketLabel="Spread bet"
                sport={sport}
                stats={customStats.ats}
                display={atsDisplay(customStats.ats)}
                saved={isTrendSaved(saved, { kind: "custom", sport, label: customLabel, filters })}
                onToggleSave={() => toggleSave({ kind: "custom", sport, label: customLabel, filters })}
              />
            ) : (
              <div className="rounded-lg border p-4 text-sm" style={{ background: "var(--card-bg)", borderColor: "var(--card-border)", color: "var(--text-muted)" }}>
                No games match this combination for the spread market.
              </div>
            )}
            {customStats?.total ? (
              <TrendCard
                title="Custom — O/U"
                marketLabel="Total bet"
                sport={sport}
                stats={customStats.total}
                display={totalDisplay(customStats.total)}
                saved={isTrendSaved(saved, { kind: "custom", sport, label: customLabel, filters })}
                onToggleSave={() => toggleSave({ kind: "custom", sport, label: customLabel, filters })}
              />
            ) : (
              <div className="rounded-lg border p-4 text-sm" style={{ background: "var(--card-bg)", borderColor: "var(--card-border)", color: "var(--text-muted)" }}>
                No games match this combination for the total market.
              </div>
            )}
          </div>
        </>
      )}

      {tab === "team" && !loading && !snapshot?.error && (
        <>
          <Callout kind="tip">
            Pick a team to run every angle worth checking against them at once — the same math and
            trust gate as everywhere else, just pre-scoped to one team instead of building each
            combination by hand.
          </Callout>

          <label className="flex max-w-sm flex-col gap-1 text-sm">
            <span style={{ color: "var(--text-secondary)" }}>Team</span>
            <TeamAutocomplete value={teamTrendsDraft} onChange={setTeamTrendsDraft} options={knownTeams} placeholder="Type a team name…" />
          </label>

          {!teamTrendResults && teamTrendsDraft && (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              &quot;{teamTrendsDraft}&quot; isn&apos;t in the {SPORT_LABELS[sport]} archive.
            </p>
          )}

          {teamTrendResults && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {teamTrendResults.flatMap(({ preset, stats }) => {
                const descriptor: SavedTrendDescriptor = {
                  kind: "custom",
                  sport,
                  label: `${teamTrendsDraft} — ${preset.label}`,
                  filters: teamPresetFilters(teamTrendsDraft, preset),
                };
                const cards = [];
                if (stats.ats) {
                  cards.push(
                    <TrendCard
                      key={`${preset.id}-ats`}
                      title={`${teamTrendsDraft} — ${preset.label}`}
                      marketLabel="Spread bet"
                      sport={sport}
                      stats={stats.ats}
                      display={atsDisplay(stats.ats)}
                      saved={isTrendSaved(saved, descriptor)}
                      onToggleSave={() => toggleSave(descriptor)}
                    />,
                  );
                }
                if (stats.total) {
                  cards.push(
                    <TrendCard
                      key={`${preset.id}-total`}
                      title={`${teamTrendsDraft} — ${preset.label}`}
                      marketLabel="Total (O/U) bet"
                      sport={sport}
                      stats={stats.total}
                      display={totalDisplay(stats.total)}
                      saved={isTrendSaved(saved, descriptor)}
                      onToggleSave={() => toggleSave(descriptor)}
                    />,
                  );
                }
                return cards;
              })}
            </div>
          )}
        </>
      )}

      {tab === "today" && !loading && !snapshot?.error && (
        <>
          <Callout kind="tip">
            Every team playing in a game with a posted line right now, matched against the curated
            trend for their exact home/away + favorite/underdog situation — so you can see what
            applies before kickoff without rebuilding it yourself. Division/rest/weather situations
            aren&apos;t shown here since there&apos;s no live feed for those ahead of game day.
          </Callout>

          {todaysGamesForSport === null && (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Loading live odds…
            </p>
          )}
          {todaysGamesForSport?.length === 0 && (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              No live odds on file right now — either nothing&apos;s posted lines yet, or the live-odds
              feed isn&apos;t configured (see the Guide).
            </p>
          )}

          {todaysGamesForSport && todaysGamesForSport.length > 0 && (
            <div className="flex flex-col gap-4">
              {todaysGamesForSport.map((g) => (
                <div key={g.eventId} className="rounded-lg border p-4" style={{ background: "var(--card-bg)", borderColor: "var(--card-border)" }}>
                  <div className="mb-3 text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                    {g.away?.displayTeam ?? "?"} @ {g.home?.displayTeam ?? "?"} —{" "}
                    {new Date(g.commenceTime).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {[g.away, g.home].map((team, i) => {
                      if (!team) return <div key={i} className="text-xs" style={{ color: "var(--text-muted)" }}>Team not matched to the archive.</div>;
                      const r = team.situationId ? rowsById.get(team.situationId) : null;
                      const curatedDescriptor: SavedTrendDescriptor | null = team.situationId ? { kind: "curated", sport, situationId: team.situationId } : null;
                      return (
                        <div key={team.team} className="flex flex-col gap-2">
                          <div className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                            {team.displayTeam} ({team.isHome ? "home" : "away"}
                            {team.situationId ? `, ${team.situationId.includes("favorite") ? "favorite" : "underdog"}` : ", line not posted"})
                          </div>
                          {r?.ats && curatedDescriptor ? (
                            <TrendCard
                              title={r.label}
                              marketLabel="Spread bet"
                              sport={sport}
                              stats={r.ats}
                              display={atsDisplay(r.ats)}
                              saved={isTrendSaved(saved, curatedDescriptor)}
                              onToggleSave={() => toggleSave(curatedDescriptor)}
                            />
                          ) : (
                            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                              No consensus line yet to classify this team&apos;s situation.
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === "saved" && (
        <>
          {(() => {
            const savedForSport = saved.filter((s) => s.descriptor.sport === sport);
            const otherSportCount = saved.length - savedForSport.length;
            if (saved.length === 0) {
              return (
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                  Nothing saved yet — tap the star on any trend card to keep it here.
                </p>
              );
            }
            if (savedForSport.length === 0) {
              return (
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                  Nothing saved for {SPORT_LABELS[sport]} — {otherSportCount} saved for the other sport. Switch sport to see them.
                </p>
              );
            }
            return (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {savedForSport.flatMap((s) => {
                  if (!records) return [];
                  const descriptor = s.descriptor;
                  const stats =
                    descriptor.kind === "curated"
                      ? computeSituationStats(records, SITUATIONS.find((sit) => sit.id === descriptor.situationId) ?? SITUATIONS[0])
                      : computeSituationStats(records, buildCustomSituation(descriptor.filters));
                  const title = descriptor.kind === "curated" ? (SITUATIONS.find((sit) => sit.id === descriptor.situationId)?.label ?? descriptor.situationId) : descriptor.label;
                  const cards = [];
                  if (stats.ats) {
                    cards.push(
                      <TrendCard
                        key={`${s.id}-ats`}
                        title={title}
                        marketLabel="Spread bet"
                        sport={sport}
                        stats={stats.ats}
                        display={atsDisplay(stats.ats)}
                        saved
                        onToggleSave={() => setSaved((prev) => removeSavedTrend(prev, s.id))}
                      />,
                    );
                  }
                  if (stats.total) {
                    cards.push(
                      <TrendCard
                        key={`${s.id}-total`}
                        title={title}
                        marketLabel="Total (O/U) bet"
                        sport={sport}
                        stats={stats.total}
                        display={totalDisplay(stats.total)}
                        saved
                        onToggleSave={() => setSaved((prev) => removeSavedTrend(prev, s.id))}
                      />,
                    );
                  }
                  return cards;
                })}
              </div>
            );
          })()}
        </>
      )}
    </div>
  );
}
