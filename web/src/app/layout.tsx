import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Toaster } from "sonner";
import {
  ALTERNATE_SITE_URL,
  BRAND_NAME,
  GEO_ICBM,
  GEO_PLACENAME,
  GEO_POSITION,
  GEO_REGION,
  SITE_DESCRIPTION,
  SITE_KEYWORDS,
  SITE_TITLE,
  SITE_URL,
} from "@/lib/site-seo";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

/**
 * SEO, Geo-SEO, Open Graph, and Twitter metadata for the public app shell.
 * Placeholders live in `web/src/lib/site-seo.ts` (or env NEXT_PUBLIC_*).
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_TITLE,
    template: `%s | QA Dashboard | ${BRAND_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: "QA Dashboard",
  authors: [{ name: BRAND_NAME }],
  creator: BRAND_NAME,
  publisher: BRAND_NAME,
  keywords: SITE_KEYWORDS,
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  alternates: {
    // Canonical = primary production host (avoids duplicate ranking of two Render URLs)
    canonical: SITE_URL,
    languages: {
      "en": SITE_URL,
      "x-default": SITE_URL,
    },
  },
  // Geographic targeting + secondary production host (documentation meta)
  other: {
    "geo.region": GEO_REGION,
    "geo.placename": GEO_PLACENAME,
    "geo.position": GEO_POSITION,
    ICBM: GEO_ICBM,
    "qa:alternate-host": ALTERNATE_SITE_URL,
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: SITE_URL,
    siteName: "QA Dashboard",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [
      {
        // Prefer a 1200×630 PNG at /og-image.png for best LinkedIn/X support;
        // SVG placeholder ships until you add a branded PNG.
        url: "/og-image.svg",
        width: 1200,
        height: 630,
        alt: `QA Dashboard — Software Quality Assurance by ${BRAND_NAME}`,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: ["/og-image.svg"],
  },
  category: "technology",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0b1220" },
    { media: "(prefers-color-scheme: light)", color: "#f8fafc" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} antialiased`} suppressHydrationWarning>
        {children}
        <Toaster
          position="top-right"
          closeButton
          toastOptions={{
            duration: 4000,
            classNames: {
              toast: "glass-panel border-border text-foreground",
              success: "border-[rgba(34,197,94,0.4)] bg-[rgba(34,197,94,0.14)] text-[#86efac]",
              error: "border-[rgba(239,68,68,0.4)] bg-[rgba(239,68,68,0.14)] text-[#fca5a5]",
              warning: "border-[rgba(245,158,11,0.4)] bg-[rgba(245,158,11,0.14)] text-[#fcd34d]",
              info: "border-[rgba(59,130,246,0.4)] bg-[rgba(59,130,246,0.14)] text-[#93c5fd]",
            },
          }}
        />
      </body>
    </html>
  );
}
