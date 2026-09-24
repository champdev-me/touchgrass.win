import type { ClientMsg, ServerMsg } from '../../shared/types.ts';

export function connect(onMsg: (m: ServerMsg) => void, onStatus: (s: string) => void): (m: ClientMsg) => void {
  let ws: WebSocket;
  const open = () => {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onopen = () => onStatus('live');
    ws.onmessage = (e) => onMsg(JSON.parse(e.data));
    ws.onclose = () => {
      onStatus('reconnecting…');
      setTimeout(open, 2000);
    };
  };
  open();
  return (m) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
  };
}
