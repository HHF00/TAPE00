import { ArrowRight, Check, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { resolveTickerViaApi } from '../shared/tickerUtils.ts';
import type { LiveQuote, SectorHeatmapResponse, Watchlist } from '../shared/types.ts';
import { US_TICKER_DIRECTORY } from '../shared/universes.ts';
import { useTickerSearch } from '../shared/useTickerSearch.ts';
import { SectorPerformanceHeatmap } from './SectorPerformanceHeatmap.tsx';

interface WatchlistViewProps {
  watchlists: Watchlist[];
  activeWatchlistId: string;
  onSelectWatchlist: (id: string) => void;
  onCreateWatchlist: (name: string) => void;
  onRenameWatchlist: (id: string, name: string) => void;
  onDeleteWatchlist: (id: string) => void;
  onAddSymbol: (symbol: string) => void;
  onRemoveSymbol: (symbol: string) => void;
  onScanWatchlist: (id: string) => void;
  onInspectSymbol: (symbol: string) => void;
  quotesBySymbol: Record<string, LiveQuote>;
  heatmapData: SectorHeatmapResponse | null;
  isLoadingHeatmap: boolean;
  onRefreshHeatmap: () => void;
  isDark: boolean;
  marketHint?: 'MY' | 'US';
}

function formatVol(vol: number): string {
  if (vol >= 1_000_000_000) return `${(vol / 1_000_000_000).toFixed(2)}B`;
  if (vol >= 1_000_000) return `${(vol / 1_000_000).toFixed(2)}M`;
  if (vol >= 1_000) return `${(vol / 1_000).toFixed(1)}K`;
  return String(vol);
}

export function WatchlistView({
  watchlists,
  activeWatchlistId,
  onSelectWatchlist,
  onCreateWatchlist,
  onRenameWatchlist,
  onDeleteWatchlist,
  onAddSymbol,
  onRemoveSymbol,
  onScanWatchlist,
  onInspectSymbol,
  quotesBySymbol,
  heatmapData,
  isLoadingHeatmap,
  onRefreshHeatmap,
  isDark,
  marketHint,
}: WatchlistViewProps) {
  const [tickerInput, setTickerInput] = useState('');
  const [isAddingTicker, setIsAddingTicker] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [newListInput, setNewListInput] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
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
    const name = newListInput.trim();
    if (!name) return;
    onCreateWatchlist(name);
    setNewListInput('');
  };

  return (
    <section className="mx-auto max-w-[1200px] px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-6 dark:border-slate-800">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Personalized Market Watchlists
          </h1>
          <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
            Create custom watchlists for US, Bursa Malaysia (.KL, 4-digit codes, or stock names), ETF, and index tickers. Active watchlist symbols are prioritized first in every pattern scan.
          </p>
        </div>

        {activeList && (
          <button
            type="button"
            onClick={() => onScanWatchlist(activeList.id)}
            disabled={activeList.symbols.length === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-50 dark:bg-blue-600 dark:hover:bg-blue-500 whitespace-nowrap"
          >
            <span>Scan &ldquo;{activeList.name}&rdquo;</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left: Manage Named Watchlists */}
        <div className="lg:col-span-4 space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
              Your Lists
            </h2>

            <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
              {watchlists.map((wl) => {
                const isActive = wl.id === activeList?.id;
                const isEditing = editingId === wl.id;
                return (
                  <div
                    key={wl.id}
                    className={`flex items-center justify-between gap-2 py-2.5 ${
                      isActive ? 'text-blue-600 dark:text-blue-400' : 'text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {isEditing ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (editingName.trim()) onRenameWatchlist(wl.id, editingName.trim());
                          setEditingId(null);
                        }}
                        className="flex flex-1 items-center gap-1.5"
                      >
                        <input
                          type="text"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          className="w-full rounded border border-slate-300 px-2 py-1 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                          autoFocus
                        />
                        <button type="submit" aria-label="Save list name" className="text-emerald-600">
                          <Check className="h-3.5 w-3.5" />
                        </button>
                      </form>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onSelectWatchlist(wl.id)}
                        className="flex-1 text-left text-xs font-medium"
                      >
                        <span className={isActive ? 'font-semibold' : ''}>{wl.name}</span>
                        <span className="ml-2 font-mono text-[11px] text-slate-400">
                          {wl.symbols.length}
                        </span>
                      </button>
                    )}

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(wl.id);
                          setEditingName(wl.name);
                        }}
                        aria-label={`Rename ${wl.name}`}
                        className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      {watchlists.length > 1 && (
                        <button
                          type="button"
                          onClick={() => onDeleteWatchlist(wl.id)}
                          aria-label={`Delete ${wl.name}`}
                          className="p-1 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <form onSubmit={handleCreateList} className="mt-4 flex gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
              <input
                type="text"
                value={newListInput}
                onChange={(e) => setNewListInput(e.target.value)}
                placeholder="New watchlist name..."
                aria-label="New watchlist name"
                className="flex-1 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
              <button
                type="submit"
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Create</span>
              </button>
            </form>
          </div>
        </div>

        {/* Right: Tickers in Active Watchlist */}
        <div className="lg:col-span-8">
          <div ref={addBoxRef} className="relative mb-4">
            <form onSubmit={handleAddTicker} className="flex gap-2">
              <input
                type="text"
                value={tickerInput}
                onFocus={() => setShowSuggestions(true)}
                onChange={(e) => {
                  setTickerInput(e.target.value);
                  setShowSuggestions(true);
                }}
                placeholder={`Add any ticker to ${activeList?.name || 'watchlist'} (e.g. PLTR, 1155.KL, 0166, MAYBANK, SPY)`}
                aria-label="Add any ticker symbol"
                className="flex-1 rounded-lg border border-slate-200 bg-white px-3.5 py-2 font-mono text-sm uppercase text-slate-900 placeholder:normal-case placeholder:font-sans placeholder:text-slate-400 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
              <button
                type="submit"
                disabled={isAddingTicker}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700 whitespace-nowrap"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>{isAddingTicker ? 'Adding...' : 'Add Ticker'}</span>
              </button>
            </form>

            {showSuggestions && tickerInput.trim().length > 0 && (suggestions.length > 0 || isSearching) && (
              <div className="absolute left-0 top-full z-30 mt-1 w-full max-w-md overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
                {suggestions.map((s) => (
                  <button
                    key={s.symbol}
                    type="button"
                    onClick={() => commitTickerSymbol(s.symbol)}
                    className="flex w-full items-center justify-between gap-3 border-b border-slate-100 px-3.5 py-2 text-left text-xs hover:bg-slate-50 last:border-b-0 dark:border-slate-800 dark:hover:bg-slate-800"
                  >
                    <div className="min-w-0">
                      <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                        {s.symbol}
                      </span>
                      <span className="ml-2 truncate text-slate-500 dark:text-slate-400">
                        {s.name}
                      </span>
                    </div>
                    <span className="shrink-0 font-mono text-[10px] text-slate-400 dark:text-slate-500">
                      {s.exchange}
                    </span>
                  </button>
                ))}
                {isSearching && suggestions.length === 0 && (
                  <div className="px-3.5 py-2 text-xs text-slate-400">
                    Searching Bursa Malaysia &amp; global tickers...
                  </div>
                )}
              </div>
            )}
          </div>

          {!activeList || activeList.symbols.length === 0 ? (
            <div className="rounded-lg border border-slate-200 bg-white p-10 text-center dark:border-slate-800 dark:bg-slate-900">
              <p className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                This watchlist has no tickers
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Add any US, Bursa Malaysia (.KL, 4-digit code, or company name), ETF, or index symbol above or star rows inside the Scanner table.
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                    <th className="py-2.5 pl-4 pr-3">Ticker</th>
                    <th className="py-2.5 px-3">Exchange</th>
                    <th className="py-2.5 px-3 text-right">Live Price</th>
                    <th className="py-2.5 px-3 text-right">Day Chg</th>
                    <th className="py-2.5 px-3 text-right">Volume</th>
                    <th className="py-2.5 pl-3 pr-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {activeList.symbols.map((sym) => {
                    const meta = US_TICKER_DIRECTORY[sym];
                    const quote = quotesBySymbol[sym];
                    return (
                      <tr key={sym} className="h-11 hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="py-2 pl-4 pr-3">
                          <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                            {sym}
                          </span>
                          <span className="ml-2 text-slate-500 dark:text-slate-400">
                            {quote?.name ||
                              meta?.name ||
                              (sym.endsWith('.KL')
                                ? 'Bursa MY Equity'
                                : sym.startsWith('^') || sym.startsWith('MYIDX:')
                                ? 'Market Index'
                                : 'Equity')}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-slate-500 dark:text-slate-400">
                          {quote?.exchange ||
                            meta?.exchange ||
                            (sym.endsWith('.KL')
                              ? 'Bursa MY'
                              : sym.startsWith('^') || sym.startsWith('MYIDX:')
                              ? 'Index'
                              : 'Global')}
                        </td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums font-medium text-slate-900 dark:text-slate-100">
                          {quote
                            ? quote.currency === 'MYR' || sym.endsWith('.KL')
                              ? `RM ${quote.price.toFixed(2)}`
                              : quote.currency === 'PTS' || sym.startsWith('^') || sym.startsWith('MYIDX:')
                              ? quote.price.toFixed(2)
                              : `$${quote.price.toFixed(2)}`
                            : '—'}
                        </td>
                        <td
                          className={`py-2 px-3 text-right font-mono tabular-nums ${
                            !quote
                              ? 'text-slate-400'
                              : quote.changePct >= 0
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          {quote ? `${quote.changePct >= 0 ? '+' : ''}${quote.changePct.toFixed(2)}%` : '—'}
                        </td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                          {quote ? formatVol(quote.volume) : '—'}
                        </td>
                        <td className="py-2 pl-3 pr-4 text-right">
                          <div className="inline-flex items-center gap-3">
                            <button
                              type="button"
                              onClick={() => onInspectSymbol(sym)}
                              className="font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                            >
                              Inspect Chart
                            </button>
                            <button
                              type="button"
                              onClick={() => onRemoveSymbol(sym)}
                              aria-label={`Remove ${sym}`}
                              className="text-slate-400 hover:text-rose-600 dark:hover:text-rose-400"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Prominent D3 Sector Performance Heatmap */}
      <div className="mt-6 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4 border-b border-slate-100 pb-3 dark:border-slate-800">
          <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
            Sector-Relative Performance Heatmap &mdash; {activeList?.name || 'Watchlist'}
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            D3 treemap comparing each watchlist stock&rsquo;s return against its corresponding US sector ETF or Bursa Malaysia (^KLSE) benchmark.
          </p>
        </div>

        <SectorPerformanceHeatmap
          watchlistName={activeList?.name || 'Watchlist'}
          data={heatmapData}
          isLoading={isLoadingHeatmap}
          isDark={isDark}
          onSelectSymbol={onInspectSymbol}
          onRefresh={onRefreshHeatmap}
        />
      </div>
    </section>
  );
}
