import { describe, it, expect } from 'bun:test';
import { spawnSync } from 'child_process';

describe('WebSocket Integration Test', () => {
  it('should compile and pass all WebSocket integration scenarios', () => {
    // Run the WebSocket test script in quiet/non-verbose mode.
    // We pass QUIET: '1' in the environment to suppress verbose logs.
    const result = spawnSync('bun', ['run', 'scripts/test-ws-build.ts'], {
      env: { ...process.env, QUIET: '1' },
      encoding: 'utf8',
      cwd: process.cwd(),
    });

    if (result.status !== 0) {
      // On failure, print both streams: the quiet script may put summaries on
      // stdout and build/server diagnostics on stderr.
      if (result.stdout) {
        console.error(result.stdout);
      }

      if (result.stderr) {
        console.error(result.stderr);
      }
    }

    expect(result.status).toBe(0);
  }, 30000); // 30-second timeout for build and test run
});
