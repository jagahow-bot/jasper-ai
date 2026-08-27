import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { ClientPerformanceRefreshProvider } from "@/components/ClientPerformanceRefresh";
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
  title: "JASPER.AI · Portfolio Studio",
  description: "JASPER Portfolio Studio — AI portfolio customization for wealth managers",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const langInitScript = `(function(){try{var k=${JSON.stringify(LANG_STORAGE_KEY)};var v=localStorage.getItem(k);if(v==='en'||v==='zh'||v==='ko')document.documentElement.lang=v;}catch(e){}})();`;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: langInitScript }} />
      </head>
      <body
        className={`${inter.variable} ${jetbrains.variable} font-sans text-base antialiased`}
      >
        <I18nProvider>
          <ClientPerformanceRefreshProvider>{children}</ClientPerformanceRefreshProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
