"use client";

import React, { useEffect, useState } from "react";
import { useTheme } from "@/components/ThemeProvider";
import { Sun, Moon } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Avoid hydration mismatch by waiting for mount
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="w-9 h-9 rounded-xl border border-indigo-150/40 bg-white/20 dark:bg-slate-900/20 backdrop-blur-md opacity-0" />
    );
  }

  const isDark = theme === "dark";

  return (
    <button
      onClick={toggleTheme}
      type="button"
      className="relative w-9 h-9 rounded-xl border border-indigo-150/40 dark:border-slate-800/40 bg-white/60 dark:bg-slate-900/60 backdrop-blur-md flex items-center justify-center text-indigo-600 dark:text-violet-400 hover:bg-indigo-50/60 dark:hover:bg-slate-800/60 shadow-sm hover:shadow transition-all duration-300 overflow-hidden outline-none select-none group"
      aria-label="Toggle light & dark theme"
    >
      <AnimatePresence mode="wait" initial={false}>
        {isDark ? (
          <motion.div
            key="moon"
            initial={{ y: 15, rotate: 45, opacity: 0 }}
            animate={{ y: 0, rotate: 0, opacity: 1 }}
            exit={{ y: -15, rotate: -45, opacity: 0 }}
            transition={{ type: "spring", stiffness: 200, damping: 15 }}
            className="flex items-center justify-center"
          >
            <Moon className="w-[18px] h-[18px] fill-violet-400/20 text-violet-400 group-hover:scale-110 group-hover:rotate-12 transition-transform duration-300" />
          </motion.div>
        ) : (
          <motion.div
            key="sun"
            initial={{ y: 15, rotate: -45, opacity: 0 }}
            animate={{ y: 0, rotate: 0, opacity: 1 }}
            exit={{ y: -15, rotate: 45, opacity: 0 }}
            transition={{ type: "spring", stiffness: 200, damping: 15 }}
            className="flex items-center justify-center"
          >
            <Sun className="w-[18px] h-[18px] fill-amber-500/10 text-amber-500 group-hover:scale-110 group-hover:rotate-45 transition-transform duration-300" />
          </motion.div>
        )}
      </AnimatePresence>
    </button>
  );
}
