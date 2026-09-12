/**
 * Cross-references today's/this week's live matchups (liveOdds.ts) against
 * the curated situational trends, so a visitor can see which trends apply
 * to a team RIGHT NOW without re-deriving anything themselves — the
 * "don't have to double research a trend someone else has found" idea,
 * applied to our own curated list plus whatever they've saved.
 *
 * Scoped to what's actually knowable before kickoff from live odds alone:
 * home/away and favorite/underdog (from the consensus spread's sign). Real
 * division-game/rest/weather situations need data this app has no live
 * feed for (division membership isn't modeled at all; rest/weather are
 * only ever computed retrospectively for completed games), so those
 * situations are deliberately left out here rather than guessed at.
 */

import { Sport } from "./espn";
import { LiveOddsGame, consensusSpread } from "./liveOdds";
import { resolveOddsApiTeamName } from "./teamMatch";

export interface TodaysTeamTrend {
  /** Historical-archive team name — feed straight into buildCustomSituation's `team` or a Team Command Page link. */
  team: string;
  displayTeam: string;
  isHome: boolean;
  /** Which curated Situation id (situationalTrends.ts) applies to this team in this game — null if the consensus spread is a pick'em or unavailable. */
  situationId: "home-favorite" | "home-underdog" | "road-favorite" | "road-underdog" | null;
}

export interface TodaysGameTrends {
  eventId: string;
  commenceTime: string;
  home: TodaysTeamTrend | null;
  away: TodaysTeamTrend | null;
}

export function buildTodaysGameTrends(sport: Sport, liveGames: LiveOddsGame[], knownTeams: ReadonlySet<string>): TodaysGameTrends[] {
  return liveGames.map((g) => {
    const homeTeam = resolveOddsApiTeamName(sport, g.homeTeam, knownTeams);
    const awayTeam = resolveOddsApiTeamName(sport, g.awayTeam, knownTeams);
    const spread = consensusSpread(g); // positive = home favored

    const home: TodaysTeamTrend | null = homeTeam
      ? {
          team: homeTeam,
          displayTeam: g.homeTeam,
          isHome: true,
          situationId: spread === null || spread === 0 ? null : spread > 0 ? "home-favorite" : "home-underdog",
        }
      : null;
    const away: TodaysTeamTrend | null = awayTeam
      ? {
          team: awayTeam,
          displayTeam: g.awayTeam,
          isHome: false,
          situationId: spread === null || spread === 0 ? null : spread > 0 ? "road-underdog" : "road-favorite",
        }
      : null;

    return { eventId: g.eventId, commenceTime: g.commenceTime, home, away };
  });
}
