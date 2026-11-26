import type {
  CorporateEvent,
  LiveQuote,
  MtfTimeframeCell,
  MultiTimeframeSummary,
  NewsItem,
  ScannedTicker,
  SeasonalityAnalysis,
  SectorBenchmarkSummary,
  SectorHeatmapEntry,
  SectorHeatmapResponse,
  ShortInterest,
  TickerDetailResponse,
  TickerSearchSuggestion,
  Timeframe,
} from '../src/shared/types.ts';
import {
  getRegionForSymbol,
  normalizeQuickTicker,
  sanitizeTickerInput,
  searchDirectoryTickers,
} from '../src/shared/tickerUtils.ts';
import {
  isKnownEtfSymbol,
  isKnownIndexSymbol,
  MY_COMPOSITE_INDICES,
  US_TICKER_DIRECTORY,
} from '../src/shared/universes.ts';
import {
  computeSeasonalityAnalysis,
  computeVolatilityAnalysis,
  computeVolumeAnalysis,
  detectChartPatterns,
  detectHistoricalPatterns,
  enrichBarsWithIndicators,
  type OptionsIvSnapshot,
} from './patternEngine.ts';

interface CachedEntry {
  expiresAt: number;
  hasHistory: boolean;
  detail: TickerDetailResponse;
}

interface ShortCacheEntry {
  expiresAt: number;
  data: ShortInterest | null;
}

interface NewsCacheEntry {
  expiresAt: number;
  items: NewsItem[];
}

interface PerfSnapshot {
  symbol: string;
  name: string;
  exchange: string;
  price: number;
  volume: number;
  perf1dPct: number;
  perf5dPct: number;
  perf1mPct: number;
  expiresAt: number;
}

interface SectorBenchmarkInfo {
  sector: string;
  benchmarkSymbol: string;
  benchmarkName: string;
}

interface RawBarItem {
  time: number;
  dateLabel: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface RawChartEventItem {
  type: 'Dividend' | 'Split';
  timestamp: number;
  detail: string;
}

interface RawOhlcvCacheEntry {
  expiresAt: number;
  bars: RawBarItem[];
  rawEvents?: RawChartEventItem[];
  meta: {
    shortName?: string;
    longName?: string;
    fullExchangeName?: string;
    exchangeName?: string;
    marketState?: string;
    currency?: string;
    instrumentType?: string;
    regularMarketPrice?: number;
    regularMarketDayHigh?: number;
    regularMarketDayLow?: number;
    regularMarketVolume?: number;
  };
}

const CACHE_TTL_MS = 60 * 1000;
const SHORT_CACHE_TTL_MS = 15 * 60 * 1000;
const NEWS_CACHE_TTL_MS = 5 * 60 * 1000;
const SECTOR_META_TTL_MS = 24 * 60 * 60 * 1000;
const SEASONALITY_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CALENDAR_EVENTS_TTL_MS = 60 * 60 * 1000;
const tickerCache = new Map<string, CachedEntry>();
const rawOhlcvCache = new Map<string, RawOhlcvCacheEntry>();
const rawOhlcvInFlight = new Map<string, Promise<RawOhlcvCacheEntry>>();
const shortInterestCache = new Map<string, ShortCacheEntry>();
const newsCache = new Map<string, NewsCacheEntry>();
const perfCache = new Map<string, PerfSnapshot>();
const sectorMetaCache = new Map<string, { info: SectorBenchmarkInfo; expiresAt: number }>();
const tickerSearchCache = new Map<string, { expiresAt: number; items: TickerSearchSuggestion[] }>();
const ivCache = new Map<string, { expiresAt: number; data: OptionsIvSnapshot | null }>();
const seasonalityCache = new Map<string, { expiresAt: number; data: SeasonalityAnalysis | undefined }>();
const calendarEventsCache = new Map<string, { expiresAt: number; events: CorporateEvent[] }>();
const IV_CACHE_TTL_MS = 15 * 60 * 1000;

let yahooAuth: { cookie: string; crumb: string; expiresAt: number } | null = null;
let yahooAuthPending: Promise<{ cookie: string; crumb: string } | null> | null = null;

async function getYahooAuth(force = false): Promise<{ cookie: string; crumb: string } | null> {
  if (!force && yahooAuth && yahooAuth.expiresAt > Date.now()) {
    return { cookie: yahooAuth.cookie, crumb: yahooAuth.crumb };
  }
  if (yahooAuthPending) return yahooAuthPending;

  yahooAuthPending = (async () => {
    try {
      const cResp = await fetch('https://fc.yahoo.com', {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TapeScopeScanner/1.0)' },
      });
      const setCookie = cResp.headers.get('set-cookie');
      const cookie = setCookie ? setCookie.split(';')[0] : '';
      if (!cookie) return null;

      const crumbResp = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; TapeScopeScanner/1.0)',
          Cookie: cookie,
        },
      });
      if (!crumbResp.ok) return null;
      const crumb = (await crumbResp.text()).trim();
      if (!crumb) return null;

      yahooAuth = { cookie, crumb, expiresAt: Date.now() + 20 * 60 * 1000 };
      return { cookie, crumb };
    } catch {
      return null;
    } finally {
      yahooAuthPending = null;
    }
  })();

  return yahooAuthPending;
}

