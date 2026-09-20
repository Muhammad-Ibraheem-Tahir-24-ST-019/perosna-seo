import { isIP } from 'node:net';
import { lookup as dnsLookup } from 'node:dns/promises';

/**
 * SSRF policy.
 *
 * Users submit URLs they do not own, so every server-side fetch is attacker
 * controlled by design. The rules below are the primary defence: a public URL
 * must never be able to reach loopback, private networks, link-local addresses,
 * cloud metadata endpoints, container service names or non-HTTP protocols.
 */

export type SsrfBlockReason =
  | 'UNSUPPORTED_SCHEME'
  | 'BLOCKED_HOSTNAME'
  | 'BLOCKED_PORT'
  | 'PRIVATE_ADDRESS'
  | 'LOOPBACK_ADDRESS'
  | 'LINK_LOCAL_ADDRESS'
  | 'METADATA_ADDRESS'
  | 'MULTICAST_OR_RESERVED'
  | 'OBFUSCATED_ADDRESS'
  | 'DNS_FAILURE'
  | 'NO_PUBLIC_ADDRESS';

export interface SsrfPolicy {
  /** Development escape hatch. Must stay false in production. */
  allowPrivateNetwork: boolean;
  /** Extra hostnames (exact match, lowercase) that are always rejected. */
  blockedHostnames: string[];
  /** Extra hostname suffixes that are always rejected. */
  blockedSuffixes: string[];
  /** Well-known infrastructure ports that a public page never needs. */
  blockedPorts: number[];
}

export const DEFAULT_SSRF_POLICY: SsrfPolicy = {
  allowPrivateNetwork: false,
  blockedHostnames: [
    'localhost',
    'localhost.localdomain',
    'ip6-localhost',
    'ip6-loopback',
    'metadata',
    'metadata.google.internal',
    'metadata.goog',
    'instance-data',
  ],
  blockedSuffixes: [
    '.localhost',
    '.local',
    '.internal',
    '.intranet',
    '.lan',
    '.home',
    '.corp',
    '.private',
    '.test',
    '.example',
    '.invalid',
    '.onion',
  ],
  blockedPorts: [22, 23, 25, 111, 135, 139, 445, 1433, 1521, 2375, 2376, 3306, 3389, 5432, 5672,
    6379, 8020, 9042, 9092, 9200, 9300, 11211, 27017, 27018],
};

export class SsrfError extends Error {
  readonly reason: SsrfBlockReason;
  constructor(reason: SsrfBlockReason, message: string) {
    super(message);
    this.name = 'SsrfError';
    this.reason = reason;
  }
}

export interface HostAssessment {
  hostname: string;
  /** Validated addresses that the connection is pinned to. */
  addresses: Array<{ address: string; family: 4 | 6 }>;
}

const IPV4_BLOCKS: Array<[string, number, SsrfBlockReason, string]> = [
  ['0.0.0.0', 8, 'MULTICAST_OR_RESERVED', '"this network" range'],
  ['10.0.0.0', 8, 'PRIVATE_ADDRESS', 'RFC1918 private range'],
  ['100.64.0.0', 10, 'PRIVATE_ADDRESS', 'carrier-grade NAT range'],
  ['127.0.0.0', 8, 'LOOPBACK_ADDRESS', 'loopback range'],
  ['169.254.0.0', 16, 'LINK_LOCAL_ADDRESS', 'link-local range (includes cloud metadata)'],
  ['172.16.0.0', 12, 'PRIVATE_ADDRESS', 'RFC1918 private range'],
  ['192.0.0.0', 24, 'MULTICAST_OR_RESERVED', 'IETF protocol assignments'],
  ['192.0.2.0', 24, 'MULTICAST_OR_RESERVED', 'documentation range'],
  ['192.88.99.0', 24, 'MULTICAST_OR_RESERVED', '6to4 relay anycast'],
  ['192.168.0.0', 16, 'PRIVATE_ADDRESS', 'RFC1918 private range'],
  ['198.18.0.0', 15, 'MULTICAST_OR_RESERVED', 'benchmarking range'],
  ['198.51.100.0', 24, 'MULTICAST_OR_RESERVED', 'documentation range'],
  ['203.0.113.0', 24, 'MULTICAST_OR_RESERVED', 'documentation range'],
  ['224.0.0.0', 4, 'MULTICAST_OR_RESERVED', 'multicast range'],
  ['240.0.0.0', 4, 'MULTICAST_OR_RESERVED', 'reserved range'],
];

