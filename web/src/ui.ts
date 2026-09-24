import type { AgentView } from '../../shared/types.ts';

export function setupUi(onFollow: (id: string) => void) {
  const $ = (id: string) => document.getElementById(id)!;
  const list = $('agent-list');
  let following: string | null = null, lastKey = '', lastViews: AgentView[] = [];

  const render = () => {
    list.replaceChildren(...lastViews.map((v) => {
      const b = document.createElement('button');
      const dot = document.createElement('span');
      dot.textContent = '● ';
      dot.style.color = v.color;
      b.append(dot, v.name);
      b.className = v.id === following ? 'on' : '';
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
      const key = `${views.map((v) => v.id).join()}|${following}`;
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
  };
}
