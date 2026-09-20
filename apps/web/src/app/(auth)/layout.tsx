import { CheckCircle2, Gauge, ShieldCheck } from 'lucide-react';
import { Logo } from '@/components/brand';

const VALUE_PROPS = [
  {
    icon: Gauge,
    title: 'Bulk submission that scales',
    body: 'Paste or upload tens of thousands of URLs. Validation, discovery and verification run in the background.',
  },
  {
    icon: ShieldCheck,
    title: 'Third-party URLs welcome',
    body: 'Backlinks, guest posts and directories — no need to own or verify the domain first.',
  },
  {
    icon: CheckCircle2,
    title: 'Honest reporting',
    body: 'Crawl signals and index checks are reported separately, with the confidence behind every verdict.',
  },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel — desktop only; phones get the form immediately. */}
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-foreground p-10 text-background lg:flex xl:p-14">
        <div className="absolute inset-0 opacity-[0.06]" aria-hidden>
          <div
            className="h-full w-full"
            style={{
              backgroundImage:
                'radial-gradient(currentColor 1px, transparent 1px)',
              backgroundSize: '24px 24px',
            }}
          />
        </div>

        <div className="relative">
          <Logo href="/login" tone="inverted" id="auth" />
        </div>

        <div className="relative max-w-lg">
          <h1 className="text-3xl font-semibold leading-tight tracking-tight xl:text-4xl">
            Get your URLs discovered, and know where they actually stand.
          </h1>
          <p className="mt-4 text-base leading-relaxed text-background/75">
            One place to submit URLs in bulk, watch them move through validation and discovery, and
            verify index status over time.
          </p>

          <ul className="mt-10 space-y-6">
            {VALUE_PROPS.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.title} className="flex gap-4">
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-background/10 ring-1 ring-inset ring-background/20">
                    <Icon className="h-4.5 w-4.5" aria-hidden />
                  </span>
                  <div>
                    <p className="font-medium">{item.title}</p>
                    <p className="mt-1 text-sm leading-relaxed text-background/65">{item.body}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <p className="relative max-w-md text-xs leading-relaxed text-background/55">
          IndexPilot assists URL discovery and monitors index status. Search engines make the final
          crawling and indexing decision — we never claim otherwise.
        </p>
      </aside>

      {/* Form column */}
      <main
        id="main-content"
        className="flex flex-col items-center justify-center px-4 py-10 sm:px-8"
      >
        <div className="w-full max-w-[26rem]">
          <div className="mb-8 flex justify-center lg:hidden">
            <Logo href="/login" id="auth-mobile" />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
