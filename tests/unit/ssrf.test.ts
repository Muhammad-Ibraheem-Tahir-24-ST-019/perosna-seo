import { describe, expect, it } from 'vitest';
import {
  assertUrlIsFetchable,
  assessAddress,
  assessHostname,
  assessPort,
  detectObfuscatedIpLiteral,
  extractEmbeddedIpv4,
  DEFAULT_SSRF_POLICY,
  SsrfError,
} from '../../packages/validation/src/ssrf.js';

/**
 * These are the platform's most important tests: users submit URLs they do not
 * own, so a gap here means a public URL can reach internal infrastructure.
 */
describe('SSRF address policy', () => {
  const blocked = [
    ['127.0.0.1', 'loopback'],
    ['127.255.255.254', 'loopback range'],
    ['0.0.0.0', 'this network'],
    ['10.0.0.1', 'RFC1918'],
    ['10.255.255.255', 'RFC1918'],
    ['172.16.0.1', 'RFC1918'],
    ['172.31.255.255', 'RFC1918'],
    ['192.168.1.1', 'RFC1918'],
    ['169.254.169.254', 'AWS/GCP metadata'],
    ['169.254.170.2', 'ECS task metadata'],
    ['100.100.100.200', 'Alibaba metadata'],
    ['100.64.0.1', 'CGNAT'],
    ['224.0.0.1', 'multicast'],
    ['240.0.0.1', 'reserved'],
    ['255.255.255.255', 'broadcast'],
    ['198.18.0.1', 'benchmark'],
  ] as const;

  for (const [address, label] of blocked) {
    it(`blocks ${address} (${label})`, () => {
      expect(assessAddress(address).blocked).toBe(true);
    });
  }

  const allowed = ['8.8.8.8', '1.1.1.1', '93.184.216.34', '151.101.1.140'];
  for (const address of allowed) {
    it(`allows public address ${address}`, () => {
      expect(assessAddress(address).blocked).toBe(false);
    });
  }

  it('blocks IPv6 loopback, ULA, link-local and multicast', () => {
    expect(assessAddress('::1').blocked).toBe(true);
    expect(assessAddress('fc00::1').blocked).toBe(true);
    expect(assessAddress('fd12:3456::1').blocked).toBe(true);
    expect(assessAddress('fe80::1').blocked).toBe(true);
    expect(assessAddress('ff02::1').blocked).toBe(true);
    expect(assessAddress('::').blocked).toBe(true);
  });

  it('allows a public IPv6 address', () => {
    expect(assessAddress('2606:4700:4700::1111').blocked).toBe(false);
  });

  it('unwraps IPv4-mapped IPv6 and applies the IPv4 rules', () => {
    expect(extractEmbeddedIpv4('::ffff:127.0.0.1')).toBe('127.0.0.1');
    expect(assessAddress('::ffff:127.0.0.1').blocked).toBe(true);
    expect(assessAddress('::ffff:169.254.169.254').blocked).toBe(true);
    expect(assessAddress('::ffff:8.8.8.8').blocked).toBe(false);
  });

  it('unwraps 6to4 and NAT64 embedded addresses', () => {
    expect(extractEmbeddedIpv4('2002:7f00:0001::')).toBe('127.0.0.1');
    expect(assessAddress('2002:7f00:0001::').blocked).toBe(true);
    expect(assessAddress('64:ff9b::a00:1').blocked).toBe(true);
  });
});

