import { B } from '../shared/balance.ts';
import type { Redis } from '../shared/redis.ts';
import type { ActionRequest } from '../shared/types.ts';
import { handleAction } from './actions.ts';
import { adminAction } from './admin.ts';
import { K, flush, loadWorld, saveAgentNow, saveAllNodes, saveTerrain } from './persist.ts';
import { generateNodes } from './nodes.ts';
import { appendReplay } from './replay.ts';
import { generateLand } from './terrain.ts';
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
  let w = await loadWorld(r, o.seed);
  if (w) {
    console.log(`[engine] restored world at tick ${w.tick} with ${w.agents.size} agents`);
  } else {
    const size = o.size ?? B.mapSize;
    const land = generateLand(o.seed, size);
    w = new World(land.tiles, size, Math.random, land.heights);
    w.seed = o.seed;
    w.nodes = generateNodes(w.tiles, size);
    await saveTerrain(r, w.tiles, size, w.heights);
    await saveAllNodes(r, w);
    await flush(r, w);
    console.log(`[engine] generated a new ${size}x${size} world from seed "${o.seed}" with ${w.nodes.size} resource nodes`);
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
        if (req.method === 'POST' && pathname === '/admin') {
          const { action, agentId, minutes } = (await req.json()) as { action?: unknown; agentId?: unknown; minutes?: unknown };
          try {
            return Response.json({ ok: true, ...adminAction(world, String(action), String(agentId), Number(minutes ?? 0)) });
          } catch (e) {
            if (e instanceof GameFail) return Response.json({ ok: false, error: { error: e.code, message: e.message, hint: e.hint } });
            throw e;
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
      const delta = world.step();
      await r.publish('tick', JSON.stringify(delta));
      await appendReplay(o.replayDir, 1, delta.events);
      const said = delta.events.filter((e) => e.type !== 'move');
      if (said.length) {
        const m = r.multi();
        for (const e of said) m.addCommand(['XADD', K.chat, 'MAXLEN', '~', String(B.chatStreamMax), '*', 'tick', String(e.tick), 'type', e.type, 'name', e.name ?? '', 'text', e.text]);
        await m.exec();
      }
      if (world.tick % B.flushEveryTicks === 0 || world.urgent) {
        world.urgent = false;
        await flush(r, world);
      }
    } catch (e) {
      console.error('[engine] tick failed', e);
    }
  };
  const timer = setInterval(() => {
    if (inFlight) return; // a slow tick skips the next one instead of overlapping; close() waits for it
    inFlight = tick().finally(() => {
      inFlight = null;
    });
  }, o.tickMs ?? B.tickMs);

  return {
    world,
    port: server.port as number,
    async close(): Promise<void> {
      clearInterval(timer);
      await inFlight;
      await flush(r, world);
      await server.stop(true);
    },
  };
}
