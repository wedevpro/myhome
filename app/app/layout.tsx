import type { Metadata } from "next";
import ThemeProvider from "@/components/theme-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "MyHomeIA — Votre foyer, simplement",
  description: "Courses, tâches, notes et contacts partagés. Votre maison, en un coup d’œil.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "MyHomeIA", statusBarStyle: "default" },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/icon-192.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body className="antialiased"><ThemeProvider>{children}</ThemeProvider></body>
    </html>
  );
}
