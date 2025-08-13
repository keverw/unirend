import { useEffect } from "react";
import { NavLink, useLocation } from "react-router";
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
        <NavLink to="/" className="logo" end>
          Unirend
        </NavLink>
        <nav>
          <ul className="nav">
            <li>
              <NavLink
                to="/"
                end
                className={({ isActive }) => (isActive ? "active" : "")}
              >
                Home
              </NavLink>
            </li>
            <li>
              <NavLink
                to="/about"
                className={({ isActive }) => (isActive ? "active" : "")}
              >
                About
              </NavLink>
            </li>
            <li>
              <NavLink
                to="/contact"
                className={({ isActive }) => (isActive ? "active" : "")}
              >
                Contact
              </NavLink>
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
