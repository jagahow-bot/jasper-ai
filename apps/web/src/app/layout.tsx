import type { Metadata } from "next";
import { JetBrains_Mono, Press_Start_2P, VT323 } from "next/font/google";
import "./globals.css";

const pressStart = Press_Start_2P({
  weight: "400",
  variable: "--font-pixel",
  subsets: ["latin"],
});

const vt323 = VT323({
  weight: "400",
  variable: "--font-terminal",
  subsets: ["latin"],
});

const jetbrains = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AI Quant Assistant",
  description: "Institutional quant backtest · Pro champion-challenger loop",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${pressStart.variable} ${vt323.variable} ${jetbrains.variable} font-terminal text-base antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
