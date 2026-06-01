import { NavLink } from 'react-router';
import { ThemeToggle } from './theme/ThemeToggle';

export function Header() {
  const navClass = ({ isActive }: { isActive: boolean }) =>
    `border-4 border-dashed border-yellow-500 px-6 py-3 rounded text-gray-700 dark:text-gray-300 font-medium${isActive ? ' bg-yellow-50 dark:bg-yellow-950' : ''}`;

  return (
    <header className="mb-8 rounded-lg border-4 border-dashed border-cyan-500 p-8">
      <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
        <div className="rounded border-4 border-dashed border-pink-500 px-6 py-3">
          <NavLink
            to="/"
            end
            className="text-2xl font-bold text-gray-800 dark:text-gray-100"
          >
            SSG Starter
          </NavLink>
        </div>
        <nav className="flex flex-wrap items-center justify-center gap-4">
          <NavLink to="/" end className={navClass}>
            Home
          </NavLink>
          <NavLink to="/about" className={navClass}>
            About
          </NavLink>
          <NavLink to="/dashboard" className={navClass}>
            Dashboard
          </NavLink>
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
