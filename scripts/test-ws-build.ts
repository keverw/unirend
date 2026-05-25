/**
 * WebSocket Build Test Script
 *
 * This script tests the WebSocket demo by:
 * 1. Building it with bun build for Node.js target
 * 2. Running the built version
 * 3. Testing all WebSocket endpoints on both servers
 * 4. Verifying proper responses and error handling
 */

import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import { mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { WebSocket } from 'ws';

const TMP_DIR = './tmp/unirend-ws-test';
const BUILD_OUTPUT = join(TMP_DIR, 'ws-server-demo.cjs');
const SOURCE_FILE = './demos/ws-server-demo.ts';

// Determine if we should print detailed output during execution.
//
// This script supports two modes of execution:
// 1. Verbose Mode: When run directly (e.g., `bun run ws-test`), the script prints verbose connection,
//    server, and message logs for interactive debugging and tracking.
// 2. Quiet Mode: When run as part of the normal test runner via web-socket-integration.test.ts (which
//    passes QUIET) or if explicitly requested via QUIET/SILENT env variables or --quiet/--silent CLI flags.
//    In this mode, verbose logs are suppressed and only a success message is shown unless a failure occurs.
const isVerbose =
  !process.env.QUIET &&
  !process.env.SILENT &&
  !process.env.BUN_TEST &&
  !process.argv.includes('--quiet') &&
  !process.argv.includes('--silent');

// Buffer to store stdout and stderr from the spawned server process.
// If the integration test fails when running in silent mode, this buffer is dumped
// to the console to help with debugging the failure.
let serverLogBuffer = '';

interface TestResult {
  endpoint: string;
  port: number;
  success: boolean;
  error?: string;
  messages?: string[];
}

/**
 * Clean up and prepare temporary directory
 */
async function setupTmpDir(): Promise<void> {
  try {
    await rm(TMP_DIR, { recursive: true, force: true });
  } catch {
    // Directory might not exist
  }
  await mkdir(TMP_DIR, { recursive: true });
}

/**
 * Build the WebSocket demo for Node.js using bun build
 *
 * NOTE: We use bun to build but Node.js to run because of a bun bug where
 * WebSocket preValidation hooks don't execute properly in bun runtime.
 * See: https://github.com/oven-sh/bun/issues/22119
 *
 * Using --format cjs with .cjs extension avoids ESM/CommonJS interop issues
 * that occur when building ESM for Node.js with "type": "module" in package.json
 *
 * Keep Vite external because it lazily imports esbuild at runtime, which Bun's
 * bundler cannot statically resolve.
 */
async function buildDemo(): Promise<void> {
  if (isVerbose) {
    console.log('🔨 Building WebSocket demo for Node.js...');
  }

  return new Promise((resolve, reject) => {
    const buildProcess = spawn(
      'bun',
      [
        'build',
        SOURCE_FILE,
        '--outfile',
        BUILD_OUTPUT,
        '--target',
        'node',
        '--format',
        'cjs',
        '--external',
        'vite',
      ],
      {
        stdio: ['inherit', 'pipe', 'pipe'],
        cwd: process.cwd(),
      },
    );

    let stdout = '';
    let stderr = '';

    buildProcess.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    buildProcess.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    buildProcess.on('close', (code) => {
      if (code === 0) {
        if (isVerbose) {
          console.log('✅ Build completed successfully');

          if (stdout) {
            console.log('Build output:', stdout);
          }
        }

        resolve();
      } else {
        if (isVerbose) {
          console.error('❌ Build failed with code:', code);

          if (stderr) {
            console.error('Build error:', stderr);
          }

          reject(new Error(`Build failed with code ${code}`));
        } else {
          // In quiet/non-verbose mode, append the build stderr directly to the error message
          // so that the failure details are reported when the caller catches and logs the error.
          reject(
            new Error(
              `Build failed with code ${code}${stderr ? `\nBuild error: ${stderr}` : ''}`,
            ),
          );
        }
      }
    });
  });
}

/**
 * Start the built demo server
 */
async function startBuiltDemo(): Promise<ChildProcess> {
  if (isVerbose) {
    console.log('🚀 Starting built WebSocket demo...');
  }

  const serverProcess = spawn('node', [BUILD_OUTPUT, 'dev'], {
    stdio: ['inherit', 'pipe', 'pipe'],
    cwd: process.cwd(),
  });

  // Wait for servers to start up
  return new Promise((resolve, reject) => {
    let output = '';

    const timeout = setTimeout(() => {
      reject(new Error('Server startup timeout'));
    }, 10000);

    serverProcess.stdout?.on('data', (data: Buffer) => {
      const chunk = data.toString();
      output += chunk;
      serverLogBuffer += chunk;

      if (isVerbose) {
        console.log(chunk.trim());
      }

      // Check if both servers are running (matches logger.success output after template substitution)
      if (
        output.includes('SSR WebSocket server running') &&
        output.includes('API WebSocket server running')
      ) {
        clearTimeout(timeout);
        resolve(serverProcess);
      }
    });

    serverProcess.stderr?.on('data', (data: Buffer) => {
      const chunk = data.toString();
      serverLogBuffer += chunk;

      if (isVerbose) {
        console.error('Server error:', chunk.trim());
      }
    });

    serverProcess.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`Server exited with code ${code}`));
      }
    });
  });
}

