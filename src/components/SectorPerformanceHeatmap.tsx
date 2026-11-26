import * as d3 from 'd3';
import { RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SectorHeatmapEntry, SectorHeatmapResponse } from '../shared/types.ts';

type Horizon = '1d' | '5d' | '1m';
type MetricMode = 'relative' | 'absolute';

interface SectorPerformanceHeatmapProps {
  watchlistName: string;
  data: SectorHeatmapResponse | null;
  isLoading: boolean;
  isDark?: boolean;
  selectedSymbol?: string | null;
  onSelectSymbol: (symbol: string) => void;
  onRefresh: () => void;
  compact?: boolean;
}

interface TreeNodeData {
  name: string;
  sector?: string;
  benchmarkSymbol?: string;
  benchPerf?: number;
  entry?: SectorHeatmapEntry;
  value?: number;
  children?: TreeNodeData[];
}

function getStockPerf(entry: SectorHeatmapEntry, horizon: Horizon): number {
  if (horizon === '5d') return entry.perf5dPct;
  if (horizon === '1m') return entry.perf1mPct;
  return entry.perf1dPct;
}

function getBenchPerf(entry: SectorHeatmapEntry, horizon: Horizon): number {
  if (horizon === '5d') return entry.bench5dPct;
  if (horizon === '1m') return entry.bench1mPct;
  return entry.bench1dPct;
}

function getRelPerf(entry: SectorHeatmapEntry, horizon: Horizon): number {
  if (horizon === '5d') return entry.rel5dPct;
  if (horizon === '1m') return entry.rel1mPct;
  return entry.rel1dPct;
}

function formatSigned(val: number): string {
  return `${val >= 0 ? '+' : ''}${val.toFixed(2)}%`;
}

