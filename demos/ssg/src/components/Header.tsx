import { useEffect } from "react";
import { Link, useLocation } from "react-router";
import { useTheme } from "../providers/ThemeProvider";

export function Header() {
  const { theme, toggleTheme, isHydrated } = useTheme();
  const location = useLocation();

  // Scroll to top when route changes
  useEffect(() => {
    // Regular pages scroll to top
    window.scrollTo({
      top: 0,
      behavior: "instant",
    });
  }, [location.pathname]);

  return (
    <header className="header">
      <div className="header-content">
        <Link to="/" className="logo">
          Unirend
        </Link>
        <nav>
          <ul className="nav">
            <li>
              <Link to="/">Home</Link>
            </li>
            <li>
              <Link to="/about">About</Link>
            </li>
            <li>
              <Link to="/contact">Contact</Link>
            </li>
          </ul>
        </nav>
        {isHydrated && (
          <button
            onClick={toggleTheme}
            style={{ fontSize: "1.2rem", marginLeft: "1rem" }}
          >
            {theme === "light" ? "🌙" : "☀️"} {theme}
          </button>
        )}
      </div>
    </header>
  );
}
