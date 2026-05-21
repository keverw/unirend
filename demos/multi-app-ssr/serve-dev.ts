// Starts the multi-app SSR server in HMR mode — Vite serves both apps
// directly with hot module replacement. To serve pre-built assets, use serve-built.ts.
import { startApp } from './server/start';

void startApp('hmr');
