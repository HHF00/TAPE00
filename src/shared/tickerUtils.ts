import type { TickerSearchSuggestion } from './types.ts';
import { US_TICKER_DIRECTORY } from './universes.ts';

const DIRECTORY_LIST = Object.values(US_TICKER_DIRECTORY);

export function sanitizeTickerInput(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9.:^-]/g, '');
}

/**
 * Synchronous normalization for obvious Bursa Malaysia numeric/warrant codes
 * and explicit market suffixes, without guessing ambiguous company names.
 */
export function normalizeQuickTicker(raw: string): string {
  const cleaned = sanitizeTickerInput(raw);
  if (!cleaned) return '';

  if (cleaned === 'KLCI' || cleaned === 'FBMKLCI' || cleaned === 'KLSE') {
    return '^KLSE';
  }
  if (cleaned.endsWith('.MY') || cleaned.endsWith('.KLS')) {
    return cleaned.replace(/\.(MY|KLS)$/, '.KL');
  }
  // Bursa Malaysia numeric stock codes (e.g. 1155, 0166, 0308) or warrant/pref codes (5235SS, 0166WA)
  if (/^\d{4,5}[A-Z]{0,2}$/.test(cleaned)) {
    return `${cleaned}.KL`;
  }
  if (US_TICKER_DIRECTORY[cleaned]) {
    return cleaned;
  }
  return cleaned;
}

export function getRegionForSymbol(symbol: string, exchange?: string): 'MY' | 'US' | 'GLOBAL' {
  if (symbol === '^KLSE' || symbol.endsWith('.KL') || symbol.startsWith('MYIDX:')) {
    return 'MY';
  }
  const ex = (exchange || '').toUpperCase();
  if (ex.includes('BURSA') || ex === 'KLS') return 'MY';
  if (
    ex.includes('NASDAQ') ||
    ex.includes('NYSE') ||
    ex.includes('CBOE') ||
    ex.includes('US ') ||
    ex === 'NMS' ||
    ex === 'NGM' ||
    ex === 'NCM' ||
    ex === 'NYQ' ||
    ex === 'PCX' ||
    ex === 'BTS' ||
    ex === 'ASE'
  ) {
    return 'US';
  }
  return symbol.includes('.') ? 'GLOBAL' : 'US';
}

export function searchDirectoryTickers(
  rawQuery: string,
  preferMarket?: 'MY' | 'US',
  limit = 8
): TickerSearchSuggestion[] {
  const qRaw = rawQuery.trim().toUpperCase();
  if (!qRaw) return [];

  const qNorm = normalizeQuickTicker(qRaw);
  const scored: Array<{ score: number; item: TickerSearchSuggestion }> = [];

  for (const meta of DIRECTORY_LIST) {
    const sym = meta.symbol.toUpperCase();
    const baseSym = sym.replace(/\.KL$/, '');
    const nameUp = meta.name.toUpperCase();
    const region = getRegionForSymbol(sym, meta.exchange);

    let score = 0;
    if (sym === qNorm || sym === qRaw || baseSym === qRaw) {
      score = 100;
    } else if (sym.startsWith(qRaw) || baseSym.startsWith(qRaw)) {
      score = 80;
    } else if (nameUp.startsWith(qRaw)) {
      score = 70;
    } else if (sym.includes(qRaw) || nameUp.includes(qRaw)) {
      score = 50;
    }

    if (score === 0) continue;
    if (preferMarket && region === preferMarket) score += 8;

    scored.push({
      score,
      item: {
        symbol: meta.symbol,
        name: meta.name,
        exchange: meta.exchange,
        type: meta.isIndex ? 'INDEX' : meta.isETF ? 'ETF' : 'EQUITY',
        region,
      },
    });
  }

  scored.sort((a, b) => b.score - a.score || a.item.symbol.localeCompare(b.item.symbol));
  return scored.slice(0, limit).map((s) => s.item);
}

export async function resolveTickerViaApi(
  rawQuery: string,
  preferMarket?: 'MY' | 'US'
): Promise<string> {
  const trimmed = rawQuery.trim();
  if (!trimmed) return '';

  const quick = normalizeQuickTicker(trimmed);
  if (
    quick.endsWith('.KL') ||
    quick.startsWith('^') ||
    quick.startsWith('MYIDX:') ||
    US_TICKER_DIRECTORY[quick]
  ) {
    return quick;
  }

  try {
    const params = new URLSearchParams({ q: trimmed });
    if (preferMarket) params.set('market', preferMarket);
    const resp = await fetch(`/api/resolve-ticker?${params.toString()}`);
    if (resp.ok) {
      const data = (await resp.json()) as { symbol?: string };
      if (data.symbol) return data.symbol;
    }
  } catch {
    // Fallback to quick normalized symbol
  }

  return quick;
}
