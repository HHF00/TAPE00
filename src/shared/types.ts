export type Timeframe = '1m' | '15m' | '1h' | '4h' | '1d' | '1wk' | '1mo';

export type PatternBias = 'Bullish' | 'Bearish' | 'Neutral';

export type PatternStage = 'Breakout' | 'Testing Level' | 'Forming';

export type PatternCategory =
  | 'Triangles'
  | 'Flags & Pennants'
  | 'Double Top & Bottom'
  | 'Cup & Handle'
  | 'Head & Shoulders'
  | 'Parabolic Curves'
  | 'Wedges & Boxes';

export type PatternType =
  | 'Ascending Triangle'
  | 'Descending Triangle'
  | 'Symmetrical Triangle'
  | 'Bull Flag'
  | 'Bear Flag'
  | 'Double Bottom'
  | 'Double Top'
  | 'Cup & Handle'
  | 'Inverse Head & Shoulders'
  | 'Head & Shoulders'
  | 'Parabola Curve'
  | 'Falling Wedge'
  | 'Rising Wedge'
  | 'Horizontal Breakout Box';

export type UniverseId =
  | 'mega_cap'
  | 'tech_semis'
  | 'sp_bellwethers'
  | 'us_all'
  | 'us_etfs'
  | 'us_indices'
  | 'klci'
  | 'bursa_all'
  | 'my_indices';

export type AssetClassFilter = 'all' | 'equities' | 'etfs' | 'indices';

export interface OHLCVBar {
  time: number;
  dateLabel: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  vwap20: number | null;
  rsi14: number | null;
}

export interface PatternPoint {
  index: number;
  time: number;
  price: number;
}

export interface PatternLine {
  label: string;
  points: PatternPoint[];
  role: 'resistance' | 'support' | 'neckline' | 'target' | 'stop' | 'pole';
  dashed?: boolean;
  curved?: boolean;
}

export interface DetectedPattern {
  id: string;
  type: PatternType;
  category: PatternCategory;
  bias: PatternBias;
  stage: PatternStage;
  fitScore: number;
  startIndex: number;
  endIndex: number;
  breakoutPrice: number;
  targetPrice: number;
  stopPrice: number;
  targetPct: number;
  riskPct: number;
  riskReward: number;
  distanceToBreakoutPct: number;
  summary: string;
  criteria: string[];
  lines: PatternLine[];
  keyPivots: PatternPoint[];
}

export interface VolumeAnalysis {
  currentVolume: number;
  avgVolume20: number;
  avgVolume50: number;
  rvol: number;
  rvol5d: number;
  dollarVolume: number;
  upVolume20: number;
  downVolume20: number;
  upDownVolumeRatio: number;
  obvTrend: 'Accumulation' | 'Distribution' | 'Neutral';
  vwap20: number | null;
  vwapDistancePct: number | null;
  spikeDays20: number;
  rating: 'Strong Accumulation' | 'Accumulation' | 'Neutral' | 'Distribution' | 'Heavy Distribution';
}

export interface ShortInterest {
  shortPercentOfFloat: number | null;
  shortRatio: number | null;
  sharesShort: number | null;
  sharesShortPriorMonth: number | null;
  shortChangeMoMPct: number | null;
  floatShares: number | null;
  settlementDate: string | null;
}

export interface VolatilityAnalysis {
  atr14: number;
  atr14Pct: number;
  atr5: number;
  atr5Pct: number;
  atrRatio: number;
  atrPercentile: number;
  atrTrend: 'Expanding' | 'Compressing' | 'Normal';
  hv20Pct: number | null;
  hv60Pct: number | null;
  hv52wLowPct: number | null;
  hv52wHighPct: number | null;
  hvPercentile: number | null;
  impliedVolatilityPct: number | null;
  ivCallPct: number | null;
  ivPutPct: number | null;
  ivSkewPct: number | null;
  ivPercentile: number | null;
  ivRank: number | null;
  ivHvSpreadPct: number | null;
  expectedMoveWeeklyPct: number | null;
  ivSource: 'Options Chain' | 'Realized Proxy (No Listed Options)';
  optionsExpiryLabel: string | null;
  regime: 'Low Volatility / Squeeze' | 'Normal Regime' | 'Elevated Volatility' | 'High Volatility Expansion';
}

export interface Watchlist {
  id: string;
  name: string;
  symbols: string[];
  createdAt: string;
}

export interface LiveQuote {
  symbol: string;
  name: string;
  exchange: string;
  currency?: string;
  price: number;
  change: number;
  changePct: number;
  volume: number;
  dayHigh: number;
  dayLow: number;
  marketState: string;
  updatedAt: string;
}

export interface ScannedTicker {
  symbol: string;
  name: string;
  sector: string;
  exchange: string;
  currency?: string;
  isETF: boolean;
  isIndex?: boolean;
  marketState: string;
  price: number;
  change: number;
  changePct: number;
  dayHigh: number;
  dayLow: number;
  volume: number;
  avgVolume20: number;
  rvol: number;
  volumeAnalysis: VolumeAnalysis;
  shortInterest: ShortInterest | null;
  rsi14: number | null;
  sma20: number | null;
  sma20SlopePct: number | null;
  sma20SlopeR2: number | null;
  sma20TrendPoints: number[];
  sma50: number | null;
  sma200: number | null;
  atrPct: number;
  high52w: number;
  low52w: number;
  timeframe: Timeframe;
  patterns: DetectedPattern[];
  primaryPattern: DetectedPattern | null;
  barsCount: number;
  updatedAt: string;
}

