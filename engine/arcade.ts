import { B } from '../shared/balance.ts';
import type { ArcadeTick, GameEvent, MatchView } from '../shared/types.ts';
import { eloUpdate } from './elo.ts';
import { GameFail } from './errors.ts';
import type { Game, Option } from './games/game.ts';
import { GAMES, GAME_EMOJI } from './games/index.ts';

export interface Player {
  id: string; name: string; model: string | null; house: boolean; createdAt: number;
  points: number; elo: Record<string, number>; wins: Record<string, number>; played: Record<string, number>;
  mutedUntil: number; banned: boolean; lastSeen: number; lastChatTick: number;
}
interface Queue { players: string[]; since: number }
export interface Match {
  id: string; game: Game<unknown>; state: unknown; players: string[];
  choices: Map<string, number>; roundEndsAt: number; lastRound: string[];
  finishedAt: number | null; ranking: string[];
  talk: { name: string; text: string }[]; lastTalk: Map<string, number>;
  openAt: number; // the tick the current round opened (after any pause)
}
export interface MatchRecord { id: string; game: string; tick: number; at: number; ranking: string[]; names: string[] }

const HOUSE_NAMES = ['Bot Dobbin', 'Bot Clover', 'Bot Biscuit', 'Bot Thunder', 'Bot Pickles', 'Bot Noodle', 'Bot Rocket', 'Bot Maple'];
const roundTicks = (g: Game<unknown>) => (g.roundMs ?? B.roundMs) / B.tickMs, minTicks = (g: Game<unknown>) => (g.minRoundMs ?? B.minRoundMs) / B.tickMs;

export class Arcade {
  players = new Map<string, Player>();
  queues = new Map<string, Queue>();
  matches: Match[] = [];
  events: GameEvent[] = [];
  chatLog: string[] = [];
  records: MatchRecord[] = [];
  tick = 0;
  nextId = 1;
  nextMatch = 1;
  dirty = new Set<string>(); // players to persist

  constructor(public rng: () => number = Math.random) {}

  register(name: string, now = Date.now()): Player {
    const lower = name.toLowerCase();
    for (const p of this.players.values()) if (p.name.toLowerCase() === lower) throw new GameFail('name_taken', `Someone already plays as "${name}".`, 'Pick another name.');
    const p = this.blank(`agent_${this.nextId++}`, name, false, now);
    this.players.set(p.id, p);
    this.dirty.add(p.id);
    return p;
  }

  private blank(id: string, name: string, house: boolean, now = Date.now()): Player {
    return { id, name, model: null, house, createdAt: now, points: 0, elo: {}, wins: {}, played: {}, mutedUntil: 0, banned: false, lastSeen: now, lastChatTick: -1_000_000 };
  }

  get(id: string): Player {
    const p = this.players.get(id);
    if (!p) throw new GameFail('unknown_agent', 'Your robot does not exist. Spooky.', 'Sign up again.');
    if (p.banned) throw new GameFail('banned', 'You are banned from the arcade.', 'Contact the admin if you think this is a mistake.');
    return p;
  }

  matchOf(id: string): Match | undefined {
    return this.matches.find((m) => m.finishedAt === null && m.players.includes(id));
  }

  private queuedFor(id: string): string | undefined {
    for (const [game, q] of this.queues) if (q.players.includes(id)) return game;
    return undefined;
  }

  play(id: string, game: string, model?: string | null) {
    const p = this.get(id), g = GAMES[game];
    if (!g) throw new GameFail('unknown_game', `There is no "${game}" here.`, `Games: ${Object.keys(GAMES).join(', ')}.`);
    if (this.matchOf(id) || this.queuedFor(id)) throw new GameFail('busy', 'You are already queued or playing.', 'Finish or leave_queue first.');
    if (model) p.model = model.slice(0, 40);
    const q = this.queues.get(game) ?? { players: [], since: this.tick };
    if (!q.players.length) q.since = this.tick;
    q.players.push(id);
    this.queues.set(game, q);
    this.dirty.add(id);
    return { queued: game, position: q.players.length, starts_in_seconds: Math.max(0, q.since + B.queueWaitTicks - this.tick) };
  }

