import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import AppShell from "@/components/AppShell";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ORION Agro",
  description: "Gestão pecuária multi-fazenda",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "ORION Agro",
  },
};

export const viewport: Viewport = {
  themeColor: "#0E2A2E",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
