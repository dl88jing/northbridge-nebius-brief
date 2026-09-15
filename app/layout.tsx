import type { Metadata } from "next";
import { Fraunces, Source_Sans_3 } from "next/font/google";
import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
});

const source = Source_Sans_3({
  subsets: ["latin"],
  variable: "--font-source",
});

export const metadata: Metadata = {
  title: "Northbridge Brief — Nebius × NVIDIA",
  description:
    "Agentic household research/ops assistant powered by NVIDIA Nemotron on Nebius Token Factory.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${fraunces.variable} ${source.variable} antialiased`}>
        <div className="relative z-10">{children}</div>
      </body>
    </html>
  );
}
