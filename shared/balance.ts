// Every tunable number lives here so a balance pass touches one file.
export const B = {
  mapSize: 1024,
  chunkSize: 32,
  tickMs: 1000,
  flushEveryTicks: 5,
  moveBudgetPerTick: 2, // a land step costs 1, shallow water 2
  pathRadius: 128,
  vision: 8,
  scoutVision: 16,
  nightVisionFactor: 0.5,
  plazaHalf: 20,
  maxClimb: 1, // height levels a robot or creature can step up or down in one move
  rivers: 14, // per 1024x1024 map
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
  regenPerTick: 0.5, // health, only while food >= regenFood and water > regenAbove
  regenFood: 90, // heal while food is at least this
  regenAbove: 50,
  starvePerTick: -1 / 5, // health, per empty stat
  busyEnergyPerTick: -1 / 10,
  baseSize: 5,
  firstBaseFromPlaza: [20, 40],
  baseNear: [20, 100], // tiles from another robot's flag or spawn
  basePlacementGap: 12, // free tiles kept between new bases, so they can grow
  baseTries: 300,
  baseMaxSide: 32,
  switchRoleTicks: 600,
  duelStake: 50,
  answerTicks: 60,
  duelHearts: 10,
  duelMaxRounds: 60,
  duelShieldTicks: 3600,
  newcomerShieldMs: 24 * 3600 * 1000,
  chickenLimit: 3,
  duelScore: 25,
  rings: 4,
  fightQueue: 5,
  tauntMax: 80,
  duelCooldownMs: 1000,
  idleReleaseMs: 7 * 24 * 3600 * 1000,
  bedSleepMultiplier: 3,
  wheatTicks: 900,
  berryCropTicks: 1200,
  seedChance: 0.1, // per unit of grass or berries picked
  tradeRange: 3,
  offerTicks: 60,
  bigTradeGold: 50, // trades this big make world news
  treasureCount: 6,
  treasureMinFromPlaza: 64,
  treasureDigTicks: 10,
  treasureGold: [30, 80],
  chartFiber: 2,
  clueChance: 0.01, // per unit gathered from trees, grass and rocks
  clueFuzz: 8, // non-scouts read a clue as an area this wide
  clueHop: [20, 60], // tiles between finds on a trail
  noPickaxeDig: 3, // digging treasure by hand takes this many times longer
  chestSlots: 12,
  luckyChance: 0.1, // lucky charm: chance of double yield
  punchEnergy: 0.3, // per tick spent punching a node
  swingEnergy: 1, // per strike in a fight
  restEnergyPerTick: 1,
  sleepEnergyPerTick: 2,
  lowStat: 15, // food/water: interrupts, auto-eat, faster cooldown
  lowHealth: 30,
  drinkAmount: 30,
  respawnStats: 70, // food and water after a respawn
  // gathering and inventory
  gatherTicksPerUnit: 2, // loot piles; resource nodes set their own ticks
  fleeNotice: 8, // a creature charging within this many tiles triggers the flee reflex
  fleeSafe: 15, // flee until this far from the threat
  gathererMultiplier: 2,
  inventorySlots: 12,
  stackSize: 20, // gear (tools, weapons, armor) never stacks
  backpackSlots: 6,
  stationRange: 2,
  campfireTicks: 600, // lit this long when built, +this per fuel (1 wood)
  campfireLight: 6,
  torchLight: 3,
  startGold: 10,
  giveRange: 2,
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
  tummyAcheChance: 0.3,
  tummyAcheEnergy: 20,
  // creatures
  animalsPerAgent: 6,
  maxAnimals: 300,
  maxDucks: 20,
  herdMax: 3, // animals spawn in groups of 1 to this many
  maxRoombas: 3,
  monstersPerAgent: 2,
  monsterSpawnChance: 0.01, // per online robot per night tick
  wolfPack: 3,
  golemNightChance: 0.1,
  plazaSafeRadius: 40,
  spawnMinDist: 16,
  spawnMaxDist: 28, // monsters appear out of sight
  animalSpawnMin: 8, // animals appear where the follow cam can see them
  animalSpawnMax: 20,
  animalKickChance: 0.03, // per tick while a robot is within fleeRadius
  kickNewsTicks: 30, // at most one kick per this many ticks makes world chat
  creatureActiveRadius: 48, // farther from every robot than this, creatures stand still
  creatureDespawnRadius: 96,
  aggroRadius: 32, // covers the spawn ring, so night monsters come to you
  fleeRadius: 4,
  aloneRadius: 8,
  huntTicks: 300,
  duckFollowTicks: 60,
  duckFollowRadius: 30,
  duckRestTicks: 120, // after following, the duck wanders off for a while
  goblinFleeTicks: 30,
  roombaLootAgeTicks: 120,
  roombaSniffRadius: 20,
  wanderChance: 0.3,
  monsterBiteTicks: 4, // slower than robots swing, so a lone robot has time to fight or run
  // time: a day is 20 minutes, the last 6 are night
  dayTicks: 1200,
  nightTicks: 360,
} as const;
