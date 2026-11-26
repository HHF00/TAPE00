import { ArrowDownRight, ArrowRight, ArrowUpRight, Star } from 'lucide-react';
import type { DetectedPattern, PatternType, ScannedTicker } from '../shared/types.ts';
import { computeSetupConfidence } from '../utils/setupConfidence.ts';

interface ScannerTableProps {
  tickers: ScannedTicker[];
  selectedSymbol: string | null;
  onSelectSymbol: (symbol: string) => void;
  watchlist: string[];
  onToggleWatchlist: (symbol: string) => void;
  isLoading: boolean;
  onResetFilters: () => void;
  activePatternType?: 'All' | PatternType;
}

function formatAssetPrice(value: number, currency?: string, symbol?: string): string {
  const ccy =
    currency ||
    (symbol?.startsWith('^') || symbol?.startsWith('MYIDX:')
      ? 'PTS'
      : symbol?.endsWith('.KL')
      ? 'MYR'
      : 'USD');
  if (ccy === 'MYR') return `RM ${value.toFixed(2)}`;
  if (ccy === 'PTS') return value.toFixed(2);
  return `$${value.toFixed(2)}`;
}

interface TrendVisualMeta {
  tier: 'Leader' | 'Strong' | 'Rising' | 'Flat' | 'Soft' | 'Weak';
  bars: 1 | 2 | 3 | 4;
  textClass: string;
  barClass: string;
  stroke: string;
}

function classifySma20Slope(slopePct: number): TrendVisualMeta {
  if (slopePct >= 0.3) {
    return {
      tier: 'Leader',
      bars: 4,
      textClass: 'text-emerald-700 dark:text-emerald-400',
      barClass: 'bg-emerald-600 dark:bg-emerald-400',
      stroke: '#059669',
    };
  }
  if (slopePct >= 0.15) {
    return {
      tier: 'Strong',
      bars: 3,
      textClass: 'text-emerald-600 dark:text-emerald-400',
      barClass: 'bg-emerald-500 dark:bg-emerald-400',
      stroke: '#10b981',
    };
  }
  if (slopePct >= 0.05) {
    return {
      tier: 'Rising',
      bars: 2,
      textClass: 'text-teal-700 dark:text-teal-400',
      barClass: 'bg-teal-600 dark:bg-teal-400',
      stroke: '#0d9488',
    };
  }
  if (slopePct > -0.05) {
    return {
      tier: 'Flat',
      bars: 1,
      textClass: 'text-slate-500 dark:text-slate-400',
      barClass: 'bg-slate-400 dark:bg-slate-500',
      stroke: '#94a3b8',
    };
  }
  if (slopePct > -0.18) {
    return {
      tier: 'Soft',
      bars: 2,
      textClass: 'text-amber-600 dark:text-amber-400',
      barClass: 'bg-amber-500 dark:bg-amber-400',
      stroke: '#d97706',
    };
  }
  return {
    tier: 'Weak',
    bars: slopePct <= -0.3 ? 4 : 3,
    textClass: 'text-rose-600 dark:text-rose-400',
    barClass: 'bg-rose-600 dark:bg-rose-400',
    stroke: '#e11d48',
  };
}

