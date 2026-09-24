import { B } from './balance.ts';

export type Inventory = Record<string, number>;
export type Station = 'hand' | 'workbench' | 'campfire' | 'furnace';
export type ItemKind = 'material' | 'food' | 'tool' | 'weapon' | 'armor' | 'gear';

export interface ItemDef {
  kind: ItemKind;
  uses?: number; // durability; gear breaks at 0
  damage?: number; // weapons
  reach?: number;
  knockback?: boolean;
  armor?: number; // share of damage absorbed
  slow?: boolean; // walking is slower while carried
  tool?: { nodes: string[]; tier: 1 | 2 }; // speeds up gathering these nodes
}

// Gear never stacks: each one takes a bag slot.
export const ITEMS: Record<string, ItemDef> = {
  wood: { kind: 'material' }, stone: { kind: 'material' }, fiber: { kind: 'material' }, hide: { kind: 'material' },
  iron_ore: { kind: 'material' }, iron: { kind: 'material' }, crystal: { kind: 'material' },
  berries: { kind: 'food' }, apple: { kind: 'food' }, meat: { kind: 'food' }, battery: { kind: 'food' }, cooked_meat: { kind: 'food' },
  grass_salad: { kind: 'food' }, marshmallow: { kind: 'food' }, roasted_marshmallow: { kind: 'food' },
  stone_axe: { kind: 'tool', uses: 100, tool: { nodes: ['tree'], tier: 1 } },
  stone_pickaxe: { kind: 'tool', uses: 100, tool: { nodes: ['rock', 'iron_vein', 'crystal'], tier: 1 } },
  iron_axe: { kind: 'tool', uses: 300, tool: { nodes: ['tree'], tier: 2 } },
  iron_pickaxe: { kind: 'tool', uses: 300, tool: { nodes: ['rock', 'iron_vein', 'crystal'], tier: 2 } },
  club: { kind: 'weapon', uses: 150, damage: 10 },
  stone_spear: { kind: 'weapon', uses: 150, damage: 14, reach: 2 },
  iron_sword: { kind: 'weapon', uses: 400, damage: 20 },
  frying_pan: { kind: 'weapon', uses: 400, damage: 12, knockback: true },
  hide_armor: { kind: 'armor', armor: 0.2 },
  iron_armor: { kind: 'armor', armor: 0.4, slow: true },
  torch: { kind: 'gear', uses: 600 }, // night ticks of light
  waterskin: { kind: 'gear', uses: 5 }, // drinks; refills at water
  backpack: { kind: 'gear' },
};

export const FOOD: Record<string, { food: number; water: number; energy?: number; tummy?: boolean }> = {
  berries: { food: 8, water: 2 },
  apple: { food: 10, water: 0 },
  meat: { food: 10, water: 0, tummy: true }, // raw: may upset the stomach
  cooked_meat: { food: 35, water: 0 },
  grass_salad: { food: 5, water: 1 },
  marshmallow: { food: 2, water: 0 },
  roasted_marshmallow: { food: 5, water: 0, energy: 5 },
  battery: { food: 0, water: 0, energy: 50 }, // from Roombas; do not ask
};
export const FOOD_ITEMS = Object.keys(FOOD);

export const RECIPES: Record<string, { station: Station; needs: Inventory }> = {
  torch: { station: 'hand', needs: { wood: 1, fiber: 1 } },
  club: { station: 'hand', needs: { wood: 5 } },
  grass_salad: { station: 'hand', needs: { fiber: 5 } },
  stone_axe: { station: 'workbench', needs: { wood: 3, stone: 3, fiber: 2 } },
  stone_pickaxe: { station: 'workbench', needs: { wood: 3, stone: 2, fiber: 2 } },
  stone_spear: { station: 'workbench', needs: { wood: 3, stone: 3, fiber: 2 } },
  waterskin: { station: 'workbench', needs: { hide: 2, fiber: 2 } },
  hide_armor: { station: 'workbench', needs: { hide: 6, fiber: 4 } },
  cooked_meat: { station: 'campfire', needs: { meat: 1 } },
  roasted_marshmallow: { station: 'campfire', needs: { marshmallow: 1 } },
  iron: { station: 'furnace', needs: { iron_ore: 1, wood: 1 } },
  iron_axe: { station: 'workbench', needs: { iron: 3, wood: 2 } },
  iron_pickaxe: { station: 'workbench', needs: { iron: 3, wood: 2 } },
  iron_sword: { station: 'workbench', needs: { iron: 5, wood: 2 } },
  frying_pan: { station: 'workbench', needs: { iron: 3 } },
  iron_armor: { station: 'workbench', needs: { iron: 8 } },
  backpack: { station: 'workbench', needs: { hide: 5, fiber: 5 } },
};

/** Weapon damage by item; bare fists are B.fistDamage. */
export const WEAPONS: Record<string, number> = Object.fromEntries(Object.entries(ITEMS).flatMap(([k, d]) => (d.damage ? [[k, d.damage]] : [])));


export type StructureKind = 'workbench' | 'campfire' | 'furnace';
export const STRUCTURES: Record<StructureKind, Inventory> = { workbench: { wood: 6, stone: 2 }, campfire: { wood: 5, stone: 3 }, furnace: { stone: 10 } };
export const isStructure = (s: string): s is StructureKind => s in STRUCTURES;

const GEAR: ItemKind[] = ['tool', 'weapon', 'armor', 'gear'];
export const stackOf = (item: string): number => (GEAR.includes(ITEMS[item]?.kind ?? 'material') ? 1 : B.stackSize);
export const slotsOf = (inv: Inventory): number => B.inventorySlots + (inv.backpack ? B.backpackSlots : 0);

export function slotsUsed(inv: Inventory): number {
  let slots = 0;
  for (const [item, n] of Object.entries(inv)) slots += Math.ceil(n / stackOf(item));
  return slots;
}

/** How many of `item` still fit, topping up its partial stack first. */
export function room(inv: Inventory, item: string): number {
  const size = stackOf(item), rest = (inv[item] ?? 0) % size;
  return Math.max(0, (rest ? size - rest : 0) + (slotsOf(inv) - slotsUsed(inv)) * size);
}

export function addItem(inv: Inventory, item: string, n: number): number {
  const added = Math.max(0, Math.min(n, room(inv, item)));
  if (added) inv[item] = (inv[item] ?? 0) + added;
  return added;
}

export function takeItem(inv: Inventory, item: string, n = 1): boolean {
  if ((inv[item] ?? 0) < n) return false;
  inv[item] -= n;
  if (!inv[item]) delete inv[item];
  return true;
}

/** Shrinks a bag to what fits (gear first, then food, then materials) and returns the overflow. */
export function trimBag(inv: Inventory): Inventory {
  const order = (item: string) => (GEAR.includes(ITEMS[item]?.kind ?? 'material') ? 0 : ITEMS[item]?.kind === 'food' ? 1 : 2);
  const all = Object.entries(inv).sort((p, q) => order(p[0]) - order(q[0]));
  for (const k of Object.keys(inv)) delete inv[k];
  const extra: Inventory = {};
  for (const [item, n] of all) {
    const kept = addItem(inv, item, n);
    if (n > kept) extra[item] = n - kept;
  }
  return extra;
}
