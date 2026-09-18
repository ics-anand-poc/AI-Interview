"use client";

import React, { createContext, useContext, useEffect, useState } from "react";

export type Theme = "light" | "dark" | "blue" | "purple" | "emerald" | "rose" | "sunset";

export const THEMES: Theme[] = ["light", "dark", "blue", "purple", "emerald", "rose", "sunset"];

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  // Kept for backward compatibility if needed, but it might cycle through themes or just toggle light/dark
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("dark");
  const [mounted, setMounted] = useState(false);

  const applyTheme = (newTheme: Theme) => {
    const root = document.documentElement;
    root.classList.remove("dark", "blue", "purple", "emerald", "rose", "sunset");
    if (newTheme !== "light") {
      root.classList.add(newTheme);
    }
  };

  useEffect(() => {
    const savedTheme = localStorage.getItem("theme") as Theme;
    const migrated = localStorage.getItem("theme-default-dark-v2") === "1";
    if (!migrated) {
      localStorage.setItem("theme-default-dark-v2", "1");
      if (!THEMES.includes(savedTheme) || savedTheme === "light") {
        setThemeState("dark");
        applyTheme("dark");
        localStorage.setItem("theme", "dark");
        setMounted(true);
        return;
      }
    }
    if (THEMES.includes(savedTheme)) {
      setThemeState(savedTheme);
      applyTheme(savedTheme);
    } else {
      setThemeState("dark");
      applyTheme("dark");
      localStorage.setItem("theme", "dark");
    }
    setMounted(true);
  }, []);

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
    localStorage.setItem("theme", newTheme);
    applyTheme(newTheme);
  };

  const toggleTheme = () => {
    setTheme(theme === "light" ? "dark" : "light");
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
