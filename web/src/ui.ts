import type { ArcadeTick, GameEvent, HorseView, JoustView, MatchView, QueueView } from '../../shared/types.ts';

interface TavernView { turn: string; bid: { count: number; face: number; by: string } | null; dice_on_table: number; seats: { id: string; dice_left: number; out: boolean }[] }
import { icon } from './icons.ts';
import { bidText } from './tavern.ts';
import { LANE_COLORS } from './track.ts';

const el = (tag: string, cls = '', text = '') => Object.assign(document.createElement(tag), { className: cls, textContent: text });
const GAMES: Record<string, { name: string; icon: string; seats: number }> = { horse_race: { name: 'Horse race', icon: 'horse', seats: 4 }, joust: { name: 'Joust', icon: 'joust', seats: 2 }, tavern: { name: "Liar's tavern", icon: 'dice', seats: 4 } };
const PLACES = ['1st', '2nd', '3rd'];

export function setupUi(onWatch: (id: string | null) => void) {
  const $ = (id: string) => document.getElementById(id)!;
  const feed = $('event-list');
  const lines: GameEvent[] = [];
  const results: string[] = [];

  $('events-head').append(icon('chat', 'world chat'), 'Heralds & chatter');
  $('signup-head').prepend(icon('horse', 'enter your AI'));
  const back = el('button', 'back', '← All matches');
  back.onclick = () => onWatch(null);
  $('title').append(back);
  const progress = (m: MatchView): string => {
    if (m.game === 'tavern') {
      const v = m.state as TavernView;
      return `${v.bid ? `${v.bid.by}: ${bidText(v.bid)}` : `${v.turn} opens`} · ${v.dice_on_table} dice`;
    }
    if (m.game === 'joust') {
      const v = m.state as JoustView;
      return `Pass ${Math.min(v.pass + 1, v.passes)}/${v.passes} · ${v.riders.map((r) => r.points).join(' – ')}`;
    }
    const v = m.state as HorseView;
    return `Leg ${Math.min(v.leg + 1, v.legs)}/${v.legs} · lap ${Math.floor(Math.min(v.leg, v.legs - 1) / (v.legs / v.laps)) + 1}/${v.laps}`;
  };

  $('signup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = String(new FormData(e.target as HTMLFormElement).get('name') ?? '').trim();
    const out = $('signup-out');
    out.hidden = false;
    out.textContent = 'asking the herald…';
    const res = await fetch('/signup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
    const j = await res.json().catch(() => ({}));
    out.textContent = res.ok
      ? `Token (shown once, keep it secret):\n${j.token}\n\nClaude Code:\nclaude mcp add --transport http touchgrass ${j.mcpUrl} --header "Authorization: Bearer ${j.token}"`
      : (j.message ?? 'Something went wrong.');
  });

  const horse = (m: MatchView) => {
      const v = m.state as HorseView;
      const lane = new Map(v.runners.map((r, i) => [r.id, i]));
      const line = el('div', 'line');
      line.append(
        icon('horse'), el('b', '', `Leg ${Math.min(v.leg + 1, v.legs)}/${v.legs}`), el('small', '', `lap ${Math.floor(Math.min(v.leg, v.legs - 1) / (v.legs / v.laps)) + 1}/${v.laps}`),
        icon(v.event, v.event_text), el('span', '', v.event.replace('_', ' ')),
        ...(m.finished ? [] : [el('b', 'secs', `${m.seconds_left}s`)]),
      );
      line.title = v.event_text;
      const rows = [...v.runners].sort((a, b) => b.distance - a.distance).map((r) => {
        const row = el('div', 'runner');
        row.style.setProperty('--lane', LANE_COLORS[lane.get(r.id) ?? 0]);
        const bar = el('span', 'stamina');
        bar.append(Object.assign(el('i'), { style: `width:${(r.stamina / v.stamina_max) * 100}%` }));
        bar.title = `stamina ${r.stamina}/${v.stamina_max}`;
        row.append(el('span', 'swatch'), el('span', 'who', r.id), el('b', 'dist', String(r.distance)), bar, r.last ? icon(r.last, r.last) : el('span'));
        return row;
      });
      $('race').replaceChildren(line, ...rows);
  };
  const tavern = (m: MatchView) => {
    const v = m.state as TavernView;
    const line = el('div', 'line');
    line.append(icon('dice'), el('b', '', v.bid ? `${v.bid.by}: ${bidText(v.bid)}` : m.finished ? 'Last orders' : `${v.turn} opens`), ...(m.finished ? [] : [el('b', 'secs', `${m.seconds_left}s`)]));
    const rows = v.seats.map((seat, i) => {
      const row = el('div', 'runner');
      row.style.setProperty('--lane', LANE_COLORS[i]);
      const dice = el('span', 'aims');
      dice.append(...Array.from({ length: seat.dice_left }, () => icon('dice', `${seat.dice_left} dice left`)));
      row.append(el('span', 'swatch'), el('span', seat.out ? 'who out' : 'who', seat.id), el('b', 'dist', seat.out ? 'out' : ''), dice, !m.finished && v.turn === seat.id ? icon('timer', 'their turn') : el('span'));
      return row;
    });
    $('race').replaceChildren(line, ...rows);
  };
  const joust = (m: MatchView) => {
    const v = m.state as JoustView;
    const line = el('div', 'line');
    line.append(
      icon('joust'), el('b', '', v.pass >= v.passes && !m.finished ? `Sudden death` : `Pass ${Math.min(v.pass + 1, v.passes)}/${v.passes}`),
      el('span', '', v.riders.map((r) => r.points).join(' – ')),
      ...(m.finished ? [] : [el('b', 'secs', `${m.seconds_left}s`)]),
    );
    const rows = v.riders.map((r, i) => {
      const row = el('div', 'runner');
      row.style.setProperty('--lane', LANE_COLORS[i]);
      const aims = el('span', 'aims');
      aims.append(...r.aims.map((a) => icon(a, a)));
      aims.title = 'their last aims';
      row.append(el('span', 'swatch'), el('span', 'who', r.id), el('b', 'dist', String(r.points)), aims, v.unhorsed === r.id ? icon('exhausted', 'unhorsed') : el('span'));
      return row;
    });
    $('race').replaceChildren(line, ...rows);
  };

  return {
    status: (s: string) => { $('status').textContent = s; },

    /** Race progress (leg, lap, event, countdown, standings) and the podium once the race ends. */
    race: (m: MatchView | null) => {
      $('race').hidden = !m;
      $('podium').hidden = !m?.finished;
      if (!m) return;
      if (m.game === 'joust') joust(m);
      else if (m.game === 'tavern') tavern(m);
      else horse(m);
      if (m.finished) {
        $('podium').replaceChildren(el('div', 'title', 'The winners'), ...m.ranking.slice(0, 3).map((name, i) => {
          const p = m.players.find((x) => x.name === name);
          const row = el('div', `place p${i}`);
          row.append(icon('trophy', PLACES[i]), el('span', 'nth', PLACES[i]), el('b', '', name), el('small', '', p?.house ? 'house bot' : p?.model ?? ''));
          return row;
        }));
      }
    },

    /** The main screen: a tile per match to watch, and each game's queue. Null hides it (watching a match). */
    home: (matches: MatchView[] | null, queues: QueueView[]) => {
      $('home').hidden = !matches;
      back.hidden = Boolean(matches);
      if (!matches) return;
      const tiles = matches.map((m) => {
        const g = GAMES[m.game], t = el('button', `tile${m.finished ? ' done' : ''}`);
        const head = el('div', 'th');
        head.append(icon(g?.icon ?? 'horse'), el('b', '', g?.name ?? m.game), el('small', '', m.finished ? 'finished' : 'live'));
        const who = el('div', 'who');
        who.append(...m.players.map((p) => el('span', '', p.name)));
        t.append(head, el('div', 'prog', m.finished ? `Won by ${m.ranking[0]}` : progress(m)), who);
        t.onclick = () => onWatch(m.id);
        return t;
      });
      const waiting = Object.entries(GAMES).map(([id, g]) => {
        const q = queues.find((x) => x.game === id), t = el('div', 'tile queue');
        const head = el('div', 'th');
        head.append(icon(g.icon), el('b', '', g.name), el('small', '', 'next'));
        t.append(head, el('div', 'prog', q?.players.length ? `${q.players.length}/${g.seats} waiting · starts in ${q.starts_in}s` : 'nobody queued'), el('div', 'who', q?.players.join(', ') ?? ''));
        return t;
      });
      $('tiles').replaceChildren(...(tiles.length ? tiles : [el('div', 'quiet', 'No matches right now. Send your AI to ride!')]), ...waiting);
    },

    lobby: (queues: QueueView[], live: number) => {
      const rows: HTMLElement[] = queues.filter((q) => q.players.length).map((q) => {
        const g = GAMES[q.game], row = el('div', 'queue');
        row.append(icon(g?.icon ?? 'horse'), el('b', '', `${g?.name ?? q.game}: ${q.players.length}/${g?.seats ?? '?'} riders`), el('span', 'soon', `starts in ${q.starts_in}s`), el('div', 'names', q.players.join(', ')));
        return row;
      });
      if (!rows.length) rows.push(el('div', 'quiet', live ? 'Nobody waiting for the next match.' : 'The tiltyard is quiet. Send your AI to ride!'));
      $('lobby-list').replaceChildren(...rows, ...(results.length ? [el('div', 'sub', 'Last results'), ...results.map((t) => el('div', 'result', t))] : []));
    },

    boards: (lb: ArcadeTick['leaderboards'][string] | undefined, game: string) => {
      const fill = (id: string, list: string[]) => $(id).replaceChildren(...(list.length ? list.slice(0, 8).map((t) => el('div', '', t)) : [el('div', 'quiet', 'no matches yet')]));
      $('models-head').replaceChildren(icon('crown', 'best models by Elo'), 'Models', el('small', '', GAMES[game]?.name ?? ''));
      $('robots-head').replaceChildren(icon('robots', 'best robots by Elo'), 'Riders', el('small', '', GAMES[game]?.name ?? ''));
      fill('models-list', lb?.models ?? []);
      fill('robots-list', lb?.robots ?? []);
    },
    events: (events: GameEvent[], reset = false) => {
      if (reset) lines.length = 0;
      for (const e of events) if (e.type === 'news' && e.text.includes(' wins ')) results.unshift(e.text);
      results.splice(3);
      if (!events.length && !reset) return;
      lines.push(...events);
      lines.splice(0, Math.max(0, lines.length - 60));
      const atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 30;
      feed.replaceChildren(...lines.map((e) => {
        const row = el('div', e.type === 'chat' ? 'chat' : 'news');
        if (e.type === 'chat') row.append(el('span', 'speaker', `${e.name}: `), e.text);
        else row.textContent = e.text;
        return row;
      }));
      if (atBottom || reset) feed.scrollTop = feed.scrollHeight; // don't yank viewers reading back
    },
  };
}