  leaveQueue(id: string) {
    this.get(id);
    const game = this.queuedFor(id);
    if (!game) throw new GameFail('not_queued', 'You are not in a queue.', 'play(game) to join one.');
    const q = this.queues.get(game)!;
    q.players = q.players.filter((x) => x !== id);
    return { left: game };
  }

  act(id: string, option: number, say?: string) {
    this.get(id);
    const m = this.matchOf(id);
    if (!m) throw new GameFail('not_in_match', 'You are not in a match.', 'play(game) and wait for it to start.');
    const actors = this.actors(m);
    if (!actors.includes(id)) throw new GameFail('not_your_turn', `It is ${actors.map(this.name).join(', ')}'s turn.`, 'observe until it is yours; talk works any time.');
    const valid = m.game.options(m.state, id).map((o) => o.id);
    if (!valid.includes(option)) throw new GameFail('bad_option', `Option ${option} is not on your menu.`, `Pick one of: ${valid.join(', ')}.`);
    m.choices.set(id, option);
    if (say?.trim()) {
      try {
        this.talk(id, say);
      } catch {
        // a line during the talk cooldown is dropped; the move still counts
      }
    }
    return { chosen: option, resolves_in_seconds: Math.max(0, m.roundEndsAt - this.tick) };
  }

  /** Table talk: a short line everyone in the match and every viewer sees. */
  talk(id: string, text: string) {
    const p = this.get(id), m = this.matchOf(id), clean = text.trim().slice(0, B.talkMax);
    if (!m) throw new GameFail('not_in_match', 'Talk is for the table you play at.', 'say_world reaches everyone.');
    if (!clean) throw new GameFail('empty', 'Say something.', 'talk(text)');
    if (p.mutedUntil > Date.now()) throw new GameFail('muted', 'You are muted for a while.', 'Touch some grass.');
    if (this.tick - (m.lastTalk.get(id) ?? -1e9) < B.talkCooldownTicks) throw new GameFail('rate_limited', 'Talk cooldown.', `One line per ${B.talkCooldownTicks}s.`);
    m.lastTalk.set(id, this.tick);
    m.talk.push({ name: p.name, text: clean });
    m.talk.splice(0, Math.max(0, m.talk.length - 12));
    return { said: clean };
  }

  private actors = (m: Match) => m.game.actors?.(m.state) ?? m.players;

  private name = (id: string) => this.players.get(id)?.name ?? id;
  private named = (line: string, m: Match) => m.players.reduce((l, id) => l.replaceAll(id, this.name(id)), line);

  observe(id: string) {
    const p = this.get(id), m = this.matchOf(id), queued = this.queuedFor(id);
    if (m) {
      const view = m.game.playerView?.(m.state, id) ?? m.game.view(m.state), actors = this.actors(m);
      return {
        status: 'in_match' as const, game: m.game.id, match: m.id, round: m.game.round(m.state), rounds: m.game.rounds, // rounds played so far
        seconds_left: Math.max(0, m.roundEndsAt - this.tick), chosen: m.choices.get(id) ?? null, turn: actors.map(this.name),
        options: (actors.includes(id) ? m.game.options(m.state, id) : []) as Option[], state: this.renameView(view, m), last_round: m.lastRound,
        talk: m.talk.slice(-8), you: p.name,
      };
    }
    if (queued) {
      const q = this.queues.get(queued)!;
      return { status: 'queued' as const, game: queued, position: q.players.indexOf(id) + 1, starts_in_seconds: Math.max(0, q.since + B.queueWaitTicks - this.tick), you: p.name };
    }
    return { status: 'lobby' as const, you: p.name, hint: `play {"game": "${Object.keys(GAMES)[0]}"} to join a match.`, last_result: this.history(id)[0] ?? null };
  }

  /** A game view with player ids swapped for names, for observe and spectators. */
  private renameView(view: unknown, m: Match): unknown {
    return JSON.parse(m.players.reduce((j, id) => j.replaceAll(`"${id}"`, JSON.stringify(this.name(id))), JSON.stringify(view)));
  }

  lobby(id: string) {
    const me = this.observe(id);
    return {
      you: me,
      games: Object.values(GAMES).map((g) => ({ id: g.id, name: g.name, players: `${g.minPlayers}-${g.maxPlayers}`, queued: this.queues.get(g.id)?.players.length ?? 0 })),
      live: this.matches.filter((m) => m.finishedAt === null).map((m) => ({ match: m.id, game: m.game.id, round: m.game.round(m.state), players: m.players.map(this.name) })),
    };
  }

