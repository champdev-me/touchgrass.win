import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { clientIp } from './ip.ts';

const h = (o: Record<string, string>) => new Headers(o);

test('without a proxy the socket peer is the client', () => {
  assert.equal(clientIp(h({ 'x-forwarded-for': '6.6.6.6' }), '9.9.9.9', { trustProxy: false }), '9.9.9.9');
});

test('behind one proxy only the last X-Forwarded-For hop counts', () => {
  assert.equal(clientIp(h({ 'x-forwarded-for': '6.6.6.6, 4.4.4.4' }), '10.0.0.2', { trustProxy: true }), '4.4.4.4');
});

test('a configured client-IP header (e.g. Cloudflare) wins over X-Forwarded-For', () => {
  const headers = h({ 'cf-connecting-ip': '5.5.5.5', 'x-forwarded-for': '5.5.5.5, 172.68.1.1' });
  assert.equal(clientIp(headers, '10.0.0.2', { trustProxy: true, clientIpHeader: 'cf-connecting-ip' }), '5.5.5.5');
  assert.equal(clientIp(h({ 'x-forwarded-for': '1.2.3.4' }), '10.0.0.2', { trustProxy: true, clientIpHeader: 'cf-connecting-ip' }), '1.2.3.4');
});
