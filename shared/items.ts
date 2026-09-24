import { B } from './balance.ts';
import type { Role } from './types.ts';

export type Inventory = Record<string, number>;
export type Station = 'hand' | 'workbench' | 'campfire' | 'furnace' | 'kiln';
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
  mud: { kind: 'material' }, gem: { kind: 'material' }, herb: { kind: 'material' }, brick: { kind: 'material' },
  wheat: { kind: 'material' }, wheat_seed: { kind: 'material' }, berry_seed: { kind: 'material' },
  bandage: { kind: 'food' },
  berries: { kind: 'food' }, apple: { kind: 'food' }, meat: { kind: 'food' }, battery: { kind: 'food' }, cooked_meat: { kind: 'food' },
  grass_salad: { kind: 'food' }, marshmallow: { kind: 'food' }, roasted_marshmallow: { kind: 'food' },
  stone_axe: { kind: 'tool', uses: 100, tool: { nodes: ['tree'], tier: 1 } },
  stone_pickaxe: { kind: 'tool', uses: 100, tool: { nodes: ['rock', 'iron_vein', 'crystal', 'gem_vein', 'gold_vein', 'mud'], tier: 1 } },
  iron_axe: { kind: 'tool', uses: 300, tool: { nodes: ['tree'], tier: 2 } },
  iron_pickaxe: { kind: 'tool', uses: 300, tool: { nodes: ['rock', 'iron_vein', 'crystal', 'gem_vein', 'gold_vein', 'mud'], tier: 2 } },
  club: { kind: 'weapon', uses: 150, damage: 10 },
  stone_spear: { kind: 'weapon', uses: 150, damage: 14, reach: 2 },
  iron_sword: { kind: 'weapon', uses: 400, damage: 20 },
  frying_pan: { kind: 'weapon', uses: 400, damage: 12, knockback: true },
  gem_sword: { kind: 'weapon', uses: 500, damage: 28 },
  hide_armor: { kind: 'armor', armor: 0.2 },
  iron_armor: { kind: 'armor', armor: 0.4, slow: true },
  torch: { kind: 'gear', uses: 600 }, // night ticks of light
  waterskin: { kind: 'gear', uses: 5 }, // drinks; refills at water
  backpack: { kind: 'gear' },
  lucky_charm: { kind: 'gear' }, // a chance of double yield on any gather
  hoe: { kind: 'tool', uses: 50 }, // one use per tilled farm plot
};

export const FOOD: Record<string, { food: number; water: number; energy?: number; health?: number; tummy?: boolean }> = {
  berries: { food: 8, water: 2 },
  apple: { food: 10, water: 0 },
  meat: { food: 10, water: 0, tummy: true }, // raw: may upset the stomach
  cooked_meat: { food: 35, water: 0 },
  grass_salad: { food: 5, water: 1 },
  marshmallow: { food: 2, water: 0 },
  roasted_marshmallow: { food: 5, water: 0, energy: 5 },
  battery: { food: 0, water: 0, energy: 50 }, // from Roombas; do not ask
  bandage: { food: 0, water: 0, health: 15 }, // applied, not eaten; robots do not judge
};
export const FOOD_ITEMS = Object.keys(FOOD);

