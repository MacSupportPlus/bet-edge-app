/**
 * Assembles the win-probability model's feature vector the SAME way
 * everywhere it's built — extracted because this exact array had already
 * drifted into several independent hand-written copies (TeamPage,
 * WeeklyEdges, GameResearch, PicksPage, ProbabilityModel) before
 * qbValueDiff was added as a 5th feature. Training and live-prediction
 * calls for the same fitted model MUST produce identically-shaped,
 * identically-ordered arrays — that invariant is the entire point of
 * routing every call site through this one function instead of four
 * separately-maintained copies.
 *
 * Feature order: [eloDiff, (totalYardsDiff, turnoverMarginDiff, offEpaDiff
 * if team stats exist at all for this sport), (qbValueDiff if the QB signal
 * is enabled for this sport)] — `hasTeamStats`/`hasQbValue` are dataset-wide
 * flags (decided once per sport/session), not per-row, since every row fed
 * to the same trained model must have the same feature-vector length.
 */

import { NEUTRAL_QB_VALUE_FEATURES, QbValueFeatures } from "./qbValue";
import { NEUTRAL_TEAM_STAT_FEATURES, TeamStatFeatures } from "./teamStats";

export interface ModelFeatureInputs {
  eloDiff: number;
  /** Null = this specific row has no team-stat data (e.g. no gameId), NOT the same as team stats being unavailable for the whole sport — see `hasTeamStats`. */
  teamStats: TeamStatFeatures | null;
  /** Null = this specific row's QB signal is unavailable (unidentified starter), NOT the same as QB value being unavailable for the whole sport — see `hasQbValue`. */
  qbValue: QbValueFeatures | null;
}

export function buildFeatureVector(inputs: ModelFeatureInputs, hasTeamStats: boolean, hasQbValue: boolean): number[] {
  const features = [inputs.eloDiff];
  if (hasTeamStats) {
    const f = inputs.teamStats ?? NEUTRAL_TEAM_STAT_FEATURES;
    features.push(f.totalYardsDiff, f.turnoverMarginDiff, f.offEpaDiff);
  }
  if (hasQbValue) {
    const f = inputs.qbValue ?? NEUTRAL_QB_VALUE_FEATURES;
    features.push(f.qbValueDiff);
  }
  return features;
}
