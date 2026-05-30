import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Extrator de fotos de lotes",
  description: "Extração de fotos de lotes",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
