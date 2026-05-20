// Starts the SSR server in built mode — serves pre-built assets from build/.
// To use Vite HMR with source files instead, use serve-dev.ts.
import { startApp } from './server/start';

void startApp('built');