async function fetchShortInterest(symbol: string): Promise<ShortInterest | null> {
  const cached = shortInterestCache.get(symbol);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  try {
    let auth = await getYahooAuth(false);
    if (!auth) return null;

    const queryOnce = async (a: { cookie: string; crumb: string }) => {
      const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(
        symbol
      )}?modules=defaultKeyStatistics&crumb=${encodeURIComponent(a.crumb)}`;
      return fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; TapeScopeScanner/1.0)',
          Cookie: a.cookie,
          Accept: 'application/json',
        },
      });
    };

    let resp = await queryOnce(auth);
    if (resp.status === 401) {
      auth = await getYahooAuth(true);
      if (!auth) return null;
      resp = await queryOnce(auth);
    }

    if (!resp.ok) {
      shortInterestCache.set(symbol, { expiresAt: Date.now() + 5 * 60 * 1000, data: null });
      return null;
    }

    const json = (await resp.json()) as {
      quoteSummary?: {
        result?: Array<{
          defaultKeyStatistics?: {
            shortPercentOfFloat?: { raw?: number };
            shortRatio?: { raw?: number };
            sharesShort?: { raw?: number };
            sharesShortPriorMonth?: { raw?: number };
            floatShares?: { raw?: number };
            dateShortInterest?: { raw?: number };
          };
        }>;
      };
    };

    const ks = json.quoteSummary?.result?.[0]?.defaultKeyStatistics;
    if (!ks) {
      shortInterestCache.set(symbol, { expiresAt: Date.now() + SHORT_CACHE_TTL_MS, data: null });
      return null;
    }

    const spf =
      ks.shortPercentOfFloat?.raw != null
        ? Math.round(ks.shortPercentOfFloat.raw * 10000) / 100
        : null;
    const shortRatio = ks.shortRatio?.raw != null ? Math.round(ks.shortRatio.raw * 100) / 100 : null;
    const sharesShort = ks.sharesShort?.raw ?? null;
    const sharesShortPriorMonth = ks.sharesShortPriorMonth?.raw ?? null;
    const floatShares = ks.floatShares?.raw ?? null;

    if (spf == null && shortRatio == null && sharesShort == null) {
      shortInterestCache.set(symbol, { expiresAt: Date.now() + SHORT_CACHE_TTL_MS, data: null });
      return null;
    }

    const shortChangeMoMPct =
      sharesShort != null && sharesShortPriorMonth != null && sharesShortPriorMonth > 0
        ? Math.round(((sharesShort - sharesShortPriorMonth) / sharesShortPriorMonth) * 10000) / 100
        : null;

    const settlementDate =
      ks.dateShortInterest?.raw != null
        ? new Date(ks.dateShortInterest.raw * 1000).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            timeZone: 'America/New_York',
          })
        : null;

    const data: ShortInterest = {
      shortPercentOfFloat: spf,
      shortRatio,
      sharesShort,
      sharesShortPriorMonth,
      shortChangeMoMPct,
      floatShares,
      settlementDate,
    };

    shortInterestCache.set(symbol, { expiresAt: Date.now() + SHORT_CACHE_TTL_MS, data });
    return data;
  } catch {
    return null;
  }
}

interface YahooOptionContract {
  strike?: number;
  impliedVolatility?: number;
}

interface YahooOptionsChainPayload {
  optionChain?: {
    result?: Array<{
      expirationDates?: number[];
      quote?: { regularMarketPrice?: number };
      options?: Array<{
        expirationDate?: number;
        calls?: YahooOptionContract[];
        puts?: YahooOptionContract[];
      }>;
    }>;
  };
}

async function fetchOptionsImpliedVolatility(
  symbol: string,
  isIndex: boolean
): Promise<OptionsIvSnapshot | null> {
  if (isIndex || symbol.endsWith('.KL') || symbol.startsWith('MYIDX:') || symbol.startsWith('^')) {
    return null;
  }

  const cached = ivCache.get(symbol);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  try {
    let auth = await getYahooAuth(false);
    if (!auth) return null;

    const queryChain = async (a: { cookie: string; crumb: string }, expDate?: number) => {
      const dateParam = expDate ? `&date=${expDate}` : '';
      const url = `https://query1.finance.yahoo.com/v7/finance/options/${encodeURIComponent(
        symbol
      )}?crumb=${encodeURIComponent(a.crumb)}${dateParam}`;
      return fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; TapeScopeScanner/1.0)',
          Cookie: a.cookie,
          Accept: 'application/json',
        },
      });
    };

    let resp = await queryChain(auth);
    if (resp.status === 401) {
      auth = await getYahooAuth(true);
      if (!auth) return null;
      resp = await queryChain(auth);
    }
    if (!resp.ok) {
      ivCache.set(symbol, { expiresAt: Date.now() + 5 * 60 * 1000, data: null });
      return null;
    }

    let json = (await resp.json()) as YahooOptionsChainPayload;
    let chain = json.optionChain?.result?.[0];
    if (!chain || !chain.options || chain.options.length === 0) {
      ivCache.set(symbol, { expiresAt: Date.now() + IV_CACHE_TTL_MS, data: null });
      return null;
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const expDates = chain.expirationDates || [];
    const currentExp = chain.options[0]?.expirationDate || expDates[0];
    const currentDte = currentExp ? (currentExp - nowSec) / 86400 : 0;

    // If front expiration is < 7 DTE, prefer a ~21-35 DTE monthly/weekly chain for clean 30D IV
    if (currentDte < 7 && expDates.length > 1) {
      let bestExp: number | null = null;
      let bestDist = Infinity;
      for (const exp of expDates) {
        const dte = (exp - nowSec) / 86400;
        if (dte >= 10 && dte <= 50) {
          const dist = Math.abs(dte - 28);
          if (dist < bestDist) {
            bestDist = dist;
            bestExp = exp;
          }
        }
      }
      if (bestExp && bestExp !== currentExp) {
        const nextResp = await queryChain(auth, bestExp);
        if (nextResp.ok) {
          const nextJson = (await nextResp.json()) as YahooOptionsChainPayload;
          const nextChain = nextJson.optionChain?.result?.[0];
          if (nextChain?.options?.[0]) {
            json = nextJson;
            chain = nextChain;
          }
        }
      }
    }

    const optSlice = chain.options?.[0];
    const spot = chain.quote?.regularMarketPrice;
    if (!optSlice || !spot || spot <= 0) {
      ivCache.set(symbol, { expiresAt: Date.now() + IV_CACHE_TTL_MS, data: null });
      return null;
    }

    const pickNearestIv = (contracts: YahooOptionContract[] | undefined): number[] => {
      if (!contracts || contracts.length === 0) return [];
      return contracts
        .filter(
          (c): c is { strike: number; impliedVolatility: number } =>
            typeof c.strike === 'number' &&
            Number.isFinite(c.strike) &&
            typeof c.impliedVolatility === 'number' &&
            Number.isFinite(c.impliedVolatility) &&
            c.impliedVolatility > 0.01 &&
            c.impliedVolatility < 5.0
        )
        .sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot))
        .slice(0, 2)
        .map((c) => c.impliedVolatility * 100);
    };

    const callIvs = pickNearestIv(optSlice.calls);
    const putIvs = pickNearestIv(optSlice.puts);
    const allAtmIvs = [...callIvs, ...putIvs];
    if (allAtmIvs.length === 0) {
      ivCache.set(symbol, { expiresAt: Date.now() + IV_CACHE_TTL_MS, data: null });
      return null;
    }

    const avg = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;
    const atmIvPct = Math.round(avg(allAtmIvs) * 100) / 100;
    const atmCallIvPct = callIvs.length > 0 ? Math.round(avg(callIvs) * 100) / 100 : null;
    const atmPutIvPct = putIvs.length > 0 ? Math.round(avg(putIvs) * 100) / 100 : null;
    const skewPct =
      atmPutIvPct != null && atmCallIvPct != null
        ? Math.round((atmPutIvPct - atmCallIvPct) * 100) / 100
        : null;

    const expTs = optSlice.expirationDate;
    const expiryLabel = expTs
      ? `${new Date(expTs * 1000).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          timeZone: 'UTC',
        })} (${Math.max(1, Math.round((expTs - nowSec) / 86400))}D)`
      : null;

    const data: OptionsIvSnapshot = {
      atmIvPct,
      atmCallIvPct,
      atmPutIvPct,
      skewPct,
      expiryLabel,
    };

    ivCache.set(symbol, { expiresAt: Date.now() + IV_CACHE_TTL_MS, data });
    return data;
  } catch {
    return null;
  }
}

function formatDateLabel(unixSec: number, timeframe: Timeframe): string {
  const d = new Date(unixSec * 1000);
  if (timeframe === '1m' || timeframe === '15m' || timeframe === '1h' || timeframe === '4h') {
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'America/New_York',
    });
  }
  if (timeframe === '1mo') {
    return d.toLocaleDateString('en-US', {
      month: 'short',
      year: '2-digit',
      timeZone: 'America/New_York',
    });
  }
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: '2-digit',
    timeZone: 'America/New_York',
  });
}

function getYahooParams(timeframe: Timeframe): { range: string; interval: string } {
  switch (timeframe) {
    case '1m':
      return { range: '2d', interval: '1m' };
    case '15m':
      return { range: '1mo', interval: '15m' };
    case '1h':
      return { range: '3mo', interval: '1h' };
    case '4h':
      return { range: '6mo', interval: '4h' };
    case '1mo':
      return { range: '10y', interval: '1mo' };
    case '1wk':
      return { range: '3y', interval: '1wk' };
    case '1d':
    default:
      return { range: '2y', interval: '1d' };
  }
}

export async function fetchTickerNews(rawSymbol: string, count = 8): Promise<NewsItem[]> {
  const symbol = rawSymbol.trim().toUpperCase().replace(/[^A-Z0-9.:^-]/g, '');
  if (!symbol) return [];

  const cached = newsCache.get(symbol);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.items.slice(0, count);
  }

  try {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(
      symbol
    )}&quotesCount=0&newsCount=${Math.max(8, count)}`;
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TapeScopeScanner/1.0)',
        Accept: 'application/json',
      },
    });
    if (!resp.ok) return [];

    const json = (await resp.json()) as {
      news?: Array<{
        uuid?: string;
        title?: string;
        publisher?: string;
        link?: string;
        providerPublishTime?: number;
        relatedTickers?: string[];
      }>;
    };

    const items: NewsItem[] = (json.news || [])
      .filter((n) => Boolean(n.title && n.link))
      .map((n, idx) => {
        const ts = n.providerPublishTime ?? Math.floor(Date.now() / 1000);
        return {
          id: n.uuid || `${symbol}-${idx}-${ts}`,
          title: n.title!.trim(),
          publisher: (n.publisher || 'Market Wire').trim(),
          link: n.link!,
          publishedTimestamp: ts,
          publishedAt: new Date(ts * 1000).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
            timeZone: 'America/New_York',
          }),
          relatedTickers: (n.relatedTickers || []).slice(0, 4),
        };
      });

    newsCache.set(symbol, {
      expiresAt: Date.now() + NEWS_CACHE_TTL_MS,
      items,
    });

    return items.slice(0, count);
  } catch {
    return [];
  }
}

