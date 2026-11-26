import type {
  DetectedPattern,
  HistoricalAnalogPoint,
  HistoricalPatternInstance,
  HistoricalPatternOutcome,
  OHLCVBar,
  PatternBias,
  PatternCategory,
  PatternLine,
  PatternPoint,
  PatternStage,
  PatternType,
  SeasonalityAnalysis,
  SeasonalityMonthStat,
  Timeframe,
  VolatilityAnalysis,
  VolumeAnalysis,
} from '../src/shared/types.ts';

interface SwingPoint {
  index: number;
  time: number;
  price: number;
}

interface RegressionResult {
  slope: number;
  intercept: number;
  r2: number;
  slopePctPerBar: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function enrichBarsWithIndicators(
  rawBars: Array<{
    time: number;
    dateLabel: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>
): {
  bars: OHLCVBar[];
  atrPct: number;
  avgVolume20: number;
  rvol: number;
  high52w: number;
  low52w: number;
  sma20SlopePct: number | null;
  sma20SlopeR2: number | null;
  sma20TrendPoints: number[];
} {
  const n = rawBars.length;
  const bars: OHLCVBar[] = new Array(n);

  // Wilder RSI(14)
  const rsiArr: Array<number | null> = new Array(n).fill(null);
  if (n > 14) {
    let gainSum = 0;
    let lossSum = 0;
    for (let i = 1; i <= 14; i++) {
      const diff = rawBars[i].close - rawBars[i - 1].close;
      if (diff >= 0) gainSum += diff;
      else lossSum -= diff;
    }
    let avgGain = gainSum / 14;
    let avgLoss = lossSum / 14;
    rsiArr[14] = avgLoss === 0 ? 100 : round2(100 - 100 / (1 + avgGain / avgLoss));
    for (let i = 15; i < n; i++) {
      const diff = rawBars[i].close - rawBars[i - 1].close;
      const gain = diff >= 0 ? diff : 0;
      const loss = diff < 0 ? -diff : 0;
      avgGain = (avgGain * 13 + gain) / 14;
      avgLoss = (avgLoss * 13 + loss) / 14;
      rsiArr[i] = avgLoss === 0 ? 100 : round2(100 - 100 / (1 + avgGain / avgLoss));
    }
  }

  const sma = (idx: number, period: number): number | null => {
    if (idx + 1 < period) return null;
    let sum = 0;
    for (let j = idx - period + 1; j <= idx; j++) {
      sum += rawBars[j].close;
    }
    return round2(sum / period);
  };

  const rollingVwap = (idx: number, period: number): number | null => {
    if (idx + 1 < period) return null;
    let pvSum = 0;
    let vSum = 0;
    for (let j = idx - period + 1; j <= idx; j++) {
      const tp = (rawBars[j].high + rawBars[j].low + rawBars[j].close) / 3;
      const vol = rawBars[j].volume > 0 ? rawBars[j].volume : 1;
      pvSum += tp * vol;
      vSum += vol;
    }
    return vSum > 0 ? round2(pvSum / vSum) : null;
  };

  const rawSma20Arr: Array<number | null> = new Array(n).fill(null);

  for (let i = 0; i < n; i++) {
    let rawSma20: number | null = null;
    if (i + 1 >= 20) {
      let sum = 0;
      for (let j = i - 19; j <= i; j++) sum += rawBars[j].close;
      rawSma20 = sum / 20;
    }
    rawSma20Arr[i] = rawSma20;
    bars[i] = {
      ...rawBars[i],
      open: round2(rawBars[i].open),
      high: round2(rawBars[i].high),
      low: round2(rawBars[i].low),
      close: round2(rawBars[i].close),
      sma20: rawSma20 != null ? round2(rawSma20) : null,
      sma50: sma(i, 50),
      sma200: sma(i, 200),
      vwap20: rollingVwap(i, 20),
      rsi14: rsiArr[i],
    };
  }

  // 20-period SMA slope via OLS regression over trailing 10 valid SMA20 bars
  const validSma20 = rawSma20Arr.filter((v): v is number => v != null && v > 0);
  const windowSma20 = validSma20.slice(-10);
  let sma20SlopePct: number | null = null;
  let sma20SlopeR2: number | null = null;
  const sma20TrendPoints = windowSma20.map((v) => Math.round(v * 10000) / 10000);

  if (windowSma20.length >= 3) {
    const k = windowSma20.length;
    const xMean = (k - 1) / 2;
    const yMean = windowSma20.reduce((sum, y) => sum + y, 0) / k;
    let num = 0;
    let den = 0;
    for (let x = 0; x < k; x++) {
      const dx = x - xMean;
      num += dx * (windowSma20[x] - yMean);
      den += dx * dx;
    }
    const slope = den > 0 ? num / den : 0;
    const intercept = yMean - slope * xMean;
    let ssTot = 0;
    let ssRes = 0;
    for (let x = 0; x < k; x++) {
      const pred = intercept + slope * x;
      ssTot += (windowSma20[x] - yMean) ** 2;
      ssRes += (windowSma20[x] - pred) ** 2;
    }
    const latestSma20 = windowSma20[k - 1];
    sma20SlopePct = latestSma20 > 0 ? Math.round(((slope / latestSma20) * 100) * 1000) / 1000 : 0;
    sma20SlopeR2 = ssTot > 1e-12 ? Math.round(clamp(1 - ssRes / ssTot, 0, 1) * 100) / 100 : 0;
  }

  // ATR(14)
  let atrSum = 0;
  const atrCount = Math.min(14, Math.max(1, n - 1));
  for (let i = Math.max(1, n - atrCount); i < n; i++) {
    const tr = Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - bars[i - 1].close),
      Math.abs(bars[i].low - bars[i - 1].close)
    );
    atrSum += tr;
  }
  const atr14 = atrSum / atrCount;
  const lastClose = bars[n - 1]?.close || 1;
  const atrPct = round2((atr14 / lastClose) * 100);

  // Average Volume 20 (excluding current bar if possible for fair RVOL comparison)
  const volLookbackEnd = n > 1 ? n - 1 : n;
  const volLookbackStart = Math.max(0, volLookbackEnd - 20);
  let volSum = 0;
  let volCount = 0;
  for (let i = volLookbackStart; i < volLookbackEnd; i++) {
    if (bars[i].volume > 0) {
      volSum += bars[i].volume;
      volCount++;
    }
  }
  const avgVolume20 = volCount > 0 ? Math.round(volSum / volCount) : bars[n - 1]?.volume || 0;
  const lastVol = bars[n - 1]?.volume || 0;
  const rvol = avgVolume20 > 0 ? round2(lastVol / avgVolume20) : 1;

  // 52w / available range high & low
  const rangeStart = Math.max(0, n - 252);
  let high52w = -Infinity;
  let low52w = Infinity;
  for (let i = rangeStart; i < n; i++) {
    if (bars[i].high > high52w) high52w = bars[i].high;
    if (bars[i].low < low52w) low52w = bars[i].low;
  }

  return {
    bars,
    atrPct,
    avgVolume20,
    rvol,
    high52w: round2(high52w),
    low52w: round2(low52w),
    sma20SlopePct,
    sma20SlopeR2,
    sma20TrendPoints,
  };
}

function findSwings(
  bars: OHLCVBar[],
  startIdx: number,
  endIdx: number,
  k: number
): { highs: SwingPoint[]; lows: SwingPoint[] } {
  const highs: SwingPoint[] = [];
  const lows: SwingPoint[] = [];

  const from = Math.max(startIdx + k, k);
  const to = Math.min(endIdx - k, bars.length - 1 - k);

  for (let i = from; i <= to; i++) {
    let isHigh = true;
    let isLow = true;
    for (let offset = -k; offset <= k; offset++) {
      if (offset === 0) continue;
      if (bars[i + offset].high > bars[i].high) isHigh = false;
      if (bars[i + offset].low < bars[i].low) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) {
      // Avoid duplicate adjacent ties
      const prev = highs[highs.length - 1];
      if (!prev || i - prev.index >= k) {
        highs.push({ index: i, time: bars[i].time, price: bars[i].high });
      }
    }
    if (isLow) {
      const prev = lows[lows.length - 1];
      if (!prev || i - prev.index >= k) {
        lows.push({ index: i, time: bars[i].time, price: bars[i].low });
      }
    }
  }

  return { highs, lows };
}

