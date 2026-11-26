import * as d3 from 'd3';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type {
  CorporateEvent,
  DetectedPattern,
  HistoricalPatternInstance,
  OHLCVBar,
  PatternLine,
  PatternPoint,
  PriceAlert,
} from '../shared/types.ts';
import type { VolumeProfileBin, VolumeProfileResult } from '../utils/volumeProfile.ts';

export const HISTORICAL_ANALOG_COLORS = [
  '#d97706', // amber-600
  '#7c3aed', // violet-600
  '#0891b2', // cyan-600
  '#db2777', // pink-600
  '#65a30d', // lime-600
  '#ea580c', // orange-600
];

interface PatternChartProps {
  symbol: string;
  bars: OHLCVBar[];
  pattern: DetectedPattern | null;
  showPatternOverlay: boolean;
  showSma20: boolean;
  showSma50: boolean;
  showSma200: boolean;
  showVwap20: boolean;
  showRsi: boolean;
  visibleBarsCount: number;
  historicalInstances?: HistoricalPatternInstance[];
  showHistoricalOverlay?: boolean;
  historicalDisplayMode?: 'analog' | 'timeline';
  volumeProfile?: VolumeProfileResult | null;
  showVolumeProfile?: boolean;
  volumeProfileAnchor?: 'range-left' | 'chart-right';
  isPickingVpRange?: boolean;
  vpPickAnchorIndex?: number | null;
  onSelectVpBar?: (absBarIndex: number) => void;
  onChangeVpBounds?: (startIdx: number, endIdx: number) => void;
  corporateEvents?: CorporateEvent[];
  showEvents?: boolean;
  priceAlerts?: PriceAlert[];
  chartSvgRef?: RefObject<SVGSVGElement | null>;
}

function formatPrice(val: number): string {
  return val >= 1000
    ? val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : val.toFixed(2);
}

function formatVol(vol: number): string {
  if (vol >= 1_000_000_000) return `${(vol / 1_000_000_000).toFixed(2)}B`;
  if (vol >= 1_000_000) return `${(vol / 1_000_000).toFixed(2)}M`;
  if (vol >= 1_000) return `${(vol / 1_000).toFixed(1)}K`;
  return String(vol);
}

function clipLineToStart(points: PatternPoint[], startOffset: number): PatternPoint[] {
  if (points.length === 2 && points[0].index < startOffset && points[1].index > startOffset) {
    const p0 = points[0];
    const p1 = points[1];
    const t = (startOffset - p0.index) / (p1.index - p0.index);
    const interpPrice = p0.price + t * (p1.price - p0.price);
    return [{ index: startOffset, time: p0.time, price: interpPrice }, p1];
  }
  return points.filter((p) => p.index >= startOffset - 2);
}

function computeLineIntersection(
  l1: PatternPoint[],
  l2: PatternPoint[]
): { index: number; price: number } | null {
  if (l1.length < 2 || l2.length < 2) return null;
  const a1 = l1[0];
  const b1 = l1[l1.length - 1];
  const a2 = l2[0];
  const b2 = l2[l2.length - 1];

  const dx1 = b1.index - a1.index;
  const dx2 = b2.index - a2.index;
  if (dx1 === 0 || dx2 === 0) return null;

  const m1 = (b1.price - a1.price) / dx1;
  const c1 = a1.price - m1 * a1.index;
  const m2 = (b2.price - a2.price) / dx2;
  const c2 = a2.price - m2 * a2.index;

  if (Math.abs(m1 - m2) < 1e-6) return null;
  const xInt = (c2 - c1) / (m1 - m2);
  const yInt = m1 * xInt + c1;
  if (!Number.isFinite(xInt) || !Number.isFinite(yInt)) return null;
  return { index: xInt, price: yInt };
}

