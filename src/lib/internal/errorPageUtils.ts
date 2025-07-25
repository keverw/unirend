import { FastifyRequest } from "fastify";

/**
 * Generates a default 500 error page.
 * @param request The Fastify request object
 * @param error The error that occurred
 * @param isDevelopment Whether running in development mode
 * @returns HTML string for the error page
 */
export function generateDefault500ErrorPage(
  request: FastifyRequest,
  error: Error,
  isDevelopment: boolean,
): string {
  // Panels for dev mode
  const devPanels = isDevelopment
    ? `<div class="ep-section">
      <div class="ep-label">Message:</div>
      <div class="ep-panel">${escapeHtml(error.message)}</div>
    </div>
    <div class="ep-section">
      <div class="ep-label">Stack Trace:</div>
      <div class="ep-panel ep-stack">${escapeHtml(error.stack || "No stack trace available")}</div>
    </div>
    <div class="ep-section">
      <div class="ep-label">Request Info:</div>
      <div class="ep-panel">
        URL: ${escapeHtml(request.url)}<br>
        Method: ${request.method}
      </div>
    </div>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>500 - Internal Server Error</title>
  <style>
    html, body { height: 100%; margin: 0; padding: 0; background: #fff; }
    body {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: system-ui, Arial, sans-serif;
      background: #f7f7f8;
    }
    .ep-card {
      background: #fff;
      border-radius: 14px;
      box-shadow: 0 2px 16px rgba(0,0,0,0.08);
      max-width: 440px;
      width: 100%;
      margin: 32px;
      padding: 32px 28px 24px 28px;
      text-align: center;
    }
    .ep-title {
      color: #e53935;
      font-size: 2rem;
      font-weight: 600;
      margin-bottom: 12px;
      letter-spacing: 0.01em;
    }
    .ep-sub {
      font-size: 1.1rem;
      font-weight: 500;
      margin-bottom: 24px;
      color: #222;
    }
    .ep-section {
      margin-bottom: 18px;
      text-align: left;
    }
    .ep-label {
      font-size: 1rem;
      font-weight: 600;
      color: #444;
      margin-bottom: 2px;
    }
    .ep-panel {
      background: #f1f1f3;
      border-radius: 6px;
      padding: 12px 14px;
      font-size: 0.98rem;
      color: #222;
      word-break: break-all;
      overflow-x: auto;
    }
    .ep-stack {
      font-size: 0.92rem;
      white-space: pre-wrap;
      font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace;
      max-height: 300px;
      overflow-y: auto;
    }
    .ep-note {
      margin-top: 30px;
      font-size: 0.97rem;
      color: #888;
    }
    .ep-btn {
      margin: 18px auto 0 auto;
      display: block;
      background: #2563eb;
      color: #fff;
      border: none;
      border-radius: 6px;
      padding: 10px 22px;
      font-size: 1rem;
      font-weight: 500;
      cursor: pointer;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      transition: background 0.15s;
    }
    .ep-btn:hover, .ep-btn:focus {
      background: #1d4ed8;
      outline: none;
    }
  </style>
</head>
<body>
  <main class="ep-card">
    <div class="ep-title">500 - Internal Server Error</div>
    <div class="ep-sub">
      ${isDevelopment ? "Error Details (Development Mode)" : "We're sorry, something went wrong."}
    </div>
    ${
      isDevelopment
        ? devPanels
        : '<div class="ep-panel">An unexpected error occurred. Please try again later.</div>'
    }
    <button class="ep-btn" onclick="window.location.reload()" type="button">Refresh Page</button>
    ${
      isDevelopment
        ? '<div class="ep-note"><b>Note:</b> Detailed error information is only shown in development mode.</div>'
        : ""
    }
  </main>
</body>
</html>`;
}

// Escape HTML for safe display in error panels
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
