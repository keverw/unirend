import {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from "react";

type Theme = "light" | "dark";

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function useTheme() {
  const context = useContext(ThemeContext);
  
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  
  return context;
}

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>("light");
  const [isHydrated, setIsHydrated] = useState(false);

  // Initialize theme from localStorage after hydration to avoid conflicts
  useEffect(() => {
    const savedTheme = localStorage.getItem("theme") as Theme;

    if (savedTheme && (savedTheme === "light" || savedTheme === "dark")) {
      setTheme(savedTheme);
    }

    setIsHydrated(true);
  }, []);

  // Save theme to localStorage whenever it changes
  useEffect(() => {
    if (isHydrated) {
      localStorage.setItem("theme", theme);
    }
  }, [theme, isHydrated]);

  const toggleTheme = () => {
    setTheme((prevTheme) => (prevTheme === "light" ? "dark" : "light"));
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      <div
        className={`theme-${theme}`}
        style={{
          minHeight: "100vh",
          // Prevent flash of wrong theme during hydration
          opacity: isHydrated ? 1 : 0,
          transition: isHydrated ? "opacity 0.1s ease-in-out" : "none",
        }}
      >
        {children}
      </div>
    </ThemeContext.Provider>
  );
}