export function SectorPerformanceHeatmap({
  watchlistName,
  data,
  isLoading,
  isDark = false,
  selectedSymbol,
  onSelectSymbol,
  onRefresh,
  compact = false,
}: SectorPerformanceHeatmapProps) {
  const [horizon, setHorizon] = useState<Horizon>('1d');
  const [metricMode, setMetricMode] = useState<MetricMode>('relative');
  const [hovered, setHovered] = useState<SectorHeatmapEntry | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const items = data?.items || [];
  const sectors = data?.sectors || [];

  const svgWidth = 960;
  const svgHeight = compact
    ? Math.max(230, Math.min(340, 145 + sectors.length * 46))
    : Math.max(300, Math.min(440, 180 + sectors.length * 56));

  const clampBound = horizon === '1m' ? 12 : horizon === '5d' ? 6 : 3.5;

  const summary = useMemo(() => {
    if (items.length === 0) {
      return { beating: 0, total: 0, meanAlpha: 0, leader: null as SectorHeatmapEntry | null };
    }
    const alphas = items.map((item) => getRelPerf(item, horizon));
    const beating = alphas.filter((a) => a > 0).length;
    const meanAlpha = alphas.reduce((a, b) => a + b, 0) / items.length;
    const leader = [...items].sort((a, b) => getRelPerf(b, horizon) - getRelPerf(a, horizon))[0];
    return { beating, total: items.length, meanAlpha, leader };
  }, [items, horizon]);

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    if (items.length === 0) return;

    const neutralColor = isDark ? '#1e293b' : '#f1f5f9';
    const posColor = isDark ? '#059669' : '#047857';
    const negColor = isDark ? '#e11d48' : '#be123c';

    const colorScale = d3
      .scaleLinear<string>()
      .domain([-clampBound, 0, clampBound])
      .range([negColor, neutralColor, posColor])
      .clamp(true);

    // Build Sector -> Stock hierarchy for d3.treemap
    const grouped = d3.group(items, (d) => d.sector);
    const rootData: TreeNodeData = {
      name: 'Watchlist',
      children: Array.from(grouped.entries()).map(([sectorName, groupItems]) => {
        const first = groupItems[0];
        const sortedGroup = [...groupItems].sort(
          (a, b) => getRelPerf(b, horizon) - getRelPerf(a, horizon)
        );
        return {
          name: sectorName,
          sector: sectorName,
          benchmarkSymbol: first.benchmarkSymbol,
          benchPerf: getBenchPerf(first, horizon),
          children: sortedGroup.map((entry) => {
            const metric =
              metricMode === 'relative' ? getRelPerf(entry, horizon) : getStockPerf(entry, horizon);
            return {
              name: entry.symbol,
              entry,
              // Balanced tile weighting so every watchlist ticker stays readable
              value: 1 + Math.min(0.45, Math.abs(metric) * 0.06),
            };
          }),
        };
      }),
    };

    const hierarchy = d3
      .hierarchy<TreeNodeData>(rootData)
      .sum((d) => d.value ?? 0)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

    const treemapLayout = d3
      .treemap<TreeNodeData>()
      .tile(d3.treemapSquarify)
      .size([svgWidth, svgHeight])
      .paddingTop(24)
      .paddingInner(4)
      .paddingOuter(6)
      .round(true);

    const rootNode = treemapLayout(hierarchy);

    // Render Sector Containers
    const sectorNodes = rootNode.children || [];
    const sectorGroups = svg
      .selectAll<SVGGElement, d3.HierarchyRectangularNode<TreeNodeData>>('g.d3-sector-group')
      .data(sectorNodes, (d) => d.data.name)
      .enter()
      .append('g')
      .attr('class', 'd3-sector-group')
      .attr('transform', (d) => `translate(${d.x0}, ${d.y0})`);

    sectorGroups
      .append('rect')
      .attr('width', (d) => Math.max(0, d.x1 - d.x0))
      .attr('height', (d) => Math.max(0, d.y1 - d.y0))
      .attr('rx', 6)
      .attr('fill', isDark ? '#0f172a' : '#ffffff')
      .attr('stroke', isDark ? '#334155' : '#cbd5e1')
      .attr('stroke-width', 1);

    sectorGroups
      .append('text')
      .attr('x', 8)
      .attr('y', 16)
      .attr('fill', isDark ? '#e2e8f0' : '#1e293b')
      .attr('font-size', '11px')
      .attr('font-weight', '600')
      .attr('font-family', 'Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif')
      .text((d) => {
        const w = d.x1 - d.x0;
        const bench = d.data.benchmarkSymbol || 'SPY';
        const bp = d.data.benchPerf ?? 0;
        const label = `${d.data.name} · ${bench} ${formatSigned(bp)}`;
        if (w < 175) return `${bench} ${formatSigned(bp)}`;
        return label;
      });

    // Render Stock Leaf Tiles
    const leaves = rootNode.leaves();
    const leafGroups = svg
      .selectAll<SVGGElement, d3.HierarchyRectangularNode<TreeNodeData>>('g.d3-heatmap-leaf')
      .data(leaves, (d) => d.data.name)
      .enter()
      .append('g')
      .attr('class', 'd3-heatmap-leaf')
      .attr('transform', (d) => `translate(${d.x0}, ${d.y0})`)
      .style('cursor', 'pointer')
      .on('mouseenter', (_event, d) => {
        if (d.data.entry) setHovered(d.data.entry);
      })
      .on('mouseleave', () => {
        setHovered(null);
      })
      .on('click', (_event, d) => {
        if (d.data.entry) onSelectSymbol(d.data.entry.symbol);
      });

    leafGroups
      .append('rect')
      .attr('width', (d) => Math.max(0, d.x1 - d.x0))
      .attr('height', (d) => Math.max(0, d.y1 - d.y0))
      .attr('rx', 4)
      .attr('fill', (d) => {
        const entry = d.data.entry!;
        const val =
          metricMode === 'relative' ? getRelPerf(entry, horizon) : getStockPerf(entry, horizon);
        return colorScale(val);
      })
      .attr('stroke', (d) => {
        const isSel = selectedSymbol && d.data.entry?.symbol === selectedSymbol;
        if (isSel) return '#2563eb';
        return isDark ? 'rgba(15,23,42,0.5)' : 'rgba(148,163,184,0.35)';
      })
      .attr('stroke-width', (d) =>
        selectedSymbol && d.data.entry?.symbol === selectedSymbol ? 2.2 : 1
      );

    // Render Adaptive Labels Inside Tiles
    leafGroups.each(function (d) {
      const g = d3.select(this);
      const entry = d.data.entry;
      if (!entry) return;

      const w = d.x1 - d.x0;
      const h = d.y1 - d.y0;
      if (w < 42 || h < 28) return;

      const metric =
        metricMode === 'relative' ? getRelPerf(entry, horizon) : getStockPerf(entry, horizon);
      const absVal = getStockPerf(entry, horizon);
      const fillHex = colorScale(metric);
      const labL = d3.lab(fillHex).l;
      const primaryText = labL < 58 ? '#ffffff' : '#0f172a';
      const secondaryText = labL < 58 ? 'rgba(255,255,255,0.86)' : '#475569';

      const cx = w / 2;
      const cy = h / 2;

      const showThirdLine = h >= 68 && w >= 88;
      const showSecondLine = h >= 44 && w >= 58;

      const symY = showThirdLine ? cy - 12 : showSecondLine ? cy - 5 : cy + 4;

      g.append('text')
        .attr('x', cx)
        .attr('y', symY)
        .attr('text-anchor', 'middle')
        .attr('fill', primaryText)
        .attr('font-size', w >= 110 && h >= 66 ? '13px' : '11.5px')
        .attr('font-weight', '700')
        .attr('font-family', 'JetBrains Mono, ui-monospace, monospace')
        .text(entry.symbol);

      if (showSecondLine) {
        const mainText =
          metricMode === 'relative'
            ? `${formatSigned(metric)} vs ${entry.benchmarkSymbol}`
            : formatSigned(absVal);

        g.append('text')
          .attr('x', cx)
          .attr('y', symY + 15)
          .attr('text-anchor', 'middle')
          .attr('fill', primaryText)
          .attr('font-size', '10.5px')
          .attr('font-weight', '600')
          .attr('font-family', 'JetBrains Mono, ui-monospace, monospace')
          .text(w < 96 && metricMode === 'relative' ? formatSigned(metric) : mainText);
      }

      if (showThirdLine) {
        const subText =
          metricMode === 'relative'
            ? `Stk ${formatSigned(absVal)} · $${entry.price.toFixed(2)}`
            : `Alpha ${formatSigned(getRelPerf(entry, horizon))} vs ${entry.benchmarkSymbol}`;

        g.append('text')
          .attr('x', cx)
          .attr('y', symY + 30)
          .attr('text-anchor', 'middle')
          .attr('fill', secondaryText)
          .attr('font-size', '9.5px')
          .attr('font-family', 'JetBrains Mono, ui-monospace, monospace')
          .text(subText);
      }
    });
  }, [items, horizon, metricMode, isDark, selectedSymbol, svgWidth, svgHeight, clampBound, onSelectSymbol]);

  return (
    <div className="space-y-3">
      {/* Controls & Legend Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <div className="flex items-center rounded-md bg-slate-100 p-0.5 dark:bg-slate-800" role="group" aria-label="Heatmap horizon">
            {(
              [
                { id: '1d', label: '1D' },
                { id: '5d', label: '5D' },
                { id: '1m', label: '1M' },
              ] as const
            ).map((h) => (
              <button
                key={h.id}
                type="button"
                onClick={() => setHorizon(h.id)}
                className={`rounded px-2.5 py-1 font-mono text-[11px] font-medium transition-colors ${
                  horizon === h.id
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-slate-100'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
                }`}
              >
                {h.label}
              </button>
            ))}
          </div>

          <div className="flex items-center rounded-md bg-slate-100 p-0.5 dark:bg-slate-800" role="group" aria-label="Heatmap color metric">
            <button
              type="button"
              onClick={() => setMetricMode('relative')}
              className={`rounded px-2.5 py-1 text-[11px] font-medium transition-colors whitespace-nowrap ${
                metricMode === 'relative'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
              }`}
            >
              Relative Alpha vs Sector
            </button>
            <button
              type="button"
              onClick={() => setMetricMode('absolute')}
              className={`rounded px-2.5 py-1 text-[11px] font-medium transition-colors whitespace-nowrap ${
                metricMode === 'absolute'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
              }`}
            >
              Absolute Return %
            </button>
          </div>

          {summary.total > 0 && (
            <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] tabular-nums text-slate-600 dark:text-slate-400">
              <span>
                <strong className="text-slate-900 dark:text-slate-100">
                  {summary.beating}/{summary.total}
                </strong>{' '}
                beating sector
              </span>
              <span aria-hidden="true">·</span>
              <span>
                Mean Alpha{' '}
                <strong
                  className={
                    summary.meanAlpha >= 0
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-rose-700 dark:text-rose-400'
                  }
                >
                  {formatSigned(summary.meanAlpha)}
                </strong>
              </span>
              {summary.leader && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>
                    Leader{' '}
                    <strong className="text-slate-900 dark:text-slate-100">
                      {summary.leader.symbol}
                    </strong>{' '}
                    ({formatSigned(getRelPerf(summary.leader, horizon))} vs{' '}
                    {summary.leader.benchmarkSymbol})
                  </span>
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Diverging Scale Legend */}
          <div className="hidden sm:flex items-center gap-1.5 font-mono text-[10px] tabular-nums text-slate-500 dark:text-slate-400">
            <span>-{clampBound}%</span>
            <div
              className="h-2.5 w-24 rounded-xs border border-slate-200 dark:border-slate-700"
              style={{
                background: isDark
                  ? 'linear-gradient(to right, #e11d48, #1e293b, #059669)'
                  : 'linear-gradient(to right, #be123c, #f1f5f9, #047857)',
              }}
            />
            <span>+{clampBound}%</span>
          </div>

          <button
            type="button"
            onClick={onRefresh}
            disabled={isLoading}
            className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            <RefreshCw className={`h-3 w-3 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Interactive Hover Inspection Readout Strip */}
      <div className="flex min-h-[28px] flex-wrap items-center justify-between gap-2 rounded-md border border-slate-100 bg-slate-50/70 px-3 py-1.5 text-xs dark:border-slate-800 dark:bg-slate-950/50">
        {hovered ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] tabular-nums">
            <span className="font-sans font-semibold text-slate-900 dark:text-slate-100">
              {hovered.symbol} · {hovered.name}
            </span>
            <span className="text-slate-600 dark:text-slate-300">${hovered.price.toFixed(2)}</span>
            <span aria-hidden="true" className="text-slate-400">·</span>
            <span>
              Stock ({horizon.toUpperCase()}):{' '}
              <strong
                className={
                  getStockPerf(hovered, horizon) >= 0
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-rose-700 dark:text-rose-400'
                }
              >
                {formatSigned(getStockPerf(hovered, horizon))}
              </strong>
            </span>
            <span>
              {hovered.benchmarkSymbol} ({horizon.toUpperCase()}):{' '}
              <strong className="text-slate-800 dark:text-slate-200">
                {formatSigned(getBenchPerf(hovered, horizon))}
              </strong>
            </span>
            <span>
              Relative Alpha:{' '}
              <strong
                className={
                  getRelPerf(hovered, horizon) >= 0
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-rose-700 dark:text-rose-400'
                }
              >
                {formatSigned(getRelPerf(hovered, horizon))}
              </strong>
            </span>
          </div>
        ) : (
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            Hover any tile in &ldquo;{watchlistName}&rdquo; to compare stock vs sector benchmark performance; click a tile to inspect its chart pattern.
          </span>
        )}
      </div>

      {/* D3 Treemap SVG Canvas */}
      {isLoading && items.length === 0 ? (
        <div className="h-[240px] w-full animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800/60" />
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-6 text-center text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-400">
          Add stocks or ETFs to &ldquo;{watchlistName}&rdquo; to visualize relative sector performance against sector &amp; index benchmarks.
        </div>
      ) : (
        <svg
          ref={svgRef}
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="h-auto w-full select-none"
          role="img"
          aria-label={`D3 sector performance heatmap for ${watchlistName}`}
        />
      )}

      {/* Sector Benchmark Comparison Strip */}
      {sectors.length > 0 && (
        <div className="grid grid-cols-2 divide-x divide-y divide-slate-200 rounded-md border border-slate-200 sm:grid-cols-3 lg:grid-cols-6 sm:divide-y-0 dark:divide-slate-800 dark:border-slate-800">
          {sectors.slice(0, 6).map((sec) => {
            const benchPerf =
              horizon === '5d' ? sec.perf5dPct : horizon === '1m' ? sec.perf1mPct : sec.perf1dPct;
            const avgRel =
              horizon === '5d'
                ? sec.avgRel5dPct
                : horizon === '1m'
                ? sec.avgRel1mPct
                : sec.avgRel1dPct;

            return (
              <div key={sec.sector} className="p-2.5 text-xs">
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate font-semibold text-slate-800 dark:text-slate-200">
                    {sec.sector}
                  </span>
                  <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400">
                    {sec.benchmarkSymbol}
                  </span>
                </div>
                <div className="mt-1 flex items-baseline justify-between font-mono text-[11px] tabular-nums">
                  <span className="text-slate-500 dark:text-slate-400">
                    Bench {formatSigned(benchPerf)}
                  </span>
                  <span
                    className={`font-semibold ${
                      avgRel >= 0
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-rose-700 dark:text-rose-400'
                    }`}
                  >
                    {formatSigned(avgRel)} α
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
