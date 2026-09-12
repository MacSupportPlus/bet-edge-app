/**
 * Closing Line Value (CLV) — the standard long-run skill signal among sharp
 * bettors: did your price beat the closing line? A bettor who consistently
 * gets a better number than the close tends to be profitable even before
 * looking at win/loss results, since the closing line is the market's best,
 * most-informed estimate — beating it means you (or your timing) added
 * information the market hadn't priced in yet.
 *
 * Scoped to moneyline bets logged via the "Log this bet" flow for now (the
 * ones with a parseable description AND homeTeam/awayTeam on file — see
 * bankroll.ts) — the same reachability boundary as auto-settlement's
 * moneyline path. Spread/total CLV would need those bets' "Log this bet"
 * links wired up too, not yet done.
 */

import { parseLoggedBetDescription } from "./autoGradeBets";
import { BetEntry } from "./bankroll";
import { ClosingLine } from "./closingLines";
import { moneylineToDecimalB } from "./espn";

export interface ClvResult {
  side: "home" | "away";
  yourB: number;
  closingB: number;
  yourImplied: number;
  closingImplied: number;
  /** closingImplied - yourImplied, in probability points. Positive means you got a better price than the close (the market moved toward your side afterward) — the standard definition of positive CLV. */
  clvPoints: number;
  beatClose: boolean;
}

/** Null if this bet isn't a parseable moneyline pick, doesn't carry homeTeam/awayTeam, or the picked team doesn't match either side of the closing line. */
export function computeClv(bet: BetEntry, closingLine: ClosingLine): ClvResult | null {
  const parsed = parseLoggedBetDescription(bet.description);
  if (!parsed || !bet.homeTeam || !bet.awayTeam) return null;

  const side = parsed.pickedTeam === bet.homeTeam ? "home" : parsed.pickedTeam === bet.awayTeam ? "away" : null;
  if (!side) return null;

  const closingMoneyline = side === "home" ? closingLine.homeMoneylineClose : closingLine.awayMoneylineClose;
  const closingB = moneylineToDecimalB(closingMoneyline);
  const yourB = bet.b;
  const yourImplied = 1 / (1 + yourB);
  const closingImplied = 1 / (1 + closingB);
  const clvPoints = closingImplied - yourImplied;

  return { side, yourB, closingB, yourImplied, closingImplied, clvPoints, beatClose: clvPoints > 0 };
}
