// Starts the multi-app SSR server in built mode — serves pre-built assets from
// build/ (App A) and build-app-b/ (App B). To use Vite HMR instead, use serve-hmr.ts.
import { startApp } from './server/start';

void startApp('built');
