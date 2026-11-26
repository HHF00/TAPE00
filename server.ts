import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import type { AssetClassFilter, ScanResponse, Timeframe, UniverseId } from './src/shared/types.ts';
import { isKnownEtfSymbol, isKnownIndexSymbol, US_UNIVERSES } from './src/shared/universes.ts';
import {
  fetchAndAnalyzeTicker,
  fetchLiveQuotes,
  fetchMarketNewsflow,
  fetchMultiTimeframeSummary,
  fetchSectorHeatmap,
  resolveTickerInput,
  scanSymbols,
  searchTickers,
} from './server/marketData.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseTimeframe(raw: unknown): Timeframe {
  if (
    raw === '1m' ||
    raw === '15m' ||
    raw === '1h' ||
    raw === '4h' ||
    raw === '1d' ||
    raw === '1wk' ||
    raw === '1mo'
  ) {
    return raw;
  }
  return '1d';
}

function parseSymbolList(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  return Array.from(
    new Set(
      raw
        .split(',')
        .map((s) => s.trim().toUpperCase().replace(/[^A-Z0-9.:^-]/g, ''))
        .filter(Boolean)
    )
  );
}

function parseAssetType(raw: unknown): AssetClassFilter | null {
  if (raw === 'all' || raw === 'equities' || raw === 'etfs' || raw === 'indices') {
    return raw;
  }
  return null;
}

