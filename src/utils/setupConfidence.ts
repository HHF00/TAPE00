import type { DetectedPattern, ScannedTicker } from '../shared/types.ts';

export type ConfidenceTier = 'High' | 'Solid' | 'Watch' | 'Low';

export interface SetupConfidenceResult {
  score: number;
  fitPoints: number;
  rvolPoints: number;
  trendPoints: number;
  tier: ConfidenceTier;
  hasPattern: boolean;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function computeSetupConfidence(
  ticker: ScannedTicker,
  activePattern?: DetectedPattern | null
): SetupConfidenceResult {
  const pat = activePattern !== undefined ? activePattern : ticker.primaryPattern;

  // 1. Pattern Fit Component (0 - 50 pts)
  let fitPoints = 0;
  if (pat) {
    const stageBonus = pat.stage === 'Breakout' ? 4 : pat.stage === 'Testing Level' ? 2 : 0;
    fitPoints = Math.round(clamp((pat.fitScore / 100) * 46 + stageBonus, 0, 50));
  }

  // 2. Relative Volume (RVOL) Strength Component (0 - 25 pts)
  const rvol = ticker.rvol;
  let baseRvolPts = 4;
  if (rvol >= 2.2) baseRvolPts = 23;
  else if (rvol >= 1.6) baseRvolPts = 19 + ((rvol - 1.6) / 0.6) * 4;
  else if (rvol >= 1.2) baseRvolPts = 14 + ((rvol - 1.2) / 0.4) * 5;
  else if (rvol >= 0.9) baseRvolPts = 9 + ((rvol - 0.9) / 0.3) * 5;
  else if (rvol >= 0.6) baseRvolPts = 4 + ((rvol - 0.6) / 0.3) * 5;

  const upDn = ticker.volumeAnalysis?.upDownVolumeRatio;
  let flowAdj = 0;
  if (upDn != null) {
    if (pat?.bias === 'Bearish') {
      if (upDn <= 0.85) flowAdj = 2;
      else if (upDn >= 1.25) flowAdj = -1;
    } else {
      if (upDn >= 1.2) flowAdj = 2;
      else if (upDn <= 0.78) flowAdj = -1;
    }
  }
  const rvolPoints = Math.round(clamp(baseRvolPts + flowAdj, 0, 25));

  // 3. Trend Alignment Component (0 - 25 pts, direction-aware)
  const isBearish = pat?.bias === 'Bearish';
  let maPts = 0;
  if (ticker.sma20 != null) {
    if (isBearish ? ticker.price < ticker.sma20 : ticker.price > ticker.sma20) maPts += 4;
  }
  if (ticker.sma50 != null) {
    if (isBearish ? ticker.price < ticker.sma50 : ticker.price > ticker.sma50) maPts += 4;
  }
  if (ticker.sma200 != null) {
    if (isBearish ? ticker.price < ticker.sma200 : ticker.price > ticker.sma200) maPts += 3;
  }
  if (ticker.sma20 != null && ticker.sma50 != null) {
    if (isBearish ? ticker.sma20 < ticker.sma50 : ticker.sma20 > ticker.sma50) maPts += 2;
  }

  let slopePts = 2;
  const slope = ticker.sma20SlopePct;
  if (slope != null) {
    if (isBearish) {
      if (slope <= -0.2) slopePts = 7;
      else if (slope <= -0.05) slopePts = 5;
      else if (slope < 0.05) slopePts = 2;
      else slopePts = 0;
    } else {
      if (slope >= 0.2) slopePts = 7;
      else if (slope >= 0.05) slopePts = 5;
      else if (slope > -0.05) slopePts = 2;
      else slopePts = 0;
    }
  }

  let rsiPts = 2;
  const rsi = ticker.rsi14;
  if (rsi != null) {
    if (isBearish) {
      if (rsi >= 28 && rsi <= 50) rsiPts = 5;
      else if ((rsi > 50 && rsi <= 60) || (rsi >= 22 && rsi < 28)) rsiPts = 3;
      else rsiPts = 1;
    } else {
      if (rsi >= 50 && rsi <= 72) rsiPts = 5;
      else if ((rsi >= 40 && rsi < 50) || (rsi > 72 && rsi <= 78)) rsiPts = 3;
      else rsiPts = 1;
    }
  }

  const trendPoints = Math.round(clamp(maPts + slopePts + rsiPts, 0, 25));
  const score = Math.round(clamp(fitPoints + rvolPoints + trendPoints, 0, 100));

  const tier: ConfidenceTier =
    score >= 80 ? 'High' : score >= 62 ? 'Solid' : score >= 42 ? 'Watch' : 'Low';

  return {
    score,
    fitPoints,
    rvolPoints,
    trendPoints,
    tier,
    hasPattern: Boolean(pat),
  };
}
