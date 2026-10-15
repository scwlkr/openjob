import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F7F8FA" },
    { media: "(prefers-color-scheme: dark)", color: "#20242B" },
  ],
};

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "openjob.local";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  const baseUrl = new URL(`${protocol}://${host}`);
  const description =
    "Private Group task lists that keep small teams clear on who is doing what.";

  return {
    metadataBase: baseUrl,
    title: "OpenJob — Clear space. Focused work.",
    description,
    icons: {
      icon: [
        { url: "/favicon.svg", type: "image/svg+xml", sizes: "any" },
        { url: "/favicon.png", type: "image/png", sizes: "64x64" },
      ],
      shortcut: "/favicon.ico",
      apple: [
        {
          url: "/apple-touch-icon.png",
          type: "image/png",
          sizes: "180x180",
        },
      ],
    },
    manifest: "/site.webmanifest",
    openGraph: {
      title: "OpenJob",
      description,
      type: "website",
      images: [
        {
          url: new URL("/og.png", baseUrl),
          width: 1200,
          height: 630,
          alt: "OpenJob — Clear space. Focused work.",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "OpenJob",
      description,
      images: [new URL("/og.png", baseUrl)],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
