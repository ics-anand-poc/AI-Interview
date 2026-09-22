"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield,
  Loader2,
  AlertCircle,
  Mail,
  ArrowRight,
  Menu,
  X,
  Camera,
  Monitor,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import ThemeToggle from "@/components/ThemeToggle";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";

export default function HomePage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const handleAccessSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setError("Please enter a valid email address.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/interview/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });

      const body = await response.json();

      if (!response.ok || !body.success) {
        throw new Error(body?.message || "Verification failed");
      }

      router.push(`/interview/${body.resumeId}`);
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen app-canvas text-foreground font-sans transition-colors duration-300">
      <nav className="app-nav">
        <div className="mx-auto max-w-6xl px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="app-brand-mark">
              <Shield className="w-4 h-4" />
            </div>
            <div className="leading-tight">
              <p className="text-sm font-bold tracking-tight text-foreground">
                {APP_NAME}
              </p>
              <p className="text-[11px] text-muted-foreground font-medium">
                {APP_TAGLINE}
              </p>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-2">
            <Link href="/employee?org=BizX">
              <Button variant="outline" size="sm">
                Employee Portal
              </Button>
            </Link>
            <Link href="/admin">
              <Button variant="outline" size="sm">
                Admin
              </Button>
            </Link>
            <ThemeToggle />
          </div>

          <div className="flex md:hidden items-center gap-2">
            <ThemeToggle />
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="p-2 text-muted-foreground hover:text-foreground rounded-xl hover:bg-muted transition-colors"
              aria-label="Toggle navigation menu"
            >
              {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        <AnimatePresence>
          {isMobileMenuOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="md:hidden border-t border-border/70 bg-card/95 backdrop-blur-md px-6 py-4 flex flex-col gap-2.5 overflow-hidden"
            >
              <Link href="/employee?org=BizX" onClick={() => setIsMobileMenuOpen(false)}>
                <Button variant="outline" className="w-full justify-center">
                  Employee Portal
                </Button>
              </Link>
              <Link href="/admin" onClick={() => setIsMobileMenuOpen(false)}>
                <Button variant="outline" className="w-full justify-center">
                  Admin Portal
                </Button>
              </Link>
            </motion.div>
          )}
        </AnimatePresence>
      </nav>

      <section className="relative pt-10 md:pt-14 pb-12 px-6 max-w-6xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
          className="mb-8 max-w-2xl"
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary mb-3">
            Technical Assessment
          </p>
          <h1 className="app-section-title text-3xl md:text-4xl mb-3">
            Secure candidate interview
          </h1>
          <p className="app-section-sub text-base">
            Enter your registered email to open your invited session. Camera and
            browser integrity checks apply during the assessment.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.08 }}
          >
            <Card className="h-full p-6 md:p-7 space-y-5">
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-[0.12em]">
                Integrity policy
              </h3>
              <div className="space-y-4">
                {[
                  {
                    icon: Camera,
                    title: "Camera & audio monitoring",
                    body: "Webcam and microphone stay active. Only one person should be visible; background talk is flagged.",
                  },
                  {
                    icon: Monitor,
                    title: "Browser focus required",
                    body: "Leaving fullscreen, switching tabs, or opening other apps is not allowed during the session.",
                  },
                  {
                    icon: AlertTriangle,
                    title: "Three-strike limit",
                    body: "Each violation is recorded. After three warnings the assessment auto-submits.",
                  },
                ].map((item) => (
                  <div key={item.title} className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <item.icon className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-foreground">{item.title}</h4>
                      <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">
                        {item.body}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.14 }}
          >
            <Card className="h-full p-6 md:p-7 flex flex-col relative overflow-hidden shadow-card">
              <div className="absolute top-0 left-0 w-full h-1 bg-primary" />
              <div className="mb-5">
                <h2 className="text-lg font-bold text-foreground">Enter interview</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Use the email from your invitation.
                </p>
              </div>

              <form onSubmit={handleAccessSubmit} className="space-y-4 flex-1 flex flex-col">
                <div className="space-y-1.5">
                  <label
                    htmlFor="email"
                    className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider"
                  >
                    Registered email
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                      id="email"
                      type="email"
                      placeholder="candidate@company.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="app-input pl-10 rounded-xl"
                      required
                    />
                  </div>
                </div>

                <AnimatePresence>
                  {error && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="p-3 rounded-xl bg-destructive/8 border border-destructive/20 text-destructive flex items-start gap-2.5 text-xs font-medium leading-relaxed"
                    >
                      <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <span>{error}</span>
                    </motion.div>
                  )}
                </AnimatePresence>

                <Button type="submit" disabled={isSubmitting} className="w-full h-11 mt-auto">
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Verifying…
                    </>
                  ) : (
                    <>
                      Join assessment <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </Button>
              </form>

              <div className="pt-4 mt-4 border-t border-border/70 text-center">
                <Link
                  href="/employee?org=BizX"
                  className="text-xs text-primary font-semibold hover:underline inline-flex items-center gap-1"
                >
                  Employee? Open the learning portal <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
            </Card>
          </motion.div>
        </div>
      </section>
    </div>
  );
}
