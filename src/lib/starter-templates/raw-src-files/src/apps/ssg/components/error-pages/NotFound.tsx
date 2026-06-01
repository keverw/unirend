import { Link } from 'react-router';
import { UnirendHead } from 'unirend/client';
import type { PageErrorResponse } from 'unirend/api-envelope';

interface NotFoundProps {
  error?: unknown;
  data?: PageErrorResponse | null;
}

export function NotFound({ data }: NotFoundProps) {
  // Use envelope data if available, otherwise use defaults
  const title = data?.meta?.page?.title || '404 - Page Not Found';
  const description =
    data?.meta?.page?.description ||
    'The page you are looking for does not exist.';

  return (
    <>
      <UnirendHead>
        <title>{title}</title>
        <meta name="description" content={description} />
      </UnirendHead>
      <div className="rounded-lg border-4 border-dashed border-orange-500 p-8">
        <h1 className="mb-2 text-4xl font-bold text-gray-800 dark:text-gray-100">
          404
        </h1>
        <h2 className="mb-4 text-2xl font-bold text-gray-800 dark:text-gray-100">
          Page Not Found
        </h2>
        <p className="mb-6 text-gray-600 dark:text-gray-400">
          The page you are looking for does not exist or has been moved.
        </p>
        <Link
          to="/"
          className="rounded border-4 border-dashed border-teal-500 px-4 py-2 text-gray-700 dark:text-gray-300"
        >
          Go Home
        </Link>
      </div>
    </>
  );
}