export async function fetchMarketNewsflow(symbols: string[], limit = 16): Promise<NewsItem[]> {
  const clean = Array.from(
    new Set(
      symbols
        .map((s) => s.trim().toUpperCase().replace(/[^A-Z0-9.:^-]/g, ''))
        .map((s) => (s.startsWith('MYIDX:') ? '^KLSE' : s))
        .filter(Boolean)
    )
  ).slice(0, 8);

  if (clean.length === 0) clean.push('SPY', 'QQQ');

  const settled = await Promise.allSettled(clean.map((sym) => fetchTickerNews(sym, 4)));
  const seen = new Set<string>();
  const combined: NewsItem[] = [];

  for (const outcome of settled) {
    if (outcome.status !== 'fulfilled') continue;
    for (const item of outcome.value) {
      const key = item.title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      combined.push(item);
    }
  }

  combined.sort((a, b) => b.publishedTimestamp - a.publishedTimestamp);
  return combined.slice(0, limit);
}

function normalizeExchange(rawExchange?: string, fullExchange?: string, symbol?: string): string {
  const known = symbol ? US_TICKER_DIRECTORY[symbol] : undefined;
  if (known) return known.exchange;
  if (symbol?.startsWith('MYIDX:')) return 'Bursa MY Index';
  if (symbol === '^KLSE') return 'Bursa MY Index';
  if (symbol?.endsWith('.KL')) return 'Bursa MY';
  if (symbol?.startsWith('^')) return 'US Index';

  const combined = `${rawExchange || ''} ${fullExchange || ''}`.toLowerCase();
  if (combined.includes('kuala lumpur') || combined.includes('bursa') || rawExchange === 'KLS') {
    return 'Bursa MY';
  }
  if (combined.includes('nasdaq') || rawExchange === 'NMS' || rawExchange === 'NGM' || rawExchange === 'NCM') {
    return 'NASDAQ';
  }
  if (combined.includes('arca') || rawExchange === 'PCX') {
    return 'NYSE Arca';
  }
  if (combined.includes('nyse') || rawExchange === 'NYQ') {
    return 'NYSE';
  }
  if (combined.includes('bats') || rawExchange === 'BTS') {
    return 'Cboe BZX';
  }
  return fullExchange || rawExchange || 'US';
}

