import { UnirendHead } from 'unirend/client';

export function About() {
  return (
    <>
      <UnirendHead>
        <title>About - Unirend SSG Starter</title>
        <meta name="description" content="About the Unirend SSG starter" />
      </UnirendHead>

      <div className="rounded-lg border-4 border-dashed border-orange-500 p-8">
        <h1 className="mb-4 text-4xl font-bold text-gray-800 dark:text-gray-100">
          About
        </h1>
        <p className="text-gray-600 dark:text-gray-400">
          This is a standard SSG page, pre-rendered to HTML at build time and
          hydrated on the client.
        </p>
      </div>
    </>
  );
}
