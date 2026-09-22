import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import "plyr/dist/plyr.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import Script from "next/script";
import { APP_DESCRIPTION, APP_KEYWORDS, APP_NAME } from "@/lib/brand";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  display: "swap",
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: APP_NAME,
  description: APP_DESCRIPTION,
  applicationName: APP_NAME,
  keywords: [...APP_KEYWORDS],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head />
      <body
        className={`${jakarta.variable} ${jakarta.className} bg-background text-foreground antialiased transition-colors duration-300 min-h-screen`}
      >
        <Script id="theme-script" strategy="beforeInteractive">
          {`
           (function() {
             try {
               var saved = localStorage.getItem('theme');
               var themes = ["light", "dark", "blue", "purple", "emerald", "rose", "sunset"];
               if (localStorage.getItem('theme-default-dark-v2') !== '1') {
                 localStorage.setItem('theme-default-dark-v2', '1');
                 if (!saved || saved === 'light' || themes.indexOf(saved) === -1) {
                   saved = 'dark';
                   localStorage.setItem('theme', 'dark');
                 }
               }
               var theme = saved && themes.indexOf(saved) !== -1 ? saved : "dark";
               document.documentElement.classList.remove("dark", "blue", "purple", "emerald", "rose", "sunset");
               if (theme !== "light") {
                 document.documentElement.classList.add(theme);
               }
             } catch (e) {
               document.documentElement.classList.add("dark");
             }
           })();
         `}
        </Script>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