function fitRegression(points: SwingPoint[]): RegressionResult | null {
  if (points.length < 2) return null;
  const n = points.length;
  let sumX = 0;
  let sumY = 0;
  for (const p of points) {
    sumX += p.index;
    sumY += p.price;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  if (meanY <= 0) return null;

  let num = 0;
  let den = 0;
  for (const p of points) {
    const dx = p.index - meanX;
    num += dx * (p.price - meanY);
    den += dx * dx;
  }
  if (den === 0) return null;

  const slope = num / den;
  const intercept = meanY - slope * meanX;

  let ssRes = 0;
  let ssTot = 0;
  for (const p of points) {
    const pred = slope * p.index + intercept;
    ssRes += (p.price - pred) ** 2;
    ssTot += (p.price - meanY) ** 2;
  }
  const r2 = ssTot === 0 ? 1 : Math.max(0, 1 - ssRes / ssTot);
  const slopePctPerBar = (slope / meanY) * 100;

  return { slope, intercept, r2, slopePctPerBar };
}

function makePattern(params: {
  type: PatternType;
  category: PatternCategory;
  bias: PatternBias;
  stage: PatternStage;
  fitScore: number;
  startIndex: number;
  endIndex: number;
  lastClose: number;
  breakoutPrice: number;
  targetPrice: number;
  stopPrice: number;
  summary: string;
  criteria: string[];
  lines: PatternLine[];
  keyPivots: PatternPoint[];
}): DetectedPattern {
  const {
    type,
    category,
    bias,
    stage,
    fitScore,
    startIndex,
    endIndex,
    lastClose,
    breakoutPrice,
    targetPrice,
    stopPrice,
    summary,
    criteria,
    lines,
    keyPivots,
  } = params;

  const refPrice = lastClose > 0 ? lastClose : breakoutPrice;
  const rawTargetPct =
    bias === 'Bearish'
      ? ((refPrice - targetPrice) / refPrice) * 100
      : ((targetPrice - refPrice) / refPrice) * 100;
  const rawRiskPct =
    bias === 'Bearish'
      ? ((stopPrice - refPrice) / refPrice) * 100
      : ((refPrice - stopPrice) / refPrice) * 100;

  const targetPct = round2(Math.max(1.0, Math.abs(rawTargetPct)));
  const riskPct = round2(Math.max(0.8, Math.abs(rawRiskPct)));
  const riskReward = round2(targetPct / riskPct);
  const distanceToBreakoutPct = round2(((breakoutPrice - lastClose) / lastClose) * 100);

  return {
    id: `${type.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${startIndex}_${endIndex}`,
    type,
    category,
    bias,
    stage,
    fitScore: Math.round(clamp(fitScore, 55, 97)),
    startIndex,
    endIndex,
    breakoutPrice: round2(breakoutPrice),
    targetPrice: round2(targetPrice),
    stopPrice: round2(stopPrice),
    targetPct,
    riskPct,
    riskReward,
    distanceToBreakoutPct,
    summary,
    criteria,
    lines,
    keyPivots,
  };
}

function detectTrianglesAndWedges(bars: OHLCVBar[], rvol: number): DetectedPattern[] {
  const results: DetectedPattern[] = [];
  const n = bars.length;
  const lastIdx = n - 1;
  const lastClose = bars[lastIdx].close;
  const windows = [32, 48, 65];

  for (const win of windows) {
    if (n < win + 5) continue;
    const startIdx = n - win;
    const k = win <= 35 ? 2 : 3;
    const { highs, lows } = findSwings(bars, startIdx, lastIdx - 1, k);

    if (highs.length < 2 || lows.length < 2) continue;

    // Select the outer envelope points (at least 2, up to 4 most recent)
    const upperPts = highs.slice(-4);
    const lowerPts = lows.slice(-4);

    // Also evaluate flat-top / flat-bottom tolerance
    const upperReg = fitRegression(upperPts);
    const lowerReg = fitRegression(lowerPts);
    if (!upperReg || !lowerReg) continue;

    const lineStartIdx = Math.min(upperPts[0].index, lowerPts[0].index);
    const upperAtStart = upperReg.slope * lineStartIdx + upperReg.intercept;
    const lowerAtStart = lowerReg.slope * lineStartIdx + lowerReg.intercept;
    const upperNow = upperReg.slope * lastIdx + upperReg.intercept;
    const lowerNow = lowerReg.slope * lastIdx + lowerReg.intercept;

    const spreadStart = upperAtStart - lowerAtStart;
    const spreadNow = upperNow - lowerNow;

    if (spreadStart <= 0 || spreadNow <= 0) continue;
    // Must converge meaningfully
    if (spreadNow >= spreadStart * 0.84) continue;
    // Height sanity check (at least 2.5% range at start)
    if (spreadStart / lastClose < 0.025) continue;

    // Check bar containment before last 2 bars
    let insideCount = 0;
    const checkEnd = Math.max(lineStartIdx + 1, lastIdx - 2);
    const checkTotal = checkEnd - lineStartIdx + 1;
    for (let i = lineStartIdx; i <= checkEnd; i++) {
      const u = upperReg.slope * i + upperReg.intercept;
      const l = lowerReg.slope * i + lowerReg.intercept;
      if (bars[i].close <= u * 1.016 && bars[i].close >= l * 0.984) {
        insideCount++;
      }
    }
    const containment = checkTotal > 0 ? insideCount / checkTotal : 0;
    if (containment < 0.78) continue;

    // Current price shouldn't have blown far past apex
    if (lastClose > upperNow * 1.07 || lastClose < lowerNow * 0.93) continue;

    const uSlope = upperReg.slopePctPerBar;
    const lSlope = lowerReg.slopePctPerBar;
    const upperFlat = Math.abs(uSlope) <= 0.045;
    const lowerFlat = Math.abs(lSlope) <= 0.045;

    let type: PatternType | null = null;
    let category: PatternCategory = 'Triangles';
    let bias: PatternBias = 'Neutral';

    if (upperFlat && lSlope >= 0.045) {
      type = 'Ascending Triangle';
      bias = 'Bullish';
    } else if (lowerFlat && uSlope <= -0.045) {
      type = 'Descending Triangle';
      bias = 'Bearish';
    } else if (uSlope <= -0.04 && lSlope >= 0.04) {
      type = 'Symmetrical Triangle';
      bias = lastClose > upperNow ? 'Bullish' : lastClose < lowerNow ? 'Bearish' : 'Neutral';
    } else if (uSlope <= -0.055 && lSlope <= -0.015 && uSlope < lSlope * 1.15) {
      type = 'Falling Wedge';
      category = 'Wedges & Boxes';
      bias = 'Bullish';
    } else if (lSlope >= 0.055 && uSlope >= 0.015 && lSlope > uSlope * 1.15) {
      type = 'Rising Wedge';
      category = 'Wedges & Boxes';
      bias = 'Bearish';
    }

    if (!type) continue;

    // Determine stage & levels
    let stage: PatternStage = 'Forming';
    let breakoutPrice = upperNow;
    let targetPrice = upperNow + spreadStart;
    let stopPrice = Math.max(lowerNow, lowerPts[lowerPts.length - 1].price * 0.99);

    if (bias === 'Bearish') {
      breakoutPrice = lowerNow;
      targetPrice = Math.max(1, lowerNow - spreadStart);
      stopPrice = Math.min(upperNow, upperPts[upperPts.length - 1].price * 1.01);
      if (lastClose < lowerNow * 0.998) {
        stage = 'Breakout';
      } else if (lastClose <= lowerNow * 1.022) {
        stage = 'Testing Level';
      }
    } else {
      if (lastClose > upperNow * 1.002) {
        stage = 'Breakout';
      } else if (lastClose >= upperNow * 0.978) {
        stage = 'Testing Level';
      }
    }

    const r2Score = ((upperReg.r2 + lowerReg.r2) / 2) * 30;
    const pivotScore = Math.min(18, (upperPts.length + lowerPts.length) * 3);
    const containScore = containment * 35;
    const volBoost = stage === 'Breakout' && rvol > 1.2 ? 12 : 6;
    const fitScore = r2Score + pivotScore + containScore + volBoost;

    const lines: PatternLine[] = [
      {
        label: 'Upper Trendline',
        role: 'resistance',
        points: [
          { index: lineStartIdx, time: bars[lineStartIdx].time, price: round2(upperAtStart) },
          { index: lastIdx, time: bars[lastIdx].time, price: round2(upperNow) },
        ],
      },
      {
        label: 'Lower Trendline',
        role: 'support',
        points: [
          { index: lineStartIdx, time: bars[lineStartIdx].time, price: round2(lowerAtStart) },
          { index: lastIdx, time: bars[lastIdx].time, price: round2(lowerNow) },
        ],
      },
    ];

    const compressionPct = Math.round((1 - spreadNow / spreadStart) * 100);
    const summary = `${type} spanning ${lastIdx - lineStartIdx} bars (${upperPts.length} upper, ${lowerPts.length} lower pivots) with ${compressionPct}% range compression. ${
      stage === 'Breakout'
        ? `Price closed through the $${round2(breakoutPrice)} boundary on ${rvol}x RVOL.`
        : stage === 'Testing Level'
        ? `Price is pressing within 2.2% of the $${round2(breakoutPrice)} trigger level.`
        : `Price continues coiling inside the converging apex toward $${round2(breakoutPrice)}.`
    }`;

    results.push(
      makePattern({
        type,
        category,
        bias,
        stage,
        fitScore,
        startIndex: lineStartIdx,
        endIndex: lastIdx,
        lastClose,
        breakoutPrice,
        targetPrice,
        stopPrice,
        summary,
        criteria: [
          `${upperPts.length} upper pivots & ${lowerPts.length} lower pivots`,
          `${Math.round(containment * 100)}% bar containment inside structure`,
          `Range compressed ${compressionPct}% from $${round2(spreadStart)} to $${round2(spreadNow)}`,
        ],
        lines,
        keyPivots: [...upperPts, ...lowerPts],
      })
    );
  }

  return results;
}

function detectFlags(bars: OHLCVBar[], rvol: number): DetectedPattern[] {
  const results: DetectedPattern[] = [];
  const n = bars.length;
  const lastIdx = n - 1;
  const lastClose = bars[lastIdx].close;
  if (n < 30) return results;

  // Look for flagpole ending 4..18 bars ago
  for (let flagLen = 5; flagLen <= 18; flagLen += 3) {
    const poleEndIdx = lastIdx - flagLen;
    if (poleEndIdx < 12) continue;

    // Find best impulse leg ending at poleEndIdx of length 5..14
    let bestBullPole: { startIdx: number; gainPct: number } | null = null;
    let bestBearPole: { startIdx: number; dropPct: number } | null = null;

    for (let pLen = 5; pLen <= 14; pLen++) {
      const pStart = poleEndIdx - pLen;
      if (pStart < 0) continue;
      const startLow = bars[pStart].low;
      const endHigh = bars[poleEndIdx].high;
      const gainPct = ((endHigh - startLow) / startLow) * 100;
      if (gainPct >= 8.0 && (!bestBullPole || gainPct > bestBullPole.gainPct)) {
        bestBullPole = { startIdx: pStart, gainPct };
      }

      const startHigh = bars[pStart].high;
      const endLow = bars[poleEndIdx].low;
      const dropPct = ((startHigh - endLow) / startHigh) * 100;
      if (dropPct >= 8.0 && (!bestBearPole || dropPct > bestBearPole.dropPct)) {
        bestBearPole = { startIdx: pStart, dropPct };
      }
    }

    if (bestBullPole) {
      const poleLow = bars[bestBullPole.startIdx].low;
      const poleHigh = bars[poleEndIdx].high;
      const poleHeight = poleHigh - poleLow;

      let flagHigh = -Infinity;
      let flagLow = Infinity;
      let flagVolSum = 0;
      for (let i = poleEndIdx; i <= lastIdx; i++) {
        if (bars[i].high > flagHigh) flagHigh = bars[i].high;
        if (bars[i].low < flagLow) flagLow = bars[i].low;
        flagVolSum += bars[i].volume;
      }

      let poleVolSum = 0;
      for (let i = bestBullPole.startIdx; i <= poleEndIdx; i++) {
        poleVolSum += bars[i].volume;
      }
      const poleAvgVol = poleVolSum / (poleEndIdx - bestBullPole.startIdx + 1);
      const flagAvgVol = flagVolSum / (lastIdx - poleEndIdx + 1);

      const retrace = (poleHigh - flagLow) / poleHeight;
      const channelPtsHigh: SwingPoint[] = [];
      const channelPtsLow: SwingPoint[] = [];
      for (let i = poleEndIdx; i <= lastIdx; i++) {
        channelPtsHigh.push({ index: i, time: bars[i].time, price: bars[i].high });
        channelPtsLow.push({ index: i, time: bars[i].time, price: bars[i].low });
      }
      const regH = fitRegression(channelPtsHigh);
      const regL = fitRegression(channelPtsLow);

      if (
        retrace > 0.08 &&
        retrace <= 0.46 &&
        regH &&
        regL &&
        regH.slopePctPerBar <= 0.12 &&
        regH.slopePctPerBar >= -1.2 &&
        flagAvgVol <= poleAvgVol * 1.05
      ) {
        const upperNow = regH.slope * lastIdx + regH.intercept;
        const breakoutPrice = Math.max(upperNow, bars[poleEndIdx].high * 0.992);
        const targetPrice = flagLow + poleHeight;
        const stopPrice = flagLow * 0.988;

        let stage: PatternStage = 'Forming';
        if (lastClose > breakoutPrice * 1.002) stage = 'Breakout';
        else if (lastClose >= breakoutPrice * 0.975) stage = 'Testing Level';

        const volContract = poleAvgVol > 0 ? flagAvgVol / poleAvgVol : 0.8;
        const fitScore =
          65 +
          Math.min(15, bestBullPole.gainPct * 0.8) +
          (volContract < 0.8 ? 10 : 4) +
          (stage === 'Breakout' && rvol > 1.2 ? 6 : 2);

        results.push(
          makePattern({
            type: 'Bull Flag',
            category: 'Flags & Pennants',
            bias: 'Bullish',
            stage,
            fitScore,
            startIndex: bestBullPole.startIdx,
            endIndex: lastIdx,
            lastClose,
            breakoutPrice,
            targetPrice,
            stopPrice,
            summary: `Bull Flag following a +${round2(bestBullPole.gainPct)}% impulse flagpole over ${
              poleEndIdx - bestBullPole.startIdx
            } bars. Orderly ${round2(retrace * 100)}% pullback over ${flagLen} sessions on ${round2(
              volContract * 100
            )}% of flagpole average volume.`,
            criteria: [
              `Prior impulse leg: +${round2(bestBullPole.gainPct)}%`,
              `Shallow ${round2(retrace * 100)}% flag retracement`,
              `Volume ratio during flag: ${round2(volContract)}x vs pole`,
            ],
            lines: [
              {
                label: 'Flagpole',
                role: 'pole',
                points: [
                  { index: bestBullPole.startIdx, time: bars[bestBullPole.startIdx].time, price: poleLow },
                  { index: poleEndIdx, time: bars[poleEndIdx].time, price: poleHigh },
                ],
              },
              {
                label: 'Flag Upper Channel',
                role: 'resistance',
                points: [
                  {
                    index: poleEndIdx,
                    time: bars[poleEndIdx].time,
                    price: round2(regH.slope * poleEndIdx + regH.intercept),
                  },
                  { index: lastIdx, time: bars[lastIdx].time, price: round2(upperNow) },
                ],
              },
              {
                label: 'Flag Lower Channel',
                role: 'support',
                points: [
                  {
                    index: poleEndIdx,
                    time: bars[poleEndIdx].time,
                    price: round2(regL.slope * poleEndIdx + regL.intercept),
                  },
                  {
                    index: lastIdx,
                    time: bars[lastIdx].time,
                    price: round2(regL.slope * lastIdx + regL.intercept),
                  },
                ],
              },
            ],
            keyPivots: [
              { index: bestBullPole.startIdx, time: bars[bestBullPole.startIdx].time, price: poleLow },
              { index: poleEndIdx, time: bars[poleEndIdx].time, price: poleHigh },
            ],
          })
        );
      }
    }

    if (bestBearPole) {
      const poleHigh = bars[bestBearPole.startIdx].high;
      const poleLow = bars[poleEndIdx].low;
      const poleHeight = poleHigh - poleLow;

      let flagHigh = -Infinity;
      let flagLow = Infinity;
      let flagVolSum = 0;
      for (let i = poleEndIdx; i <= lastIdx; i++) {
        if (bars[i].high > flagHigh) flagHigh = bars[i].high;
        if (bars[i].low < flagLow) flagLow = bars[i].low;
        flagVolSum += bars[i].volume;
      }

      let poleVolSum = 0;
      for (let i = bestBearPole.startIdx; i <= poleEndIdx; i++) {
        poleVolSum += bars[i].volume;
      }
      const poleAvgVol = poleVolSum / (poleEndIdx - bestBearPole.startIdx + 1);
      const flagAvgVol = flagVolSum / (lastIdx - poleEndIdx + 1);

      const retrace = (flagHigh - poleLow) / poleHeight;
      const channelPtsLow: SwingPoint[] = [];
      const channelPtsHigh: SwingPoint[] = [];
      for (let i = poleEndIdx; i <= lastIdx; i++) {
        channelPtsHigh.push({ index: i, time: bars[i].time, price: bars[i].high });
        channelPtsLow.push({ index: i, time: bars[i].time, price: bars[i].low });
      }
      const regH = fitRegression(channelPtsHigh);
      const regL = fitRegression(channelPtsLow);

      if (
        retrace > 0.08 &&
        retrace <= 0.46 &&
        regL &&
        regH &&
        regL.slopePctPerBar >= -0.12 &&
        regL.slopePctPerBar <= 1.2 &&
        flagAvgVol <= poleAvgVol * 1.05
      ) {
        const lowerNow = regL.slope * lastIdx + regL.intercept;
        const breakoutPrice = Math.min(lowerNow, bars[poleEndIdx].low * 1.008);
        const targetPrice = Math.max(1, flagHigh - poleHeight);
        const stopPrice = flagHigh * 1.012;

        let stage: PatternStage = 'Forming';
        if (lastClose < breakoutPrice * 0.998) stage = 'Breakout';
        else if (lastClose <= breakoutPrice * 1.025) stage = 'Testing Level';

        const volContract = poleAvgVol > 0 ? flagAvgVol / poleAvgVol : 0.8;
        const fitScore =
          65 +
          Math.min(15, bestBearPole.dropPct * 0.8) +
          (volContract < 0.8 ? 10 : 4) +
          (stage === 'Breakout' && rvol > 1.2 ? 6 : 2);

        results.push(
          makePattern({
            type: 'Bear Flag',
            category: 'Flags & Pennants',
            bias: 'Bearish',
            stage,
            fitScore,
            startIndex: bestBearPole.startIdx,
            endIndex: lastIdx,
            lastClose,
            breakoutPrice,
            targetPrice,
            stopPrice,
            summary: `Bear Flag after a -${round2(bestBearPole.dropPct)}% selloff leg. Counter-trend bounce retraced ${round2(
              retrace * 100
            )}% over ${flagLen} bars on ${round2(volContract)}x pole volume.`,
            criteria: [
              `Prior breakdown leg: -${round2(bestBearPole.dropPct)}%`,
              `Counter-trend relief bounce: ${round2(retrace * 100)}%`,
              `Volume contraction ratio: ${round2(volContract)}x`,
            ],
            lines: [
              {
                label: 'Bear Flagpole',
                role: 'pole',
                points: [
                  { index: bestBearPole.startIdx, time: bars[bestBearPole.startIdx].time, price: poleHigh },
                  { index: poleEndIdx, time: bars[poleEndIdx].time, price: poleLow },
                ],
              },
              {
                label: 'Flag Upper Channel',
                role: 'resistance',
                points: [
                  {
                    index: poleEndIdx,
                    time: bars[poleEndIdx].time,
                    price: round2(regH.slope * poleEndIdx + regH.intercept),
                  },
                  {
                    index: lastIdx,
                    time: bars[lastIdx].time,
                    price: round2(regH.slope * lastIdx + regH.intercept),
                  },
                ],
              },
              {
                label: 'Flag Lower Channel',
                role: 'support',
                points: [
                  {
                    index: poleEndIdx,
                    time: bars[poleEndIdx].time,
                    price: round2(regL.slope * poleEndIdx + regL.intercept),
                  },
                  { index: lastIdx, time: bars[lastIdx].time, price: round2(lowerNow) },
                ],
              },
            ],
            keyPivots: [
              { index: bestBearPole.startIdx, time: bars[bestBearPole.startIdx].time, price: poleHigh },
              { index: poleEndIdx, time: bars[poleEndIdx].time, price: poleLow },
            ],
          })
        );
      }
    }
  }

  return results;
}

function detectDoubleTopBottom(bars: OHLCVBar[], rvol: number): DetectedPattern[] {
  const results: DetectedPattern[] = [];
  const n = bars.length;
  const lastIdx = n - 1;
  const lastClose = bars[lastIdx].close;
  const startIdx = Math.max(0, n - 85);
  const { highs, lows } = findSwings(bars, startIdx, lastIdx - 1, 4);

  // Double Bottom
  if (lows.length >= 2) {
    for (let i = lows.length - 1; i >= 1; i--) {
      const L2 = lows[i];
      if (lastIdx - L2.index > 24) continue;
      for (let j = i - 1; j >= 0; j--) {
        const L1 = lows[j];
        const sep = L2.index - L1.index;
        if (sep < 8 || sep > 50) continue;

        const avgLow = (L1.price + L2.price) / 2;
        const diffPct = (Math.abs(L1.price - L2.price) / avgLow) * 100;
        if (diffPct > 2.8) continue;

        // Find highest peak between L1 and L2
        let neckIdx = L1.index + 1;
        let neckPrice = -Infinity;
        for (let k = L1.index + 1; k < L2.index; k++) {
          if (bars[k].high > neckPrice) {
            neckPrice = bars[k].high;
            neckIdx = k;
          }
        }
        const depthPct = ((neckPrice - avgLow) / neckPrice) * 100;
        if (depthPct < 4.5) continue;

        // Current price must not have broken down below L2 significantly, nor already hit target or drifted >6% past breakout
        if (lastClose < Math.min(L1.price, L2.price) * 0.985) continue;
        const targetPrice = neckPrice + (neckPrice - Math.min(L1.price, L2.price));
        if (lastClose > targetPrice * 0.96 || lastClose > neckPrice * 1.06) continue;

        let stage: PatternStage = 'Forming';
        if (lastClose > neckPrice * 1.002) stage = 'Breakout';
        else if (lastClose >= neckPrice * 0.975) stage = 'Testing Level';

        const symScore = (1 - diffPct / 3) * 20;
        const fitScore = 66 + symScore + (stage === 'Breakout' && rvol > 1.2 ? 10 : 4);

        // Find left-entry peak right before L1 for complete "W" geometry
        let wLeftIdx = Math.max(0, L1.index - Math.max(4, Math.round(sep * 0.35)));
        let wLeftPrice = bars[wLeftIdx].high;
        for (let k = wLeftIdx; k < L1.index; k++) {
          if (bars[k].high > wLeftPrice) {
            wLeftPrice = bars[k].high;
            wLeftIdx = k;
          }
        }

        results.push(
          makePattern({
            type: 'Double Bottom',
            category: 'Double Top & Bottom',
            bias: 'Bullish',
            stage,
            fitScore,
            startIndex: L1.index,
            endIndex: lastIdx,
            lastClose,
            breakoutPrice: neckPrice,
            targetPrice,
            stopPrice: Math.min(L1.price, L2.price) * 0.988,
            summary: `Double Bottom ("W") with twin troughs at $${round2(L1.price)} and $${round2(
              L2.price
            )} (${round2(diffPct)}% variance) separated by ${sep} bars. Neckline resistance stands at $${round2(
              neckPrice
            )}.`,
            criteria: [
              `Bottom symmetry: ${round2(diffPct)}% price spread`,
              `Base depth: ${round2(depthPct)}% below neckline`,
              `Measured move target: $${round2(targetPrice)}`,
            ],
            lines: [
              {
                label: 'Neckline Resistance',
                role: 'neckline',
                points: [
                  { index: L1.index, time: L1.time, price: round2(neckPrice) },
                  { index: lastIdx, time: bars[lastIdx].time, price: round2(neckPrice) },
                ],
              },
              {
                label: 'Double Bottom Floor',
                role: 'support',
                points: [
                  { index: L1.index, time: L1.time, price: round2(L1.price) },
                  { index: L2.index, time: L2.time, price: round2(L2.price) },
                ],
              },
              {
                label: 'Double Bottom W-Path',
                role: 'pole',
                points: [
                  { index: wLeftIdx, time: bars[wLeftIdx].time, price: round2(wLeftPrice) },
                  { index: L1.index, time: L1.time, price: round2(L1.price) },
                  { index: neckIdx, time: bars[neckIdx].time, price: round2(neckPrice) },
                  { index: L2.index, time: L2.time, price: round2(L2.price) },
                  { index: lastIdx, time: bars[lastIdx].time, price: round2(lastClose) },
                ],
              },
            ],
            keyPivots: [L1, { index: neckIdx, time: bars[neckIdx].time, price: neckPrice }, L2],
          })
        );
        break;
      }
    }
  }

  // Double Top
  if (highs.length >= 2) {
    for (let i = highs.length - 1; i >= 1; i--) {
      const H2 = highs[i];
      if (lastIdx - H2.index > 24) continue;
      for (let j = i - 1; j >= 0; j--) {
        const H1 = highs[j];
        const sep = H2.index - H1.index;
        if (sep < 8 || sep > 50) continue;

        const avgHigh = (H1.price + H2.price) / 2;
        const diffPct = (Math.abs(H1.price - H2.price) / avgHigh) * 100;
        if (diffPct > 2.8) continue;

        let neckIdx = H1.index + 1;
        let neckPrice = Infinity;
        for (let k = H1.index + 1; k < H2.index; k++) {
          if (bars[k].low < neckPrice) {
            neckPrice = bars[k].low;
            neckIdx = k;
          }
        }
        const heightPct = ((avgHigh - neckPrice) / avgHigh) * 100;
        if (heightPct < 4.5) continue;

        if (lastClose > Math.max(H1.price, H2.price) * 1.015) continue;
        const targetPrice = Math.max(1, neckPrice - (Math.max(H1.price, H2.price) - neckPrice));
        if (lastClose < targetPrice * 1.04 || lastClose < neckPrice * 0.94) continue;

        let stage: PatternStage = 'Forming';
        if (lastClose < neckPrice * 0.998) stage = 'Breakout';
        else if (lastClose <= neckPrice * 1.025) stage = 'Testing Level';

        const symScore = (1 - diffPct / 3) * 20;
        const fitScore = 66 + symScore + (stage === 'Breakout' && rvol > 1.2 ? 10 : 4);

        // Find left-entry trough right before H1 for complete "M" geometry
        let mLeftIdx = Math.max(0, H1.index - Math.max(4, Math.round(sep * 0.35)));
        let mLeftPrice = bars[mLeftIdx].low;
        for (let k = mLeftIdx; k < H1.index; k++) {
          if (bars[k].low < mLeftPrice) {
            mLeftPrice = bars[k].low;
            mLeftIdx = k;
          }
        }

        results.push(
          makePattern({
            type: 'Double Top',
            category: 'Double Top & Bottom',
            bias: 'Bearish',
            stage,
            fitScore,
            startIndex: H1.index,
            endIndex: lastIdx,
            lastClose,
            breakoutPrice: neckPrice,
            targetPrice,
            stopPrice: Math.max(H1.price, H2.price) * 1.012,
            summary: `Double Top ("M") rejecting $${round2(H1.price)} and $${round2(H2.price)} (${round2(
              diffPct
            )}% variance) over ${sep} bars. Breakdown neckline sits at $${round2(neckPrice)}.`,
            criteria: [
              `Peak symmetry: ${round2(diffPct)}% variance`,
              `Pattern height: ${round2(heightPct)}%`,
              `Breakdown trigger: $${round2(neckPrice)}`,
            ],
            lines: [
              {
                label: 'Double Top Ceiling',
                role: 'resistance',
                points: [
                  { index: H1.index, time: H1.time, price: round2(H1.price) },
                  { index: H2.index, time: H2.time, price: round2(H2.price) },
                ],
              },
              {
                label: 'Neckline Support',
                role: 'neckline',
                points: [
                  { index: H1.index, time: H1.time, price: round2(neckPrice) },
                  { index: lastIdx, time: bars[lastIdx].time, price: round2(neckPrice) },
                ],
              },
              {
                label: 'Double Top M-Path',
                role: 'pole',
                points: [
                  { index: mLeftIdx, time: bars[mLeftIdx].time, price: round2(mLeftPrice) },
                  { index: H1.index, time: H1.time, price: round2(H1.price) },
                  { index: neckIdx, time: bars[neckIdx].time, price: round2(neckPrice) },
                  { index: H2.index, time: H2.time, price: round2(H2.price) },
                  { index: lastIdx, time: bars[lastIdx].time, price: round2(lastClose) },
                ],
              },
            ],
            keyPivots: [H1, { index: neckIdx, time: bars[neckIdx].time, price: neckPrice }, H2],
          })
        );
        break;
      }
    }
  }

  return results;
}

function detectCupAndHandle(bars: OHLCVBar[], rvol: number): DetectedPattern[] {
  const results: DetectedPattern[] = [];
  const n = bars.length;
  const lastIdx = n - 1;
  const lastClose = bars[lastIdx].close;
  if (n < 45) return results;

  const lookbackStart = Math.max(0, n - 95);
  const { highs } = findSwings(bars, lookbackStart, lastIdx - 5, 4);
  if (highs.length < 2) return results;

  for (let i = 0; i < highs.length - 1; i++) {
    const leftRim = highs[i];
    for (let j = i + 1; j < highs.length; j++) {
      const rightRim = highs[j];
      const cupLen = rightRim.index - leftRim.index;
      const handleLen = lastIdx - rightRim.index;
      if (cupLen < 18 || cupLen > 75 || handleLen < 3 || handleLen > 18) continue;

      const rimDiffPct = (Math.abs(leftRim.price - rightRim.price) / leftRim.price) * 100;
      if (rimDiffPct > 4.0) continue;

      // Find bottom of cup
      let cupLow = Infinity;
      let cupLowIdx = leftRim.index;
      for (let k = leftRim.index + 1; k < rightRim.index; k++) {
        if (bars[k].low < cupLow) {
          cupLow = bars[k].low;
          cupLowIdx = k;
        }
      }

      const cupDepthPct = ((leftRim.price - cupLow) / leftRim.price) * 100;
      const relPos = (cupLowIdx - leftRim.index) / cupLen;
      if (cupDepthPct < 9.0 || cupDepthPct > 38.0 || relPos < 0.22 || relPos > 0.78) continue;

      // Handle bounds
      let handleLow = Infinity;
      let handleHigh = -Infinity;
      for (let k = rightRim.index; k <= lastIdx; k++) {
        if (bars[k].low < handleLow) handleLow = bars[k].low;
        if (bars[k].high > handleHigh) handleHigh = bars[k].high;
      }
      const handleDropPct = ((rightRim.price - handleLow) / rightRim.price) * 100;
      if (handleDropPct < 1.2 || handleDropPct > 11.5) continue;
      if (handleLow < cupLow + (rightRim.price - cupLow) * 0.45) continue;

      const rimLevel = Math.max(leftRim.price, rightRim.price);
      if (lastClose > rimLevel * 1.07) continue;

      const targetPrice = rimLevel + (rimLevel - cupLow);
      const stopPrice = handleLow * 0.988;

      let stage: PatternStage = 'Forming';
      if (lastClose > rimLevel * 1.002) stage = 'Breakout';
      else if (lastClose >= rimLevel * 0.975) stage = 'Testing Level';

      const fitScore =
        68 +
        (1 - rimDiffPct / 4.5) * 14 +
        (handleDropPct <= 8 ? 8 : 3) +
        (stage === 'Breakout' && rvol > 1.2 ? 6 : 2);

      results.push(
        makePattern({
          type: 'Cup & Handle',
          category: 'Cup & Handle',
          bias: 'Bullish',
          stage,
          fitScore,
          startIndex: leftRim.index,
          endIndex: lastIdx,
          lastClose,
          breakoutPrice: rimLevel,
          targetPrice,
          stopPrice,
          summary: `Cup & Handle base spanning ${cupLen} bars (${round2(
            cupDepthPct
          )}% depth) followed by a tight ${handleLen}-bar handle pullback of ${round2(
            handleDropPct
          )}%. Rim pivot sits at $${round2(rimLevel)}.`,
          criteria: [
            `Cup depth: ${round2(cupDepthPct)}% over ${cupLen} sessions`,
            `Rim symmetry: ${round2(rimDiffPct)}% variance`,
            `Handle drift: -${round2(handleDropPct)}% in upper half of base`,
          ],
          lines: [
            {
              label: 'Cup Rim Pivot',
              role: 'neckline',
              points: [
                { index: leftRim.index, time: leftRim.time, price: round2(rimLevel) },
                { index: lastIdx, time: bars[lastIdx].time, price: round2(rimLevel) },
              ],
            },
            {
              label: 'Cup Base Arc',
              role: 'support',
              dashed: true,
              points: [
                { index: leftRim.index, time: leftRim.time, price: round2(leftRim.price) },
                { index: cupLowIdx, time: bars[cupLowIdx].time, price: round2(cupLow) },
                { index: rightRim.index, time: rightRim.time, price: round2(rightRim.price) },
              ],
            },
            {
              label: 'Handle Support',
              role: 'support',
              points: [
                { index: rightRim.index, time: rightRim.time, price: round2(handleLow) },
                { index: lastIdx, time: bars[lastIdx].time, price: round2(handleLow) },
              ],
            },
          ],
          keyPivots: [
            leftRim,
            { index: cupLowIdx, time: bars[cupLowIdx].time, price: cupLow },
            rightRim,
          ],
        })
      );
    }
  }

  return results;
}

function detectHeadAndShoulders(bars: OHLCVBar[], rvol: number): DetectedPattern[] {
  const results: DetectedPattern[] = [];
  const n = bars.length;
  const lastIdx = n - 1;
  const lastClose = bars[lastIdx].close;
  if (n < 40) return results;

  const startIdx = Math.max(0, n - 95);
  const { highs, lows } = findSwings(bars, startIdx, lastIdx - 2, 4);

  // Classic Bearish H&S
  if (highs.length >= 3) {
    for (let i = highs.length - 1; i >= 2; i--) {
      const RS = highs[i];
      const H = highs[i - 1];
      const LS = highs[i - 2];
      if (lastIdx - RS.index > 20) continue;

      if (H.price < LS.price * 1.025 || H.price < RS.price * 1.025) continue;
      const shoulderDiffPct = (Math.abs(LS.price - RS.price) / ((LS.price + RS.price) / 2)) * 100;
      if (shoulderDiffPct > 4.5) continue;

      // Neckline troughs between LS-H and H-RS
      let n1Idx = LS.index + 1;
      let n1Price = Infinity;
      for (let k = LS.index + 1; k < H.index; k++) {
        if (bars[k].low < n1Price) {
          n1Price = bars[k].low;
          n1Idx = k;
        }
      }
      let n2Idx = H.index + 1;
      let n2Price = Infinity;
      for (let k = H.index + 1; k < RS.index; k++) {
        if (bars[k].low < n2Price) {
          n2Price = bars[k].low;
          n2Idx = k;
        }
      }

      const neckSlope = (n2Price - n1Price) / Math.max(1, n2Idx - n1Idx);
      const neckNow = n1Price + neckSlope * (lastIdx - n1Idx);
      const neckAtHead = n1Price + neckSlope * (H.index - n1Idx);
      const headHeight = H.price - neckAtHead;
      if (headHeight / H.price < 0.05) continue;
      if (lastClose > RS.price * 1.02 || lastClose < neckNow * 0.94) continue;

      const targetPrice = Math.max(1, neckNow - headHeight);
      let stage: PatternStage = 'Forming';
      if (lastClose < neckNow * 0.998) stage = 'Breakout';
      else if (lastClose <= neckNow * 1.025) stage = 'Testing Level';

      const fitScore =
        68 +
        (1 - shoulderDiffPct / 5) * 16 +
        (stage === 'Breakout' && rvol > 1.2 ? 9 : 4);

      results.push(
        makePattern({
          type: 'Head & Shoulders',
          category: 'Head & Shoulders',
          bias: 'Bearish',
          stage,
          fitScore,
          startIndex: LS.index,
          endIndex: lastIdx,
          lastClose,
          breakoutPrice: neckNow,
          targetPrice,
          stopPrice: RS.price * 1.012,
          summary: `Head & Shoulders top with head at $${round2(H.price)} flanked by shoulders at $${round2(
            LS.price
          )} and $${round2(RS.price)}. Neckline support projects to $${round2(neckNow)}.`,
          criteria: [
            `Shoulder symmetry: ${round2(shoulderDiffPct)}% variance`,
            `Head prominence: +${round2((headHeight / H.price) * 100)}% above neckline`,
            `Measured breakdown target: $${round2(targetPrice)}`,
          ],
          lines: [
            {
              label: 'Neckline',
              role: 'neckline',
              points: [
                { index: n1Idx, time: bars[n1Idx].time, price: round2(n1Price) },
                { index: lastIdx, time: bars[lastIdx].time, price: round2(neckNow) },
              ],
            },
            {
              label: 'Shoulder-Head Structure',
              role: 'resistance',
              dashed: true,
              points: [LS, H, RS],
            },
          ],
          keyPivots: [LS, H, RS],
        })
      );
      break;
    }
  }

  // Inverse Bullish H&S
  if (lows.length >= 3) {
    for (let i = lows.length - 1; i >= 2; i--) {
      const RS = lows[i];
      const H = lows[i - 1];
      const LS = lows[i - 2];
      if (lastIdx - RS.index > 20) continue;

      if (H.price > LS.price * 0.975 || H.price > RS.price * 0.975) continue;
      const shoulderDiffPct = (Math.abs(LS.price - RS.price) / ((LS.price + RS.price) / 2)) * 100;
      if (shoulderDiffPct > 4.5) continue;

      let n1Idx = LS.index + 1;
      let n1Price = -Infinity;
      for (let k = LS.index + 1; k < H.index; k++) {
        if (bars[k].high > n1Price) {
          n1Price = bars[k].high;
          n1Idx = k;
        }
      }
      let n2Idx = H.index + 1;
      let n2Price = -Infinity;
      for (let k = H.index + 1; k < RS.index; k++) {
        if (bars[k].high > n2Price) {
          n2Price = bars[k].high;
          n2Idx = k;
        }
      }

      const neckSlope = (n2Price - n1Price) / Math.max(1, n2Idx - n1Idx);
      const neckNow = n1Price + neckSlope * (lastIdx - n1Idx);
      const neckAtHead = n1Price + neckSlope * (H.index - n1Idx);
      const headHeight = neckAtHead - H.price;
      if (headHeight / neckAtHead < 0.05) continue;
      if (lastClose < RS.price * 0.98 || lastClose > neckNow * 1.06) continue;

      const targetPrice = neckNow + headHeight;
      let stage: PatternStage = 'Forming';
      if (lastClose > neckNow * 1.002) stage = 'Breakout';
      else if (lastClose >= neckNow * 0.975) stage = 'Testing Level';

      const fitScore =
        68 +
        (1 - shoulderDiffPct / 5) * 16 +
        (stage === 'Breakout' && rvol > 1.2 ? 9 : 4);

      results.push(
        makePattern({
          type: 'Inverse Head & Shoulders',
          category: 'Head & Shoulders',
          bias: 'Bullish',
          stage,
          fitScore,
          startIndex: LS.index,
          endIndex: lastIdx,
          lastClose,
          breakoutPrice: neckNow,
          targetPrice,
          stopPrice: RS.price * 0.988,
          summary: `Inverse Head & Shoulders bottom with head trough at $${round2(
            H.price
          )} and symmetric shoulders near $${round2(LS.price)} / $${round2(
            RS.price
          )}. Neckline trigger sits at $${round2(neckNow)}.`,
          criteria: [
            `Shoulder symmetry: ${round2(shoulderDiffPct)}% variance`,
            `Inverse head depth: ${round2((headHeight / neckAtHead) * 100)}%`,
            `Measured upside target: $${round2(targetPrice)}`,
          ],
          lines: [
            {
              label: 'Neckline',
              role: 'neckline',
              points: [
                { index: n1Idx, time: bars[n1Idx].time, price: round2(n1Price) },
                { index: lastIdx, time: bars[lastIdx].time, price: round2(neckNow) },
              ],
            },
            {
              label: 'Inverse H&S Structure',
              role: 'support',
              dashed: true,
              points: [LS, H, RS],
            },
          ],
          keyPivots: [LS, H, RS],
        })
      );
      break;
    }
  }

  return results;
}

function detectHorizontalBox(bars: OHLCVBar[], rvol: number): DetectedPattern[] {
  const results: DetectedPattern[] = [];
  const n = bars.length;
  const lastIdx = n - 1;
  const lastClose = bars[lastIdx].close;

  for (const boxLen of [20, 32]) {
    if (n < boxLen + 5) continue;
    const startIdx = lastIdx - boxLen;
    let boxHigh = -Infinity;
    let boxLow = Infinity;
    for (let i = startIdx; i < lastIdx - 1; i++) {
      if (bars[i].high > boxHigh) boxHigh = bars[i].high;
      if (bars[i].low < boxLow) boxLow = bars[i].low;
    }

    const boxHeightPct = ((boxHigh - boxLow) / boxLow) * 100;
    if (boxHeightPct < 3.0 || boxHeightPct > 11.5) continue;

    // Require price either breaking out or pressing upper/lower edge
    const nearTop = lastClose >= boxHigh * 0.978;
    const nearBottom = lastClose <= boxLow * 1.022;
    if (!nearTop && !nearBottom) continue;
    if (lastClose > boxHigh * 1.06 || lastClose < boxLow * 0.94) continue;

    const isBull = nearTop;
    const bias: PatternBias = isBull ? 'Bullish' : 'Bearish';
    const breakoutPrice = isBull ? boxHigh : boxLow;
    const boxHeight = boxHigh - boxLow;
    const targetPrice = isBull ? boxHigh + boxHeight : Math.max(1, boxLow - boxHeight);
    const stopPrice = isBull ? (boxHigh + boxLow) / 2 : (boxHigh + boxLow) / 2;

    let stage: PatternStage = 'Testing Level';
    if (isBull && lastClose > boxHigh * 1.002) stage = 'Breakout';
    if (!isBull && lastClose < boxLow * 0.998) stage = 'Breakout';

    const fitScore =
      64 +
      (12 - boxHeightPct) * 1.5 +
      (stage === 'Breakout' && rvol > 1.25 ? 12 : 4);

    results.push(
      makePattern({
        type: 'Horizontal Breakout Box',
        category: 'Wedges & Boxes',
        bias,
        stage,
        fitScore,
        startIndex: startIdx,
        endIndex: lastIdx,
        lastClose,
        breakoutPrice,
        targetPrice,
        stopPrice,
        summary: `Tight ${boxLen}-bar Darvas consolidation box (${round2(
          boxHeightPct
        )}% total range between $${round2(boxLow)} and $${round2(boxHigh)}). ${
          stage === 'Breakout'
            ? `Price is breaking ${isBull ? 'above resistance' : 'below support'} on ${rvol}x RVOL.`
            : `Price is pressing the ${isBull ? 'upper ceiling' : 'lower floor'} at $${round2(breakoutPrice)}.`
        }`,
        criteria: [
          `Box width: ${round2(boxHeightPct)}% over ${boxLen} bars`,
          `Box range: $${round2(boxLow)} – $${round2(boxHigh)}`,
          `Current RVOL: ${rvol}x`,
        ],
        lines: [
          {
            label: 'Box Resistance',
            role: 'resistance',
            points: [
              { index: startIdx, time: bars[startIdx].time, price: round2(boxHigh) },
              { index: lastIdx, time: bars[lastIdx].time, price: round2(boxHigh) },
            ],
          },
          {
            label: 'Box Support',
            role: 'support',
            points: [
              { index: startIdx, time: bars[startIdx].time, price: round2(boxLow) },
              { index: lastIdx, time: bars[lastIdx].time, price: round2(boxLow) },
            ],
          },
        ],
        keyPivots: [],
      })
    );
  }

  return results;
}

function fitQuadratic(
  points: Array<{ t: number; y: number }>
): { a: number; b: number; c: number; r2: number } | null {
  const n = points.length;
  if (n < 5) return null;

  let s0 = n;
  let s1 = 0;
  let s2 = 0;
  let s3 = 0;
  let s4 = 0;
  let sy = 0;
  let sty = 0;
  let st2y = 0;

  for (const p of points) {
    const t = p.t;
    const t2 = t * t;
    s1 += t;
    s2 += t2;
    s3 += t2 * t;
    s4 += t2 * t2;
    sy += p.y;
    sty += t * p.y;
    st2y += t2 * p.y;
  }

  // Solve 3x3 symmetric system [s4 s3 s2; s3 s2 s1; s2 s1 s0] * [a; b; c] = [st2y; sty; sy]
  const m = [
    [s4, s3, s2, st2y],
    [s3, s2, s1, sty],
    [s2, s1, s0, sy],
  ];

  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let row = col + 1; row < 3; row++) {
      if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
    }
    if (Math.abs(m[pivot][col]) < 1e-10) return null;
    if (pivot !== col) {
      const tmp = m[col];
      m[col] = m[pivot];
      m[pivot] = tmp;
    }
    for (let row = col + 1; row < 3; row++) {
      const factor = m[row][col] / m[col][col];
      for (let k = col; k < 4; k++) {
        m[row][k] -= factor * m[col][k];
      }
    }
  }

  const c = m[2][3] / m[2][2];
  const b = (m[1][3] - m[1][2] * c) / m[1][1];
  const a = (m[0][3] - m[0][1] * b - m[0][2] * c) / m[0][0];

  const meanY = sy / n;
  let ssRes = 0;
  let ssTot = 0;
  for (const p of points) {
    const pred = a * p.t * p.t + b * p.t + c;
    ssRes += (p.y - pred) ** 2;
    ssTot += (p.y - meanY) ** 2;
  }
  const r2 = ssTot === 0 ? 1 : Math.max(0, 1 - ssRes / ssTot);
  return { a, b, c, r2 };
}

