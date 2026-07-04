// Smart Money Mirror — central tuning knobs.
// Everything the significance filter, digest, and adapters need to be tuned
// lives here so operators never have to dig through src/.

export const config = {
  // 'mock' (default, fully offline) | 'real' (requires credentials; see src/adapters/*)
  mode: (process.env.OKX_MODE || 'mock').toLowerCase(),

  // How many leaderboard traders we track.
  leaderboardSize: 10,

  // Diff engine thresholds.
  // SIZE_UP fires when newSize >= oldSize * sizeUpFactor  (>= +50%)
  // SIZE_DOWN fires when newSize <= oldSize * sizeDownFactor (>= -50%)
  resize: {
    sizeUpFactor: 1.5,
    sizeDownFactor: 0.5,
  },

  // Phase 2 — significance filter.
  // score = rankScore + bookShareScore + unusualnessScore   (0..100)
  //   rankScore       = (11 - rank) / 10        * weights.rank
  //   bookShareScore  = positionNotional / book * weights.bookShare
  //   unusualnessScore= unusualness[type]       * weights.unusualness
  significance: {
    weights: { rank: 35, bookShare: 35, unusualness: 30 },
    // How surprising each event type is (flip > open > close > resize).
    unusualness: { FLIP: 1.0, OPEN: 0.7, CLOSE: 0.55, SIZE_UP: 0.5, SIZE_DOWN: 0.4 },
    // Only events scoring >= alertThreshold go out to subscribers.
    alertThreshold: 65,
    // Events below this notional never alert regardless of score.
    minNotionalUsd: 250_000,
    // Score multiplier when the "close" is really the trader falling off the
    // leaderboard (we lose sight of the position, they didn't necessarily exit).
    droppedTraderFactor: 0.5,
  },

  // Phase 3 — analyst (LLM adapter).
  llm: {
    // Cheap + fast is right for one-paragraph takes fired on every alert.
    // Bump to 'claude-opus-4-8' if take quality ever matters more than cost.
    model: 'claude-haiku-4-5',
    maxTokens: 300,
  },

  // Dispatch / digest.
  telegram: {
    parseMode: 'HTML',
    channelHandle: 't.me/SmartMoneyMirror', // public funnel channel (planned)
  },
  digest: {
    topMoves: 5,
    hashtag: '#okxai',
    tweetMaxChars: 280,
  },
};

export const mode = config.mode;
export default config;