/**
 * Test a single WebSocket connection
 */
async function testWebSocketConnection(
  url: string,
  port: number,
  expectedBehavior: 'connect' | 'reject',
  testMessage?: string,
): Promise<TestResult> {
  const endpoint = url.replace(`ws://localhost:${port}`, '');

  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    const messages: string[] = [];
    let isConnected = false;

    const timeout = setTimeout(() => {
      ws.close();
      resolve({
        endpoint,
        port,
        success: false,
        error: 'Connection timeout',
      });
    }, 5000);

    ws.on('open', () => {
      isConnected = true;

      if (isVerbose) {
        console.log(`  ✅ Connected to ${endpoint}`);
      }

      if (expectedBehavior === 'reject') {
        clearTimeout(timeout);
        ws.close();
        resolve({
          endpoint,
          port,
          success: false,
          error: 'Expected rejection but connection succeeded',
        });
        return;
      }

      // Send test message if provided
      if (testMessage) {
        ws.send(testMessage);
      }

      // Close after a short delay to collect messages
      setTimeout(() => {
        ws.close();
      }, 1000);
    });

    ws.on('message', (data: Buffer) => {
      const message = data.toString();
      messages.push(message);

      if (isVerbose) {
        console.log(`  📨 Received: ${message}`);
      }
    });

    ws.on('close', (code, _reason) => {
      clearTimeout(timeout);

      if (expectedBehavior === 'reject' && !isConnected) {
        resolve({
          endpoint,
          port,
          success: true,
          messages: [`Connection rejected as expected (code: ${code})`],
        });
      } else if (expectedBehavior === 'connect' && isConnected) {
        resolve({
          endpoint,
          port,
          success: true,
          messages,
        });
      } else {
        resolve({
          endpoint,
          port,
          success: false,
          error: `Unexpected behavior: expected ${expectedBehavior}, got ${isConnected ? 'connect' : 'reject'}`,
        });
      }
    });

    ws.on('error', (error) => {
      clearTimeout(timeout);

      if (expectedBehavior === 'reject') {
        resolve({
          endpoint,
          port,
          success: true,
          messages: [`Connection rejected as expected: ${error.message}`],
        });
      } else {
        resolve({
          endpoint,
          port,
          success: false,
          error: error.message,
        });
      }
    });
  });
}

/**
 * Test client count progression (0→1→2→1→0)
 */
