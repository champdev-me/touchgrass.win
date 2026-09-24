import { RECIPES, addItem, takeItem } from '../shared/items.ts';
import { addScore } from './score.ts';
import { GameFail, type World } from './world.ts';

export function craft(w: World, id: string, item: string) {
  const a = w.alive(id);
  const recipe = RECIPES[item];
  if (!recipe) throw new GameFail('unknown_recipe', `Nobody knows how to make "${item}".`, `Craftable now: ${Object.keys(RECIPES).join(', ')}.`);
  const missing = Object.entries(recipe).filter(([m, n]) => (a.inventory[m] ?? 0) < n).map(([m, n]) => `${n - (a.inventory[m] ?? 0)} ${m}`);
  if (missing.length) throw new GameFail('missing_materials', `You need ${missing.join(', ')} more.`, 'Gather them first.');
  for (const [m, n] of Object.entries(recipe)) takeItem(a.inventory, m, n);
  if (!addItem(a.inventory, item, 1)) {
    for (const [m, n] of Object.entries(recipe)) addItem(a.inventory, m, n);
    throw new GameFail('bag_full', 'No room in your bag for it.', 'Eat or drop something first.');
  }
  w.bump(a, `craft:${item}`);
  addScore(w, a, 1);
  w.touch(a);
  return { crafted: item, inventory: a.inventory };
}