function detectParabolaCurve(bars: OHLCVBar[], rvol: number): DetectedPattern[] {
  const results: DetectedPattern[] = [];
  const n = bars.length;
  const lastIdx = n - 1;
  const lastClose = bars[lastIdx].close;
  const windows = [32, 46, 62];

  for (const win of windows) {
    if (n < win + 5) continue;
    const startIdx = lastIdx - win;
    const span = lastIdx - startIdx;

    // Sample rolling 3-bar floor lows so the curve tracks the accelerating base
    const samplePts: Array<{ t: number; y: number; index: number }> = [];
    for (let i = startIdx; i <= lastIdx; i += 2) {
      const segEnd = Math.min(lastIdx, i + 1);
      const segStart = Math.max(startIdx, i - 1);
      let segLow = Infinity;
      for (let j = segStart; j <= segEnd; j++) {
        if (bars[j].low < segLow) segLow = bars[j].low;
      }
      samplePts.push({
        t: (i - startIdx) / span,
        y: segLow,
        index: i,
      });
    }

    const fit = fitQuadratic(samplePts);
    if (!fit || fit.r2 < 0.78) continue;

    const { a, b, c, r2 } = fit;
    if (c <= 0) continue;

    // Must curve upward with genuine positive acceleration
    const curvatureRatio = a / c;
    if (curvatureRatio < 0.06) continue;

    const curveStart = c;
    const curveMid = a * 0.25 + b * 0.5 + c;
    const curveEnd = a + b + c;
    const firstHalfGain = curveMid - curveStart;
    const secondHalfGain = curveEnd - curveMid;
    const netGainPct = ((lastClose - curveStart) / curveStart) * 100;

    if (netGainPct < 10.5 || secondHalfGain <= 0) continue;
    if (secondHalfGain < Math.max(curveStart * 0.03, firstHalfGain * 1.45)) continue;

    // Price must respect the parabolic floor
    let aboveFloor = 0;
    for (let i = startIdx; i <= lastIdx; i++) {
      const t = (i - startIdx) / span;
      const floorVal = a * t * t + b * t + c;
      if (bars[i].close >= floorVal * 0.974) aboveFloor++;
    }
    const respectRatio = aboveFloor / (span + 1);
    if (respectRatio < 0.80) continue;
    if (lastClose < curveEnd * 0.965) continue;

    // Recent swing high resistance / trigger level
    let priorHigh = -Infinity;
    for (let i = Math.max(startIdx, lastIdx - 14); i < lastIdx; i++) {
      if (bars[i].high > priorHigh) priorHigh = bars[i].high;
    }
    const breakoutPrice = Math.max(priorHigh, lastClose * 1.005);
    const curveHeight = Math.max(breakoutPrice - curveStart, lastClose * 0.08);
    const targetPrice = breakoutPrice + curveHeight * 0.55;
    const stopPrice = Math.min(lastClose * 0.965, curveEnd * 0.985);

    let stage: PatternStage = 'Forming';
    if (lastClose > priorHigh * 1.002 && rvol >= 1.15) {
      stage = 'Breakout';
    } else if (lastClose >= priorHigh * 0.98 || lastClose <= curveEnd * 1.028) {
      stage = 'Testing Level';
    }

    const fitScore =
      r2 * 44 +
      respectRatio * 28 +
      Math.min(16, curvatureRatio * 45) +
      (stage === 'Breakout' && rvol > 1.25 ? 8 : 4);

    // Build smooth 11-point Parabolic Arc + 5-point forward projection
    const arcPoints: PatternPoint[] = [];
    for (let step = 0; step <= 10; step++) {
      const t = step / 10;
      const absIdx = Math.round(startIdx + t * span);
      const price = round2(a * t * t + b * t + c);
      arcPoints.push({
        index: absIdx,
        time: bars[Math.min(lastIdx, absIdx)].time,
        price,
      });
    }

    const projPoints: PatternPoint[] = [];
    for (let p = 0; p <= 4; p++) {
      const t = 1 + p * 0.05;
      const absIdx = lastIdx + p * Math.max(1, Math.round(span * 0.05));
      projPoints.push({
        index: absIdx,
        time: bars[lastIdx].time,
        price: round2(a * t * t + b * t + c),
      });
    }

    const accelFactor = firstHalfGain > 0 ? round2(secondHalfGain / firstHalfGain) : 2.0;

    results.push(
      makePattern({
        type: 'Parabola Curve',
        category: 'Parabolic Curves',
        bias: 'Bullish',
        stage,
        fitScore,
        startIndex: startIdx,
        endIndex: lastIdx,
        lastClose,
        breakoutPrice,
        targetPrice,
        stopPrice,
        summary: `Parabola Curve accelerating +${round2(netGainPct)}% over ${span} bars (R² ${round2(
          r2
        )}, ${accelFactor}x second-half slope steepening). Parabolic floor currently sits near $${round2(
          curveEnd
        )}; losing the curve triggers mean reversion.`,
        criteria: [
          `Quadratic fit R²: ${round2(r2)} with ${Math.round(respectRatio * 100)}% floor respect`,
          `2nd-half slope acceleration: ${accelFactor}x vs early base`,
          `Parabolic arc support: $${round2(curveEnd)}`,
        ],
        lines: [
          {
            label: 'Parabolic Arc',
            role: 'support',
            curved: true,
            points: arcPoints,
          },
          {
            label: 'Arc Projection',
            role: 'support',
            dashed: true,
            curved: true,
            points: projPoints,
          },
          {
            label: 'Upper Shelf Trigger',
            role: 'resistance',
            points: [
              { index: Math.max(startIdx, lastIdx - 14), time: bars[Math.max(startIdx, lastIdx - 14)].time, price: round2(breakoutPrice) },
              { index: lastIdx, time: bars[lastIdx].time, price: round2(breakoutPrice) },
            ],
          },
        ],
        keyPivots: [
          arcPoints[0],
          arcPoints[5],
          arcPoints[arcPoints.length - 1],
        ],
      })
    );
  }

  return results;
}

