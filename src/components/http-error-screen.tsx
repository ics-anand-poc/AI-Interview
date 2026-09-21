"use client";

import Link from "next/link";
import { ClipboardList, Home, RotateCcw, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getHttpError, parseHttpErrorCode } from "@/lib/http-error-catalog";

type HttpErrorScreenProps = {
  code: number | string;
  title?: string;
  description?: string;
  onRetry?: () => void;
};

export default function HttpErrorScreen({
  code,
  title,
  description,
  onRetry,
}: HttpErrorScreenProps) {
  const info = getHttpError(parseHttpErrorCode(code));
  const heading = title || info.title;
  const body = description || info.description;
  const showSignIn = info.code === 401 || info.code === 403;

  return (
    <div className="relative min-h-screen overflow-hidden bg-[rgb(8,11,22)] text-slate-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(99,102,241,0.18),_transparent_42%),radial-gradient(circle_at_80%_20%,_rgba(168,85,247,0.12),_transparent_36%)]" />
      <div className="relative mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center px-6 py-16">
        <div className="mb-8 flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 shadow-md shadow-indigo-500/30">
            <ClipboardList className="h-4 w-4 text-white" />
          </div>
          <span className="text-sm font-black tracking-tight text-slate-100">Interviewscore</span>
        </div>

        <div className="rounded-3xl border border-white/10 bg-[#0c1020]/90 p-8 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur">
          <p className="text-[11px] font-black uppercase tracking-[0.22em] text-violet-300/80">
            Error {info.code}
          </p>
          <p className="mt-3 bg-gradient-to-r from-indigo-300 via-violet-200 to-fuchsia-300 bg-clip-text text-7xl font-black leading-none tracking-tight text-transparent">
            {info.code}
          </p>
          <h1 className="mt-5 text-2xl font-black tracking-tight text-white">{heading}</h1>
          <p className="mt-3 text-sm font-medium leading-relaxed text-slate-400">{body}</p>

          <div className="mt-8 flex flex-col gap-2.5 sm:flex-row">
            {onRetry ? (
              <Button
                type="button"
                onClick={onRetry}
                className="h-11 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 font-bold text-white hover:from-indigo-400 hover:to-violet-400"
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                Try again
              </Button>
            ) : null}
            <Button
              asChild
              className={`h-11 rounded-xl font-bold ${
                onRetry
                  ? "border border-white/10 bg-white/5 text-slate-100 hover:bg-white/10"
                  : "bg-gradient-to-r from-indigo-500 to-violet-500 text-white hover:from-indigo-400 hover:to-violet-400"
              }`}
              variant={onRetry ? "secondary" : "default"}
            >
              <Link href="/">
                <Home className="mr-2 h-4 w-4" />
                Home
              </Link>
            </Button>
            {showSignIn ? (
              <Button
                asChild
                variant="secondary"
                className="h-11 rounded-xl border border-white/10 bg-white/5 font-bold text-slate-100 hover:bg-white/10"
              >
                <Link href="/admin">
                  <Shield className="mr-2 h-4 w-4" />
                  Screening Console
                </Link>
              </Button>
            ) : (
              <Button
                asChild
                variant="secondary"
                className="h-11 rounded-xl border border-white/10 bg-white/5 font-bold text-slate-100 hover:bg-white/10"
              >
                <Link href="/employee">Employee Portal</Link>
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