async function fetchYahooRawOhlcv(
  symbol: string,
  timeframe: Timeframe,
  forceRefresh = false
): Promise<RawOhlcvCacheEntry> {
  const cacheKey = `${symbol}:${timeframe}`;
  const cached = rawOhlcvCache.get(cacheKey);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
    return cached;
  }

  if (!forceRefresh) {
    const existingPromise = rawOhlcvInFlight.get(cacheKey);
    if (existingPromise) return existingPromise;
  }

  const promise = (async () => {
    const { range, interval } = getYahooParams(timeframe);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      symbol
    )}?range=${range}&interval=${interval}&includePrePost=false&events=div%2Csplit`;

    let response: Response | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; TapeScopeScanner/1.0)',
            Accept: 'application/json',
          },
        });
        if (response.ok || (response.status !== 429 && response.status < 500)) {
          break;
        }
      } catch (err) {
        if (attempt === 1) throw err;
      }
      await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
    }

    if (!response || !response.ok) {
      throw new Error(`Market data request failed for ${symbol} (${response?.status ?? 'network'})`);
    }

    const json = (await response.json()) as {
    chart?: {
      result?: Array<{
        meta?: RawOhlcvCacheEntry['meta'];
        timestamp?: number[];
        events?: {
          dividends?: Record<string, { amount?: number; date?: number }>;
          splits?: Record<string, { date?: number; numerator?: number; denominator?: number; splitRatio?: string }>;
        };
        indicators?: {
          quote?: Array<{
            open?: Array<number | null>;
            high?: Array<number | null>;
            low?: Array<number | null>;
            close?: Array<number | null>;
            volume?: Array<number | null>;
          }>;
        };
      }>;
      error?: { description?: string };
    };
  };

  if (json.chart?.error) {
    throw new Error(json.chart.error.description || `Ticker ${symbol} not found`);
  }

  const result = json.chart?.result?.[0];
  if (!result || !result.timestamp || !result.indicators?.quote?.[0]) {
    throw new Error(`No OHLCV data returned for ${symbol}`);
  }

  const meta = result.meta || {};
  const timestamps = result.timestamp;
  const quote = result.indicators.quote[0];
  const opens = quote.open || [];
  const highs = quote.high || [];
  const lows = quote.low || [];
  const closes = quote.close || [];
  const volumes = quote.volume || [];

  const rawBars: RawBarItem[] = [];
  const isIntraday =
    timeframe === '1m' || timeframe === '15m' || timeframe === '1h' || timeframe === '4h';

  for (let i = 0; i < timestamps.length; i++) {
    const o = opens[i];
    const h = highs[i];
    const l = lows[i];
    const c = closes[i];
    const v = volumes[i];
    if (
      o == null ||
      h == null ||
      l == null ||
      c == null ||
      !Number.isFinite(o) ||
      !Number.isFinite(h) ||
      !Number.isFinite(l) ||
      !Number.isFinite(c) ||
      c <= 0
    ) {
      continue;
    }
    if (isIntraday && (v == null || v === 0) && o === h && h === l && l === c) {
      continue;
    }
    rawBars.push({
      time: timestamps[i],
      dateLabel: formatDateLabel(timestamps[i], timeframe),
      open: o,
      high: h,
      low: l,
      close: c,
      volume: v != null && Number.isFinite(v) ? v : 0,
    });
  }

  const maxBars = timeframe === '1d' ? 450 : 320;
  const trimmedBars = rawBars.length > maxBars ? rawBars.slice(-maxBars) : rawBars;

  const rawEvents: RawChartEventItem[] = [];
  if (result.events?.dividends) {
    for (const d of Object.values(result.events.dividends)) {
      if (d?.date && Number.isFinite(d.date)) {
        rawEvents.push({
          type: 'Dividend',
          timestamp: d.date,
          detail: d.amount != null ? `Ex-Div ${d.amount.toFixed(2)}` : 'Ex-Dividend',
        });
      }
    }
  }
  if (result.events?.splits) {
    for (const sp of Object.values(result.events.splits)) {
      if (sp?.date && Number.isFinite(sp.date)) {
        const ratio =
          sp.splitRatio ||
          (sp.numerator && sp.denominator ? `${sp.numerator}:${sp.denominator}` : 'Split');
        rawEvents.push({
          type: 'Split',
          timestamp: sp.date,
          detail: `Split ${ratio}`,
        });
      }
    }
  }

    const entry: RawOhlcvCacheEntry = {
      expiresAt: Date.now() + CACHE_TTL_MS,
      bars: trimmedBars,
      rawEvents,
      meta,
    };
    rawOhlcvCache.set(cacheKey, entry);
    return entry;
  })();

  rawOhlcvInFlight.set(cacheKey, promise);
  try {
    return await promise;
  } finally {
    rawOhlcvInFlight.delete(cacheKey);
  }
}

async function buildCompositeIndexOhlcv(
  symbol: string,
  timeframe: Timeframe,
  forceRefresh = false
): Promise<RawOhlcvCacheEntry> {
  const def = MY_COMPOSITE_INDICES[symbol];
  if (!def) {
    throw new Error(`Unknown composite index ${symbol}`);
  }

  const settled = await Promise.allSettled(
    def.constituents.map((c) => fetchYahooRawOhlcv(c, timeframe, forceRefresh))
  );

  const memberSeries = settled
    .filter((s): s is PromiseFulfilledResult<RawOhlcvCacheEntry> => s.status === 'fulfilled')
    .map((s) => s.value)
    .filter((entry) => entry.bars.length >= 25);

  if (memberSeries.length === 0) {
    throw new Error(`Insufficient constituent bars for ${symbol}`);
  }

  const bucket = new Map<
    number,
    { dateLabel: string; oSum: number; hSum: number; lSum: number; cSum: number; vSum: number; count: number }
  >();

  for (const series of memberSeries) {
    const baseClose = series.bars[0].close;
    if (baseClose <= 0) continue;
    const scale = 1000 / baseClose;

    for (const bar of series.bars) {
      const existing = bucket.get(bar.time);
      const o = bar.open * scale;
      const h = bar.high * scale;
      const l = bar.low * scale;
      const c = bar.close * scale;
      if (existing) {
        existing.oSum += o;
        existing.hSum += h;
        existing.lSum += l;
        existing.cSum += c;
        existing.vSum += bar.volume;
        existing.count += 1;
      } else {
        bucket.set(bar.time, {
          dateLabel: bar.dateLabel,
          oSum: o,
          hSum: h,
          lSum: l,
          cSum: c,
          vSum: bar.volume,
          count: 1,
        });
      }
    }
  }

  const minMembers = Math.max(1, Math.floor(memberSeries.length * 0.5));
  const sortedTimes = Array.from(bucket.keys()).sort((a, b) => a - b);
  const aggregated: RawBarItem[] = [];

  for (const t of sortedTimes) {
    const b = bucket.get(t)!;
    if (b.count < minMembers) continue;
    const open = b.oSum / b.count;
    const close = b.cSum / b.count;
    const high = Math.max(b.hSum / b.count, open, close);
    const low = Math.min(b.lSum / b.count, open, close);
    aggregated.push({
      time: t,
      dateLabel: b.dateLabel,
      open,
      high,
      low,
      close,
      volume: b.vSum,
    });
  }

  const last = aggregated[aggregated.length - 1];
  const latestState = memberSeries.find((s) => s.meta.marketState)?.meta.marketState || 'CLOSED';

  return {
    expiresAt: Date.now() + CACHE_TTL_MS,
    bars: aggregated,
    meta: {
      shortName: def.name,
      fullExchangeName: def.exchange,
      exchangeName: 'KLS',
      marketState: latestState,
      currency: 'PTS',
      instrumentType: 'INDEX',
      regularMarketPrice: last?.close,
      regularMarketDayHigh: last?.high,
      regularMarketDayLow: last?.low,
      regularMarketVolume: last?.volume,
    },
  };
}

function formatEventDate(tsSec: number): string {
  return new Date(tsSec * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: '2-digit',
    timeZone: 'America/New_York',
  });
}

async function fetchCalendarEvents(symbol: string, isIndex: boolean): Promise<CorporateEvent[]> {
  if (isIndex || symbol.startsWith('^') || symbol.startsWith('MYIDX:')) {
    return [];
  }

  const cached = calendarEventsCache.get(symbol);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.events;
  }

  try {
    let auth = await getYahooAuth(false);
    if (!auth) return [];

    const queryCal = async (a: { cookie: string; crumb: string }) =>
      fetch(
        `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(
          symbol
        )}?modules=calendarEvents&crumb=${encodeURIComponent(a.crumb)}`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; TapeScopeScanner/1.0)',
            Cookie: a.cookie,
            Accept: 'application/json',
          },
        }
      );

    let resp = await queryCal(auth);
    if (resp.status === 401) {
      auth = await getYahooAuth(true);
      if (!auth) return [];
      resp = await queryCal(auth);
    }
    if (!resp.ok) {
      calendarEventsCache.set(symbol, { expiresAt: Date.now() + 10 * 60 * 1000, events: [] });
      return [];
    }

    const json = (await resp.json()) as {
      quoteSummary?: {
        result?: Array<{
          calendarEvents?: {
            earnings?: {
              earningsDate?: Array<{ raw?: number }>;
              earningsAverage?: { raw?: number };
            };
            exDividendDate?: { raw?: number };
          };
        }>;
      };
    };

    const cal = json.quoteSummary?.result?.[0]?.calendarEvents;
    if (!cal) {
      calendarEventsCache.set(symbol, { expiresAt: Date.now() + CALENDAR_EVENTS_TTL_MS, events: [] });
      return [];
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const out: CorporateEvent[] = [];

    const earnTs = cal.earnings?.earningsDate?.[0]?.raw;
    if (earnTs && Number.isFinite(earnTs)) {
      const epsEst = cal.earnings?.earningsAverage?.raw;
      const daysAway = Math.round((earnTs - nowSec) / 86400);
      out.push({
        id: `earn-${earnTs}`,
        type: 'Earnings',
        timestamp: earnTs,
        dateLabel: formatEventDate(earnTs),
        isUpcoming: earnTs >= nowSec - 43200,
        daysAway,
        detail: epsEst != null ? `Earnings (Est EPS ${epsEst.toFixed(2)})` : 'Earnings Date',
      });
    }

    const exDivTs = cal.exDividendDate?.raw;
    if (exDivTs && Number.isFinite(exDivTs)) {
      const daysAway = Math.round((exDivTs - nowSec) / 86400);
      out.push({
        id: `exdiv-cal-${exDivTs}`,
        type: 'Dividend',
        timestamp: exDivTs,
        dateLabel: formatEventDate(exDivTs),
        isUpcoming: exDivTs >= nowSec - 43200,
        daysAway,
        detail: 'Ex-Dividend Date',
      });
    }

    calendarEventsCache.set(symbol, { expiresAt: Date.now() + CALENDAR_EVENTS_TTL_MS, events: out });
    return out;
  } catch {
    return [];
  }
}

function buildCorporateEventsForBars(
  bars: Array<{ time: number }>,
  rawChartEvents: RawChartEventItem[] | undefined,
  calendarEvents: CorporateEvent[]
): CorporateEvent[] {
  const nowSec = Math.floor(Date.now() / 1000);
  const combined: CorporateEvent[] = [...calendarEvents];

  if (rawChartEvents) {
    for (const ev of rawChartEvents) {
      const dupCal = combined.some(
        (c) => c.type === ev.type && Math.abs(c.timestamp - ev.timestamp) < 4 * 86400
      );
      if (dupCal) continue;
      combined.push({
        id: `${ev.type.toLowerCase()}-${ev.timestamp}`,
        type: ev.type,
        timestamp: ev.timestamp,
        dateLabel: formatEventDate(ev.timestamp),
        isUpcoming: ev.timestamp >= nowSec - 43200,
        daysAway: Math.round((ev.timestamp - nowSec) / 86400),
        detail: ev.detail,
      });
    }
  }

  if (bars.length > 0) {
    const firstTs = bars[0].time - 5 * 86400;
    const lastTs = bars[bars.length - 1].time + 5 * 86400;
    for (const ev of combined) {
      if (ev.timestamp >= firstTs && ev.timestamp <= lastTs) {
        let bestIdx = 0;
        let bestDiff = Infinity;
        for (let i = 0; i < bars.length; i++) {
          const diff = Math.abs(bars[i].time - ev.timestamp);
          if (diff < bestDiff) {
            bestDiff = diff;
            bestIdx = i;
          }
        }
        ev.barIndex = bestIdx;
      }
    }
  }

  return combined.sort((a, b) => b.timestamp - a.timestamp).slice(0, 24);
}

async function fetchSeasonalityForSymbol(
  symbol: string,
  timeframe: Timeframe,
  currentEntry?: RawOhlcvCacheEntry
): Promise<SeasonalityAnalysis | undefined> {
  const cached = seasonalityCache.get(symbol);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  try {
    const entry =
      timeframe === '1mo' && currentEntry
        ? currentEntry
        : MY_COMPOSITE_INDICES[symbol]
        ? await buildCompositeIndexOhlcv(symbol, '1mo', false)
        : await fetchYahooRawOhlcv(symbol, '1mo', false);

    const analysis = computeSeasonalityAnalysis(entry.bars);
    seasonalityCache.set(symbol, {
      expiresAt: Date.now() + SEASONALITY_CACHE_TTL_MS,
      data: analysis,
    });
    return analysis;
  } catch {
    return undefined;
  }
}

export async function fetchAndAnalyzeTicker(
  rawSymbol: string,
  timeframe: Timeframe = '1d',
  forceRefresh = false,
  includeHistory = false
): Promise<TickerDetailResponse> {
  const symbol = rawSymbol.trim().toUpperCase().replace(/[^A-Z0-9.:^-]/g, '');
  if (!symbol) {
    throw new Error('Invalid ticker symbol');
  }

  const cacheKey = `${symbol}:${timeframe}`;
  const cached = tickerCache.get(cacheKey);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
    if (includeHistory && !cached.hasHistory) {
      const compositeDefCached = MY_COMPOSITE_INDICES[symbol];
      const isIdx = Boolean(cached.detail.isIndex);
      const [optionsIv, seasonalityAnalysis, calEvents, rawChartCached] = await Promise.all([
        fetchOptionsImpliedVolatility(symbol, isIdx),
        fetchSeasonalityForSymbol(symbol, timeframe),
        fetchCalendarEvents(symbol, isIdx),
        compositeDefCached
          ? Promise.resolve(undefined)
          : fetchYahooRawOhlcv(symbol, timeframe, false).catch(() => undefined),
      ]);
      const historicalPatterns = detectHistoricalPatterns(cached.detail.bars, cached.detail.patterns);
      const volatilityAnalysis =
        cached.detail.volatilityAnalysis ??
        computeVolatilityAnalysis(cached.detail.bars, timeframe, optionsIv);
      const corporateEvents = buildCorporateEventsForBars(
        cached.detail.bars,
        rawChartCached?.rawEvents,
        calEvents
      );
      const enriched: TickerDetailResponse = {
        ...cached.detail,
        historicalPatterns,
        volatilityAnalysis,
        seasonalityAnalysis,
        corporateEvents,
      };
      tickerCache.set(cacheKey, {
        expiresAt: cached.expiresAt,
        hasHistory: true,
        detail: enriched,
      });
      return enriched;
    }
    return cached.detail;
  }

  const compositeDef = MY_COMPOSITE_INDICES[symbol];
  const rawEntry = compositeDef
    ? await buildCompositeIndexOhlcv(symbol, timeframe, forceRefresh)
    : await fetchYahooRawOhlcv(symbol, timeframe, forceRefresh);

  const meta = rawEntry.meta;
  const trimmedBars = rawEntry.bars;

  if (trimmedBars.length < 25) {
    throw new Error(`Insufficient price history for ${symbol} (${trimmedBars.length} bars)`);
  }

  const {
    bars,
    atrPct,
    avgVolume20,
    rvol: baseRvol,
    high52w,
    low52w,
    sma20SlopePct,
    sma20SlopeR2,
    sma20TrendPoints,
  } = enrichBarsWithIndicators(trimmedBars);
  const lastBar = bars[bars.length - 1];
  const prevBar = bars[bars.length - 2] || lastBar;
  const price = Math.round((meta.regularMarketPrice ?? lastBar.close) * 100) / 100;
  const prevClose = prevBar.close;
  const change = Math.round((price - prevClose) * 100) / 100;
  const changePct = prevClose > 0 ? Math.round((change / prevClose) * 10000) / 100 : 0;
  const liveVolume = meta.regularMarketVolume ?? lastBar.volume;
  const barVolume = timeframe === '1d' ? liveVolume : lastBar.volume;
  const rvol =
    timeframe === '1d' && avgVolume20 > 0
      ? Math.round((liveVolume / avgVolume20) * 100) / 100
      : baseRvol;

  const knownMeta = US_TICKER_DIRECTORY[symbol];
  const name = knownMeta?.name || meta.shortName || meta.longName || symbol;
  const sector = knownMeta?.sector || (symbol.endsWith('.KL') ? 'Bursa Malaysia Equity' : 'US Listed Equity');
  const exchange = normalizeExchange(meta.exchangeName, meta.fullExchangeName, symbol);
  const isIndex = meta.instrumentType === 'INDEX' || isKnownIndexSymbol(symbol);
  const isETF = !isIndex && (meta.instrumentType === 'ETF' || isKnownEtfSymbol(symbol));
  const currency = isIndex
    ? 'PTS'
    : meta.currency || (symbol.endsWith('.KL') ? 'MYR' : 'USD');

  const newsQuerySym = compositeDef ? '^KLSE' : symbol;
  const [patterns, shortInterest, news, optionsIv, seasonalityAnalysis, calEvents] = await Promise.all([
    Promise.resolve(detectChartPatterns(bars, rvol)),
    isIndex || isETF ? Promise.resolve(null) : fetchShortInterest(symbol),
    fetchTickerNews(newsQuerySym, 8),
    includeHistory ? fetchOptionsImpliedVolatility(symbol, isIndex) : Promise.resolve(null),
    includeHistory ? fetchSeasonalityForSymbol(symbol, timeframe, rawEntry) : Promise.resolve(undefined),
    includeHistory ? fetchCalendarEvents(symbol, isIndex) : Promise.resolve([]),
  ]);
  const historicalPatterns = includeHistory ? detectHistoricalPatterns(bars, patterns) : [];
  const volumeAnalysis = computeVolumeAnalysis(bars, barVolume, price);
  const volatilityAnalysis = includeHistory
    ? computeVolatilityAnalysis(bars, timeframe, optionsIv)
    : undefined;
  const corporateEvents = includeHistory
    ? buildCorporateEventsForBars(bars, rawEntry.rawEvents, calEvents)
    : undefined;

  const detail: TickerDetailResponse = {
    symbol,
    name,
    sector,
    exchange,
    currency,
    isETF,
    isIndex,
    marketState: meta.marketState || 'REGULAR',
    price,
    change,
    changePct,
    dayHigh: Math.round((meta.regularMarketDayHigh ?? lastBar.high) * 100) / 100,
    dayLow: Math.round((meta.regularMarketDayLow ?? lastBar.low) * 100) / 100,
    volume: liveVolume,
    avgVolume20,
    rvol,
    volumeAnalysis,
    volatilityAnalysis,
    seasonalityAnalysis,
    corporateEvents,
    shortInterest,
    rsi14: lastBar.rsi14,
    sma20: lastBar.sma20,
    sma20SlopePct,
    sma20SlopeR2,
    sma20TrendPoints,
    sma50: lastBar.sma50,
    sma200: lastBar.sma200,
    atrPct,
    high52w,
    low52w,
    timeframe,
    patterns,
    primaryPattern: patterns[0] || null,
    barsCount: bars.length,
    updatedAt: new Date().toISOString(),
    bars,
    news,
    historicalPatterns,
  };

  tickerCache.set(cacheKey, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    hasHistory: includeHistory,
    detail,
  });

  return detail;
}

export async function fetchMultiTimeframeSummary(rawSymbol: string): Promise<MultiTimeframeSummary> {
  const symbol = rawSymbol.trim().toUpperCase().replace(/[^A-Z0-9.:^-]/g, '');
  if (!symbol) {
    throw new Error('Invalid ticker symbol');
  }

  const tfs: Timeframe[] = ['1h', '4h', '1d', '1wk'];
  const settled = await Promise.allSettled(
    tfs.map((tf) => fetchAndAnalyzeTicker(symbol, tf, false, false))
  );

  const cells: MtfTimeframeCell[] = [];
  for (let i = 0; i < tfs.length; i++) {
    const outcome = settled[i];
    if (outcome.status !== 'fulfilled') continue;
    const d = outcome.value;

    let netScore = 0;
    if (d.primaryPattern) {
      if (d.primaryPattern.bias === 'Bullish') netScore += 2;
      else if (d.primaryPattern.bias === 'Bearish') netScore -= 2;
    }
    if (d.sma20SlopePct != null) {
      if (d.sma20SlopePct > 0.08) netScore += 1;
      else if (d.sma20SlopePct < -0.08) netScore -= 1;
    }
    if (d.sma50 != null) {
      if (d.price > d.sma50) netScore += 1;
      else if (d.price < d.sma50) netScore -= 1;
    }
    if (d.rsi14 != null) {
      if (d.rsi14 >= 54) netScore += 1;
      else if (d.rsi14 <= 46) netScore -= 1;
    }

    const trendBias: MtfTimeframeCell['trendBias'] =
      netScore >= 2 ? 'Bullish' : netScore <= -2 ? 'Bearish' : 'Neutral';

    cells.push({
      timeframe: tfs[i],
      price: d.price,
      changePct: d.changePct,
      trendBias,
      sma20SlopePct: d.sma20SlopePct,
      rsi14: d.rsi14,
      rvol: d.rvol,
      primaryPattern: d.primaryPattern
        ? {
            type: d.primaryPattern.type,
            bias: d.primaryPattern.bias,
            stage: d.primaryPattern.stage,
            fitScore: d.primaryPattern.fitScore,
            breakoutPrice: d.primaryPattern.breakoutPrice,
            targetPrice: d.primaryPattern.targetPrice,
            stopPrice: d.primaryPattern.stopPrice,
          }
        : null,
      barsCount: d.barsCount,
    });
  }

  const bullishCount = cells.filter((c) => c.trendBias === 'Bullish').length;
  const bearishCount = cells.filter((c) => c.trendBias === 'Bearish').length;
  const neutralCount = cells.filter((c) => c.trendBias === 'Neutral').length;

  const alignmentLabel: MultiTimeframeSummary['alignmentLabel'] =
    bullishCount >= 3 && bearishCount === 0
      ? 'Strong Bullish Alignment'
      : bullishCount > bearishCount && bullishCount >= 2
      ? 'Bullish Lean'
      : bearishCount >= 3 && bullishCount === 0
      ? 'Strong Bearish Alignment'
      : bearishCount > bullishCount && bearishCount >= 2
      ? 'Bearish Lean'
      : 'Mixed / Transitional';

  return {
    symbol,
    cells,
    alignmentLabel,
    bullishCount,
    bearishCount,
    neutralCount,
    updatedAt: new Date().toISOString(),
  };
}

export async function scanSymbols(
  symbols: string[],
  timeframe: Timeframe,
  forceRefresh = false
): Promise<{ results: ScannedTicker[]; errors: string[] }> {
  const results: ScannedTicker[] = [];
  const errors: string[] = [];

  const batchSize = 12;
  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    const settled = await Promise.allSettled(
      batch.map((sym) => fetchAndAnalyzeTicker(sym, timeframe, forceRefresh, false))
    );

    for (let j = 0; j < settled.length; j++) {
      const outcome = settled[j];
      if (outcome.status === 'fulfilled') {
        const {
          bars: _omitBars,
          news: _omitNews,
          historicalPatterns: _omitHistory,
          volatilityAnalysis: _omitVolatility,
          ...summary
        } = outcome.value;
        results.push(summary);
      } else {
        errors.push(`${batch[j]}: ${outcome.reason?.message || 'Fetch error'}`);
      }
    }
  }

  return { results, errors };
}

export async function fetchLiveQuotes(symbols: string[]): Promise<LiveQuote[]> {
  const clean = Array.from(
    new Set(
      symbols
        .map((s) => s.trim().toUpperCase().replace(/[^A-Z0-9.:^-]/g, ''))
        .filter(Boolean)
    )
  ).slice(0, 48);

  const quotes: LiveQuote[] = [];
  const batchSize = 8;
  for (let i = 0; i < clean.length; i += batchSize) {
    const batch = clean.slice(i, i + batchSize);
    const settled = await Promise.allSettled(
      batch.map(async (symbol) => {
        if (MY_COMPOSITE_INDICES[symbol]) {
          const d = await fetchAndAnalyzeTicker(symbol, '1d', false, false);
          return {
            symbol: d.symbol,
            name: d.name,
            exchange: d.exchange,
            currency: d.currency,
            price: d.price,
            change: d.change,
            changePct: d.changePct,
            volume: d.volume,
            dayHigh: d.dayHigh,
            dayLow: d.dayLow,
            marketState: d.marketState,
            updatedAt: d.updatedAt,
          } satisfies LiveQuote;
        }
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
          symbol
        )}?range=5d&interval=1d&includePrePost=false`;
        const resp = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; TapeScopeScanner/1.0)',
            Accept: 'application/json',
          },
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const json = (await resp.json()) as {
          chart?: {
            result?: Array<{
              meta?: {
                shortName?: string;
                longName?: string;
                exchangeName?: string;
                fullExchangeName?: string;
                marketState?: string;
                currency?: string;
                instrumentType?: string;
                regularMarketPrice?: number;
                regularMarketDayHigh?: number;
                regularMarketDayLow?: number;
                regularMarketVolume?: number;
                chartPreviousClose?: number;
              };
              indicators?: {
                quote?: Array<{
                  high?: Array<number | null>;
                  low?: Array<number | null>;
                  close?: Array<number | null>;
                  volume?: Array<number | null>;
                }>;
              };
            }>;
          };
        };
        const r = json.chart?.result?.[0];
        if (!r?.meta) throw new Error('Missing quote meta');
        const m = r.meta;
        const closes = (r.indicators?.quote?.[0]?.close || []).filter(
          (v): v is number => v != null && Number.isFinite(v)
        );
        const vols = (r.indicators?.quote?.[0]?.volume || []).filter(
          (v): v is number => v != null && Number.isFinite(v)
        );
        const price = Math.round((m.regularMarketPrice ?? closes[closes.length - 1] ?? 0) * 100) / 100;
        const prevClose = closes.length >= 2 ? closes[closes.length - 2] : m.chartPreviousClose ?? price;
        const change = Math.round((price - prevClose) * 100) / 100;
        const changePct = prevClose > 0 ? Math.round((change / prevClose) * 10000) / 100 : 0;
        const known = US_TICKER_DIRECTORY[symbol];
        const currency =
          m.instrumentType === 'INDEX'
            ? 'PTS'
            : m.currency || (symbol.endsWith('.KL') ? 'MYR' : 'USD');

        return {
          symbol,
          name: known?.name || m.shortName || m.longName || symbol,
          exchange: normalizeExchange(m.exchangeName, m.fullExchangeName, symbol),
          currency,
          price,
          change,
          changePct,
          volume: m.regularMarketVolume ?? vols[vols.length - 1] ?? 0,
          dayHigh: Math.round((m.regularMarketDayHigh ?? price) * 100) / 100,
          dayLow: Math.round((m.regularMarketDayLow ?? price) * 100) / 100,
          marketState: m.marketState || 'REGULAR',
          updatedAt: new Date().toISOString(),
        } satisfies LiveQuote;
      })
    );

    for (const s of settled) {
      if (s.status === 'fulfilled') quotes.push(s.value);
    }
  }

  return quotes;
}

