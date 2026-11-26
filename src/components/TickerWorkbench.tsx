import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BarChart2,
  Bell,
  BellPlus,
  Calendar,
  Camera,
  Check,
  CheckCircle2,
  Crosshair,
  Download,
  ExternalLink,
  History,
  Images,
  Layers,
  Newspaper,
  Star,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  MultiTimeframeSummary,
  PatternType,
  PriceAlert,
  TickerDetailResponse,
  Timeframe,
} from '../shared/types.ts';
import {
  clearChartSnapshotsFromStorage,
  deleteChartSnapshotFromStorage,
  downloadPngDataUrl,
  exportChartLayoutAsPng,
  listSavedChartSnapshots,
  saveChartSnapshotToStorage,
  type SavedChartSnapshot,
} from '../utils/chartSnapshot.ts';
import { computeFixedRangeVolumeProfile } from '../utils/volumeProfile.ts';
import { HISTORICAL_ANALOG_COLORS, PatternChart } from './PatternChart.tsx';

interface TickerWorkbenchProps {
  detail: TickerDetailResponse | null;
  timeframe: Timeframe;
  onTimeframeChange: (tf: Timeframe) => void;
  isLoading: boolean;
  error: string | null;
  isWatchlisted: boolean;
  onToggleWatchlist: (symbol: string) => void;
  onRetry: () => void;
  activePatternType?: 'All' | PatternType;
  alerts?: PriceAlert[];
  onAddAlert?: (input: {
    symbol: string;
    name: string;
    currency?: string;
    condition: 'above' | 'below';
    targetPrice: number;
    sourceLabel: string;
  }) => void;
  onToggleAlert?: (id: string) => void;
  onDeleteAlert?: (id: string) => void;
}

