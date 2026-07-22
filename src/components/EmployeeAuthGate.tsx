"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { Loader2, LogOut, LayoutDashboard, BookOpen, Sparkles, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function EmployeeAuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState({
    showEffectivenessTab: true,
    showManagerConsoleTab: true,
    portalFeaturesEnabled: true
  });

  const [isIdle, setIsIdle] = useState(false);
  const [countdown, setCountdown] = useState(30);

  const isIdleRef = useRef(false);
  const resetTimerRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    isIdleRef.current = isIdle;
  }, [isIdle]);

  useEffect(() => {
    fetch("/api/portal_settings")
      .then(res => res.json())
      .then(data => {
        if (data && typeof data === "object") {
          setSettings({
            showEffectivenessTab: data.showEffectivenessTab !== false,
            showManagerConsoleTab: data.showManagerConsoleTab !== false,
            portalFeaturesEnabled: data.portalFeaturesEnabled !== false
          });
        }
      })
      .catch(err => console.error("Failed to load portal settings:", err));
  }, []);

  useEffect(() => {
    if (loading) return;
    const isEffectiveness = pathname === "/employee/effectiveness";
    const isManager = pathname === "/employee/manager";
    const featuresDisabled = !settings.portalFeaturesEnabled;
    const effDisabled = !settings.showEffectivenessTab;
    const mgrDisabled = !settings.showManagerConsoleTab;

    if (isEffectiveness && (featuresDisabled || effDisabled)) {
      router.replace("/employee/dashboard");
    } else if (isManager && (featuresDisabled || mgrDisabled)) {
      router.replace("/employee/dashboard");
    }
  }, [pathname, settings, loading, router]);

  useEffect(() => {
    const token = window.localStorage.getItem("employee_token");
    if (!token) {
      router.replace("/employee");
      return;
    }

    fetch("/api/employee/auth/validate", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    })
      .then(async (res) => {
        if (!res.ok) {
          window.localStorage.removeItem("employee_token");
          router.replace("/employee");
          return;
        }
        setLoading(false);
      })
      .catch(() => {
        window.localStorage.removeItem("employee_token");
        router.replace("/employee");
      });
  }, [router]);

  function handleLogout(reason?: string) {
    window.localStorage.removeItem("employee_token");
    if (reason && typeof reason === "string") {
      router.push(`/employee?reason=${encodeURIComponent(reason)}`);
    } else {
      router.push("/employee");
    }
  }

  useEffect(() => {
    if (loading) return;

    let idleTimer: any;

    const resetTimer = () => {
      if (isIdleRef.current) return;

      setIsIdle(false);
      setCountdown(30);
      clearTimeout(idleTimer);
      
      // Start 3 minute idle timeout (180,000 ms)
      idleTimer = setTimeout(() => {
        setIsIdle(true);
      }, 180000);
    };

    resetTimerRef.current = resetTimer;

    const events = ["mousemove", "keydown", "click", "scroll"];
    events.forEach(event => {
      window.addEventListener(event, resetTimer);
    });

    resetTimer();

    return () => {
      clearTimeout(idleTimer);
      events.forEach(event => {
        window.removeEventListener(event, resetTimer);
      });
    };
  }, [loading]);

  useEffect(() => {
    let countdownTimer: any;
    if (isIdle) {
      countdownTimer = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) {
            clearInterval(countdownTimer);
            handleLogout("inactivity");
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(countdownTimer);
  }, [isIdle]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-100 via-white to-violet-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 flex items-center justify-center px-4 py-12">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="rounded-3xl border border-border bg-white/90 dark:bg-slate-900/90 backdrop-blur-md px-8 py-10 text-center shadow-card"
        >
          <div className="w-12 h-12 rounded-2xl bg-primary flex items-center justify-center mx-auto mb-4 shadow-lg shadow-indigo-500/30">
            <Loader2 className="h-6 w-6 animate-spin text-white" />
          </div>
          <p className="text-primary font-semibold">Verifying your portal access…</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f0f4ff] dark:bg-slate-950 text-foreground transition-colors duration-300">
      <header className="sticky top-0 z-50 border-b border-border bg-white/90 dark:bg-slate-900/90 backdrop-blur-lg shadow-nav transition-colors duration-300">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-primary shadow-md shadow-indigo-500/25">
              <LayoutDashboard className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-sm font-bold text-foreground">Employee Learning Portal</p>
              <p className="text-xs text-muted-foreground">Secure access for assessments, analytics, and growth.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/employee/learn" className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold text-primary shadow-soft transition hover:bg-secondary">
              <BookOpen className="h-4 w-4" /> Learning Topics
            </Link>
            <Link href="/employee/dashboard" className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold text-primary shadow-soft transition hover:bg-secondary">
              Analytics
            </Link>
            {settings.portalFeaturesEnabled && settings.showEffectivenessTab && (
              <Link href="/employee/effectiveness" className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold text-primary shadow-soft transition hover:bg-secondary">
                Effectiveness
              </Link>
            )}
            {settings.portalFeaturesEnabled && settings.showManagerConsoleTab && (
              <Link href="/employee/manager" className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold text-primary shadow-soft transition hover:bg-secondary">
                Manager Console
              </Link>
            )}
            <Button variant="outline" size="sm" className="gap-2 rounded-xl border-border text-primary hover:bg-secondary" onClick={() => handleLogout()}>
              <LogOut className="h-4 w-4" /> Logout
            </Button>
          </div>
        </div>
      </header>
      <main>{children}</main>

      {isIdle && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/65 backdrop-blur-sm animate-fade-in">
          <Card className="w-full max-w-sm p-6 bg-card border border-amber-250 dark:border-amber-900/50 shadow-2xl rounded-3xl text-center transform scale-100 transition-all duration-300">
            <div className="flex flex-col items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/20">
                <ShieldAlert className="w-6 h-6 text-white animate-bounce" />
              </div>
              <h2 className="text-xl font-black text-foreground">Inactivity Warning</h2>
              <p className="text-xs text-muted-foreground leading-relaxed">
                You have been inactive for a while. For security, you will be logged out in:
              </p>
              <span className="text-4xl font-extrabold text-amber-500 dark:text-amber-400 my-2 block">
                {countdown}s
              </span>
              <Button
                onClick={() => {
                  setIsIdle(false);
                  setCountdown(30);
                  if (resetTimerRef.current) {
                    resetTimerRef.current();
                  }
                }}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-md shadow-indigo-500/25 transition duration-200 font-bold text-xs py-2.5"
              >
                Stay Connected
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
