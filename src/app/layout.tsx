import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import "plyr/dist/plyr.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import Script from "next/script";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Interviewscore",
  description: "HR screening console — requirements, Corp Pool matching, and employee assessments.",
  applicationName: "Interviewscore",
  keywords: ["interviewscore", "HR screening", "corp pool", "job description", "assessment"],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
 return (
   <html lang="en" className="dark" suppressHydrationWarning>
     <head />
     <body className={`${inter.className} bg-background text-foreground transition-colors duration-300 min-h-screen`}>
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
       <ThemeProvider>
         {children}
       </ThemeProvider>
     </body>
   </html>
 );
}
