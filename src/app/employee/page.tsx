"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Home, Key, ShieldCheck, ArrowLeft, Sparkles, Briefcase } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import ThemeToggle from "@/components/ThemeToggle";


const initialState = {
  employeeId: "",
  password: "",
  loading: false,
  error: "",
  info: "",
};

export default function EmployeeLoginPage() {
  const router = useRouter();
  const [employeeId, setEmployeeId] = useState(initialState.employeeId);
  const [password, setPassword] = useState(initialState.password);
  const [loading, setLoading] = useState(initialState.loading);
  const [error, setError] = useState(initialState.error);
  const [info, setInfo] = useState(initialState.info);
  const [isResetPassword, setIsResetPassword] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetNewPassword, setResetNewPassword] = useState("");
  const [resetConfirmPassword, setResetConfirmPassword] = useState("");
  const [org, setOrg] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const searchParams = new URLSearchParams(window.location.search);
      const reason = searchParams.get("reason");
      if (reason === "inactivity") {
        setError("You have been logged out due to inactivity.");
      }
      const ssoError = searchParams.get("sso_error");
      if (ssoError) {
        setError(ssoError);
      }
      const organization = searchParams.get("org");
      if (organization) {
        setOrg(organization);
      }
    }
  }, []);

  const handleMicrosoftSSO = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setError("");
    setInfo("Redirecting to Microsoft…");
    // Real Entra ID (Azure AD) SAML 2.0 SSO — the server sends an SP-initiated
    // AuthnRequest to Microsoft's SAML endpoint, then Microsoft POSTs the
    // signed assertion back to our ACS route, which verifies it against the
    // Employee Portal roster before ever issuing a session token.
    window.location.assign("/api/employee/auth/saml");
  };

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setInfo("");

    const trimmedId = employeeId.trim();
    if (!trimmedId) {
      setError("Please enter your Employee ID.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/employee/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employee_id: trimmedId, password }),
      });

      let result: any = null;
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        result = await response.json();
      }

      if (!response.ok) {
        setError(result?.error || `Login failed (Server returned status ${response.status}).`);
        setLoading(false);
        return;
      }

      if (result && result.status === "first_time") {
        const orgParam = org ? `&org=${encodeURIComponent(org)}` : "";
        router.push(`/employee/set-password?employee_id=${encodeURIComponent(trimmedId)}${orgParam}`);
        return;
      }

      if (result && result.status === "ok" && result.token) {
        window.localStorage.setItem("employee_token", result.token);
        router.push("/employee/dashboard");
        return;
      }

      setError("Unable to authenticate. Please try again.");
    } catch (err: any) {
      setError(err?.message || "Unexpected error during login.");
    } finally {
      setLoading(false);
    }
  }

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setInfo("");

    const trimmedId = employeeId.trim();
    if (!trimmedId) {
      setError("Please enter your Employee ID.");
      return;
    }
    if (resetNewPassword !== resetConfirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    
    setLoading(true);
    try {
      const response = await fetch("/api/employee/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: trimmedId,
          email: resetEmail,
          password: resetNewPassword
        }),
      });

      let result: any = null;
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        result = await response.json();
      }

      if (!response.ok) {
        setError(result?.error || "Failed to reset password.");
        return;
      }

      setInfo("Password reset successfully. You can now sign in.");
      setIsResetPassword(false);
      setPassword("");
      setResetEmail("");
      setResetNewPassword("");
      setResetConfirmPassword("");
    } catch (err: any) {
      setError(err?.message || "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#f8fafc] via-[#f0f4ff] to-[#e0e7ff] dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 flex items-center justify-center px-4 py-6 relative overflow-hidden transition-colors duration-300">
      {/* Background decorative elements */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-10 left-10 w-72 h-72 bg-indigo-600/10 rounded-full blur-3xl" />
        <div className="absolute bottom-10 right-10 w-96 h-96 bg-violet-600/10 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-indigo-700/5 rounded-full blur-[120px]" />
      </div>

      {/* Theme Toggler */}
      <div className="absolute top-4 right-4 z-20">
        <ThemeToggle />
      </div>

      {/* ── Go Home link ────────────────────────────────────────────── */}
      <div className="absolute top-4 left-4 z-20">
        <Link href="/">
          <Button
            variant="ghost"
            size="sm"
            className="group flex items-center gap-2 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-indigo-50/50 dark:hover:bg-white/10 rounded-xl px-3.5 py-2 transition-all duration-200"
          >
            <ArrowLeft className="w-3.5 h-3.5 transition-transform group-hover:-translate-x-1" />
            <span className="font-semibold text-xs">Go to Candidate Portal</span>
          </Button>
        </Link>
      </div>

      <Card className="w-full max-w-md p-6 bg-white/80 dark:bg-slate-800/80 backdrop-blur-xl border border-indigo-50 dark:border-slate-700/50 shadow-2xl shadow-indigo-500/5 dark:shadow-black/35 relative overflow-hidden transition-colors duration-300">
        {/* Top accent bar */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 via-violet-500 to-indigo-500" />

        {/* Side accent glow */}
        <div className="absolute -top-20 -right-20 w-48 h-48 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-16 -left-16 w-40 h-40 bg-violet-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="mb-4 text-center relative z-10">
          {/* Logo mark */}
          <div className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-500/40 ring-2 ring-white/[0.08]">
            <ShieldCheck className="h-6 w-6 text-white" />
          </div>

          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white leading-tight">
            {isResetPassword ? "Reset Portal Password" : (org ? `${org} Portal Login` : "Employee Portal Login")}
          </h1>
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 leading-relaxed max-w-sm mx-auto">
            {isResetPassword 
              ? "Verify your Employee ID and Email to set a new password." 
              : `Access your learning assessments, performance analytics, and personalized growth path.`}
          </p>
        </div>

        {/* Badge */}
        <div className="flex justify-center mb-4 relative z-10">
          <Badge className="bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 font-semibold text-[10px] uppercase tracking-widest px-2.5 py-0.5">
            {org ? `${org.toUpperCase()} - SECURE ACCESS` : "Secure Access Only"}
          </Badge>
        </div>

        {error ? (
          <div className="rounded-xl bg-red-500/10 border border-red-500/25 px-4 py-2.5 text-xs text-red-400 mb-4 flex items-center gap-2 relative z-10">
            <span className="text-sm leading-none">⚠</span>
            <span className="font-medium">{error}</span>
          </div>
        ) : null}

        {info ? (
          <div className="rounded-xl bg-indigo-500/10 border border-indigo-500/25 px-4 py-2.5 text-xs text-indigo-300 mb-4 flex items-center gap-2 relative z-10">
            <Sparkles className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="font-medium">{info}</span>
          </div>
        ) : null}

        {!isResetPassword ? (
          <>
            <form className="space-y-4 relative z-10" onSubmit={handleSubmit}>
              {/* Employee ID */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1.5">
                  Employee ID
                </label>
                <div className="relative">
                  <input
                    className="w-full text-sm rounded-xl border-2 border-slate-200 dark:border-slate-600/80 bg-slate-50/50 dark:bg-slate-900/60 px-4 py-2.5 text-slate-900 dark:text-white font-medium placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 focus:bg-white dark:focus:bg-slate-900/80 transition-all"
                    value={employeeId}
                    onChange={(event) => setEmployeeId(event.target.value)}
                    placeholder="e.g. E1234"
                    autoComplete="username"
                  />
                </div>
              </div>

              {/* Password */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <input
                    type="password"
                    className="w-full text-sm rounded-xl border-2 border-slate-200 dark:border-slate-600/80 bg-slate-50/50 dark:bg-slate-900/60 px-4 py-2.5 text-slate-900 dark:text-white font-medium placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 focus:bg-white dark:focus:bg-slate-900/80 transition-all"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Enter your password"
                    autoComplete="current-password"
                  />
                  <Key className="pointer-events-none absolute right-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
                </div>
                <div className="flex justify-end mt-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setError("");
                      setInfo("");
                      setIsResetPassword(true);
                    }}
                    className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-300 transition-colors"
                  >
                    Forgot Password?
                  </button>
                </div>
              </div>

              {/* Submit */}
              <Button
                className="w-full px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-bold shadow-lg shadow-indigo-500/30 hover:shadow-xl hover:shadow-indigo-500/40 transition-all duration-200"
                type="submit"
                disabled={loading}
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Signing in…
                  </span>
                ) : (
                  "Sign In"
                )}
              </Button>
            </form>

            {/* Divider */}
            <div className="relative my-4 z-10 flex items-center justify-center">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-700/40"></div>
              </div>
              <span className="relative px-3 text-[9px] font-black text-slate-500 bg-slate-800 dark:bg-slate-850 uppercase tracking-widest">
                Or continue with
              </span>
            </div>

            {/* Microsoft SSO Button */}
            <Button
              type="button"
              onClick={handleMicrosoftSSO}
              disabled={loading}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-700/80 hover:border-slate-500 bg-slate-900/40 hover:bg-slate-900 text-white font-bold transition-all duration-200 flex items-center justify-center gap-2.5 relative z-10 shadow-sm"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 23 23" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M0 0H11V11H0V0Z" fill="#F25022"/>
                <path d="M12 0H23V11H12V0Z" fill="#7FBA00"/>
                <path d="M0 12H11V23H0V12Z" fill="#00A4EF"/>
                <path d="M12 12H23V23H12V12Z" fill="#FFB900"/>
              </svg>
              <span className="text-xs">Sign in with Microsoft</span>
            </Button>

            {/* First-time hint */}
            <div className="mt-4 rounded-xl border border-indigo-100 dark:border-indigo-900/30 bg-indigo-50/50 dark:bg-indigo-950/20 p-3.5 relative z-10">
              <div className="flex items-start gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-indigo-500/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Sparkles className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                </div>
                <div>
                  <p className="text-[10px] font-bold text-indigo-700 dark:text-indigo-300 uppercase tracking-wider mb-0.5">First time logging in?</p>
                  <p className="text-xs text-slate-700 dark:text-slate-350 leading-relaxed">
                    Use your <span className="text-slate-900 dark:text-slate-100 font-semibold">Employee ID</span> with a <span className="text-slate-900 dark:text-slate-100 font-semibold">blank password</span>.
                  </p>
                </div>
              </div>
            </div>
          </>
        ) : (
          <form className="space-y-4 relative z-10" onSubmit={handleResetPassword}>
            {/* Employee ID */}
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1.5">
                Employee ID
              </label>
              <input
                className="w-full text-sm rounded-xl border-2 border-slate-200 dark:border-slate-600/80 bg-slate-50/50 dark:bg-slate-900/60 px-4 py-2.5 text-slate-900 dark:text-white font-medium placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 focus:bg-white dark:focus:bg-slate-900/80 transition-all"
                value={employeeId}
                onChange={(event) => setEmployeeId(event.target.value)}
                placeholder="e.g. EMP001"
                required
              />
            </div>

            {/* Registered Email */}
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1.5">
                Registered Email
              </label>
              <input
                type="email"
                className="w-full text-sm rounded-xl border-2 border-slate-200 dark:border-slate-600/80 bg-slate-50/50 dark:bg-slate-900/60 px-4 py-2.5 text-slate-900 dark:text-white font-medium placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 focus:bg-white dark:focus:bg-slate-900/80 transition-all"
                value={resetEmail}
                onChange={(event) => setResetEmail(event.target.value)}
                placeholder="e.g. sofia@example.com (Leave blank if none)"
              />
            </div>

            {/* New Password */}
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1.5">
                New Password
              </label>
              <input
                type="password"
                className="w-full text-sm rounded-xl border-2 border-slate-200 dark:border-slate-600/80 bg-slate-50/50 dark:bg-slate-900/60 px-4 py-2.5 text-slate-900 dark:text-white font-medium placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 focus:bg-white dark:focus:bg-slate-900/80 transition-all"
                value={resetNewPassword}
                onChange={(event) => setResetNewPassword(event.target.value)}
                placeholder="Min 8 chars, uppercase, digit, special"
                required
              />
            </div>

            {/* Confirm New Password */}
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1.5">
                Confirm New Password
              </label>
              <input
                type="password"
                className="w-full text-sm rounded-xl border-2 border-slate-200 dark:border-slate-600/80 bg-slate-50/50 dark:bg-slate-900/60 px-4 py-2.5 text-slate-900 dark:text-white font-medium placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 focus:bg-white dark:focus:bg-slate-900/80 transition-all"
                value={resetConfirmPassword}
                onChange={(event) => setResetConfirmPassword(event.target.value)}
                placeholder="Repeat password"
                required
              />
            </div>

            {/* Reset Submit */}
            <Button
              className="w-full px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-bold shadow-lg shadow-indigo-500/30 hover:shadow-xl hover:shadow-indigo-500/40 transition-all duration-200"
              type="submit"
              disabled={loading}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Resetting password…
                </span>
              ) : (
                "Reset Password"
              )}
            </Button>

            {/* Back to Login link */}
            <div className="text-center mt-3">
              <button
                type="button"
                onClick={() => {
                  setError("");
                  setInfo("");
                  setIsResetPassword(false);
                }}
                className="text-xs font-semibold text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
              >
                ← Back to Sign In
              </button>
            </div>
          </form>
        )}
      </Card>

    </div>
  );
}
