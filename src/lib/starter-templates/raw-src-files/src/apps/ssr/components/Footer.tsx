import { Link } from 'react-router';
import { usePublicAppConfig } from 'unirend/client';

interface PublicAppConfig {
  site_info?: {
    current_year?: number;
  };
}

export function Footer() {
  const config = usePublicAppConfig() as PublicAppConfig | undefined;
  // current_year is set server-side at startup and updated at midnight via a timer.
  // The fallback should never trigger in practice, but if it did there would be a
  // risk of a server/client mismatch (e.g. the year rolling over between SSR and hydration).
  const currentYear =
    config?.site_info?.current_year ?? new Date().getFullYear();

  return (
    <footer className="rounded-lg border-4 border-dashed border-blue-500 p-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="rounded border-4 border-dashed border-teal-500 px-6 py-3">
          <span className="text-gray-700 dark:text-gray-300">
            &copy; {currentYear} SSR Starter Template
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
        </div>
      </div>
    </footer>
  );
}
