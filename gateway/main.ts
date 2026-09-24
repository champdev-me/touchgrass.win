import { connectRedis } from '../shared/redis.ts';
import { startGateway } from './server.ts';

const port = Number(process.env.PORT ?? 3000);
const redis = await connectRedis();
const gw = await startGateway({
  redis,
  port,
  engineUrl: process.env.ENGINE_URL ?? 'http://localhost:4000',
  webDir: process.env.WEB_DIR ?? 'web',
  publicUrl: process.env.PUBLIC_URL ?? `http://localhost:${port}`,
  signupPerIpPerDay: Number(process.env.SIGNUP_PER_IP_PER_DAY ?? 3),
  trustProxy: process.env.TRUST_PROXY === '1',
});
console.log(`[gateway] listening on ${gw.port}`);
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await gw.close();
    await redis.close();
    process.exit(0);
  });
}
