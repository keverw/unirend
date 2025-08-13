import React from "react";
import { NavLink } from "react-router";

const Header: React.FC = () => {
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
      </div>
    </header>
  );
};

export default Header;
