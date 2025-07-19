import { createContext, useContext, useState, useEffect } from "react";

type Theme = "light" | "dark";

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  isHydrated: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function useTheme() {
  const context = useContext(ThemeContext);

  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }

  return context;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Start with light as default, but will be synced from html class immediately
  const [theme, setTheme] = useState<Theme>("light");
  const [isHydrated, setIsHydrated] = useState(false);

  // Read initial theme from html class (set by inline script) instead of localStorage
  useEffect(() => {
    const htmlClass = document.documentElement.className;
    if (htmlClass.includes("theme-dark")) {
      setTheme("dark");
    } else {
      setTheme("light");
    }

    // Mark as hydrated after theme is synced
    setIsHydrated(true);
  }, []);

  // Save theme to localStorage and update html class when theme changes
  useEffect(() => {
    localStorage.setItem("theme", theme);
    document.documentElement.className = `theme-${theme}`;
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prevTheme) => (prevTheme === "light" ? "dark" : "light"));
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, isHydrated }}>
      {children}
    </ThemeContext.Provider>
  );
}
