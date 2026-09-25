// Hand-drawn 16x16 icons for the HUD, so panels need few words. Stroke icons start with "s:".
const P: Record<string, string> = {
  // horse race options
  sprint: 's:M2.5 3l5 5-5 5M8 3l5 5-5 5',
  steady: 's:M5.5 3l5 5-5 5',
  conserve: 'M2 5h10.5v6H2zM13.5 6.8H15v2.4h-1.5zM3.5 6.5v3h3v-3z',
  overtake: 's:M2 13h4c3 0 5-2 5-5V3M8 6l3-3 3 3',
  exhausted: 's:M3.5 5l3 2-3 2M12.5 5l-3 2 3 2M5 12.5h6',
  // leg events
  clear: 's:M8 5a3 3 0 1 1 0 6 3 3 0 0 1 0-6M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3 3l1 1M12 12l1 1M3 13l1-1M12 4l1-1',
  mud: 'M2 11c0-2 2-3 4-3s2-2 4-2 4 1 4 3-1 4-3 4H5c-2 0-3-.5-3-2z',
  tailwind: 's:M1.5 5h8a2 2 0 1 0-2-2M1.5 8h11a2 2 0 1 1-2 2M1.5 11h6',
  hill: 'M1 14 6 5l3 4 2-2 4 7z',
  turn: 's:M3 14V8a5 5 0 0 1 10 0v5M10 10.5l3 3 3-3',
  hurdle: 's:M2.5 14V5M13.5 14V5M2.5 6.5h11M2.5 10h11',
  jump: 's:M1 14c2.5 0 3.5-9 7-9s4.5 9 7 9M5.5 14h5',
  revolver: 'M1.5 5h9l1-1.5h3V7h-2.5l-1 1H9.5l-1 1.5H6.2L5 14H2.3l1.4-5.5-2.2-.5z',
  chip: 'M8 2a6 6 0 1 1 0 12A6 6 0 0 1 8 2zm0 2.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z',
  dice: 'M3 2h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zm2.5 2.3a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4zm5 5a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4zM8 6.8a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4z',
  joust: 's:M2 14 13 3M10.5 2.5l3 3M3.5 10.5l2 2',
  helm: 'M3 9.5a5 5 0 0 1 10 0V14H3zM4.5 8.5h7V10h-7z',
  shield: 'M8 1.5 14 4v4.5c0 3.2-2.6 5.6-6 6-3.4-.4-6-2.8-6-6V4z',
  body: 'M5.5 1.5h5l2.5 4-2 1.2V14.5H5V6.7L3 5.5z',
  home_stretch: 'M3 15V2h1v1h9v6H4v6zM4 3h3v3H4zm3 3h3v3H7zm3-3h3v3h-3z',
  // results and panels
  trophy: 'M4 1.5h8V5a4 4 0 0 1-3.2 3.9v2.3H11v2.3H5v-2.3h2.2V8.9A4 4 0 0 1 4 5zM1.5 2.5H3.3v2.6H1.5zm11.2 0h1.8v2.6h-1.8z',
  crown: 'M2 12 1.5 4l4 3L8 2.5 10.5 7l4-3-.5 8zM2 13h12v1.5H2z',
  horse: 'M4 14.5h8.5V13h-1c0-3 .5-5-1-8.5L8.5 2 7.5 3.5 4.5 5.5 3 8.5l1.5 1 2-1.5 1 .5-3 4.5z',
  timer: 's:M8 4.5a5 5 0 1 1 0 10 5 5 0 0 1 0-10M8 6.5v3l2 1.5M6 1.5h4',
  robots: 'M5 1.5h6v1.5H8.7v1.5H12a1.5 1.5 0 0 1 1.5 1.5v5A1.5 1.5 0 0 1 12 12.5H4A1.5 1.5 0 0 1 2.5 11V6A1.5 1.5 0 0 1 4 4.5h3.3V3H5zM5.8 7a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4zm4.4 0a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4zM4.5 13.5h7V15h-7z',
  chat: 'M2 2.5h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H7l-4 3v-3H2a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z',
  item: 'M3 3h10v10H3z',
};

export const COLORS: Record<string, string> = {
  sprint: '#ff8a5a', steady: '#f1e3c2', conserve: '#58d68d', overtake: '#ffd166', exhausted: '#ff5a5a',
  revolver: '#c0c6cc', chip: '#e2b95a', dice: '#f7f2e6', joust: '#e8d3a8', helm: '#c0c6cc', shield: '#8ab4ff', body: '#e8766a', turn: '#f1e3c2', hurdle: '#c49a6c', jump: '#9fd3ff', clear: '#ffd166', mud: '#9b6b3d', tailwind: '#9fd3ff', hill: '#8fbf6a', home_stretch: '#f1e3c2',
  trophy: '#ffd166', crown: '#ffd166', horse: '#d9a066', timer: '#f1e3c2',
};

const NS = 'http://www.w3.org/2000/svg';

/** An inline SVG icon; `title` becomes the hover tooltip. */
export function icon(name: string, title = name.replaceAll('_', ' '), color = COLORS[name]): SVGSVGElement {
  const d = P[name] ?? P.item, stroke = d.startsWith('s:');
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
