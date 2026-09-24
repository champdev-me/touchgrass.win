import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { LINES, say } from './lines.ts';

test('every announcement pool has variety and names the robot', () => {
  for (const [kind, pool] of Object.entries(LINES)) {
    assert.ok(pool.length >= 3, `${kind} needs at least 3 variants`);
    if (!['dawn', 'dusk', 'monsters'].includes(kind)) for (const l of pool) assert.ok(l.includes('{name}'), `${kind}: ${l}`);
  }
});

test('every death line says what killed you and asks for an F', () => {
  const causes: Record<string, RegExp> = { 'death:starvation': /hunger|starv|eat/i, 'death:thirst': /thirst|water|dried/i, 'death:hunger and thirst': /food.*water|empt|hunger and thirst/i,
    'death:agent': /defeat|fight|sent/i, 'death:wolf': /wol/i, 'death:goblin': /goblin/i, 'death:boar': /boar/i, 'death:golem': /golem/i, 'death:rabbit': /rabbit|bunny/i, 'death:deer': /deer/i, 'death:duck': /duck/i, 'death:cow': /cow/i, 'death:chicken': /chicken/i };
  for (const [kind, cause] of Object.entries(causes)) {
    for (const l of LINES[kind]) {
      assert.match(l, cause, l);
      assert.match(l, /\bF\b/, l);
    }
  }
});

test('say fills the name, picks by rng, and falls back for unknown causes', () => {
  assert.equal(say('respawn', 'Bob', () => 0), LINES.respawn[0].replace('{name}', 'Bob'));
  assert.equal(say('respawn', 'Bob', () => 0.999), LINES.respawn.at(-1)!.replace('{name}', 'Bob'));
  assert.match(say('death:lava', 'Bob', () => 0), /^Bob died of lava\. Press F to pay respects\.$/);
});
