import type { AgentView, GameEvent } from '../../shared/types.ts';

type StatKey = 'health' | 'food' | 'water' | 'energy';
const STATS: [StatKey, string, string][] = [['health', '❤ health', 'hp'], ['food', '🍖 food', 'food'], ['water', '💧 water', 'water'], ['energy', '⚡ energy', 'energy']];
const DOING: Record<string, string> = { idle: '🧍 standing still', move_to: '🚶 walking', gather: '🪓 gathering', rest: '🪑 resting', sleep: '😴 sleeping' };
const el = (tag: string, cls = '', text = '') => Object.assign(document.createElement(tag), { className: cls, textContent: text });

export function setupUi(onFollow: (id: string) => void) {
  const $ = (id: string) => document.getElementById(id)!;
  const list = $('agent-list');
  const feed = $('event-list');
  const shown: string[] = [];
  const focusBox = $('focus');
  const who = el('div', 'who'), whoName = el('span'), whoSub = el('span', 'sub');
  who.append(whoName, whoSub);
  const rows = STATS.map(([key, label, cls]) => {
    const fill = el('i'), meter = el('div', `meter ${cls}`), value = el('b');
    meter.append(fill);
    const row = el('div', 'stat');
    row.append(el('span', '', label), meter, value);
    return { key, row, fill, value };
  });
  const doing = el('div', 'doing');
  focusBox.append(who, ...rows.map((r) => r.row), doing);
  let following: string | null = null, lastKey = '', lastViews: AgentView[] = [];

  const render = () => {
    list.replaceChildren(...lastViews.map((v) => {
      const b = document.createElement('button');
      const dot = document.createElement('span');
      dot.textContent = '● ';
      dot.style.color = v.color;
      b.append(dot, v.name);
      b.className = `${v.id === following ? 'on' : ''} ${v.online ? '' : 'away'}`.trim();
      b.onclick = () => onFollow(v.id);
      return b;
    }));
  };

  $('signup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = String(new FormData(e.target as HTMLFormElement).get('name') ?? '').trim();
    const out = $('signup-out');
    out.hidden = false;
    out.textContent = 'asking the grass…';
    const res = await fetch('/signup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
    const j = await res.json().catch(() => ({}));
    out.textContent = res.ok
      ? `Token (shown once, keep it secret):\n${j.token}\n\nClaude Code:\nclaude mcp add --transport http touchgrass ${j.mcpUrl} --header "Authorization: Bearer ${j.token}"`
      : (j.message ?? 'Something went wrong. The grass is confused.');
  });

  return {
    status: (s: string) => { $('status').textContent = s; },
    agents: (views: AgentView[]) => {
      lastViews = views;
      const key = `${views.map((v) => `${v.id}:${v.online ? 1 : 0}`).join()}|${following}`;
      if (key !== lastKey) {
        lastKey = key;
        render();
      }
    },
    following: (id: string | null) => {
      following = id;
      lastKey = '';
      render();
    },
    focus: (v: AgentView | null) => {
      focusBox.hidden = !v;
      if (!v) return;
      whoName.textContent = v.name;
      whoSub.textContent = [v.model, v.role].filter(Boolean).join(' · ');
      for (const r of rows) {
        const n = v[r.key];
        r.fill.style.width = `${n}%`;
        r.value.textContent = String(n);
        r.value.className = n < 15 ? 'low' : '';
      }
      doing.textContent = v.dead ? '💀 dead, respawning soon' : `${DOING[v.action] ?? v.action} · at (${v.x}, ${v.y})${v.online ? '' : ' · owner away'}`;
    },
    events: (events: GameEvent[]) => {
      for (const e of events) if (e.type !== 'move') shown.unshift(e.text);
      shown.length = Math.min(shown.length, 8);
      feed.replaceChildren(...shown.map((t) => Object.assign(document.createElement('div'), { textContent: t })));
    },
  };
}
