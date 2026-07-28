import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { VizoraProvider } from "./providers/VizoraProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const description = "Kelola arus kas, invoice, dan piutang bisnis bersama asisten keuangan AI.";

  return {
    metadataBase: new URL(origin),
    title: "Vizora — Asisten Keuangan Bisnis",
    description,
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: {
      title: "Vizora — Keuangan bisnis, lebih jernih.",
      description,
      locale: "id_ID",
      type: "website",
      images: [{ url: `${origin}/og.png`, width: 1662, height: 946, alt: "Vizora, asisten keuangan AI untuk bisnis" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Vizora — Keuangan bisnis, lebih jernih.",
      description,
      images: [`${origin}/og.png`],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <VizoraProvider>{children}</VizoraProvider>
      </body>
    </html>
  );
}
