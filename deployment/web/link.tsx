import type { AnchorHTMLAttributes, ReactNode } from 'react';
export default function Link({ href, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { children?: ReactNode }) {
  return <a href={href === "/" ? "/account" : href} {...props}>{href === "/" ? "Account setup (Group administration unavailable)" : children}</a>;
}
