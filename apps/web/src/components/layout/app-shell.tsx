'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  BarChart3,
  ChevronsLeft,
  Coins,
  FileText,
  FolderKanban,
  Link2,
  LogOut,
  Menu,
  Moon,
  Plug,
  Plus,
  Settings,
  Shield,
  Sun,
  Upload,
  UserCog,
  Wrench,
} from 'lucide-react';
import {
  Dialog,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  SheetContent,
} from '@/components/ui/overlay';
import { Button } from '@/components/ui/core';
import { Logo, LogoMark } from '@/components/brand';
import { isAdmin, useLogout, useSession } from '@/hooks/use-session';
import { api } from '@/lib/api';
import { cn, formatNumber } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    items: [{ href: '/dashboard', label: 'Dashboard', icon: BarChart3 }],
  },
  {
    label: 'Indexing',
    items: [
      { href: '/projects', label: 'Projects', icon: FolderKanban },
      { href: '/urls', label: 'URLs', icon: Link2 },
      { href: '/submit', label: 'New submission', icon: Upload },
      { href: '/reports', label: 'Reports', icon: FileText },
    ],
  },
  {
    label: 'Tools',
    items: [{ href: '/tools', label: 'Free SEO tools', icon: Wrench }],
  },
  {
    label: 'Account',
    items: [
      { href: '/api-keys', label: 'API', icon: Plug },
      { href: '/billing', label: 'Billing', icon: Coins },
      { href: '/settings', label: 'Settings', icon: Settings },
      { href: '/admin', label: 'Admin', icon: Shield, adminOnly: true },
    ],
  },
];

const COLLAPSE_KEY = 'ip:sidebar-collapsed';

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: user, isLoading } = useSession();
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState(false);

  // Restore the rail preference after mount so the server render stays stable.
  React.useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === '1');
    } catch {
      // Private mode or blocked storage: the default is fine.
    }
  }, []);

  const toggleCollapsed = React.useCallback(() => {
    setCollapsed((previous) => {
      const next = !previous;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      } catch {
        // Not worth surfacing; the preference just will not persist.
      }
      return next;
    });
  }, []);

  React.useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  React.useEffect(() => {
    if (!isLoading && user === null) router.replace('/login');
  }, [isLoading, user, router]);

  const groups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.adminOnly || isAdmin(user)),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="flex min-h-dvh w-full flex-col">
      {user?.impersonatedBy ? <ImpersonationBanner email={user.email} admin={user.impersonatedBy.email} /> : null}

      <div className="flex min-h-0 w-full flex-1">
        <aside
          className={cn(
            'sticky top-0 hidden h-dvh shrink-0 flex-col border-r bg-sidebar transition-[width] duration-200 lg:flex',
            collapsed ? 'w-[4.25rem]' : 'w-[15.5rem]',
          )}
          aria-label="Main navigation"
        >
          <div
            className={cn(
              'flex h-14 items-center border-b border-sidebar-border',
              collapsed ? 'justify-center px-2' : 'justify-between px-4',
            )}
          >
            {collapsed ? (
              <Link href="/dashboard" aria-label="IndexPilot dashboard">
                <LogoMark className="h-7 w-7" />
              </Link>
            ) : (
              <Logo href="/dashboard" id="sidebar" markClassName="h-7 w-7" />
            )}
            {!collapsed ? (
              <button
                type="button"
                onClick={toggleCollapsed}
                aria-label="Collapse sidebar"
                className="rounded-md p-1 text-sidebar-muted transition-colors hover:bg-sidebar-accent hover:text-foreground"
              >
                <ChevronsLeft className="h-4 w-4" />
              </button>
            ) : null}
          </div>

          <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-3 scrollbar-thin">
            {groups.map((group) => (
              <NavSection
                key={group.label}
                group={group}
                pathname={pathname}
                collapsed={collapsed}
              />
            ))}
          </nav>

          <div className="border-t border-sidebar-border p-2">
            {collapsed ? (
              <button
                type="button"
                onClick={toggleCollapsed}
                aria-label="Expand sidebar"
                className="flex w-full items-center justify-center rounded-md p-2 text-sidebar-muted transition-colors hover:bg-sidebar-accent hover:text-foreground"
              >
                <ChevronsLeft className="h-4 w-4 rotate-180" />
              </button>
            ) : (
              <CreditsCard credits={user?.credits ?? 0} />
            )}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-4 lg:px-6">
            <Dialog open={drawerOpen} onOpenChange={setDrawerOpen}>
              <DialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="lg:hidden"
                  aria-label="Open navigation menu"
                  aria-expanded={drawerOpen}
                  data-testid="mobile-menu-button"
                >
                  <Menu className="h-5 w-5" />
                </Button>
              </DialogTrigger>
              <SheetContent
                side="left"
                aria-label="Main navigation"
                className="border-sidebar-border bg-sidebar p-0"
              >
                <DialogTitle className="sr-only">Navigation menu</DialogTitle>
                <div className="flex h-14 items-center border-b border-sidebar-border px-4">
                  <Logo href="/dashboard" id="drawer" markClassName="h-7 w-7" />
                </div>
                <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-3 scrollbar-thin">
                  {groups.map((group) => (
                    <NavSection
                      key={group.label}
                      group={group}
                      pathname={pathname}
                      collapsed={false}
                      onNavigate={() => setDrawerOpen(false)}
                    />
                  ))}
                </nav>
                <div className="border-t border-sidebar-border p-2">
                  <CreditsCard credits={user?.credits ?? 0} />
                </div>
              </SheetContent>
            </Dialog>

            <div className="lg:hidden">
              <Link href="/dashboard" aria-label="IndexPilot dashboard">
                <LogoMark className="h-7 w-7" />
              </Link>
            </div>

            <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
              <Link
                href="/billing"
                className="hidden items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-accent sm:inline-flex"
              >
                <Coins className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                <span className="tabular-nums">{formatNumber(user?.credits ?? 0)}</span>
                <span className="text-muted-foreground">credits</span>
              </Link>

              <Button asChild size="sm" className="hidden sm:inline-flex">
                <Link href="/submit">
                  <Plus className="h-4 w-4" aria-hidden />
                  Submit URLs
                </Link>
              </Button>

              <ThemeToggle />
              <ProfileMenu email={user?.email} name={user?.name ?? null} role={user?.role} />
            </div>
          </header>

          <main id="main-content" className="min-w-0 flex-1 px-3 py-5 sm:px-5 sm:py-6 lg:px-8">
            <div className="mx-auto w-full max-w-[85rem]">{children}</div>
          </main>
        </div>
      </div>
    </div>
  );
}