async function testClientCountProgression(port: number): Promise<TestResult> {
  const endpoint = '/client-count-progression';

  try {
    if (isVerbose) {
      console.log(`  🔗 Testing client count progression...`);
    }

    const messages: string[] = [];
    const counts: number[] = [];

    // Helper to get count from /stats endpoint
    const getCount = async (): Promise<number> => {
      const response = await fetch(`http://localhost:${port}/api/stats`);

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}: Failed to fetch stats from port ${port}`,
        );
      }

      const data = (await response.json()) as {
        data?: { websocketClients?: number };
      };

      if (!data.data || typeof data.data.websocketClients !== 'number') {
        throw new Error(
          `Invalid response format from port ${port}: missing websocketClients`,
        );
      }

      return data.data.websocketClients;
    };

    // 1. Initial state (0)
    const count0 = await getCount();
    counts.push(count0);
    messages.push(`Initial: ${count0} clients`);

    // 2. Connect first client (0→1)
    const ws1 = new WebSocket(`ws://localhost:${port}/ws/always-allow`);
    await new Promise((resolve) => ws1.on('open', resolve));
    await new Promise((resolve) => setTimeout(resolve, 100));
    const count1 = await getCount();
    counts.push(count1);
    messages.push(`After connect 1: ${count1} clients`);

    // 3. Connect second client (1→2)
    const ws2 = new WebSocket(`ws://localhost:${port}/ws/echo`);
    await new Promise((resolve) => ws2.on('open', resolve));
    await new Promise((resolve) => setTimeout(resolve, 100));
    const count2 = await getCount();
    counts.push(count2);
    messages.push(`After connect 2: ${count2} clients`);

    // 4. Disconnect first client (2→1)
    ws1.close();
    await new Promise((resolve) => setTimeout(resolve, 300));
    const count3 = await getCount();
    counts.push(count3);
    messages.push(`After disconnect 1: ${count3} clients`);

    // 5. Disconnect second client (1→0)
    ws2.close();
    await new Promise((resolve) => setTimeout(resolve, 300));
    const count4 = await getCount();
    counts.push(count4);
    messages.push(`After disconnect 2: ${count4} clients`);

    // Verify progression
    const expectedProgression = [0, 1, 2, 1, 0];
    const isSuccess =
      JSON.stringify(expectedProgression) === JSON.stringify(counts);

    if (isSuccess) {
      messages.push(`✅ Progression: ${counts.join('→')}`);
    } else {
      messages.push(
        `❌ Expected: ${expectedProgression.join('→')}, Got: ${counts.join('→')}`,
      );
    }

    return { endpoint, port, success: isSuccess, messages };
  } catch (error) {
    return {
      endpoint,
      port,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Test all WebSocket connections on a server
 */
async function testConnections(
  port: number,
  serverName: string,
): Promise<TestResult[]> {
  if (isVerbose) {
    console.log(`\n🧪 Testing ${serverName} server on port ${port}...`);
  }

  const tests = [
    {
      url: `ws://localhost:${port}/ws/always-allow`,
      expected: 'connect' as const,
      testMessage: 'Hello from test!',
    },
    {
      url: `ws://localhost:${port}/ws/always-reject`,
      expected: 'reject' as const,
    },
    {
      url: `ws://localhost:${port}/ws/token-validation?should-upgrade=yes`,
      expected: 'connect' as const,
      testMessage: 'Authenticated test message',
    },
    {
      url: `ws://localhost:${port}/ws/token-validation?should-upgrade=no`,
      expected: 'reject' as const,
    },
    {
      url: `ws://localhost:${port}/ws/echo`,
      expected: 'connect' as const,
      testMessage: 'Echo test message',
    },
    {
      url: `ws://localhost:${port}/ws/echo?msg=Hello%20World`,
      expected: 'connect' as const,
      testMessage: 'Additional echo message',
    },
  ];

  const results: TestResult[] = [];

  for (const test of tests) {
    if (isVerbose) {
      console.log(`  🔗 Testing ${test.url}...`);
    }

    const result = await testWebSocketConnection(
      test.url,
      port,
      test.expected,
      test.testMessage,
    );
    results.push(result);

    // Small delay between tests
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  // Add client count progression test for both servers
  const clientCountResult = await testClientCountProgression(port);
  results.push(clientCountResult);

  return results;
}

/**
 * Print test results summary
 */
function printResults(
  ssrResults: TestResult[],
  apiResults: TestResult[],
): number {
  const allResults = [
    ...ssrResults.map((r) => ({ ...r, server: 'SSR' })),
    ...apiResults.map((r) => ({ ...r, server: 'API' })),
  ];

  let passed = 0;
  let failed = 0;

  for (const result of allResults) {
    if (result.success) {
      passed++;
    } else {
      failed++;
    }
  }

  // Always print detailed results if verbose mode is active OR if any test cases failed
  if (isVerbose || failed > 0) {
    console.log('\n📊 Test Results Summary:');
    console.log('═'.repeat(60));

    for (const result of allResults) {
      const status = result.success ? '✅ PASS' : '❌ FAIL';
      const serverPort = `${result.server}:${result.port}`;
      console.log(`${status} ${serverPort}${result.endpoint}`);

      if (result.error) {
        console.log(`     Error: ${result.error}`);
      }

      if (result.messages && result.messages.length > 0) {
        console.log(`     Messages: ${result.messages.length} received`);
      }
    }

    console.log('═'.repeat(60));
    console.log(`📈 Results: ${passed} passed, ${failed} failed`);
  }

  if (failed === 0) {
    if (isVerbose) {
      console.log('🎉 All tests passed!');
    }
  } else {
    console.log('⚠️  Some tests failed. Check the output above for details.');
  }

  return failed;
}

/**
 * Main test execution
 */
async function runTests(): Promise<void> {
  let serverProcess: ChildProcess | null = null;

  try {
    // Setup
    await setupTmpDir();
    await buildDemo();

    // Start server
    serverProcess = await startBuiltDemo();

    // Wait a bit more for full startup
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Run tests
    const ssrResults = await testConnections(3001, 'SSR');
    const apiResults = await testConnections(3002, 'API');

    // Print results
    const failed = printResults(ssrResults, apiResults);

    if (failed > 0) {
      // In quiet mode, dump the captured server logs so the developer has full context on why the checks failed.
      if (!isVerbose && serverLogBuffer) {
        console.error('\n🖥️ Server logs from run:');
        console.error(serverLogBuffer);
      }

      process.exitCode = 1;
    } else {
      if (!isVerbose) {
        console.log('✅ WebSocket integration tests passed successfully.');
      }
    }
  } catch (error) {
    // If the server failed to start or test connections threw an error in quiet mode,
    // dump any accumulated server output to assist with diagnosis.
    if (!isVerbose && serverLogBuffer) {
      console.error('\n🖥️ Server logs from run:');
      console.error(serverLogBuffer);
    }

    console.error('❌ Test execution failed:', error);
    process.exit(1);
  } finally {
    // Cleanup
    if (serverProcess) {
      if (isVerbose) {
        console.log('\n🛑 Stopping server...');
      }

      serverProcess.kill('SIGTERM');

      // Wait for graceful shutdown
      await new Promise((resolve) => setTimeout(resolve, 2000));

      if (!serverProcess.killed) {
        if (isVerbose) {
          console.log('🔪 Force killing server...');
        }

        serverProcess.kill('SIGKILL');
      }
    }

    try {
      await rm(TMP_DIR, { recursive: true, force: true });

      if (isVerbose) {
        console.log('🧹 Cleaned up temporary files');
      }
    } catch (error) {
      if (isVerbose) {
        console.warn('⚠️  Failed to clean up temporary files:', error);
      }
    }
  }
}

// Handle script interruption
process.on('SIGINT', () => {
  if (isVerbose) {
    console.log('\n🛑 Test interrupted by user');
  }

  process.exit(0);
});

// Run the tests
if (isVerbose) {
  console.log('🧪 Starting WebSocket Build Test...');
}

runTests().catch((error) => {
  // If the run failed at the top level in quiet mode, dump any captured server logs
  // before printing the fatal script error.
  if (!isVerbose && serverLogBuffer) {
    console.error('\n🖥️ Server logs from run:');
    console.error(serverLogBuffer);
  }

  console.error('💥 Test script failed:', error);
  process.exit(1);
});