describe('SSRF hostname policy', () => {
  const blockedHosts = [
    'localhost',
    'LOCALHOST',
    'redis',
    'postgres',
    'minio',
    'db.internal',
    'printer.local',
    'metadata.google.internal',
    'service.intranet',
    'host.lan',
  ];

  for (const host of blockedHosts) {
    it(`blocks hostname "${host}"`, () => {
      expect(assessHostname(host).blocked).toBe(true);
    });
  }

  it('allows ordinary public hostnames', () => {
    expect(assessHostname('example.com').blocked).toBe(false);
    expect(assessHostname('blog.example.co.uk').blocked).toBe(false);
  });

  it('rejects decimal, octal, hex and short-form IP literals', () => {
    expect(detectObfuscatedIpLiteral('2130706433')).not.toBeNull();
    expect(detectObfuscatedIpLiteral('0x7f000001')).not.toBeNull();
    expect(detectObfuscatedIpLiteral('0177.0.0.1')).not.toBeNull();
    expect(detectObfuscatedIpLiteral('127.1')).not.toBeNull();
    expect(detectObfuscatedIpLiteral('example.com')).toBeNull();

    expect(assessHostname('2130706433').blocked).toBe(true);
    expect(assessHostname('0x7f000001').blocked).toBe(true);
  });

  it('blocks infrastructure ports', () => {
    expect(assessPort(6379).blocked).toBe(true);
    expect(assessPort(5432).blocked).toBe(true);
    expect(assessPort(27017).blocked).toBe(true);
    expect(assessPort(443).blocked).toBe(false);
    expect(assessPort(8080).blocked).toBe(false);
    expect(assessPort(null).blocked).toBe(false);
  });
});

describe('assertUrlIsFetchable', () => {
  const resolver = (map: Record<string, string[]>) => async (hostname: string) => {
    const addresses = map[hostname];
    if (!addresses) throw new Error('NXDOMAIN');
    return addresses.map((address) => ({
      address,
      family: address.includes(':') ? 6 : 4,
    }));
  };

  it('rejects non-http protocols', async () => {
    await expect(
      assertUrlIsFetchable(new URL('file:///etc/passwd'), DEFAULT_SSRF_POLICY, resolver({})),
    ).rejects.toBeInstanceOf(SsrfError);
    await expect(
      assertUrlIsFetchable(new URL('gopher://example.com/'), DEFAULT_SSRF_POLICY, resolver({})),
    ).rejects.toBeInstanceOf(SsrfError);
  });

  it('rejects a public hostname that resolves to a private address', async () => {
    await expect(
      assertUrlIsFetchable(
        new URL('https://evil.example.com/'),
        DEFAULT_SSRF_POLICY,
        resolver({ 'evil.example.com': ['10.0.0.5'] }),
      ),
    ).rejects.toMatchObject({ reason: 'PRIVATE_ADDRESS' });
  });

  it('rejects a mixed answer (rebinding signature) even when one address is public', async () => {
    await expect(
      assertUrlIsFetchable(
        new URL('https://rebind.example.com/'),
        DEFAULT_SSRF_POLICY,
        resolver({ 'rebind.example.com': ['8.8.8.8', '127.0.0.1'] }),
      ),
    ).rejects.toBeInstanceOf(SsrfError);
  });

  it('pins the connection to the validated addresses', async () => {
    const assessment = await assertUrlIsFetchable(
      new URL('https://good.example.com/page'),
      DEFAULT_SSRF_POLICY,
      resolver({ 'good.example.com': ['93.184.216.34'] }),
    );
    expect(assessment.addresses).toEqual([{ address: '93.184.216.34', family: 4 }]);
  });

  it('surfaces DNS failures as a policy error rather than a crash', async () => {
    await expect(
      assertUrlIsFetchable(
        new URL('https://missing.example.com/'),
        DEFAULT_SSRF_POLICY,
        resolver({}),
      ),
    ).rejects.toMatchObject({ reason: 'DNS_FAILURE' });
  });

  it('honours the development escape hatch only when explicitly enabled', async () => {
    const policy = { ...DEFAULT_SSRF_POLICY, allowPrivateNetwork: true };
    const assessment = await assertUrlIsFetchable(
      new URL('http://local.example.com:3000/'),
      policy,
      resolver({ 'local.example.com': ['127.0.0.1'] }),
    );
    expect(assessment.addresses[0]?.address).toBe('127.0.0.1');
  });
});
