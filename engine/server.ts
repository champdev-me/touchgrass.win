import { B } from '../shared/balance.ts';
import type { Redis } from '../shared/redis.ts';
import type { ActionRequest } from '../shared/types.ts';
import { handleAction } from './actions.ts';
import { flush, loadWorld, saveAgentNow, saveTerrain } from './persist.ts';
import { appendReplay } from './replay.ts';
import { generateTerrain } from './terrain.ts';
import { GameFail, World } from './world.ts';

export interface EngineOpts {
  redis: Redis;
  port: number;
  seed: string;
  replayDir: string;
  size?: number;
  tickMs?: number;
}

export async function startEngine(o: EngineOpts) {
  const r = o.redis;
  let w = await loadWorld(r);
  if (w) {
    console.log(`[engine] restored world at tick ${w.tick} with ${w.agents.size} agents`);
  } else {
    const size = o.size ?? B.mapSize;
    w = new World(generateTerrain(o.seed, size), size);
    await saveTerrain(r, w.tiles, size);
    await flush(r, w);
    console.log(`[engine] generated a new ${size}x${size} world from seed "${o.seed}"`);
  }
  const world = w;

  const server = Bun.serve({
    port: o.port,
    maxRequestBodySize: 64 * 1024,
    async fetch(req) {
      const { pathname } = new URL(req.url);
      try {
        if (req.method === 'GET' && pathname === '/health') return Response.json({ ok: true, tick: world.tick, agents: world.agents.size });
        if (req.method === 'POST' && pathname === '/register') {
          const { name } = (await req.json()) as { name?: unknown };
          try {
            const a = world.register(String(name));
            await saveAgentNow(r, world, a.id);
            return Response.json({ ok: true, agentId: a.id });
          } catch (e) {
            if (e instanceof GameFail) return Response.json({ ok: false, error: { error: e.code, message: e.message, hint: e.hint } });
            throw e;
          }
        }
        if (req.method === 'POST' && pathname === '/action') return Response.json(handleAction(world, (await req.json()) as ActionRequest));
        return Response.json({ error: 'not_found' }, { status: 404 });
      } catch (e) {
        console.error('[engine]', e);
        return Response.json({ error: 'engine_error' }, { status: 500 });
      }
    },
  });

  const timer = setInterval(async () => {
    try {
      const delta = world.step();
      await r.publish('tick', JSON.stringify(delta));
      await appendReplay(o.replayDir, 1, delta.events);
      if (world.tick % B.flushEveryTicks === 0) await flush(r, world);
    } catch (e) {
      console.error('[engine] tick failed', e);
    }
  }, o.tickMs ?? B.tickMs);

  return {
    world,
    port: server.port as number,
    async close(): Promise<void> {
      clearInterval(timer);
      await flush(r, world);
      await server.stop(true);
    },
  };
}
