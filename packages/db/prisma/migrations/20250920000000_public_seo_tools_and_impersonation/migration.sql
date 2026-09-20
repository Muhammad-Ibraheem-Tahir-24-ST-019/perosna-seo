-- CreateEnum
CREATE TYPE "ToolEngine" AS ENUM ('ROBOTS_TXT', 'PAGE_META', 'SITEMAP');

-- CreateEnum
CREATE TYPE "ToolRunOutcome" AS ENUM ('COMPLETED', 'FETCH_FAILED', 'BLOCKED', 'INVALID_INPUT', 'RATE_LIMITED');

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "impersonatedByEmail" TEXT,
ADD COLUMN     "impersonatedByUserId" TEXT;

-- CreateTable
CREATE TABLE "tool_definitions" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "engine" "ToolEngine" NOT NULL,
    "headline" TEXT NOT NULL,
    "intro" TEXT NOT NULL,
    "metaTitle" TEXT NOT NULL,
    "metaDescription" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "requiresAuth" BOOLEAN NOT NULL DEFAULT false,
    "listed" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tool_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tool_runs" (
    "id" TEXT NOT NULL,
    "toolId" TEXT,
    "toolSlug" TEXT NOT NULL,
    "engine" "ToolEngine" NOT NULL,
    "userId" TEXT,
    "ipHash" TEXT,
    "targetHost" TEXT,
    "outcome" "ToolRunOutcome" NOT NULL DEFAULT 'COMPLETED',
    "cached" BOOLEAN NOT NULL DEFAULT false,
    "issueCount" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tool_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tool_access_grants" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "toolId" TEXT NOT NULL,
    "grantedById" TEXT,
    "hourlyLimit" INTEGER,
    "expiresAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tool_access_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tool_definitions_slug_key" ON "tool_definitions"("slug");

-- CreateIndex
CREATE INDEX "tool_definitions_enabled_sortOrder_idx" ON "tool_definitions"("enabled", "sortOrder");

-- CreateIndex
CREATE INDEX "tool_definitions_engine_idx" ON "tool_definitions"("engine");

-- CreateIndex
CREATE INDEX "tool_runs_toolSlug_createdAt_idx" ON "tool_runs"("toolSlug", "createdAt");

-- CreateIndex
CREATE INDEX "tool_runs_userId_createdAt_idx" ON "tool_runs"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "tool_runs_createdAt_idx" ON "tool_runs"("createdAt");

-- CreateIndex
CREATE INDEX "tool_access_grants_userId_idx" ON "tool_access_grants"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "tool_access_grants_userId_toolId_key" ON "tool_access_grants"("userId", "toolId");

-- CreateIndex
CREATE INDEX "sessions_impersonatedByUserId_idx" ON "sessions"("impersonatedByUserId");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_impersonatedByUserId_fkey" FOREIGN KEY ("impersonatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tool_runs" ADD CONSTRAINT "tool_runs_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "tool_definitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tool_runs" ADD CONSTRAINT "tool_runs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tool_access_grants" ADD CONSTRAINT "tool_access_grants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tool_access_grants" ADD CONSTRAINT "tool_access_grants_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tool_access_grants" ADD CONSTRAINT "tool_access_grants_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "tool_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