export interface NewsItem {
  id: string;
  title: string;
  publisher: string;
  link: string;
  publishedAt: string;
  publishedTimestamp: number;
  relatedTickers: string[];
}

export type HistoricalPatternOutcome = 'Target Hit' | 'Stopped Out' | 'Open / Mixed';

export interface HistoricalAnalogPoint {
  relIndex: number;
  pctFromAnchor: number;
}

export interface HistoricalPatternInstance {
  id: string;
  type: PatternType;
  category: PatternCategory;
  bias: PatternBias;
  stage: PatternStage;
  fitScore: number;
  startIndex: number;
  endIndex: number;
  startDateLabel: string;
  endDateLabel: string;
  anchorPrice: number;
  breakoutPrice: number;
  targetPrice: number;
  stopPrice: number;
  outcome: HistoricalPatternOutcome;
  barsToOutcome: number | null;
  forwardReturn5Pct: number | null;
  forwardReturn10Pct: number | null;
  forwardReturn20Pct: number | null;
  maxFavorablePct: number;
  maxAdversePct: number;
  lines: PatternLine[];
  keyPivots: PatternPoint[];
  analogCurve: HistoricalAnalogPoint[];
}

export interface SeasonalityMonthStat {
  monthIdx: number; // 0 = Jan .. 11 = Dec
  monthLabel: string;
  samples: number;
  winRatePct: number;
  avgReturnPct: number;
  medianReturnPct: number;
  bestReturnPct: number;
  worstReturnPct: number;
}

export interface SeasonalityAnalysis {
  yearsAnalyzed: number;
  months: SeasonalityMonthStat[];
  currentMonthIdx: number;
  nextMonthIdx: number;
  biasScore: number; // 0..100
  biasLabel: 'Strong Bullish' | 'Seasonal Tailwind' | 'Neutral' | 'Seasonal Headwind' | 'Weak / Bearish';
  bestMonthLabel: string;
  worstMonthLabel: string;
}

export interface CorporateEvent {
  id: string;
  type: 'Earnings' | 'Dividend' | 'Split';
  timestamp: number;
  dateLabel: string;
  isUpcoming: boolean;
  daysAway: number;
  detail: string;
  barIndex?: number;
}

export interface MtfTimeframeCell {
  timeframe: Timeframe;
  price: number;
  changePct: number;
  trendBias: 'Bullish' | 'Bearish' | 'Neutral';
  sma20SlopePct: number | null;
  rsi14: number | null;
  rvol: number;
  primaryPattern: {
    type: PatternType;
    bias: PatternBias;
    stage: PatternStage;
    fitScore: number;
    breakoutPrice: number;
    targetPrice: number;
    stopPrice: number;
  } | null;
  barsCount: number;
}

export interface MultiTimeframeSummary {
  symbol: string;
  cells: MtfTimeframeCell[];
  alignmentLabel:
    | 'Strong Bullish Alignment'
    | 'Bullish Lean'
    | 'Mixed / Transitional'
    | 'Bearish Lean'
    | 'Strong Bearish Alignment';
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
  updatedAt: string;
}

export interface PriceAlert {
  id: string;
  symbol: string;
  name: string;
  currency?: string;
  condition: 'above' | 'below';
  targetPrice: number;
  sourceLabel: string;
  active: boolean;
  triggeredAt?: string;
  triggeredPrice?: number;
  createdAt: string;
}

export interface TickerDetailResponse extends ScannedTicker {
  bars: OHLCVBar[];
  news: NewsItem[];
  historicalPatterns: HistoricalPatternInstance[];
  volatilityAnalysis?: VolatilityAnalysis;
  seasonalityAnalysis?: SeasonalityAnalysis;
  corporateEvents?: CorporateEvent[];
}

export interface ScanResponse {
  universe: UniverseId | 'watchlist';
  universeLabel: string;
  assetType?: AssetClassFilter;
  timeframe: Timeframe;
  scannedCount: number;
  matchedCount: number;
  updatedAt: string;
  results: ScannedTicker[];
  errors: string[];
}

export interface SectorHeatmapEntry {
  symbol: string;
  name: string;
  exchange: string;
  sector: string;
  benchmarkSymbol: string;
  benchmarkName: string;
  price: number;
  volume: number;
  perf1dPct: number;
  perf5dPct: number;
  perf1mPct: number;
  bench1dPct: number;
  bench5dPct: number;
  bench1mPct: number;
  rel1dPct: number;
  rel5dPct: number;
  rel1mPct: number;
}

export interface SectorBenchmarkSummary {
  sector: string;
  benchmarkSymbol: string;
  benchmarkName: string;
  benchmarkPrice: number;
  perf1dPct: number;
  perf5dPct: number;
  perf1mPct: number;
  avgStock1dPct: number;
  avgRel1dPct: number;
  avgRel5dPct: number;
  avgRel1mPct: number;
  stockCount: number;
  outperformCount: number;
}

export interface SectorHeatmapResponse {
  items: SectorHeatmapEntry[];
  sectors: SectorBenchmarkSummary[];
  updatedAt: string;
}

export interface TickerSearchSuggestion {
  symbol: string;
  name: string;
  exchange: string;
  type: 'EQUITY' | 'ETF' | 'INDEX' | string;
  region: 'MY' | 'US' | 'GLOBAL';
}
