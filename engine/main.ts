import { connectRedis } from '../shared/redis.ts';
import { startEngine } from './server.ts';

const redis = await connectRedis();
const engine = await startEngine({
  redis,
  port: Number(process.env.PORT ?? 4000),
  seed: process.env.SEED ?? 'touchgrass-season-1',
  replayDir: process.env.REPLAY_DIR ?? 'data/replays',
});
console.log(`[engine] listening on ${engine.port}`);
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await engine.close();
    await redis.close();
    process.exit(0);
  });
}
