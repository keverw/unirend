import { Link } from 'react-router';

export function Footer() {
  return (
    <footer className="rounded-lg border-4 border-dashed border-blue-500 p-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="rounded border-4 border-dashed border-teal-500 px-6 py-3">
          <span className="text-gray-700 dark:text-gray-300">
            SSG Starter Template
          </span>
        </div>
        <div className="flex flex-wrap gap-4">
          <Link
            to="/"
            className="rounded border-4 border-dashed border-teal-500 px-4 py-2 text-gray-700 dark:text-gray-300"
          >
            Home
          </Link>
          <Link
            to="/about"
            className="rounded border-4 border-dashed border-teal-500 px-4 py-2 text-gray-700 dark:text-gray-300"
          >
            About
          </Link>
          <Link
            to="/dashboard"
            className="rounded border-4 border-dashed border-teal-500 px-4 py-2 text-gray-700 dark:text-gray-300"
          >
            Dashboard
          </Link>
        </div>
      </div>
    </footer>
  );
}