export function computeVolumeAnalysis(
  bars: OHLCVBar[],
  liveVolume: number,
  livePrice: number
): VolumeAnalysis {
  const n = bars.length;
  const prevEnd = n > 1 ? n - 1 : n;

  const avgSlice = (lookback: number, endIdx: number): number => {
    const start = Math.max(0, endIdx - lookback);
    let sum = 0;
    let cnt = 0;
    for (let i = start; i < endIdx; i++) {
      if (bars[i].volume > 0) {
        sum += bars[i].volume;
        cnt++;
      }
    }
    return cnt > 0 ? Math.round(sum / cnt) : liveVolume;
  };

  const avgVolume20 = avgSlice(20, prevEnd);
  const avgVolume50 = avgSlice(50, prevEnd);
  const avgVolume5 = avgSlice(5, n);

  const rvol = avgVolume20 > 0 ? round2(liveVolume / avgVolume20) : 1;
  const rvol5d = avgVolume20 > 0 ? round2(avgVolume5 / avgVolume20) : 1;
  const dollarVolume = Math.round(livePrice * liveVolume);

  // Up vs Down Volume & Spike days over last 20 bars
  const winStart = Math.max(1, n - 20);
  let upVolume20 = 0;
  let downVolume20 = 0;
  let spikeDays20 = 0;
  for (let i = winStart; i < n; i++) {
    const v = i === n - 1 ? liveVolume : bars[i].volume;
    if (bars[i].close >= bars[i - 1].close) {
      upVolume20 += v;
    } else {
      downVolume20 += v;
    }
    if (avgVolume20 > 0 && v >= avgVolume20 * 1.5) {
      spikeDays20++;
    }
  }

  const upDownVolumeRatio =
    downVolume20 > 0 ? round2(upVolume20 / downVolume20) : upVolume20 > 0 ? 2.0 : 1.0;

  // On-Balance Volume (OBV) 20-bar trend
  const obvSeries: number[] = [0];
  for (let i = 1; i < n; i++) {
    const v = i === n - 1 ? liveVolume : bars[i].volume;
    const prev = obvSeries[i - 1];
    if (bars[i].close > bars[i - 1].close) obvSeries.push(prev + v);
    else if (bars[i].close < bars[i - 1].close) obvSeries.push(prev - v);
    else obvSeries.push(prev);
  }
  const obvNow = obvSeries[obvSeries.length - 1] || 0;
  const obv20Ago = obvSeries[Math.max(0, obvSeries.length - 21)] || 0;
  const obvDelta = obvNow - obv20Ago;
  const obvThreshold = Math.max(1, avgVolume20 * 1.5);
  const obvTrend: VolumeAnalysis['obvTrend'] =
    obvDelta > obvThreshold
      ? 'Accumulation'
      : obvDelta < -obvThreshold
      ? 'Distribution'
      : 'Neutral';

  const vwap20 = bars[n - 1]?.vwap20 ?? null;
  const vwapDistancePct =
    vwap20 && vwap20 > 0 ? round2(((livePrice - vwap20) / vwap20) * 100) : null;

  let score = 0;
  if (upDownVolumeRatio >= 1.35) score += 2;
  else if (upDownVolumeRatio >= 1.1) score += 1;
  else if (upDownVolumeRatio <= 0.72) score -= 2;
  else if (upDownVolumeRatio <= 0.9) score -= 1;

  if (obvTrend === 'Accumulation') score += 1;
  else if (obvTrend === 'Distribution') score -= 1;

  if (rvol >= 1.25 && bars[n - 1] && bars[n - 1].close >= bars[n - 1].open) score += 1;
  else if (rvol >= 1.25 && bars[n - 1] && bars[n - 1].close < bars[n - 1].open) score -= 1;

  const rating: VolumeAnalysis['rating'] =
    score >= 3
      ? 'Strong Accumulation'
      : score >= 1
      ? 'Accumulation'
      : score <= -3
      ? 'Heavy Distribution'
      : score <= -1
      ? 'Distribution'
      : 'Neutral';

  return {
    currentVolume: liveVolume,
    avgVolume20,
    avgVolume50,
    rvol,
    rvol5d,
    dollarVolume,
    upVolume20,
    downVolume20,
    upDownVolumeRatio,
    obvTrend,
    vwap20,
    vwapDistancePct,
    spikeDays20,
    rating,
  };
}

