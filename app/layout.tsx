import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Racketeers Badminton Tournament Tracker",
  description: "Live badminton tournament scoring, scheduling, brackets, and standings.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
