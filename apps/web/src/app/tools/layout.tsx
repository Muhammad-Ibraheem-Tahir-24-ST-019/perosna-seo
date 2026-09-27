import { PublicShell } from '@/components/layout/public-shell';

/**
 * Public shell for the free tools.
 *
 * Provides the clean, responsive top navigation and footer with no login required.
 */
export default function ToolsLayout({ children }: { children: React.ReactNode }) {
  return <PublicShell>{children}</PublicShell>;
}
