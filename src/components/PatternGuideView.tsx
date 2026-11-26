import { ArrowDownRight, ArrowRight, ArrowUpRight, Filter } from 'lucide-react';
import type { PatternBias, PatternCategory } from '../shared/types.ts';

interface PatternGuideItem {
  name: string;
  category: PatternCategory;
  bias: PatternBias;
  triggerRule: string;
  targetMath: string;
  volumeNote: string;
  svgPath: 'asc_tri' | 'desc_tri' | 'sym_tri' | 'bull_flag' | 'bear_flag' | 'dbl_bot' | 'dbl_top' | 'cup_handle' | 'ihs' | 'hs' | 'parabola' | 'fall_wedge' | 'rise_wedge' | 'box';
}

const GUIDE_ITEMS: PatternGuideItem[] = [
  {
    name: 'Ascending Triangle',
    category: 'Triangles',
    bias: 'Bullish',
    triggerRule: 'Flat overhead resistance tested 2+ times while buyers step up higher swing lows.',
    targetMath: 'Resistance + Triangle Opening Height',
    volumeNote: 'Contracts during compression; breakout requires > 1.2x 20-day RVOL.',
    svgPath: 'asc_tri',
  },
  {
    name: 'Descending Triangle',
    category: 'Triangles',
    bias: 'Bearish',
    triggerRule: 'Flat horizontal demand floor meets sequentially lower swing highs.',
    targetMath: 'Support - Triangle Opening Height',
    volumeNote: 'Breakdown expands volume as bids below the flat floor clear.',
    svgPath: 'desc_tri',
  },
  {
    name: 'Symmetrical Triangle',
    category: 'Triangles',
    bias: 'Neutral',
    triggerRule: 'Converging lower highs and higher lows signaling volatility contraction before expansion.',
    targetMath: 'Breakout Level ± Base Opening Width',
    volumeNote: 'Dry-up inside apex followed by directional surge.',
    svgPath: 'sym_tri',
  },
  {
    name: 'Bull Flag',
    category: 'Flags & Pennants',
    bias: 'Bullish',
    triggerRule: 'Sharp impulse flagpole (>= 8%) followed by a shallow, downward-drifting channel.',
    targetMath: 'Flag Low + Prior Flagpole Height',
    volumeNote: 'Flag average volume contracts below flagpole volume before upper channel break.',
    svgPath: 'bull_flag',
  },
  {
    name: 'Bear Flag',
    category: 'Flags & Pennants',
    bias: 'Bearish',
    triggerRule: 'Sharp breakdown leg followed by a weak counter-trend relief channel.',
    targetMath: 'Flag High - Prior Bear Pole Height',
    volumeNote: 'Light volume on relief drift; expansion on lower channel failure.',
    svgPath: 'bear_flag',
  },
  {
    name: 'Double Bottom',
    category: 'Double Top & Bottom',
    bias: 'Bullish',
    triggerRule: 'Two distinct swing lows within 2.8% separated by an intervening neckline peak.',
    targetMath: 'Neckline + (Neckline - Bottom Floor)',
    volumeNote: 'Second trough prints lighter selling pressure; surge through neckline confirms.',
    svgPath: 'dbl_bot',
  },
  {
    name: 'Double Top',
    category: 'Double Top & Bottom',
    bias: 'Bearish',
    triggerRule: 'Twin rejection peaks within 2.8% separated by a support neckline trough.',
    targetMath: 'Neckline - (Peak Ceiling - Neckline)',
    volumeNote: 'Second peak often shows negative RSI divergence before neckline break.',
    svgPath: 'dbl_top',
  },
  {
    name: 'Cup & Handle',
    category: 'Cup & Handle',
    bias: 'Bullish',
    triggerRule: 'Rounded U-base recovery back near left rim followed by a tight upper-half pullback handle.',
    targetMath: 'Rim Pivot + Cup Base Depth',
    volumeNote: 'Handle drifts on quiet turnover prior to high-volume rim breakout.',
    svgPath: 'cup_handle',
  },
  {
    name: 'Inverse Head & Shoulders',
    category: 'Head & Shoulders',
    bias: 'Bullish',
    triggerRule: 'Three-trough bottom where the central head undercuts symmetric flanking shoulders.',
    targetMath: 'Neckline + Head-to-Neckline Depth',
    volumeNote: 'Right shoulder accumulation precedes decisive neckline breakout.',
    svgPath: 'ihs',
  },
  {
    name: 'Head & Shoulders',
    category: 'Head & Shoulders',
    bias: 'Bearish',
    triggerRule: 'Three-peak distribution top with a dominant central head and symmetric shoulders.',
    targetMath: 'Neckline - Head-to-Neckline Height',
    volumeNote: 'Right shoulder rallies on weaker breadth before neckline breakdown.',
    svgPath: 'hs',
  },
  {
    name: 'Parabola Curve',
    category: 'Parabolic Curves',
    bias: 'Bullish',
    triggerRule: 'Exponentially steepening upward base fitted to a convex quadratic support arc (a > 0).',
    targetMath: 'Upper Shelf + 0.55 × Curve Height',
    volumeNote: 'Expanding institutional RVOL on each vertical phase; losing the parabolic arc invalidates.',
    svgPath: 'parabola',
  },
  {
    name: 'Falling Wedge',
    category: 'Wedges & Boxes',
    bias: 'Bullish',
    triggerRule: 'Both trendlines slope downward while converging, reflecting fading selling momentum.',
    targetMath: 'Breakout + Wedge Opening Spread',
    volumeNote: 'Upper trendline break typically accelerates out of oversold compression.',
    svgPath: 'fall_wedge',
  },
  {
    name: 'Rising Wedge',
    category: 'Wedges & Boxes',
    bias: 'Bearish',
    triggerRule: 'Both trendlines slope upward into a narrowing apex as upside follow-through stalls.',
    targetMath: 'Breakdown - Wedge Opening Spread',
    volumeNote: 'Lower trendline breach triggers rapid mean reversion.',
    svgPath: 'rise_wedge',
  },
  {
    name: 'Horizontal Breakout Box',
    category: 'Wedges & Boxes',
    bias: 'Neutral',
    triggerRule: 'Tight Darvas range (< 11.5% height) over 20–32 sessions pressing resistance or support.',
    targetMath: 'Box Edge ± Box Range Height',
    volumeNote: 'Breakouts require institutional accumulation (> 1.25x RVOL).',
    svgPath: 'box',
  },
];

