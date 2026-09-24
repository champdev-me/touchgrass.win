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
  // combat
  attackTicks: 2, // one hit every 2 ticks while in reach
  attackReach: 1,
  fistDamage: 5,
  hunterMultiplier: 1.5,
  combatTicks: 10, // counts as "in combat" this long after a hit
  threatRadius: 3,
  combatCooldownMs: 2000,
  antiFarmTicks: 600,
  agentKillScore: 5,
  healAmount: 20,
  healRange: 2,
  fieldMedicBelow: 50,
  tummyAcheChance: 0.3,
  tummyAcheEnergy: 20,
  // creatures
  animalsPerAgent: 6,
  maxAnimals: 300,
  maxDucks: 20,
  maxRoombas: 3,
  monstersPerAgent: 2,
  monsterSpawnChance: 0.01, // per online robot per night tick
  wolfPack: 3,
  golemNightChance: 0.1,
  plazaSafeRadius: 40,
  spawnMinDist: 16,
  spawnMaxDist: 28,
  creatureActiveRadius: 48, // farther from every robot than this, creatures stand still
  creatureDespawnRadius: 96,
  aggroRadius: 32, // covers the spawn ring, so night monsters come to you
  fleeRadius: 4,
  aloneRadius: 8,
  huntTicks: 300,
  duckFollowTicks: 60,
  duckFollowRadius: 30,
  goblinFleeTicks: 30,
  roombaLootAgeTicks: 120,
  roombaSniffRadius: 20,
  wanderChance: 0.3,
  monsterBiteTicks: 4, // slower than robots swing, so a lone robot has time to fight or run
  // time: a day is 20 minutes, the last 6 are night
  dayTicks: 1200,
  nightTicks: 360,
} as const;
