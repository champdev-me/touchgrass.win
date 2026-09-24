export interface IpOpts {
  trustProxy: boolean;
  clientIpHeader?: string;
}

/** The address signup limits key on. Behind a proxy only headers the proxy itself sets are trusted. */
export function clientIp(headers: Headers, peer: string | undefined, o: IpOpts): string {
  const fromHeader = o.clientIpHeader ? headers.get(o.clientIpHeader)?.trim() : undefined;
  if (fromHeader) return fromHeader;
  const lastHop = headers.get('x-forwarded-for')?.split(',').at(-1)?.trim();
  return (o.trustProxy && lastHop) || peer || 'unknown';
}
