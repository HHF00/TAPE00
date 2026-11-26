import { Plus, RefreshCw, Star, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { resolveTickerViaApi } from '../shared/tickerUtils.ts';
import type {
  LiveQuote,
  ScannedTicker,
  SectorHeatmapResponse,
  Watchlist,
} from '../shared/types.ts';
import { useTickerSearch } from '../shared/useTickerSearch.ts';
import { SectorPerformanceHeatmap } from './SectorPerformanceHeatmap.tsx';

interface WatchlistPanelProps {
  watchlists: Watchlist[];
  activeWatchlistId: string;
  onSelectWatchlist: (id: string) => void;
  onCreateWatchlist: (name: string) => void;
  onAddSymbol: (symbol: string) => void;
  onRemoveSymbol: (symbol: string) => void;
  prioritizeWatchlist: boolean;
  onTogglePrioritize: () => void;
  onScanWatchlistOnly: () => void;
  quotesBySymbol: Record<string, LiveQuote>;
  scannedBySymbol: Record<string, ScannedTicker>;
  selectedSymbol: string | null;
  onSelectSymbol: (symbol: string) => void;
  onRefreshQuotes: () => void;
  isRefreshingQuotes: boolean;
  heatmapData: SectorHeatmapResponse | null;
  isLoadingHeatmap: boolean;
  onRefreshHeatmap: () => void;
  isDark: boolean;
  marketHint?: 'MY' | 'US';
}

function formatCompactVol(vol: number): string {
  if (vol >= 1_000_000_000) return `${(vol / 1_000_000_000).toFixed(1)}B`;
  if (vol >= 1_000_000) return `${(vol / 1_000_000).toFixed(1)}M`;
  if (vol >= 1_000) return `${(vol / 1_000).toFixed(0)}K`;
  return String(vol);
}

export function WatchlistPanel({
  watchlists,
  activeWatchlistId,
  onSelectWatchlist,
  onCreateWatchlist,
  onAddSymbol,
  onRemoveSymbol,
  prioritizeWatchlist,
  onTogglePrioritize,
  onScanWatchlistOnly,
  quotesBySymbol,
  scannedBySymbol,
  selectedSymbol,
  onSelectSymbol,
  onRefreshQuotes,
  isRefreshingQuotes,
  heatmapData,
  isLoadingHeatmap,
  onRefreshHeatmap,
  isDark,
  marketHint,
}: WatchlistPanelProps) {
  const [tickerInput, setTickerInput] = useState('');
  const [isAddingTicker, setIsAddingTicker] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isAddingList, setIsAddingList] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [panelMode, setPanelMode] = useState<'cards' | 'heatmap'>('cards');
  const addBoxRef = useRef<HTMLDivElement | null>(null);

  const activeList = watchlists.find((w) => w.id === activeWatchlistId) || watchlists[0];
  const { suggestions, isSearching } = useTickerSearch(tickerInput, marketHint);

  useEffect(() => {
    const onDocClick = (ev: MouseEvent) => {
      if (addBoxRef.current && !addBoxRef.current.contains(ev.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const commitTickerSymbol = (sym: string) => {
    if (!sym) return;
    onAddSymbol(sym);
    setTickerInput('');
    setShowSuggestions(false);
  };

  const handleAddTicker = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tickerInput.trim() || isAddingTicker) return;
    setIsAddingTicker(true);
    try {
      const resolved = await resolveTickerViaApi(tickerInput, marketHint);
      if (resolved) commitTickerSymbol(resolved);
    } finally {
      setIsAddingTicker(false);
    }
  };

  const handleCreateList = (e: React.FormEvent) => {
    e.preventDefault();
    const name = newListName.trim();
    if (!name) return;
    onCreateWatchlist(name);
    setNewListName('');
    setIsAddingList(false);
  };

  return (
    <section
      aria-label="Personalized Market Watchlist"
      className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
    >
      {/* Top Control Row */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Star className="h-4 w-4 fill-amber-400 text-amber-500" />
            <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
              Watchlists
            </h2>
          </div>

          {/* Personalized Watchlist Tabs */}
          <div className="flex flex-wrap items-center gap-1 rounded-md bg-slate-100 p-0.5 dark:bg-slate-800">
            {watchlists.map((wl) => {
              const isActive = wl.id === activeList?.id;
              return (
                <button
                  key={wl.id}
                  type="button"
                  onClick={() => onSelectWatchlist(wl.id)}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    isActive
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-slate-100'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                  }`}
                >
                  {wl.name} ({wl.symbols.length})
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setIsAddingList((v) => !v)}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 whitespace-nowrap shrink-0"
            >
              <Plus className="h-3 w-3" />
              <span>New List</span>
            </button>
          </div>
        </div>

        {/* Watchlist Actions & Priority Toggle */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center rounded-md bg-slate-100 p-0.5 dark:bg-slate-800">
            <button
              type="button"
              onClick={() => setPanelMode('cards')}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                panelMode === 'cards'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
              }`}
            >
              Tickers
            </button>
            <button
              type="button"
              onClick={() => setPanelMode('heatmap')}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                panelMode === 'heatmap'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
              }`}
            >
              Sector Heatmap
            </button>
          </div>

          <div ref={addBoxRef} className="relative">
            <form onSubmit={handleAddTicker} className="flex items-center gap-1.5">
              <input
                type="text"
                value={tickerInput}
                onFocus={() => setShowSuggestions(true)}
                onChange={(e) => {
                  setTickerInput(e.target.value);
                  setShowSuggestions(true);
                }}
                placeholder="+ Add any ticker"
                aria-label="Add any ticker symbol to active watchlist"
                className="w-40 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 font-mono text-xs uppercase text-slate-900 placeholder:normal-case placeholder:font-sans placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
              <button
                type="submit"
                disabled={isAddingTicker}
                className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
              >
                {isAddingTicker ? 'Adding...' : 'Add'}
              </button>
            </form>

            {showSuggestions && tickerInput.trim().length > 0 && (suggestions.length > 0 || isSearching) && (
              <div className="absolute left-0 top-full z-30 mt-1 w-72 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
                {suggestions.map((s) => (
                  <button
                    key={s.symbol}
                    type="button"
                    onClick={() => commitTickerSymbol(s.symbol)}
                    className="flex w-full items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 text-left text-xs hover:bg-slate-50 last:border-b-0 dark:border-slate-800 dark:hover:bg-slate-800"
                  >
                    <div className="min-w-0">
                      <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                        {s.symbol}
                      </div>
                      <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                        {s.name}
                      </div>
                    </div>
                    <span className="shrink-0 font-mono text-[10px] text-slate-400 dark:text-slate-500">
                      {s.exchange}
                    </span>
                  </button>
                ))}
                {isSearching && suggestions.length === 0 && (
                  <div className="px-3 py-2 text-[11px] text-slate-400">
                    Searching Bursa Malaysia &amp; global tickers...
                  </div>
                )}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={onTogglePrioritize}
            aria-pressed={prioritizeWatchlist}
            className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              prioritizeWatchlist
                ? 'border-blue-600/40 bg-blue-50 text-blue-700 dark:border-blue-500/40 dark:bg-blue-950/50 dark:text-blue-300'
                : 'border-slate-200 text-slate-600 hover:text-slate-900 dark:border-slate-700 dark:text-slate-400'
            }`}
          >
            {prioritizeWatchlist ? 'Prioritized First: On' : 'Prioritized First: Off'}
          </button>

          <button
            type="button"
            onClick={onScanWatchlistOnly}
            disabled={!activeList || activeList.symbols.length === 0}
            className="rounded-md bg-slate-900 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-blue-600 dark:hover:bg-blue-500 whitespace-nowrap shrink-0"
          >
            Scan List Only
          </button>

          <button
            type="button"
            onClick={onRefreshQuotes}
            disabled={isRefreshingQuotes}
            aria-label="Refresh live market quotes"
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`h-3 w-3 ${isRefreshingQuotes ? 'animate-spin' : ''}`} />
            <span>Quotes</span>
          </button>
        </div>
      </div>

      {/* Inline Create List Form */}
      {isAddingList && (
        <form
          onSubmit={handleCreateList}
          className="mt-3 flex flex-wrap items-center gap-2 border-b border-slate-100 pb-3 dark:border-slate-800"
        >
          <input
            type="text"
            value={newListName}
            onChange={(e) => setNewListName(e.target.value)}
            placeholder="Watchlist name (e.g. AI Infrastructure, Earnings Breakouts)"
            aria-label="New watchlist name"
            className="w-72 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
          <button
            type="submit"
            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500"
          >
            Create Watchlist
          </button>
          <button
            type="button"
            onClick={() => setIsAddingList(false)}
            className="px-2 py-1.5 text-xs text-slate-500 hover:text-slate-800 dark:text-slate-400"
          >
            Cancel
          </button>
        </form>
      )}

      {/* Prominent Live Watchlist Strip or D3 Sector Performance Heatmap */}
      {!activeList || activeList.symbols.length === 0 ? (
        <div className="pt-3 text-xs text-slate-500 dark:text-slate-400">
          No tickers in this watchlist yet. Add any US, Bursa Malaysia (.KL, 4-digit code like 1155, or name like MAYBANK), ETF, or index symbol above to monitor live quotes and prioritize it in scans.
        </div>
      ) : panelMode === 'heatmap' ? (
        <div className="mt-3">
          <SectorPerformanceHeatmap
            watchlistName={activeList.name}
            data={heatmapData}
            isLoading={isLoadingHeatmap}
            isDark={isDark}
            selectedSymbol={selectedSymbol}
            onSelectSymbol={onSelectSymbol}
            onRefresh={onRefreshHeatmap}
            compact
          />
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-8">
          {activeList.symbols.map((sym) => {
            const scanned = scannedBySymbol[sym];
            const quote = quotesBySymbol[sym];
            const price = quote?.price ?? scanned?.price;
            const changePct = quote?.changePct ?? scanned?.changePct;
            const volume = quote?.volume ?? scanned?.volume;
            const exchange =
              quote?.exchange ??
              scanned?.exchange ??
              (sym.endsWith('.KL')
                ? 'Bursa MY'
                : sym.startsWith('^') || sym.startsWith('MYIDX:')
                ? 'Index'
                : 'Global');
            const pattern = scanned?.primaryPattern;
            const isSelected = selectedSymbol === sym;

            return (
              <div
                key={sym}
                className={`group relative flex flex-col justify-between rounded-md border p-2.5 transition-colors ${
                  isSelected
                    ? 'border-blue-600 bg-blue-50/50 dark:border-blue-500 dark:bg-blue-950/30'
                    : 'border-slate-200 bg-slate-50/50 hover:border-slate-300 hover:bg-white dark:border-slate-800 dark:bg-slate-950/50 dark:hover:border-slate-700 dark:hover:bg-slate-800/50'
                }`}
              >
                <div className="flex items-start justify-between gap-1">
                  <button
                    type="button"
                    onClick={() => onSelectSymbol(sym)}
                    className="text-left focus-visible:outline-2 focus-visible:outline-blue-600"
                  >
                    <div className="flex items-baseline gap-1.5">
                      <span className="font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">
                        {sym}
                      </span>
                      <span className="text-[10px] text-slate-400 dark:text-slate-500">
                        {exchange}
                      </span>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemoveSymbol(sym)}
                    aria-label={`Remove ${sym} from ${activeList.name}`}
                    className="rounded p-0.5 text-slate-400 opacity-70 hover:text-rose-600 hover:opacity-100 dark:hover:text-rose-400"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => onSelectSymbol(sym)}
                  className="mt-1.5 text-left focus-visible:outline-2 focus-visible:outline-blue-600"
                >
                  <div className="flex items-baseline justify-between gap-1 font-mono tabular-nums">
                    <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {price != null
                        ? (quote?.currency || scanned?.currency) === 'MYR' || sym.endsWith('.KL')
                          ? `RM ${price.toFixed(2)}`
                          : (quote?.currency || scanned?.currency) === 'PTS' ||
                            sym.startsWith('^') ||
                            sym.startsWith('MYIDX:')
                          ? price.toFixed(2)
                          : `$${price.toFixed(2)}`
                        : '—'}
                    </span>
                    {changePct != null && (
                      <span
                        className={`text-[11px] font-medium ${
                          changePct >= 0
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {changePct >= 0 ? '+' : ''}
                        {changePct.toFixed(2)}%
                      </span>
                    )}
                  </div>

                  <div className="mt-1 truncate text-[11px] text-slate-500 dark:text-slate-400">
                    {pattern
                      ? `${pattern.type}`
                      : volume != null
                      ? `Vol ${formatCompactVol(volume)}`
                      : 'Pending scan'}
                  </div>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
