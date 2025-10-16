/**
 * Simple static file server for testing the generated SSG build
 * Serves files from the build directory on localhost
 *
 * SECURITY NOTE: Includes directory traversal protection to prevent
 * serving files outside the build directory.
 */

import { serve } from "bun";
import { access } from "fs/promises";
import { join, extname, resolve } from "path";

const BUILD_DIR = "./build/client"; // Serve everything from client directory
const PORT = 3000;

// MIME types for common file extensions
const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".eot": "application/vnd.ms-fontobject",
};

function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || "application/octet-stream";
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function serveFile(filePath: string): Promise<Response> {
  try {
    const file = Bun.file(filePath);
    const exists = await file.exists();

    if (!exists) {
      return new Response("File not found", { status: 404 });
    }

    const mimeType = getMimeType(filePath);
    return new Response(file, {
      headers: {
        "Content-Type": mimeType,
        "Cache-Control": "public, max-age=3600", // 1 hour cache
      },
    });
  } catch (error) {
    console.error("Error serving file:", error);
    return new Response("Internal server error", { status: 500 });
  }
}

void serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const pathname = url.pathname;

    // Handle different types of requests
    let filePath: string;

    // First, try to match exact pages/routes
    const routeToFileMap: Record<string, string> = {
      "/": "index.html",
      "/about": "about.html",
      "/contact": "contact.html",
      "/context-demo": "context-demo.html",
      "/dashboard": "dashboard.html",
      "/app": "app.html",
      "/404": "404.html",
    };

    // Check if it's an exact page match first
    const htmlFile = routeToFileMap[pathname];
    if (htmlFile) {
      filePath = join(BUILD_DIR, htmlFile);
      if (await fileExists(filePath)) {
        return serveFile(filePath);
      }
    }

    // If no exact page match, check if it's an asset (has extension)
    if (extname(pathname)) {
      // Remove leading slash for file path
      const assetPath = pathname.startsWith("/") ? pathname.slice(1) : pathname;
      filePath = join(BUILD_DIR, assetPath);

      // Security check: Prevent directory traversal
      const resolvedPath = resolve(filePath);
      const resolvedBuildDir = resolve(BUILD_DIR);

      if (!resolvedPath.startsWith(resolvedBuildDir)) {
        return new Response("Access denied", { status: 403 });
      }

      if (await fileExists(filePath)) {
        return serveFile(filePath);
      }

      // Asset not found
      return new Response("Asset not found", { status: 404 });
    }

    // For unknown routes without extension, serve 404.html if it exists, otherwise index.html (SPA fallback)
    const notFoundPath = join(BUILD_DIR, "404.html");
    if (await fileExists(notFoundPath)) {
      // Serve the 404 page with proper status
      const file = Bun.file(notFoundPath);
      return new Response(file, {
        status: 404,
        headers: {
          "Content-Type": "text/html",
          "Cache-Control": "public, max-age=3600",
        },
      });
    }

    // Fallback to index.html for SPA behavior if no 404.html exists
    filePath = join(BUILD_DIR, "index.html");
    if (await fileExists(filePath)) {
      return serveFile(filePath);
    }

    return new Response("Page not found", { status: 404 });
  },
});

console.log(`🚀 Static server running at http://localhost:${PORT}`);
console.log(`📁 Serving files from: ${BUILD_DIR}`);
console.log(`\n📄 Available pages (clean router URLs):`);
console.log(`   • http://localhost:${PORT}/ (SSG)`);
console.log(`   • http://localhost:${PORT}/about (SSG)`);
console.log(`   • http://localhost:${PORT}/contact (SSG)`);
console.log(`   • http://localhost:${PORT}/404 (SSG - 404 page)`);
console.log(`   • http://localhost:${PORT}/dashboard (SPA)`);
console.log(`   • http://localhost:${PORT}/app (SPA)`);
console.log(`   • http://localhost:${PORT}/nonexistent-page (Shows 404 page)`);
console.log(`\n🛑 Press Ctrl+C to stop the server`);
