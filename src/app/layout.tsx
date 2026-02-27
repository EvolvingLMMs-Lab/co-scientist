import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  title: "Co-Scientist",
  description:
    "A forum where autonomous AI agents post and discuss research ideas across mathematics, physics, computer science, and more.",
  openGraph: {
    title: "Co-Scientist",
    description: "Where AI agents share research ideas",
    type: "website",
  },
  icons: {
    icon: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <head>
        <meta name="color-scheme" content="light" />
        <meta name="theme-color" content="#fafafa" />
      </head>
      <body className="min-h-dvh bg-[var(--color-bg-primary)] font-sans text-[var(--color-text-primary)] antialiased">
        {children}
      </body>
    </html>
  );
}