function formatPrice(value: number, currency?: string, symbol?: string): string {
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

export function TickerWorkbench({
  detail,
  timeframe,
  onTimeframeChange,
  isLoading,
  error,
  isWatchlisted,
  onToggleWatchlist,
  onRetry,
  activePatternType = 'All',
  alerts = [],
  onAddAlert,
  onToggleAlert,
  onDeleteAlert,
}: TickerWorkbenchProps) {
  const [selectedPatternIdx, setSelectedPatternIdx] = useState(0);
  const [showPatternOverlay, setShowPatternOverlay] = useState(true);
  const [showHistoricalOverlay, setShowHistoricalOverlay] = useState(false);
  const [historicalDisplayMode, setHistoricalDisplayMode] = useState<'analog' | 'timeline'>('analog');
  const [selectedBacktestType, setSelectedBacktestType] = useState<PatternType | ''>('');
  const [enabledHistoricalIds, setEnabledHistoricalIds] = useState<string[]>([]);
  const [showSma20, setShowSma20] = useState(true);
  const [showSma50, setShowSma50] = useState(true);
  const [showSma200, setShowSma200] = useState(false);
  const [showVwap20, setShowVwap20] = useState(false);
  const [showRsi, setShowRsi] = useState(true);
  const [showEvents, setShowEvents] = useState(true);
  const [showVolumeProfile, setShowVolumeProfile] = useState(true);
  const [vpRangeMode, setVpRangeMode] = useState<'visible' | 'pattern' | '60b' | '120b' | 'all' | 'custom'>('visible');
  const [vpCustomBounds, setVpCustomBounds] = useState<{ startIndex: number; endIndex: number } | null>(null);
  const [vpRows, setVpRows] = useState<24 | 32 | 48>(32);
  const [vpAnchor, setVpAnchor] = useState<'range-left' | 'chart-right'>('range-left');
  const [isPickingVpRange, setIsPickingVpRange] = useState(false);
  const [vpPickAnchorIndex, setVpPickAnchorIndex] = useState<number | null>(null);
  const [visibleBars, setVisibleBars] = useState<65 | 105 | 160 | 'all'>(105);

  const chartSvgRef = useRef<SVGSVGElement | null>(null);
  const [savedSnapshots, setSavedSnapshots] = useState<SavedChartSnapshot[]>([]);
  const [showSavedSnapshots, setShowSavedSnapshots] = useState(false);
  const [isExportingPng, setIsExportingPng] = useState(false);
  const [exportStatusMsg, setExportStatusMsg] = useState<string | null>(null);
  const [exportErrorMsg, setExportErrorMsg] = useState<string | null>(null);

  const [mtfData, setMtfData] = useState<MultiTimeframeSummary | null>(null);
  const [isLoadingMtf, setIsLoadingMtf] = useState(false);
  const mtfReqSeqRef = useRef(0);

  const [customAlertPrice, setCustomAlertPrice] = useState('');
  const [customAlertCond, setCustomAlertCond] = useState<'above' | 'below'>('above');

  useEffect(() => {
    let active = true;
    void listSavedChartSnapshots().then((list) => {
      if (active) setSavedSnapshots(list);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setVpCustomBounds(null);
    setIsPickingVpRange(false);
    setVpPickAnchorIndex(null);
    setVpRangeMode((prev) => (prev === 'custom' ? 'visible' : prev));
  }, [detail?.symbol, timeframe]);

  useEffect(() => {
    const sym = detail?.symbol;
    if (!sym) {
      setMtfData(null);
      return;
    }
    const seq = ++mtfReqSeqRef.current;
    setIsLoadingMtf(true);
    fetch(`/api/ticker/${encodeURIComponent(sym)}/mtf`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: MultiTimeframeSummary | null) => {
        if (seq !== mtfReqSeqRef.current) return;
        if (data && Array.isArray(data.cells)) setMtfData(data);
      })
      .catch(() => {
        if (seq === mtfReqSeqRef.current) setMtfData(null);
      })
      .finally(() => {
        if (seq === mtfReqSeqRef.current) setIsLoadingMtf(false);
      });
  }, [detail?.symbol]);

  useEffect(() => {
    if (detail) {
      setCustomAlertPrice(detail.price.toFixed(2));
      setCustomAlertCond('above');
    }
  }, [detail?.symbol, detail?.price]);

  useEffect(() => {
    if (detail && activePatternType !== 'All') {
      const idx = detail.patterns.findIndex((p) => p.type === activePatternType);
      setSelectedPatternIdx(idx >= 0 ? idx : 0);
    } else {
      setSelectedPatternIdx(0);
    }
  }, [detail, activePatternType]);

  const activePattern = detail?.patterns[selectedPatternIdx] || detail?.patterns[0] || null;

  const volumeProfile = useMemo(() => {
    if (!showVolumeProfile || !detail?.bars || detail.bars.length === 0) return null;
    const totalLen = detail.bars.length;
    const lastIdx = totalLen - 1;
    const visibleCount = visibleBars === 'all' ? totalLen : visibleBars;

    let startIdx = Math.max(0, totalLen - visibleCount);
    let endIdx = lastIdx;

    if (vpRangeMode === 'pattern' && activePattern) {
      startIdx = Math.max(0, Math.min(lastIdx, activePattern.startIndex));
      endIdx = lastIdx;
    } else if (vpRangeMode === '60b') {
      startIdx = Math.max(0, totalLen - 60);
    } else if (vpRangeMode === '120b') {
      startIdx = Math.max(0, totalLen - 120);
    } else if (vpRangeMode === 'all') {
      startIdx = 0;
    } else if (vpRangeMode === 'custom' && vpCustomBounds) {
      startIdx = Math.max(0, Math.min(lastIdx, vpCustomBounds.startIndex));
      endIdx = Math.max(startIdx, Math.min(lastIdx, vpCustomBounds.endIndex));
    }

    return computeFixedRangeVolumeProfile(detail.bars, startIdx, endIdx, vpRows);
  }, [
    showVolumeProfile,
    detail?.bars,
    visibleBars,
    vpRangeMode,
    vpCustomBounds,
    vpRows,
    activePattern,
  ]);

  const availableBacktestTypes = useMemo(() => {
    const types = new Set<PatternType>();
    for (const h of detail?.historicalPatterns || []) {
      types.add(h.type);
    }
    return Array.from(types);
  }, [detail?.historicalPatterns]);

  // Sync selectedBacktestType to the active pattern when available, or first historical type
  useEffect(() => {
    if (!detail) return;
    if (activePattern && availableBacktestTypes.includes(activePattern.type)) {
      setSelectedBacktestType(activePattern.type);
    } else if (availableBacktestTypes.length > 0) {
      setSelectedBacktestType((prev) =>
        prev && availableBacktestTypes.includes(prev) ? prev : availableBacktestTypes[0]
      );
    } else {
      setSelectedBacktestType(activePattern?.type || '');
    }
  }, [detail, activePattern, availableBacktestTypes]);

  const matchingHistorical = useMemo(() => {
    if (!detail?.historicalPatterns || !selectedBacktestType) return [];
    return detail.historicalPatterns.filter((h) => h.type === selectedBacktestType);
  }, [detail?.historicalPatterns, selectedBacktestType]);

  // Pre-select up to 4 recent historical instances whenever the pattern type or ticker changes
  useEffect(() => {
    setEnabledHistoricalIds(matchingHistorical.slice(0, 4).map((h) => h.id));
  }, [matchingHistorical]);

  const overlaidHistorical = useMemo(
    () => matchingHistorical.filter((h) => enabledHistoricalIds.includes(h.id)),
    [matchingHistorical, enabledHistoricalIds]
  );

  const backtestStats = useMemo(() => {
    if (matchingHistorical.length === 0) return null;
    const resolved = matchingHistorical.filter((h) => h.outcome !== 'Open / Mixed');
    const wins = resolved.filter((h) => h.outcome === 'Target Hit').length;
    const hitRate = resolved.length > 0 ? Math.round((wins / resolved.length) * 100) : null;

    const r10 = matchingHistorical
      .map((h) => h.forwardReturn10Pct)
      .filter((v): v is number => v != null);
    const r20 = matchingHistorical
      .map((h) => h.forwardReturn20Pct)
      .filter((v): v is number => v != null);

    const avg10 = r10.length > 0 ? r10.reduce((a, b) => a + b, 0) / r10.length : null;
    const avg20 = r20.length > 0 ? r20.reduce((a, b) => a + b, 0) / r20.length : null;
    const avgMfe =
      matchingHistorical.reduce((a, b) => a + b.maxFavorablePct, 0) / matchingHistorical.length;
    const avgMae =
      matchingHistorical.reduce((a, b) => a + b.maxAdversePct, 0) / matchingHistorical.length;
    const breakoutsCount = matchingHistorical.filter((h) => h.stage === 'Breakout').length;

    return {
      total: matchingHistorical.length,
      breakoutsCount,
      wins,
      resolvedCount: resolved.length,
      hitRate,
      avg10,
      avg20,
      avgMfe,
      avgMae,
    };
  }, [matchingHistorical]);

  if (isLoading && !detail) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4 dark:border-slate-800">
          <div className="space-y-2">
            <div className="h-5 w-44 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
            <div className="h-3.5 w-64 animate-pulse rounded bg-slate-100 dark:bg-slate-800/60" />
          </div>
          <div className="h-7 w-24 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
        </div>
        <div className="mt-5 h-[400px] w-full animate-pulse rounded bg-slate-100 dark:bg-slate-800/50" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-slate-200 bg-white px-6 py-16 text-center dark:border-slate-800 dark:bg-slate-900">
        <p className="font-display text-sm font-semibold text-rose-600 dark:text-rose-400">
          Unable to load chart data
        </p>
        <p className="mt-1.5 max-w-md text-xs text-slate-600 dark:text-slate-400">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-blue-600 dark:hover:bg-blue-500"
        >
          Retry Fetch
        </button>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-slate-200 bg-white px-6 py-20 text-center dark:border-slate-800 dark:bg-slate-900">
        <p className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
          Select a ticker from the scanner
        </p>
        <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
          Click any row to inspect candlestick structure, trendline geometry, and measured move levels.
        </p>
      </div>
    );
  }

  const toggleHistoricalInstance = (id: string) => {
    setEnabledHistoricalIds((prev) => {
      const next = prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id];
      if (next.length > 0 && !showHistoricalOverlay) {
        setShowHistoricalOverlay(true);
      }
      return next;
    });
  };

  const handleSaveAndDownloadPng = async () => {
    if (!detail || !chartSvgRef.current || isExportingPng) return;
    setIsExportingPng(true);
    setExportErrorMsg(null);
    setExportStatusMsg(null);
    try {
      const isDarkTheme = document.documentElement.classList.contains('dark');
      const activeOverlays: string[] = [];
      if (showPatternOverlay && activePattern) activeOverlays.push(activePattern.type);
      if (showHistoricalOverlay && overlaidHistorical.length > 0) {
        activeOverlays.push(
          `Backtest (${selectedBacktestType || overlaidHistorical[0].type} ×${overlaidHistorical.length})`
        );
      }
      if (showVolumeProfile && volumeProfile) {
        activeOverlays.push(
          `FRVP (POC ${formatPrice(volumeProfile.pocPrice, detail.currency, detail.symbol)})`
        );
      }
      if (showSma20) activeOverlays.push('SMA20');
      if (showSma50) activeOverlays.push('SMA50');
      if (showSma200) activeOverlays.push('SMA200');
      if (showVwap20) activeOverlays.push('VWAP20');
      if (showRsi) activeOverlays.push('RSI14');

      const snap = await exportChartLayoutAsPng(chartSvgRef.current, {
        symbol: detail.symbol,
        name: detail.name,
        exchange: detail.exchange,
        timeframe,
        priceLabel: formatPrice(detail.price, detail.currency, detail.symbol),
        changeLabel: `${detail.change >= 0 ? '+' : ''}${detail.change.toFixed(2)} (${
          detail.changePct >= 0 ? '+' : ''
        }${detail.changePct.toFixed(2)}%)`,
        isPositive: detail.changePct >= 0,
        patternSummary: activePattern
          ? `${activePattern.type} (${activePattern.bias}) · ${activePattern.stage} · Fit ${activePattern.fitScore}%`
          : null,
        activeOverlays,
        isDark: isDarkTheme,
      });

      const updated = await saveChartSnapshotToStorage(snap);
      setSavedSnapshots(updated);
      downloadPngDataUrl(snap.dataUrl, snap.filename);
      setExportStatusMsg('Saved & Downloaded');
      window.setTimeout(() => setExportStatusMsg(null), 3000);
    } catch (err) {
      setExportErrorMsg(err instanceof Error ? err.message : 'Failed to export PNG');
    } finally {
      setIsExportingPng(false);
    }
  };

  const handleDeleteSnapshot = async (id: string) => {
    const updated = await deleteChartSnapshotFromStorage(id);
    setSavedSnapshots(updated);
  };

  const handleClearAllSnapshots = async () => {
    await clearChartSnapshotsFromStorage();
    setSavedSnapshots([]);
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      {/* Header Row */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="font-display text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              {detail.symbol}
            </h2>
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
              {detail.name}
            </span>
            <button
              type="button"
              onClick={() => onToggleWatchlist(detail.symbol)}
              className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <Star className={`h-3.5 w-3.5 ${isWatchlisted ? 'fill-amber-400 text-amber-500' : ''}`} />
              <span>{isWatchlisted ? 'Watchlisted' : 'Watchlist'}</span>
            </button>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span className="font-medium text-slate-700 dark:text-slate-300">{detail.exchange}</span>
            {detail.isIndex && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-semibold text-slate-700 dark:text-slate-200">Index</span>
              </>
            )}
            {detail.isETF && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-semibold text-blue-600 dark:text-blue-400">ETF</span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span>{detail.sector}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              Day {formatPrice(detail.dayLow, detail.currency, detail.symbol)}–{formatPrice(detail.dayHigh, detail.currency, detail.symbol)}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              Vol {(detail.volume / 1_000_000).toFixed(2)}M ({detail.rvol.toFixed(2)}x)
            </span>
            <span aria-hidden="true">·</span>
            <span>{detail.marketState === 'REGULAR' ? 'Market Open' : detail.marketState === 'PRE' ? 'Pre-Market' : detail.marketState === 'POST' ? 'After Hours' : 'Market Closed'}</span>
          </div>
        </div>

        <div className="text-right font-mono tabular-nums">
          <div className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            {formatPrice(detail.price, detail.currency, detail.symbol)}
          </div>
          <div
            className={`text-xs font-medium ${
              detail.changePct >= 0
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-rose-600 dark:text-rose-400'
            }`}
          >
            {detail.change >= 0 ? '+' : ''}
            {detail.change.toFixed(2)} ({detail.changePct >= 0 ? '+' : ''}
            {detail.changePct.toFixed(2)}%)
          </div>
        </div>
      </div>

      {/* Chart Controls & Pattern Selector Strip */}
      <div className="mt-3 mb-3 flex flex-wrap items-center justify-between gap-3">
        {/* Detected Pattern Tabs */}
        <div className="flex flex-wrap items-center gap-1.5">
          {detail.patterns.length > 0 ? (
            detail.patterns.map((p, idx) => {
              const isActive = idx === selectedPatternIdx;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedPatternIdx(idx)}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    isActive
                      ? 'bg-slate-900 text-white dark:bg-blue-600'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                  }`}
                >
                  <span>{p.type}</span>
                  <span className="font-mono text-[11px] opacity-80">{p.fitScore}%</span>
                </button>
              );
            })
          ) : (
            <span className="text-xs text-slate-500 dark:text-slate-400">
              No geometric pattern match on current timeframe
            </span>
          )}
        </div>

        {/* Timeframe, Indicator & Zoom Toggles */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-md bg-slate-100 p-0.5 dark:bg-slate-800" role="group" aria-label="Chart timeframe">
            {(
              [
                { id: '1m', label: '1m' },
                { id: '15m', label: '15m' },
                { id: '1h', label: '1H' },
                { id: '4h', label: '4H' },
                { id: '1d', label: '1D' },
                { id: '1wk', label: '1W' },
                { id: '1mo', label: '1M' },
              ] as const
            ).map((tf) => (
              <button
                key={tf.id}
                type="button"
                onClick={() => onTimeframeChange(tf.id)}
                className={`rounded px-2 py-1 font-mono text-[11px] font-medium transition-colors whitespace-nowrap ${
                  timeframe === tf.id
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-slate-100'
                    : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                {tf.label}
              </button>
            ))}
          </div>

          <div className="flex items-center rounded-md bg-slate-100 p-0.5 dark:bg-slate-800">
            {([65, 105, 160, 'all'] as const).map((len) => (
              <button
                key={String(len)}
                type="button"
                onClick={() => setVisibleBars(len)}
                className={`rounded px-2 py-1 font-mono text-[11px] font-medium transition-colors whitespace-nowrap ${
                  visibleBars === len
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-slate-100'
                    : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                {len === 'all' ? 'All' : `${len}B`}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={() => setShowHistoricalOverlay((v) => !v)}
              disabled={matchingHistorical.length === 0}
              title="Overlay historical instances of the selected pattern for visual backtesting"
              className={`inline-flex items-center gap-1 rounded border px-2 py-1 font-mono text-[11px] font-medium transition-colors whitespace-nowrap disabled:opacity-45 ${
                showHistoricalOverlay && matchingHistorical.length > 0
                  ? 'border-amber-600/50 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-950/50 dark:text-amber-300'
                  : 'border-slate-200 text-slate-500 hover:text-slate-800 dark:border-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <History className="h-3 w-3" />
              <span>
                Backtest{matchingHistorical.length > 0 ? ` (${matchingHistorical.length})` : ''}
              </span>
            </button>
              <button
                type="button"
                onClick={() => setShowVolumeProfile((v) => !v)}
                title="Toggle Fixed Range Volume Profile (FRVP) price-at-volume histogram"
                className={`inline-flex items-center gap-1 rounded border px-2 py-1 font-mono text-[11px] font-medium transition-colors whitespace-nowrap ${
                  showVolumeProfile
                    ? 'border-cyan-600/50 bg-cyan-50 text-cyan-800 dark:border-cyan-500/40 dark:bg-cyan-950/50 dark:text-cyan-300'
                    : 'border-slate-200 text-slate-500 hover:text-slate-800 dark:border-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                <BarChart2 className="h-3 w-3" />
                <span>Vol Profile</span>
              </button>
              {
              [
                { label: 'Pattern', active: showPatternOverlay, toggle: () => setShowPatternOverlay((v) => !v) },
                { label: 'SMA20', active: showSma20, toggle: () => setShowSma20((v) => !v) },
                { label: 'SMA50', active: showSma50, toggle: () => setShowSma50((v) => !v) },
                { label: 'SMA200', active: showSma200, toggle: () => setShowSma200((v) => !v) },
                { label: 'VWAP20', active: showVwap20, toggle: () => setShowVwap20((v) => !v) },
                { label: 'RSI', active: showRsi, toggle: () => setShowRsi((v) => !v) },
                { label: 'Events', active: showEvents, toggle: () => setShowEvents((v) => !v) },
              ].map((ind) => (
                <button
                  key={ind.label}
                  type="button"
                  onClick={ind.toggle}
                  className={`rounded border px-2 py-1 font-mono text-[11px] font-medium transition-colors whitespace-nowrap ${
                    ind.active
                      ? 'border-blue-600/40 bg-blue-50 text-blue-700 dark:border-blue-500/40 dark:bg-blue-950/50 dark:text-blue-300'
                      : 'border-slate-200 text-slate-500 hover:text-slate-800 dark:border-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  {ind.label}
                </button>
              ))
            }

            <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-slate-200 dark:bg-slate-700" />

            <button
              type="button"
              onClick={() => void handleSaveAndDownloadPng()}
              disabled={isExportingPng}
              title="Save the current chart layout as a high-res PNG to browser storage and download it"
              className={`inline-flex items-center gap-1 rounded border px-2.5 py-1 font-mono text-[11px] font-semibold transition-colors whitespace-nowrap disabled:opacity-50 ${
                exportStatusMsg
                  ? 'border-emerald-600/50 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-950/50 dark:text-emerald-300'
                  : 'border-slate-300 bg-slate-900 text-white hover:bg-slate-800 dark:border-blue-500 dark:bg-blue-600 dark:hover:bg-blue-500'
              }`}
            >
              {exportStatusMsg ? (
                <Check className="h-3 w-3" />
              ) : (
                <Camera className="h-3 w-3" />
              )}
              <span>
                {isExportingPng ? 'Exporting…' : exportStatusMsg ? 'Saved PNG' : 'Save PNG'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setShowSavedSnapshots((v) => !v)}
              title="View and download PNG chart snapshots saved in browser storage"
              className={`inline-flex items-center gap-1 rounded border px-2 py-1 font-mono text-[11px] font-medium transition-colors whitespace-nowrap ${
                showSavedSnapshots
                  ? 'border-blue-600/40 bg-blue-50 text-blue-700 dark:border-blue-500/40 dark:bg-blue-950/50 dark:text-blue-300'
                  : 'border-slate-200 text-slate-600 hover:text-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:text-slate-100'
              }`}
            >
              <Images className="h-3 w-3" />
              <span>Saved ({savedSnapshots.length})</span>
            </button>
          </div>
        </div>
      </div>

      {exportErrorMsg && (
        <div className="mb-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
          {exportErrorMsg}
        </div>
      )}

      {/* Main Candlestick + D3 Pattern Geometry Chart */}
      <PatternChart
        chartSvgRef={chartSvgRef}
        symbol={detail.symbol}
        bars={detail.bars}
        pattern={activePattern}
        showPatternOverlay={showPatternOverlay}
        showSma20={showSma20}
        showSma50={showSma50}
        showSma200={showSma200}
        showVwap20={showVwap20}
        showRsi={showRsi}
        visibleBarsCount={visibleBars === 'all' ? detail.bars.length : visibleBars}
        historicalInstances={overlaidHistorical}
        showHistoricalOverlay={showHistoricalOverlay}
        historicalDisplayMode={historicalDisplayMode}
        volumeProfile={volumeProfile}
        showVolumeProfile={showVolumeProfile}
        volumeProfileAnchor={vpAnchor}
        isPickingVpRange={isPickingVpRange}
        vpPickAnchorIndex={vpPickAnchorIndex}
        onSelectVpBar={(absBarIdx) => {
          if (vpPickAnchorIndex == null) {
            setVpPickAnchorIndex(absBarIdx);
          } else {
            const startIndex = Math.min(vpPickAnchorIndex, absBarIdx);
            const endIndex = Math.max(vpPickAnchorIndex, absBarIdx);
            setVpCustomBounds({ startIndex, endIndex });
            setVpRangeMode('custom');
            setIsPickingVpRange(false);
            setVpPickAnchorIndex(null);
          }
        }}
        onChangeVpBounds={(startIndex, endIndex) => {
          setVpCustomBounds({ startIndex, endIndex });
          setVpRangeMode('custom');
        }}
        corporateEvents={detail.corporateEvents}
        showEvents={showEvents}
        priceAlerts={alerts}
      />

      {/* Upcoming Earnings / Ex-Dividend Catalyst Banner */}
      {showEvents &&
        detail.corporateEvents &&
        detail.corporateEvents.some((ev) => ev.isUpcoming && ev.daysAway >= 0 && ev.daysAway <= 60) && (
          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2.5 text-xs dark:border-slate-800/80">
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-1.5 font-semibold text-slate-700 dark:text-slate-300">
                <Calendar className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                Upcoming Catalysts
              </span>
              {detail.corporateEvents
                .filter((ev) => ev.isUpcoming && ev.daysAway >= 0 && ev.daysAway <= 60)
                .sort((a, b) => a.timestamp - b.timestamp)
                .map((ev) => (
                  <span
                    key={ev.id}
                    className={`font-mono text-[11px] tabular-nums font-medium ${
                      ev.type === 'Earnings'
                        ? 'text-indigo-700 dark:text-indigo-400'
                        : 'text-teal-700 dark:text-teal-400'
                    }`}
                  >
                    {ev.detail}: {ev.dateLabel} ({ev.daysAway === 0 ? 'Today' : `in ${ev.daysAway}d`})
                  </span>
                ))}
            </div>
            <span className="font-mono text-[10px] text-slate-400 dark:text-slate-500">
              Chart pins: E Earnings · D Ex-Div · S Split
            </span>
          </div>
        )}

      {/* Saved PNG Chart Layouts Drawer (Browser IndexedDB Storage) */}
      {showSavedSnapshots && (
        <div className="mt-4 border-t border-slate-200 pt-3.5 dark:border-slate-800">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5">
            <div className="flex items-center gap-2">
              <Images className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
              <h4 className="font-display text-xs font-semibold text-slate-900 dark:text-slate-100">
                Saved Chart Layouts (Browser Storage)
              </h4>
              <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                {savedSnapshots.length} PNG{savedSnapshots.length === 1 ? '' : 's'} stored locally
              </span>
            </div>

            {savedSnapshots.length > 0 && (
              <button
                type="button"
                onClick={() => void handleClearAllSnapshots()}
                className="text-[11px] font-medium text-rose-600 hover:underline dark:text-rose-400"
              >
                Clear All
              </button>
            )}
          </div>

          {savedSnapshots.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              No chart layouts saved yet. Click <strong className="font-semibold text-slate-700 dark:text-slate-200">Save PNG</strong> above to store the current chart layout in browser storage and download it.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {savedSnapshots.map((snap) => (
                <div
                  key={snap.id}
                  className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-950/40"
                >
                  <div className="aspect-[16/7] w-full overflow-hidden border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                    <img
                      src={snap.dataUrl}
                      alt={`${snap.symbol} ${snap.timeframe} saved chart`}
                      className="h-full w-full object-cover object-top"
                    />
                  </div>
                  <div className="p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-bold text-slate-900 dark:text-slate-100">
                        {snap.symbol} · {snap.timeframe.toUpperCase()}
                      </span>
                      <span className="font-mono text-[11px] tabular-nums text-slate-600 dark:text-slate-300">
                        {snap.priceLabel}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
                      {snap.patternSummary || snap.name}
                    </div>
                    <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-slate-200/80 pt-2 dark:border-slate-800">
                      <span className="font-mono text-[10px] tabular-nums text-slate-400 dark:text-slate-500">
                        {new Date(snap.createdAt).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                          hour12: false,
                        })}{' '}
                        · {Math.round(snap.sizeBytes / 1024)} KB
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => downloadPngDataUrl(snap.dataUrl, snap.filename)}
                          title={`Download ${snap.filename}`}
                          className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-blue-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-blue-400 dark:hover:bg-slate-700"
                        >
                          <Download className="h-3 w-3" />
                          <span>PNG</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteSnapshot(snap.id)}
                          aria-label={`Delete saved ${snap.symbol} snapshot`}
                          className="rounded border border-slate-200 bg-white p-1 text-slate-500 hover:text-rose-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:text-rose-400"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Fixed Range Volume Profile Controls & Key Support / Resistance Levels */}
      {showVolumeProfile && volumeProfile && (
        <div className="mt-4 border-t border-slate-200 pt-3 dark:border-slate-800">
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200">
                <BarChart2 className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400" />
                <span>Volume Profile (Fixed Range)</span>
              </div>
              <span className="font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                {volumeProfile.startDateLabel.split(',')[0]}–{volumeProfile.endDateLabel.split(',')[0]} ({volumeProfile.barCount}B)
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Fixed Range Presets */}
              <div className="flex items-center rounded bg-slate-200/70 p-0.5 dark:bg-slate-800">
                {(
                  [
                    { id: 'visible', label: 'Visible' },
                    ...(activePattern ? [{ id: 'pattern', label: 'Pattern' }] : []),
                    { id: '60b', label: '60B' },
                    { id: '120b', label: '120B' },
                    { id: 'all', label: 'All' },
                  ] as Array<{ id: 'visible' | 'pattern' | '60b' | '120b' | 'all'; label: string }>
                ).map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => {
                      setIsPickingVpRange(false);
                      setVpPickAnchorIndex(null);
                      setVpRangeMode(preset.id);
                    }}
                    className={`rounded px-2 py-0.5 font-mono text-[11px] font-medium transition-colors whitespace-nowrap ${
                      vpRangeMode === preset.id
                        ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-slate-100'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              {/* Interactive Range Picker */}
              <button
                type="button"
                onClick={() => {
                  setIsPickingVpRange((prev) => !prev);
                  setVpPickAnchorIndex(null);
                }}
                title="Click two bars on the chart to set a custom Fixed Range Volume Profile window, or drag the cyan rails directly on the chart"
                className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[11px] font-medium transition-colors whitespace-nowrap ${
                  isPickingVpRange
                    ? 'border-cyan-600 bg-cyan-600 text-white dark:border-cyan-500 dark:bg-cyan-500 dark:text-slate-950'
                    : vpRangeMode === 'custom'
                    ? 'border-cyan-600/50 bg-cyan-50 text-cyan-800 dark:border-cyan-500/40 dark:bg-cyan-950/50 dark:text-cyan-300'
                    : 'border-slate-200 bg-white text-slate-600 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                }`}
              >
                <Crosshair className="h-3 w-3" />
                <span>
                  {isPickingVpRange
                    ? vpPickAnchorIndex == null
                      ? 'Click Start Bar'
                      : 'Click End Bar'
                    : vpRangeMode === 'custom'
                    ? 'Custom Range'
                    : 'Pick Range'}
                </span>
              </button>

              {/* Anchor Placement */}
              <div className="flex items-center rounded bg-slate-200/70 p-0.5 dark:bg-slate-800">
                <button
                  type="button"
                  onClick={() => setVpAnchor('range-left')}
                  className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors whitespace-nowrap ${
                    vpAnchor === 'range-left'
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-slate-100'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
                  }`}
                >
                  Range Left
                </button>
                <button
                  type="button"
                  onClick={() => setVpAnchor('chart-right')}
                  className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors whitespace-nowrap ${
                    vpAnchor === 'chart-right'
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-slate-100'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
                  }`}
                >
                  Chart Right
                </button>
              </div>

              {/* Row Resolution */}
              <select
                aria-label="Volume Profile row resolution"
                value={vpRows}
                onChange={(e) => setVpRows(Number(e.target.value) as 24 | 32 | 48)}
                className="rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[11px] font-medium text-slate-700 focus:border-cyan-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                <option value={24}>24 Rows</option>
                <option value={32}>32 Rows</option>
                <option value={48}>48 Rows</option>
              </select>
            </div>
          </div>

          {/* POC, VAH, VAL & Support/Resistance Summary Metrics */}
          <div className="mt-2.5 grid grid-cols-2 divide-x divide-y divide-slate-200 border-t border-slate-200 pt-2 text-xs sm:grid-cols-5 sm:divide-y-0 dark:divide-slate-800 dark:border-slate-800">
            <div className="pr-3">
              <div className="text-[11px] text-slate-500 dark:text-slate-400">POC (Point of Control)</div>
              <div className="font-mono font-semibold tabular-nums text-amber-700 dark:text-amber-400">
                {formatPrice(volumeProfile.pocPrice, detail.currency, detail.symbol)}
              </div>
            </div>
            <div className="px-3">
              <div className="text-[11px] text-slate-500 dark:text-slate-400">VAH (Resistance)</div>
              <div className="font-mono font-semibold tabular-nums text-cyan-700 dark:text-cyan-400">
                {formatPrice(volumeProfile.vahPrice, detail.currency, detail.symbol)}
              </div>
            </div>
            <div className="px-3">
              <div className="text-[11px] text-slate-500 dark:text-slate-400">VAL (Support)</div>
              <div className="font-mono font-semibold tabular-nums text-cyan-700 dark:text-cyan-400">
                {formatPrice(volumeProfile.valPrice, detail.currency, detail.symbol)}
              </div>
            </div>
            <div className="px-3">
              <div className="text-[11px] text-slate-500 dark:text-slate-400">70% Value Area</div>
              <div className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                {volumeProfile.valPrice > 0
                  ? `${(((volumeProfile.vahPrice - volumeProfile.valPrice) / volumeProfile.valPrice) * 100).toFixed(1)}% span`
                  : '—'}
              </div>
            </div>
            <div className="pl-3">
              <div className="text-[11px] text-slate-500 dark:text-slate-400">Price vs Value Area</div>
              <div
                className={`font-semibold ${
                  detail.price > volumeProfile.vahPrice
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : detail.price < volumeProfile.valPrice
                    ? 'text-rose-700 dark:text-rose-400'
                    : 'text-slate-700 dark:text-slate-300'
                }`}
              >
                {detail.price > volumeProfile.vahPrice
                  ? 'Above VAH (Breakout)'
                  : detail.price < volumeProfile.valPrice
                  ? 'Below VAL (Discount)'
                  : 'Inside Value Area'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Active Pattern Measured Levels & Structural Breakdown */}
      {activePattern && (
        <div className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-800">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                {activePattern.type}
              </h3>
              <span className="text-xs text-slate-400" aria-hidden="true">·</span>
              <span
                className={`inline-flex items-center gap-1 text-xs font-medium ${
                  activePattern.bias === 'Bullish'
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : activePattern.bias === 'Bearish'
                    ? 'text-rose-700 dark:text-rose-400'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                {activePattern.bias === 'Bullish' && <ArrowUpRight className="h-3.5 w-3.5" />}
                {activePattern.bias === 'Bearish' && <ArrowDownRight className="h-3.5 w-3.5" />}
                {activePattern.bias === 'Neutral' && <ArrowRight className="h-3.5 w-3.5" />}
                {activePattern.bias}
              </span>
              <span className="text-xs text-slate-400" aria-hidden="true">·</span>
              <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
                {activePattern.stage}
              </span>
            </div>
            <div className="font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
              Geometric Fit {activePattern.fitScore}% · {activePattern.endIndex - activePattern.startIndex} Bars
            </div>
          </div>

          <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
            {activePattern.summary}
          </p>

          {/* 4-Column Trade Geometry Strip (no nested cards—clean hairline dividers) */}
          <div className="mt-4 grid grid-cols-2 divide-x divide-y divide-slate-200 rounded-lg border border-slate-200 sm:grid-cols-4 sm:divide-y-0 dark:divide-slate-800 dark:border-slate-800">
            <div className="p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  Breakout Trigger
                </div>
                {onAddAlert && (
                  <button
                    type="button"
                    onClick={() =>
                      onAddAlert({
                        symbol: detail.symbol,
                        name: detail.name,
                        currency: detail.currency,
                        condition: activePattern.breakoutPrice >= detail.price ? 'above' : 'below',
                        targetPrice: activePattern.breakoutPrice,
                        sourceLabel: `${activePattern.type} Trigger`,
                      })
                    }
                    className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-violet-600 hover:underline dark:text-violet-400 whitespace-nowrap"
                  >
                    <BellPlus className="h-2.5 w-2.5" />
                    Alert
                  </button>
                )}
              </div>
              <div className="mt-1 font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                {formatPrice(activePattern.breakoutPrice, detail.currency, detail.symbol)}
              </div>
              <div className="mt-0.5 font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                {activePattern.distanceToBreakoutPct >= 0 ? '+' : ''}
                {activePattern.distanceToBreakoutPct.toFixed(2)}% from last
              </div>
            </div>

            <div className="p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  Measured Target
                </div>
                {onAddAlert && (
                  <button
                    type="button"
                    onClick={() =>
                      onAddAlert({
                        symbol: detail.symbol,
                        name: detail.name,
                        currency: detail.currency,
                        condition: activePattern.targetPrice >= detail.price ? 'above' : 'below',
                        targetPrice: activePattern.targetPrice,
                        sourceLabel: `${activePattern.type} Target`,
                      })
                    }
                    className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-violet-600 hover:underline dark:text-violet-400 whitespace-nowrap"
                  >
                    <BellPlus className="h-2.5 w-2.5" />
                    Alert
                  </button>
                )}
              </div>
              <div className="mt-1 font-mono text-sm font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                {formatPrice(activePattern.targetPrice, detail.currency, detail.symbol)}
              </div>
              <div className="mt-0.5 font-mono text-[11px] tabular-nums text-emerald-600 dark:text-emerald-400">
                {activePattern.bias === 'Bearish' ? '-' : '+'}
                {activePattern.targetPct.toFixed(2)}% move
              </div>
            </div>

            <div className="p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  Invalidation Stop
                </div>
                {onAddAlert && (
                  <button
                    type="button"
                    onClick={() =>
                      onAddAlert({
                        symbol: detail.symbol,
                        name: detail.name,
                        currency: detail.currency,
                        condition: activePattern.stopPrice <= detail.price ? 'below' : 'above',
                        targetPrice: activePattern.stopPrice,
                        sourceLabel: `${activePattern.type} Stop`,
                      })
                    }
                    className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-violet-600 hover:underline dark:text-violet-400 whitespace-nowrap"
                  >
                    <BellPlus className="h-2.5 w-2.5" />
                    Alert
                  </button>
                )}
              </div>
              <div className="mt-1 font-mono text-sm font-semibold tabular-nums text-rose-700 dark:text-rose-400">
                {formatPrice(activePattern.stopPrice, detail.currency, detail.symbol)}
              </div>
              <div className="mt-0.5 font-mono text-[11px] tabular-nums text-rose-600 dark:text-rose-400">
                -{activePattern.riskPct.toFixed(2)}% risk
              </div>
            </div>

            <div className="p-3">
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Risk / Reward
              </div>
              <div className="mt-1 font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                1 : {activePattern.riskReward.toFixed(2)}
              </div>
              <div className="mt-0.5 font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                RVOL {detail.rvol.toFixed(2)}x · ATR {detail.atrPct.toFixed(2)}%
              </div>
            </div>
          </div>

          {/* Structural Validation Checklist */}
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-600 dark:text-slate-400">
            {activePattern.criteria.map((c) => (
              <div key={c} className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span>{c}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Multi-Timeframe Confluence Strip (1H / 4H / 1D / 1W) */}
      <div className="mt-4 rounded-lg border border-slate-200 dark:border-slate-800">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <Layers className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
            <h4 className="font-display text-xs font-semibold text-slate-900 dark:text-slate-100">
              Multi-Timeframe Confluence Strip (1H · 4H · 1D · 1W)
            </h4>
            <span className="text-[11px] text-slate-400 dark:text-slate-500">· Click any timeframe to inspect chart</span>
          </div>
          {mtfData ? (
            <div className="flex items-center gap-2 text-xs">
              <span
                className={`font-semibold ${
                  mtfData.alignmentLabel.includes('Bullish')
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : mtfData.alignmentLabel.includes('Bearish')
                    ? 'text-rose-700 dark:text-rose-400'
                    : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                {mtfData.alignmentLabel}
              </span>
              <span className="font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                ({mtfData.bullishCount} Bull / {mtfData.bearishCount} Bear / {mtfData.neutralCount} Neutral)
              </span>
            </div>
          ) : isLoadingMtf ? (
            <span className="font-mono text-[11px] text-slate-400">Analyzing 4 timeframes…</span>
          ) : null}
        </div>

        {isLoadingMtf && !mtfData ? (
          <div className="grid grid-cols-2 divide-x divide-y divide-slate-200 sm:grid-cols-4 sm:divide-y-0 dark:divide-slate-800">
            {['1H', '4H', '1D', '1W'].map((tf) => (
              <div key={tf} className="space-y-2 p-3.5">
                <div className="h-3.5 w-16 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
                <div className="h-4 w-28 animate-pulse rounded bg-slate-100 dark:bg-slate-800/70" />
                <div className="h-3 w-20 animate-pulse rounded bg-slate-100 dark:bg-slate-800/50" />
              </div>
            ))}
          </div>
        ) : mtfData && mtfData.cells.length > 0 ? (
          <div className="grid grid-cols-2 divide-x divide-y divide-slate-200 sm:grid-cols-4 sm:divide-y-0 dark:divide-slate-800">
            {mtfData.cells.map((cell) => {
              const isSelectedTf = timeframe === cell.timeframe;
              const tfLabel =
                cell.timeframe === '1wk' ? '1W' : cell.timeframe.toUpperCase();
              return (
                <button
                  key={cell.timeframe}
                  type="button"
                  onClick={() => onTimeframeChange(cell.timeframe)}
                  className={`flex flex-col items-start p-3.5 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40 ${
                    isSelectedTf ? 'bg-blue-50/45 dark:bg-blue-950/25' : ''
                  }`}
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <span className="font-mono text-xs font-bold text-slate-900 dark:text-slate-100">
                      {tfLabel}
                      {isSelectedTf ? ' (Active)' : ''}
                    </span>
                    <span
                      className={`text-[11px] font-semibold ${
                        cell.trendBias === 'Bullish'
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : cell.trendBias === 'Bearish'
                          ? 'text-rose-700 dark:text-rose-400'
                          : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      {cell.trendBias}
                    </span>
                  </div>

                  <div className="mt-1.5 text-xs font-medium text-slate-800 dark:text-slate-200">
                    {cell.primaryPattern
                      ? `${cell.primaryPattern.type} (${cell.primaryPattern.fitScore}%)`
                      : 'No pattern match'}
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                    {cell.primaryPattern
                      ? `${cell.primaryPattern.stage} · ${cell.primaryPattern.bias}`
                      : 'Monitoring structure'}
                  </div>

                  <div className="mt-2 flex w-full items-center justify-between gap-2 border-t border-slate-100 pt-1.5 font-mono text-[10.5px] tabular-nums text-slate-500 dark:border-slate-800/80 dark:text-slate-400">
                    <span>
                      RSI {cell.rsi14 != null ? cell.rsi14.toFixed(1) : '—'}
                    </span>
                    <span>
                      Slope{' '}
                      {cell.sma20SlopePct != null
                        ? `${cell.sma20SlopePct >= 0 ? '+' : ''}${cell.sma20SlopePct.toFixed(2)}%`
                        : '—'}
                    </span>
                    <span>{cell.rvol.toFixed(1)}x</span>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
            Multi-timeframe confluence data is unavailable for {detail.symbol}.
          </p>
        )}
      </div>

      {/* Combined Full-Width Below-Chart Analytics: Historical Pattern Backtest Overlay + Volume Analysis & Short Interest */}
      <div className="mt-5 grid grid-cols-1 divide-y divide-slate-200 rounded-lg border border-slate-200 xl:grid-cols-12 xl:divide-x xl:divide-y-0 dark:divide-slate-800 dark:border-slate-800">
        {/* Left Panel (7 cols): Historical Pattern Backtest Overlay */}
        <div className="p-4 xl:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <History className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
              <h4 className="font-display text-xs font-semibold text-slate-900 dark:text-slate-100">
                Historical Pattern Backtest Overlay
              </h4>
              {availableBacktestTypes.length > 0 && (
                <select
                  value={selectedBacktestType}
                  onChange={(e) => setSelectedBacktestType(e.target.value as PatternType)}
                  aria-label="Select pattern type to backtest"
                  className="rounded border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-800 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  {availableBacktestTypes.map((pt) => {
                    const countForType = (detail.historicalPatterns || []).filter((h) => h.type === pt).length;
                    return (
                      <option key={pt} value={pt}>
                        {pt} ({countForType})
                      </option>
                    );
                  })}
                </select>
              )}
            </div>

            {matchingHistorical.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center rounded bg-slate-100 p-0.5 dark:bg-slate-800">
                  <button
                    type="button"
                    onClick={() => {
                      setHistoricalDisplayMode('analog');
                      setShowHistoricalOverlay(true);
                    }}
                    className={`rounded px-2 py-1 text-[11px] font-medium transition-colors whitespace-nowrap ${
                      historicalDisplayMode === 'analog'
                        ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-slate-100'
                        : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
                    }`}
                  >
                    Analog Projection
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setHistoricalDisplayMode('timeline');
                      setShowHistoricalOverlay(true);
                      setVisibleBars('all');
                    }}
                    className={`rounded px-2 py-1 text-[11px] font-medium transition-colors whitespace-nowrap ${
                      historicalDisplayMode === 'timeline'
                        ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-slate-100'
                        : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
                    }`}
                  >
                    Timeline Markers
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    const nextOn = !showHistoricalOverlay;
                    setShowHistoricalOverlay(nextOn);
                    if (nextOn && visibleBars !== 'all' && detail?.bars) {
                      const cutoff = Math.max(0, detail.bars.length - visibleBars);
                      const anyInView = overlaidHistorical.some((h) => h.endIndex >= cutoff);
                      if (!anyInView) {
                        setVisibleBars('all');
                      }
                    }
                  }}
                  className={`rounded border px-2.5 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap ${
                    showHistoricalOverlay
                      ? 'border-amber-600/50 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-950/50 dark:text-amber-300'
                      : 'border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  {showHistoricalOverlay ? 'Hide Overlay' : 'Overlay on Chart'}
                </button>
              </div>
            )}
          </div>

          {matchingHistorical.length === 0 || !backtestStats ? (
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
              No completed historical {selectedBacktestType || 'chart pattern'} instances found within {detail.symbol}&rsquo;s trailing {detail.barsCount}-bar {detail.timeframe} window. Try switching timeframes (e.g. 1D or 4H) to inspect earlier setups.
            </p>
          ) : (
            <>
              {/* 4-Column Backtest Stats Strip (hairline dividers, single elevation) */}
              <div className="mt-3 grid grid-cols-2 divide-x divide-y divide-slate-200 border-y border-slate-200 sm:grid-cols-4 sm:divide-y-0 dark:divide-slate-800 dark:border-slate-800">
                <div className="px-2.5 py-2">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">Historical Matches</div>
                  <div className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                    {backtestStats.total} setups
                  </div>
                  <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                    {backtestStats.breakoutsCount} breakouts
                  </div>
                </div>

                <div className="px-2.5 py-2">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">Target Hit Rate</div>
                  <div
                    className={`mt-0.5 font-mono text-sm font-semibold tabular-nums ${
                      (backtestStats.hitRate ?? 0) >= 50
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-slate-900 dark:text-slate-100'
                    }`}
                  >
                    {backtestStats.hitRate != null ? `${backtestStats.hitRate}%` : '—'}
                  </div>
                  <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                    {backtestStats.wins} / {backtestStats.resolvedCount} resolved
                  </div>
                </div>

                <div className="px-2.5 py-2">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">Avg +10B / +20B</div>
                  <div className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                    {backtestStats.avg10 != null
                      ? `${backtestStats.avg10 >= 0 ? '+' : ''}${backtestStats.avg10.toFixed(1)}%`
                      : '—'}{' '}
                    /{' '}
                    {backtestStats.avg20 != null
                      ? `${backtestStats.avg20 >= 0 ? '+' : ''}${backtestStats.avg20.toFixed(1)}%`
                      : '—'}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    Forward return
                  </div>
                </div>

                <div className="px-2.5 py-2">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">Avg MFE / MAE</div>
                  <div className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                    <span className="text-emerald-700 dark:text-emerald-400">
                      +{backtestStats.avgMfe.toFixed(1)}%
                    </span>{' '}
                    /{' '}
                    <span className="text-rose-700 dark:text-rose-400">
                      {backtestStats.avgMae.toFixed(1)}%
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    25-bar excursion
                  </div>
                </div>
              </div>

              {/* Interactive Instance List */}
              <div className="mt-2.5 max-h-[260px] overflow-x-auto overflow-y-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="sticky top-0 bg-white dark:bg-slate-900">
                    <tr className="border-b border-slate-200 text-[11px] font-semibold text-slate-500 dark:border-slate-800 dark:text-slate-400">
                      <th className="py-1.5 pr-2">
                        <button
                          type="button"
                          onClick={() => {
                            if (enabledHistoricalIds.length === matchingHistorical.length) {
                              setEnabledHistoricalIds([]);
                            } else {
                              setEnabledHistoricalIds(matchingHistorical.map((h) => h.id));
                              setShowHistoricalOverlay(true);
                            }
                          }}
                          className="text-blue-600 hover:underline dark:text-blue-400"
                        >
                          {enabledHistoricalIds.length === matchingHistorical.length ? 'None' : 'All'}
                        </button>
                      </th>
                      <th className="py-1.5 px-2">Historical Window</th>
                      <th className="py-1.5 px-2">Stage · Fit</th>
                      <th className="py-1.5 px-2">Outcome</th>
                      <th className="py-1.5 px-2 text-right">+10B</th>
                      <th className="py-1.5 px-2 text-right">+20B</th>
                      <th className="py-1.5 pl-2 text-right">Inspect</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                    {matchingHistorical.map((inst) => {
                      const activeIdx = overlaidHistorical.findIndex((o) => o.id === inst.id);
                      const isChecked = activeIdx !== -1;
                      const swatchColor = isChecked
                        ? HISTORICAL_ANALOG_COLORS[activeIdx % HISTORICAL_ANALOG_COLORS.length]
                        : undefined;

                      return (
                        <tr key={inst.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <td className="py-1.5 pr-2">
                            <label className="inline-flex cursor-pointer items-center gap-2">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => toggleHistoricalInstance(inst.id)}
                                aria-label={`Overlay ${inst.type} ending ${inst.endDateLabel}`}
                                className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                              />
                              <span
                                className="inline-block h-2.5 w-2.5 rounded-xs border border-slate-300 dark:border-slate-600"
                                style={swatchColor ? { backgroundColor: swatchColor, borderColor: swatchColor } : undefined}
                              />
                            </label>
                          </td>
                          <td className="py-1.5 px-2 font-mono text-[11px] tabular-nums text-slate-700 dark:text-slate-300 whitespace-nowrap">
                            {inst.startDateLabel.split(',')[0]} &ndash; {inst.endDateLabel}
                          </td>
                          <td className="py-1.5 px-2 font-mono text-[11px] text-slate-600 dark:text-slate-400 whitespace-nowrap">
                            {inst.stage} · {inst.fitScore}%
                          </td>
                          <td className="py-1.5 px-2 whitespace-nowrap">
                            <span
                              className={`text-[11px] font-semibold ${
                                inst.outcome === 'Target Hit'
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : inst.outcome === 'Stopped Out'
                                  ? 'text-rose-700 dark:text-rose-400'
                                  : 'text-slate-500 dark:text-slate-400'
                              }`}
                            >
                              {inst.outcome}
                              {inst.barsToOutcome != null ? ` (${inst.barsToOutcome}B)` : ''}
                            </span>
                          </td>
                          <td
                            className={`py-1.5 px-2 text-right font-mono text-[11px] tabular-nums ${
                              (inst.forwardReturn10Pct ?? 0) >= 0
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : 'text-rose-700 dark:text-rose-400'
                            }`}
                          >
                            {inst.forwardReturn10Pct != null
                              ? `${inst.forwardReturn10Pct >= 0 ? '+' : ''}${inst.forwardReturn10Pct.toFixed(1)}%`
                              : '—'}
                          </td>
                          <td
                            className={`py-1.5 px-2 text-right font-mono text-[11px] tabular-nums ${
                              (inst.forwardReturn20Pct ?? 0) >= 0
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : 'text-rose-700 dark:text-rose-400'
                            }`}
                          >
                            {inst.forwardReturn20Pct != null
                              ? `${inst.forwardReturn20Pct >= 0 ? '+' : ''}${inst.forwardReturn20Pct.toFixed(1)}%`
                              : '—'}
                          </td>
                          <td className="py-1.5 pl-2 text-right whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => {
                                if (!isChecked) toggleHistoricalInstance(inst.id);
                                setHistoricalDisplayMode('timeline');
                                setShowHistoricalOverlay(true);
                                setVisibleBars('all');
                              }}
                              className="text-[11px] font-semibold text-blue-600 hover:underline dark:text-blue-400"
                            >
                              Timeline
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        {/* Right Panel (5 cols): Volume Analysis & Relative Volume + Short Interest */}
        <div className="divide-y divide-slate-200 xl:col-span-5 dark:divide-slate-800">
          {/* Volume Analysis & Relative Volume */}
          <div className="p-4">
            <div className="flex items-center justify-between gap-2">
              <h4 className="font-display text-xs font-semibold text-slate-900 dark:text-slate-100">
                Volume Analysis &amp; Relative Volume
              </h4>
              {detail.volumeAnalysis && (
                <span
                  className={`text-xs font-semibold ${
                    detail.volumeAnalysis.rating.includes('Accumulation')
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : detail.volumeAnalysis.rating.includes('Distribution')
                      ? 'text-rose-700 dark:text-rose-400'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {detail.volumeAnalysis.rating}
                </span>
              )}
            </div>

            {detail.volumeAnalysis ? (
              <>
                {(() => {
                  const total = detail.volumeAnalysis.upVolume20 + detail.volumeAnalysis.downVolume20;
                  const upPct = total > 0 ? Math.round((detail.volumeAnalysis.upVolume20 / total) * 100) : 50;
                  const downPct = 100 - upPct;
                  return (
                    <div className="mt-2.5">
                      <div className="mb-1 flex items-center justify-between font-mono text-[11px] tabular-nums">
                        <span className="text-emerald-700 dark:text-emerald-400">
                          Up Vol {upPct}%
                        </span>
                        <span className="text-slate-500 dark:text-slate-400">
                          20D Ratio {detail.volumeAnalysis.upDownVolumeRatio.toFixed(2)}x
                        </span>
                        <span className="text-rose-700 dark:text-rose-400">
                          Down Vol {downPct}%
                        </span>
                      </div>
                      <div className="flex h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                        <div
                          className="bg-emerald-600 dark:bg-emerald-500"
                          style={{ width: `${upPct}%` }}
                        />
                        <div
                          className="bg-rose-600 dark:bg-rose-500"
                          style={{ width: `${downPct}%` }}
                        />
                      </div>
                    </div>
                  );
                })()}

                <div className="mt-3 grid grid-cols-3 gap-x-3 gap-y-2 text-xs">
                  <div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">RVOL (vs 20D)</div>
                    <div className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                      {detail.volumeAnalysis.rvol.toFixed(2)}x
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">5D / 20D Vol</div>
                    <div className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                      {detail.volumeAnalysis.rvol5d.toFixed(2)}x
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">OBV 20D Flow</div>
                    <div
                      className={`font-semibold ${
                        detail.volumeAnalysis.obvTrend === 'Accumulation'
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : detail.volumeAnalysis.obvTrend === 'Distribution'
                          ? 'text-rose-700 dark:text-rose-400'
                          : 'text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {detail.volumeAnalysis.obvTrend}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">20D VWAP</div>
                    <div className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                      {detail.volumeAnalysis.vwap20 != null
                        ? formatPrice(detail.volumeAnalysis.vwap20, detail.currency, detail.symbol)
                        : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">Dollar Volume</div>
                    <div className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                      {detail.volumeAnalysis.dollarVolume >= 1_000_000_000
                        ? `$${(detail.volumeAnalysis.dollarVolume / 1_000_000_000).toFixed(2)}B`
                        : `$${(detail.volumeAnalysis.dollarVolume / 1_000_000).toFixed(1)}M`}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">Spikes (&ge;1.5x)</div>
                    <div className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                      {detail.volumeAnalysis.spikeDays20} / 20 bars
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <p className="mt-2.5 text-xs text-slate-500 dark:text-slate-400">
                Volume profile metrics are unavailable for {detail.symbol} on this timeframe.
              </p>
            )}
          </div>

          {/* Short Interest */}
          <div className="p-4">
            <div className="flex items-center justify-between gap-2">
              <h4 className="font-display text-xs font-semibold text-slate-900 dark:text-slate-100">
                Short Interest
              </h4>
              {detail.shortInterest?.settlementDate && (
                <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                  Settled {detail.shortInterest.settlementDate}
                </span>
              )}
            </div>

            {detail.shortInterest ? (
              <>
                <div className="mt-2.5 grid grid-cols-3 gap-x-3 gap-y-2 text-xs">
                  <div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">Short % Float</div>
                    <div
                      className={`font-mono text-sm font-semibold tabular-nums ${
                        (detail.shortInterest.shortPercentOfFloat ?? 0) >= 10
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-slate-900 dark:text-slate-100'
                      }`}
                    >
                      {detail.shortInterest.shortPercentOfFloat != null
                        ? `${detail.shortInterest.shortPercentOfFloat.toFixed(2)}%`
                        : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">Days to Cover</div>
                    <div className="font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                      {detail.shortInterest.shortRatio != null
                        ? `${detail.shortInterest.shortRatio.toFixed(2)}d`
                        : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">MoM Change</div>
                    <div
                      className={`font-mono text-sm font-semibold tabular-nums ${
                        (detail.shortInterest.shortChangeMoMPct ?? 0) > 0
                          ? 'text-rose-600 dark:text-rose-400'
                          : 'text-emerald-600 dark:text-emerald-400'
                      }`}
                    >
                      {detail.shortInterest.shortChangeMoMPct != null
                        ? `${detail.shortInterest.shortChangeMoMPct > 0 ? '+' : ''}${detail.shortInterest.shortChangeMoMPct.toFixed(2)}%`
                        : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">Shares Short</div>
                    <div className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                      {detail.shortInterest.sharesShort != null
                        ? `${(detail.shortInterest.sharesShort / 1_000_000).toFixed(2)}M`
                        : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">Prior Month</div>
                    <div className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                      {detail.shortInterest.sharesShortPriorMonth != null
                        ? `${(detail.shortInterest.sharesShortPriorMonth / 1_000_000).toFixed(2)}M`
                        : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">Float Shares</div>
                    <div className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                      {detail.shortInterest.floatShares != null
                        ? detail.shortInterest.floatShares >= 1_000_000_000
                          ? `${(detail.shortInterest.floatShares / 1_000_000_000).toFixed(2)}B`
                          : `${(detail.shortInterest.floatShares / 1_000_000).toFixed(1)}M`
                        : '—'}
                    </div>
                  </div>
                </div>
                <p className="mt-2.5 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                  {(detail.shortInterest.shortPercentOfFloat ?? 0) >= 10 ||
                  (detail.shortInterest.shortRatio ?? 0) >= 4
                    ? `Elevated short positioning (${detail.shortInterest.shortPercentOfFloat?.toFixed(2) ?? '—'}% of float, ${detail.shortInterest.shortRatio?.toFixed(1) ?? '—'}d to cover) increases squeeze sensitivity on upside breakouts.`
                    : `Moderate institutional short positioning relative to ${detail.symbol} average daily liquidity.`}
                </p>
              </>
            ) : (
              <p className="mt-2.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                Short float statistics are not published for {detail.symbol} (index/sector ETFs and certain exchanges do not report corporate float short interest).
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Volatility Analysis Panel: Implied Volatility (IV) Percentile & Average True Range (ATR) */}
      {detail.volatilityAnalysis && (
        <div className="mt-4 rounded-lg border border-slate-200 dark:border-slate-800">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <Activity className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
              <h4 className="font-display text-xs font-semibold text-slate-900 dark:text-slate-100">
                Volatility Analysis &mdash; IV Percentile &amp; ATR Regime
              </h4>
              <span className="text-[11px] text-slate-400 dark:text-slate-500" aria-hidden="true">
                ·
              </span>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                {detail.volatilityAnalysis.ivSource}
                {detail.volatilityAnalysis.optionsExpiryLabel
                  ? ` · Exp ${detail.volatilityAnalysis.optionsExpiryLabel}`
                  : ''}
              </span>
            </div>
            <span
              className={`text-xs font-semibold ${
                detail.volatilityAnalysis.regime === 'High Volatility Expansion'
                  ? 'text-rose-700 dark:text-rose-400'
                  : detail.volatilityAnalysis.regime === 'Elevated Volatility'
                  ? 'text-amber-700 dark:text-amber-400'
                  : detail.volatilityAnalysis.regime === 'Low Volatility / Squeeze'
                  ? 'text-cyan-700 dark:text-cyan-400'
                  : 'text-slate-700 dark:text-slate-300'
              }`}
            >
              {detail.volatilityAnalysis.regime}
            </span>
          </div>

          <div className="grid grid-cols-1 divide-y divide-slate-200 lg:grid-cols-2 lg:divide-x lg:divide-y-0 dark:divide-slate-800">
            {/* Left Column: Implied Volatility (IV) Percentile & Realized Vol Context */}
            <div className="p-4">
              {(() => {
                const vol = detail.volatilityAnalysis!;
                const isOptionsBacked = vol.ivSource === 'Options Chain' && vol.impliedVolatilityPct != null;
                const pctVal = vol.ivPercentile ?? vol.hvPercentile ?? 50;
                const fillColor =
                  pctVal >= 75
                    ? 'bg-rose-600 dark:bg-rose-500'
                    : pctVal >= 45
                    ? 'bg-amber-500 dark:bg-amber-400'
                    : 'bg-cyan-600 dark:bg-cyan-500';
                return (
                  <>
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-medium text-slate-700 dark:text-slate-300">
                        {isOptionsBacked ? 'IV Percentile (vs 52W HV)' : 'Realized HV20 Percentile (52W)'}
                      </span>
                      <span className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                        {vol.ivPercentile != null ? `${vol.ivPercentile}th pct` : '—'}
                      </span>
                    </div>
                    <div className="mt-1.5 h-2 w-full overflow-hidden rounded-sm bg-slate-100 dark:bg-slate-800">
                      <div
                        className={`h-full transition-all ${fillColor}`}
                        style={{ width: `${Math.max(4, Math.min(100, pctVal))}%` }}
                      />
                    </div>
                    <div className="mt-1 flex justify-between font-mono text-[10px] tabular-nums text-slate-400 dark:text-slate-500">
                      <span>0% Squeeze</span>
                      <span>
                        52W HV Range:{' '}
                        {vol.hv52wLowPct != null && vol.hv52wHighPct != null
                          ? `${vol.hv52wLowPct.toFixed(1)}% – ${vol.hv52wHighPct.toFixed(1)}%`
                          : '—'}
                      </span>
                      <span>100% Spike</span>
                    </div>

                    <div className="mt-3 grid grid-cols-3 gap-x-3 gap-y-2.5 text-xs">
                      <div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          {isOptionsBacked ? 'ATM Implied Vol' : '20D Realized Vol'}
                        </div>
                        <div className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                          {isOptionsBacked
                            ? `${vol.impliedVolatilityPct!.toFixed(1)}%`
                            : vol.hv20Pct != null
                            ? `${vol.hv20Pct.toFixed(1)}%`
                            : '—'}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">IV Rank (52W)</div>
                        <div className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                          {vol.ivRank != null ? `${vol.ivRank}%` : '—'}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">1W Exp Move (±1σ)</div>
                        <div className="font-mono font-semibold tabular-nums text-blue-700 dark:text-blue-400">
                          {vol.expectedMoveWeeklyPct != null
                            ? `±${vol.expectedMoveWeeklyPct.toFixed(2)}%`
                            : '—'}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">HV20 / HV60</div>
                        <div className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                          {vol.hv20Pct != null ? `${vol.hv20Pct.toFixed(1)}%` : '—'} /{' '}
                          {vol.hv60Pct != null ? `${vol.hv60Pct.toFixed(1)}%` : '—'}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">IV − HV20 Spread</div>
                        <div
                          className={`font-mono font-semibold tabular-nums ${
                            vol.ivHvSpreadPct == null
                              ? 'text-slate-500 dark:text-slate-400'
                              : vol.ivHvSpreadPct >= 0
                              ? 'text-amber-700 dark:text-amber-400'
                              : 'text-emerald-700 dark:text-emerald-400'
                          }`}
                        >
                          {vol.ivHvSpreadPct != null
                            ? `${vol.ivHvSpreadPct >= 0 ? '+' : ''}${vol.ivHvSpreadPct.toFixed(1)} pts`
                            : 'N/A (No Opts)'}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">Put / Call Skew</div>
                        <div className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                          {vol.ivSkewPct != null
                            ? `${vol.ivSkewPct >= 0 ? '+' : ''}${vol.ivSkewPct.toFixed(1)}%`
                            : 'N/A'}
                        </div>
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>

            {/* Right Column: Average True Range (ATR) & Range Expansion */}
            <div className="p-4">
              {(() => {
                const vol = detail.volatilityAnalysis!;
                const atrFill =
                  vol.atrPercentile >= 75
                    ? 'bg-rose-600 dark:bg-rose-500'
                    : vol.atrPercentile >= 45
                    ? 'bg-blue-600 dark:bg-blue-500'
                    : 'bg-emerald-600 dark:bg-emerald-500';
                return (
                  <>
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-medium text-slate-700 dark:text-slate-300">
                        ATR (14) Range Expansion Percentile (52W)
                      </span>
                      <span
                        className={`font-mono font-semibold tabular-nums ${
                          vol.atrTrend === 'Expanding'
                            ? 'text-amber-700 dark:text-amber-400'
                            : vol.atrTrend === 'Compressing'
                            ? 'text-cyan-700 dark:text-cyan-400'
                            : 'text-slate-900 dark:text-slate-100'
                        }`}
                      >
                        {vol.atrPercentile}th pct · {vol.atrTrend}
                      </span>
                    </div>
                    <div className="mt-1.5 h-2 w-full overflow-hidden rounded-sm bg-slate-100 dark:bg-slate-800">
                      <div
                        className={`h-full transition-all ${atrFill}`}
                        style={{ width: `${Math.max(4, Math.min(100, vol.atrPercentile))}%` }}
                      />
                    </div>
                    <div className="mt-1 flex justify-between font-mono text-[10px] tabular-nums text-slate-400 dark:text-slate-500">
                      <span>0% Tight Coil</span>
                      <span>ATR 5 / 14 Ratio: {vol.atrRatio.toFixed(2)}x</span>
                      <span>100% Wide Range</span>
                    </div>

                    <div className="mt-3 grid grid-cols-3 gap-x-3 gap-y-2.5 text-xs">
                      <div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">ATR (14)</div>
                        <div className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                          {formatPrice(vol.atr14, detail.currency, detail.symbol)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">ATR (14) %</div>
                        <div className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                          {vol.atr14Pct.toFixed(2)}%
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">ATR (5) Fast</div>
                        <div className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                          {formatPrice(vol.atr5, detail.currency, detail.symbol)}{' '}
                          <span className="text-[10px] text-slate-500 dark:text-slate-400">
                            ({vol.atr5Pct.toFixed(2)}%)
                          </span>
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">ATR 5 / 14 Impulse</div>
                        <div
                          className={`font-mono font-semibold tabular-nums ${
                            vol.atrRatio >= 1.15
                              ? 'text-amber-700 dark:text-amber-400'
                              : vol.atrRatio <= 0.85
                              ? 'text-cyan-700 dark:text-cyan-400'
                              : 'text-slate-900 dark:text-slate-100'
                          }`}
                        >
                          {vol.atrRatio.toFixed(2)}x
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">1.5× ATR Stop Buffer</div>
                        <div className="font-mono font-semibold tabular-nums text-rose-700 dark:text-rose-400">
                          {formatPrice(
                            Math.max(0, detail.price - vol.atr14 * 1.5),
                            detail.currency,
                            detail.symbol
                          )}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">2.0× ATR Target</div>
                        <div className="font-mono font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                          {formatPrice(detail.price + vol.atr14 * 2, detail.currency, detail.symbol)}
                        </div>
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Seasonality Meter (10Y Monthly Heatmap & Bias Gauge) */}
      {detail.seasonalityAnalysis && (
        <div className="mt-4 rounded-lg border border-slate-200 dark:border-slate-800">
          {(() => {
            const seas = detail.seasonalityAnalysis!;
            const curM = seas.months[seas.currentMonthIdx];
            const nextM = seas.months[seas.nextMonthIdx];
            const maxAbsRet = Math.max(
              2,
              ...seas.months.map((m) => Math.abs(m.avgReturnPct))
            );
            const gaugeFill =
              seas.biasScore >= 60
                ? 'bg-emerald-600 dark:bg-emerald-500'
                : seas.biasScore >= 44
                ? 'bg-blue-600 dark:bg-blue-500'
                : 'bg-rose-600 dark:bg-rose-500';

            return (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                    <h4 className="font-display text-xs font-semibold text-slate-900 dark:text-slate-100">
                      Seasonality Meter &mdash; {seas.yearsAnalyzed}Y Monthly Return Heatmap
                    </h4>
                    <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                      · Best {seas.bestMonthLabel} · Weakest {seas.worstMonthLabel}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span
                      className={`font-semibold ${
                        seas.biasScore >= 56
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : seas.biasScore < 44
                          ? 'text-rose-700 dark:text-rose-400'
                          : 'text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {seas.biasLabel}
                    </span>
                    <span className="font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100">
                      {seas.biasScore}/100
                    </span>
                  </div>
                </div>

                {/* Top Summary Strip: Seasonal Bias Gauge + Current & Next Month Stats */}
                <div className="grid grid-cols-1 divide-y divide-slate-200 border-b border-slate-200 lg:grid-cols-12 lg:divide-x lg:divide-y-0 dark:divide-slate-800 dark:border-slate-800">
                  <div className="p-4 lg:col-span-5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-700 dark:text-slate-300">
                        Current + Next Month Seasonal Tailwind Gauge
                      </span>
                      <span className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                        {seas.biasScore}%
                      </span>
                    </div>
                    <div className="mt-1.5 h-2 w-full overflow-hidden rounded-sm bg-slate-100 dark:bg-slate-800">
                      <div
                        className={`h-full transition-all ${gaugeFill}`}
                        style={{ width: `${Math.max(4, Math.min(100, seas.biasScore))}%` }}
                      />
                    </div>
                    <div className="mt-1 flex justify-between font-mono text-[10px] tabular-nums text-slate-400 dark:text-slate-500">
                      <span>0 Headwind</span>
                      <span>50 Neutral</span>
                      <span>100 Tailwind</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 divide-x divide-slate-200 lg:col-span-7 dark:divide-slate-800">
                    <div className="p-4">
                      <div className="text-[11px] font-medium text-blue-600 dark:text-blue-400">
                        Current Month ({curM.monthLabel})
                      </div>
                      <div className="mt-1 flex items-baseline gap-2 font-mono tabular-nums">
                        <span
                          className={`text-sm font-bold ${
                            curM.avgReturnPct >= 0
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-rose-700 dark:text-rose-400'
                          }`}
                        >
                          {curM.avgReturnPct >= 0 ? '+' : ''}
                          {curM.avgReturnPct.toFixed(1)}% avg
                        </span>
                        <span className="text-xs text-slate-600 dark:text-slate-300">
                          {curM.winRatePct}% win ({curM.samples}y)
                        </span>
                      </div>
                      <div className="mt-0.5 font-mono text-[10.5px] tabular-nums text-slate-500 dark:text-slate-400">
                        Med {curM.medianReturnPct >= 0 ? '+' : ''}
                        {curM.medianReturnPct.toFixed(1)}% · Range {curM.worstReturnPct.toFixed(0)}%..+
                        {curM.bestReturnPct.toFixed(0)}%
                      </div>
                    </div>

                    <div className="p-4">
                      <div className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
                        Next Month ({nextM.monthLabel})
                      </div>
                      <div className="mt-1 flex items-baseline gap-2 font-mono tabular-nums">
                        <span
                          className={`text-sm font-bold ${
                            nextM.avgReturnPct >= 0
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-rose-700 dark:text-rose-400'
                          }`}
                        >
                          {nextM.avgReturnPct >= 0 ? '+' : ''}
                          {nextM.avgReturnPct.toFixed(1)}% avg
                        </span>
                        <span className="text-xs text-slate-600 dark:text-slate-300">
                          {nextM.winRatePct}% win ({nextM.samples}y)
                        </span>
                      </div>
                      <div className="mt-0.5 font-mono text-[10.5px] tabular-nums text-slate-500 dark:text-slate-400">
                        Med {nextM.medianReturnPct >= 0 ? '+' : ''}
                        {nextM.medianReturnPct.toFixed(1)}% · Range {nextM.worstReturnPct.toFixed(0)}%..+
                        {nextM.bestReturnPct.toFixed(0)}%
                      </div>
                    </div>
                  </div>
                </div>

                {/* 12-Month Grid */}
                <div className="grid grid-cols-3 divide-x divide-y divide-slate-100 sm:grid-cols-6 lg:grid-cols-12 lg:divide-y-0 dark:divide-slate-800/80">
                  {seas.months.map((m) => {
                    const isCur = m.monthIdx === seas.currentMonthIdx;
                    const isNext = m.monthIdx === seas.nextMonthIdx;
                    const pos = m.avgReturnPct >= 0;
                    const barPct = Math.max(8, Math.round((Math.abs(m.avgReturnPct) / maxAbsRet) * 100));
                    return (
                      <div
                        key={m.monthLabel}
                        className={`p-2.5 text-center ${
                          isCur
                            ? 'bg-blue-50/60 dark:bg-blue-950/30'
                            : isNext
                            ? 'bg-amber-50/50 dark:bg-amber-950/20'
                            : ''
                        }`}
                      >
                        <div className="flex items-center justify-center gap-1 font-mono text-[11px] font-bold text-slate-800 dark:text-slate-200">
                          <span>{m.monthLabel}</span>
                          {isCur && (
                            <span className="text-[9px] font-semibold text-blue-600 dark:text-blue-400">
                              NOW
                            </span>
                          )}
                          {isNext && (
                            <span className="text-[9px] font-semibold text-amber-600 dark:text-amber-400">
                              NEXT
                            </span>
                          )}
                        </div>
                        <div
                          className={`mt-1 font-mono text-xs font-semibold tabular-nums ${
                            pos
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-rose-700 dark:text-rose-400'
                          }`}
                        >
                          {pos ? '+' : ''}
                          {m.avgReturnPct.toFixed(1)}%
                        </div>
                        <div className="mx-auto mt-1.5 h-1.5 w-full overflow-hidden rounded-sm bg-slate-100 dark:bg-slate-800">
                          <div
                            className={`h-full ${
                              pos
                                ? 'bg-emerald-600 dark:bg-emerald-500'
                                : 'bg-rose-600 dark:bg-rose-500'
                            }`}
                            style={{ width: `${barPct}%` }}
                          />
                        </div>
                        <div className="mt-1 font-mono text-[10px] tabular-nums text-slate-500 dark:text-slate-400">
                          {m.winRatePct}% win
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* Pattern & Level Price Alerts */}
      {onAddAlert && (
        <div className="mt-4 rounded-lg border border-slate-200 dark:border-slate-800">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <Bell className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
              <h4 className="font-display text-xs font-semibold text-slate-900 dark:text-slate-100">
                Pattern &amp; Level Price Alerts
              </h4>
              <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                · {alerts.filter((a) => a.active).length} active across workspace ({alerts.filter((a) => !a.active && a.triggeredAt).length} triggered)
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {volumeProfile && (
                <button
                  type="button"
                  onClick={() =>
                    onAddAlert({
                      symbol: detail.symbol,
                      name: detail.name,
                      currency: detail.currency,
                      condition: volumeProfile.pocPrice >= detail.price ? 'above' : 'below',
                      targetPrice: volumeProfile.pocPrice,
                      sourceLabel: 'FRVP POC',
                    })
                  }
                  className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:border-violet-400 hover:text-violet-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                >
                  <BellPlus className="h-3 w-3 text-violet-600 dark:text-violet-400" />
                  <span>POC {formatPrice(volumeProfile.pocPrice, detail.currency, detail.symbol)}</span>
                </button>
              )}
              {detail.sma50 != null && (
                <button
                  type="button"
                  onClick={() =>
                    onAddAlert({
                      symbol: detail.symbol,
                      name: detail.name,
                      currency: detail.currency,
                      condition: detail.sma50! >= detail.price ? 'above' : 'below',
                      targetPrice: detail.sma50!,
                      sourceLabel: 'SMA 50',
                    })
                  }
                  className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:border-violet-400 hover:text-violet-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                >
                  <BellPlus className="h-3 w-3 text-violet-600 dark:text-violet-400" />
                  <span>SMA50 {formatPrice(detail.sma50, detail.currency, detail.symbol)}</span>
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 divide-y divide-slate-200 lg:grid-cols-12 lg:divide-x lg:divide-y-0 dark:divide-slate-800">
            {/* Custom Price Alert Creator */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const parsed = Number(customAlertPrice);
                if (!Number.isFinite(parsed) || parsed <= 0) return;
                onAddAlert({
                  symbol: detail.symbol,
                  name: detail.name,
                  currency: detail.currency,
                  condition: customAlertCond,
                  targetPrice: Math.round(parsed * 100) / 100,
                  sourceLabel: 'Custom Level',
                });
              }}
              className="flex flex-wrap items-center gap-2 p-3.5 lg:col-span-5"
            >
              <span className="font-mono text-xs font-semibold text-slate-800 dark:text-slate-200">
                {detail.symbol} crosses
              </span>
              <select
                aria-label="Alert condition"
                value={customAlertCond}
                onChange={(e) => setCustomAlertCond(e.target.value as 'above' | 'below')}
                className="rounded border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 focus:border-violet-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                <option value="above">Above (&ge;)</option>
                <option value="below">Below (&le;)</option>
              </select>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={customAlertPrice}
                onChange={(e) => setCustomAlertPrice(e.target.value)}
                aria-label="Alert target price"
                className="w-24 rounded border border-slate-200 bg-white px-2 py-1 font-mono text-xs tabular-nums text-slate-900 focus:border-violet-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
              <button
                type="submit"
                className="inline-flex items-center gap-1 rounded bg-violet-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-violet-700 whitespace-nowrap"
              >
                <BellPlus className="h-3 w-3" />
                <span>Add Alert</span>
              </button>
            </form>

            {/* Saved Alerts List */}
            <div className="p-3.5 lg:col-span-7">
              {alerts.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  No alerts armed yet. Click any <strong className="font-semibold text-slate-700 dark:text-slate-300">Alert</strong> button on Breakout Trigger, Target, Stop, POC, or add a custom price level left.
                </p>
              ) : (
                <div className="max-h-36 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800/80">
                  {alerts.map((al) => (
                    <div
                      key={al.id}
                      className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-xs"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono font-bold text-slate-900 dark:text-slate-100">
                          {al.symbol}
                        </span>
                        <span className="font-mono text-slate-700 dark:text-slate-300">
                          {al.condition === 'above' ? '≥' : '≤'}{' '}
                          {formatPrice(al.targetPrice, al.currency, al.symbol)}
                        </span>
                        <span className="text-[11px] text-slate-500 dark:text-slate-400">
                          ({al.sourceLabel})
                        </span>
                        {al.triggeredAt ? (
                          <span className="font-mono text-[10.5px] font-semibold text-emerald-700 dark:text-emerald-400">
                            Triggered{' '}
                            {al.triggeredPrice != null
                              ? `@ ${formatPrice(al.triggeredPrice, al.currency, al.symbol)}`
                              : ''}
                          </span>
                        ) : (
                          <span
                            className={`font-mono text-[10.5px] font-medium ${
                              al.active
                                ? 'text-violet-700 dark:text-violet-400'
                                : 'text-slate-400'
                            }`}
                          >
                            {al.active ? 'Armed' : 'Paused'}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {onToggleAlert && (
                          <button
                            type="button"
                            onClick={() => onToggleAlert(al.id)}
                            className="text-[11px] font-medium text-blue-600 hover:underline dark:text-blue-400"
                          >
                            {al.active ? 'Pause' : al.triggeredAt ? 'Re-arm' : 'Resume'}
                          </button>
                        )}
                        {onDeleteAlert && (
                          <button
                            type="button"
                            onClick={() => onDeleteAlert(al.id)}
                            aria-label={`Delete alert for ${al.symbol}`}
                            className="text-slate-400 hover:text-rose-600 dark:hover:text-rose-400"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Technical Tape Summary Footer inside Workbench */}
      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-3 text-xs sm:grid-cols-5 dark:border-slate-800">
        <div>
          <span className="text-slate-500 dark:text-slate-400">RSI (14)</span>
          <div className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
            {detail.rsi14 != null ? detail.rsi14.toFixed(1) : '—'}
          </div>
        </div>
        <div>
          <span className="text-slate-500 dark:text-slate-400">SMA 20</span>
          <div className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
            {detail.sma20 != null ? formatPrice(detail.sma20, detail.currency, detail.symbol) : '—'}
          </div>
        </div>
        <div>
          <span className="text-slate-500 dark:text-slate-400">SMA 50</span>
          <div className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
            {detail.sma50 != null ? formatPrice(detail.sma50, detail.currency, detail.symbol) : '—'}
          </div>
        </div>
        <div>
          <span className="text-slate-500 dark:text-slate-400">SMA 200</span>
          <div className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
            {detail.sma200 != null ? formatPrice(detail.sma200, detail.currency, detail.symbol) : '—'}
          </div>
        </div>
        <div>
          <span className="text-slate-500 dark:text-slate-400">20D Avg Vol</span>
          <div className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
            {(detail.avgVolume20 / 1_000_000).toFixed(2)}M
          </div>
        </div>
      </div>

      {/* Latest Ticker Newsflow (Compact 2-Panel Split) */}
      <div className="mt-4 border-t border-slate-200 pt-3.5 dark:border-slate-800">
        <div className="flex items-center justify-between gap-2 pb-2">
          <div className="flex items-center gap-2">
            <Newspaper className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
            <h4 className="font-display text-xs font-semibold text-slate-900 dark:text-slate-100">
              Latest {detail.symbol} Newsflow
            </h4>
          </div>
          <span className="font-mono text-[11px] text-slate-400 dark:text-slate-500">
            {detail.news?.length || 0} headlines
          </span>
        </div>

        {detail.news && detail.news.length > 0 ? (
          (() => {
            const visibleNews = detail.news.slice(0, 6);
            const mid = Math.ceil(visibleNews.length / 2);
            const panels = [visibleNews.slice(0, mid), visibleNews.slice(mid)].filter(
              (col) => col.length > 0
            );
            return (
              <div
                className={`grid grid-cols-1 divide-y divide-slate-100 border-t border-slate-100 dark:divide-slate-800/80 dark:border-slate-800/80 ${
                  panels.length > 1 ? 'md:grid-cols-2 md:divide-x md:divide-y-0' : ''
                }`}
              >
                {panels.map((col, colIdx) => (
                  <ul
                    key={colIdx}
                    className={`divide-y divide-slate-100 dark:divide-slate-800/80 ${
                      colIdx === 0 && panels.length > 1
                        ? 'md:pr-4'
                        : colIdx === 1
                        ? 'md:pl-4'
                        : ''
                    }`}
                  >
                    {col.map((item) => (
                      <li key={item.id} className="py-2">
                        <a
                          href={item.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="group flex items-start justify-between gap-2.5 text-xs leading-snug text-slate-800 hover:text-blue-600 dark:text-slate-200 dark:hover:text-blue-400"
                        >
                          <span className="line-clamp-1 font-medium">{item.title}</span>
                          <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 text-slate-400 group-hover:text-blue-600 dark:group-hover:text-blue-400" />
                        </a>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                          <span className="font-medium text-slate-600 dark:text-slate-300">
                            {item.publisher}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">{item.publishedAt} ET</span>
                          {item.relatedTickers.length > 0 && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="truncate font-mono text-slate-500 dark:text-slate-400">
                                {item.relatedTickers.slice(0, 3).join(', ')}
                              </span>
                            </>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                ))}
              </div>
            );
          })()
        ) : (
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            No recent wire headlines available for {detail.symbol}.
          </p>
        )}
      </div>
    </div>
  );
}
