import type { Metadata, Viewport } from "next";
import { Barlow, Barlow_Condensed } from "next/font/google";
import { ServiceWorker } from "@/components/service-worker";
import "./globals.css";

const barlow = Barlow({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-barlow",
  display: "swap",
});

const barlowCondensed = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-barlow-condensed",
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
  themeColor: "#0f0e0c",
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
    // The font variables go on `<html>`, not `<body>`: the theme's `--font-sans`
    // and `--font-display` are declared on `:root` and resolve there, so a
    // variable set any lower is undefined where they read it and every screen
    // silently falls back to the system face.
    <html lang="en" className={`${barlow.variable} ${barlowCondensed.variable}`}>
      <body className="antialiased">
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