function mapSectorToBenchmark(rawSector?: string, rawIndustry?: string): SectorBenchmarkInfo {
  const s = (rawSector || '').toLowerCase();
  const ind = (rawIndustry || '').toLowerCase();

  if (s === 'semiconductors' || ind.includes('semiconductor')) {
    return { sector: 'Semiconductors', benchmarkSymbol: 'SMH', benchmarkName: 'VanEck Semis (SMH)' };
  }
  if (s.includes('tech') || s === 'software' || s === 'cybersecurity') {
    return { sector: 'Technology', benchmarkSymbol: 'XLK', benchmarkName: 'Tech SPDR (XLK)' };
  }
  if (s.includes('communication')) {
    return { sector: 'Communication Services', benchmarkSymbol: 'XLC', benchmarkName: 'Comm Svcs (XLC)' };
  }
  if (s.includes('discretionary') || s.includes('cyclical')) {
    return { sector: 'Consumer Discretionary', benchmarkSymbol: 'XLY', benchmarkName: 'Cons Discret (XLY)' };
  }
  if (s.includes('staples') || s.includes('defensive')) {
    return { sector: 'Consumer Staples', benchmarkSymbol: 'XLP', benchmarkName: 'Cons Staples (XLP)' };
  }
  if (s.includes('health')) {
    return { sector: 'Healthcare', benchmarkSymbol: 'XLV', benchmarkName: 'Healthcare (XLV)' };
  }
  if (s.includes('financ')) {
    return { sector: 'Financials', benchmarkSymbol: 'XLF', benchmarkName: 'Financials (XLF)' };
  }
  if (s.includes('industr')) {
    return { sector: 'Industrials', benchmarkSymbol: 'XLI', benchmarkName: 'Industrials (XLI)' };
  }
  if (s.includes('energy')) {
    return { sector: 'Energy', benchmarkSymbol: 'XLE', benchmarkName: 'Energy SPDR (XLE)' };
  }
  if (s.includes('material')) {
    return { sector: 'Materials', benchmarkSymbol: 'XLB', benchmarkName: 'Materials (XLB)' };
  }
  if (s.includes('utilit')) {
    return { sector: 'Utilities', benchmarkSymbol: 'XLU', benchmarkName: 'Utilities (XLU)' };
  }
  if (s.includes('real estate')) {
    return { sector: 'Real Estate', benchmarkSymbol: 'XLRE', benchmarkName: 'Real Estate (XLRE)' };
  }
  if (s.includes('etf')) {
    return { sector: 'Benchmarks & ETFs', benchmarkSymbol: 'SPY', benchmarkName: 'S&P 500 (SPY)' };
  }
  return { sector: 'Broad US Equities', benchmarkSymbol: 'SPY', benchmarkName: 'S&P 500 (SPY)' };
}

