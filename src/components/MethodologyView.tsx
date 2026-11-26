export function MethodologyView() {
  const sections = [
    {
      title: '01. Swing Fractal Pivot Detection',
      body: 'Raw 1m, 15m, 1H, 4H, daily, weekly, and monthly OHLCV candles are scanned across multi-scale rolling windows (k = 2, 3, and 4 bars on each side) to identify structural swing highs and swing lows without look-ahead bias.',
    },
    {
      title: '02. Scale-Invariant OLS Trendline Regression',
      body: 'Candidate boundary pivots are fitted via ordinary least squares linear regression. Slopes are normalized as percentage price change per bar relative to mean price so geometric tolerances apply consistently across $20 equities and $1,000+ mega-caps.',
    },
    {
      title: '03. Containment & Convergence Validation',
      body: 'Triangles and wedges require at least 78% candle close containment between upper and lower trendlines plus measurable spread narrowing toward the apex. Flags require an initial >= 8% directional impulse leg followed by < 46% retracement on contracting volume.',
    },
    {
      title: '04. Breakout Stage & Volume Confirmation',
      body: 'Patterns are categorized as Forming (inside structure), Testing Level (within 2.2%–2.5% of trigger), or Breakout (closing cleanly across the trigger boundary). Relative Volume (RVOL) compares the active session against the trailing 20-bar mean.',
    },
    {
      title: '05. Measured Move Targets & Invalidation Stops',
      body: 'Target projections add or subtract the pattern opening height (triangle spread, flagpole height, cup depth, or head-to-neckline distance) from the trigger level. Stops anchor behind the opposite structural pivot.',
    },
  ];

  return (
    <section className="mx-auto max-w-[920px] px-4 py-8 sm:px-6">
      <div className="border-b border-slate-200 pb-6 dark:border-slate-800">
        <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          Quantitative Detection Methodology
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
          TapeScope evaluates live US equity OHLCV bars using deterministic geometry rather than black-box heuristics. Every detected setup exposes its exact pivot anchors, regression slopes, and risk-reward math.
        </p>
      </div>

      <div className="mt-6 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
        {sections.map((s) => (
          <div key={s.title} className="p-6">
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
              {s.title}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
              {s.body}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
