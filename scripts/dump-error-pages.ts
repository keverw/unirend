import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { FastifyRequest } from 'fastify';
import {
  generateDefault500ErrorPage,
  generateDefault503ClosingPage,
} from '../src/lib/internal/error-page-utils';

const outDir = join(import.meta.dir, '..', 'tmp', 'error-pages');
mkdirSync(outDir, { recursive: true });

const mockRequest = {
  url: '/some/path?foo=bar',
  method: 'GET',
} as unknown as FastifyRequest;

const mockError = new Error('Something went unexpectedly wrong');
mockError.stack = `Error: Something went unexpectedly wrong
    at render (/app/src/lib/internal/ssr-server.ts:42:11)
    at async handleRequest (/app/src/lib/internal/ssr-server.ts:120:5)
    at async Server.<anonymous> (/app/src/lib/internal/base-server.ts:88:7)`;

const pages: Array<{ filename: string; html: string }> = [
  {
    filename: '500-dev.html',
    html: generateDefault500ErrorPage(mockRequest, mockError, true),
  },
  {
    filename: '500-prod.html',
    html: generateDefault500ErrorPage(mockRequest, mockError, false),
  },
  {
    filename: '503-closing.html',
    html: generateDefault503ClosingPage(),
  },
];

for (const { filename, html } of pages) {
  const filePath = join(outDir, filename);
  writeFileSync(filePath, html, 'utf-8');
  console.log(`✅ Wrote ${filePath}`);
}
