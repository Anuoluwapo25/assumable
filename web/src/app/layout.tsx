import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

// One family, used across its width axis: expanded for headlines and big
// numbers, normal for reading, condensed for dense tables.
const archivo = Archivo({
  subsets: ["latin"],
  variable: "--font-archivo",
  axes: ["wdth"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Backstop — Earn from every liquidation on Mezo",
  description:
    "An auto-compounding vault over MUSD's Stability Pool. Deposit MUSD, earn liquidated BTC at a discount, and never hold BTC or press a harvest button.",
  openGraph: {
    title: "Backstop",
    description: "Earn from every liquidation on Mezo, compounded back into MUSD.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#f6f6f2",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={archivo.variable}>
      <body className="min-h-dvh">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