/** Explicit metadata endpoints, checked before the range rules for clearer errors. */
const METADATA_ADDRESSES = new Set([
  '169.254.169.254',
  '169.254.170.2',
  '100.100.100.200',
  'fd00:ec2::254',
]);

export function ipv4ToInt(address: string): number | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value >>> 0;
}

function inIpv4Block(address: string, base: string, bits: number): boolean {
  const addr = ipv4ToInt(address);
  const net = ipv4ToInt(base);
  if (addr === null || net === null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (addr & mask) === (net & mask);
}

function expandIpv6(address: string): string[] | null {
  const clean = address.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0] as string;
  if (isIP(clean) !== 6) return null;
  const [head = '', tail = ''] = clean.includes('::') ? clean.split('::') : [clean, ''];
  const headParts = head ? head.split(':') : [];
  const tailParts = tail ? tail.split(':') : [];
  const expandEmbedded = (parts: string[]): string[] => {
    const out: string[] = [];
    for (const part of parts) {
      if (part.includes('.')) {
        const int = ipv4ToInt(part);
        if (int === null) return parts;
        out.push(((int >>> 16) & 0xffff).toString(16), (int & 0xffff).toString(16));
      } else {
        out.push(part);
      }
    }
    return out;
  };
  const headHextets = expandEmbedded(headParts);
  const tailHextets = expandEmbedded(tailParts);
  const fill = 8 - headHextets.length - tailHextets.length;
  if (fill < 0) return null;
  const full = [...headHextets, ...Array<string>(clean.includes('::') ? fill : 0).fill('0'), ...tailHextets];
  if (full.length !== 8) return null;
  return full.map((hextet) => hextet.padStart(4, '0'));
}

/** Returns the embedded IPv4 address for mapped/6to4/NAT64 forms, else null. */
export function extractEmbeddedIpv4(address: string): string | null {
  const hextets = expandIpv6(address);
  if (!hextets) return null;
  const joined = hextets.join(':');
  const toIpv4 = (a: string, b: string): string => {
    const high = parseInt(a, 16);
    const low = parseInt(b, 16);
    return [(high >> 8) & 0xff, high & 0xff, (low >> 8) & 0xff, low & 0xff].join('.');
  };
  // ::ffff:a.b.c.d (IPv4-mapped) and ::a.b.c.d (IPv4-compatible)
  if (joined.startsWith('0000:0000:0000:0000:0000:ffff:')) {
    return toIpv4(hextets[6] as string, hextets[7] as string);
  }
  if (joined.startsWith('0000:0000:0000:0000:0000:0000:') && joined !== '0000:0000:0000:0000:0000:0000:0000:0000') {
    return toIpv4(hextets[6] as string, hextets[7] as string);
  }
  // 2002:a.b.c.d::/16 (6to4)
  if (hextets[0] === '2002') {
    return toIpv4(hextets[1] as string, hextets[2] as string);
  }
  // 64:ff9b::/96 (NAT64)
  if (joined.startsWith('0064:ff9b:0000:0000:0000:0000:')) {
    return toIpv4(hextets[6] as string, hextets[7] as string);
  }
  return null;
}

export interface AddressVerdict {
  blocked: boolean;
  reason?: SsrfBlockReason;
  detail?: string;
}

