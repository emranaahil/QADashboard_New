import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { AppToaster } from "@/components/providers/app-toaster";
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
 * SEO / Geo / OG metadata is server-only (document head).
 * Body uses a plain client Toaster — no next/dynamic in this server layout
 * (dynamic+ssr:false here previously broke webpack module factories).
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
    canonical: SITE_URL,
  },
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
  themeColor: "#0b1220",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className={`${inter.variable} antialiased`} suppressHydrationWarning>
        {children}
        <AppToaster />
      </body>
    </html>
  );
}
