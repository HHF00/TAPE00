import type { OHLCVBar } from '../shared/types.ts';

export interface VolumeProfileBin {
  index: number;
  low: number;
  high: number;
  mid: number;
  upVolume: number;
  downVolume: number;
  totalVolume: number;
  pctOfTotal: number;
  pctOfMax: number;
  inValueArea: boolean;
  isPoc: boolean;
  nodeType: 'POC' | 'HVN' | 'LVN' | 'Normal';
}

export interface VolumeProfileResult {
  startIndex: number;
  endIndex: number;
  startDateLabel: string;
  endDateLabel: string;
  barCount: number;
  rangeLow: number;
  rangeHigh: number;
  binSize: number;
  totalVolume: number;
  maxBinVolume: number;
  pocPrice: number;
  pocVolume: number;
  pocIndex: number;
  vahPrice: number;
  valPrice: number;
  valueAreaVolumePct: number;
  bins: VolumeProfileBin[];
  hvnLevels: number[];
  lvnLevels: number[];
}

export function computeFixedRangeVolumeProfile(
  bars: OHLCVBar[],
  rawStartIndex: number,
  rawEndIndex: number,
  rowCount = 32,
  valueAreaRatio = 0.7
): VolumeProfileResult | null {
  if (!bars || bars.length === 0) return null;

  const clampedA = Math.max(0, Math.min(bars.length - 1, Math.round(rawStartIndex)));
  const clampedB = Math.max(0, Math.min(bars.length - 1, Math.round(rawEndIndex)));
  const startIndex = Math.min(clampedA, clampedB);
  const endIndex = Math.max(clampedA, clampedB);

  const slice = bars.slice(startIndex, endIndex + 1);
  if (slice.length === 0) return null;

  let rangeLow = Infinity;
  let rangeHigh = -Infinity;
  for (const bar of slice) {
    if (bar.low < rangeLow) rangeLow = bar.low;
    if (bar.high > rangeHigh) rangeHigh = bar.high;
  }

  if (!Number.isFinite(rangeLow) || !Number.isFinite(rangeHigh)) return null;
  if (rangeHigh - rangeLow < 1e-6) {
    const pad = Math.max(0.05, rangeLow * 0.005);
    rangeLow -= pad;
    rangeHigh += pad;
  }

  const binsCount = Math.max(12, Math.min(72, rowCount));
  const binSize = (rangeHigh - rangeLow) / binsCount;

  const upVolumes = new Array<number>(binsCount).fill(0);
  const downVolumes = new Array<number>(binsCount).fill(0);

  for (const bar of slice) {
    const vol = Math.max(0, bar.volume);
    if (vol === 0) continue;

    const isUp = bar.close >= bar.open;
    const barSpan = bar.high - bar.low;

    if (barSpan <= 1e-9) {
      const idx = Math.max(
        0,
        Math.min(binsCount - 1, Math.floor((bar.close - rangeLow) / binSize))
      );
      if (isUp) upVolumes[idx] += vol;
      else downVolumes[idx] += vol;
      continue;
    }

    const lowBin = Math.max(0, Math.floor((bar.low - rangeLow) / binSize));
    const highBin = Math.min(binsCount - 1, Math.floor((bar.high - rangeLow) / binSize));

    let totalOverlap = 0;
    const overlaps: Array<{ idx: number; overlap: number }> = [];

    for (let i = lowBin; i <= highBin; i++) {
      const binLow = rangeLow + i * binSize;
      const binHigh = binLow + binSize;
      const overlap = Math.max(0, Math.min(bar.high, binHigh) - Math.max(bar.low, binLow));
      if (overlap > 0) {
        overlaps.push({ idx: i, overlap });
        totalOverlap += overlap;
      }
    }

    if (totalOverlap <= 0) {
      const idx = Math.max(
        0,
        Math.min(binsCount - 1, Math.floor((bar.close - rangeLow) / binSize))
      );
      if (isUp) upVolumes[idx] += vol;
      else downVolumes[idx] += vol;
    } else {
      for (const item of overlaps) {
        const share = vol * (item.overlap / totalOverlap);
        if (isUp) upVolumes[item.idx] += share;
        else downVolumes[item.idx] += share;
      }
    }
  }

  const totalBins = upVolumes.map((u, i) => u + downVolumes[i]);
  const totalVolume = totalBins.reduce((acc, v) => acc + v, 0);
  if (totalVolume <= 0) return null;

  let pocIndex = 0;
  let maxBinVolume = 0;
  for (let i = 0; i < binsCount; i++) {
    if (totalBins[i] > maxBinVolume) {
      maxBinVolume = totalBins[i];
      pocIndex = i;
    }
  }

  // Standard Market Profile Value Area expansion outward from POC
  const targetVaVol = totalVolume * valueAreaRatio;
  let vaLowIdx = pocIndex;
  let vaHighIdx = pocIndex;
  let vaVol = totalBins[pocIndex];

  while (vaVol < targetVaVol && (vaLowIdx > 0 || vaHighIdx < binsCount - 1)) {
    const up1 = vaHighIdx + 1 < binsCount ? totalBins[vaHighIdx + 1] : 0;
    const up2 = vaHighIdx + 2 < binsCount ? totalBins[vaHighIdx + 2] : 0;
    const down1 = vaLowIdx - 1 >= 0 ? totalBins[vaLowIdx - 1] : 0;
    const down2 = vaLowIdx - 2 >= 0 ? totalBins[vaLowIdx - 2] : 0;

    const canGoUp = vaHighIdx < binsCount - 1;
    const canGoDown = vaLowIdx > 0;

    if (!canGoUp && !canGoDown) break;
    if (canGoUp && (!canGoDown || up1 + up2 >= down1 + down2)) {
      if (vaHighIdx + 1 < binsCount) {
        vaHighIdx += 1;
        vaVol += totalBins[vaHighIdx];
      }
      if (vaVol < targetVaVol && vaHighIdx + 1 < binsCount && up2 > down1) {
        vaHighIdx += 1;
        vaVol += totalBins[vaHighIdx];
      }
    } else if (canGoDown) {
      if (vaLowIdx - 1 >= 0) {
        vaLowIdx -= 1;
        vaVol += totalBins[vaLowIdx];
      }
      if (vaVol < targetVaVol && vaLowIdx - 1 >= 0 && down2 > up1) {
        vaLowIdx -= 1;
        vaVol += totalBins[vaLowIdx];
      }
    }
  }

  const bins: VolumeProfileBin[] = [];
  const hvnLevels: number[] = [];
  const lvnLevels: number[] = [];

  for (let i = 0; i < binsCount; i++) {
    const low = rangeLow + i * binSize;
    const high = low + binSize;
    const mid = (low + high) / 2;
    const vol = totalBins[i];
    const pctOfMax = maxBinVolume > 0 ? vol / maxBinVolume : 0;
    const prev = i > 0 ? totalBins[i - 1] : 0;
    const next = i < binsCount - 1 ? totalBins[i + 1] : 0;

    let nodeType: VolumeProfileBin['nodeType'] = 'Normal';
    if (i === pocIndex) {
      nodeType = 'POC';
    } else if (i > 0 && i < binsCount - 1 && vol >= prev && vol >= next && pctOfMax >= 0.55) {
      nodeType = 'HVN';
      hvnLevels.push(mid);
    } else if (i > 1 && i < binsCount - 2 && vol <= prev && vol <= next && pctOfMax <= 0.25) {
      const upperSide = Math.max(totalBins[i + 1], totalBins[i + 2]);
      const lowerSide = Math.max(totalBins[i - 1], totalBins[i - 2]);
      if (upperSide >= maxBinVolume * 0.35 && lowerSide >= maxBinVolume * 0.35) {
        nodeType = 'LVN';
        lvnLevels.push(mid);
      }
    }

    bins.push({
      index: i,
      low,
      high,
      mid,
      upVolume: upVolumes[i],
      downVolume: downVolumes[i],
      totalVolume: vol,
      pctOfTotal: (vol / totalVolume) * 100,
      pctOfMax,
      inValueArea: i >= vaLowIdx && i <= vaHighIdx,
      isPoc: i === pocIndex,
      nodeType,
    });
  }

  const pocPrice = rangeLow + (pocIndex + 0.5) * binSize;
  const valPrice = rangeLow + vaLowIdx * binSize;
  const vahPrice = rangeLow + (vaHighIdx + 1) * binSize;

  return {
    startIndex,
    endIndex,
    startDateLabel: slice[0].dateLabel,
    endDateLabel: slice[slice.length - 1].dateLabel,
    barCount: slice.length,
    rangeLow,
    rangeHigh,
    binSize,
    totalVolume,
    maxBinVolume,
    pocPrice,
    pocVolume: maxBinVolume,
    pocIndex,
    vahPrice,
    valPrice,
    valueAreaVolumePct: (vaVol / totalVolume) * 100,
    bins,
    hvnLevels,
    lvnLevels,
  };
}
