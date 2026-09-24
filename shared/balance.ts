// Every tunable number lives here so a balance pass touches one file.
export const B = {
  mapSize: 1024,
  chunkSize: 32,
  tickMs: 1000,
  flushEveryTicks: 5,
  moveBudgetPerTick: 2, // a land step costs 1, shallow water 2
  pathRadius: 128,
  vision: 8,
  scoutVision: 15,
  nightVisionFactor: 0.5,
  plazaHalf: 20,
  spawnMinPlazaDist: 50,
  inboxMax: 20,
  doCooldownMs: 5000,
  lowStatCooldownMs: 3000,
  lookCooldownMs: 1000,
  maxActiveAgents: 200,
  activeWindowMs: 24 * 60 * 60 * 1000,
  chunkRequestsPerWindow: 400, // per spectator socket, enough to load a view and pan fast
  chunkWindowMs: 10_000,
  // body: every stat runs 0-100, higher is better
  foodPerTick: -1 / 30,
  waterPerTick: -1 / 20,
  regenPerTick: 1 / 10, // health, while food and water are both above regenAbove
  regenAbove: 50,
  starvePerTick: -1 / 5, // health, per empty stat
  busyEnergyPerTick: -1 / 10,
  restEnergyPerTick: 1,
  sleepEnergyPerTick: 2,
  lowStat: 15, // food/water: interrupts, auto-eat, faster cooldown
  lowHealth: 30,
  drinkAmount: 30,
  respawnStats: 70, // food and water after a respawn
  // gathering and inventory
  gatherTicksPerUnit: 2,
  gathererMultiplier: 2,
  inventorySlots: 20,
  stackSize: 50,
  gatherUntilFull: 9999,
  // death
  respawnTicks: 30,
  lootTicks: 900,
  speedrunTicks: 60,
  awayAfterMs: 2 * 60 * 1000, // no tool calls for this long = announced as gone
  recentEvents: 20, // announcements a new spectator sees on connect
  // chat and social
  chatMaxLength: 200,
  sayRadius: 12,
  worldChatCooldownTicks: 10,
  bubbleTicks: 5,
  emoteTicks: 4,
  thoughtMaxLength: 120,
  notesMaxLength: 2048,
  chatHistory: 10, // world chat lines shown in observe
  chatLogKeep: 50, // lines the engine keeps in memory
  chatStreamMax: 10_000, // lines kept in the Redis stream for read_chat
  // scoring and achievements
  aliveScoreEveryTicks: 60,
  gatherScoreEvery: 20,
  yapperCountEveryTicks: 60, // at most one chat message per minute counts toward Yapper
  cursedBadgeTicks: 3600,
  cartographerShare: 0.5,
  unkillableTicks: 86_400,
  // time: a day is 20 minutes, the last 6 are night
  dayTicks: 1200,
  nightTicks: 360,
} as const;