async function startServer() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, timestamp: new Date().toISOString() });
  });

  app.get('/api/universes', (_req, res) => {
    res.json({ universes: US_UNIVERSES });
  });

  app.get('/api/search-tickers', async (req, res) => {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q : '';
      const market = req.query.market === 'MY' || req.query.market === 'US' ? req.query.market : undefined;
      if (!q.trim()) {
        return res.json({ suggestions: [] });
      }
      const suggestions = await searchTickers(q, market, 10);
      return res.json({ suggestions });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ticker search failed';
      return res.status(500).json({ error: message });
    }
  });

  app.get('/api/resolve-ticker', async (req, res) => {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q : '';
      const market = req.query.market === 'MY' || req.query.market === 'US' ? req.query.market : undefined;
      if (!q.trim()) {
        return res.status(400).json({ error: 'Missing ticker query' });
      }
      const resolved = await resolveTickerInput(q, market);
      return res.json(resolved);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ticker resolution failed';
      return res.status(500).json({ error: message });
    }
  });

  app.get('/api/quotes', async (req, res) => {
    try {
      const symbols = parseSymbolList(req.query.symbols);
      if (symbols.length === 0) {
        return res.json({ quotes: [], updatedAt: new Date().toISOString() });
      }
      const quotes = await fetchLiveQuotes(symbols);
      return res.json({ quotes, updatedAt: new Date().toISOString() });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Quote fetch failed';
      return res.status(500).json({ error: message });
    }
  });

  app.get('/api/news', async (req, res) => {
    try {
      const symbols = parseSymbolList(req.query.symbols);
      const news = await fetchMarketNewsflow(symbols, 12);
      return res.json({ news, updatedAt: new Date().toISOString() });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'News fetch failed';
      return res.status(500).json({ error: message });
    }
  });

  app.get('/api/sector-heatmap', async (req, res) => {
    try {
      const symbols = parseSymbolList(req.query.symbols);
      const heatmap = await fetchSectorHeatmap(symbols);
      return res.json(heatmap);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sector heatmap fetch failed';
      return res.status(500).json({ error: message });
    }
  });

  app.get('/api/scan', async (req, res) => {
    try {
      const timeframe = parseTimeframe(req.query.timeframe);
      const forceRefresh = req.query.refresh === '1';
      const customSymbols = parseSymbolList(req.query.symbols);
      const prioritySymbols = parseSymbolList(req.query.priority);
      const requestedAssetType = parseAssetType(req.query.assetType);
      const prioritySet = new Set(prioritySymbols);

      let universeId: UniverseId | 'watchlist' = 'mega_cap';
      let universeLabel = 'US Mega-Cap Leaders';
      let assetType: AssetClassFilter = requestedAssetType ?? 'all';
      let symbols: string[] = [];

      if (customSymbols.length > 0) {
        assetType = requestedAssetType ?? 'all';
        const eligibleCustom = customSymbols.filter((sym) => {
          if (assetType === 'etfs') return isKnownEtfSymbol(sym);
          if (assetType === 'indices') return isKnownIndexSymbol(sym);
          if (assetType === 'equities') return !isKnownEtfSymbol(sym) && !isKnownIndexSymbol(sym);
          return true;
        });
        symbols = eligibleCustom.slice(0, 120);
        universeId = 'watchlist';
        universeLabel = 'Personalized Watchlist';
      } else {
        const reqUni = typeof req.query.universe === 'string' ? req.query.universe : 'mega_cap';
        const found = US_UNIVERSES.find((u) => u.id === reqUni) || US_UNIVERSES[0];
        universeId = found.id;
        universeLabel = found.label;
        assetType = requestedAssetType ?? found.assetType;

        const isMyUniverse = found.region === 'MY';
        const eligiblePriority = prioritySymbols.filter((sym) => {
          const isMySymbol =
            sym === '^KLSE' || sym.endsWith('.KL') || sym.startsWith('MYIDX:');
          if (isMyUniverse !== isMySymbol) return false;
          if (assetType === 'etfs') return isKnownEtfSymbol(sym);
          if (assetType === 'indices') return isKnownIndexSymbol(sym);
          if (assetType === 'equities') return !isKnownEtfSymbol(sym) && !isKnownIndexSymbol(sym);
          return true;
        });

        const baseSymbols = found.symbols.filter((sym) => {
          if (assetType === 'etfs') return isKnownEtfSymbol(sym);
          if (assetType === 'indices') return isKnownIndexSymbol(sym);
          if (assetType === 'equities') {
            if (found.id === 'klci' && sym === '^KLSE') return true;
            return !isKnownEtfSymbol(sym) && !isKnownIndexSymbol(sym);
          }
          return true;
        });

        const merged = [...eligiblePriority, ...baseSymbols];
        symbols = Array.from(new Set(merged)).slice(0, 120);
      }

      const { results: rawResults, errors } = await scanSymbols(symbols, timeframe, forceRefresh);

      const reqPattern = typeof req.query.pattern === 'string' && req.query.pattern !== 'All' ? req.query.pattern : null;
      const reqStage = typeof req.query.stage === 'string' && req.query.stage !== 'All' ? req.query.stage : null;
      const reqBias = typeof req.query.bias === 'string' && req.query.bias !== 'All' ? req.query.bias : null;
      const minFit = Number(req.query.minFit) || 0;
      const maxDist = req.query.maxDist != null && req.query.maxDist !== '' ? Number(req.query.maxDist) : null;
      const minRr = Number(req.query.minRr) || 0;
      const reqTrend = typeof req.query.trend === 'string' && req.query.trend !== 'All' ? req.query.trend : null;

      const results = rawResults.filter((r) => {
        if (assetType === 'etfs' && !r.isETF) return false;
        if (assetType === 'indices' && !r.isIndex) return false;
        if (assetType === 'equities' && (r.isETF || (r.isIndex && universeId !== 'klci'))) return false;

        if (reqPattern || reqStage || reqBias || minFit > 0 || (maxDist != null && Number.isFinite(maxDist)) || minRr > 0) {
          const hasMatchingPattern = r.patterns.some((p) => {
            if (reqPattern && p.type !== reqPattern) return false;
            if (reqStage && p.stage !== reqStage) return false;
            if (reqBias && p.bias !== reqBias) return false;
            if (minFit > 0 && p.fitScore < minFit) return false;
            if (maxDist != null && Number.isFinite(maxDist) && Math.abs(p.distanceToBreakoutPct) > maxDist) return false;
            if (minRr > 0 && p.riskReward < minRr) return false;
            return true;
          });
          if (!hasMatchingPattern) return false;
        }

        if (reqTrend === 'above_sma50' && (r.sma50 == null || r.price <= r.sma50)) return false;
        if (reqTrend === 'above_sma200' && (r.sma200 == null || r.price <= r.sma200)) return false;
        if (
          reqTrend === 'golden_stack' &&
          (r.sma20 == null || r.sma50 == null || r.sma200 == null || !(r.price > r.sma20 && r.sma20 > r.sma50 && r.sma50 > r.sma200))
        ) {
          return false;
        }
        if (reqTrend === 'above_vwap20' && (r.volumeAnalysis?.vwap20 == null || r.price <= r.volumeAnalysis.vwap20)) return false;
        if (reqTrend === 'obv_accum' && r.volumeAnalysis?.obvTrend !== 'Accumulation') return false;

        return true;
      });

      // Sort: prioritized watchlist symbols first (if priority provided), then Breakout -> Testing Level -> Forming -> fitScore
      const stageWeight = (stage?: string) =>
        stage === 'Breakout' ? 300 : stage === 'Testing Level' ? 200 : stage === 'Forming' ? 100 : 0;

      results.sort((a, b) => {
        const aPri = prioritySet.has(a.symbol) ? 1000 : 0;
        const bPri = prioritySet.has(b.symbol) ? 1000 : 0;
        const aScore =
          aPri +
          (a.primaryPattern
            ? stageWeight(a.primaryPattern.stage) + a.primaryPattern.fitScore
            : a.rvol);
        const bScore =
          bPri +
          (b.primaryPattern
            ? stageWeight(b.primaryPattern.stage) + b.primaryPattern.fitScore
            : b.rvol);
        return bScore - aScore;
      });

      const payload: ScanResponse = {
        universe: universeId,
        universeLabel,
        assetType,
        timeframe,
        scannedCount: results.length,
        matchedCount: results.filter((r) => r.patterns.length > 0).length,
        updatedAt: new Date().toISOString(),
        results,
        errors,
      };

      res.json(payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Scan failed';
      res.status(500).json({ error: message });
    }
  });

  app.get('/api/ticker/:symbol/mtf', async (req, res) => {
    try {
      const summary = await fetchMultiTimeframeSummary(req.params.symbol);
      res.json(summary);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load MTF confluence';
      res.status(404).json({ error: message });
    }
  });

  app.get('/api/ticker/:symbol', async (req, res) => {
    try {
      const symbol = req.params.symbol;
      const timeframe = parseTimeframe(req.query.timeframe);
      const forceRefresh = req.query.refresh === '1';
      const detail = await fetchAndAnalyzeTicker(symbol, timeframe, forceRefresh, true);
      res.json(detail);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load ticker';
      res.status(404).json({ error: message });
    }
  });

  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`TapeScope server listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
