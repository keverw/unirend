// Starts the multi-app SSR server in built mode — serves pre-built assets from
// build/ (App A) and build-app-b/ (App B). To use Vite HMR instead, use serve-dev.ts.
import { startApp } from './server/start';

void startApp('built');
