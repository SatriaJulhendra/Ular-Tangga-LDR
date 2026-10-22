import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Naik Jujur, Turun Berani — Ular Tangga",
  description:
    "Ular tangga online dengan kejutan Truth or Dare. Buat room, ajak teman, dan mulai cerita.",
};
export default function Layout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
