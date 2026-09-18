"use client";

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";

const EffectivenessConsole = dynamic(
  () => import("./EffectivenessConsole").then((m) => m.EffectivenessConsole),
  {
    ssr: false,
    loading: () => (
      <div className="min-h-screen bg-[#f0f4ff] dark:bg-slate-950 flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="w-12 h-12 text-indigo-600 animate-spin mx-auto" />
          <p className="text-slate-500 font-medium animate-pulse">Loading post-training analytics…</p>
        </div>
      </div>
    ),
  }
);

export default function EmployeeEffectivenessPage() {
  return <EffectivenessConsole />;
}
