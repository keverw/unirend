import { Link } from 'react-router';
import { UnirendHead, useIsDevelopment } from 'unirend/client';
import type { PageErrorResponse } from 'unirend/api-envelope';

interface GenericErrorProps {
  data: PageErrorResponse | null;
}

export function GenericError({ data }: GenericErrorProps) {
  const isDevelopment = useIsDevelopment();
  const title = data?.meta?.page?.title || 'Error';
  const description = data?.meta?.page?.description || 'An error occurred.';
  const message =
    data?.error?.message || 'Something went wrong. Please try again later.';
  const requestID = data?.request_id;
  const errorCode = data?.error?.code?.toUpperCase() || 'UNKNOWN';

  // Show stack trace only in development. Upstream data loaders typically gate
  // details on isDevelopment too, but we guard here as well in case a custom
  // loader, external API, or a remote server running in dev mode leaks details.
  const stackTrace =
    data?.error?.details &&
    typeof data.error.details === 'object' &&
    !Array.isArray(data.error.details) &&
    'stack' in data.error.details
      ? (data.error.details.stack as string)
      : null;

  return (
    <>
      <UnirendHead>
        <title>{title}</title>
        <meta name="description" content={description} />
      </UnirendHead>
      <div className="rounded-lg border-4 border-dashed border-orange-500 p-8">
        <h1 className="mb-4 text-4xl font-bold text-gray-800 dark:text-gray-100">
          Error: {errorCode}
        </h1>
        <p className="mb-2 text-gray-600 dark:text-gray-400">{message}</p>
        <p className="mb-6 text-gray-600 dark:text-gray-400">
          Please try again later or contact support if the problem persists.
        </p>

        {isDevelopment && stackTrace && (
          <details
            open
            className="mb-6 rounded-lg border-4 border-dashed border-red-400 p-4"
          >
            <summary className="mb-2 cursor-pointer font-semibold text-gray-800 dark:text-gray-100">
              Stack Trace
            </summary>
            <pre className="overflow-auto text-sm text-gray-600 dark:text-gray-400">
              {stackTrace}
            </pre>
          </details>
        )}

        {requestID && (
          <p className="mb-6 text-sm text-gray-600 dark:text-gray-400">
            Request ID: {requestID}
          </p>
        )}

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