async function resolveSectorBenchmark(symbol: string): Promise<SectorBenchmarkInfo> {
  const known = US_TICKER_DIRECTORY[symbol];
  if (symbol === '^KLSE' || symbol.endsWith('.KL') || symbol.startsWith('MYIDX:')) {
    return {
      sector:
        known?.sector && !known.sector.includes('Index')
          ? `MY · ${known.sector}`
          : 'KLCI & Bursa Sector Indices',
      benchmarkSymbol: '^KLSE',
      benchmarkName: 'FTSE Bursa KLCI (^KLSE)',
    };
  }
  if (known) {
    return mapSectorToBenchmark(known.sector);
  }

  const cached = sectorMetaCache.get(symbol);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.info;
  }

  try {
    let auth = await getYahooAuth(false);
    if (!auth) return mapSectorToBenchmark();

    const query = async (a: { cookie: string; crumb: string }) =>
      fetch(
        `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(
          symbol
        )}?modules=assetProfile&crumb=${encodeURIComponent(a.crumb)}`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; TapeScopeScanner/1.0)',
            Cookie: a.cookie,
            Accept: 'application/json',
          },
        }
      );

    let resp = await query(auth);
    if (resp.status === 401) {
      auth = await getYahooAuth(true);
      if (!auth) return mapSectorToBenchmark();
      resp = await query(auth);
    }
    if (!resp.ok) return mapSectorToBenchmark();

    const json = (await resp.json()) as {
      quoteSummary?: {
        result?: Array<{
          assetProfile?: { sector?: string; industry?: string };
        }>;
      };
    };
    const ap = json.quoteSummary?.result?.[0]?.assetProfile;
    const info = mapSectorToBenchmark(ap?.sector, ap?.industry);
    sectorMetaCache.set(symbol, { info, expiresAt: Date.now() + SECTOR_META_TTL_MS });
    return info;
  } catch {
    return mapSectorToBenchmark();
  }
}

