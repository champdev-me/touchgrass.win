import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { B } from '../shared/balance.ts';
import { TERRAIN as T, type Vec } from '../shared/types.ts';
import { emote, notes, sayLocal, sayWorld, think } from './social.ts';
import { GameFail, World } from './world.ts';

function world(n = 40): World {
  return new World(new Uint8Array(n * n).fill(T.MEADOW), n, () => 0.5);
}
function joined(w: World, name: string, at: Vec) {
  const a = w.register(name, 0);
  w.join(a.id, 'scout', null, 0);
  [a.x, a.y] = at;
  return a;
}
const failCode = (fn: () => unknown) => {
  try {
    fn();
    return 'ok';
  } catch (e) {
    return (e as GameFail).code;
  }
};

test('local say reaches robots within 12 tiles only and shows a bubble', () => {
  const w = world();
  const a = joined(w, 'Talker', [10, 10]);
  const near = joined(w, 'Near', [20, 10]);
  const far = joined(w, 'Far', [30, 10]);
  assert.deepEqual(sayLocal(w, a.id, '  hello   there  '), { heard_by: 1 });
  assert.equal(w.observe(near.id).inbox.at(-1), 'Talker says: hello there');
  assert.equal(w.observe(far.id).inbox.length, 0);
  assert.deepEqual(w.views().find((v) => v.id === a.id)!.bubble, { kind: 'say', text: 'hello there' });
  for (let i = 0; i <= B.bubbleTicks; i++) w.step(0);
  assert.equal(w.views().find((v) => v.id === a.id)!.bubble, null);
});

test('world chat posts to everyone, is rate limited, and counts toward Yapper once a minute', () => {
  const w = world();
  const a = joined(w, 'Yeller', [5, 5]);
  assert.deepEqual(sayWorld(w, a.id, 'grass is great'), { posted: 'grass is great' });
  const chat = w.step(0).events.filter((e) => e.type === 'chat');
  assert.deepEqual(chat.map((e) => [e.type, e.name, e.text]), [['chat', 'Yeller', 'grass is great']]);
  assert.equal(w.chatLog.at(-1), 'Yeller: grass is great');
  assert.equal(failCode(() => sayWorld(w, a.id, 'again')), 'chat_cooldown');
  assert.equal(w.step(0).events.filter((e) => e.type === 'chat').length, 0);
  for (let i = 0; i < B.worldChatCooldownTicks; i++) w.step(0);
  sayWorld(w, a.id, 'third');
  assert.equal(a.stats['chat:counted'], 1);
  for (let i = 0; i < B.yapperCountEveryTicks; i++) w.step(0);
  sayWorld(w, a.id, 'fourth');
  assert.equal(a.stats['chat:counted'], 2);
});

test('muted robots cannot talk and empty messages are refused', () => {
  const w = world();
  const a = joined(w, 'Loud', [5, 5]);
  assert.equal(failCode(() => sayLocal(w, a.id, '   ')), 'empty');
  a.mutedUntil = 10 * 60_000;
  assert.equal(failCode(() => sayWorld(w, a.id, 'hi', 60_000)), 'muted');
  assert.equal(failCode(() => sayLocal(w, a.id, 'hi', 60_000)), 'muted');
  assert.equal(sayLocal(w, a.id, 'free', 11 * 60_000).heard_by, 0);
});

test('emotes, notes and thoughts', () => {
  const w = world();
  const a = joined(w, 'Dancer', [5, 5]);
  assert.deepEqual(emote(w, a.id, 'dance'), { emote: 'dance' });
  assert.equal(w.views()[0].emote, 'dance');
  assert.equal(failCode(() => emote(w, a.id, 'moonwalk')), 'bad_emote');
  assert.deepEqual(notes(w, a.id, 'berries at 10,10'), { notes: 'berries at 10,10', max_length: B.notesMaxLength });
  assert.equal(notes(w, a.id, undefined).notes, 'berries at 10,10');
  assert.equal(notes(w, a.id, 'x'.repeat(5000)).notes.length, B.notesMaxLength);
  think(w, a.id, 'I should drink soon, probably, maybe, eventually, at some point in the future, if the world allows it, ok then fine');
  assert.equal(w.views()[0].bubble!.kind, 'thought');
  assert.ok(w.views()[0].bubble!.text.length <= B.thoughtMaxLength);
});