export function detectChartPatterns(bars: OHLCVBar[], rvol: number): DetectedPattern[] {
  if (bars.length < 25) return [];

  const all: DetectedPattern[] = [
    ...detectTrianglesAndWedges(bars, rvol),
    ...detectFlags(bars, rvol),
    ...detectDoubleTopBottom(bars, rvol),
    ...detectCupAndHandle(bars, rvol),
    ...detectHeadAndShoulders(bars, rvol),
    ...detectParabolaCurve(bars, rvol),
    ...detectHorizontalBox(bars, rvol),
  ];

  // Deduplicate by PatternType keeping highest fitScore (breakouts weighted slightly higher)
  const stageBonus = (s: PatternStage) => (s === 'Breakout' ? 6 : s === 'Testing Level' ? 3 : 0);
  const byType = new Map<PatternType, DetectedPattern>();

  for (const p of all) {
    const existing = byType.get(p.type);
    if (!existing || p.fitScore + stageBonus(p.stage) > existing.fitScore + stageBonus(existing.stage)) {
      byType.set(p.type, p);
    }
  }

  return Array.from(byType.values()).sort(
    (a, b) => b.fitScore + stageBonus(b.stage) - (a.fitScore + stageBonus(a.stage))
  );
}

export function detectHistoricalPatterns(
  bars: OHLCVBar[],
  activePatterns: DetectedPattern[]
): HistoricalPatternInstance[] {
  const n = bars.length;
  if (n < 52) return [];

  const step = n <= 180 ? 2 : 3;
  const maxEndIdx = n - 9;
  const activeByType = new Map<PatternType, DetectedPattern>();
  for (const ap of activePatterns) {
    activeByType.set(ap.type, ap);
  }

  const stagePriority = (s: PatternStage) => (s === 'Breakout' ? 3 : s === 'Testing Level' ? 2 : 1);

  const candidatesByType = new Map<PatternType, DetectedPattern[]>();

  for (let endIdx = 36; endIdx <= maxEndIdx; endIdx += step) {
    // Compute local RVOL at endIdx
    let volSum = 0;
    let volCnt = 0;
    for (let j = Math.max(0, endIdx - 20); j < endIdx; j++) {
      if (bars[j].volume > 0) {
        volSum += bars[j].volume;
        volCnt++;
      }
    }
    const avgVol = volCnt > 0 ? volSum / volCnt : bars[endIdx].volume;
    const localRvol = avgVol > 0 ? round2(bars[endIdx].volume / avgVol) : 1;

    const prefix = bars.slice(0, endIdx + 1);
    const detected = detectChartPatterns(prefix, localRvol);

    for (const pat of detected) {
      // Skip if this historical window overlaps substantially with the currently active instance of the same pattern
      const active = activeByType.get(pat.type);
      if (active) {
        const overlap = Math.min(pat.endIndex, active.endIndex) - Math.max(pat.startIndex, active.startIndex);
        const minLen = Math.max(1, Math.min(pat.endIndex - pat.startIndex, active.endIndex - active.startIndex));
        if (Math.abs(pat.endIndex - active.endIndex) < 10 || overlap / minLen > 0.55) {
          continue;
        }
      }

      const list = candidatesByType.get(pat.type) || [];
      list.push(pat);
      candidatesByType.set(pat.type, list);
    }
  }

  const allInstances: HistoricalPatternInstance[] = [];

  for (const [, rawList] of candidatesByType.entries()) {
    // Cluster overlapping detections of the same PatternType into distinct historical episodes
    const clusters: DetectedPattern[][] = [];
    for (const det of rawList) {
      const matchCluster = clusters.find((cluster) =>
        cluster.some((existing) => {
          if (Math.abs(det.endIndex - existing.endIndex) <= 10) return true;
          const overlap = Math.min(det.endIndex, existing.endIndex) - Math.max(det.startIndex, existing.startIndex);
          const minLen = Math.max(
            1,
            Math.min(det.endIndex - det.startIndex, existing.endIndex - existing.startIndex)
          );
          return overlap / minLen >= 0.4;
        })
      );

      if (matchCluster) {
        matchCluster.push(det);
      } else {
        clusters.push([det]);
      }
    }

    // Pick best representative per episode (prefer Breakouts, then highest fitScore)
    const episodeBest: DetectedPattern[] = clusters.map((cluster) => {
      return [...cluster].sort((a, b) => {
        const spDiff = stagePriority(b.stage) - stagePriority(a.stage);
        if (spDiff !== 0) return spDiff;
        return b.fitScore - a.fitScore;
      })[0];
    });

    // Sort newest-first and retain up to 6 historical episodes per pattern type
    episodeBest.sort((a, b) => b.endIndex - a.endIndex);
    const kept = episodeBest.slice(0, 6);

    for (const pat of kept) {
      const endIdx = pat.endIndex;
      const startIdx = Math.max(0, pat.startIndex);
      const anchorPrice = bars[endIdx].close;
      if (anchorPrice <= 0) continue;

      const forwardEnd = Math.min(n - 1, endIdx + 25);
      let outcome: HistoricalPatternOutcome = 'Open / Mixed';
      let barsToOutcome: number | null = null;
      let maxFav = 0;
      let maxAdv = 0;

      const isBearish = pat.bias === 'Bearish';
      for (let i = endIdx + 1; i <= forwardEnd; i++) {
        const bar = bars[i];
        const favMove = isBearish
          ? ((anchorPrice - bar.low) / anchorPrice) * 100
          : ((bar.high - anchorPrice) / anchorPrice) * 100;
        const advMove = isBearish
          ? ((bar.high - anchorPrice) / anchorPrice) * 100
          : ((anchorPrice - bar.low) / anchorPrice) * 100;

        if (favMove > maxFav) maxFav = favMove;
        if (advMove > maxAdv) maxAdv = advMove;

        if (outcome === 'Open / Mixed') {
          if (isBearish) {
            if (bar.low <= pat.targetPrice) {
              outcome = 'Target Hit';
              barsToOutcome = i - endIdx;
            } else if (bar.high >= pat.stopPrice) {
              outcome = 'Stopped Out';
              barsToOutcome = i - endIdx;
            }
          } else {
            if (bar.high >= pat.targetPrice) {
              outcome = 'Target Hit';
              barsToOutcome = i - endIdx;
            } else if (bar.low <= pat.stopPrice) {
              outcome = 'Stopped Out';
              barsToOutcome = i - endIdx;
            }
          }
        }
      }

      const fwdReturn = (offset: number): number | null => {
        const idx = endIdx + offset;
        if (idx >= n) return null;
        return round2(((bars[idx].close - anchorPrice) / anchorPrice) * 100);
      };

      const analogStart = Math.max(startIdx, endIdx - 28);
      const analogEnd = Math.min(n - 1, endIdx + 20);
      const analogCurve: HistoricalAnalogPoint[] = [];
      for (let i = analogStart; i <= analogEnd; i++) {
        analogCurve.push({
          relIndex: i - endIdx,
          pctFromAnchor: round2(((bars[i].close - anchorPrice) / anchorPrice) * 100),
        });
      }

      allInstances.push({
        id: `hist-${pat.type.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${endIdx}`,
        type: pat.type,
        category: pat.category,
        bias: pat.bias,
        stage: pat.stage,
        fitScore: pat.fitScore,
        startIndex: startIdx,
        endIndex: endIdx,
        startDateLabel: bars[startIdx]?.dateLabel || '',
        endDateLabel: bars[endIdx]?.dateLabel || '',
        anchorPrice: round2(anchorPrice),
        breakoutPrice: pat.breakoutPrice,
        targetPrice: pat.targetPrice,
        stopPrice: pat.stopPrice,
        outcome,
        barsToOutcome,
        forwardReturn5Pct: fwdReturn(5),
        forwardReturn10Pct: fwdReturn(10),
        forwardReturn20Pct: fwdReturn(20),
        maxFavorablePct: round2(maxFav),
        maxAdversePct: round2(-maxAdv),
        lines: pat.lines,
        keyPivots: pat.keyPivots,
        analogCurve,
      });
    }
  }

  return allInstances.sort((a, b) => b.endIndex - a.endIndex);
}

