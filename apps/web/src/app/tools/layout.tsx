import Link from 'next/link';
import { Logo } from '@/components/brand';
import { ToolsNav } from '@/components/tools/tools-nav';

/**
 * Public shell for the free tools.
 *
 * Deliberately not the app shell: these pages are the top of the funnel and are
 * seen mostly by people with no account, arriving from a search result. They get
 * a plain header, the tool, and a route into the product — not a sidebar full of
 * navigation they cannot use.
 */
export default function ToolsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-4 px-4 sm:px-6">
          <Logo href="/tools" markClassName="h-7 w-7" />
          <ToolsNav />
          <div className="ml-auto flex items-center gap-2">
            <Link
              href="/login"
              className="hidden rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:inline-flex"
            >
              Sign in
            </Link>
            <Link
              href="/register"
              className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Create account
            </Link>
          </div>
        </div>
      </header>

      <main id="main-content" className="flex-1">
        {children}
      </main>

      <footer className="border-t">
        <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-sm">
              <Logo markClassName="h-7 w-7" />
              <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
                Free SEO tools, and a platform for submitting URLs in bulk and verifying whether
                they actually got indexed.
              </p>
            </div>
            <nav aria-label="Footer" className="text-sm">
              <p className="font-medium">Product</p>
              <ul className="mt-2 space-y-1.5 text-muted-foreground">
                <li>
                  <Link href="/tools" className="transition-colors hover:text-foreground">
                    All tools
                  </Link>
                </li>
                <li>
                  <Link href="/register" className="transition-colors hover:text-foreground">
                    Create an account
                  </Link>
                </li>
                <li>
                  <Link href="/login" className="transition-colors hover:text-foreground">
                    Sign in
                  </Link>
                </li>
              </ul>
            </nav>
          </div>
          <p className="mt-8 border-t pt-6 text-xs leading-relaxed text-muted-foreground">
            These tools fetch the URL you enter and report what they find. IndexPilot assists URL
            discovery and monitors index status — search engines make the final crawling and
            indexing decision, and we never claim otherwise.
          </p>
        </div>
      </footer>
    </div>
  );
}
