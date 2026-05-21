import { createContext, useContext } from 'react';

export type ThemePreference = 'auto' | 'dark' | 'light';
export type ResolvedTheme = 'dark' | 'light';

export interface ThemeContextValue {
  preference: ThemePreference;
  systemTheme: ResolvedTheme;
  resolvedTheme: ResolvedTheme;
  cycleTheme: () => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme() {
  const ctx = useContext(ThemeContext);

  if (!ctx) {
    throw new Error('useTheme must be used within ThemeProvider');
  }

  return ctx;
}
