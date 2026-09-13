import type { Metadata, Viewport } from "next";
import { Inter, Inter_Tight } from "next/font/google";
import { ServiceWorker } from "@/components/service-worker";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const interTight = Inter_Tight({
  subsets: ["latin"],
  variable: "--font-inter-tight",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Training", template: "%s · Training" },
  description: "Vertical jump and athleticism training.",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Training" },
  // Served from `public/icons/` rather than through the `app/icon.*` file
  // convention, because the proxy's matcher excludes that directory outright and
  // an icon behind the passcode gate is an icon the OS cannot fetch.
  icons: {
    icon: [
      { url: "/icons/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: { url: "/icons/apple-touch-icon.png", sizes: "180x180" },
  },
};

export const viewport: Viewport = {
  themeColor: "#161a1c",
  width: "device-width",
  initialScale: 1,
  // Gym use: the layout is already mobile-first, and pinch-zoom on a sweaty
  // screen mid-set only ever gets in the way. Text still scales with the OS.
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${interTight.variable} antialiased`}>
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
