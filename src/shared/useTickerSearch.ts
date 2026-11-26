import { useEffect, useState } from 'react';
import { searchDirectoryTickers } from './tickerUtils.ts';
import type { TickerSearchSuggestion } from './types.ts';

export function useTickerSearch(query: string, marketHint?: 'MY' | 'US') {
  const trimmed = query.trim();
  const [remoteSuggestions, setRemoteSuggestions] = useState<TickerSearchSuggestion[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const localSuggestions = trimmed ? searchDirectoryTickers(trimmed, marketHint, 6) : [];

  useEffect(() => {
    if (trimmed.length < 2) {
      setRemoteSuggestions([]);
      setIsSearching(false);
      return;
    }

    const controller = new AbortController();
    setIsSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: trimmed });
        if (marketHint) params.set('market', marketHint);
        const resp = await fetch(`/api/search-tickers?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!resp.ok) return;
        const data = (await resp.json()) as { suggestions?: TickerSearchSuggestion[] };
        if (data.suggestions) {
          setRemoteSuggestions(data.suggestions);
        }
      } catch {
        // Ignore aborts / transient search errors
      } finally {
        setIsSearching(false);
      }
    }, 180);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [trimmed, marketHint]);

  const combined: TickerSearchSuggestion[] = [];
  const seen = new Set<string>();
  for (const item of [...localSuggestions, ...remoteSuggestions]) {
    if (seen.has(item.symbol)) continue;
    seen.add(item.symbol);
    combined.push(item);
    if (combined.length >= 8) break;
  }

  return {
    suggestions: combined,
    isSearching,
  };
}
