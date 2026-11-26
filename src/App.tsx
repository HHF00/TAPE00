import { Bell, ExternalLink, Moon, Newspaper, RefreshCw, Search, Sun, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MethodologyView } from './components/MethodologyView.tsx';
import { PatternGuideView } from './components/PatternGuideView.tsx';
import { ScannerTable } from './components/ScannerTable.tsx';
import { TickerWorkbench } from './components/TickerWorkbench.tsx';
import { TopBar, type WorkspaceView } from './components/TopBar.tsx';
import { WatchlistPanel } from './components/WatchlistPanel.tsx';
import { WatchlistView } from './components/WatchlistView.tsx';
import type {
  AssetClassFilter,
  LiveQuote,
  NewsItem,
  PatternBias,
  PatternCategory,
  PatternStage,
  PatternType,
  PriceAlert,
  ScanResponse,
  ScannedTicker,
  SectorHeatmapResponse,
  TickerDetailResponse,
  Timeframe,
  UniverseId,
  Watchlist,
} from './shared/types.ts';
import { normalizeQuickTicker, resolveTickerViaApi } from './shared/tickerUtils.ts';
import { isKnownEtfSymbol, isKnownIndexSymbol, US_UNIVERSES } from './shared/universes.ts';
import { computeSetupConfidence } from './utils/setupConfidence.ts';

const WATCHLISTS_STORAGE_KEY = 'tapescope_watchlists_v1';
const ACTIVE_WL_STORAGE_KEY = 'tapescope_active_watchlist_v1';
const THEME_STORAGE_KEY = 'tapescope_theme_v1';
const ALERTS_STORAGE_KEY = 'tapescope_price_alerts_v1';

const DEFAULT_WATCHLISTS: Watchlist[] = [
  {
    id: 'core_us',
    name: 'Core US Leaders',
    symbols: ['AAPL', 'NVDA', 'MSFT', 'PLTR', 'AMD', 'JPM', 'SPY', 'QQQ'],
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'semis_focus',
    name: 'Semis & Cloud',
    symbols: ['NVDA', 'AVGO', 'AMD', 'MRVL', 'ARM', 'CRWD'],
    createdAt: '2026-01-01T00:00:00.000Z',
  },
];

type UniverseSelection = UniverseId | 'watchlist';
type SortMode =
  | 'priority'
  | 'confidence'
  | 'fit'
  | 'sma20Slope'
  | 'change'
  | 'rvol'
  | 'upDownVol'
  | 'shortInterest'
  | 'rr'
  | 'symbol';
type FlowFilter = 'All' | 'highRvol' | 'accumulation' | 'highShort';
type ProximityFilter = 'All' | 'within2' | 'within5' | 'triggered';
type TrendFilter =
  | 'All'
  | 'above_sma50'
  | 'above_sma200'
  | 'golden_stack'
  | 'rsi_bull'
  | 'rsi_oversold'
  | 'obv_accum'
  | 'above_vwap20';
type StrategyPreset = 'none' | 'squeeze_breakout' | 'tight_coil' | 'stage2_pullback' | 'accum_leaders';

