import type { ReactNode } from "react";

/** Plain Vite harness has no Next router; production resolves the real Link. */
export default function FixtureLink({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href}>{children}</a>;
}
