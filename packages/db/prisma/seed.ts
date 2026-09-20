/**
 * Development seed. Refuses to run against NODE_ENV=production so demo data can
 * never appear in a real deployment.
 */
import { PrismaClient } from '@prisma/client';
import { env } from '@indexpilot/config';
import { TOOL_CATALOG } from '@indexpilot/shared';
import { hashPassword, hashNormalizedUrlSafe } from './seed-utils.js';

const prisma = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });

const DEMO_PASSWORD = 'Demo123!pass';
const ADMIN_PASSWORD = 'Admin123!pass';

async function main(): Promise<void> {
  if (env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed demo data with NODE_ENV=production.');
  }

  console.log('Seeding development data...');

  const [adminHash, demoHash] = await Promise.all([
    hashPassword(ADMIN_PASSWORD),
    hashPassword(DEMO_PASSWORD),
  ]);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@indexpilot.local' },
    update: { role: 'SUPER_ADMIN', status: 'ACTIVE' },
    create: {
      email: 'admin@indexpilot.local',
      name: 'Platform Admin',
      passwordHash: adminHash,
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      wallet: { create: { cachedBalance: 0 } },
    },
  });

  const demo = await prisma.user.upsert({
    where: { email: 'demo@indexpilot.local' },
    update: { status: 'ACTIVE' },
    create: {
      email: 'demo@indexpilot.local',
      name: 'Demo Customer',
      passwordHash: demoHash,
      role: 'USER',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      wallet: { create: { cachedBalance: 0 } },
    },
  });

  // Credits always arrive through the ledger, even in the seed.
  const demoWallet = await prisma.creditWallet.upsert({
    where: { userId: demo.id },
    update: {},
    create: { userId: demo.id },
  });
  const existingGrant = await prisma.creditTransaction.findFirst({
    where: { walletId: demoWallet.id, referenceType: 'seed', referenceId: 'initial-grant' },
  });
  if (!existingGrant) {
    await prisma.$transaction([
      prisma.creditWallet.update({
        where: { id: demoWallet.id },
        data: { cachedBalance: { increment: 500 } },
      }),
      prisma.creditTransaction.create({
        data: {
          walletId: demoWallet.id,
          amount: 500,
          type: 'BONUS',
          referenceType: 'seed',
          referenceId: 'initial-grant',
          description: 'Development seed grant',
          balanceAfter: demoWallet.cachedBalance + 500,
        },
      }),
    ]);
  }

  const packages = [
    { name: 'Starter', credits: 500, priceCents: 1900, sortOrder: 1 },
    { name: 'Growth', credits: 2500, priceCents: 7900, sortOrder: 2 },
    { name: 'Agency', credits: 10000, priceCents: 24900, sortOrder: 3 },
    { name: 'Scale', credits: 50000, priceCents: 99900, sortOrder: 4 },
  ];
  for (const pkg of packages) {
    const existing = await prisma.creditPackage.findFirst({ where: { name: pkg.name } });
    if (existing) {
      await prisma.creditPackage.update({ where: { id: existing.id }, data: pkg });
    } else {
      await prisma.creditPackage.create({ data: { ...pkg, currency: 'USD', enabled: true } });
    }
  }

  const providers = [
    {
      key: 'mock',
      name: 'Local Mock Discovery',
      type: 'DISCOVERY' as const,
      enabled: true,
      priority: 10,
      rateLimitPerMin: 600,
    },
    {
      key: 'indexnow',
      name: 'IndexNow (Bing / Yandex / Seznam)',
      type: 'SEARCH_ENGINE_SUBMISSION' as const,
      enabled: false,
      priority: 20,
      rateLimitPerMin: 60,
    },
    {
      key: 'sitemap-ping',
      name: 'Sitemap Discovery Signals',
      type: 'DISCOVERY' as const,
      enabled: false,
      priority: 30,
      rateLimitPerMin: 60,
    },
  ];
  for (const provider of providers) {
    await prisma.discoveryProviderConfig.upsert({
      where: { key: provider.key },
      update: { name: provider.name, type: provider.type, priority: provider.priority },
      create: provider,
    });
  }

  /*
   * Public tool pages.
   *
   * Upserted rather than created so an operator's edits to copy survive a
   * re-seed: only the engine and the routing fields are forced back to the
   * catalogue, because those are the parts that must match the code.
   */
  for (const tool of TOOL_CATALOG) {
    await prisma.toolDefinition.upsert({
      where: { slug: tool.slug },
      update: { engine: tool.engine, sortOrder: tool.sortOrder },
      create: {
        slug: tool.slug,
        name: tool.name,
        engine: tool.engine,
        headline: tool.headline,
        intro: tool.intro,
        metaTitle: tool.metaTitle,
        metaDescription: tool.metaDescription,
        listed: tool.listed,
        sortOrder: tool.sortOrder,
      },
    });
  }

  const project = await prisma.project.upsert({
    where: { id: 'seed-demo-project' },
    update: {},
    create: {
      id: 'seed-demo-project',
      userId: demo.id,
      name: 'SEO Campaign - Demo',
      description: 'Seeded project showing every URL lifecycle state.',
    },
  });

  const samples: Array<{
    url: string;
    validationStatus: 'VALID' | 'INVALID' | 'BLOCKED';
    processingStatus:
      | 'QUEUED'
      | 'PROCESSING'
      | 'DISCOVERY_ATTEMPTED'
      | 'CRAWL_DETECTED'
      | 'FAILED'
      | 'NOT_QUEUED';
    verificationStatus:
      | 'NOT_CHECKED'
      | 'PENDING'
      | 'INDEXED_CONFIRMED'
      | 'NOT_CONFIRMED_INDEXED'
      | 'ERROR';
  }> = [
    { url: 'https://example.com/blog/how-indexing-works', validationStatus: 'VALID', processingStatus: 'CRAWL_DETECTED', verificationStatus: 'INDEXED_CONFIRMED' },
    { url: 'https://example.com/blog/technical-seo-guide', validationStatus: 'VALID', processingStatus: 'DISCOVERY_ATTEMPTED', verificationStatus: 'PENDING' },
    { url: 'https://example.com/guest-post/partner-site', validationStatus: 'VALID', processingStatus: 'DISCOVERY_ATTEMPTED', verificationStatus: 'NOT_CONFIRMED_INDEXED' },
    { url: 'https://example.com/press/launch-release', validationStatus: 'VALID', processingStatus: 'QUEUED', verificationStatus: 'NOT_CHECKED' },
    { url: 'https://example.com/directory/listing-404', validationStatus: 'INVALID', processingStatus: 'NOT_QUEUED', verificationStatus: 'NOT_CHECKED' },
    { url: 'https://example.com/private/staging-area', validationStatus: 'BLOCKED', processingStatus: 'NOT_QUEUED', verificationStatus: 'NOT_CHECKED' },
    { url: 'https://example.com/products/flagship-item', validationStatus: 'VALID', processingStatus: 'FAILED', verificationStatus: 'NOT_CHECKED' },
  ];

  for (const [index, sample] of samples.entries()) {
    const normalized = new URL(sample.url).toString();
    const createdAt = new Date(Date.now() - (samples.length - index) * 6 * 60 * 60 * 1000);
    await prisma.urlRecord.upsert({
      where: {
        projectId_normalizedUrlHash: {
          projectId: project.id,
          normalizedUrlHash: hashNormalizedUrlSafe(normalized),
        },
      },
      update: {
        validationStatus: sample.validationStatus,
        processingStatus: sample.processingStatus,
        verificationStatus: sample.verificationStatus,
      },
      create: {
        projectId: project.id,
        userId: demo.id,
        originalUrl: sample.url,
        normalizedUrl: normalized,
        normalizedUrlHash: hashNormalizedUrlSafe(normalized),
        scheme: 'https',
        hostname: new URL(normalized).hostname,
        path: new URL(normalized).pathname,
        validationStatus: sample.validationStatus,
        processingStatus: sample.processingStatus,
        verificationStatus: sample.verificationStatus,
        creditsCharged: sample.validationStatus === 'VALID' ? 1 : 0,
        createdAt,
        lastCheckedAt: sample.verificationStatus === 'NOT_CHECKED' ? null : new Date(),
      },
    });
  }

  console.log('Seed complete.');
  console.log(`  tool pages: ${TOOL_CATALOG.length}`);
  console.log(`  admin: admin@indexpilot.local / ${ADMIN_PASSWORD}`);
  console.log(`  user : demo@indexpilot.local / ${DEMO_PASSWORD}`);
  console.log(`  admin id: ${admin.id}, demo id: ${demo.id}`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
