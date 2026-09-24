import type { AgentView, GameEvent } from '../../shared/types.ts';

type StatKey = 'health' | 'food' | 'water' | 'energy';
const STATS: [StatKey, string, string][] = [['health', '❤ health', 'hp'], ['food', '🍖 food', 'food'], ['water', '💧 water', 'water'], ['energy', '⚡ energy', 'energy']];
const DOING: Record<string, string> = { idle: '🧍 standing still', move_to: '🚶 walking', gather: '🪓 gathering', rest: '🪑 resting', sleep: '😴 sleeping' };
const el = (tag: string, cls = '', text = '') => Object.assign(document.createElement(tag), { className: cls, textContent: text });

export function setupUi(onFollow: (id: string) => void) {
  const $ = (id: string) => document.getElementById(id)!;
  const list = $('agent-list');
  const feed = $('event-list');
  const lines: GameEvent[] = [];
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
  const bag = el('div', 'doing');
  const doing = el('div', 'doing'), score = el('div', 'doing'), adminRow = el('div', 'admin'), adminOut = el('span', 'sub');
  focusBox.append(who, ...rows.map((r) => r.row), doing, bag, score, adminRow);
  const adminKey = (): string => {
    try {
      return localStorage.getItem('tg-admin') ?? '';
    } catch {
      return '';
    }
  };
  for (const [label, action] of [['Mute 10m', 'mute'], ['Kick', 'kick'], ['Ban', 'ban']]) {
    const b = el('button', '', label);
    b.onclick = async () => {
      if (action === 'ban' && !confirm('Ban this robot for good?')) return;
      const res = await fetch(`/admin/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${adminKey()}` },
        body: JSON.stringify({ agent: adminRow.dataset.agent, minutes: 10 }),
      });
      adminOut.textContent = res.ok ? `${action}: done` : `${action}: failed (${res.status})`;
    };
    adminRow.append(b);
  }
  adminRow.append(adminOut);
  let following: string | null = null, lastKey = '', lastViews: AgentView[] = [];

  // The robot list doubles as the leaderboard: sorted by season score.
  const render = () => {
    list.replaceChildren(...[...lastViews].sort((p, q) => q.score - p.score).map((v) => {
      const b = document.createElement('button');
      const dot = document.createElement('span');
      dot.textContent = '● ';
      dot.style.color = v.color;
      b.append(dot, `${v.badge ? `${v.badge} ` : ''}${v.name}`, el('b', 'pts', String(v.score)));
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
      const key = `${views.map((v) => `${v.id}:${v.online ? 1 : 0}:${v.score}:${v.badge}`).join()}|${following}`;
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
      bag.textContent = `🎒 ${Object.entries(v.inventory).map(([item, n]) => `${n} ${item}`).join(' · ') || 'empty bag'}`;
      score.textContent = `🏆 season ${v.score} · this life ${v.life} · ${v.trophies} achievements${v.badge ? ` · ${v.badge}` : ''}`;
      adminRow.hidden = !adminKey();
      if (adminRow.dataset.agent !== v.id) adminOut.textContent = '';
      adminRow.dataset.agent = v.id;
    },
    promptAdminKey: () => {
      const k = prompt('Admin key (kept in this browser; empty to forget):');
      try {
        if (k !== null) localStorage.setItem('tg-admin', k);
      } catch {
        // storage blocked: admin controls stay hidden
      }
    },
    events: (events: GameEvent[], reset = false) => {
      if (reset) lines.length = 0;
      const fresh = events.filter((e) => e.type !== 'move');
      if (!fresh.length && !reset) return;
      lines.push(...fresh);
      lines.splice(0, Math.max(0, lines.length - 40));
      const atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 30;
      feed.replaceChildren(...lines.map((e) => {
        const row = el('div', e.type === 'chat' ? 'chat' : 'sys');
        if (e.type === 'chat') row.append(el('span', 'speaker', `${e.name}: `), e.text);
        else row.textContent = e.text;
        return row;
      }));
      if (atBottom || reset) feed.scrollTop = feed.scrollHeight; // don't yank viewers reading back
    },
  };
}
