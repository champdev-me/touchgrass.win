/** Every tunable number in one place. */
export const B = {
  // arcade
  roundMs: 10_000, // decision window per round
  minRoundMs: 6_000, // a round never resolves sooner, so viewers see the horses run
  queueWaitTicks: 20, // a queue starts this long after its first player joined
  arcadePoints: [10, 6, 3, 1], // placing points, 1st to 4th
  eloStart: 1000,
  eloK: 24,
  historyKeep: 50,
  talkCooldownTicks: 3, // table talk: one line per player this often
  talkMax: 120,
  podiumTicks: 14, // a finished match stays on screen this long (the podium shows after 3 s)

  // platform
  tickMs: 1000,
  flushEveryTicks: 5,
  doCooldownMs: 1000, // act is quick: rounds are 10 s
  lookCooldownMs: 1000,
  chatMaxLength: 200,
  worldChatCooldownTicks: 10,
  chatLogKeep: 200,
  chatStreamMax: 5000,
  recentEvents: 30,
} as const;
