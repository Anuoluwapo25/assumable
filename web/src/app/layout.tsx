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
  title: "Assumable: buy and sell live MUSD loans on Mezo",
  description:
    "Sell your BTC-backed MUSD loan without repaying it. Buyers take over the BTC, the debt and its locked interest rate in one transaction.",
  openGraph: {
    title: "Assumable",
    description: "Assumable loans for Bitcoin, on Mezo.",
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