function loadWatchlists(): Watchlist[] {
  try {
    const raw = localStorage.getItem(WATCHLISTS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    // Fallback to defaults
  }
  return DEFAULT_WATCHLISTS;
}

function loadAlerts(): PriceAlert[] {
  try {
    const raw = localStorage.getItem(ALERTS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // ignore
  }
  return [];
}

export default function App() {
  const [activeView, setActiveView] = useState<WorkspaceView>('scanner');
  const [isDark, setIsDark] = useState<boolean>(() => {
    try {
      return localStorage.getItem(THEME_STORAGE_KEY) === 'dark';
    } catch {
      return false;
    }
  });

  const [watchlists, setWatchlists] = useState<Watchlist[]>(loadWatchlists);
  const [activeWatchlistId, setActiveWatchlistId] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(ACTIVE_WL_STORAGE_KEY);
      if (saved) return saved;
    } catch {
      // ignore
    }
    return DEFAULT_WATCHLISTS[0].id;
  });
  const [prioritizeWatchlist, setPrioritizeWatchlist] = useState<boolean>(true);

  const [universe, setUniverse] = useState<UniverseSelection>('mega_cap');
  const [timeframe, setTimeframe] = useState<Timeframe>('1d');
  const [biasFilter, setBiasFilter] = useState<'All' | PatternBias>('All');
  const [stageFilter, setStageFilter] = useState<'All' | PatternStage>('All');
  const [categoryFilter, setCategoryFilter] = useState<'All' | PatternCategory>('All');
  const [patternTypeFilter, setPatternTypeFilter] = useState<'All' | PatternType>('All');
  const [sectorFilter, setSectorFilter] = useState<string>('All');
  const [minFitFilter, setMinFitFilter] = useState<number>(0);
  const [proximityFilter, setProximityFilter] = useState<ProximityFilter>('All');
  const [trendFilter, setTrendFilter] = useState<TrendFilter>('All');
  const [minRrFilter, setMinRrFilter] = useState<number>(0);
  const [activePreset, setActivePreset] = useState<StrategyPreset>('none');
  const [flowFilter, setFlowFilter] = useState<FlowFilter>('All');
  const [matchedOnly, setMatchedOnly] = useState<boolean>(false);
  const [excludeEtfs, setExcludeEtfs] = useState<boolean>(false);
  const [sortMode, setSortMode] = useState<SortMode>('priority');
  const [symbolQuery, setSymbolQuery] = useState<string>('');

  const [scanData, setScanData] = useState<ScanResponse | null>(null);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [tickerDetail, setTickerDetail] = useState<TickerDetailResponse | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState<boolean>(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const selectedSymbolRef = useRef<string | null>(null);
  const pendingUniverseSelectionRef = useRef<boolean>(true);
  const scanRequestSeqRef = useRef<number>(0);
  const detailRequestSeqRef = useRef<number>(0);
  const lastLoadedDetailKeyRef = useRef<string | null>(null);

  const [quotesBySymbol, setQuotesBySymbol] = useState<Record<string, LiveQuote>>({});
  const [isRefreshingQuotes, setIsRefreshingQuotes] = useState<boolean>(false);

  const [marketNews, setMarketNews] = useState<NewsItem[]>([]);
  const [isLoadingNews, setIsLoadingNews] = useState<boolean>(false);

  const [heatmapData, setHeatmapData] = useState<SectorHeatmapResponse | null>(null);
  const [isLoadingHeatmap, setIsLoadingHeatmap] = useState<boolean>(false);

  const [alerts, setAlerts] = useState<PriceAlert[]>(loadAlerts);
  const [dismissedBannerAlertIds, setDismissedBannerAlertIds] = useState<string[]>([]);

  const activeWatchlist = useMemo(
    () => watchlists.find((w) => w.id === activeWatchlistId) || watchlists[0],
    [watchlists, activeWatchlistId]
  );

  const activeWatchlistSymbols = useMemo(
    () => activeWatchlist?.symbols || [],
    [activeWatchlist]
  );

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, isDark ? 'dark' : 'light');
    } catch {
      // ignore
    }
  }, [isDark]);

  useEffect(() => {
    try {
      localStorage.setItem(WATCHLISTS_STORAGE_KEY, JSON.stringify(watchlists));
    } catch {
      // ignore
    }
  }, [watchlists]);

  useEffect(() => {
    try {
      localStorage.setItem(ACTIVE_WL_STORAGE_KEY, activeWatchlistId);
    } catch {
      // ignore
    }
  }, [activeWatchlistId]);

  useEffect(() => {
    try {
      localStorage.setItem(ALERTS_STORAGE_KEY, JSON.stringify(alerts));
    } catch {
      // ignore
    }
  }, [alerts]);

  const handleAddAlert = useCallback(
    (input: {
      symbol: string;
      name: string;
      currency?: string;
      condition: 'above' | 'below';
      targetPrice: number;
      sourceLabel: string;
    }) => {
      setAlerts((prev) => {
        const dup = prev.some(
          (a) =>
            a.symbol === input.symbol &&
            a.condition === input.condition &&
            Math.abs(a.targetPrice - input.targetPrice) < 0.01 &&
            a.active
        );
        if (dup) return prev;
        const next: PriceAlert = {
          id: `al_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          symbol: input.symbol,
          name: input.name,
          currency: input.currency,
          condition: input.condition,
          targetPrice: input.targetPrice,
          sourceLabel: input.sourceLabel,
          active: true,
          createdAt: new Date().toISOString(),
        };
        return [next, ...prev];
      });
    },
    []
  );

  const handleToggleAlert = useCallback((id: string) => {
    setAlerts((prev) =>
      prev.map((a) =>
        a.id === id
          ? {
              ...a,
              active: !a.active,
              triggeredAt: !a.active ? undefined : a.triggeredAt,
              triggeredPrice: !a.active ? undefined : a.triggeredPrice,
            }
          : a
      )
    );
  }, []);

  const handleDeleteAlert = useCallback((id: string) => {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const fetchQuotes = useCallback(async (symbols: string[]) => {
    const clean = Array.from(new Set(symbols)).filter(Boolean).slice(0, 48);
    if (clean.length === 0) return;
    setIsRefreshingQuotes(true);
    try {
      const resp = await fetch(`/api/quotes?symbols=${encodeURIComponent(clean.join(','))}`);
      if (!resp.ok) return;
      const data = (await resp.json()) as { quotes?: LiveQuote[] };
      if (data.quotes) {
        setQuotesBySymbol((prev) => {
          const next = { ...prev };
          for (const q of data.quotes!) {
            next[q.symbol] = q;
          }
          return next;
        });
      }
    } catch {
      // keep existing quotes on transient error
    } finally {
      setIsRefreshingQuotes(false);
    }
  }, []);

  const fetchMarketNews = useCallback(async (symbols: string[]) => {
    const clean = Array.from(new Set([...symbols, 'SPY', 'QQQ'])).filter(Boolean).slice(0, 8);
    setIsLoadingNews(true);
    try {
      const resp = await fetch(`/api/news?symbols=${encodeURIComponent(clean.join(','))}`);
      if (!resp.ok) return;
      const data = (await resp.json()) as { news?: NewsItem[] };
      if (data.news) setMarketNews(data.news);
    } catch {
      // keep existing news
    } finally {
      setIsLoadingNews(false);
    }
  }, []);

  const fetchSectorHeatmap = useCallback(async (symbols: string[]) => {
    const clean = Array.from(new Set(symbols)).filter(Boolean).slice(0, 36);
    if (clean.length === 0) {
      setHeatmapData({ items: [], sectors: [], updatedAt: new Date().toISOString() });
      return;
    }
    setIsLoadingHeatmap(true);
    try {
      const resp = await fetch(`/api/sector-heatmap?symbols=${encodeURIComponent(clean.join(','))}`);
      if (!resp.ok) return;
      const data = (await resp.json()) as SectorHeatmapResponse;
      if (data.items) setHeatmapData(data);
    } catch {
      // keep existing heatmap on transient failure
    } finally {
      setIsLoadingHeatmap(false);
    }
  }, []);

  const loadTickerDetail = useCallback(
    async (symbol: string, tf: Timeframe, forceRefresh = false) => {
      const seq = ++detailRequestSeqRef.current;
      lastLoadedDetailKeyRef.current = `${symbol}:${tf}`;
      setIsLoadingDetail(true);
      setDetailError(null);
      try {
        const resp = await fetch(
          `/api/ticker/${encodeURIComponent(symbol)}?timeframe=${tf}${forceRefresh ? '&refresh=1' : ''}`
        );
        const data = await resp.json();
        if (seq !== detailRequestSeqRef.current) return;
        if (!resp.ok) {
          throw new Error(data.error || `Could not load ${symbol}`);
        }
        setTickerDetail(data as TickerDetailResponse);
      } catch (err) {
        if (seq !== detailRequestSeqRef.current) return;
        setDetailError(err instanceof Error ? err.message : 'Failed to load ticker chart');
      } finally {
        if (seq === detailRequestSeqRef.current) {
          setIsLoadingDetail(false);
        }
      }
    },
    []
  );

  const runScan = useCallback(
    async (
      targetUniverse: UniverseSelection,
      tf: Timeframe,
      priorityList: string[],
      usePriority: boolean,
      forceRefresh = false
    ) => {
      const seq = ++scanRequestSeqRef.current;
      setIsScanning(true);
      setScanError(null);

      try {
        const params = new URLSearchParams();
        params.set('timeframe', tf);
        if (forceRefresh) params.set('refresh', '1');

        const uniMeta =
          targetUniverse === 'watchlist'
            ? null
            : US_UNIVERSES.find((u) => u.id === targetUniverse) || US_UNIVERSES[0];
        const assetType: AssetClassFilter =
          targetUniverse === 'watchlist' ? 'all' : uniMeta?.assetType || 'equities';

        params.set('assetType', assetType);

        if (targetUniverse === 'watchlist') {
          if (priorityList.length === 0) {
            if (seq !== scanRequestSeqRef.current) return;
            setScanData({
              universe: 'watchlist',
              universeLabel: activeWatchlist?.name || 'Personalized Watchlist',
              assetType,
              timeframe: tf,
              scannedCount: 0,
              matchedCount: 0,
              updatedAt: new Date().toISOString(),
              results: [],
              errors: [],
            });
            setIsScanning(false);
            return;
          }
          params.set('symbols', priorityList.join(','));
        } else {
          params.set('universe', targetUniverse);
          if (usePriority && priorityList.length > 0) {
            const eligiblePriority = priorityList.filter((sym) => {
              if (assetType === 'etfs') return isKnownEtfSymbol(sym);
              if (assetType === 'indices') return isKnownIndexSymbol(sym);
              return !isKnownEtfSymbol(sym) && !isKnownIndexSymbol(sym);
            });
            if (eligiblePriority.length > 0) {
              params.set('priority', eligiblePriority.join(','));
            }
          }
        }

        const resp = await fetch(`/api/scan?${params.toString()}`);
        const data = await resp.json();
        if (seq !== scanRequestSeqRef.current) return;
        if (!resp.ok) {
          throw new Error(data.error || 'Market scan failed');
        }

        const payload = data as ScanResponse;
        setScanData(payload);

        // Hydrate live quote map from scan payload
        setQuotesBySymbol((prev) => {
          const next = { ...prev };
          for (const item of payload.results) {
            next[item.symbol] = {
              symbol: item.symbol,
              name: item.name,
              exchange: item.exchange,
              currency: item.currency,
              price: item.price,
              change: item.change,
              changePct: item.changePct,
              volume: item.volume,
              dayHigh: item.dayHigh,
              dayLow: item.dayLow,
              marketState: item.marketState,
              updatedAt: item.updatedAt,
            };
          }
          return next;
        });

        // Only auto-select a scan result on initial mount or an explicit universe switch
        // when the user hasn't clicked/looked up a specific ticker in the meantime.
        const currentSym = selectedSymbolRef.current;
        const shouldAutoSelect =
          payload.results.length > 0 &&
          (!currentSym ||
            (pendingUniverseSelectionRef.current &&
              !payload.results.some((r) => r.symbol === currentSym)));
        pendingUniverseSelectionRef.current = false;

        if (shouldAutoSelect) {
          const nextSym = payload.results[0].symbol;
          selectedSymbolRef.current = nextSym;
          setSelectedSymbol(nextSym);
          void loadTickerDetail(nextSym, tf, forceRefresh);
        } else if (
          currentSym &&
          (forceRefresh || lastLoadedDetailKeyRef.current !== `${currentSym}:${tf}`)
        ) {
          void loadTickerDetail(currentSym, tf, forceRefresh);
        }
      } catch (err) {
        if (seq !== scanRequestSeqRef.current) return;
        setScanError(err instanceof Error ? err.message : 'Scan request failed');
      } finally {
        if (seq === scanRequestSeqRef.current) {
          setIsScanning(false);
        }
      }
    },
    [activeWatchlist?.name, loadTickerDetail]
  );

  // Initial scan & re-scan when universe, timeframe, or watchlist priority changes
  useEffect(() => {
    void runScan(universe, timeframe, activeWatchlistSymbols, prioritizeWatchlist, false);
  }, [universe, timeframe, prioritizeWatchlist, activeWatchlistSymbols, runScan]);

  // Refresh live NYSE/Nasdaq quotes for active watchlist every 30s & load watchlist newsflow + sector heatmap
  useEffect(() => {
    void fetchMarketNews(activeWatchlistSymbols);
    void fetchSectorHeatmap(activeWatchlistSymbols);
    if (activeWatchlistSymbols.length === 0) return;
    void fetchQuotes(activeWatchlistSymbols);
    const id = window.setInterval(() => {
      void fetchQuotes(activeWatchlistSymbols);
    }, 30000);
    return () => window.clearInterval(id);
  }, [activeWatchlistSymbols, fetchQuotes, fetchMarketNews, fetchSectorHeatmap]);

  const handleSelectSymbol = useCallback(
    (symbol: string, forceRefresh = false) => {
      pendingUniverseSelectionRef.current = false;
      selectedSymbolRef.current = symbol;
      setSelectedSymbol(symbol);
      void loadTickerDetail(symbol, timeframe, forceRefresh);
    },
    [loadTickerDetail, timeframe]
  );

  const handleTimeframeChange = useCallback(
    (nextTf: Timeframe) => {
      setTimeframe(nextTf);
      if (selectedSymbolRef.current) {
        void loadTickerDetail(selectedSymbolRef.current, nextTf);
      }
    },
    [loadTickerDetail]
  );

  const marketHint: 'MY' | 'US' =
    universe === 'klci' || universe === 'bursa_all' || universe === 'my_indices' ? 'MY' : 'US';

  const handleCustomTickerLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    const raw = symbolQuery.trim();
    if (!raw) return;
    const sym = await resolveTickerViaApi(raw, marketHint);
    if (!sym) return;

    pendingUniverseSelectionRef.current = false;
    selectedSymbolRef.current = sym;
    setSelectedSymbol(sym);
    setActiveView('scanner');
    await loadTickerDetail(sym, timeframe, true);
  };

  // Watchlist mutations
  const handleAddSymbolToActiveList = (symbol: string) => {
    const clean = normalizeQuickTicker(symbol);
    if (!clean) return;
    setWatchlists((prev) =>
      prev.map((wl) =>
        wl.id === activeWatchlist?.id && !wl.symbols.includes(clean)
          ? { ...wl, symbols: [clean, ...wl.symbols] }
          : wl
      )
    );
    void fetchQuotes([clean]);
  };

  const handleRemoveSymbolFromActiveList = (symbol: string) => {
    setWatchlists((prev) =>
      prev.map((wl) =>
        wl.id === activeWatchlist?.id
          ? { ...wl, symbols: wl.symbols.filter((s) => s !== symbol) }
          : wl
      )
    );
  };

  const handleToggleWatchlistSymbol = (symbol: string) => {
    if (activeWatchlistSymbols.includes(symbol)) {
      handleRemoveSymbolFromActiveList(symbol);
    } else {
      handleAddSymbolToActiveList(symbol);
    }
  };

  const handleCreateWatchlist = (name: string) => {
    const id = `wl_${Date.now()}`;
    const next: Watchlist = {
      id,
      name,
      symbols: [],
      createdAt: new Date().toISOString(),
    };
    setWatchlists((prev) => [...prev, next]);
    setActiveWatchlistId(id);
  };

  const handleRenameWatchlist = (id: string, name: string) => {
    setWatchlists((prev) => prev.map((wl) => (wl.id === id ? { ...wl, name } : wl)));
  };

  const handleDeleteWatchlist = (id: string) => {
    setWatchlists((prev) => {
      const remaining = prev.filter((wl) => wl.id !== id);
      if (remaining.length > 0 && activeWatchlistId === id) {
        setActiveWatchlistId(remaining[0].id);
      }
      return remaining.length > 0 ? remaining : DEFAULT_WATCHLISTS;
    });
  };

  // Merge live quotes onto scan results for real-time display
  const liveResults: ScannedTicker[] = useMemo(() => {
    if (!scanData) return [];
    return scanData.results.map((r) => {
      const q = quotesBySymbol[r.symbol];
      if (!q) return r;
      const rvol =
        r.timeframe === '1d' && r.avgVolume20 > 0
          ? Math.round((q.volume / r.avgVolume20) * 100) / 100
          : r.rvol;
      return {
        ...r,
        currency: q.currency ?? r.currency,
        price: q.price,
        change: q.change,
        changePct: q.changePct,
        volume: q.volume,
        dayHigh: q.dayHigh,
        dayLow: q.dayLow,
        marketState: q.marketState,
        rvol,
      };
    });
  }, [scanData, quotesBySymbol]);

  const scannedBySymbol = useMemo(() => {
    const map: Record<string, ScannedTicker> = {};
    for (const item of liveResults) {
      map[item.symbol] = item;
    }
    return map;
  }, [liveResults]);

  // Evaluate armed alerts whenever live quotes, scan rows, or ticker detail update
  useEffect(() => {
    setAlerts((prev) => {
      if (!prev.some((a) => a.active)) return prev;
      let changed = false;
      const nowIso = new Date().toISOString();
      const next = prev.map((al) => {
        if (!al.active) return al;
        const price =
          quotesBySymbol[al.symbol]?.price ??
          scannedBySymbol[al.symbol]?.price ??
          (tickerDetail?.symbol === al.symbol ? tickerDetail.price : undefined);
        if (price == null || !Number.isFinite(price)) return al;
        const hit =
          (al.condition === 'above' && price >= al.targetPrice) ||
          (al.condition === 'below' && price <= al.targetPrice);
        if (!hit) return al;
        changed = true;
        return {
          ...al,
          active: false,
          triggeredAt: nowIso,
          triggeredPrice: price,
        };
      });
      return changed ? next : prev;
    });
  }, [quotesBySymbol, scannedBySymbol, tickerDetail]);

  const availableSectors = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of liveResults) {
      const sec = item.sector?.trim();
      if (!sec) continue;
      counts.set(sec, (counts.get(sec) || 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([sector, count]) => ({ sector, count }));
  }, [liveResults]);

  useEffect(() => {
    if (
      sectorFilter !== 'All' &&
      liveResults.length > 0 &&
      !availableSectors.some((s) => s.sector === sectorFilter)
    ) {
      setSectorFilter('All');
    }
  }, [availableSectors, liveResults.length, sectorFilter]);

  const filteredResults = useMemo(() => {
    const wlSet = new Set(activeWatchlistSymbols);
    const q = symbolQuery.trim().toUpperCase();
    const hasPatternFilter =
      matchedOnly ||
      patternTypeFilter !== 'All' ||
      categoryFilter !== 'All' ||
      biasFilter !== 'All' ||
      stageFilter !== 'All' ||
      minFitFilter > 0 ||
      proximityFilter !== 'All' ||
      minRrFilter > 0;

    const filtered = liveResults.filter((item) => {
      if (excludeEtfs && item.isETF) return false;
      if (sectorFilter !== 'All' && item.sector !== sectorFilter) return false;
      if (
        q &&
        !item.symbol.includes(q) &&
        !item.name.toUpperCase().includes(q) &&
        !item.sector.toUpperCase().includes(q)
      ) {
        return false;
      }

      if (hasPatternFilter) {
        const matchingPatterns = item.patterns.filter((p) => {
          if (patternTypeFilter !== 'All' && p.type !== patternTypeFilter) return false;
          if (categoryFilter !== 'All' && p.category !== categoryFilter) return false;
          if (biasFilter !== 'All' && p.bias !== biasFilter) return false;
          if (stageFilter !== 'All' && p.stage !== stageFilter) return false;
          if (minFitFilter > 0 && p.fitScore < minFitFilter) return false;
          if (proximityFilter === 'within2' && Math.abs(p.distanceToBreakoutPct) > 2) return false;
          if (proximityFilter === 'within5' && Math.abs(p.distanceToBreakoutPct) > 5) return false;
          if (proximityFilter === 'triggered' && p.stage !== 'Breakout') return false;
          if (minRrFilter > 0 && p.riskReward < minRrFilter) return false;
          return true;
        });
        if (matchingPatterns.length === 0) return false;
      }

      if (trendFilter === 'above_sma50' && (item.sma50 == null || item.price <= item.sma50)) return false;
      if (trendFilter === 'above_sma200' && (item.sma200 == null || item.price <= item.sma200)) return false;
      if (
        trendFilter === 'golden_stack' &&
        (item.sma20 == null ||
          item.sma50 == null ||
          item.sma200 == null ||
          !(item.price > item.sma20 && item.sma20 > item.sma50 && item.sma50 > item.sma200))
      ) {
        return false;
      }
      if (trendFilter === 'rsi_bull' && (item.rsi14 == null || item.rsi14 < 50 || item.rsi14 > 70)) return false;
      if (trendFilter === 'rsi_oversold' && (item.rsi14 == null || item.rsi14 > 35)) return false;
      if (trendFilter === 'obv_accum' && item.volumeAnalysis?.obvTrend !== 'Accumulation') return false;
      if (
        trendFilter === 'above_vwap20' &&
        (item.volumeAnalysis?.vwap20 == null || item.price <= item.volumeAnalysis.vwap20)
      ) {
        return false;
      }

      if (flowFilter === 'highRvol' && item.rvol < 1.3) return false;
      if (flowFilter === 'accumulation' && (item.volumeAnalysis?.upDownVolumeRatio ?? 0) < 1.2) return false;
      if (flowFilter === 'highShort' && (item.shortInterest?.shortPercentOfFloat ?? 0) < 3.0) return false;
      return true;
    });

    const stageWeight = (s?: string) =>
      s === 'Breakout' ? 300 : s === 'Testing Level' ? 200 : s === 'Forming' ? 100 : 0;

    return [...filtered].sort((a, b) => {
      const aPat =
        patternTypeFilter !== 'All'
          ? a.patterns.find((p) => p.type === patternTypeFilter) || a.primaryPattern
          : a.primaryPattern;
      const bPat =
        patternTypeFilter !== 'All'
          ? b.patterns.find((p) => p.type === patternTypeFilter) || b.primaryPattern
          : b.primaryPattern;

      if (sortMode === 'priority') {
        const aPri = prioritizeWatchlist && wlSet.has(a.symbol) ? 1000 : 0;
        const bPri = prioritizeWatchlist && wlSet.has(b.symbol) ? 1000 : 0;
        const aScore = aPri + (aPat ? stageWeight(aPat.stage) + aPat.fitScore : a.rvol);
        const bScore = bPri + (bPat ? stageWeight(bPat.stage) + bPat.fitScore : b.rvol);
        return bScore - aScore;
      }
      if (sortMode === 'confidence') {
        const aScore = computeSetupConfidence(a, aPat).score;
        const bScore = computeSetupConfidence(b, bPat).score;
        return bScore - aScore;
      }
      if (sortMode === 'fit') {
        const aScore = aPat ? stageWeight(aPat.stage) + aPat.fitScore : 0;
        const bScore = bPat ? stageWeight(bPat.stage) + bPat.fitScore : 0;
        return bScore - aScore;
      }
      if (sortMode === 'sma20Slope') {
        return (b.sma20SlopePct ?? -999) - (a.sma20SlopePct ?? -999);
      }
      if (sortMode === 'change') return b.changePct - a.changePct;
      if (sortMode === 'rvol') return b.rvol - a.rvol;
      if (sortMode === 'upDownVol') {
        return (b.volumeAnalysis?.upDownVolumeRatio ?? 0) - (a.volumeAnalysis?.upDownVolumeRatio ?? 0);
      }
      if (sortMode === 'shortInterest') {
        return (b.shortInterest?.shortPercentOfFloat ?? -1) - (a.shortInterest?.shortPercentOfFloat ?? -1);
      }
      if (sortMode === 'rr') return (bPat?.riskReward || 0) - (aPat?.riskReward || 0);
      return a.symbol.localeCompare(b.symbol);
    });
  }, [
    liveResults,
    activeWatchlistSymbols,
    prioritizeWatchlist,
    symbolQuery,
    matchedOnly,
    excludeEtfs,
    sectorFilter,
    biasFilter,
    stageFilter,
    categoryFilter,
    patternTypeFilter,
    minFitFilter,
    proximityFilter,
    trendFilter,
    minRrFilter,
    flowFilter,
    sortMode,
  ]);

  const hasActiveFilters =
    biasFilter !== 'All' ||
    stageFilter !== 'All' ||
    categoryFilter !== 'All' ||
    patternTypeFilter !== 'All' ||
    sectorFilter !== 'All' ||
    minFitFilter > 0 ||
    proximityFilter !== 'All' ||
    trendFilter !== 'All' ||
    minRrFilter > 0 ||
    flowFilter !== 'All' ||
    matchedOnly ||
    excludeEtfs ||
    symbolQuery.trim().length > 0;

  const summaryStats = useMemo(() => {
    const matched = filteredResults.filter((r) => r.patterns.length > 0);
    const getPat = (r: ScannedTicker) =>
      patternTypeFilter !== 'All'
        ? r.patterns.find((p) => p.type === patternTypeFilter) || r.primaryPattern
        : r.primaryPattern;
    const bullishCount = matched.filter((r) => getPat(r)?.bias === 'Bullish').length;
    const bearishCount = matched.filter((r) => getPat(r)?.bias === 'Bearish').length;
    const breakoutsCount = matched.filter((r) => getPat(r)?.stage === 'Breakout').length;
    const avgRvol =
      filteredResults.length > 0
        ? filteredResults.reduce((sum, r) => sum + r.rvol, 0) / filteredResults.length
        : 0;
    return {
      total: filteredResults.length,
      matchedCount: matched.length,
      bullishCount,
      bearishCount,
      breakoutsCount,
      avgRvol,
    };
  }, [filteredResults, patternTypeFilter]);

  const resetFilters = () => {
    setBiasFilter('All');
    setStageFilter('All');
    setCategoryFilter('All');
    setPatternTypeFilter('All');
    setSectorFilter('All');
    setMinFitFilter(0);
    setProximityFilter('All');
    setTrendFilter('All');
    setMinRrFilter(0);
    setFlowFilter('All');
    setMatchedOnly(false);
    setExcludeEtfs(false);
    setActivePreset('none');
    setSymbolQuery('');
  };

  const applyStrategyPreset = (preset: StrategyPreset) => {
    setActivePreset(preset);
    if (preset === 'none') {
      resetFilters();
      return;
    }
    setCategoryFilter('All');
    setPatternTypeFilter('All');
    if (preset === 'squeeze_breakout') {
      setBiasFilter('Bullish');
      setStageFilter('Breakout');
      setMinFitFilter(75);
      setProximityFilter('All');
      setTrendFilter('All');
      setMinRrFilter(1.5);
      setFlowFilter('highRvol');
      setMatchedOnly(true);
    } else if (preset === 'tight_coil') {
      setBiasFilter('Bullish');
      setStageFilter('Testing Level');
      setMinFitFilter(75);
      setProximityFilter('within2');
      setTrendFilter('above_sma50');
      setMinRrFilter(1.5);
      setFlowFilter('All');
      setMatchedOnly(true);
    } else if (preset === 'stage2_pullback') {
      setBiasFilter('Bullish');
      setStageFilter('All');
      setMinFitFilter(70);
      setProximityFilter('within5');
      setTrendFilter('golden_stack');
      setMinRrFilter(2);
      setFlowFilter('All');
      setMatchedOnly(true);
    } else if (preset === 'accum_leaders') {
      setBiasFilter('Bullish');
      setStageFilter('All');
      setMinFitFilter(70);
      setProximityFilter('All');
      setTrendFilter('obv_accum');
      setMinRrFilter(0);
      setFlowFilter('accumulation');
      setMatchedOnly(true);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <TopBar
        activeView={activeView}
        onSelectView={setActiveView}
        onRescan={() => void runScan(universe, timeframe, activeWatchlistSymbols, prioritizeWatchlist, true)}
        isScanning={isScanning}
      />

      {activeView === 'guide' && (
        <PatternGuideView
          onFilterByCategory={(cat) => {
            setCategoryFilter(cat);
            setMatchedOnly(true);
            setActiveView('scanner');
          }}
        />
      )}

      {activeView === 'watchlist' && (
        <WatchlistView
          watchlists={watchlists}
          activeWatchlistId={activeWatchlist?.id || ''}
          onSelectWatchlist={setActiveWatchlistId}
          onCreateWatchlist={handleCreateWatchlist}
          onRenameWatchlist={handleRenameWatchlist}
          onDeleteWatchlist={handleDeleteWatchlist}
          onAddSymbol={handleAddSymbolToActiveList}
          onRemoveSymbol={handleRemoveSymbolFromActiveList}
          onScanWatchlist={(id) => {
            pendingUniverseSelectionRef.current = true;
            setActiveWatchlistId(id);
            setUniverse('watchlist');
            setActiveView('scanner');
          }}
          onInspectSymbol={(sym) => {
            handleSelectSymbol(sym);
            setActiveView('scanner');
          }}
          quotesBySymbol={quotesBySymbol}
          heatmapData={heatmapData}
          isLoadingHeatmap={isLoadingHeatmap}
          onRefreshHeatmap={() => void fetchSectorHeatmap(activeWatchlistSymbols)}
          isDark={isDark}
          marketHint={marketHint}
        />
      )}

      {activeView === 'methodology' && <MethodologyView />}

      {activeView === 'scanner' && (
        <main className="mx-auto w-full max-w-[1680px] space-y-4 px-4 py-5 sm:px-6">
          {/* Workspace Control Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Grouped US & Malaysia Universe Selector */}
            <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-200/70 p-1 dark:bg-slate-900">
              <span className="px-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 whitespace-nowrap">
                US
              </span>
              {US_UNIVERSES.filter((u) => u.region === 'US').map((u) => {
                const active = universe === u.id;
                return (
                  <button
                    key={u.id}
                    type="button"
                    title={u.description}
                    onClick={() => {
                      if (u.assetType === 'etfs' || u.assetType === 'indices') setExcludeEtfs(false);
                      pendingUniverseSelectionRef.current = true;
                      setSectorFilter('All');
                      setUniverse(u.id);
                    }}
                    className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      active
                        ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                  >
                    {u.shortLabel}
                  </button>
                );
              })}

              <span aria-hidden="true" className="mx-1 h-4 w-px bg-slate-300 dark:bg-slate-700" />
              <span className="px-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 whitespace-nowrap">
                MY
              </span>
              {US_UNIVERSES.filter((u) => u.region === 'MY').map((u) => {
                const active = universe === u.id;
                return (
                  <button
                    key={u.id}
                    type="button"
                    title={u.description}
                    onClick={() => {
                      if (u.assetType === 'indices') setExcludeEtfs(false);
                      pendingUniverseSelectionRef.current = true;
                      setSectorFilter('All');
                      setUniverse(u.id);
                    }}
                    className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      active
                        ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                  >
                    {u.shortLabel}
                  </button>
                );
              })}

              <span aria-hidden="true" className="mx-1 h-4 w-px bg-slate-300 dark:bg-slate-700" />
              <button
                type="button"
                onClick={() => {
                  pendingUniverseSelectionRef.current = true;
                  setSectorFilter('All');
                  setUniverse('watchlist');
                }}
                className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  universe === 'watchlist'
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                Watchlist Only
              </button>
            </div>

            {/* Right Controls: Timeframe + Instant Any-Market Ticker Lookup + Theme */}
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="flex items-center rounded-lg bg-slate-200/70 p-1 dark:bg-slate-900">
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
                    onClick={() => handleTimeframeChange(tf.id)}
                    className={`rounded-md px-2 py-1 font-mono text-xs font-medium transition-colors whitespace-nowrap ${
                      timeframe === tf.id
                        ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                  >
                    {tf.label}
                  </button>
                ))}
              </div>

              <form onSubmit={handleCustomTickerLookup} className="relative flex items-center">
                <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-slate-400" />
                <input
                  type="text"
                  value={symbolQuery}
                  onChange={(e) => setSymbolQuery(e.target.value)}
                  placeholder="Filter or scan ticker (e.g. PLTR, 1155, MAYBANK)"
                  aria-label="Filter or scan any ticker"
                  className="w-60 rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
                />
                {symbolQuery.trim().length > 0 && (
                  <button
                    type="submit"
                    className="ml-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-blue-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-blue-400 whitespace-nowrap"
                  >
                    Inspect
                  </button>
                )}
              </form>

              <button
                type="button"
                onClick={() => setIsDark((d) => !d)}
                aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
              >
                {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* Prominent Personalized Watchlist Panel */}
          <WatchlistPanel
            watchlists={watchlists}
            activeWatchlistId={activeWatchlist?.id || ''}
            onSelectWatchlist={setActiveWatchlistId}
            onCreateWatchlist={handleCreateWatchlist}
            onAddSymbol={handleAddSymbolToActiveList}
            onRemoveSymbol={handleRemoveSymbolFromActiveList}
            prioritizeWatchlist={prioritizeWatchlist}
            onTogglePrioritize={() => setPrioritizeWatchlist((p) => !p)}
            onScanWatchlistOnly={() => {
              pendingUniverseSelectionRef.current = true;
              setUniverse('watchlist');
            }}
            quotesBySymbol={quotesBySymbol}
            scannedBySymbol={scannedBySymbol}
            selectedSymbol={selectedSymbol}
            onSelectSymbol={handleSelectSymbol}
            onRefreshQuotes={() => void fetchQuotes(activeWatchlistSymbols)}
            isRefreshingQuotes={isRefreshingQuotes}
            heatmapData={heatmapData}
            isLoadingHeatmap={isLoadingHeatmap}
            onRefreshHeatmap={() => void fetchSectorHeatmap(activeWatchlistSymbols)}
            isDark={isDark}
            marketHint={marketHint}
          />

          {/* Enhanced Pattern & Confluence Filter Strip */}
          <div className="space-y-2.5 border-y border-slate-200 py-2.5 dark:border-slate-800">
            {/* Row 1: Bias, Stage, Exact Pattern, Category, Fit, Proximity, Trend, Min R:R */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-0.5 rounded-md bg-slate-100 p-0.5 dark:bg-slate-900">
                {(['All', 'Bullish', 'Bearish', 'Neutral'] as const).map((b) => (
                  <button
                    key={b}
                    type="button"
                    onClick={() => {
                      setActivePreset('none');
                      setBiasFilter(b);
                    }}
                    className={`rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                      biasFilter === b
                        ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
                    }`}
                  >
                    {b === 'All' ? 'All Bias' : b}
                  </button>
                ))}
              </div>

              <select
                aria-label="Filter by pattern stage"
                value={stageFilter}
                onChange={(e) => {
                  setActivePreset('none');
                  setStageFilter(e.target.value as 'All' | PatternStage);
                }}
                className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 focus:border-blue-600 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
              >
                <option value="All">All Stages</option>
                <option value="Breakout">Breakout</option>
                <option value="Testing Level">Testing Level</option>
                <option value="Forming">Forming</option>
              </select>

              <select
                aria-label="Filter by exact chart pattern"
                value={patternTypeFilter}
                onChange={(e) => {
                  setActivePreset('none');
                  setPatternTypeFilter(e.target.value as 'All' | PatternType);
                }}
                className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 focus:border-blue-600 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
              >
                <option value="All">Exact Pattern: Any (14)</option>
                <optgroup label="Triangles">
                  <option value="Ascending Triangle">Ascending Triangle</option>
                  <option value="Descending Triangle">Descending Triangle</option>
                  <option value="Symmetrical Triangle">Symmetrical Triangle</option>
                </optgroup>
                <optgroup label="Flags &amp; Pennants">
                  <option value="Bull Flag">Bull Flag</option>
                  <option value="Bear Flag">Bear Flag</option>
                </optgroup>
                <optgroup label="Cup &amp; Handle">
                  <option value="Cup & Handle">Cup &amp; Handle</option>
                </optgroup>
                <optgroup label="Double Top &amp; Bottom">
                  <option value="Double Bottom">Double Bottom</option>
                  <option value="Double Top">Double Top</option>
                </optgroup>
                <optgroup label="Head &amp; Shoulders">
                  <option value="Inverse Head & Shoulders">Inverse Head &amp; Shoulders</option>
                  <option value="Head & Shoulders">Head &amp; Shoulders</option>
                </optgroup>
                <optgroup label="Parabolic Curves">
                  <option value="Parabola Curve">Parabola Curve</option>
                </optgroup>
                <optgroup label="Wedges &amp; Boxes">
                  <option value="Falling Wedge">Falling Wedge</option>
                  <option value="Rising Wedge">Rising Wedge</option>
                  <option value="Horizontal Breakout Box">Horizontal Breakout Box</option>
                </optgroup>
              </select>

              <select
                aria-label="Filter by chart pattern category"
                value={categoryFilter}
                onChange={(e) => {
                  setActivePreset('none');
                  setCategoryFilter(e.target.value as 'All' | PatternCategory);
                }}
                className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 focus:border-blue-600 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
              >
                <option value="All">All Categories</option>
                <option value="Triangles">Triangles</option>
                <option value="Flags & Pennants">Flags &amp; Pennants</option>
                <option value="Double Top & Bottom">Double Top &amp; Bottom</option>
                <option value="Cup & Handle">Cup &amp; Handle</option>
                <option value="Head & Shoulders">Head &amp; Shoulders</option>
                <option value="Parabolic Curves">Parabolic Curves</option>
                <option value="Wedges & Boxes">Wedges &amp; Boxes</option>
              </select>

              <select
                aria-label="Filter by industry sector"
                value={sectorFilter}
                onChange={(e) => {
                  setActivePreset('none');
                  setSectorFilter(e.target.value);
                }}
                className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 focus:border-blue-600 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
              >
                <option value="All">
                  All Sectors{availableSectors.length > 0 ? ` (${availableSectors.length})` : ''}
                </option>
                {availableSectors.map(({ sector, count }) => (
                  <option key={sector} value={sector}>
                    {sector} ({count})
                  </option>
                ))}
              </select>

              <select
                aria-label="Minimum pattern fit score"
                value={minFitFilter}
                onChange={(e) => {
                  setActivePreset('none');
                  setMinFitFilter(Number(e.target.value));
                }}
                className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 focus:border-blue-600 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
              >
                <option value={0}>Any Fit Score</option>
                <option value={70}>Fit &ge; 70%</option>
                <option value={75}>Fit &ge; 75%</option>
                <option value={80}>Fit &ge; 80%</option>
                <option value={85}>Fit &ge; 85%</option>
              </select>

              <select
                aria-label="Filter by distance to breakout level"
                value={proximityFilter}
                onChange={(e) => {
                  setActivePreset('none');
                  setProximityFilter(e.target.value as ProximityFilter);
                }}
                className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 focus:border-blue-600 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
              >
                <option value="All">Any Distance</option>
                <option value="within2">Near Pivot (&le; 2%)</option>
                <option value="within5">Within 5% of Pivot</option>
                <option value="triggered">Breakout Triggered</option>
              </select>

              <select
                aria-label="Filter by trend and technical confluence"
                value={trendFilter}
                onChange={(e) => {
                  setActivePreset('none');
                  setTrendFilter(e.target.value as TrendFilter);
                }}
                className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 focus:border-blue-600 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
              >
                <option value="All">All Trend / Confluence</option>
                <option value="above_sma50">Price &gt; SMA 50</option>
                <option value="above_sma200">Price &gt; SMA 200</option>
                <option value="golden_stack">Golden Stack (20 &gt; 50 &gt; 200)</option>
                <option value="above_vwap20">Above 20D VWAP</option>
                <option value="obv_accum">OBV Accumulation</option>
                <option value="rsi_bull">RSI Bull Zone (50–70)</option>
                <option value="rsi_oversold">RSI Oversold (&le; 35)</option>
              </select>

              <select
                aria-label="Minimum risk to reward ratio"
                value={minRrFilter}
                onChange={(e) => {
                  setActivePreset('none');
                  setMinRrFilter(Number(e.target.value));
                }}
                className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 focus:border-blue-600 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
              >
                <option value={0}>Any R:R</option>
                <option value={1.5}>R:R &ge; 1.5x</option>
                <option value={2}>R:R &ge; 2.0x</option>
                <option value={3}>R:R &ge; 3.0x</option>
              </select>
            </div>

            {/* Row 2: One-Click Strategy Presets, Flow, Toggles, Clear, Sort */}
            <div className="flex flex-wrap items-center justify-between gap-2.5 border-t border-slate-100 pt-2 dark:border-slate-800/80">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  Presets
                </span>
                <div className="flex flex-wrap items-center gap-0.5 rounded-md bg-slate-100 p-0.5 dark:bg-slate-900">
                  {(
                    [
                      { id: 'none', label: 'All Setups' },
                      { id: 'squeeze_breakout', label: 'Breakout Squeeze' },
                      { id: 'tight_coil', label: 'Tight Coil (±2%)' },
                      { id: 'stage2_pullback', label: 'Stage-2 Trend' },
                      { id: 'accum_leaders', label: 'Accumulation' },
                    ] as const
                  ).map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => applyStrategyPreset(preset.id)}
                      className={`rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                        activePreset === preset.id
                          ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-slate-100'
                          : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                <select
                  aria-label="Filter by volume or short interest"
                  value={flowFilter}
                  onChange={(e) => {
                    setActivePreset('none');
                    setFlowFilter(e.target.value as FlowFilter);
                  }}
                  className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 focus:border-blue-600 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
                >
                  <option value="All">All Vol &amp; Short</option>
                  <option value="highRvol">High RVOL (&ge; 1.3x)</option>
                  <option value="accumulation">Accumulation (Up/Dn &ge; 1.2x)</option>
                  <option value="highShort">Short Float &ge; 3%</option>
                </select>

                <button
                  type="button"
                  onClick={() => {
                    setActivePreset('none');
                    setMatchedOnly((v) => !v);
                  }}
                  aria-pressed={matchedOnly}
                  className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                    matchedOnly
                      ? 'border-blue-600/40 bg-blue-50 text-blue-700 dark:border-blue-500/40 dark:bg-blue-950/50 dark:text-blue-300'
                      : 'border-slate-200 bg-white text-slate-600 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400'
                  }`}
                >
                  {matchedOnly ? 'Active Patterns Only' : 'Show All Scanned'}
                </button>

                <button
                  type="button"
                  onClick={() => setExcludeEtfs((v) => !v)}
                  aria-pressed={excludeEtfs}
                  disabled={universe === 'us_etfs'}
                  title={
                    universe === 'us_etfs'
                      ? 'Exclude ETFs is unavailable while scanning the ETF universe'
                      : 'Filter out symbols flagged as ETFs'
                  }
                  className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap disabled:opacity-45 ${
                    excludeEtfs
                      ? 'border-blue-600/40 bg-blue-50 text-blue-700 dark:border-blue-500/40 dark:bg-blue-950/50 dark:text-blue-300'
                      : 'border-slate-200 bg-white text-slate-600 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400'
                  }`}
                >
                  Exclude ETFs
                </button>

                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="rounded-md px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40 whitespace-nowrap"
                  >
                    Clear
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                <label htmlFor="sort-mode" className="text-xs text-slate-500 dark:text-slate-400">
                  Sort
                </label>
                <select
                  id="sort-mode"
                  value={sortMode}
                  onChange={(e) => setSortMode(e.target.value as SortMode)}
                  className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 focus:border-blue-600 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
                >
                  <option value="priority">Watchlist + Pattern Fit</option>
                  <option value="confidence">Confidence Score</option>
                  <option value="fit">Pattern Fit Score</option>
                  <option value="sma20Slope">20-SMA Trend Slope</option>
                  <option value="rvol">Relative Volume (RVOL)</option>
                  <option value="upDownVol">Up / Down Vol Ratio</option>
                  <option value="shortInterest">Short % of Float</option>
                  <option value="change">Day Change %</option>
                  <option value="rr">Risk / Reward Ratio</option>
                  <option value="symbol">Ticker A–Z</option>
                </select>
              </div>
            </div>
          </div>

          {/* 4-Column Summary Strip */}
          <div className="grid grid-cols-2 divide-x divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white sm:grid-cols-4 sm:divide-y-0 dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
            <div className="px-4 py-3">
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Active Scan Scope
              </div>
              <div className="mt-1 font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                {summaryStats.total}{' '}
                {universe === 'us_etfs'
                  ? 'US ETFs'
                  : universe === 'us_indices'
                  ? 'US Indices'
                  : universe === 'klci'
                  ? 'KLCI Assets'
                  : universe === 'bursa_all'
                  ? 'Bursa Equities'
                  : universe === 'my_indices'
                  ? 'MY Indices'
                  : universe === 'watchlist'
                  ? 'Watchlist Tickers'
                  : 'US Equities'}{' '}
                · {timeframe.toUpperCase()}
              </div>
            </div>
            <div className="px-4 py-3">
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Pattern Matches
              </div>
              <div className="mt-1 font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                {summaryStats.matchedCount} Setups ({summaryStats.bullishCount} Bull / {summaryStats.bearishCount} Bear)
              </div>
            </div>
            <div className="px-4 py-3">
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Confirmed Breakouts
              </div>
              <div className="mt-1 font-mono text-sm font-semibold tabular-nums text-blue-600 dark:text-blue-400">
                {summaryStats.breakoutsCount} Triggered
              </div>
            </div>
            <div className="px-4 py-3">
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Mean Relative Volume
              </div>
              <div className="mt-1 font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                {summaryStats.avgRvol.toFixed(2)}x vs 20D Avg
              </div>
            </div>
          </div>

          {scanError && (
            <div className="flex items-center justify-between rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
              <span>{scanError}</span>
              <button
                type="button"
                onClick={() => void runScan(universe, timeframe, activeWatchlistSymbols, prioritizeWatchlist, true)}
                className="font-semibold underline"
              >
                Retry Scan
              </button>
            </div>
          )}

          {(() => {
            const newlyTriggered = alerts.filter(
              (a) => a.triggeredAt && !a.active && !dismissedBannerAlertIds.includes(a.id)
            );
            if (newlyTriggered.length === 0) return null;
            return (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-violet-200 bg-violet-50 px-4 py-2.5 text-xs dark:border-violet-800/60 dark:bg-violet-950/35">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-violet-800 dark:text-violet-300">
                    <Bell className="h-3.5 w-3.5" />
                    Level Alerts Triggered:
                  </span>
                  {newlyTriggered.slice(0, 4).map((al) => (
                    <button
                      key={al.id}
                      type="button"
                      onClick={() => handleSelectSymbol(al.symbol)}
                      className="font-mono font-semibold text-violet-900 underline-offset-2 hover:underline dark:text-violet-200"
                    >
                      {al.symbol} {al.condition === 'above' ? '≥' : '≤'} {al.targetPrice.toFixed(2)} ({al.sourceLabel})
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setDismissedBannerAlertIds((prev) => [
                      ...prev,
                      ...newlyTriggered.map((a) => a.id),
                    ])
                  }
                  aria-label="Dismiss triggered alerts notification"
                  className="inline-flex items-center gap-1 text-violet-700 hover:text-violet-950 dark:text-violet-300 dark:hover:text-violet-100"
                >
                  <X className="h-3.5 w-3.5" />
                  <span>Dismiss</span>
                </button>
              </div>
            );
          })()}

          {/* Full-Width Chart Workbench & Combined Backtest / Volume / Short Analytics */}
          <section aria-label="Chart Workbench and Pattern Analytics" className="w-full">
            <TickerWorkbench
              detail={tickerDetail}
              timeframe={timeframe}
              onTimeframeChange={handleTimeframeChange}
              isLoading={isLoadingDetail}
              error={detailError}
              isWatchlisted={selectedSymbol ? activeWatchlistSymbols.includes(selectedSymbol) : false}
              onToggleWatchlist={handleToggleWatchlistSymbol}
              onRetry={() => {
                if (selectedSymbol) void loadTickerDetail(selectedSymbol, timeframe, true);
              }}
              activePatternType={patternTypeFilter}
              alerts={alerts}
              onAddAlert={handleAddAlert}
              onToggleAlert={handleToggleAlert}
              onDeleteAlert={handleDeleteAlert}
            />
          </section>

          {/* Full-Width 2-Panel Scanner Result Table */}
          <section aria-label="Scanner Results" className="w-full">
            <ScannerTable
              tickers={filteredResults}
              selectedSymbol={selectedSymbol}
              onSelectSymbol={handleSelectSymbol}
              watchlist={activeWatchlistSymbols}
              onToggleWatchlist={handleToggleWatchlistSymbol}
              isLoading={isScanning && liveResults.length === 0}
              onResetFilters={resetFilters}
              activePatternType={patternTypeFilter}
            />
          </section>

          {/* Latest Watchlist & Market Newsflow (Full-Width Compact 2-Panel Split) */}
          <section
            aria-label="Latest Market Newsflow"
            className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Newspaper className="h-4 w-4 text-slate-500 dark:text-slate-400" />
                <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Latest Watchlist &amp; Market Newsflow
                </h2>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  · {activeWatchlist?.name || 'Active Watchlist'} &amp; Market Benchmarks ({marketNews.length})
                </span>
              </div>
              <button
                type="button"
                onClick={() => void fetchMarketNews(activeWatchlistSymbols)}
                disabled={isLoadingNews}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 whitespace-nowrap"
              >
                <RefreshCw className={`h-3 w-3 ${isLoadingNews ? 'animate-spin' : ''}`} />
                <span>Refresh News</span>
              </button>
            </div>

            {isLoadingNews && marketNews.length === 0 ? (
              <div className="grid grid-cols-1 divide-y divide-slate-100 md:grid-cols-2 md:divide-x md:divide-y-0 dark:divide-slate-800">
                {[0, 1].map((panelIdx) => (
                  <div key={panelIdx} className="divide-y divide-slate-100 px-4 dark:divide-slate-800/80">
                    {Array.from({ length: 3 }).map((_, idx) => (
                      <div key={idx} className="space-y-1.5 py-2.5">
                        <div className="h-3.5 w-full animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
                        <div className="h-3 w-36 animate-pulse rounded bg-slate-100 dark:bg-slate-800/60" />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ) : marketNews.length === 0 ? (
              <p className="px-4 py-4 text-xs text-slate-500 dark:text-slate-400">
                No recent headlines returned for the active watchlist symbols.
              </p>
            ) : (
              (() => {
                const newsSplit = Math.ceil(marketNews.length / 2);
                const newsPanels = [
                  {
                    label: `Feed 1 · Headlines 1–${newsSplit}`,
                    items: marketNews.slice(0, newsSplit),
                  },
                  ...(marketNews.length > 1
                    ? [
                        {
                          label: `Feed 2 · Headlines ${newsSplit + 1}–${marketNews.length}`,
                          items: marketNews.slice(newsSplit),
                        },
                      ]
                    : []),
                ];

                return (
                  <div
                    className={`grid grid-cols-1 divide-y divide-slate-200 dark:divide-slate-800 ${
                      newsPanels.length > 1 ? 'md:grid-cols-2 md:divide-x md:divide-y-0' : ''
                    }`}
                  >
                    {newsPanels.map((panel) => (
                      <div key={panel.label}>
                        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/60 px-4 py-1.5 dark:border-slate-800/80 dark:bg-slate-900/60">
                          <span className="font-display text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                            {panel.label}
                          </span>
                          <span className="font-mono text-[10px] tabular-nums text-slate-400 dark:text-slate-500">
                            {panel.items.length} items
                          </span>
                        </div>
                        <div className="divide-y divide-slate-100 px-4 dark:divide-slate-800/80">
                          {panel.items.map((item) => (
                            <article key={item.id} className="py-2">
                              <a
                                href={item.link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="group flex items-start justify-between gap-2 text-xs font-medium leading-snug text-slate-800 hover:text-blue-600 dark:text-slate-200 dark:hover:text-blue-400"
                              >
                                <span className="line-clamp-1">{item.title}</span>
                                <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 text-slate-400 group-hover:text-blue-600 dark:group-hover:text-blue-400" />
                              </a>

                              <div className="mt-0.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-medium text-slate-600 dark:text-slate-300">
                                    {item.publisher}
                                  </span>
                                  <span aria-hidden="true">·</span>
                                  <span className="font-mono tabular-nums">{item.publishedAt} ET</span>
                                </div>
                                {item.relatedTickers.length > 0 && (
                                  <div className="flex items-center gap-2 font-mono">
                                    {item.relatedTickers
                                      .filter((t) => !t.startsWith('^'))
                                      .slice(0, 3)
                                      .map((sym) => (
                                        <button
                                          key={sym}
                                          type="button"
                                          onClick={() => handleSelectSymbol(sym)}
                                          className="font-semibold text-blue-600 hover:underline dark:text-blue-400"
                                        >
                                          {sym}
                                        </button>
                                      ))}
                                  </div>
                                )}
                              </div>
                            </article>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()
            )}
          </section>
        </main>
      )}
    </div>
  );
}
