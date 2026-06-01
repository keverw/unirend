import { Link } from 'react-router';
import { UnirendHead } from 'unirend/client';
import { ENABLE_TEST_ROUTES } from '../consts';

export function Home() {
  return (
    <>
      <UnirendHead>
        <title>Home - Unirend SSG Starter</title>
        <meta
          name="description"
          content="Welcome to the Unirend SSG starter homepage"
        />
      </UnirendHead>

      <div className="mb-6 rounded-lg border-4 border-dashed border-orange-500 p-8">
        <h1 className="mb-4 text-4xl font-bold text-gray-800 dark:text-gray-100">
          Unirend SSG Starter
        </h1>
        <p className="text-gray-600 dark:text-gray-400">
          A starter template powered by{' '}
          <a
            href="https://github.com/keverw/unirend"
            className="underline"
            target="_blank"
            rel="noreferrer"
          >
            Unirend
          </a>{' '}
          , a lightweight toolkit for unified SSG and SSR workflows, powered by
          Vite and React.
        </p>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-6 sm:grid-cols-3">
        <div className="rounded-lg border-4 border-dashed border-purple-500 p-6">
          <h3 className="mb-2 text-xl font-semibold text-gray-800 dark:text-gray-100">
            SSG Pages
          </h3>
          <p className="text-gray-600 dark:text-gray-400">
            Pages like this one are pre-rendered to HTML at build time and
            hydrated on the client for fast, SEO-friendly delivery.
          </p>
        </div>
        <div className="rounded-lg border-4 border-dashed border-purple-500 p-6">
          <h3 className="mb-2 text-xl font-semibold text-gray-800 dark:text-gray-100">
            SPA Pages
          </h3>
          <p className="text-gray-600 dark:text-gray-400">
            The{' '}
            <Link to="/dashboard" className="underline">
              Dashboard
            </Link>{' '}
            is a client-rendered SPA page, great for authenticated areas or
            personalized content that can't be pre-rendered.
          </p>
        </div>
        <div className="rounded-lg border-4 border-dashed border-purple-500 p-6">
          <h3 className="mb-2 text-xl font-semibold text-gray-800 dark:text-gray-100">
            Theme Support
          </h3>
          <p className="text-gray-600 dark:text-gray-400">
            Dark, light, and auto mode with cookie persistence and cross-tab
            sync. No flash on load.
          </p>
        </div>
      </div>

      {ENABLE_TEST_ROUTES && (
        <div className="rounded-lg border-4 border-dashed border-red-500 p-8">
          <h2 className="mb-4 text-2xl font-bold text-gray-800 dark:text-gray-100">
            Error Simulation Routes
          </h2>
          <p className="mb-4 text-gray-600 dark:text-gray-400">
            These routes are enabled because{' '}
            <code>ENABLE_TEST_ROUTES = true</code> in <code>consts.ts</code>.
          </p>
          <div className="flex flex-wrap gap-4">
            <Link
              to="/simulate-component-error"
              className="rounded border-4 border-dashed border-red-400 px-4 py-2 text-gray-700 dark:text-gray-300"
            >
              Throw from Component{' '}
              <span className="text-xs opacity-60">(browser only)</span>
            </Link>
            {/*
              /404 works via client-side routing (React Router has a defined route for it).
              In production with StaticWebServer or php-static-server, direct hard navigation
              to /404 will itself 404 — those servers keep error pages for internal use only,
              never exposed as URL routes, and only served when an actual error occurs with
              the correct status code.

              That's fine since the client router renders the same NotFound component anyway.
              /500 has no client route — it's a self-contained html page with inlined styles
              (no React bundle) so it survives real server failures where assets may not load.
            */}
            <Link
              to="/404"
              className="rounded border-4 border-dashed border-red-400 px-4 py-2 text-gray-700 dark:text-gray-300"
            >
              404 Page
            </Link>
            <Link
              to="/simulate-dataloader-500-error"
              className="rounded border-4 border-dashed border-red-400 px-4 py-2 text-gray-700 dark:text-gray-300"
            >
              Throw Error in Loader
            </Link>
            <Link
              to="/simulate-dataloader-500-status"
              className="rounded border-4 border-dashed border-red-400 px-4 py-2 text-gray-700 dark:text-gray-300"
            >
              500 Status Envelope
            </Link>
            <Link
              to="/simulate-dataloader-503-status"
              className="rounded border-4 border-dashed border-red-400 px-4 py-2 text-gray-700 dark:text-gray-300"
            >
              503 Status Envelope
            </Link>
          </div>
          <p className="mt-4 text-sm text-gray-600 dark:text-gray-400">
            <strong>Throw from Component</strong> only triggers in the browser.
            The component skips throwing during pre-render so the SSG build
            succeeds, then throws on hydration to demonstrate the{' '}
            <code>ApplicationError</code> boundary.
          </p>
        </div>
      )}
    </>
  );
}
