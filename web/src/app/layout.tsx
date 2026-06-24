import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "QA Dashboard",
  description: "Enterprise QA automation platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} antialiased`}>
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