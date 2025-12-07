/**
 * Demo of the staticContent plugin with APIServer
 *
 * This demonstrates how to serve static files from an API-only server
 * using the staticContent plugin from unirend/plugins.
 *
 * Also demonstrates the split error/notFound handlers options for mixed HTML/JSON servers that allow
 * returning HTML for web requests and JSON for API requests.
 *
 * This is useful when you are using the API server as a standalone web server that serves both HTML pages and JSON APIs
 * without using the built-in React compatible SSR server.
 *
 * Run with: bun run demos/api-static-content-demo.ts
 */

import path from 'path';
import { serveAPI, type APIServerOptions } from '../src/server';
import { staticContent } from '../src/plugins';
import { APIResponseHelpers } from '../src/api-envelope';

// Resolve the demo files directory relative to this file
const staticFilesDir = path.join(import.meta.dirname, 'static-demo-files');

/**
 * Generate an HTML error page with consistent styling
 */
function generateErrorHtml(
  statusCode: number,
  title: string,
  message: string,
  url: string,
): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${statusCode} - ${title}</title>
  <link rel="stylesheet" href="/static/styles.css" />
</head>
<body>
  <div class="container">
    <header>
      <a href="/static/index.html">
        <img src="/static/logo.svg" alt="Unirend Logo" class="logo" />
      </a>
      <h1>${statusCode} - ${title}</h1>
    </header>
    <main>
      <section class="card">
        <h2>💥 Error</h2>
        <p>${message}</p>
        <p>Path: <code>${url}</code></p>
      </section>
      <section class="card">
        <h2>🔗 Try these instead</h2>
        <ul>
          <li><a href="/static/index.html">Home Page</a></li>
          <li><a href="/api/health">API Health Check</a></li>
        </ul>
      </section>
    </main>
    <footer>
      <p>Powered by <strong>Unirend</strong> staticContent plugin</p>
    </footer>
  </div>
</body>
</html>`;
}

/**
 * Generate an HTML 404 page with consistent styling
 */
function generate404Html(url: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>404 - Page Not Found</title>
  <link rel="stylesheet" href="/static/styles.css" />
</head>
<body>
  <div class="container">
    <header>
      <a href="/static/index.html">
        <img src="/static/logo.svg" alt="Unirend Logo" class="logo" />
      </a>
      <h1>404 - Page Not Found</h1>
    </header>
    <main>
      <section class="card">
        <h2>🔍 Oops!</h2>
        <p>The page <code>${url}</code> could not be found.</p>
      </section>
      <section class="card">
        <h2>💡 What happened?</h2>
        <ul>
          <li>The static file doesn't exist in the <code>/static</code> folder</li>
          <li>The staticContent plugin returned (file not found)</li>
          <li>The notFoundHandler.web served this HTML 404 page</li>
        </ul>
      </section>
      <section class="card">
        <h2>🔗 Try these instead</h2>
        <ul>
          <li><a href="/static/index.html">Home Page</a></li>
          <li><a href="/api/health">API Health Check</a></li>
        </ul>
      </section>
    </main>
    <footer>
      <p>Powered by <strong>Unirend</strong> staticContent plugin</p>
    </footer>
  </div>
</body>
</html>`;
}

async function runStaticContentDemo() {
  console.log('🚀 Starting API Server with Static Content Demo...\n');
  console.log(`📁 Serving static files from: ${staticFilesDir}\n`);

  const options: APIServerOptions = {
    isDevelopment: true,
    // apiEndpoints.apiEndpointPrefix defaults to '/api'
    // Split handlers use this to detect API vs web requests
    plugins: [
      // Static content plugin - serves files from /static/*
      staticContent({
        folderMap: {
          '/static': {
            path: staticFilesDir,
            detectImmutableAssets: false, // Demo files aren't fingerprinted
          },
        },
        // Custom cache settings for demo
        cacheControl: 'public, max-age=60', // 1 minute for demo
        positiveCacheTtl: 10 * 1000, // 10 second internal cache for demo
      }),

      // API routes plugin
      async (fastify, pluginOptions) => {
        console.log('📦 Registering API routes with options:', pluginOptions);

        // Health check
        fastify.get('/api/health', async (_request, _reply) => {
          return {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            server: 'unirend-api-with-static',
          };
        });

        // Server info endpoint
        fastify.get('/api/info', async (_request, _reply) => {
          return {
            name: 'Static Content Demo Server',
            version: '1.0.0',
            staticDir: staticFilesDir,
            features: [
              'Static file serving via staticContent plugin',
              'ETag caching for efficient conditional requests',
              'Content-based hashing for small files',
              'Multiple plugin instances supported',
              'Split 404 handling (HTML for web, JSON for API)',
            ],
            endpoints: {
              api: ['/api/health', '/api/info'],
              static: [
                '/static/index.html',
                '/static/styles.css',
                '/static/logo.svg',
              ],
            },
          };
        });

        // Redirect root to static index
        fastify.get('/', async (_request, reply) => {
          return reply.redirect('/static/index.html');
        });

        // Test routes that throw errors (for testing errorHandler)
        fastify.get('/api/throw', async () => {
          throw new Error('Intentional API error for testing');
        });

        fastify.get('/throw', async () => {
          throw new Error('Intentional web error for testing');
        });
      },
    ],

    // Split handlers - the clean way to handle mixed HTML/JSON servers
    // No catch-all route needed! Uses apiEndpointPrefix to detect API vs web

    // Split error handler for 500 errors
    errorHandler: {
      // API errors get JSON envelope
      api: (request, error, isDevelopment) => {
        return APIResponseHelpers.createAPIErrorResponse({
          request,
          statusCode: 500,
          errorCode: 'internal_error',
          errorMessage: isDevelopment
            ? error.message
            : 'An internal error occurred',
          errorDetails: isDevelopment ? { stack: error.stack } : undefined,
        });
      },
      // Web errors get HTML page
      web: (request, error, isDevelopment) => {
        return {
          contentType: 'html',
          content: generateErrorHtml(
            500,
            'Server Error',
            isDevelopment ? error.message : 'An internal error occurred',
            request.url,
          ),
          statusCode: 500,
        };
      },
    },

    // Split 404 handler
    notFoundHandler: {
      // API requests get JSON envelope
      api: (request, isPageData) => {
        return APIResponseHelpers.createAPIErrorResponse({
          request,
          statusCode: 404,
          errorCode: 'not_found',
          errorMessage: `API endpoint not found: ${request.url}`,
          errorDetails: {
            path: request.url,
            method: request.method,
            isPageData,
            hint: 'Check the endpoint URL and HTTP method',
          },
        });
      },
      // Web requests get HTML page
      web: (request) => {
        return {
          contentType: 'html',
          content: generate404Html(request.url),
          statusCode: 404,
        };
      },
    },

    fastifyOptions: {
      logger: {
        level: 'info',
      },
    },
  };

  try {
    const server = serveAPI(options);
    await server.listen(3002, 'localhost');

    console.log('✅ API Server with Static Content started successfully!\n');
    console.log('🌐 Open in browser: http://localhost:3002\n');
    console.log('⌨️  Press Ctrl+C to stop the server');
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Run the demo
runStaticContentDemo().catch(console.error);
