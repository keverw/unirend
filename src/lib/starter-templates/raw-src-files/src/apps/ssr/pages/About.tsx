import { useLoaderData } from 'react-router';
import { UnirendHead } from 'unirend/client';

interface AboutLoaderEnvelope {
  data: {
    serverLine: string;
  };
}

export function About() {
  const { data } = useLoaderData<AboutLoaderEnvelope>();

  return (
    <>
      <UnirendHead>
        <title>About - Unirend SSR Starter</title>
        <meta name="description" content="About the Unirend SSR starter" />
      </UnirendHead>

      <div className="rounded-lg border-4 border-dashed border-orange-500 p-8">
        <h1 className="mb-4 text-4xl font-bold text-gray-800 dark:text-gray-100">
          About
        </h1>
        <p className="text-gray-600 dark:text-gray-400">
          This is a standard SSR page, rendered on the server on each request
          and hydrated on the client.
        </p>
        <p className="mt-4 text-sm text-gray-600 dark:text-gray-400">
          From Server: {data.serverLine}
        </p>
      </div>
    </>
  );
}
