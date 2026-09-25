import type { ServerMsg } from '../../shared/types.ts';

export function connect(onMsg: (m: ServerMsg) => void, onStatus: (s: string) => void): void {
  const open = () => {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onopen = () => onStatus('live');
    ws.onmessage = (e) => onMsg(JSON.parse(e.data));
    ws.onclose = () => {
      onStatus('reconnecting…');
      setTimeout(open, 2000);
    };
  };
  open();
}
