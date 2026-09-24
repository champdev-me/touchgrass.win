// Hand-drawn 16x16 icons for the HUD, so panels need no words or emoji. Stroke icons start with "s:".
const P: Record<string, string> = {
  // body
  health: 'M8 14.5 1.6 8.3A3.7 3.7 0 0 1 8 3.6a3.7 3.7 0 0 1 6.4 4.7z',
  food: 'M10.5 1.5a4 4 0 0 1 0 8L7 13a1.6 1.6 0 1 1-2.3-.5 1.6 1.6 0 1 1-.2-2.3L8 6.7a4 4 0 0 1 2.5-5.2z',
  water: 'M8 1s-5 6-5 9.2a5 5 0 0 0 10 0C13 7 8 1 8 1z',
  energy: 'M9.5 1 3 9h4.2l-1 6L13 7H8.8z',
  // what it is doing
  idle: 'M8 1a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM5.5 6h5l.8 5H9.5v4h-3v-4H4.7z',
  move_to: 'M4 9c1.5 0 2 1.2 2 2.6S5.3 15 4 15s-2-1.3-2-2.8S2.5 9 4 9zm7-8c1.5 0 2 1.4 2 3s-.7 3-2 3-2-1.4-2-3 .5-3 2-3zM3 7.5h2v1H3zm7.5-1.5h2v1h-2z',
  gather: 'M6 1.5h1.5v6H8V2.5h1.5v5H10V3.5h1.5v6.2c0 3-1.8 4.8-4.3 4.8-2 0-3.2-1-4.2-2.8L1.5 8.4l1.2-.8L4.5 10V2.5H6z',
  attack: 's:M2 2l8 8M14 2 6 10M3.5 12.5l2-2M12.5 12.5l-2-2M2 14l2-2M14 14l-2-2',
  rest: 'M3 2h2v6h6V5h2v10h-2v-3H5v3H3z',
  sleep: 'M10.5 1.5A6.5 6.5 0 1 0 14.5 11 5.5 5.5 0 0 1 10.5 1.5z',
  flee: 'M9 1.5a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6zM6 6l3.5-.5 2 2.5H14v1.5h-3.2L9.5 8l-.8 2.5 2.3 2V15H9.5v-2L7.6 11.4 6.5 15H5l1.4-6-1.2.8-.9 2.2-1.4-.6 1.2-2.8z',
  dead: 'M8 1.5c3.5 0 6 2.3 6 5.4 0 2-1 3.2-2.3 3.9V13a1 1 0 0 1-1 1H5.3a1 1 0 0 1-1-1v-2.2C3 10.1 2 8.9 2 6.9 2 3.8 4.5 1.5 8 1.5zM5.5 6.2a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6zm5 0a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6z',
  away: 's:M3 8a5 5 0 1 0 10 0A5 5 0 1 0 3 8M4.5 4.5l7 7',
  pin: 'M8 1a4.8 4.8 0 0 1 4.8 4.8C12.8 9.9 8 15 8 15S3.2 9.9 3.2 5.8A4.8 4.8 0 0 1 8 1zm0 2.8a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  sun: 's:M8 5a3 3 0 1 1 0 6 3 3 0 0 1 0-6M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3 3l1 1M12 12l1 1M3 13l1-1M12 4l1-1',
  // score
  season: 'M4 1.5h8V5a4 4 0 0 1-3.2 3.9v2.3H11v2.3H5v-2.3h2.2V8.9A4 4 0 0 1 4 5zM1.5 2.5H3.3v2.6H1.5zm11.2 0h1.8v2.6h-1.8z',
  life: 's:M1 8.5h3l1.8-4.5 3 9 1.9-4.5H15',
  trophies: 'M8 1l2.1 4.4 4.8.6-3.5 3.3.9 4.8L8 11.7l-4.3 2.4.9-4.8L1.1 6l4.8-.6z',
  // roles
  gatherer: 'M2 6h12l-1.5 8h-9zM5 6c0-2 1.3-4 3-4s3 2 3 4H9.5c0-1.2-.6-2.5-1.5-2.5S6.5 4.8 6.5 6z',
  hunter: 's:M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3M8 3.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9',
  builder: 'M9 1.5l4 2.5-1.5 2.4-1.6-1L4.5 14.5 2.5 13.2 7.9 4.1l-1.5-1z',
  medic: 'M6 1.5h4v4.5h4.5v4H10v4.5H6V10H1.5V6H6z',
  scout: 'M8 3.5C4.4 3.5 1.8 6.3 1 8c.8 1.7 3.4 4.5 7 4.5s6.2-2.8 7-4.5c-.8-1.7-3.4-4.5-7-4.5zm0 1.8a2.7 2.7 0 1 1 0 5.4 2.7 2.7 0 0 1 0-5.4z',
  // bag items
  wood: 'M3 5.5h8.5a2.5 2.5 0 0 1 0 5H3a2.5 2.5 0 0 1 0-5zm8.5 1.3a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4z',
  berries: 'M5 7a2.6 2.6 0 1 1 0 5.2A2.6 2.6 0 0 1 5 7zm6 0a2.6 2.6 0 1 1 0 5.2A2.6 2.6 0 0 1 11 7zM8 2.5a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2z',
  stone: 'M4 5l3-2.5 5 1.5 2 5-3 4.5H5L2 10z',
  fiber: 's:M4 15C4 9 3 6 1.5 3.5M8 15V2M12 15c0-6 1-9 2.5-11.5M6 15c0-4-.5-6-1.5-8M10 15c0-4 .5-6 1.5-8',
  meat: 'M6 2.5c3.8-.8 8 1.8 8 5.5 0 3.3-3 5.5-6.5 5.5C4 13.5 2 11.5 2 9c0-2.7 1.6-5.9 4-6.5zm3 3.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z',
  hide: 'M4 2l2 2h4l2-2 2 3-1.5 2.5L14 11l-3 3-3-1.5L5 14l-3-3 1.5-3.5L2 5z',
  apple: 'M8 4.5c1.5-1.2 5-1.2 5.8 2 .8 3.8-2 7.5-4 7.5-1 0-1.3-.5-1.8-.5s-.8.5-1.8.5c-2 0-4.8-3.7-4-7.5.8-3.2 4.3-3.2 5.8-2zM8 4.3C8 2.7 9 1.5 10.5 1.2 10.5 2.8 9.6 4 8 4.3z',
  club: 'M11.5 1.5a3 3 0 0 1 2.3 5L6.2 14a1.6 1.6 0 0 1-2.2 0l-2-2a1.6 1.6 0 0 1 0-2.2l7.5-7.6a3 3 0 0 1 2-.7z',
  battery: 'M2 5h10.5v6H2zM13.5 6.8H15v2.4h-1.5zM3.5 6.5v3h3v-3z',
  crystal: 'M8 1l5 5-5 9-5-9zM5.5 6h5L8 1.8z',
  item: 'M3 3h10v10H3z',
  gold: 'M8 1.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zm0 2.4a4.1 4.1 0 1 0 0 8.2 4.1 4.1 0 0 0 0-8.2zM7 5.5h2v5H7z',
  axe: 'M10 1.5c2.5.3 4.2 2.2 4.5 4.7L10.8 7 9 5.2zM9.3 5.9l1 1-7 7.6-1.4-1.4z',
  pickaxe: 's:M2.5 13.5 10 6M3.5 4.5c3-2.5 7-2.5 9 0 1.5 2 1.5 5-.5 7.5',
  iron_sword: 's:M13.5 2.5 6 10M4 8l4 4M3.5 12.5l-1.5 1.5M11 2.5h2.5V5',
  stone_spear: 's:M2 14 11 5M11 5l3-3.5-.5 4z',
  frying_pan: 'M6 3.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9zM10 9.3l4.2 3.5-1 1.2L9 10.5z',
  armor: 'M5 2 8 3.5 11 2l3 2.5-1.5 3H11V14H5V7.5H3.5L2 4.5z',
  torch: 'M7 7h2v8H7zM8 1s2.5 2.2 2.5 4A2.5 2.5 0 0 1 5.5 5C5.5 3.2 8 1 8 1z',
  waterskin: 'M6.5 1.5h3v2c2.5 1 4 3.3 4 6a5.5 5.5 0 0 1-11 0c0-2.7 1.5-5 4-6z',
  backpack: 'M5.5 1.5h5v2h1a2 2 0 0 1 2 2V14a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V5.5a2 2 0 0 1 2-2h1zm1.2 0V3.5h2.6V1.5zM5 8h6v2H5z',
  iron: 'M3 11.5 5 5h6l2 6.5z',
  iron_ore: 'M4 5l3-2.5 5 1.5 2 5-3 4.5H5L2 10zM6 6.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm4 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2z',
  grass_salad: 'M1.5 8h13a6.5 6.5 0 0 1-13 0zM4.2 7C4 5 5.3 3.5 7 3.2 6.6 5 5.8 6.4 4.2 7zm4.2 0c.3-2.2 2-3.5 4-3.5-.5 2-2 3.3-4 3.5z',
  marshmallow: 'M4 4h8a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  // ui
  robots: 'M5 1.5h6v1.5H8.7v1.5H12a1.5 1.5 0 0 1 1.5 1.5v5A1.5 1.5 0 0 1 12 12.5H4A1.5 1.5 0 0 1 2.5 11V6A1.5 1.5 0 0 1 4 4.5h3.3V3H5zM5.8 7a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4zm4.4 0a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4zM4.5 13.5h7V15h-7z',
  chat: 'M2 2.5h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H7l-4 3v-3H2a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z',
  top: 'M1.5 4.5h9v7h-9zM11.5 6.5 15 4.5v7l-3.5-2z',
  behind: 'M8 1.5a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4zM4 7h8l1 8H3z',
  face: 'M8 1.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM5.7 5.5a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2zm4.6 0a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2zM4.6 9.2h6.8a3.6 3.6 0 0 1-6.8 0z',
};

