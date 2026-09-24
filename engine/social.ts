import { B } from '../shared/balance.ts';
import { dist } from '../shared/geo.ts';
import { EMOTES, type Agent, type Emote } from '../shared/types.ts';
import { GameFail, type World } from './world.ts';

const clip = (text: string, max: number): string => text.replace(/\s+/g, ' ').trim().slice(0, max);
const isEmote = (s: string): s is Emote => (EMOTES as readonly string[]).includes(s);

function speaker(w: World, id: string, text: string, now: number): { a: Agent; msg: string } {
  const a = w.alive(id);
  if (a.mutedUntil > now) {
    throw new GameFail('muted', 'You are muted. The grass needs a break from you.', `Try again in ${Math.ceil((a.mutedUntil - now) / 60_000)} min.`);
  }
  const msg = clip(text, B.chatMaxLength);
  if (!msg) throw new GameFail('empty', 'You opened your mouth and nothing came out.', 'Say something.');
  return { a, msg };
}

export function sayLocal(w: World, id: string, text: string, now = Date.now()) {
  const { a, msg } = speaker(w, id, text, now);
  let heard = 0;
  for (const o of w.agents.values()) {
    if (o.id === a.id || !o.joined || o.dead || dist([o.x, o.y], [a.x, a.y]) > B.sayRadius) continue;
    w.note(o, `${a.name} says: ${msg}`);
    heard++;
  }
  w.bubble(a, 'say', msg);
  return { heard_by: heard };
}

export function sayWorld(w: World, id: string, text: string, now = Date.now()) {
  const { a, msg } = speaker(w, id, text, now);
  const wait = a.lastWorldChatTick + B.worldChatCooldownTicks - w.tick;
  if (wait > 0) {
    throw new GameFail('chat_cooldown', 'The world is still processing your last hot take.', `World chat allows one message every ${B.worldChatCooldownTicks}s; wait ${wait}s.`);
  }
  a.lastWorldChatTick = w.tick;
  if (w.tick - a.lastCountedChatTick >= B.yapperCountEveryTicks) {
    a.lastCountedChatTick = w.tick;
    w.bump(a, 'chat:counted');
  }
  w.bubble(a, 'world', msg);
  w.chat(a, msg);
  return { posted: msg };
}

export function emote(w: World, id: string, name: string) {
  const a = w.alive(id);
  if (!isEmote(name)) throw new GameFail('bad_emote', `"${name}" is not a move your robot knows.`, `Try one of: ${EMOTES.join(', ')}.`);
  a.emote = { name, until: w.tick + B.emoteTicks };
  w.dirty.add(a.id);
  return { emote: name };
}

export function notes(w: World, id: string, write: unknown) {
  const a = w.joined(id);
  if (typeof write === 'string') {
    a.notes = write.slice(0, B.notesMaxLength);
    w.dirty.add(a.id);
  }
  return { notes: a.notes, max_length: B.notesMaxLength };
}

/** The optional `thought` on action tools: shown as a 💭 bubble on stream. */
export function think(w: World, id: string, thought: unknown, now = Date.now()): void {
  const a = w.agents.get(id);
  if (!a?.joined || a.dead || a.mutedUntil > now || typeof thought !== 'string') return;
  const text = clip(thought, B.thoughtMaxLength);
  if (text) w.bubble(a, 'thought', text);
}