function PatternBlueprint({ kind }: { kind: PatternGuideItem['svgPath'] }) {
  const strokeMain = 'stroke-slate-800 dark:stroke-slate-200';
  const strokeGuide = 'stroke-blue-600 dark:stroke-blue-400';

  return (
    <svg viewBox="0 0 180 86" className="h-20 w-full" aria-hidden="true">
      <line x1="8" y1="78" x2="172" y2="78" className="stroke-slate-100 dark:stroke-slate-800" strokeWidth="1" />
      {kind === 'asc_tri' && (
        <>
          <line x1="16" y1="22" x2="148" y2="22" className={strokeGuide} strokeWidth="1.5" strokeDasharray="4 3" />
          <line x1="16" y1="68" x2="148" y2="24" className={strokeGuide} strokeWidth="1.5" />
          <polyline points="18,64 38,24 60,52 84,24 106,38 128,23 156,10" fill="none" className={strokeMain} strokeWidth="2" />
        </>
      )}
      {kind === 'desc_tri' && (
        <>
          <line x1="16" y1="64" x2="148" y2="64" className={strokeGuide} strokeWidth="1.5" strokeDasharray="4 3" />
          <line x1="16" y1="18" x2="148" y2="62" className={strokeGuide} strokeWidth="1.5" />
          <polyline points="18,22 40,62 62,34 86,62 110,48 130,63 158,76" fill="none" className={strokeMain} strokeWidth="2" />
        </>
      )}
      {kind === 'sym_tri' && (
        <>
          <line x1="16" y1="16" x2="148" y2="43" className={strokeGuide} strokeWidth="1.5" />
          <line x1="16" y1="70" x2="148" y2="43" className={strokeGuide} strokeWidth="1.5" />
          <polyline points="18,20 42,64 66,28 90,54 114,37 134,46 160,22" fill="none" className={strokeMain} strokeWidth="2" />
        </>
      )}
      {kind === 'bull_flag' && (
        <>
          <line x1="58" y1="20" x2="132" y2="34" className={strokeGuide} strokeWidth="1.5" />
          <line x1="58" y1="38" x2="132" y2="52" className={strokeGuide} strokeWidth="1.5" />
          <polyline points="18,72 58,20 74,39 90,27 108,46 122,33 158,10" fill="none" className={strokeMain} strokeWidth="2" />
        </>
      )}
      {kind === 'bear_flag' && (
        <>
          <line x1="58" y1="50" x2="132" y2="34" className={strokeGuide} strokeWidth="1.5" />
          <line x1="58" y1="68" x2="132" y2="52" className={strokeGuide} strokeWidth="1.5" />
          <polyline points="18,14 58,66 74,47 92,60 108,40 124,52 158,76" fill="none" className={strokeMain} strokeWidth="2" />
        </>
      )}
      {kind === 'dbl_bot' && (
        <>
          <line x1="20" y1="30" x2="160" y2="30" className={strokeGuide} strokeWidth="1.5" strokeDasharray="4 3" />
          <polyline points="16,20 46,66 84,30 120,66 156,14" fill="none" className={strokeMain} strokeWidth="2" />
        </>
      )}
      {kind === 'dbl_top' && (
        <>
          <line x1="20" y1="56" x2="160" y2="56" className={strokeGuide} strokeWidth="1.5" strokeDasharray="4 3" />
          <polyline points="16,68 46,20 84,56 120,20 156,74" fill="none" className={strokeMain} strokeWidth="2" />
        </>
      )}
      {kind === 'cup_handle' && (
        <>
          <line x1="20" y1="26" x2="160" y2="26" className={strokeGuide} strokeWidth="1.5" strokeDasharray="4 3" />
          <path d="M 18 26 Q 70 84 114 26 L 130 40 L 146 26 L 164 12" fill="none" className={strokeMain} strokeWidth="2" />
        </>
      )}
      {kind === 'ihs' && (
        <>
          <line x1="16" y1="32" x2="160" y2="32" className={strokeGuide} strokeWidth="1.5" strokeDasharray="4 3" />
          <polyline points="16,22 38,52 58,32 84,72 110,32 132,52 162,14" fill="none" className={strokeMain} strokeWidth="2" />
        </>
      )}
      {kind === 'hs' && (
        <>
          <line x1="16" y1="54" x2="160" y2="54" className={strokeGuide} strokeWidth="1.5" strokeDasharray="4 3" />
          <polyline points="16,66 38,34 58,54 84,14 110,54 132,34 162,72" fill="none" className={strokeMain} strokeWidth="2" />
        </>
      )}
      {kind === 'parabola' && (
        <>
          <path d="M 16 70 Q 104 66 154 14" fill="none" className={strokeGuide} strokeWidth="1.8" />
          <line x1="94" y1="30" x2="162" y2="30" className={strokeGuide} strokeWidth="1.3" strokeDasharray="4 3" />
          <polyline points="16,68 38,63 54,65 78,56 92,58 114,42 126,44 146,24 160,10" fill="none" className={strokeMain} strokeWidth="2" />
        </>
      )}
      {kind === 'fall_wedge' && (
        <>
          <line x1="16" y1="14" x2="146" y2="56" className={strokeGuide} strokeWidth="1.5" />
          <line x1="16" y1="44" x2="146" y2="66" className={strokeGuide} strokeWidth="1.5" />
          <polyline points="18,18 40,48 64,29 88,56 112,44 132,62 160,26" fill="none" className={strokeMain} strokeWidth="2" />
        </>
      )}
      {kind === 'rise_wedge' && (
        <>
          <line x1="16" y1="44" x2="146" y2="20" className={strokeGuide} strokeWidth="1.5" />
          <line x1="16" y1="72" x2="146" y2="30" className={strokeGuide} strokeWidth="1.5" />
          <polyline points="18,68 42,40 66,56 90,30 112,41 132,24 160,64" fill="none" className={strokeMain} strokeWidth="2" />
        </>
      )}
      {kind === 'box' && (
        <>
          <line x1="20" y1="28" x2="136" y2="28" className={strokeGuide} strokeWidth="1.5" strokeDasharray="4 3" />
          <line x1="20" y1="60" x2="136" y2="60" className={strokeGuide} strokeWidth="1.5" strokeDasharray="4 3" />
          <polyline points="16,68 32,30 56,58 80,30 104,56 128,28 158,12" fill="none" className={strokeMain} strokeWidth="2" />
        </>
      )}
    </svg>
  );
}

