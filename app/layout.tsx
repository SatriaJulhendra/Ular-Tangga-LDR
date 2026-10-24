import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Naik Jujur — Snakes & Ladders with Truth or Dare",
  description:
    "Online multiplayer snakes & ladders with Truth or Dare twists. Create a room, invite friends, and share stories.",
};
export default function Layout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
