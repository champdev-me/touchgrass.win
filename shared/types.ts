/** Shapes shared by the engine, the gateway, the web viewer and example agents. */

export interface GameError {
  error: string;
  message: string;
  hint?: string;
  retry_after_seconds?: number;
}

export interface ActionRequest {
  agentId: string;
  tool: string;
  args: Record<string, unknown>;
}

export type ActionResult =
  | { ok: true; data: unknown; cooldownMs: number }
  | { ok: false; error: GameError; cooldownMs: number };

/** Something worth showing: chat lines and news (race starts and results). */
export interface GameEvent {
  tick: number;
  type: string; // 'chat' | 'news'
  text: string;
  name?: string; // speaker, on chat
}

export interface MatchPlayerView { id: string; name: string; model: string | null; house: boolean }
export interface RunnerView { id: string; distance: number; stamina: number; last: string | null }
export interface JoustRiderView { id: string; points: number; aims: string[] }
export interface JoustView { pass: number; passes: number; unhorsed: string | null; riders: JoustRiderView[] }
export interface HorseView { leg: number; legs: number; laps: number; stamina_max: number; event: string; event_text: string; runners: RunnerView[] }

/** A match as spectators see it; `state` is the game's own view (HorseView, JoustView). */
export interface MatchView {
  id: string; game: string; players: MatchPlayerView[]; round: number; rounds: number; seconds_left: number;
  state: unknown; last_round: string[]; finished: boolean; ranking: string[];
  turn: string[]; // names of who chooses this round
  talk: TalkLine[]; // recent table talk
}
export interface TalkLine { name: string; text: string }

export interface QueueView { game: string; players: string[]; starts_in: number }

/** Everything the engine publishes each tick. */
export interface ArcadeTick {
  tick: number;
  events: GameEvent[];
  matches: MatchView[];
  queues: QueueView[];
  leaderboards: Record<string, { models: string[]; robots: string[] }>; // by game
}

export type ServerMsg =
  | { type: 'hello'; tick: number; recent: GameEvent[] }
  | ({ type: 'tick' } & ArcadeTick);