async function fetchPerfSnapshot(symbol: string): Promise<PerfSnapshot | null> {
  const cached = perfCache.get(symbol);
  if (cached && cached.expiresAt > Date.now()) {
    return cached;
  }

  try {
    if (MY_COMPOSITE_INDICES[symbol]) {
      const d = await fetchAndAnalyzeTicker(symbol, '1d', false, false);
      const closes = d.bars.map((b) => b.close);
      const price = d.price;
      const prev1d = closes.length >= 2 ? closes[closes.length - 2] : price;
      const prev5d = closes[Math.max(0, closes.length - 6)] ?? prev1d;
      const prev1m = closes[Math.max(0, closes.length - 22)] ?? prev5d;
      const pct = (base: number) =>
        base > 0 ? Math.round(((price - base) / base) * 10000) / 100 : 0;
      const snap: PerfSnapshot = {
        symbol: d.symbol,
        name: d.name,
        exchange: d.exchange,
        price,
        volume: d.volume,
        perf1dPct: pct(prev1d),
        perf5dPct: pct(prev5d),
        perf1mPct: pct(prev1m),
        expiresAt: Date.now() + CACHE_TTL_MS,
      };
      perfCache.set(symbol, snap);
      return snap;
    }

    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      symbol
    )}?range=1mo&interval=1d&includePrePost=false`;
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TapeScopeScanner/1.0)',
        Accept: 'application/json',
      },
    });
    if (!resp.ok) return null;

    const json = (await resp.json()) as {
      chart?: {
        result?: Array<{
          meta?: {
            shortName?: string;
            longName?: string;
            exchangeName?: string;
            fullExchangeName?: string;
            regularMarketPrice?: number;
            regularMarketVolume?: number;
            chartPreviousClose?: number;
          };
          indicators?: {
            quote?: Array<{
              close?: Array<number | null>;
              volume?: Array<number | null>;
            }>;
          };
        }>;
      };
    };

    const r = json.chart?.result?.[0];
    if (!r?.meta) return null;
    const m = r.meta;
    const closes = (r.indicators?.quote?.[0]?.close || []).filter(
      (v): v is number => v != null && Number.isFinite(v) && v > 0
    );
    const vols = (r.indicators?.quote?.[0]?.volume || []).filter(
      (v): v is number => v != null && Number.isFinite(v)
    );
    if (closes.length === 0) return null;

    const price = Math.round((m.regularMarketPrice ?? closes[closes.length - 1]) * 100) / 100;
    const prev1d = closes.length >= 2 ? closes[closes.length - 2] : m.chartPreviousClose ?? price;
    const prev5d = closes[Math.max(0, closes.length - 6)] ?? prev1d;
    const prev1m = closes[0] ?? prev5d;

    const pct = (base: number) =>
      base > 0 ? Math.round(((price - base) / base) * 10000) / 100 : 0;

    const known = US_TICKER_DIRECTORY[symbol];
    const snap: PerfSnapshot = {
      symbol,
      name: known?.name || m.shortName || m.longName || symbol,
      exchange: normalizeExchange(m.exchangeName, m.fullExchangeName, symbol),
      price,
      volume: m.regularMarketVolume ?? vols[vols.length - 1] ?? 0,
      perf1dPct: pct(prev1d),
      perf5dPct: pct(prev5d),
      perf1mPct: pct(prev1m),
      expiresAt: Date.now() + CACHE_TTL_MS,
    };

    perfCache.set(symbol, snap);
    return snap;
  } catch {
    return null;
  }
}

export async function fetchSectorHeatmap(rawSymbols: string[]): Promise<SectorHeatmapResponse> {
  const clean = Array.from(
    new Set(
      rawSymbols
        .map((s) => s.trim().toUpperCase().replace(/[^A-Z0-9.:^-]/g, ''))
        .filter(Boolean)
    )
  ).slice(0, 36);

  if (clean.length === 0) {
    return { items: [], sectors: [], updatedAt: new Date().toISOString() };
  }

  const sectorEntries = await Promise.all(
    clean.map(async (sym) => ({
      symbol: sym,
      info: await resolveSectorBenchmark(sym),
    }))
  );

  const uniqueBenchmarks = Array.from(new Set(sectorEntries.map((e) => e.info.benchmarkSymbol)));
  const allToFetch = Array.from(new Set([...clean, ...uniqueBenchmarks]));

  const perfMap = new Map<string, PerfSnapshot>();
  const batchSize = 10;
  for (let i = 0; i < allToFetch.length; i += batchSize) {
    const batch = allToFetch.slice(i, i + batchSize);
    const snaps = await Promise.all(batch.map((sym) => fetchPerfSnapshot(sym)));
    for (const snap of snaps) {
      if (snap) perfMap.set(snap.symbol, snap);
    }
  }

  const items: SectorHeatmapEntry[] = [];
  const sectorMap = new Map<string, { info: SectorBenchmarkInfo; entries: SectorHeatmapEntry[] }>();

  for (const { symbol, info } of sectorEntries) {
    const stock = perfMap.get(symbol);
    if (!stock) continue;
    const bench = perfMap.get(info.benchmarkSymbol);

    const b1d = bench?.perf1dPct ?? 0;
    const b5d = bench?.perf5dPct ?? 0;
    const b1m = bench?.perf1mPct ?? 0;

    const entry: SectorHeatmapEntry = {
      symbol: stock.symbol,
      name: stock.name,
      exchange: stock.exchange,
      sector: info.sector,
      benchmarkSymbol: info.benchmarkSymbol,
      benchmarkName: info.benchmarkName,
      price: stock.price,
      volume: stock.volume,
      perf1dPct: stock.perf1dPct,
      perf5dPct: stock.perf5dPct,
      perf1mPct: stock.perf1mPct,
      bench1dPct: b1d,
      bench5dPct: b5d,
      bench1mPct: b1m,
      rel1dPct: Math.round((stock.perf1dPct - b1d) * 100) / 100,
      rel5dPct: Math.round((stock.perf5dPct - b5d) * 100) / 100,
      rel1mPct: Math.round((stock.perf1mPct - b1m) * 100) / 100,
    };

    items.push(entry);

    const existing = sectorMap.get(info.sector);
    if (existing) {
      existing.entries.push(entry);
    } else {
      sectorMap.set(info.sector, { info, entries: [entry] });
    }
  }

  const sectors: SectorBenchmarkSummary[] = Array.from(sectorMap.values()).map(({ info, entries }) => {
    const bench = perfMap.get(info.benchmarkSymbol);
    const cnt = Math.max(1, entries.length);
    const avg = (fn: (e: SectorHeatmapEntry) => number) =>
      Math.round((entries.reduce((sum, e) => sum + fn(e), 0) / cnt) * 100) / 100;

    return {
      sector: info.sector,
      benchmarkSymbol: info.benchmarkSymbol,
      benchmarkName: info.benchmarkName,
      benchmarkPrice: bench?.price ?? 0,
      perf1dPct: bench?.perf1dPct ?? 0,
      perf5dPct: bench?.perf5dPct ?? 0,
      perf1mPct: bench?.perf1mPct ?? 0,
      avgStock1dPct: avg((e) => e.perf1dPct),
      avgRel1dPct: avg((e) => e.rel1dPct),
      avgRel5dPct: avg((e) => e.rel5dPct),
      avgRel1mPct: avg((e) => e.rel1mPct),
      stockCount: entries.length,
      outperformCount: entries.filter((e) => e.rel1dPct > 0).length,
    };
  });

  sectors.sort((a, b) => b.stockCount - a.stockCount || b.avgRel1dPct - a.avgRel1dPct);

  return {
    items,
    sectors,
    updatedAt: new Date().toISOString(),
  };
}

export async function searchTickers(
  rawQuery: string,
  preferMarket?: 'MY' | 'US',
  limit = 10
): Promise<TickerSearchSuggestion[]> {
  const trimmed = rawQuery.trim();
  if (!trimmed) return [];

  const cacheKey = `${trimmed.toUpperCase()}:${preferMarket || 'ANY'}`;
  const cached = tickerSearchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.items.slice(0, limit);
  }

  const localHits = searchDirectoryTickers(trimmed, preferMarket, limit);
  const merged = new Map<string, TickerSearchSuggestion>();
  for (const hit of localHits) {
    merged.set(hit.symbol, hit);
  }

  const quickNorm = normalizeQuickTicker(trimmed);
  const yahooQueries = Array.from(
    new Set([trimmed, ...(quickNorm && quickNorm !== trimmed.toUpperCase() ? [quickNorm] : [])])
  );

  try {
    const responses = await Promise.allSettled(
      yahooQueries.map(async (q) => {
        const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(
          q
        )}&quotesCount=10&newsCount=0`;
        const resp = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; TapeScopeScanner/1.0)',
            Accept: 'application/json',
          },
        });
        if (!resp.ok) return [];
        const json = (await resp.json()) as {
          quotes?: Array<{
            symbol?: string;
            shortname?: string;
            longname?: string;
            exchange?: string;
            exchDisp?: string;
            quoteType?: string;
            isYahooFinance?: boolean;
          }>;
        };
        return json.quotes || [];
      })
    );

    const yahooHits: TickerSearchSuggestion[] = [];
    for (const outcome of responses) {
      if (outcome.status !== 'fulfilled') continue;
      for (const q of outcome.value) {
        if (!q.symbol) continue;
        const qt = (q.quoteType || '').toUpperCase();
        if (qt && qt !== 'EQUITY' && qt !== 'ETF' && qt !== 'INDEX' && qt !== 'MUTUALFUND') {
          continue;
        }
        const sym = sanitizeTickerInput(q.symbol);
        if (!sym || merged.has(sym)) continue;
        const exch = normalizeExchange(q.exchange, q.exchDisp, sym);
        yahooHits.push({
          symbol: sym,
          name: (q.shortname || q.longname || sym).trim(),
          exchange: exch,
          type: qt || (sym.startsWith('^') ? 'INDEX' : 'EQUITY'),
          region: getRegionForSymbol(sym, q.exchange || exch),
        });
      }
    }

    // Prioritize exact symbol match, Bursa .KL if numeric/MY preference, then US/global
    const qUpper = trimmed.toUpperCase();
    yahooHits.sort((a, b) => {
      const score = (item: TickerSearchSuggestion) => {
        let s = 0;
        if (item.symbol === quickNorm || item.symbol === qUpper) s += 100;
        if (item.symbol.replace(/\.KL$/, '') === qUpper) s += 90;
        if (item.name.toUpperCase() === qUpper) s += 75;
        if (item.region === 'MY' && (/^\d{4}/.test(qUpper) || preferMarket === 'MY')) s += 40;
        if (preferMarket && item.region === preferMarket) s += 20;
        if (item.region === 'MY' || item.region === 'US') s += 10;
        return s;
      };
      return score(b) - score(a);
    });

    for (const hit of yahooHits) {
      if (!merged.has(hit.symbol)) merged.set(hit.symbol, hit);
    }
  } catch {
    // Return local directory matches on network failure
  }

  const items = Array.from(merged.values()).slice(0, Math.max(limit, 12));
  tickerSearchCache.set(cacheKey, {
    expiresAt: Date.now() + NEWS_CACHE_TTL_MS,
    items,
  });
  return items.slice(0, limit);
}