export const COLORS: Record<string, string> = {
  sun: '#ffd166', sleep: '#b8c4ff', health: '#ff5a5a', food: '#ffae42', water: '#4fb3ff', energy: '#ffe14d', season: '#ffd166', life: '#8be36b', trophies: '#c9a7ff',
  gold: '#ffd166', iron: '#c0c6cc', iron_ore: '#b5653a', iron_axe: '#c0c6cc', iron_pickaxe: '#c0c6cc', iron_sword: '#d7dde3', iron_armor: '#c0c6cc',
  stone_axe: '#a7a39c', stone_pickaxe: '#a7a39c', stone_spear: '#a7a39c', frying_pan: '#aab3bd', hide_armor: '#c49a6c', torch: '#ffae42',
  waterskin: '#c49a6c', backpack: '#9b6b3d', cooked_meat: '#c0583f', grass_salad: '#8be36b', marshmallow: '#f4efe6', roasted_marshmallow: '#e0b074', miner: '#c0c6cc',
  dead: '#d9d9d9', away: '#9fb59a', wood: '#b07a45', berries: '#e0355b', stone: '#a7a39c', fiber: '#8be36b', meat: '#e8766a',
  hide: '#c49a6c', apple: '#e84a3c', club: '#9b6b3d', battery: '#58d68d', crystal: '#7fd8ff', medic: '#ff6b6b',
};

const NS = 'http://www.w3.org/2000/svg';

/** An inline SVG icon; `title` becomes the hover tooltip, since there are no words. */
// Items that share a drawing.
const ALIAS: Record<string, string> = {
  stone_axe: 'axe', iron_axe: 'axe', stone_pickaxe: 'pickaxe', iron_pickaxe: 'pickaxe', miner: 'pickaxe', hide_armor: 'armor', iron_armor: 'armor',
  cooked_meat: 'meat', roasted_marshmallow: 'marshmallow', workbench: 'builder', campfire: 'torch', furnace: 'stone',
};

export function icon(name: string, title = name.replaceAll('_', ' '), color = COLORS[name]): SVGSVGElement {
  const d = P[name] ?? P[ALIAS[name]] ?? P.item, stroke = d.startsWith('s:');
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('class', 'ico');
  if (color) svg.style.color = color;
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', stroke ? d.slice(2) : d);
  if (stroke) {
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.6');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
  } else {
    path.setAttribute('fill', 'currentColor');
    path.setAttribute('fill-rule', 'evenodd');
  }
  const t = document.createElementNS(NS, 'title');
  t.textContent = title;
  svg.append(t, path);
  return svg;
}
