// Phase 2 — significance filter.
// Scores each diff event 0..100 from three signals and gates alerts:
//   1. trader rank        — a #1 trader moving matters more than #10
//   2. book share         — position notional vs the trader's whole book (conviction)
//   3. unusualness        — flip > open > close > resize
// Thresholds/weights live in config.js (config.significance).

const clamp01 = (x) => Math.max(0, Math.min(1, x));

export function scoreEvent(ev, cfg) {
  const { weights, unusualness, droppedTraderFactor = 0.5 } = cfg;

  const rankShare = clamp01((11 - (ev.trader?.rank ?? 10)) / 10); // rank 1 → 1.0, rank 10 → 0.1
  const bookShare = ev.bookNotionalUsd > 0 ? clamp01(ev.notionalUsd / ev.bookNotionalUsd) : 0;
  const unusualShare = unusualness[ev.type] ?? 0.3;

  const rankScore = rankShare * weights.rank;
  const bookScore = bookShare * weights.bookShare;
  const unusualScore = unusualShare * weights.unusualness;

  let score = rankScore + bookScore + unusualScore;
  if (ev.traderDropped) score *= droppedTraderFactor;

  return {
    score: Math.round(score * 10) / 10,
    bookShare,
    parts: {
      rank: Math.round(rankScore * 10) / 10,
      bookShare: Math.round(bookScore * 10) / 10,
      unusualness: Math.round(unusualScore * 10) / 10,
    },
  };
}

// Annotate every event with its significance and whether it clears the alert bar.
export function assessEvents(events, cfg) {
  return events.map((ev) => {
    const significance = scoreEvent(ev, cfg);
    const bigEnough = ev.notionalUsd >= cfg.minNotionalUsd;
    const alert = bigEnough && significance.score >= cfg.alertThreshold;
    const filteredReason = alert
      ? null
      : !bigEnough
        ? `notional ${Math.round(ev.notionalUsd).toLocaleString('en-US')} < min ${cfg.minNotionalUsd.toLocaleString('en-US')}`
        : `score ${significance.score} < threshold ${cfg.alertThreshold}`;
    return { ...ev, significance, alert, filteredReason };
  });
}
