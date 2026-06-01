// Starts the SSR server in HMR mode — Vite serves source files directly with hot module replacement.
// To serve pre-built assets instead, use serve-built.ts.
import { startApp } from './server/start';

void startApp('hmr');