export function PatternChart({
  symbol,
  bars,
  pattern,
  showPatternOverlay,
  showSma20,
  showSma50,
  showSma200,
  showVwap20,
  showRsi,
  visibleBarsCount,
  historicalInstances = [],
  showHistoricalOverlay = false,
  historicalDisplayMode = 'analog',
  volumeProfile = null,
  showVolumeProfile = false,
  volumeProfileAnchor = 'range-left',
  isPickingVpRange = false,
  vpPickAnchorIndex = null,
  onSelectVpBar,
  onChangeVpBounds,
  corporateEvents = [],
  showEvents = true,
  priceAlerts = [],
  chartSvgRef,
}: PatternChartProps) {
  const internalSvgRef = useRef<SVGSVGElement | null>(null);
  const svgRef = chartSvgRef ?? internalSvgRef;
  const d3OverlayRef = useRef<SVGGElement | null>(null);
  const [hoverRelIdx, setHoverRelIdx] = useState<number | null>(null);
  const [hoverPriceVal, setHoverPriceVal] = useState<number | null>(null);
  const [hoveredEventId, setHoveredEventId] = useState<string | null>(null);
  const [draggingEdge, setDraggingEdge] = useState<'start' | 'end' | null>(null);

  const width = 1280;
  const priceHeight = showRsi ? 380 : 480;
  const rsiHeight = showRsi ? 102 : 0;
  const xAxisHeight = 26;
  const totalHeight = priceHeight + rsiHeight + xAxisHeight;

  const padLeft = 16;
  const padRight = 76;
  const padTop = 18;
  const padBottom = 14;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = priceHeight - padTop - padBottom;
  const rightEdgeX = padLeft + plotWidth;

  const startOffset = Math.max(0, bars.length - visibleBarsCount);
  const visibleBars = useMemo(() => bars.slice(startOffset), [bars, startOffset]);
  const count = Math.max(1, visibleBars.length);

  const hasActiveHistorical = showHistoricalOverlay && historicalInstances.length > 0;
  const isAnalogMode = hasActiveHistorical && historicalDisplayMode === 'analog';
  const analogAnchorIdx =
    pattern && showPatternOverlay ? pattern.endIndex : Math.max(0, bars.length - 1);
  const analogAnchorPrice =
    pattern && showPatternOverlay
      ? pattern.breakoutPrice
      : bars[bars.length - 1]?.close || 1;

  const { minPrice, maxPrice, maxVol } = useMemo(() => {
    let minP = Infinity;
    let maxP = -Infinity;
    let maxV = 1;

    for (const b of visibleBars) {
      if (b.low < minP) minP = b.low;
      if (b.high > maxP) maxP = b.high;
      if (showSma20 && b.sma20 != null) {
        minP = Math.min(minP, b.sma20);
        maxP = Math.max(maxP, b.sma20);
      }
      if (showSma50 && b.sma50 != null) {
        minP = Math.min(minP, b.sma50);
        maxP = Math.max(maxP, b.sma50);
      }
      if (showSma200 && b.sma200 != null) {
        minP = Math.min(minP, b.sma200);
        maxP = Math.max(maxP, b.sma200);
      }
      if (showVwap20 && b.vwap20 != null) {
        minP = Math.min(minP, b.vwap20);
        maxP = Math.max(maxP, b.vwap20);
      }
      if (b.volume > maxV) maxV = b.volume;
    }

    if (pattern && showPatternOverlay) {
      minP = Math.min(minP, pattern.stopPrice, pattern.breakoutPrice);
      maxP = Math.max(maxP, pattern.breakoutPrice);
      if (pattern.targetPrice > 0 && pattern.targetPrice < maxP * 1.28) {
        maxP = Math.max(maxP, pattern.targetPrice);
      }
      if (pattern.targetPrice > 0 && pattern.targetPrice > minP * 0.72) {
        minP = Math.min(minP, pattern.targetPrice);
      }
    }

    if (isAnalogMode && analogAnchorPrice > 0) {
      const baseMin = minP;
      const baseMax = maxP;
      for (const inst of historicalInstances) {
        for (const pt of inst.analogCurve) {
          const projected = analogAnchorPrice * (1 + pt.pctFromAnchor / 100);
          if (projected > baseMin * 0.72 && projected < baseMax * 1.32) {
            minP = Math.min(minP, projected);
            maxP = Math.max(maxP, projected);
          }
        }
      }
    }

    if (hasActiveHistorical) {
      for (const inst of historicalInstances) {
        if (inst.endIndex >= startOffset && inst.startIndex < bars.length) {
          for (const kp of inst.keyPivots) {
            if (kp.index >= startOffset && kp.index < bars.length) {
              minP = Math.min(minP, kp.price);
              maxP = Math.max(maxP, kp.price);
            }
          }
        }
      }
    }

    const span = Math.max(0.5, maxP - minP);
    return {
      minPrice: minP - span * 0.08,
      maxPrice: maxP + span * 0.08,
      maxVol: maxV,
    };
  }, [
    visibleBars,
    bars.length,
    startOffset,
    pattern,
    showPatternOverlay,
    showSma20,
    showSma50,
    showSma200,
    showVwap20,
    hasActiveHistorical,
    isAnalogMode,
    analogAnchorPrice,
    historicalInstances,
  ]);

  // D3 Linear Scales
  const { xRelScale, xAbsScale, yScale, volScale, rsiScale, stepX, candleWidth } = useMemo(() => {
    const rightMarginSlots = isAnalogMode ? 22 : 5;
    const slots = count + rightMarginSlots;
    const xRel = d3.scaleLinear().domain([-0.5, slots - 0.5]).range([padLeft, rightEdgeX]);
    const xAbs = d3
      .scaleLinear()
      .domain([startOffset - 0.5, startOffset + slots - 0.5])
      .range([padLeft, rightEdgeX]);
    const y = d3.scaleLinear().domain([minPrice, maxPrice]).range([padTop + plotHeight, padTop]);
    const v = d3.scaleLinear().domain([0, maxVol]).range([0, plotHeight * 0.17]);
    const r = d3
      .scaleLinear()
      .domain([0, 100])
      .range([priceHeight + rsiHeight - 8, priceHeight + 12]);
    const step = plotWidth / slots;
    const cw = Math.max(2.4, Math.min(12, step * 0.68));
    return {
      xRelScale: xRel,
      xAbsScale: xAbs,
      yScale: y,
      volScale: v,
      rsiScale: r,
      stepX: step,
      candleWidth: cw,
    };
  }, [
    count,
    startOffset,
    minPrice,
    maxPrice,
    maxVol,
    plotWidth,
    plotHeight,
    priceHeight,
    rsiHeight,
    rightEdgeX,
    isAnalogMode,
  ]);

  // D3 Line Paths for Indicators
  const sma20Path = useMemo(() => {
    if (!showSma20) return '';
    return (
      d3
        .line<OHLCVBar>()
        .defined((d) => d.sma20 != null)
        .x((_d, i) => xRelScale(i))
        .y((d) => yScale(d.sma20!))(visibleBars) || ''
    );
  }, [showSma20, visibleBars, xRelScale, yScale]);

  const sma50Path = useMemo(() => {
    if (!showSma50) return '';
    return (
      d3
        .line<OHLCVBar>()
        .defined((d) => d.sma50 != null)
        .x((_d, i) => xRelScale(i))
        .y((d) => yScale(d.sma50!))(visibleBars) || ''
    );
  }, [showSma50, visibleBars, xRelScale, yScale]);

  const sma200Path = useMemo(() => {
    if (!showSma200) return '';
    return (
      d3
        .line<OHLCVBar>()
        .defined((d) => d.sma200 != null)
        .x((_d, i) => xRelScale(i))
        .y((d) => yScale(d.sma200!))(visibleBars) || ''
    );
  }, [showSma200, visibleBars, xRelScale, yScale]);

  const vwap20Path = useMemo(() => {
    if (!showVwap20) return '';
    return (
      d3
        .line<OHLCVBar>()
        .defined((d) => d.vwap20 != null)
        .x((_d, i) => xRelScale(i))
        .y((d) => yScale(d.vwap20!))(visibleBars) || ''
    );
  }, [showVwap20, visibleBars, xRelScale, yScale]);

  const rsiPath = useMemo(() => {
    if (!showRsi) return '';
    return (
      d3
        .line<OHLCVBar>()
        .defined((d) => d.rsi14 != null)
        .x((_d, i) => xRelScale(i))
        .y((d) => rsiScale(d.rsi14!))(visibleBars) || ''
    );
  }, [showRsi, visibleBars, xRelScale, rsiScale]);

  // D3.js Pattern Geometry + Historical Backtest Overlay Engine
  useEffect(() => {
    const container = d3OverlayRef.current;
    if (!container) return;

    const root = d3.select(container);
    root.selectAll('*').remove();

    const lastAbsIdx = bars.length - 1;
    const lastBarX = xAbsScale(lastAbsIdx);

    // A. Historical Pattern Visual Backtesting Overlays (Full Chart Geometry + Analog Projection / Timeline)
    if (showHistoricalOverlay && historicalInstances.length > 0) {
      const histGroup = root.append('g').attr('class', 'd3-historical-backtest');

      const pricePrefix =
        symbol.endsWith('.KL') ? 'RM ' : symbol.startsWith('^') || symbol.startsWith('MYIDX:') ? '' : '$';

      const getPivotTag = (inst: HistoricalPatternInstance, pIdx: number): string => {
        if (inst.type === 'Double Bottom') {
          return pIdx === 0 ? 'B1' : pIdx === 1 ? 'Neck' : pIdx === 2 ? 'B2' : `P${pIdx + 1}`;
        }
        if (inst.type === 'Double Top') {
          return pIdx === 0 ? 'T1' : pIdx === 1 ? 'Neck' : pIdx === 2 ? 'T2' : `P${pIdx + 1}`;
        }
        if (inst.type === 'Head & Shoulders' || inst.type === 'Inverse Head & Shoulders') {
          return pIdx === 0 ? 'LS' : pIdx === 1 ? 'Head' : pIdx === 2 ? 'RS' : `P${pIdx + 1}`;
        }
        if (inst.type === 'Cup & Handle') {
          return pIdx === 0 ? 'L-Rim' : pIdx === 1 ? 'Cup' : pIdx === 2 ? 'R-Rim' : `P${pIdx + 1}`;
        }
        return `P${pIdx + 1}`;
      };

      const buildRenderLines = (inst: HistoricalPatternInstance): PatternLine[] => {
        const lines = [...inst.lines];
        const hasPath = lines.some(
          (l) => l.label.includes('W-Path') || l.label.includes('M-Path') || l.points.length >= 3
        );
        if (!hasPath && (inst.type === 'Double Bottom' || inst.type === 'Double Top') && inst.keyPivots.length >= 3) {
          const [p1, neck, p2] = inst.keyPivots;
          const endBar = bars[Math.min(bars.length - 1, inst.endIndex)];
          lines.push({
            label: inst.type === 'Double Bottom' ? 'Double Bottom W-Path' : 'Double Top M-Path',
            role: 'pole',
            points: [
              p1,
              neck,
              p2,
              {
                index: inst.endIndex,
                time: endBar?.time || p2.time,
                price: inst.breakoutPrice,
              },
            ],
          });
        }
        return lines;
      };

      const renderHistoricalStructure = (
        inst: HistoricalPatternInstance,
        color: string,
        opts: {
          mode: 'actual' | 'projected';
          mapIndex: (idx: number) => number;
          mapPrice: (p: number) => number;
          opacityScale?: number;
        }
      ) => {
        const { mode, mapIndex, mapPrice, opacityScale = 1 } = opts;
        const linesToDraw = buildRenderLines(inst);

        // 1. Shaded structural enclosure (Triangles, Wedges, Flags, Boxes, Cup & Handle, Double Top/Bottom)
        const upper =
          linesToDraw.find((l) => l.role === 'resistance') ||
          linesToDraw.find((l) => l.role === 'neckline');
        const lower =
          linesToDraw.find((l) => l.role === 'support') ||
          (upper?.role === 'resistance' ? linesToDraw.find((l) => l.role === 'neckline') : undefined);

        if (inst.type === 'Cup & Handle') {
          const cupArc = linesToDraw.find((l) => l.label === 'Cup Base Arc');
          if (cupArc && cupArc.points.length >= 3) {
            const pts = cupArc.points
              .map((p) => ({ index: mapIndex(p.index), time: p.time, price: mapPrice(p.price) }))
              .filter((p) => p.index >= startOffset - 2);
            if (pts.length >= 2) {
              const cupArea = d3
                .area<PatternPoint>()
                .curve(d3.curveMonotoneX)
                .x((d) => xAbsScale(d.index))
                .y0(() => yScale(mapPrice(inst.breakoutPrice)))
                .y1((d) => yScale(d.price));
              histGroup
                .append('path')
                .datum(pts)
                .attr('d', cupArea)
                .attr('fill', color)
                .attr('opacity', 0.1 * opacityScale);
            }
          }
        } else if (upper && lower && upper.points.length >= 2 && lower.points.length >= 2) {
          const u0 = upper.points[0];
          const u1 = upper.points[upper.points.length - 1];
          const l0 = lower.points[0];
          const l1 = lower.points[lower.points.length - 1];
          const polyMapped = [
            { idx: mapIndex(u0.index), price: mapPrice(u0.price) },
            { idx: mapIndex(u1.index), price: mapPrice(u1.price) },
            { idx: mapIndex(l1.index), price: mapPrice(l1.price) },
            { idx: mapIndex(l0.index), price: mapPrice(l0.price) },
          ];
          if (polyMapped.some((p) => p.idx >= startOffset)) {
            const polyPts = polyMapped.map((p) => [
              Math.max(padLeft, Math.min(rightEdgeX, xAbsScale(p.idx))),
              Math.max(padTop, Math.min(padTop + plotHeight, yScale(p.price))),
            ]);
            histGroup
              .append('polygon')
              .attr('points', polyPts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' '))
              .attr('fill', color)
              .attr('opacity', 0.09 * opacityScale);
          }
        }

        // 2. Pattern lines, W/M structural paths, necklines & arcs
        for (const line of linesToDraw) {
          const mappedPts = line.points
            .map((p) => ({
              index: mapIndex(p.index),
              time: p.time,
              price: mapPrice(p.price),
            }))
            .filter((p) => p.index >= startOffset - 2 && p.index <= startOffset + count + 24);

          if (mappedPts.length < 2) continue;

          const isPrimaryShape =
            line.label.includes('W-Path') ||
            line.label.includes('M-Path') ||
            line.label === 'Cup Base Arc' ||
            line.label === 'Parabolic Arc' ||
            line.label.includes('Structure');

          const useCurve =
            Boolean(line.curved) || (line.dashed && inst.type === 'Cup & Handle');

          const lineGen = d3
            .line<PatternPoint>()
            .curve(useCurve ? d3.curveMonotoneX : d3.curveLinear)
            .x((d) => Math.max(padLeft, Math.min(rightEdgeX, xAbsScale(d.index))))
            .y((d) => Math.max(padTop + 2, Math.min(padTop + plotHeight - 2, yScale(d.price))));

          histGroup
            .append('path')
            .datum(mappedPts)
            .attr('d', lineGen)
            .attr('fill', 'none')
            .attr('stroke', color)
            .attr('stroke-width', isPrimaryShape ? 2.4 : 1.7)
            .attr('stroke-linecap', 'round')
            .attr('stroke-linejoin', 'round')
            .attr('stroke-dasharray', isPrimaryShape ? (mode === 'projected' ? '5 3' : null) : '5 3')
            .attr('opacity', (isPrimaryShape ? 0.95 : 0.8) * opacityScale);

          // Inline label on key boundary lines in actual mode
          if (mode === 'actual' && !isPrimaryShape && line.label) {
            const first = mappedPts[0];
            const last = mappedPts[mappedPts.length - 1];
            const lx = Math.max(
              padLeft + 36,
              Math.min(rightEdgeX - 36, (xAbsScale(first.index) + xAbsScale(last.index)) / 2)
            );
            const ly = Math.max(
              padTop + 12,
              Math.min(
                padTop + plotHeight - 6,
                (yScale(first.price) + yScale(last.price)) / 2 +
                  (line.role === 'resistance' || line.role === 'neckline' ? -7 : 13)
              )
            );
            histGroup
              .append('text')
              .attr('x', lx)
              .attr('y', ly)
              .attr('text-anchor', 'middle')
              .attr('fill', color)
              .attr('font-size', '9px')
              .attr('font-weight', '600')
              .attr('font-family', 'JetBrains Mono, ui-monospace, monospace')
              .style('paint-order', 'stroke')
              .style('stroke', 'var(--chart-label-halo, rgba(255,255,255,0.92))')
              .style('stroke-width', '3px')
              .attr('opacity', 0.9 * opacityScale)
              .text(line.label);
          }
        }

        // 3. Key Pivot nodes (B1 / Neck / B2, T1 / Neck / T2, LS / Head / RS, etc.)
        inst.keyPivots.forEach((kp, pIdx) => {
          const mIdx = mapIndex(kp.index);
          const mPrice = mapPrice(kp.price);
          if (mIdx < startOffset || mIdx > startOffset + count + 22) return;
          const px = xAbsScale(mIdx);
          const py = yScale(mPrice);
          if (py < padTop || py > padTop + plotHeight) return;

          histGroup
            .append('circle')
            .attr('cx', px)
            .attr('cy', py)
            .attr('r', mode === 'actual' ? 4.2 : 3.2)
            .attr('fill', '#ffffff')
            .attr('stroke', color)
            .attr('stroke-width', 2)
            .attr('opacity', opacityScale);

          if (mode === 'actual') {
            const bar = bars[Math.round(mIdx)];
            const isHigh = bar
              ? Math.abs(mPrice - bar.high) <= Math.abs(mPrice - bar.low)
              : pIdx % 2 === 1;
            const tag = getPivotTag(inst, pIdx);
            histGroup
              .append('text')
              .attr('x', px)
              .attr('y', Math.max(padTop + 11, Math.min(padTop + plotHeight - 5, py + (isHigh ? -8 : 14))))
              .attr('text-anchor', 'middle')
              .attr('fill', color)
              .attr('font-size', '9px')
              .attr('font-weight', '700')
              .attr('font-family', 'JetBrains Mono, ui-monospace, monospace')
              .style('paint-order', 'stroke')
              .style('stroke', 'var(--chart-label-halo, rgba(255,255,255,0.94))')
              .style('stroke-width', '3px')
              .text(`${tag} ${pricePrefix}${formatPrice(mPrice)}`);
          }
        });

        // 4. Actual historical outcome bracket, Target/Stop ticks & Header Callout
        if (mode === 'actual' && inst.endIndex >= startOffset && inst.endIndex < bars.length) {
          const endX = xAbsScale(inst.endIndex);
          const bar = bars[inst.endIndex];
          const bracketEndX = xAbsScale(Math.min(bars.length - 1, inst.endIndex + 14));

          // Target & Stop outcome ticks right after historical pattern trigger
          if (inst.targetPrice >= minPrice && inst.targetPrice <= maxPrice) {
            const yt = yScale(inst.targetPrice);
            histGroup
              .append('line')
              .attr('x1', endX)
              .attr('y1', yt)
              .attr('x2', bracketEndX)
              .attr('y2', yt)
              .attr('stroke', '#059669')
              .attr('stroke-width', 1.25)
              .attr('stroke-dasharray', '3 2')
              .attr('opacity', 0.8);
          }
          if (inst.stopPrice >= minPrice && inst.stopPrice <= maxPrice) {
            const ys = yScale(inst.stopPrice);
            histGroup
              .append('line')
              .attr('x1', endX)
              .attr('y1', ys)
              .attr('x2', bracketEndX)
              .attr('y2', ys)
              .attr('stroke', '#e11d48')
              .attr('stroke-width', 1.25)
              .attr('stroke-dasharray', '3 2')
              .attr('opacity', 0.8);
          }

          histGroup
            .append('circle')
            .attr('cx', endX)
            .attr('cy', yScale(bar.close))
            .attr('r', 4.5)
            .attr('fill', color)
            .attr('stroke', '#ffffff')
            .attr('stroke-width', 1.4);

          const ret = inst.forwardReturn20Pct ?? inst.forwardReturn10Pct ?? inst.forwardReturn5Pct;
          const retTxt = ret != null ? ` ${ret >= 0 ? '+' : ''}${ret.toFixed(1)}%` : '';
          const topY = Math.max(padTop + 13, yScale(bar.high) - 12);

          histGroup
            .append('text')
            .attr('x', Math.max(padLeft + 70, Math.min(rightEdgeX - 70, endX)))
            .attr('y', topY)
            .attr('text-anchor', 'middle')
            .attr('fill', color)
            .attr('font-size', '9.5px')
            .attr('font-weight', '700')
            .attr('font-family', 'JetBrains Mono, ui-monospace, monospace')
            .style('paint-order', 'stroke')
            .style('stroke', 'var(--chart-label-halo, rgba(255,255,255,0.94))')
            .style('stroke-width', '3.5px')
            .text(`${inst.type} · ${inst.endDateLabel.split(',')[0]} · ${inst.outcome}${retTxt}`);
        }
      };

      // Pass 1: ALWAYS draw the actual historical pattern geometry on its candlesticks when visible in chart range
      historicalInstances.forEach((inst, idx) => {
        if (inst.endIndex < startOffset || inst.startIndex >= bars.length) return;
        const color = HISTORICAL_ANALOG_COLORS[idx % HISTORICAL_ANALOG_COLORS.length];
        renderHistoricalStructure(inst, color, {
          mode: 'actual',
          mapIndex: (i) => i,
          mapPrice: (p) => p,
        });
      });

      // Pass 2: In Analog Projection mode, also render forward +5B..+20B analog trajectories and rescaled pattern geometry at T0
      if (historicalDisplayMode === 'analog') {
        const anchorX = xAbsScale(analogAnchorIdx);
        const anchorY = yScale(analogAnchorPrice);

        // Projection horizon guide (+5B, +10B, +15B, +20B)
        histGroup
          .append('line')
          .attr('x1', anchorX)
          .attr('y1', padTop)
          .attr('x2', anchorX)
          .attr('y2', padTop + plotHeight)
          .attr('stroke', '#94a3b8')
          .attr('stroke-width', 1)
          .attr('stroke-dasharray', '2 3')
          .attr('opacity', 0.65);

        for (const offset of [5, 10, 15, 20]) {
          const gx = xAbsScale(analogAnchorIdx + offset);
          if (gx <= rightEdgeX - 8) {
            histGroup
              .append('line')
              .attr('x1', gx)
              .attr('y1', padTop + 14)
              .attr('x2', gx)
              .attr('y2', padTop + plotHeight)
              .attr('stroke', '#94a3b8')
              .attr('stroke-width', 0.75)
              .attr('stroke-dasharray', '2 4')
              .attr('opacity', 0.35);

            histGroup
              .append('text')
              .attr('x', gx)
              .attr('y', padTop + 10)
              .attr('text-anchor', 'middle')
              .attr('fill', '#64748b')
              .attr('font-size', '9px')
              .attr('font-family', 'JetBrains Mono, ui-monospace, monospace')
              .text(`+${offset}B`);
          }
        }

        // Composite mean trajectory + min/max envelope when >= 2 instances selected
        if (historicalInstances.length >= 2) {
          const bandStats: Array<{
            rel: number;
            meanPrice: number;
            minP: number;
            maxP: number;
            meanPct: number;
          }> = [];

          for (let rel = 0; rel <= 20; rel++) {
            const vals: number[] = [];
            for (const inst of historicalInstances) {
              const found = inst.analogCurve.find((pt) => pt.relIndex === rel);
              if (found) vals.push(found.pctFromAnchor);
            }
            if (vals.length >= 2) {
              const meanPct = vals.reduce((a, b) => a + b, 0) / vals.length;
              const minPct = Math.min(...vals);
              const maxPct = Math.max(...vals);
              bandStats.push({
                rel,
                meanPct,
                meanPrice: analogAnchorPrice * (1 + meanPct / 100),
                minP: analogAnchorPrice * (1 + minPct / 100),
                maxP: analogAnchorPrice * (1 + maxPct / 100),
              });
            }
          }

          if (bandStats.length >= 2) {
            const areaGen = d3
              .area<typeof bandStats[number]>()
              .curve(d3.curveMonotoneX)
              .x((d) => xAbsScale(analogAnchorIdx + d.rel))
              .y0((d) => Math.max(padTop, Math.min(padTop + plotHeight, yScale(d.minP))))
              .y1((d) => Math.max(padTop, Math.min(padTop + plotHeight, yScale(d.maxP))));

            histGroup
              .append('path')
              .datum(bandStats)
              .attr('d', areaGen)
              .attr('fill', 'rgba(217, 119, 6, 0.08)')
              .attr('stroke', 'none');

            const meanGen = d3
              .line<typeof bandStats[number]>()
              .curve(d3.curveMonotoneX)
              .x((d) => xAbsScale(analogAnchorIdx + d.rel))
              .y((d) => Math.max(padTop, Math.min(padTop + plotHeight, yScale(d.meanPrice))));

            histGroup
              .append('path')
              .datum(bandStats)
              .attr('d', meanGen)
              .attr('fill', 'none')
              .attr('stroke', '#b45309')
              .attr('stroke-width', 2)
              .attr('stroke-dasharray', '4 3')
              .attr('opacity', 0.9);

            const lastMean = bandStats[bandStats.length - 1];
            const labelY = Math.max(
              padTop + 12,
              Math.min(padTop + plotHeight - 8, yScale(lastMean.meanPrice))
            );
            histGroup
              .append('text')
              .attr('x', Math.min(rightEdgeX - 4, xAbsScale(analogAnchorIdx + lastMean.rel) + 4))
              .attr('y', labelY - 4)
              .attr('text-anchor', 'end')
              .attr('fill', '#b45309')
              .attr('font-size', '9.5px')
              .attr('font-weight', '700')
              .attr('font-family', 'JetBrains Mono, ui-monospace, monospace')
              .style('paint-order', 'stroke')
              .style('stroke', 'var(--chart-label-halo, rgba(255,255,255,0.9))')
              .style('stroke-width', '3px')
              .text(
                `Mean ${lastMean.meanPct >= 0 ? '+' : ''}${lastMean.meanPct.toFixed(1)}%`
              );
          }
        }

        // Individual normalized historical analog curves + rescaled structure if not already adjacent on screen
        const usedLabelYs: number[] = [];
        historicalInstances.forEach((inst, idx) => {
          const color = HISTORICAL_ANALOG_COLORS[idx % HISTORICAL_ANALOG_COLORS.length];

          // When the historical instance is off-screen or >= 24 bars away from T0, project its rescaled geometry into T0
          const alreadyAdjacentOnChart =
            inst.endIndex >= startOffset && Math.abs(analogAnchorIdx - inst.endIndex) < 24;
          if (!alreadyAdjacentOnChart && inst.anchorPrice > 0) {
            renderHistoricalStructure(inst, color, {
              mode: 'projected',
              mapIndex: (i) => analogAnchorIdx + (i - inst.endIndex),
              mapPrice: (p) => analogAnchorPrice * (p / inst.anchorPrice),
              opacityScale: 0.65,
            });
          }

          const mappedPts = inst.analogCurve
            .map((pt) => ({
              absIdx: analogAnchorIdx + pt.relIndex,
              relIndex: pt.relIndex,
              pct: pt.pctFromAnchor,
              price: analogAnchorPrice * (1 + pt.pctFromAnchor / 100),
            }))
            .filter((pt) => pt.absIdx >= startOffset);

          if (mappedPts.length < 2) return;

          const lineGen = d3
            .line<typeof mappedPts[number]>()
            .curve(d3.curveMonotoneX)
            .x((d) => Math.min(rightEdgeX - 2, xAbsScale(d.absIdx)))
            .y((d) => Math.max(padTop + 2, Math.min(padTop + plotHeight - 2, yScale(d.price))));

          histGroup
            .append('path')
            .datum(mappedPts)
            .attr('d', lineGen)
            .attr('fill', 'none')
            .attr('stroke', color)
            .attr('stroke-width', 1.65)
            .attr('stroke-dasharray', '5 3')
            .attr('opacity', 0.85);

          // Highlight T0 anchor node
          if (anchorY >= padTop && anchorY <= padTop + plotHeight) {
            histGroup
              .append('circle')
              .attr('cx', anchorX)
              .attr('cy', anchorY)
              .attr('r', 4.5)
              .attr('fill', 'none')
              .attr('stroke', color)
              .attr('stroke-width', 1.5)
              .attr('opacity', 0.8);
          }

          const endPt = mappedPts[mappedPts.length - 1];
          const rawY = Math.max(padTop + 12, Math.min(padTop + plotHeight - 8, yScale(endPt.price)));
          let labelY = rawY;
          for (const prevY of usedLabelYs) {
            if (Math.abs(labelY - prevY) < 12) {
              labelY = prevY + 12;
            }
          }
          labelY = Math.max(padTop + 12, Math.min(padTop + plotHeight - 6, labelY));
          usedLabelYs.push(labelY);

          const endX = Math.min(rightEdgeX - 4, xAbsScale(endPt.absIdx));
          histGroup
            .append('circle')
            .attr('cx', endX)
            .attr('cy', Math.max(padTop + 2, Math.min(padTop + plotHeight - 2, yScale(endPt.price))))
            .attr('r', 2.8)
            .attr('fill', color);

          histGroup
            .append('text')
            .attr('x', endX)
            .attr('y', labelY)
            .attr('text-anchor', 'end')
            .attr('fill', color)
            .attr('font-size', '9.5px')
            .attr('font-weight', '600')
            .attr('font-family', 'JetBrains Mono, ui-monospace, monospace')
            .style('paint-order', 'stroke')
            .style('stroke', 'var(--chart-label-halo, rgba(255,255,255,0.9))')
            .style('stroke-width', '3px')
            .text(
              `${inst.endDateLabel.split(',')[0]} ${endPt.pct >= 0 ? '+' : ''}${endPt.pct.toFixed(1)}%`
            );
        });
      }
    }

    if (!pattern || !showPatternOverlay) return;

    const biasFill =
      pattern.bias === 'Bullish'
        ? 'rgba(16, 185, 129, 0.09)'
        : pattern.bias === 'Bearish'
        ? 'rgba(225, 29, 72, 0.09)'
        : 'rgba(37, 99, 235, 0.08)';

    const biasStroke =
      pattern.bias === 'Bullish'
        ? '#059669'
        : pattern.bias === 'Bearish'
        ? '#e11d48'
        : '#2563eb';

    // 1. Shaded Pattern Structural Envelope (Triangles, Wedges, Flags, Boxes, Cup & Handle)
    const upperLine =
      pattern.lines.find((l) => l.role === 'resistance') ||
      pattern.lines.find((l) => l.role === 'neckline');
    const lowerLine =
      pattern.lines.find((l) => l.role === 'support') ||
      (upperLine?.role === 'resistance' ? pattern.lines.find((l) => l.role === 'neckline') : undefined);

    if (pattern.type === 'Cup & Handle') {
      const cupArc = pattern.lines.find((l) => l.label === 'Cup Base Arc');
      if (cupArc && cupArc.points.length >= 3) {
        const clipped = clipLineToStart(cupArc.points, startOffset);
        if (clipped.length >= 2) {
          const cupArea = d3
            .area<PatternPoint>()
            .curve(d3.curveMonotoneX)
            .x((d) => xAbsScale(d.index))
            .y0(() => yScale(pattern.breakoutPrice))
            .y1((d) => yScale(d.price));

          root
            .append('path')
            .datum(clipped)
            .attr('d', cupArea)
            .attr('fill', biasFill)
            .attr('stroke', 'none');
        }
      }
    } else if (pattern.type === 'Parabola Curve') {
      const arcLine = pattern.lines.find((l) => l.label === 'Parabolic Arc');
      if (arcLine && arcLine.points.length >= 3) {
        const clipped = clipLineToStart(arcLine.points, startOffset);
        if (clipped.length >= 2) {
          const basePrice = Math.max(minPrice, clipped[0].price);
          const paraArea = d3
            .area<PatternPoint>()
            .curve(d3.curveMonotoneX)
            .x((d) => xAbsScale(d.index))
            .y0(() => yScale(basePrice))
            .y1((d) => yScale(d.price));

          root
            .append('path')
            .datum(clipped)
            .attr('d', paraArea)
            .attr('fill', biasFill)
            .attr('stroke', 'none');
        }
      }
    } else if (upperLine && lowerLine && upperLine.points.length === 2 && lowerLine.points.length === 2) {
      const uPts = clipLineToStart(upperLine.points, startOffset);
      const lPts = clipLineToStart(lowerLine.points, startOffset);
      if (uPts.length === 2 && lPts.length === 2) {
        const polyPts: Array<[number, number]> = [
          [xAbsScale(uPts[0].index), yScale(uPts[0].price)],
          [xAbsScale(uPts[1].index), yScale(uPts[1].price)],
          [xAbsScale(lPts[1].index), yScale(lPts[1].price)],
          [xAbsScale(lPts[0].index), yScale(lPts[0].price)],
        ];
        root
          .append('polygon')
          .attr('points', polyPts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' '))
          .attr('fill', biasFill)
          .attr('stroke', 'none');

        // Triangle / Wedge Apex Convergence Projection
        if (
          pattern.category === 'Triangles' ||
          pattern.type === 'Falling Wedge' ||
          pattern.type === 'Rising Wedge'
        ) {
          const apex = computeLineIntersection(upperLine.points, lowerLine.points);
          if (apex && apex.index > lastAbsIdx && apex.index <= lastAbsIdx + 30) {
            const apexX = Math.min(rightEdgeX, xAbsScale(apex.index));
            const apexY = yScale(apex.price);
            if (apexY >= padTop - 20 && apexY <= padTop + plotHeight + 20) {
              const projLine = d3.line<[number, number]>();
              root
                .append('path')
                .attr(
                  'd',
                  projLine([
                    [xAbsScale(uPts[1].index), yScale(uPts[1].price)],
                    [apexX, apexY],
                  ])
                )
                .attr('fill', 'none')
                .attr('stroke', biasStroke)
                .attr('stroke-width', 1.25)
                .attr('stroke-dasharray', '3 3')
                .attr('opacity', 0.6);

              root
                .append('path')
                .attr(
                  'd',
                  projLine([
                    [xAbsScale(lPts[1].index), yScale(lPts[1].price)],
                    [apexX, apexY],
                  ])
                )
                .attr('fill', 'none')
                .attr('stroke', biasStroke)
                .attr('stroke-width', 1.25)
                .attr('stroke-dasharray', '3 3')
                .attr('opacity', 0.6);

              root
                .append('path')
                .attr('d', d3.symbol().type(d3.symbolDiamond).size(36)())
                .attr('transform', `translate(${apexX}, ${apexY})`)
                .attr('fill', biasStroke)
                .attr('opacity', 0.85);
            }
          }
        }
      }
    }

    // 2. Reward & Risk Projection Zones via D3
    const zoneStartX = Math.max(padLeft, lastBarX);
    const zoneWidth = Math.max(10, rightEdgeX - zoneStartX);

    if (pattern.targetPrice >= minPrice && pattern.targetPrice <= maxPrice) {
      const yTrig = yScale(pattern.breakoutPrice);
      const yTarg = yScale(pattern.targetPrice);
      root
        .append('rect')
        .attr('x', zoneStartX)
        .attr('y', Math.min(yTrig, yTarg))
        .attr('width', zoneWidth)
        .attr('height', Math.abs(yTarg - yTrig))
        .attr('fill', 'rgba(16, 185, 129, 0.11)');
    }

    if (pattern.stopPrice >= minPrice && pattern.stopPrice <= maxPrice) {
      const yTrig = yScale(pattern.breakoutPrice);
      const yStop = yScale(pattern.stopPrice);
      root
        .append('rect')
        .attr('x', zoneStartX)
        .attr('y', Math.min(yTrig, yStop))
        .attr('width', zoneWidth)
        .attr('height', Math.abs(yStop - yTrig))
        .attr('fill', 'rgba(225, 29, 72, 0.10)');
    }

    // 3. Pattern Trendlines, Necklines, Flagpoles & Cup Arcs via D3 data join
    const roleColor = (role: PatternLine['role']) => {
      switch (role) {
        case 'resistance':
          return '#e11d48';
        case 'support':
          return '#059669';
        case 'neckline':
          return '#2563eb';
        case 'pole':
          return '#d97706';
        default:
          return '#64748b';
      }
    };

    const visibleLines = pattern.lines
      .map((l) => ({ ...l, clipped: clipLineToStart(l.points, startOffset) }))
      .filter((l) => l.clipped.length >= 2);

    const lineGroups = root
      .selectAll<SVGGElement, typeof visibleLines[number]>('g.d3-pattern-line')
      .data(visibleLines, (d) => d.label)
      .enter()
      .append('g')
      .attr('class', 'd3-pattern-line');

    lineGroups.each(function (lineItem) {
      const g = d3.select(this);
      const color = roleColor(lineItem.role);
      const useCurve = Boolean(lineItem.curved) || (lineItem.dashed && pattern.type === 'Cup & Handle');
      const lineGen = d3
        .line<PatternPoint>()
        .curve(useCurve ? d3.curveMonotoneX : d3.curveLinear)
        .x((d) => xAbsScale(d.index))
        .y((d) => yScale(d.price));

      g.append('path')
        .datum(lineItem.clipped)
        .attr('d', lineGen)
        .attr('fill', 'none')
        .attr('stroke', color)
        .attr('stroke-width', 2.2)
        .attr('stroke-linecap', 'round')
        .attr('stroke-dasharray', lineItem.dashed ? '6 4' : null);

      // Endpoint anchors
      const endpoints = [lineItem.clipped[0], lineItem.clipped[lineItem.clipped.length - 1]];
      g.selectAll('circle.line-anchor')
        .data(endpoints)
        .enter()
        .append('circle')
        .attr('class', 'line-anchor')
        .attr('cx', (d) => xAbsScale(d.index))
        .attr('cy', (d) => yScale(d.price))
        .attr('r', 2.6)
        .attr('fill', color);

      // Geometry inline label
      const firstPt = lineItem.clipped[0];
      const lastPt = lineItem.clipped[lineItem.clipped.length - 1];
      const labelX = Math.max(padLeft + 6, (xAbsScale(firstPt.index) + xAbsScale(lastPt.index)) / 2);
      const labelY =
        (yScale(firstPt.price) + yScale(lastPt.price)) / 2 +
        (lineItem.role === 'resistance' ? -7 : 13);

      g.append('text')
        .attr('x', labelX)
        .attr('y', Math.max(padTop + 10, Math.min(padTop + plotHeight - 6, labelY)))
        .attr('text-anchor', 'middle')
        .attr('fill', color)
        .attr('font-size', '10px')
        .attr('font-weight', '600')
        .attr('font-family', 'JetBrains Mono, ui-monospace, monospace')
        .style('paint-order', 'stroke')
        .style('stroke', 'var(--chart-label-halo, rgba(255,255,255,0.85))')
        .style('stroke-width', '3px')
        .text(lineItem.label);
    });

    // 4. Horizontal Breakout Trigger, Target & Stop Levels + Right-Axis Pills
    const levelGen = d3.line<[number, number]>();
    const trigStartX = Math.max(padLeft, xAbsScale(Math.max(startOffset, pattern.startIndex)));
    const trigY = yScale(pattern.breakoutPrice);

    root
      .append('path')
      .attr(
        'd',
        levelGen([
          [trigStartX, trigY],
          [rightEdgeX, trigY],
        ])
      )
      .attr('fill', 'none')
      .attr('stroke', '#2563eb')
      .attr('stroke-width', 1.4)
      .attr('stroke-dasharray', '5 3');

    const drawAxisTag = (price: number, label: string, bg: string) => {
      if (price < minPrice || price > maxPrice) return;
      const y = yScale(price);
      const tagG = root
        .append('g')
        .attr('transform', `translate(${rightEdgeX + 2}, ${y - 8})`);
      tagG
        .append('rect')
        .attr('width', 66)
        .attr('height', 16)
        .attr('rx', 3)
        .attr('fill', bg);
      tagG
        .append('text')
        .attr('x', 33)
        .attr('y', 11)
        .attr('text-anchor', 'middle')
        .attr('fill', '#ffffff')
        .attr('font-size', '9.5px')
        .attr('font-weight', '600')
        .attr('font-family', 'JetBrains Mono, ui-monospace, monospace')
        .text(label);
    };

    drawAxisTag(pattern.breakoutPrice, `B ${formatPrice(pattern.breakoutPrice)}`, '#2563eb');

    if (pattern.targetPrice >= minPrice && pattern.targetPrice <= maxPrice) {
      const yT = yScale(pattern.targetPrice);
      root
        .append('path')
        .attr(
          'd',
          levelGen([
            [Math.max(padLeft, lastBarX - 16), yT],
            [rightEdgeX, yT],
          ])
        )
        .attr('fill', 'none')
        .attr('stroke', '#059669')
        .attr('stroke-width', 1.35)
        .attr('stroke-dasharray', '3 3');
      drawAxisTag(pattern.targetPrice, `T ${formatPrice(pattern.targetPrice)}`, '#059669');
    }

    if (pattern.stopPrice >= minPrice && pattern.stopPrice <= maxPrice) {
      const yS = yScale(pattern.stopPrice);
      root
        .append('path')
        .attr(
          'd',
          levelGen([
            [Math.max(padLeft, lastBarX - 16), yS],
            [rightEdgeX, yS],
          ])
        )
        .attr('fill', 'none')
        .attr('stroke', '#e11d48')
        .attr('stroke-width', 1.35)
        .attr('stroke-dasharray', '3 3');
      drawAxisTag(pattern.stopPrice, `S ${formatPrice(pattern.stopPrice)}`, '#e11d48');
    }

    // 5. Key Structural Pivot Nodes via D3 Data Join
    const visiblePivots = pattern.keyPivots.filter(
      (pt) => pt.index >= startOffset && pt.index < bars.length
    );
    const pivotNodes = root
      .selectAll<SVGGElement, PatternPoint>('g.d3-pivot-node')
      .data(visiblePivots)
      .enter()
      .append('g')
      .attr('class', 'd3-pivot-node')
      .attr('transform', (d) => `translate(${xAbsScale(d.index)}, ${yScale(d.price)})`);

    pivotNodes
      .append('circle')
      .attr('r', 4)
      .attr('fill', '#ffffff')
      .attr('stroke', '#2563eb')
      .attr('stroke-width', 2);

    pivotNodes
      .append('text')
      .attr('y', (d) => {
        const bar = bars[d.index];
        const isHigh = bar ? Math.abs(d.price - bar.high) <= Math.abs(d.price - bar.low) : true;
        return isHigh ? -8 : 14;
      })
      .attr('text-anchor', 'middle')
      .attr('fill', '#334155')
      .attr('font-size', '9.5px')
      .attr('font-weight', '600')
      .attr('font-family', 'JetBrains Mono, ui-monospace, monospace')
      .style('paint-order', 'stroke')
      .style('stroke', 'var(--chart-label-halo, rgba(255,255,255,0.9))')
      .style('stroke-width', '3px')
      .text((d) => `${symbol.endsWith('.KL') ? 'RM ' : symbol.startsWith('^') || symbol.startsWith('MYIDX:') ? '' : '$'}${formatPrice(d.price)}`);
  }, [
    symbol,
    bars,
    count,
    maxPrice,
    minPrice,
    padLeft,
    padTop,
    pattern,
    plotHeight,
    rightEdgeX,
    showPatternOverlay,
    startOffset,
    xAbsScale,
    yScale,
    showHistoricalOverlay,
    historicalInstances,
    historicalDisplayMode,
    analogAnchorIdx,
    analogAnchorPrice,
  ]);

  const priceTicks = useMemo(() => yScale.ticks(5), [yScale]);

  const xTicks = useMemo(() => {
    const ticks: Array<{ relIdx: number; label: string }> = [];
    const interval = Math.max(1, Math.floor(count / 6));
    for (let i = 0; i < count; i += interval) {
      ticks.push({ relIdx: i, label: visibleBars[i].dateLabel });
    }
    return ticks;
  }, [visibleBars, count]);

  const activeRelIdx =
    hoverRelIdx !== null && hoverRelIdx >= 0 && hoverRelIdx < visibleBars.length
      ? hoverRelIdx
      : visibleBars.length - 1;
  const activeBar = visibleBars[activeRelIdx];
  const prevBar = visibleBars[Math.max(0, activeRelIdx - 1)];
  const activeBarChgPct =
    activeBar && prevBar && prevBar.close > 0
      ? ((activeBar.close - prevBar.close) / prevBar.close) * 100
      : 0;

  const hoveredVpBin: VolumeProfileBin | null = useMemo(() => {
    if (!showVolumeProfile || !volumeProfile || hoverPriceVal == null) return null;
    return (
      volumeProfile.bins.find((b) => hoverPriceVal >= b.low && hoverPriceVal <= b.high) || null
    );
  }, [showVolumeProfile, volumeProfile, hoverPriceVal]);

  const vpGeometry = useMemo(() => {
    if (!showVolumeProfile || !volumeProfile || bars.length === 0) return null;
    const rawStartX = xAbsScale(volumeProfile.startIndex) - candleWidth * 0.65;
    const rawEndX = xAbsScale(volumeProfile.endIndex) + candleWidth * 0.65;
    const clampedStartX = Math.max(padLeft, Math.min(rightEdgeX, rawStartX));
    const clampedEndX = Math.max(padLeft, Math.min(rightEdgeX, rawEndX));
    const startVisible = rawStartX >= padLeft - 4 && rawStartX <= rightEdgeX + 4;
    const endVisible = rawEndX >= padLeft - 4 && rawEndX <= rightEdgeX + 4;

    const anchorMode = volumeProfileAnchor;
    const rangePxWidth = Math.max(0, clampedEndX - clampedStartX);
    const maxHistWidth =
      anchorMode === 'chart-right'
        ? Math.min(plotWidth * 0.22, 230)
        : Math.min(plotWidth * 0.25, Math.max(110, rangePxWidth * 0.36));

    const histAnchorX =
      anchorMode === 'chart-right'
        ? rightEdgeX
        : clampedStartX < rightEdgeX - 40
        ? clampedStartX
        : padLeft;

    return {
      rawStartX,
      rawEndX,
      clampedStartX,
      clampedEndX,
      startVisible,
      endVisible,
      anchorMode,
      maxHistWidth,
      histAnchorX,
    };
  }, [
    showVolumeProfile,
    volumeProfile,
    bars.length,
    xAbsScale,
    candleWidth,
    padLeft,
    rightEdgeX,
    volumeProfileAnchor,
    plotWidth,
  ]);

  const handlePointerMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const scaleX = width / rect.width;
    const scaleY = totalHeight / rect.height;
    const svgX = (e.clientX - rect.left) * scaleX;
    const svgY = (e.clientY - rect.top) * scaleY;

    const rel = Math.round(xRelScale.invert(svgX));
    const clampedRel = Math.max(0, Math.min(visibleBars.length - 1, rel));
    const absIdx = startOffset + clampedRel;

    if (draggingEdge && volumeProfile && onChangeVpBounds) {
      if (draggingEdge === 'start') {
        const nextStart = Math.min(volumeProfile.endIndex, Math.max(0, absIdx));
        if (nextStart !== volumeProfile.startIndex) {
          onChangeVpBounds(nextStart, volumeProfile.endIndex);
        }
      } else {
        const nextEnd = Math.max(volumeProfile.startIndex, Math.min(bars.length - 1, absIdx));
        if (nextEnd !== volumeProfile.endIndex) {
          onChangeVpBounds(volumeProfile.startIndex, nextEnd);
        }
      }
    }

    if (rel >= 0 && rel < visibleBars.length) {
      setHoverRelIdx(rel);
    } else {
      setHoverRelIdx(null);
    }

    if (svgY >= padTop && svgY <= padTop + plotHeight) {
      setHoverPriceVal(yScale.invert(svgY));
    } else {
      setHoverPriceVal(null);
    }
  };

  const handleSvgClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!isPickingVpRange || !onSelectVpBar || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const scaleX = width / rect.width;
    const svgX = (e.clientX - rect.left) * scaleX;
    const rel = Math.round(xRelScale.invert(svgX));
    const clampedRel = Math.max(0, Math.min(visibleBars.length - 1, rel));
    onSelectVpBar(startOffset + clampedRel);
  };

  const clipId = `price-plot-clip-${symbol.replace(/[^a-zA-Z0-9_-]/g, '')}`;

  return (
    <div className="relative select-none [--chart-label-halo:rgba(255,255,255,0.92)] dark:[--chart-label-halo:rgba(15,23,42,0.92)]">
      {/* Live OHLCV Crosshair Readout HUD */}
      {activeBar && (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-slate-100 pb-2 text-xs dark:border-slate-800/80">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono tabular-nums text-slate-600 dark:text-slate-300">
            <span className="font-semibold text-slate-900 dark:text-slate-100">{symbol}</span>
            <span className="text-slate-500 dark:text-slate-400">{activeBar.dateLabel}</span>
            <span>
              O <strong className="font-medium text-slate-900 dark:text-slate-100">{formatPrice(activeBar.open)}</strong>
            </span>
            <span>
              H <strong className="font-medium text-slate-900 dark:text-slate-100">{formatPrice(activeBar.high)}</strong>
            </span>
            <span>
              L <strong className="font-medium text-slate-900 dark:text-slate-100">{formatPrice(activeBar.low)}</strong>
            </span>
            <span>
              C <strong className="font-medium text-slate-900 dark:text-slate-100">{formatPrice(activeBar.close)}</strong>
            </span>
            <span
              className={
                activeBarChgPct >= 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-rose-600 dark:text-rose-400'
              }
            >
              {activeBarChgPct >= 0 ? '+' : ''}
              {activeBarChgPct.toFixed(2)}%
            </span>
            <span>
              Vol <strong className="font-medium text-slate-900 dark:text-slate-100">{formatVol(activeBar.volume)}</strong>
            </span>
            {hoveredVpBin && (
              <span className="text-amber-700 dark:text-amber-400">
                VP {formatPrice(hoveredVpBin.low)}–{formatPrice(hoveredVpBin.high)} · {formatVol(hoveredVpBin.totalVolume)} ({hoveredVpBin.pctOfTotal.toFixed(1)}%)
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 font-mono text-[11px] tabular-nums">
            {showSma20 && activeBar.sma20 != null && (
              <span className="text-amber-600 dark:text-amber-400">SMA20 {formatPrice(activeBar.sma20)}</span>
            )}
            {showSma50 && activeBar.sma50 != null && (
              <span className="text-blue-600 dark:text-blue-400">SMA50 {formatPrice(activeBar.sma50)}</span>
            )}
            {showSma200 && activeBar.sma200 != null && (
              <span className="text-violet-600 dark:text-violet-400">SMA200 {formatPrice(activeBar.sma200)}</span>
            )}
            {showVwap20 && activeBar.vwap20 != null && (
              <span className="text-teal-600 dark:text-teal-400">VWAP20 {formatPrice(activeBar.vwap20)}</span>
            )}
            {showRsi && activeBar.rsi14 != null && (
              <span className="text-slate-600 dark:text-slate-300">RSI {activeBar.rsi14.toFixed(1)}</span>
            )}
          </div>
        </div>
      )}

      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${totalHeight}`}
        onMouseMove={handlePointerMove}
        onMouseUp={() => setDraggingEdge(null)}
        onMouseLeave={() => {
          setHoverRelIdx(null);
          setHoverPriceVal(null);
          setDraggingEdge(null);
        }}
        onClick={handleSvgClick}
        className={`h-auto w-full overflow-visible ${
          draggingEdge ? 'cursor-ew-resize' : isPickingVpRange ? 'cursor-cell' : 'cursor-crosshair'
        }`}
        role="img"
        aria-label={`${symbol} candlestick chart with D3.js pattern geometry and Fixed Range Volume Profile`}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={padLeft} y={padTop} width={plotWidth} height={plotHeight} />
          </clipPath>
        </defs>

        {/* Horizontal Price Gridlines & Right Axis */}
        {priceTicks.map((tick, idx) => {
          const y = yScale(tick);
          return (
            <g key={idx}>
              <line
                x1={padLeft}
                y1={y}
                x2={rightEdgeX}
                y2={y}
                className="stroke-slate-100 dark:stroke-slate-800/80"
                strokeWidth="1"
              />
              <text
                x={rightEdgeX + 8}
                y={y + 3.5}
                className="fill-slate-500 font-mono text-[10px] tabular-nums dark:fill-slate-400"
              >
                {formatPrice(tick)}
              </text>
            </g>
          );
        })}

        {/* Fixed Range Volume Profile (FRVP) Overlay Layer */}
        {showVolumeProfile && volumeProfile && vpGeometry && (
          <g clipPath={`url(#${clipId})`} className="frvp-layer">
            {/* Fixed Range Shaded Span */}
            {vpGeometry.clampedEndX > vpGeometry.clampedStartX && (
              <rect
                x={vpGeometry.clampedStartX}
                y={padTop}
                width={vpGeometry.clampedEndX - vpGeometry.clampedStartX}
                height={plotHeight}
                className="fill-slate-400/[0.045] dark:fill-slate-300/[0.035]"
              />
            )}

            {/* Value Area (VAL..VAH) Subtle Horizontal Zone */}
            {(() => {
              const yVah = yScale(volumeProfile.vahPrice);
              const yVal = yScale(volumeProfile.valPrice);
              const topY = Math.min(yVah, yVal);
              const vaH = Math.abs(yVal - yVah);
              const lineStart =
                vpGeometry.anchorMode === 'chart-right'
                  ? padLeft
                  : vpGeometry.histAnchorX;
              return (
                <>
                  <rect
                    x={lineStart}
                    y={topY}
                    width={Math.max(0, rightEdgeX - lineStart)}
                    height={vaH}
                    fill="rgba(8, 145, 178, 0.035)"
                  />
                  <line
                    x1={lineStart}
                    y1={yVah}
                    x2={rightEdgeX}
                    y2={yVah}
                    stroke="#0891b2"
                    strokeWidth="1.15"
                    strokeDasharray="4 3"
                    opacity={0.75}
                  />
                  <line
                    x1={lineStart}
                    y1={yVal}
                    x2={rightEdgeX}
                    y2={yVal}
                    stroke="#0891b2"
                    strokeWidth="1.15"
                    strokeDasharray="4 3"
                    opacity={0.75}
                  />
                </>
              );
            })()}

            {/* Volume-at-Price Horizontal Histogram Bars (Up / Down Volume Split) */}
            {volumeProfile.bins.map((bin) => {
              if (bin.high < minPrice || bin.low > maxPrice || bin.totalVolume <= 0) return null;
              const yTop = yScale(bin.high);
              const yBot = yScale(bin.low);
              const barH = Math.max(1.5, Math.abs(yBot - yTop) - 1);
              const barY = Math.min(yTop, yBot) + 0.5;
              const totalW = Math.max(1.5, bin.pctOfMax * vpGeometry.maxHistWidth);
              const upRatio = bin.totalVolume > 0 ? bin.upVolume / bin.totalVolume : 0.5;
              const upW = totalW * upRatio;
              const downW = Math.max(0, totalW - upW);
              const isHovered = hoveredVpBin?.index === bin.index;

              const upFill = bin.isPoc
                ? 'rgba(217, 119, 6, 0.62)'
                : bin.inValueArea
                ? isHovered
                  ? 'rgba(16, 185, 129, 0.58)'
                  : 'rgba(16, 185, 129, 0.36)'
                : isHovered
                ? 'rgba(16, 185, 129, 0.34)'
                : 'rgba(16, 185, 129, 0.16)';

              const downFill = bin.isPoc
                ? 'rgba(245, 158, 11, 0.50)'
                : bin.inValueArea
                ? isHovered
                  ? 'rgba(225, 29, 72, 0.48)'
                  : 'rgba(225, 29, 72, 0.28)'
                : isHovered
                ? 'rgba(225, 29, 72, 0.28)'
                : 'rgba(225, 29, 72, 0.13)';

              const startX =
                vpGeometry.anchorMode === 'chart-right'
                  ? vpGeometry.histAnchorX - totalW
                  : vpGeometry.histAnchorX;

              return (
                <g key={bin.index}>
                  {upW > 0 && (
                    <rect
                      x={startX}
                      y={barY}
                      width={upW}
                      height={barH}
                      fill={upFill}
                    />
                  )}
                  {downW > 0 && (
                    <rect
                      x={startX + upW}
                      y={barY}
                      width={downW}
                      height={barH}
                      fill={downFill}
                    />
                  )}
                  {(bin.isPoc || isHovered) && (
                    <rect
                      x={startX}
                      y={barY}
                      width={totalW}
                      height={barH}
                      fill="none"
                      stroke={bin.isPoc ? '#d97706' : '#0891b2'}
                      strokeWidth={bin.isPoc ? 1.1 : 0.9}
                    />
                  )}
                </g>
              );
            })}

            {/* Point of Control (POC) Primary Support/Resistance Line */}
            {volumeProfile.pocPrice >= minPrice && volumeProfile.pocPrice <= maxPrice && (
              <line
                x1={
                  vpGeometry.anchorMode === 'chart-right'
                    ? padLeft
                    : vpGeometry.histAnchorX
                }
                y1={yScale(volumeProfile.pocPrice)}
                x2={rightEdgeX}
                y2={yScale(volumeProfile.pocPrice)}
                stroke="#d97706"
                strokeWidth="1.75"
                opacity={0.92}
              />
            )}

            {/* Range Start & End Vertical Rails with Drag Handles */}
            {vpGeometry.startVisible && (
              <g>
                <line
                  x1={vpGeometry.rawStartX}
                  y1={padTop}
                  x2={vpGeometry.rawStartX}
                  y2={padTop + plotHeight}
                  stroke="#0891b2"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                  opacity={0.75}
                />
                {onChangeVpBounds && (
                  <g
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      setDraggingEdge('start');
                    }}
                    className="cursor-ew-resize"
                  >
                    <rect
                      x={vpGeometry.rawStartX - 5}
                      y={padTop + 2}
                      width={10}
                      height={18}
                      rx={2}
                      fill="#0891b2"
                      opacity={0.85}
                    />
                    <line
                      x1={vpGeometry.rawStartX - 1.5}
                      y1={padTop + 6}
                      x2={vpGeometry.rawStartX - 1.5}
                      y2={padTop + 16}
                      stroke="#ffffff"
                      strokeWidth="1"
                    />
                    <line
                      x1={vpGeometry.rawStartX + 1.5}
                      y1={padTop + 6}
                      x2={vpGeometry.rawStartX + 1.5}
                      y2={padTop + 16}
                      stroke="#ffffff"
                      strokeWidth="1"
                    />
                  </g>
                )}
              </g>
            )}

            {vpGeometry.endVisible && (
              <g>
                <line
                  x1={vpGeometry.rawEndX}
                  y1={padTop}
                  x2={vpGeometry.rawEndX}
                  y2={padTop + plotHeight}
                  stroke="#0891b2"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                  opacity={0.75}
                />
                {onChangeVpBounds && (
                  <g
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      setDraggingEdge('end');
                    }}
                    className="cursor-ew-resize"
                  >
                    <rect
                      x={vpGeometry.rawEndX - 5}
                      y={padTop + 2}
                      width={10}
                      height={18}
                      rx={2}
                      fill="#0891b2"
                      opacity={0.85}
                    />
                    <line
                      x1={vpGeometry.rawEndX - 1.5}
                      y1={padTop + 6}
                      x2={vpGeometry.rawEndX - 1.5}
                      y2={padTop + 16}
                      stroke="#ffffff"
                      strokeWidth="1"
                    />
                    <line
                      x1={vpGeometry.rawEndX + 1.5}
                      y1={padTop + 6}
                      x2={vpGeometry.rawEndX + 1.5}
                      y2={padTop + 16}
                      stroke="#ffffff"
                      strokeWidth="1"
                    />
                  </g>
                )}
              </g>
            )}

            {/* Range Header & Level Inline Labels */}
            {vpGeometry.clampedEndX - vpGeometry.clampedStartX > 90 && (
              <text
                x={vpGeometry.clampedStartX + 10}
                y={padTop + 14}
                className="fill-cyan-700 font-mono text-[9.5px] font-semibold dark:fill-cyan-400"
                style={{
                  paintOrder: 'stroke',
                  stroke: 'var(--chart-label-halo, rgba(255,255,255,0.92))',
                  strokeWidth: '3px',
                }}
              >
                FRVP · {volumeProfile.startDateLabel.split(',')[0]}–{volumeProfile.endDateLabel.split(',')[0]} ({volumeProfile.barCount}B)
              </text>
            )}

            {volumeProfile.vahPrice >= minPrice && volumeProfile.vahPrice <= maxPrice && (
              <text
                x={rightEdgeX - 6}
                y={Math.max(padTop + 12, yScale(volumeProfile.vahPrice) - 4)}
                textAnchor="end"
                className="fill-cyan-700 font-mono text-[9.5px] font-semibold dark:fill-cyan-400"
                style={{
                  paintOrder: 'stroke',
                  stroke: 'var(--chart-label-halo, rgba(255,255,255,0.92))',
                  strokeWidth: '3px',
                }}
              >
                VAH {formatPrice(volumeProfile.vahPrice)}
              </text>
            )}

            {volumeProfile.valPrice >= minPrice && volumeProfile.valPrice <= maxPrice && (
              <text
                x={rightEdgeX - 6}
                y={Math.min(padTop + plotHeight - 4, yScale(volumeProfile.valPrice) + 11)}
                textAnchor="end"
                className="fill-cyan-700 font-mono text-[9.5px] font-semibold dark:fill-cyan-400"
                style={{
                  paintOrder: 'stroke',
                  stroke: 'var(--chart-label-halo, rgba(255,255,255,0.92))',
                  strokeWidth: '3px',
                }}
              >
                VAL {formatPrice(volumeProfile.valPrice)}
              </text>
            )}

            {volumeProfile.pocPrice >= minPrice && volumeProfile.pocPrice <= maxPrice && (
              <text
                x={rightEdgeX - 6}
                y={Math.max(padTop + 12, yScale(volumeProfile.pocPrice) - 4)}
                textAnchor="end"
                className="fill-amber-700 font-mono text-[10px] font-bold dark:fill-amber-400"
                style={{
                  paintOrder: 'stroke',
                  stroke: 'var(--chart-label-halo, rgba(255,255,255,0.92))',
                  strokeWidth: '3px',
                }}
              >
                POC {formatPrice(volumeProfile.pocPrice)}
              </text>
            )}
          </g>
        )}

        {/* Interactive Fixed Range Pick Preview Overlay */}
        {isPickingVpRange && vpPickAnchorIndex != null && (
          <g pointerEvents="none" clipPath={`url(#${clipId})`}>
            {(() => {
              const aX = xAbsScale(vpPickAnchorIndex);
              const bIdx =
                hoverRelIdx != null ? startOffset + hoverRelIdx : vpPickAnchorIndex;
              const bX = xAbsScale(bIdx);
              const x0 = Math.min(aX, bX);
              const w = Math.max(4, Math.abs(bX - aX));
              return (
                <>
                  <rect
                    x={x0}
                    y={padTop}
                    width={w}
                    height={plotHeight}
                    fill="rgba(8, 145, 178, 0.12)"
                  />
                  <line
                    x1={aX}
                    y1={padTop}
                    x2={aX}
                    y2={padTop + plotHeight}
                    stroke="#0891b2"
                    strokeWidth="1.5"
                  />
                </>
              );
            })()}
          </g>
        )}

        {/* Volume Histogram in Bottom 17% of Price Plot */}
        {visibleBars.map((b, idx) => {
          const barH = Math.max(1, volScale(b.volume));
          const x = xRelScale(idx) - candleWidth / 2;
          const y = padTop + plotHeight - barH;
          const isUp = b.close >= b.open;
          return (
            <rect
              key={`v-${b.time}`}
              x={x}
              y={y}
              width={candleWidth}
              height={barH}
              className={
                isUp
                  ? 'fill-emerald-500/20 dark:fill-emerald-400/20'
                  : 'fill-rose-500/20 dark:fill-rose-400/20'
              }
            />
          );
        })}

        {/* Moving Averages (D3 path generators) */}
        {showSma200 && sma200Path && (
          <path
            d={sma200Path}
            fill="none"
            className="stroke-violet-500/80 dark:stroke-violet-400/80"
            strokeWidth="1.35"
          />
        )}
        {showVwap20 && vwap20Path && (
          <path
            d={vwap20Path}
            fill="none"
            className="stroke-teal-600/85 dark:stroke-teal-400/85"
            strokeWidth="1.4"
            strokeDasharray="4 2"
          />
        )}
        {showSma50 && sma50Path && (
          <path
            d={sma50Path}
            fill="none"
            className="stroke-blue-600/85 dark:stroke-blue-400/85"
            strokeWidth="1.35"
          />
        )}
        {showSma20 && sma20Path && (
          <path
            d={sma20Path}
            fill="none"
            className="stroke-amber-500/90 dark:stroke-amber-400/90"
            strokeWidth="1.35"
          />
        )}

        {/* D3.js Pattern Geometry Backdrop & Overlay Layer */}
        <g ref={d3OverlayRef} className="d3-pattern-overlay" />

        {/* Candlesticks */}
        {visibleBars.map((b, idx) => {
          const cx = xRelScale(idx);
          const yHigh = yScale(b.high);
          const yLow = yScale(b.low);
          const yOpen = yScale(b.open);
          const yClose = yScale(b.close);
          const isUp = b.close >= b.open;
          const bodyTop = Math.min(yOpen, yClose);
          const bodyH = Math.max(1.5, Math.abs(yClose - yOpen));

          return (
            <g key={b.time}>
              <line
                x1={cx}
                y1={yHigh}
                x2={cx}
                y2={yLow}
                className={
                  isUp
                    ? 'stroke-emerald-600 dark:stroke-emerald-400'
                    : 'stroke-rose-600 dark:stroke-rose-400'
                }
                strokeWidth="1.15"
              />
              <rect
                x={cx - candleWidth / 2}
                y={bodyTop}
                width={candleWidth}
                height={bodyH}
                rx="0.5"
                className={
                  isUp
                    ? 'fill-emerald-600 dark:fill-emerald-400'
                    : 'fill-rose-600 dark:fill-rose-400'
                }
              />
            </g>
          );
        })}

        {/* Active Price Alert Lines */}
        {priceAlerts
          .filter(
            (a) =>
              a.active &&
              a.symbol === symbol &&
              a.targetPrice >= minPrice &&
              a.targetPrice <= maxPrice
          )
          .map((alert) => {
            const yA = yScale(alert.targetPrice);
            return (
              <g key={alert.id} pointerEvents="none">
                <line
                  x1={padLeft}
                  y1={yA}
                  x2={rightEdgeX}
                  y2={yA}
                  stroke="#7c3aed"
                  strokeWidth="1.2"
                  strokeDasharray="3 3"
                  opacity={0.85}
                />
                <text
                  x={padLeft + 6}
                  y={Math.max(padTop + 11, yA - 4)}
                  className="fill-violet-700 font-mono text-[9.5px] font-semibold dark:fill-violet-400"
                  style={{
                    paintOrder: 'stroke',
                    stroke: 'var(--chart-label-halo, rgba(255,255,255,0.92))',
                    strokeWidth: '3px',
                  }}
                >
                  ALERT {alert.condition === 'above' ? '≥' : '≤'} {formatPrice(alert.targetPrice)} ({alert.sourceLabel})
                </text>
              </g>
            );
          })}

        {/* Corporate Event Pins (Earnings, Ex-Dividend, Splits) & Upcoming Catalyst Badge */}
        {showEvents && corporateEvents.length > 0 && (
          <g className="corporate-events-layer">
            {corporateEvents
              .filter(
                (ev) =>
                  ev.barIndex != null &&
                  ev.barIndex >= startOffset &&
                  ev.barIndex < startOffset + visibleBars.length
              )
              .map((ev) => {
                const cx = xAbsScale(ev.barIndex!);
                const markerY = padTop + plotHeight - 11;
                const badgeColor =
                  ev.type === 'Earnings'
                    ? '#4f46e5'
                    : ev.type === 'Dividend'
                    ? '#0d9488'
                    : '#d97706';
                const tag = ev.type === 'Earnings' ? 'E' : ev.type === 'Dividend' ? 'D' : 'S';
                const isHovered = hoveredEventId === ev.id;
                const tooltipX = Math.max(padLeft + 88, Math.min(rightEdgeX - 88, cx));

                return (
                  <g
                    key={ev.id}
                    className="cursor-pointer"
                    onMouseEnter={() => setHoveredEventId(ev.id)}
                    onMouseLeave={() => setHoveredEventId(null)}
                  >
                    <title>{`${ev.type}: ${ev.dateLabel} — ${ev.detail}`}</title>
                    <line
                      x1={cx}
                      y1={padTop + 12}
                      x2={cx}
                      y2={markerY - 8}
                      stroke={badgeColor}
                      strokeWidth={isHovered ? 1.2 : 0.8}
                      strokeDasharray="2 3"
                      opacity={isHovered ? 0.85 : 0.35}
                    />
                    <rect
                      x={cx - 8}
                      y={markerY - 8}
                      width={16}
                      height={16}
                      rx={3}
                      fill={badgeColor}
                      opacity={isHovered ? 1 : 0.9}
                    />
                    <text
                      x={cx}
                      y={markerY + 3.5}
                      textAnchor="middle"
                      fill="#ffffff"
                      fontSize="9.5px"
                      fontWeight="700"
                      fontFamily="JetBrains Mono, ui-monospace, monospace"
                    >
                      {tag}
                    </text>

                    {isHovered && (
                      <g pointerEvents="none" transform={`translate(${tooltipX}, ${markerY - 26})`}>
                        <rect
                          x={-84}
                          y={-12}
                          width={168}
                          height={20}
                          rx={3}
                          fill="#0f172a"
                          opacity={0.94}
                        />
                        <text
                          x={0}
                          y={1.5}
                          textAnchor="middle"
                          fill="#f8fafc"
                          fontSize="9.5px"
                          fontWeight="600"
                          fontFamily="JetBrains Mono, ui-monospace, monospace"
                        >
                          {`${ev.dateLabel} · ${ev.detail}`.slice(0, 28)}
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}

            {(() => {
              const upcoming = corporateEvents
                .filter((ev) => ev.isUpcoming && ev.daysAway >= 0 && ev.daysAway <= 60)
                .sort((a, b) => a.timestamp - b.timestamp)
                .slice(0, 2);
              if (upcoming.length === 0) return null;
              return (
                <g pointerEvents="none">
                  {upcoming.map((ev, i) => {
                    const yPos = padTop + 12 + i * 16;
                    const color = ev.type === 'Earnings' ? '#4f46e5' : '#0d9488';
                    return (
                      <text
                        key={ev.id}
                        x={rightEdgeX - 8}
                        y={yPos}
                        textAnchor="end"
                        fill={color}
                        fontSize="10px"
                        fontWeight="700"
                        fontFamily="JetBrains Mono, ui-monospace, monospace"
                        style={{
                          paintOrder: 'stroke',
                          stroke: 'var(--chart-label-halo, rgba(255,255,255,0.92))',
                          strokeWidth: '3px',
                        }}
                      >
                        {`Next ${ev.type}: ${ev.dateLabel} (${ev.daysAway === 0 ? 'Today' : `${ev.daysAway}d`})`}
                      </text>
                    );
                  })}
                </g>
              );
            })()}
          </g>
        )}

        {/* RSI Sub-Panel */}
        {showRsi && (
          <g>
            <line
              x1={padLeft}
              y1={priceHeight}
              x2={rightEdgeX}
              y2={priceHeight}
              className="stroke-slate-200 dark:stroke-slate-800"
              strokeWidth="1"
            />
            {[30, 70].map((lvl) => {
              const y = rsiScale(lvl);
              return (
                <g key={lvl}>
                  <line
                    x1={padLeft}
                    y1={y}
                    x2={rightEdgeX}
                    y2={y}
                    className="stroke-slate-200 dark:stroke-slate-800"
                    strokeDasharray="3 3"
                    strokeWidth="1"
                  />
                  <text
                    x={rightEdgeX + 8}
                    y={y + 3}
                    className="fill-slate-400 font-mono text-[9.5px] tabular-nums"
                  >
                    {lvl}
                  </text>
                </g>
              );
            })}
            {rsiPath && (
              <path
                d={rsiPath}
                fill="none"
                className="stroke-indigo-600 dark:stroke-indigo-400"
                strokeWidth="1.4"
              />
            )}
          </g>
        )}

        {/* X Axis Date Labels */}
        {xTicks.map((t) => (
          <text
            key={t.relIdx}
            x={xRelScale(t.relIdx)}
            y={priceHeight + rsiHeight + 16}
            textAnchor="middle"
            className="fill-slate-500 font-mono text-[10px] tabular-nums dark:fill-slate-400"
          >
            {t.label}
          </text>
        ))}

        {/* Interactive Crosshair */}
        {hoverRelIdx !== null && activeBar && (
          <g pointerEvents="none" data-chart-crosshair="true">
            <line
              x1={xRelScale(hoverRelIdx)}
              y1={padTop}
              x2={xRelScale(hoverRelIdx)}
              y2={priceHeight + rsiHeight}
              className="stroke-slate-400/70 dark:stroke-slate-500/70"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            <line
              x1={padLeft}
              y1={yScale(activeBar.close)}
              x2={rightEdgeX}
              y2={yScale(activeBar.close)}
              className="stroke-slate-400/70 dark:stroke-slate-500/70"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            <g transform={`translate(${rightEdgeX + 2}, ${yScale(activeBar.close) - 8})`}>
              <rect width="66" height="16" rx="3" className="fill-slate-900 dark:fill-slate-200" />
              <text
                x="33"
                y="11"
                textAnchor="middle"
                className="fill-white font-mono text-[9.5px] font-medium tabular-nums dark:fill-slate-900"
              >
                {formatPrice(activeBar.close)}
              </text>
            </g>
          </g>
        )}
      </svg>
    </div>
  );
}