export const RECIPES: Record<string, { station: Station; needs: Inventory; roles?: Role[] }> = {
  torch: { station: 'hand', needs: { wood: 1, fiber: 1 } },
  club: { station: 'hand', needs: { wood: 5 } },
  grass_salad: { station: 'hand', needs: { fiber: 5 } },
  stone_axe: { station: 'workbench', needs: { wood: 3, stone: 3, fiber: 2 }, roles: ['smith'] },
  stone_pickaxe: { station: 'workbench', needs: { wood: 3, stone: 2, fiber: 2 }, roles: ['smith'] },
  stone_spear: { station: 'workbench', needs: { wood: 3, stone: 3, fiber: 2 }, roles: ['smith'] },
  waterskin: { station: 'workbench', needs: { hide: 2, fiber: 2 }, roles: ['smith'] },
  hide_armor: { station: 'workbench', needs: { hide: 6, fiber: 4 }, roles: ['smith'] },
  cooked_meat: { station: 'campfire', needs: { meat: 1 } },
  brick: { station: 'kiln', needs: { mud: 2, wood: 1 }, roles: ['mason'] },
  bandage: { station: 'hand', needs: { fiber: 2, herb: 1 }, roles: ['gatherer'] },
  gem_sword: { station: 'workbench', needs: { iron: 4, gem: 2, wood: 2 }, roles: ['smith'] },
  lucky_charm: { station: 'workbench', needs: { gem: 1, fiber: 2 }, roles: ['smith'] },
  roasted_marshmallow: { station: 'campfire', needs: { marshmallow: 1 } },
  iron: { station: 'furnace', needs: { iron_ore: 1, wood: 1 }, roles: ['smith'] },
  iron_axe: { station: 'workbench', needs: { iron: 3, wood: 2 }, roles: ['smith'] },
  iron_pickaxe: { station: 'workbench', needs: { iron: 3, wood: 2 }, roles: ['smith'] },
  iron_sword: { station: 'workbench', needs: { iron: 5, wood: 2 }, roles: ['smith'] },
  frying_pan: { station: 'workbench', needs: { iron: 3 }, roles: ['smith'] },
  iron_armor: { station: 'workbench', needs: { iron: 8 }, roles: ['smith'] },
  backpack: { station: 'workbench', needs: { hide: 5, fiber: 5 }, roles: ['smith'] },
};

/** Weapon damage by item; bare fists are B.fistDamage. */
export const WEAPONS: Record<string, number> = Object.fromEntries(Object.entries(ITEMS).flatMap(([k, d]) => (d.damage ? [[k, d.damage]] : [])));


export type StructureKind = 'workbench' | 'campfire' | 'furnace' | 'kiln' | 'chest' | 'wood_wall' | 'stone_wall' | 'brick_wall' | 'door' | 'bed' | 'farm_plot';
export const STRUCTURES: Record<StructureKind, { needs: Inventory; roles?: Role[] }> = {
  chest: { needs: { wood: 4 } },
  campfire: { needs: { wood: 5, stone: 3 } },
  workbench: { needs: { wood: 6, stone: 2 }, roles: ['carpenter'] },
  wood_wall: { needs: { wood: 4 }, roles: ['carpenter'] },
  stone_wall: { needs: { stone: 4 }, roles: ['mason'] },
  brick_wall: { needs: { brick: 4 }, roles: ['mason'] },
  door: { needs: { wood: 6 }, roles: ['carpenter'] },
  bed: { needs: { wood: 10, fiber: 10 }, roles: ['carpenter'] },
  farm_plot: { needs: {}, roles: ['farmer'] }, // tilled with a hoe
  kiln: { needs: { stone: 8 }, roles: ['mason'] },
  furnace: { needs: { stone: 4, brick: 6 }, roles: ['mason'] },
};
export const isStructure = (s: string): s is StructureKind => s in STRUCTURES;

/** Given on join and respawn for each item the robot does not already carry. */
export const KITS: Record<Role, Inventory> = {
  miner: { stone_pickaxe: 1 }, mason: { stone_pickaxe: 1 }, smith: { wood: 6, stone: 2 },
  hunter: { stone_spear: 1 }, gatherer: { stone_axe: 1 }, scout: { torch: 1 },
  carpenter: { wood: 10 }, farmer: { hoe: 1, wheat_seed: 3 },
};

const GEAR: ItemKind[] = ['tool', 'weapon', 'armor', 'gear'];
export const isMap = (item: string): boolean => item.startsWith('treasure_map:'); // treasure_map:x,y
export const isClue = (item: string): boolean => item.startsWith('clue:'); // clue:id, see World.clues
export const stackOf = (item: string): number => (isMap(item) || isClue(item) || GEAR.includes(ITEMS[item]?.kind ?? 'material') ? 1 : B.stackSize);
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
