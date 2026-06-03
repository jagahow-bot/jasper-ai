import type { Metadata } from "next";
import { JetBrains_Mono, Press_Start_2P, VT323 } from "next/font/google";
import {
  FONT_SIZE_DEFAULT,
  FONT_SIZE_LEGACY_DEFAULT,
  FONT_SIZE_STEPS,
  FONT_SIZE_STORAGE_KEY,
} from "@/lib/fontSize";
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
  title: "JASPER.AI",
  description: "Institutional quant backtest · Pro champion-challenger loop",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const fontInitScript = `(function(){try{var k=${JSON.stringify(FONT_SIZE_STORAGE_KEY)};var d=${FONT_SIZE_DEFAULT};var leg=${FONT_SIZE_LEGACY_DEFAULT};var v=localStorage.getItem(k);var n=v?parseInt(v,10):d;var s=${JSON.stringify([...FONT_SIZE_STEPS])};if(s.indexOf(n)<0)n=d;if(v&&n===leg)n=d;var r=document.documentElement;r.style.setProperty('--font-size-root',n+'px');if(n>=18)r.setAttribute('data-font-lg','true');}catch(e){}})();`;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: fontInitScript }} />
      </head>
      <body
        className={`${pressStart.variable} ${vt323.variable} ${jetbrains.variable} font-terminal text-base antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