interface PatternGuideViewProps {
  onFilterByCategory: (category: PatternCategory) => void;
}

export function PatternGuideView({ onFilterByCategory }: PatternGuideViewProps) {
  return (
    <section className="mx-auto max-w-[1440px] px-4 py-8 sm:px-6">
      <div className="mb-8 border-b border-slate-200 pb-6 dark:border-slate-800">
        <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          US Equity Chart Pattern Reference
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600 dark:text-slate-400">
          All 13 structural formations scanned by TapeScope across US stocks and ETFs, showing exact breakout trigger definitions, measured move target math, and volume confirmation rules.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {GUIDE_ITEMS.map((item) => (
          <article
            key={item.name}
            className="flex flex-col justify-between rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
          >
            <div>
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                  {item.name}
                </h2>
                <span
                  className={`inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap shrink-0 ${
                    item.bias === 'Bullish'
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : item.bias === 'Bearish'
                      ? 'text-rose-700 dark:text-rose-400'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {item.bias === 'Bullish' && <ArrowUpRight className="h-3.5 w-3.5" />}
                  {item.bias === 'Bearish' && <ArrowDownRight className="h-3.5 w-3.5" />}
                  {item.bias === 'Neutral' && <ArrowRight className="h-3.5 w-3.5" />}
                  {item.bias}
                </span>
              </div>

              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {item.category}
              </div>

              <div className="my-4 border-y border-slate-100 py-3 dark:border-slate-800">
                <PatternBlueprint kind={item.svgPath} />
              </div>

              <dl className="space-y-2 text-xs leading-relaxed">
                <div>
                  <dt className="font-semibold text-slate-700 dark:text-slate-300">Trigger Rule</dt>
                  <dd className="text-slate-600 dark:text-slate-400">{item.triggerRule}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-slate-700 dark:text-slate-300">Measured Target</dt>
                  <dd className="font-mono text-[11px] text-slate-600 dark:text-slate-400">
                    {item.targetMath}
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold text-slate-700 dark:text-slate-300">Volume Signature</dt>
                  <dd className="text-slate-600 dark:text-slate-400">{item.volumeNote}</dd>
                </div>
              </dl>
            </div>

            <div className="mt-5 pt-4 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => onFilterByCategory(item.category)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 whitespace-nowrap"
              >
                <Filter className="h-3.5 w-3.5" />
                <span>Filter scanner for {item.category}</span>
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
