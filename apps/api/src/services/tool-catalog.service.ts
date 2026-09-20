import { prisma } from '@indexpilot/db';
import {
  TOOL_CATALOG,
  findCatalogEntry,
  notFound,
  type ToolCatalogEntry,
  type ToolEngineKey,
} from '@indexpilot/shared';

/**
 * Reads the tool catalogue.
 *
 * The database is authoritative, but the code-level catalogue in
 * `@indexpilot/shared` is a working fallback: the public tool pages must render
 * on a fresh install before anyone has run the seed, and a database blip must
 * not 404 a page that Google has indexed.
 */

export interface ResolvedTool extends ToolCatalogEntry {
  id: string | null;
  enabled: boolean;
  requiresAuth: boolean;
}

function fromCatalog(entry: ToolCatalogEntry): ResolvedTool {
  return { ...entry, id: null, enabled: true, requiresAuth: false };
}

export async function listTools(options: { includeDisabled?: boolean } = {}): Promise<ResolvedTool[]> {
  try {
    const rows = await prisma.toolDefinition.findMany({
      where: options.includeDisabled ? {} : { enabled: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    if (rows.length > 0) {
      return rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        name: row.name,
        engine: row.engine as ToolEngineKey,
        headline: row.headline,
        intro: row.intro,
        metaTitle: row.metaTitle,
        metaDescription: row.metaDescription,
        listed: row.listed,
        sortOrder: row.sortOrder,
        enabled: row.enabled,
        requiresAuth: row.requiresAuth,
      }));
    }
  } catch {
    // Fall through to the built-in catalogue.
  }
  return TOOL_CATALOG.map(fromCatalog).sort((a, b) => a.sortOrder - b.sortOrder);
}

export async function getTool(slug: string): Promise<ResolvedTool> {
  try {
    const row = await prisma.toolDefinition.findUnique({ where: { slug } });
    if (row) {
      return {
        id: row.id,
        slug: row.slug,
        name: row.name,
        engine: row.engine as ToolEngineKey,
        headline: row.headline,
        intro: row.intro,
        metaTitle: row.metaTitle,
        metaDescription: row.metaDescription,
        listed: row.listed,
        sortOrder: row.sortOrder,
        enabled: row.enabled,
        requiresAuth: row.requiresAuth,
      };
    }
  } catch {
    // Fall through to the built-in catalogue.
  }

  const entry = findCatalogEntry(slug);
  if (!entry) throw notFound('That tool does not exist.');
  return fromCatalog(entry);
}

/**
 * True when `userId` holds an unexpired grant for this tool. Used for tools an
 * admin has marked as requiring an account.
 */
export async function hasToolGrant(userId: string, toolId: string | null): Promise<boolean> {
  if (!toolId) return false;
  const grant = await prisma.toolAccessGrant.findUnique({
    where: { userId_toolId: { userId, toolId } },
  });
  if (!grant) return false;
  return grant.expiresAt === null || grant.expiresAt > new Date();
}
