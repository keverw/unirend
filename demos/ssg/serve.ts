/**
 * Static file server for SSG-generated sites
 * Uses unirend's StaticWebServer for framework-agnostic serving
 *
 * SECURITY NOTE: Includes directory traversal protection via the staticContent plugin
 * to prevent serving files outside the build directory.
 */

import { StaticWebServer } from '../../src/lib/internal/static-web-server';
import path from 'path';

const BUILD_DIR = path.resolve(__dirname, 'build/client');
const PORT = 3000;

async function main() {
  const server = new StaticWebServer({
    buildDir: BUILD_DIR,
    pageMapPath: 'page-map.json',
    notFoundPage: '404.html',
    singleAssets: {
      // Serve standalone files from Vite's public folder (copied to build root)
      '/robots.txt': 'robots.txt',
      '/favicon.ico': 'favicon.ico',
    },
    assetFolders: {
      '/assets': 'assets',
    },
    detectImmutableAssets: true,
  });

  await server.listen(PORT, '0.0.0.0');

  console.log(`🚀 Static server running at http://localhost:${PORT}`);
  console.log(`📁 Serving files from: ${BUILD_DIR}`);
  console.log(`\n📄 Available pages (clean router URLs):`);
  console.log(`   • http://localhost:${PORT}/ (SSG)`);
  console.log(`   • http://localhost:${PORT}/about (SSG)`);
  console.log(`   • http://localhost:${PORT}/contact (SSG)`);
  console.log(`   • http://localhost:${PORT}/404 (SSG - 404 page)`);
  console.log(`   • http://localhost:${PORT}/dashboard (SPA)`);
  console.log(`   • http://localhost:${PORT}/app (SPA)`);
  console.log(
    `   • http://localhost:${PORT}/nonexistent-page (Shows 404 page)`,
  );
  console.log(`\n🛑 Press Ctrl+C to stop the server`);
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
