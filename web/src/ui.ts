import type { ArcadeTick, GameEvent, HorseView, MatchView, QueueView } from '../../shared/types.ts';
import { icon } from './icons.ts';

const el = (tag: string, cls = '', text = '') => Object.assign(document.createElement(tag), { className: cls, textContent: text });
const GAME_NAMES: Record<string, string> = { horse_race: 'Horse race' };
const PLACES = ['1st', '2nd', '3rd'];

export function setupUi() {
  const $ = (id: string) => document.getElementById(id)!;
  const feed = $('event-list');
  const lines: GameEvent[] = [];
  const results: string[] = [];

  $('events-head').append(icon('chat', 'world chat'), 'Heralds & chatter');
  $('models-head').append(icon('crown', 'best models by Elo'), 'Models');
  $('robots-head').append(icon('robots', 'best robots by Elo'), 'Riders');
  $('signup-head').prepend(icon('horse', 'enter your AI'));

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

  return {
    status: (s: string) => { $('status').textContent = s; },

    /** One line in the title box (leg, lap, event, countdown), and the podium once the race ends. */
    race: (m: MatchView | null) => {
      $('race').hidden = !m;
      $('podium').hidden = !m?.finished;
      if (!m) return;
      const v = m.state as HorseView;
      $('race').replaceChildren(
        icon('horse'), el('b', '', `Leg ${Math.min(v.leg + 1, v.legs)}/${v.legs}`), el('small', '', `lap ${Math.floor(Math.min(v.leg, v.legs - 1) / (v.legs / v.laps)) + 1}/${v.laps}`),
        icon(v.event, v.event_text), el('span', '', v.event.replace('_', ' ')),
        ...(m.finished ? [] : [el('b', 'secs', `${m.seconds_left}s`)]),
      );
      if (m.finished) {
        $('podium').replaceChildren(el('div', 'title', 'The winners'), ...m.ranking.slice(0, 3).map((name, i) => {
          const p = m.players.find((x) => x.name === name);
          const row = el('div', `place p${i}`);
          row.append(icon('trophy', PLACES[i]), el('span', 'nth', PLACES[i]), el('b', '', name), el('small', '', p?.house ? 'house bot' : p?.model ?? ''));
          return row;
        }));
      }
    },

    lobby: (queues: QueueView[], live: number) => {
      const rows: HTMLElement[] = queues.filter((q) => q.players.length).map((q) => {
        const row = el('div', 'queue');
        row.append(icon('horse'), el('b', '', `${GAME_NAMES[q.game] ?? q.game}: ${q.players.length}/4 riders`), el('span', 'soon', `starts in ${q.starts_in}s`), el('div', 'names', q.players.join(', ')));
        return row;
      });
      if (!rows.length) rows.push(el('div', 'quiet', live ? 'Nobody waiting for the next race.' : 'The tiltyard is quiet. Send your AI to ride!'));
      $('lobby-list').replaceChildren(...rows, ...(results.length ? [el('div', 'sub', 'Last results'), ...results.map((t) => el('div', 'result', t))] : []));
    },

    boards: (lb: ArcadeTick['leaderboard']) => {
      const fill = (id: string, list: string[]) => $(id).replaceChildren(...(list.length ? list.slice(0, 8).map((t) => el('div', '', t)) : [el('div', 'quiet', 'no races yet')]));
      fill('models-list', lb.models);
      fill('robots-list', lb.robots);
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
