export const redisUrl = (db: number): string => `${process.env.TEST_REDIS ?? 'redis://localhost:6379'}/${db}`;
export const sleep = (ms: number): Promise<void> => new Promise((ok) => setTimeout(ok, ms));
