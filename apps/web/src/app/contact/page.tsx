import type { Metadata } from 'next';
import { Mail, MessageSquare, Send } from 'lucide-react';
import { PublicShell } from '@/components/layout/public-shell';

export const metadata: Metadata = {
  title: 'Contact Us — SEO Micro-Tools Support & Feedback',
  description:
    'Get in touch with the SEO Micro-Tools team for questions, suggestions, bug reports, or partnership opportunities.',
  robots: { index: true, follow: true },
};

export default function ContactPage() {
  return (
    <PublicShell>
      <div className="mx-auto w-full max-w-4xl px-4 py-12 sm:px-6 sm:py-16">
        <header className="max-w-2xl">
          <span className="text-xs font-semibold uppercase tracking-wider text-primary">
            Get In Touch
          </span>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Contact &amp; Support</h1>
          <p className="mt-4 text-base leading-relaxed text-muted-foreground">
            Have questions about an unexpected robots.txt finding? Found an edge-case in sitemap
            parsing? We welcome feedback, bug reports, and suggestions from fellow SEO
            practitioners.
          </p>
        </header>

        <div className="mt-12 grid gap-8 md:grid-cols-2">
          <div className="space-y-6">
            <div className="rounded-lg border bg-card p-6">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg border bg-muted">
                  <Mail className="h-5 w-5 text-primary" />
                </span>
                <div>
                  <h2 className="text-base font-semibold">Direct Email</h2>
                  <p className="text-xs text-muted-foreground">For general inquiries and support</p>
                </div>
              </div>
              <p className="mt-4 text-sm font-mono text-foreground">
                support@seomicrotools.local
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                We typically respond within 1–2 business days.
              </p>
            </div>

            <div className="rounded-lg border bg-card p-6">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg border bg-muted">
                  <MessageSquare className="h-5 w-5 text-emerald-500" />
                </span>
                <div>
                  <h2 className="text-base font-semibold">Bug Reports &amp; Standards</h2>
                  <p className="text-xs text-muted-foreground">Technical feedback</p>
                </div>
              </div>
              <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
                If you encounter a sitemap structure or robots.txt directive that our parser reports
                inconsistently, please include the target URL or snippet for our engineering team to
                reproduce.
              </p>
            </div>
          </div>

          <div className="rounded-lg border bg-card p-6 sm:p-8">
            <h2 className="text-lg font-semibold">Send a Message</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Fill out this form and our team will get back to you shortly.
            </p>

            <form
              className="mt-6 space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                alert('Thank you! Your message has been received.');
              }}
            >
              <div>
                <label htmlFor="contact-name" className="block text-xs font-medium text-foreground">
                  Your Name
                </label>
                <input
                  id="contact-name"
                  type="text"
                  required
                  placeholder="Jane Doe"
                  className="mt-1.5 w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div>
                <label htmlFor="contact-email" className="block text-xs font-medium text-foreground">
                  Email Address
                </label>
                <input
                  id="contact-email"
                  type="email"
                  required
                  placeholder="jane@example.com"
                  className="mt-1.5 w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div>
                <label htmlFor="contact-subject" className="block text-xs font-medium text-foreground">
                  Subject
                </label>
                <input
                  id="contact-subject"
                  type="text"
                  required
                  placeholder="Feedback on Robots.txt Tester"
                  className="mt-1.5 w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div>
                <label htmlFor="contact-message" className="block text-xs font-medium text-foreground">
                  Message
                </label>
                <textarea
                  id="contact-message"
                  required
                  rows={4}
                  placeholder="Tell us what's on your mind..."
                  className="mt-1.5 w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <button
                type="submit"
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
              >
                <Send className="h-4 w-4" />
                Send Message
              </button>
            </form>
          </div>
        </div>
      </div>
    </PublicShell>
  );
}
