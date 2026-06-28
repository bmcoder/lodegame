import type { Metadata } from "next";
import { SiteHeader } from "@/app/components/SiteHeader";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lodegame",
  description: "A Next.js and Phaser platform puzzle game with character customization.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full pt-14">
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