export async function resolveTickerInput(
  rawQuery: string,
  preferMarket?: 'MY' | 'US'
): Promise<{ symbol: string; suggestion?: TickerSearchSuggestion }> {
  const quick = normalizeQuickTicker(rawQuery);
  if (!quick) return { symbol: '' };

  if (
    quick.endsWith('.KL') ||
    quick.startsWith('^') ||
    quick.startsWith('MYIDX:') ||
    US_TICKER_DIRECTORY[quick]
  ) {
    const known = US_TICKER_DIRECTORY[quick];
    return {
      symbol: quick,
      suggestion: known
        ? {
            symbol: known.symbol,
            name: known.name,
            exchange: known.exchange,
            type: known.isIndex ? 'INDEX' : known.isETF ? 'ETF' : 'EQUITY',
            region: getRegionForSymbol(known.symbol, known.exchange),
          }
        : undefined,
    };
  }

  const suggestions = await searchTickers(rawQuery, preferMarket, 8);
  const qUpper = rawQuery.trim().toUpperCase();

  // Prefer an exact Bursa .KL name/code match if user typed e.g. MAYBANK, PADINI, 99SMART, GREATEC
  const exactMyName = suggestions.find(
    (s) =>
      s.region === 'MY' &&
      (s.symbol.replace(/\.KL$/, '') === qUpper || s.name.toUpperCase() === qUpper)
  );
  if (exactMyName) {
    return { symbol: exactMyName.symbol, suggestion: exactMyName };
  }

  // Prefer exact ticker match (e.g. AAPL, PLTR, HOOD, TSM, D05.SI)
  const exactSym = suggestions.find((s) => s.symbol === quick || s.symbol === qUpper);
  if (exactSym) {
    return { symbol: exactSym.symbol, suggestion: exactSym };
  }

  // Prefer Malaysia hit if market context is MY, else top valid suggestion
  if (preferMarket === 'MY') {
    const myHit = suggestions.find((s) => s.region === 'MY');
    if (myHit) return { symbol: myHit.symbol, suggestion: myHit };
  }

  if (suggestions.length > 0 && (rawQuery.includes(' ') || qUpper.length >= 5)) {
    return { symbol: suggestions[0].symbol, suggestion: suggestions[0] };
  }

  return { symbol: quick, suggestion: suggestions[0] };
}