  leaderboard(game = 'horse_race') {
    const humans = [...this.players.values()].filter((p) => !p.house && (p.played[game] ?? 0) > 0);
    const models = new Map<string, number[]>();
    for (const p of humans) models.set(p.model ?? 'unknown', [...(models.get(p.model ?? 'unknown') ?? []), p.elo[game] ?? B.eloStart]);
    return {
      game,
      robots: humans.sort((a, b) => (b.elo[game] ?? 0) - (a.elo[game] ?? 0)).slice(0, 10).map((p, i) => `${i + 1}. ${p.name} (${p.model ?? '?'}) Elo ${p.elo[game]}, ${p.wins[game] ?? 0}/${p.played[game]} wins`),
      models: [...models].map(([m, e]) => [m, Math.round(e.reduce((s, x) => s + x, 0) / e.length), e.length] as const).sort((a, b) => b[1] - a[1]).map(([m, e, n], i) => `${i + 1}. ${m}: Elo ${e} (${n} robots)`),
      points: [...this.players.values()].filter((p) => !p.house).sort((a, b) => b.points - a.points).slice(0, 10).map((p, i) => `${i + 1}. ${p.name} ${p.points}`),
    };
  }

  history(id: string) {
    return this.records.filter((r) => r.ranking.includes(id)).slice(0, 10).map((r) => `${GAME_EMOJI[r.game] ?? ''} ${r.game}: ${r.names.map((n, i) => `${i + 1}. ${n}`).join(', ')}`);
  }

  say(id: string, text: string): string {
    const p = this.get(id), clean = text.trim().slice(0, B.chatMaxLength);
    if (!clean) throw new GameFail('empty', 'Say something.', 'say_world(text)');
    if (p.mutedUntil > Date.now()) throw new GameFail('muted', 'You are muted for a while.', 'Touch some grass.');
    if (this.tick - p.lastChatTick < B.worldChatCooldownTicks) throw new GameFail('rate_limited', 'Chat cooldown.', `One message per ${B.worldChatCooldownTicks}s.`);
    p.lastChatTick = this.tick;
    this.chat(p.name, clean);
    return clean;
  }

  chat(name: string, text: string): void {
    this.chatLog.push(`${name}: ${text}`);
    this.chatLog.splice(0, Math.max(0, this.chatLog.length - B.chatLogKeep));
    this.events.push({ tick: this.tick, type: 'chat', text, name });
  }

  news(text: string): void {
    this.chatLog.push(text);
    this.events.push({ tick: this.tick, type: 'news', text });
  }

  private house(taken: Set<string>): string {
    for (let i = 0; ; i++) {
      const id = `house_${i}`;
      if (taken.has(id) || this.matches.some((m) => m.finishedAt === null && m.players.includes(id))) continue;
      if (!this.players.has(id)) this.players.set(id, this.blank(id, HOUSE_NAMES[i % HOUSE_NAMES.length] + (i >= HOUSE_NAMES.length ? ` ${Math.floor(i / HOUSE_NAMES.length) + 1}` : ''), true));
      return id;
    }
  }

  private startMatch(gameId: string, q: Queue): void {
    const g = GAMES[gameId], players = q.players.splice(0, g.maxPlayers), taken = new Set(players);
    while (players.length < g.minPlayers) {
      const h = this.house(taken);
      taken.add(h);
      players.push(h);
    }
    const m: Match = { id: `match_${this.nextMatch++}`, game: g, state: g.start(players, this.rng), players, choices: new Map(), roundEndsAt: this.tick + roundTicks(g), lastRound: [], finishedAt: null, ranking: [], talk: [], lastTalk: new Map(), openAt: this.tick };
    this.matches.push(m);
    this.news(`${GAME_EMOJI[gameId] ?? '🎮'} A ${g.name.toLowerCase()} starts: ${players.map(this.name).join(', ')}!`);
  }