/** Central address policy. Every resolved address passes through this function. */
export function assessAddress(address: string, policy: SsrfPolicy = DEFAULT_SSRF_POLICY): AddressVerdict {
  const raw = address.replace(/^\[|\]$/g, '').split('%')[0] as string;
  const family = isIP(raw);
  if (family === 0) {
    return { blocked: true, reason: 'OBFUSCATED_ADDRESS', detail: `"${address}" is not a valid IP.` };
  }

  if (METADATA_ADDRESSES.has(raw.toLowerCase())) {
    return {
      blocked: true,
      reason: 'METADATA_ADDRESS',
      detail: 'Cloud instance metadata endpoint.',
    };
  }

  if (family === 6) {
    const embedded = extractEmbeddedIpv4(raw);
    if (embedded) {
      const verdict = assessAddress(embedded, policy);
      if (verdict.blocked) {
        return {
          blocked: true,
          reason: verdict.reason,
          detail: `IPv6 address embeds IPv4 ${embedded}: ${verdict.detail ?? 'blocked'}`,
        };
      }
    }
    const hextets = expandIpv6(raw);
    if (!hextets) {
      return { blocked: true, reason: 'OBFUSCATED_ADDRESS', detail: 'Unparseable IPv6 address.' };
    }
    const joined = hextets.join('');
    const first = parseInt(hextets[0] as string, 16);
    if (joined === '0'.repeat(32)) {
      return { blocked: true, reason: 'MULTICAST_OR_RESERVED', detail: 'Unspecified address ::' };
    }
    if (joined === `${'0'.repeat(31)}1`) {
      return { blocked: true, reason: 'LOOPBACK_ADDRESS', detail: 'IPv6 loopback ::1' };
    }
    if ((first & 0xfe00) === 0xfc00) {
      return { blocked: true, reason: 'PRIVATE_ADDRESS', detail: 'IPv6 unique local address fc00::/7' };
    }
    if ((first & 0xffc0) === 0xfe80) {
      return { blocked: true, reason: 'LINK_LOCAL_ADDRESS', detail: 'IPv6 link-local fe80::/10' };
    }
    if ((first & 0xff00) === 0xff00) {
      return { blocked: true, reason: 'MULTICAST_OR_RESERVED', detail: 'IPv6 multicast ff00::/8' };
    }
    if (first === 0x2001 && parseInt(hextets[1] as string, 16) === 0x0db8) {
      return { blocked: true, reason: 'MULTICAST_OR_RESERVED', detail: 'IPv6 documentation range' };
    }
    if (first === 0x0100 && hextets.slice(1, 4).every((h) => h === '0000')) {
      return { blocked: true, reason: 'MULTICAST_OR_RESERVED', detail: 'IPv6 discard prefix 100::/64' };
    }
    return { blocked: false };
  }

  if (raw === '255.255.255.255') {
    return { blocked: true, reason: 'MULTICAST_OR_RESERVED', detail: 'Broadcast address' };
  }
  for (const [base, bits, reason, label] of IPV4_BLOCKS) {
    if (inIpv4Block(raw, base, bits)) {
      return { blocked: true, reason, detail: `${raw} is in the ${label} (${base}/${bits}).` };
    }
  }
  return { blocked: false };
}

/**
 * Rejects decimal/octal/hex encoded IP literals such as 2130706433,
 * 0x7f.0.0.1 or 0177.0.0.1 which bypass naive string comparisons.
 */
export function detectObfuscatedIpLiteral(hostname: string): string | null {
  const host = hostname.toLowerCase();
  if (isIP(host) !== 0) return null;
  if (!/^[0-9a-fx.]+$/.test(host)) return null;
  if (/^\d+$/.test(host)) return 'Decimal IP literals are not accepted.';
  if (/(^|\.)0x[0-9a-f]+/.test(host)) return 'Hexadecimal IP literals are not accepted.';
  if (/(^|\.)0\d+/.test(host)) return 'Octal IP literals are not accepted.';
  const parts = host.split('.');
  if (parts.length > 0 && parts.length < 4 && parts.every((p) => /^\d+$/.test(p))) {
    return 'Short-form IP literals are not accepted.';
  }
  return null;
}

export function assessHostname(hostname: string, policy: SsrfPolicy = DEFAULT_SSRF_POLICY): AddressVerdict {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host) return { blocked: true, reason: 'BLOCKED_HOSTNAME', detail: 'Empty hostname.' };

  if (policy.blockedHostnames.includes(host)) {
    return { blocked: true, reason: 'BLOCKED_HOSTNAME', detail: `"${host}" is not a public host.` };
  }
  if (policy.blockedSuffixes.some((suffix) => host.endsWith(suffix))) {
    return {
      blocked: true,
      reason: 'BLOCKED_HOSTNAME',
      detail: `"${host}" uses a private/internal domain suffix.`,
    };
  }
  // Single-label hostnames are container/service names (redis, postgres, minio...).
  if (!host.includes('.') && isIP(host) === 0) {
    return {
      blocked: true,
      reason: 'BLOCKED_HOSTNAME',
      detail: `"${host}" is a single-label host name and cannot be a public website.`,
    };
  }
  const obfuscated = detectObfuscatedIpLiteral(host);
  if (obfuscated) {
    return { blocked: true, reason: 'OBFUSCATED_ADDRESS', detail: obfuscated };
  }
  if (isIP(host) !== 0) {
    return assessAddress(host, policy);
  }
  return { blocked: false };
}

export function assessPort(port: number | null, policy: SsrfPolicy = DEFAULT_SSRF_POLICY): AddressVerdict {
  if (port === null) return { blocked: false };
  if (policy.blockedPorts.includes(port)) {
    return {
      blocked: true,
      reason: 'BLOCKED_PORT',
      detail: `Port ${port} belongs to an infrastructure service and is not fetched.`,
    };
  }
  return { blocked: false };
}

