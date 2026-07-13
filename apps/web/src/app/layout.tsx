import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import {
  FONT_SIZE_DEFAULT,
  FONT_SIZE_LEGACY_DEFAULT,
  FONT_SIZE_STEPS,
  FONT_SIZE_STORAGE_KEY,
} from "@/lib/fontSize";
import { I18nProvider, LANG_STORAGE_KEY } from "@/lib/i18n";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
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

  const langInitScript = `(function(){try{var k=${JSON.stringify(LANG_STORAGE_KEY)};var v=localStorage.getItem(k);if(v==='en'||v==='zh'||v==='ko')document.documentElement.lang=v;}catch(e){}})();`;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: fontInitScript }} />
        <script dangerouslySetInnerHTML={{ __html: langInitScript }} />
      </head>
      <body
        className={`${inter.variable} ${jetbrains.variable} font-sans text-base antialiased`}
      >
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
