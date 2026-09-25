import { B } from '../shared/balance.ts';
import type { Redis } from '../shared/redis.ts';
import type { ActionRequest } from '../shared/types.ts';
import { handleAction } from './actions.ts';
import { adminAction } from './admin.ts';
import { GameFail } from './errors.ts';
import { K, flush, loadArcade } from './persist.ts';
import { appendReplay } from './replay.ts';

export interface EngineOpts {
  redis: Redis;
  port: number;
  replayDir: string;
  tickMs?: number;
}

const refuse = (e: unknown) => {
  if (e instanceof GameFail) return Response.json({ ok: false, error: { error: e.code, message: e.message, hint: e.hint } });
  throw e;
};

export async function startEngine(o: EngineOpts) {
  const r = o.redis;
  const arcade = await loadArcade(r);
  await flush(r, arcade);
  console.log(`[engine] arcade ready with ${arcade.players.size} players`);

  const server = Bun.serve({
    port: o.port,
    maxRequestBodySize: 64 * 1024,
    async fetch(req) {
      const { pathname } = new URL(req.url);
      try {
        if (req.method === 'GET' && pathname === '/health') return Response.json({ ok: true, tick: arcade.tick, players: arcade.players.size });
        if (req.method === 'POST' && pathname === '/register') {
          const { name } = (await req.json()) as { name?: unknown };
          try {
            const p = arcade.register(String(name));
            await flush(r, arcade);
            return Response.json({ ok: true, agentId: p.id });
          } catch (e) {
            return refuse(e);
          }
        }
        if (req.method === 'POST' && pathname === '/action') return Response.json(handleAction(arcade, (await req.json()) as ActionRequest));
        if (req.method === 'POST' && pathname === '/admin') {
          const { action, agentId, minutes } = (await req.json()) as { action?: unknown; agentId?: unknown; minutes?: unknown };
          try {
            return Response.json({ ok: true, ...adminAction(arcade, String(action), String(agentId), Number(minutes ?? 0)) });
          } catch (e) {
            return refuse(e);
          }
        }
        return Response.json({ error: 'not_found' }, { status: 404 });
      } catch (e) {
        console.error('[engine]', e);
        return Response.json({ error: 'engine_error' }, { status: 500 });
      }
    },
  });

  let inFlight: Promise<void> | null = null;
  const tick = async (): Promise<void> => {
    try {
      const delta = arcade.step();
      await r.publish('tick', JSON.stringify(delta));
      await appendReplay(o.replayDir, 1, delta.events);
      if (delta.events.length) {
        const m = r.multi();
        for (const e of delta.events) m.addCommand(['XADD', K.chat, 'MAXLEN', '~', String(B.chatStreamMax), '*', 'tick', String(e.tick), 'type', e.type, 'name', e.name ?? '', 'text', e.text]);
        await m.exec();
      }
      if (arcade.tick % B.flushEveryTicks === 0) await flush(r, arcade);
    } catch (e) {
      console.error('[engine] tick failed', e);
    }
  };
  const timer = setInterval(() => {
    if (inFlight) return; // a slow tick skips the next one instead of overlapping
    inFlight = tick().finally(() => {
      inFlight = null;
    });
  }, o.tickMs ?? B.tickMs);

  return {
    arcade,
    port: server.port as number,
    async close(): Promise<void> {
      clearInterval(timer);
      await inFlight;
      await flush(r, arcade);
      await server.stop(true);
    },
  };
}