/**
 * Full pre-connection check for a single URL hop.
 *
 * Resolves DNS *once* and returns the validated addresses so the caller can pin
 * the socket to them. Pinning is what closes the DNS-rebinding/TOCTOU window:
 * the address that was validated is the address that gets connected to.
 */
export async function assertUrlIsFetchable(
  url: URL,
  policy: SsrfPolicy = DEFAULT_SSRF_POLICY,
  resolver: (hostname: string) => Promise<Array<{ address: string; family: number }>> = defaultResolver,
): Promise<HostAssessment> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SsrfError(
      'UNSUPPORTED_SCHEME',
      `Protocol "${url.protocol.replace(':', '')}" is not fetched. Only http and https are allowed.`,
    );
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const portVerdict = assessPort(url.port ? Number(url.port) : null, policy);
  if (portVerdict.blocked) {
    throw new SsrfError(portVerdict.reason ?? 'BLOCKED_PORT', portVerdict.detail ?? 'Blocked port.');
  }

  const hostVerdict = assessHostname(hostname, policy);
  if (
    hostVerdict.blocked &&
    (!policy.allowPrivateNetwork || isAlwaysBlocked(hostVerdict, hostname))
  ) {
    throw new SsrfError(hostVerdict.reason ?? 'BLOCKED_HOSTNAME', hostVerdict.detail ?? 'Blocked host.');
  }

  if (isIP(hostname) !== 0) {
    return {
      hostname,
      addresses: [{ address: hostname, family: isIP(hostname) === 6 ? 6 : 4 }],
    };
  }

  let resolved: Array<{ address: string; family: number }>;
  try {
    resolved = await resolver(hostname);
  } catch (error) {
    throw new SsrfError(
      'DNS_FAILURE',
      `DNS lookup failed for "${hostname}": ${(error as Error).message}`,
    );
  }
  if (resolved.length === 0) {
    throw new SsrfError('DNS_FAILURE', `DNS lookup returned no records for "${hostname}".`);
  }

  if (policy.allowPrivateNetwork) {
    // The escape hatch opens loopback/RFC1918 for local development only.
    // Cloud metadata and link-local stay closed: there is no legitimate reason
    // for a submitted URL to reach them, in any environment.
    for (const entry of resolved) {
      const verdict = assessAddress(entry.address, policy);
      if (isAlwaysBlocked(verdict, hostname)) {
        throw new SsrfError(
          verdict.reason ?? 'METADATA_ADDRESS',
          `"${hostname}" resolves to a metadata or link-local address.`,
        );
      }
    }
    return {
      hostname,
      addresses: resolved.map((entry) => ({
        address: entry.address,
        family: entry.family === 6 ? 6 : 4,
      })),
    };
  }

  const safe: HostAssessment['addresses'] = [];
  let firstBlock: AddressVerdict | undefined;
  for (const entry of resolved) {
    const verdict = assessAddress(entry.address, policy);
    if (verdict.blocked) {
      firstBlock ??= verdict;
      continue;
    }
    safe.push({ address: entry.address, family: entry.family === 6 ? 6 : 4 });
  }

  // If ANY resolved address is private the host is rejected outright: a mixed
  // answer is the classic rebinding signature.
  if (safe.length !== resolved.length) {
    throw new SsrfError(
      firstBlock?.reason ?? 'PRIVATE_ADDRESS',
      `"${hostname}" resolves to a non-public address. ${firstBlock?.detail ?? ''}`.trim(),
    );
  }
  if (safe.length === 0) {
    throw new SsrfError('NO_PUBLIC_ADDRESS', `"${hostname}" has no public address.`);
  }
  return { hostname, addresses: safe };
}

const METADATA_HOSTNAMES = new Set([
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
]);

/** Blocks that the development escape hatch must never lift. */
function isAlwaysBlocked(verdict: AddressVerdict, hostname: string): boolean {
  if (METADATA_HOSTNAMES.has(hostname)) return true;
  return verdict.reason === 'METADATA_ADDRESS' || verdict.reason === 'LINK_LOCAL_ADDRESS';
}

async function defaultResolver(
  hostname: string,
): Promise<Array<{ address: string; family: number }>> {
  const entries = await dnsLookup(hostname, { all: true, verbatim: true });
  return entries.map((entry) => ({ address: entry.address, family: entry.family }));
}