/**
 * Persistent, unmissable banner while an admin is acting as someone else.
 *
 * This is a safety control, not decoration: without it, an admin can forget
 * whose account they are in and take a destructive action believing it is
 * their own.
 */
function ImpersonationBanner({ email, admin }: { email: string; admin: string }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const stop = useMutation({
    mutationFn: () => api.auth.stopImpersonation(),
    onSuccess: () => {
      queryClient.clear();
      router.replace('/login');
      router.refresh();
    },
  });

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-warning px-4 py-2 text-center text-sm font-medium text-warning-foreground">
      <span className="flex items-center gap-2">
        <UserCog className="h-4 w-4 shrink-0" aria-hidden />
        Viewing as <span className="font-semibold">{email}</span>
        <span className="hidden font-normal opacity-80 sm:inline">(signed in as {admin})</span>
      </span>
      <button
        type="button"
        onClick={() => stop.mutate()}
        disabled={stop.isPending}
        className="rounded-md bg-warning-foreground/15 px-2.5 py-1 text-xs font-semibold underline-offset-2 transition-colors hover:bg-warning-foreground/25 disabled:opacity-60"
      >
        {stop.isPending ? 'Ending…' : 'End session'}
      </button>
    </div>
  );
}

function NavSection({
  group,
  pathname,
  collapsed,
  onNavigate,
}: {
  group: NavGroup;
  pathname: string;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  return (
    <div className="space-y-0.5">
      {collapsed ? (
        <div className="mx-2 my-2 h-px bg-sidebar-border" aria-hidden />
      ) : (
        <p className="px-3 pb-1 text-[0.6875rem] font-medium uppercase tracking-wider text-sidebar-muted">
          {group.label}
        </p>
      )}
      {group.items.map((item) => {
        const Icon = item.icon;
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            title={collapsed ? item.label : undefined}
            className={cn(
              'group flex items-center gap-2.5 rounded-md text-sm transition-colors',
              collapsed ? 'justify-center px-2 py-2.5' : 'px-3 py-2',
              active
                ? 'bg-sidebar-accent font-medium text-foreground'
                : 'font-normal text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground',
            )}
          >
            <Icon
              className={cn(
                'h-4 w-4 shrink-0',
                active ? 'text-foreground' : 'text-sidebar-muted group-hover:text-foreground',
              )}
            />
            {!collapsed ? <span className="truncate">{item.label}</span> : null}
          </Link>
        );
      })}
    </div>
  );
}

function CreditsCard({ credits }: { credits: number }) {
  return (
    <Link
      href="/billing"
      className="block rounded-md border border-sidebar-border bg-background p-3 transition-colors hover:bg-accent"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-sidebar-muted">Available credits</span>
        <Coins className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
      </div>
      <p className="mt-1 text-lg font-semibold tabular-nums">{formatNumber(credits)}</p>
      <p className="mt-0.5 text-xs text-sidebar-muted">1 credit = 1 URL processed</p>
    </Link>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle colour theme"
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
    >
      {mounted && resolvedTheme === 'dark' ? (
        <Sun className="h-4 w-4" />
      ) : (
        <Moon className="h-4 w-4" />
      )}
    </Button>
  );
}

function ProfileMenu({
  email,
  name,
  role,
}: {
  email?: string;
  name: string | null;
  role?: string;
}) {
  const logout = useLogout();
  const label = name || email || 'Account';
  const initials = (name || email || '?')
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account menu"
          data-testid="profile-menu"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-xs font-medium text-secondary-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {initials || '?'}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>
          <span className="block truncate text-sm font-medium text-foreground">{label}</span>
          {email && name ? (
            <span className="block truncate text-xs font-normal text-muted-foreground">{email}</span>
          ) : null}
          {role && role !== 'USER' ? (
            <span className="mt-1.5 inline-flex rounded border px-1.5 py-0.5 text-[0.6875rem] font-medium text-muted-foreground">
              {role.replace('_', ' ').toLowerCase()}
            </span>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings className="h-4 w-4" />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/billing">
            <Coins className="h-4 w-4" />
            Billing
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          data-testid="logout-button"
          className="text-destructive focus:text-destructive"
          onSelect={(event) => {
            event.preventDefault();
            logout.mutate();
          }}
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function isActive(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === '/dashboard';
  return pathname === href || pathname.startsWith(`${href}/`);
}