export interface OptionsIvSnapshot {
  atmIvPct: number;
  atmCallIvPct: number | null;
  atmPutIvPct: number | null;
  skewPct: number | null;
  expiryLabel: string | null;
}

function getPeriodsPerYear(timeframe: Timeframe): number {
  switch (timeframe) {
    case '1m':
      return 252 * 390;
    case '15m':
      return 252 * 26;
    case '1h':
      return 252 * 6.5;
    case '4h':
      return 252 * 2;
    case '1wk':
      return 52;
    case '1mo':
      return 12;
    case '1d':
    default:
      return 252;
  }
}

export function computeVolatilityAnalysis(
  bars: OHLCVBar[],
  timeframe: Timeframe,
  optionsIv?: OptionsIvSnapshot | null
): VolatilityAnalysis {
  const n = bars.length;
  const lastClose = bars[n - 1]?.close || 1;

  // True Range series
  const trSeries: number[] = [];
  const trPctSeries: number[] = [];
  for (let i = 1; i < n; i++) {
    const tr = Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - bars[i - 1].close),
      Math.abs(bars[i].low - bars[i - 1].close)
    );
    trSeries.push(tr);
    trPctSeries.push(bars[i].close > 0 ? (tr / bars[i].close) * 100 : 0);
  }

  const avgLast = (arr: number[], period: number): number => {
    if (arr.length === 0) return 0;
    const k = Math.min(period, arr.length);
    let sum = 0;
    for (let i = arr.length - k; i < arr.length; i++) sum += arr[i];
    return sum / k;
  };

  const atr14Raw = avgLast(trSeries, 14);
  const atr5Raw = avgLast(trSeries, 5);
  const atr14 = round2(atr14Raw);
  const atr5 = round2(atr5Raw);
  const atr14Pct = round2((atr14Raw / lastClose) * 100);
  const atr5Pct = round2((atr5Raw / lastClose) * 100);
  const atrRatio = atr14Raw > 0 ? round2(atr5Raw / atr14Raw) : 1;
  const atrTrend: VolatilityAnalysis['atrTrend'] =
    atrRatio >= 1.15 ? 'Expanding' : atrRatio <= 0.85 ? 'Compressing' : 'Normal';

  // Rolling 14-bar ATR% distribution over trailing 252 bars
  const rollingAtrPcts: number[] = [];
  if (trPctSeries.length >= 14) {
    const startIdx = Math.max(13, trPctSeries.length - 252);
    for (let i = startIdx; i < trPctSeries.length; i++) {
      let sum = 0;
      for (let j = i - 13; j <= i; j++) sum += trPctSeries[j];
      rollingAtrPcts.push(sum / 14);
    }
  }
  const atrPercentile =
    rollingAtrPcts.length > 0
      ? Math.round(
          (rollingAtrPcts.filter((v) => v <= atr14Pct).length / rollingAtrPcts.length) * 100
        )
      : 50;

  // Annualized Realized / Historical Volatility (HV20, HV60)
  const logReturns: number[] = [];
  for (let i = 1; i < n; i++) {
    if (bars[i].close > 0 && bars[i - 1].close > 0) {
      logReturns.push(Math.log(bars[i].close / bars[i - 1].close));
    }
  }

  const periodsPerYear = getPeriodsPerYear(timeframe);
  const computeWindowHv = (endIdx: number, win: number): number | null => {
    if (endIdx + 1 < win) return null;
    let sum = 0;
    for (let i = endIdx - win + 1; i <= endIdx; i++) sum += logReturns[i];
    const mean = sum / win;
    let sq = 0;
    for (let i = endIdx - win + 1; i <= endIdx; i++) {
      const d = logReturns[i] - mean;
      sq += d * d;
    }
    const variance = sq / Math.max(1, win - 1);
    return round2(Math.sqrt(variance * periodsPerYear) * 100);
  };

  const hv20Pct = logReturns.length >= 20 ? computeWindowHv(logReturns.length - 1, 20) : null;
  const hv60Pct = logReturns.length >= 60 ? computeWindowHv(logReturns.length - 1, 60) : null;

  const rollingHv20: number[] = [];
  if (logReturns.length >= 20) {
    const hvStart = Math.max(19, logReturns.length - 252);
    for (let i = hvStart; i < logReturns.length; i++) {
      const v = computeWindowHv(i, 20);
      if (v != null) rollingHv20.push(v);
    }
  }

  const hv52wLowPct = rollingHv20.length > 0 ? round2(Math.min(...rollingHv20)) : null;
  const hv52wHighPct = rollingHv20.length > 0 ? round2(Math.max(...rollingHv20)) : null;
  const hvPercentile =
    hv20Pct != null && rollingHv20.length > 0
      ? Math.round((rollingHv20.filter((v) => v <= hv20Pct).length / rollingHv20.length) * 100)
      : null;

  const hasOptionsIv = optionsIv != null && Number.isFinite(optionsIv.atmIvPct);
  const impliedVolatilityPct = hasOptionsIv ? round2(optionsIv!.atmIvPct) : null;
  const ivCallPct = hasOptionsIv && optionsIv!.atmCallIvPct != null ? round2(optionsIv!.atmCallIvPct) : null;
  const ivPutPct = hasOptionsIv && optionsIv!.atmPutIvPct != null ? round2(optionsIv!.atmPutIvPct) : null;
  const ivSkewPct = hasOptionsIv && optionsIv!.skewPct != null ? round2(optionsIv!.skewPct) : null;

  let ivPercentile: number | null = hvPercentile;
  let ivRank: number | null = null;
  if (impliedVolatilityPct != null && rollingHv20.length > 0) {
    ivPercentile = Math.round(
      (rollingHv20.filter((v) => v <= impliedVolatilityPct).length / rollingHv20.length) * 100
    );
    if (hv52wLowPct != null && hv52wHighPct != null && hv52wHighPct > hv52wLowPct) {
      ivRank = Math.round(
        clamp(((impliedVolatilityPct - hv52wLowPct) / (hv52wHighPct - hv52wLowPct)) * 100, 0, 100)
      );
    }
  } else if (hv20Pct != null && hv52wLowPct != null && hv52wHighPct != null && hv52wHighPct > hv52wLowPct) {
    ivRank = Math.round(
      clamp(((hv20Pct - hv52wLowPct) / (hv52wHighPct - hv52wLowPct)) * 100, 0, 100)
    );
  }

  const ivHvSpreadPct =
    impliedVolatilityPct != null && hv20Pct != null ? round2(impliedVolatilityPct - hv20Pct) : null;

  const volForMove = impliedVolatilityPct ?? hv20Pct;
  const expectedMoveWeeklyPct =
    volForMove != null ? round2(volForMove / Math.sqrt(52)) : null;

  const regimePct = ivPercentile ?? atrPercentile;
  const regime: VolatilityAnalysis['regime'] =
    regimePct < 25
      ? 'Low Volatility / Squeeze'
      : regimePct < 60
      ? 'Normal Regime'
      : regimePct < 82
      ? 'Elevated Volatility'
      : 'High Volatility Expansion';

  return {
    atr14,
    atr14Pct,
    atr5,
    atr5Pct,
    atrRatio,
    atrPercentile,
    atrTrend,
    hv20Pct,
    hv60Pct,
    hv52wLowPct,
    hv52wHighPct,
    hvPercentile,
    impliedVolatilityPct,
    ivCallPct,
    ivPutPct,
    ivSkewPct,
    ivPercentile,
    ivRank,
    ivHvSpreadPct,
    expectedMoveWeeklyPct,
    ivSource: hasOptionsIv ? 'Options Chain' : 'Realized Proxy (No Listed Options)',
    optionsExpiryLabel: hasOptionsIv ? optionsIv!.expiryLabel : null,
    regime,
  };
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function computeSeasonalityAnalysis(
  monthlyBars: Array<{ time: number; open: number; close: number }>
): SeasonalityAnalysis | undefined {
  if (monthlyBars.length < 18) return undefined;

  const now = new Date();
  const currentUtcYear = now.getUTCFullYear();
  const currentMonthIdx = now.getUTCMonth();
  const nextMonthIdx = (currentMonthIdx + 1) % 12;

  const buckets: number[][] = Array.from({ length: 12 }, () => []);
  const yearsSeen = new Set<number>();

  for (let i = 1; i < monthlyBars.length; i++) {
    const prev = monthlyBars[i - 1];
    const bar = monthlyBars[i];
    if (!prev || prev.close <= 0 || bar.close <= 0) continue;

    // Shift +14h to align both US (-5/-8) and Asia (+8/+9) month-start timestamps cleanly to UTC month/year
    const aligned = new Date((bar.time + 14 * 3600) * 1000);
    const yr = aligned.getUTCFullYear();
    const mo = aligned.getUTCMonth();

    // Exclude the still-forming partial current calendar month so win-rate/averages stay complete-month accurate
    if (yr === currentUtcYear && mo === currentMonthIdx && monthlyBars.length > 24) {
      continue;
    }

    const retPct = ((bar.close - prev.close) / prev.close) * 100;
    if (!Number.isFinite(retPct)) continue;
    buckets[mo].push(retPct);
    yearsSeen.add(yr);
  }

  const months: SeasonalityMonthStat[] = buckets.map((vals, monthIdx) => {
    const samples = vals.length;
    if (samples === 0) {
      return {
        monthIdx,
        monthLabel: MONTH_LABELS[monthIdx],
        samples: 0,
        winRatePct: 50,
        avgReturnPct: 0,
        medianReturnPct: 0,
        bestReturnPct: 0,
        worstReturnPct: 0,
      };
    }

    const wins = vals.filter((v) => v > 0).length;
    const winRatePct = Math.round((wins / samples) * 100);
    const avgReturnPct = round2(vals.reduce((s, v) => s + v, 0) / samples);
    const sorted = [...vals].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const medianReturnPct =
      sorted.length % 2 === 1 ? round2(sorted[mid]) : round2((sorted[mid - 1] + sorted[mid]) / 2);

    return {
      monthIdx,
      monthLabel: MONTH_LABELS[monthIdx],
      samples,
      winRatePct,
      avgReturnPct,
      medianReturnPct,
      bestReturnPct: round2(sorted[sorted.length - 1]),
      worstReturnPct: round2(sorted[0]),
    };
  });

  const scoreForMonth = (m: SeasonalityMonthStat) => {
    const retScore = clamp(50 + m.avgReturnPct * 4.5, 0, 100);
    return m.winRatePct * 0.55 + retScore * 0.45;
  };

  const curStat = months[currentMonthIdx];
  const nextStat = months[nextMonthIdx];
  const biasScore = Math.round(
    clamp(scoreForMonth(curStat) * 0.6 + scoreForMonth(nextStat) * 0.4, 0, 100)
  );

  const biasLabel: SeasonalityAnalysis['biasLabel'] =
    biasScore >= 68
      ? 'Strong Bullish'
      : biasScore >= 56
      ? 'Seasonal Tailwind'
      : biasScore >= 44
      ? 'Neutral'
      : biasScore >= 32
      ? 'Seasonal Headwind'
      : 'Weak / Bearish';

  const populated = months.filter((m) => m.samples > 0);
  const byBest = [...populated].sort((a, b) => b.avgReturnPct - a.avgReturnPct);
  const bestMonthLabel = byBest[0]
    ? `${byBest[0].monthLabel} (${byBest[0].avgReturnPct >= 0 ? '+' : ''}${byBest[0].avgReturnPct.toFixed(1)}%)`
    : '—';
  const worst = byBest[byBest.length - 1];
  const worstMonthLabel = worst
    ? `${worst.monthLabel} (${worst.avgReturnPct >= 0 ? '+' : ''}${worst.avgReturnPct.toFixed(1)}%)`
    : '—';

  return {
    yearsAnalyzed: yearsSeen.size,
    months,
    currentMonthIdx,
    nextMonthIdx,
    biasScore,
    biasLabel,
    bestMonthLabel,
    worstMonthLabel,
  };
}

