import type { AgentView, DuelView, GameEvent } from '../../shared/types.ts';
import { icon } from './icons.ts';

type StatKey = 'health' | 'food' | 'water' | 'energy';
const STATS: [StatKey, string][] = [['health', 'hp'], ['food', 'food'], ['water', 'water'], ['energy', 'energy']];
const DOING: Record<string, string> = { idle: 'standing still', move_to: 'walking', gather: 'gathering', attack: 'fighting', rest: 'resting', sleep: 'sleeping', flee: 'running away', dead: 'dead, respawning soon' };
const el = (tag: string, cls = '', text = '') => Object.assign(document.createElement(tag), { className: cls, textContent: text });
/** An icon followed by a number, e.g. a bag slot or a score. */
const chip = (name: string, value: string | number, title?: string) => {
  const c = el('span', 'chip');
  c.append(icon(name, title), String(value));
  return c;
};

type CamMode = 'top' | 'behind' | 'face';
const CAMS: [CamMode, string][] = [['top', 'view from above'], ['behind', 'ride along behind (T)'], ['face', 'look at its face (V)']];
export interface WorldInfo {
  day: number;
  night: boolean;
  robots: number;
  creatures: number;
  following?: { emoji: string; name: string; hp: number; maxHp: number };
}

export function setupUi(onFollow: (id: string) => void, onCam: (mode: CamMode) => void) {
  const $ = (id: string) => document.getElementById(id)!;
  const list = $('agent-list');
  const feed = $('event-list');
  const lines: GameEvent[] = [];
  const prices = new Map<string, { last: number; prev: number; volume: number }>(); // per item, per unit
  const sales: string[] = [];
  const focusBox = $('focus');
  const who = el('div', 'who'), whoRole = el('span', 'role'), whoName = el('span'), whoSub = el('span', 'sub');
  who.append(whoRole, whoName, whoSub);
  const rows = STATS.map(([key, cls]) => {
    const fill = el('i'), meter = el('div', `meter ${cls}`), value = el('b');
    meter.append(fill);
    const row = el('div', 'stat');
    row.append(icon(key), meter, value);
    return { key, row, fill, value };
  });
  const bag = el('div', 'chips');
  const doing = el('div', 'chips'), score = el('div', 'chips'), adminRow = el('div', 'admin'), adminOut = el('span', 'sub');
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
      const job = v.role ? icon(v.role, v.role) : el('span'); // what they do, not a colour
      b.append(job, `${v.badge ? `${v.badge} ` : ''}${v.name}`, el('b', 'pts', String(v.score)));
      b.className = `${v.id === following ? 'on' : ''} ${v.online ? '' : 'away'}`.trim();
      b.onclick = () => onFollow(v.id);
      return b;
    }));
  };

  $('agents-head').append(icon('robots', 'robots'), Object.assign(icon('season', 'season score'), { style: 'margin-left:auto;color:#ffd166' }));
  $('events-head').append(icon('chat', 'world chat', '#9fb59a'));
  $('signup-head').prepend(icon('robots', 'send your AI outside', '#8be36b'));
  const camBox = $('cam');
  const camButtons = CAMS.map(([mode, label]) => {
    const b = el('button');
    b.title = label;
    b.append(icon(mode, label));
    b.onclick = () => onCam(mode);
    camBox.append(b);
    return [mode, b] as const;
  });

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
    world: (w: WorldInfo) => {
      const row: HTMLElement[] = [chip(w.night ? 'sleep' : 'sun', w.day, w.night ? 'night, day number' : 'day number'), chip('robots', w.robots, 'robots'), chip('hide', w.creatures, 'creatures')];
      if (w.following) row.push(el('span', 'chip', `${w.following.emoji} ${w.following.hp}/${w.following.maxHp}`));
      $('status').replaceChildren(...row);
    },
    agents: (views: AgentView[]) => {
      lastViews = views;
      const key = `${views.map((v) => `${v.id}:${v.role}:${v.online ? 1 : 0}:${v.score}:${v.badge}`).join()}|${following}`;
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
      whoRole.replaceChildren(...(v.role ? [icon(v.role)] : []));
      whoName.textContent = v.name;
      whoSub.textContent = v.model ?? '';
      for (const r of rows) {
        const n = v[r.key];
        r.fill.style.width = `${n}%`;
        r.value.textContent = String(n);
        r.value.className = n < 15 ? 'low' : '';
      }
      const act = v.dead ? 'dead' : v.action;
      doing.replaceChildren(icon(act, DOING[act] ?? act), chip('pin', `${v.x},${v.y}`, 'position'), ...(v.online ? [] : [icon('away', 'owner is away')]));
      const items = Object.entries(v.inventory);
      bag.replaceChildren(...(items.length ? items.map(([item, n]) => chip(item, n, item)) : [icon('item', 'empty bag', '#555')]));
      score.replaceChildren(chip('gold', v.gold, 'gold'), chip('season', v.score, 'season score'), chip('life', v.life, 'score this life'), chip('trophies', v.trophies, 'achievements'), ...(v.badge ? [el('span', 'chip', v.badge)] : []));
      adminRow.hidden = !adminKey();
      if (adminRow.dataset.agent !== v.id) adminOut.textContent = '';
      adminRow.dataset.agent = v.id;
    },
    camera: (mode: CamMode | null) => {
      camBox.hidden = !mode;
      for (const [m, b] of camButtons) b.classList.toggle('on', m === mode);
    },
    promptAdminKey: () => {
      const k = prompt('Admin key (kept in this browser; empty to forget):');
      try {
        if (k !== null) localStorage.setItem('tg-admin', k);
      } catch {
        // storage blocked: admin controls stay hidden
      }
    },
    duels: (list: DuelView[]) => {
      const box = $('duels');
      box.hidden = !list.length;
      const hearts = (n: number) => {
        const row = el('span', 'hearts');
        for (let i = 0; i < 10; i++) {
          const h = icon('heart', `${n} hearts`);
          if (i >= n) h.classList.add('lost');
          row.append(h);
        }
        return row;
      };
      const move = (m: string | null) => {
        const s = el('span', 'move');
        if (m) s.append(icon(m, m));
        return s;
      };
      box.replaceChildren(...list.map((d) => {
        const row = el('div', 'duel');
        if (d.ring === null) row.append(el('span', 'round', `${d.an} vs ${d.bn}: waiting for a ring`));
        else row.append(el('b', '', d.an), hearts(d.ah), move(d.la), el('span', 'round', `R${d.round}`), move(d.lb), hearts(d.bh), el('b', '', d.bn));
        row.title = 'watch this duel';
        row.onclick = () => onFollow(d.a);
        return row;
      }));
    },
    market: (asks: [string, number, number][], events: GameEvent[]) => {
      for (const e of events) {
        if (!e.sale) continue;
        const [item, count, gold] = e.sale, per = gold / count, p = prices.get(item);
        prices.set(item, { last: per, prev: p?.last ?? per, volume: (p?.volume ?? 0) + count });
        sales.unshift(e.text.replace(/^📈 /, ''));
      }
      sales.splice(8);
      const items = new Set([...prices.keys(), ...asks.map(([i]) => i)]);
      $('market').hidden = !items.size;
      if (!items.size) return;
      $('market-head').replaceChildren(icon('market', 'world market: last price, change, cheapest ask'));
      const ask = new Map(asks.map(([i, p, n]) => [i, [p, n] as const]));
      $('market-rows').replaceChildren(...[...items].sort().map((item) => {
        const row = el('div', 'row'), p = prices.get(item), a = ask.get(item);
        const trend = !p || p.last === p.prev ? el('span') : icon(p.last > p.prev ? 'up' : 'down', p.last > p.prev ? 'price up' : 'price down');
        row.append(icon(item, item), el('span', '', item.replaceAll('_', ' ')), el('span', 'num', p ? p.last.toFixed(p.last % 1 ? 1 : 0) : '-'), trend, el('span', 'ask', a ? `${a[0]} x${a[1]}` : '-'));
        row.title = p ? `last ${p.last} gold each, ${p.volume} sold` : 'nothing sold yet';
        return row;
      }));
      $('market-sales').replaceChildren(...sales.map((t) => el('div', '', t)));
    },
    events: (events: GameEvent[], reset = false) => {
      if (reset) lines.length = 0;
      const fresh = events.filter((e) => e.type !== 'move' && e.type !== 'market'); // the market has its own panel
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