function buildSparkPath(points: number[], width: number, height: number): string {
  if (points.length < 2) return '';
  const min = Math.min(...points);
  const max = Math.max(...points);
  const pad = 1.5;
  const usableH = height - pad * 2;
  const span = max - min;
  return points
    .map((val, idx) => {
      const x = (idx / (points.length - 1)) * width;
      const y =
        span > 1e-9 ? pad + (1 - (val - min) / span) * usableH : height / 2;
      return `${idx === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

function TrendStrengthCell({ ticker }: { ticker: ScannedTicker }) {
  const slope = ticker.sma20SlopePct;
  if (slope == null) {
    return <span className="text-slate-400 dark:text-slate-500">—</span>;
  }

  const meta = classifySma20Slope(slope);
  const points = ticker.sma20TrendPoints || [];
  const sparkPath = buildSparkPath(points, 28, 12);
  const aboveSma20 = ticker.sma20 != null ? ticker.price >= ticker.sma20 : null;
  const barHeights = ['h-1', 'h-1.5', 'h-2', 'h-2.5'] as const;

  const tooltip = [
    `20-bar SMA slope: ${slope >= 0 ? '+' : ''}${slope.toFixed(2)}% per bar`,
    ticker.sma20SlopeR2 != null ? `R² ${ticker.sma20SlopeR2.toFixed(2)}` : null,
    aboveSma20 != null ? (aboveSma20 ? 'Price above 20-SMA' : 'Price below 20-SMA') : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div title={tooltip} className="inline-flex flex-col justify-center">
      <div className="flex items-center gap-2">
        {sparkPath ? (
          <svg
            width={28}
            height={12}
            viewBox="0 0 28 12"
            className="shrink-0 overflow-visible"
            aria-hidden="true"
          >
            <line
              x1={0}
              y1={6}
              x2={28}
              y2={6}
              stroke="currentColor"
              strokeWidth={0.75}
              strokeDasharray="1.5 1.5"
              className="text-slate-300 dark:text-slate-700"
            />
            <path
              d={sparkPath}
              fill="none"
              stroke={meta.stroke}
              strokeWidth={1.6}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : null}

        <div className="flex items-end gap-[2px]" aria-hidden="true">
          {barHeights.map((hClass, idx) => {
            const active = idx < meta.bars;
            return (
              <span
                key={idx}
                className={`w-[3px] rounded-[1px] ${hClass} ${
                  active ? meta.barClass : 'bg-slate-200 dark:bg-slate-800'
                }`}
              />
            );
          })}
        </div>
      </div>

      <div className="mt-0.5 flex items-center gap-1 font-mono text-[11px] tabular-nums">
        <span className={`font-semibold ${meta.textClass}`}>
          {slope >= 0 ? '+' : ''}
          {slope.toFixed(2)}%
        </span>
        <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">
          ·
        </span>
        <span className={`font-sans text-[10px] font-medium ${meta.textClass}`}>
          {meta.tier}
        </span>
      </div>
    </div>
  );
}

function ConfidenceMeterCell({
  ticker,
  pattern,
}: {
  ticker: ScannedTicker;
  pattern: DetectedPattern | null;
}) {
  const conf = computeSetupConfidence(ticker, pattern);

  const colorMeta =
    conf.tier === 'High'
      ? {
          text: 'text-emerald-700 dark:text-emerald-400',
          fill: 'bg-emerald-600 dark:bg-emerald-400',
        }
      : conf.tier === 'Solid'
      ? {
          text: 'text-blue-700 dark:text-blue-400',
          fill: 'bg-blue-600 dark:bg-blue-400',
        }
      : conf.tier === 'Watch'
      ? {
          text: 'text-amber-700 dark:text-amber-400',
          fill: 'bg-amber-500 dark:bg-amber-400',
        }
      : {
          text: 'text-slate-500 dark:text-slate-400',
          fill: 'bg-slate-400 dark:bg-slate-500',
        };

  const tooltip = [
    `Setup Confidence: ${conf.score}/100 (${conf.tier})`,
    `Pattern Fit: ${conf.fitPoints}/50`,
    `RVOL Strength: ${conf.rvolPoints}/25`,
    `Trend Alignment: ${conf.trendPoints}/25`,
  ].join(' · ');

  return (
    <div title={tooltip} className="inline-flex min-w-[68px] flex-col items-end justify-center">
      <div className="flex items-baseline gap-1 font-mono tabular-nums">
        <span className={`text-xs font-bold ${colorMeta.text}`}>{conf.score}</span>
        <span className={`font-sans text-[10px] font-semibold ${colorMeta.text}`}>
          {conf.tier}
        </span>
      </div>
      <div
        className="mt-1 h-1.5 w-16 overflow-hidden rounded-xs bg-slate-200 dark:bg-slate-800"
        aria-label={`Confidence ${conf.score} out of 100`}
      >
        <div
          className={`h-full transition-all ${colorMeta.fill}`}
          style={{ width: `${Math.max(4, conf.score)}%` }}
        />
      </div>
    </div>
  );
}

export function ScannerTable({
  tickers,
  selectedSymbol,
  onSelectSymbol,
  watchlist,
  onToggleWatchlist,
  isLoading,
  onResetFilters,
  activePatternType = 'All',
}: ScannerTableProps) {
  if (isLoading) {
    return (
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-4 py-2.5 text-xs font-semibold text-slate-500 dark:border-slate-800 dark:text-slate-400">
          Scanning market price structures...
        </div>
        <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
          {Array.from({ length: 10 }).map((_, idx) => (
            <div key={idx} className="flex h-11 items-center justify-between gap-4 px-4">
              <div className="flex items-center gap-3">
                <div className="h-3.5 w-12 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
                <div className="h-3 w-24 animate-pulse rounded bg-slate-100 dark:bg-slate-800/60" />
              </div>
              <div className="h-3.5 w-32 animate-pulse rounded bg-slate-100 dark:bg-slate-800/60" />
              <div className="h-3.5 w-16 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (tickers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-slate-200 bg-white px-6 py-14 text-center dark:border-slate-800 dark:bg-slate-900">
        <p className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
          No tickers match the active filters
        </p>
        <p className="mt-1.5 max-w-sm text-xs text-slate-500 dark:text-slate-400">
          Broaden the pattern category, stage, or directional bias, or switch timeframes to inspect more setups.
        </p>
        <button
          type="button"
          onClick={onResetFilters}
          className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          Reset Filters
        </button>
      </div>
    );
  }

  const splitIndex = Math.ceil(tickers.length / 2);
  const leftTickers = tickers.slice(0, splitIndex);
  const rightTickers = tickers.slice(splitIndex);

  const panels =
    rightTickers.length > 0
      ? [
          {
            label: `Panel 1 · Setups 1–${leftTickers.length}`,
            rows: leftTickers,
            startRank: 1,
          },
          {
            label: `Panel 2 · Setups ${splitIndex + 1}–${tickers.length}`,
            rows: rightTickers,
            startRank: splitIndex + 1,
          },
        ]
      : [
          {
            label: `Scanned Setups (${leftTickers.length})`,
            rows: leftTickers,
            startRank: 1,
          },
        ];

  return (
    <div
      className={`grid grid-cols-1 gap-4 ${
        panels.length > 1 ? 'xl:grid-cols-2' : ''
      }`}
    >
      {panels.map((panel) => (
        <div
          key={panel.label}
          className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/70 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/80">
            <span className="font-display text-xs font-semibold text-slate-800 dark:text-slate-200">
              {panel.label}
            </span>
            <span className="font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
              {panel.rows.length} {panel.rows.length === 1 ? 'ticker' : 'tickers'}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/40 text-[11px] font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
                  <th className="w-7 py-2 pl-2.5 pr-1" aria-label="Watchlist" />
                  <th className="py-2 pr-2">Ticker</th>
                  <th className="py-2 px-1.5 text-right">Last / Chg</th>
                  <th className="py-2 px-1.5">20-SMA Trend</th>
                  <th className="py-2 px-1.5">Pattern &amp; Bias</th>
                  <th className="py-2 px-1.5 text-right">Trigger / Target</th>
                  <th className="py-2 px-1.5 text-right">RVOL / Vol</th>
                  <th className="py-2 px-1.5 text-right">Short</th>
                  <th className="py-2 px-1.5 text-right">Fit</th>
                  <th className="py-2 pl-1.5 pr-3 text-right">Confidence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {panel.rows.map((ticker) => {
                  const isSelected = ticker.symbol === selectedSymbol;
                  const isSaved = watchlist.includes(ticker.symbol);
                  const pat =
                    activePatternType !== 'All'
                      ? ticker.patterns.find((p) => p.type === activePatternType) || ticker.primaryPattern
                      : ticker.primaryPattern;
                  const va = ticker.volumeAnalysis;
                  const si = ticker.shortInterest;

                  return (
                    <tr
                      key={ticker.symbol}
                      onClick={() => onSelectSymbol(ticker.symbol)}
                      className={`h-11 cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-blue-50/70 dark:bg-blue-950/35'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                      }`}
                    >
                      <td className="py-2 pl-2.5 pr-1">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleWatchlist(ticker.symbol);
                          }}
                          aria-label={isSaved ? `Remove ${ticker.symbol} from watchlist` : `Add ${ticker.symbol} to watchlist`}
                          className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:text-amber-500 focus-visible:outline-2 focus-visible:outline-blue-600"
                        >
                          <Star
                            className={`h-3.5 w-3.5 ${
                              isSaved ? 'fill-amber-400 text-amber-500' : ''
                            }`}
                          />
                        </button>
                      </td>

                      <td className="py-2 pr-2">
                        <div className="flex items-baseline gap-1 whitespace-nowrap">
                          <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                            {ticker.symbol}
                          </span>
                          <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500">
                            {ticker.exchange}
                          </span>
                          {ticker.isIndex && (
                            <span className="text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                              · Idx
                            </span>
                          )}
                          {ticker.isETF && (
                            <span className="text-[10px] font-semibold text-blue-600 dark:text-blue-400">
                              · ETF
                            </span>
                          )}
                        </div>
                        <div className="max-w-[115px] truncate text-[11px] text-slate-500 dark:text-slate-400">
                          {ticker.name}
                        </div>
                      </td>

                      <td className="py-2 px-1.5 text-right font-mono tabular-nums whitespace-nowrap">
                        <div className="font-medium text-slate-900 dark:text-slate-100">
                          {formatAssetPrice(ticker.price, ticker.currency, ticker.symbol)}
                        </div>
                        <div
                          className={`text-[11px] ${
                            ticker.changePct >= 0
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          {ticker.changePct >= 0 ? '+' : ''}
                          {ticker.changePct.toFixed(2)}%
                        </div>
                      </td>

                      <td className="py-2 px-1.5 whitespace-nowrap">
                        <TrendStrengthCell ticker={ticker} />
                      </td>

                      <td className="py-2 px-1.5 whitespace-nowrap">
                        {pat ? (
                          <div>
                            <div className="flex items-center gap-1 font-medium text-slate-900 dark:text-slate-100">
                              {pat.bias === 'Bullish' && (
                                <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                              )}
                              {pat.bias === 'Bearish' && (
                                <ArrowDownRight className="h-3.5 w-3.5 shrink-0 text-rose-600 dark:text-rose-400" />
                              )}
                              {pat.bias === 'Neutral' && (
                                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-500 dark:text-slate-400" />
                              )}
                              <span>{pat.type}</span>
                            </div>
                            <div
                              className={`text-[11px] ${
                                pat.stage === 'Breakout'
                                  ? 'font-semibold text-blue-600 dark:text-blue-400'
                                  : pat.stage === 'Testing Level'
                                  ? 'font-medium text-amber-600 dark:text-amber-400'
                                  : 'text-slate-500 dark:text-slate-400'
                              }`}
                            >
                              {pat.stage}
                              <span className="text-slate-400 dark:text-slate-500"> · {pat.bias}</span>
                              {ticker.patterns.length > 1 ? ` (+${ticker.patterns.length - 1})` : ''}
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-400 dark:text-slate-500">No active pattern</span>
                        )}
                      </td>

                      <td className="py-2 px-1.5 text-right font-mono tabular-nums whitespace-nowrap">
                        {pat ? (
                          <div>
                            <div className="text-slate-900 dark:text-slate-100">
                              {formatAssetPrice(pat.breakoutPrice, ticker.currency, ticker.symbol)}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              T {formatAssetPrice(pat.targetPrice, ticker.currency, ticker.symbol)} · {pat.riskReward.toFixed(1)}:1
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>

                      <td className="py-2 px-1.5 text-right font-mono tabular-nums whitespace-nowrap">
                        <div
                          className={`font-medium ${
                            ticker.rvol >= 1.3
                              ? 'text-blue-600 dark:text-blue-400'
                              : 'text-slate-900 dark:text-slate-100'
                          }`}
                        >
                          {ticker.rvol.toFixed(2)}x
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          {(ticker.volume / 1_000_000).toFixed(1)}M{va ? ` · ${va.upDownVolumeRatio.toFixed(2)}u/d` : ''}
                        </div>
                      </td>

                      <td className="py-2 px-1.5 text-right font-mono tabular-nums whitespace-nowrap">
                        {si?.shortPercentOfFloat != null ? (
                          <div>
                            <div
                              className={`font-medium ${
                                si.shortPercentOfFloat >= 10
                                  ? 'text-amber-600 dark:text-amber-400'
                                  : 'text-slate-900 dark:text-slate-100'
                              }`}
                            >
                              {si.shortPercentOfFloat.toFixed(1)}%
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              {si.shortRatio != null ? `${si.shortRatio.toFixed(1)}d` : '—'}
                            </div>
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-400">N/A</span>
                        )}
                      </td>

                      <td className="py-2 px-1.5 text-right font-mono tabular-nums whitespace-nowrap font-medium text-slate-900 dark:text-slate-100">
                        {pat ? `${pat.fitScore}%` : '—'}
                      </td>

                      <td className="py-2 pl-1.5 pr-3 text-right whitespace-nowrap">
                        <ConfidenceMeterCell ticker={ticker} pattern={pat} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