  private resolve(m: Match): void {
    const late: string[] = [];
    for (const id of this.actors(m)) {
      if (m.choices.has(id)) continue;
      const house = this.players.get(id)?.house;
      m.choices.set(id, house ? m.game.houseChoice(m.state, id, this.rng) : m.game.defaultOption(m.state, id));
      if (!house) late.push(id);
    }
    const lines = m.game.resolve(m.state, m.choices, this.rng).map((l) => this.named(l, m));
    m.lastRound = [...lines, ...late.map((id) => `${this.name(id)} was too slow: default move`)];
    m.choices = new Map();
    m.openAt = this.tick + (m.game.pauseMs?.(m.state) ?? 0) / B.tickMs;
    m.roundEndsAt = m.openAt + roundTicks(m.game);
    if (m.game.finished(m.state)) this.finish(m);
  }

  private finish(m: Match): void {
    m.finishedAt = this.tick;
    m.ranking = m.game.ranking(m.state);
    const gid = m.game.id, humans = m.ranking.filter((id) => !this.players.get(id)?.house);
    m.ranking.forEach((id, i) => {
      const p = this.players.get(id)!;
      if (p.house) return;
      p.points += B.arcadePoints[i] ?? 0;
      p.played[gid] = (p.played[gid] ?? 0) + 1;
      if (i === 0) p.wins[gid] = (p.wins[gid] ?? 0) + 1;
      this.dirty.add(id);
    });
    if (humans.length >= 2) {
      const next = eloUpdate(humans, (id) => this.players.get(id)!.elo[gid] ?? B.eloStart, B.eloK);
      for (const [id, e] of next) this.players.get(id)!.elo[gid] = e;
    } else for (const id of humans) this.players.get(id)!.elo[gid] ??= B.eloStart;
    const [first, ...rest] = m.ranking.map((id) => this.players.get(id)!);
    this.news(`${GAME_EMOJI[gid] ?? '🎮'} ${first.name} wins the ${m.game.name.toLowerCase()}${first.model ? ` (${first.model})` : ''} ahead of ${rest.slice(0, 2).map((p) => p.name).join(' and ')}!`);
    this.records.unshift({ id: m.id, game: gid, tick: this.tick, at: Date.now(), ranking: m.ranking, names: m.ranking.map(this.name) });
    this.records.splice(B.historyKeep);
  }

  /** One tick: start due queues, resolve due rounds, drop old finished matches. */
  step(): ArcadeTick {
    this.tick++;
    for (const [gameId, q] of this.queues) {
      if (!q.players.length) continue;
      if (q.players.length >= GAMES[gameId].maxPlayers || this.tick - q.since >= B.queueWaitTicks) this.startMatch(gameId, q);
    }
    for (const m of this.matches) {
      if (m.finishedAt !== null) continue;
      const humans = this.actors(m).filter((id) => !this.players.get(id)?.house); // none: a house bot's turn resolves at the minimum
      const early = this.tick >= m.openAt + minTicks(m.game) && humans.every((id) => m.choices.has(id));
      if (this.tick >= m.roundEndsAt || early) this.resolve(m);
    }
    this.matches = this.matches.filter((m) => m.finishedAt === null || this.tick - m.finishedAt <= B.podiumTicks);
    const events = this.events;
    this.events = [];
    const leaderboards = Object.fromEntries(Object.keys(GAMES).map((g) => {
      const b = this.leaderboard(g);
      return [g, { models: b.models, robots: b.robots }];
    }));
    return { tick: this.tick, events, leaderboards, matches: this.matches.map((m): MatchView => ({ id: m.id, game: m.game.id, players: m.players.map((id) => ({ id, name: this.name(id), model: this.players.get(id)?.model ?? null, house: Boolean(this.players.get(id)?.house) })), round: m.game.round(m.state), rounds: m.game.rounds, seconds_left: Math.max(0, m.roundEndsAt - this.tick), state: this.renameView(m.game.view(m.state), m), last_round: m.lastRound, finished: m.finishedAt !== null, ranking: m.ranking.map(this.name), turn: this.actors(m).map(this.name), talk: m.talk.slice(-8), pause_left: Math.max(0, m.openAt - this.tick) })), queues: [...this.queues].map(([game, q]) => ({ game, players: q.players.map(this.name), starts_in: Math.max(0, q.since + B.queueWaitTicks - this.tick) })) };
  }
}
