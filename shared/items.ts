import { B } from './balance.ts';

export const FOOD: Record<string, { food: number; water: number }> = {
  berries: { food: 8, water: 2 },
  apple: { food: 10, water: 0 },
};
export const FOOD_ITEMS = Object.keys(FOOD);

export type Inventory = Record<string, number>;

export function slotsUsed(inv: Inventory): number {
  let slots = 0;
  for (const n of Object.values(inv)) slots += Math.ceil(n / B.stackSize);
  return slots;
}

/** How many of `item` still fit, topping up its partial stack first. */
export function room(inv: Inventory, item: string): number {
  const rest = (inv[item] ?? 0) % B.stackSize;
  return (rest ? B.stackSize - rest : 0) + (B.inventorySlots - slotsUsed(inv)) * B.stackSize;
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
