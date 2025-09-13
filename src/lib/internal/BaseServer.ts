import type { FastifyInstance } from "fastify";

/**
 * Abstract base class for all server types in unirend
 * Defines the common interface that all servers must implement
 */
export abstract class BaseServer {
  protected fastifyInstance: FastifyInstance | null = null;
  protected _isListening: boolean = false;
  protected _isStarting: boolean = false;

  /**
   * Start the server listening on the specified port and host
   * @param port Port to bind to (default: 3000)
   * @param host Host to bind to (default: "localhost")
   * @returns Promise that resolves when server is ready
   */
  abstract listen(port?: number, host?: string): Promise<void>;

  /**
   * Stop the server if it's currently running
   * @returns Promise that resolves when server is stopped
   */
  abstract stop(): Promise<void>;

  /**
   * Check if the server is currently listening
   * @returns True if server is listening, false otherwise
   */
  isListening(): boolean {
    return this._isListening;
  }

  // ---------------------------------------------------------------------------
  // WebSocket support
  // ---------------------------------------------------------------------------

  /**
   * Register a WebSocket handler for the specified path
   * @throws Error if WebSocket support is not enabled on the server
   */
  abstract registerWebSocketHandler(config: unknown): void;

  /**
   * Get the list of active WebSocket clients (if enabled)
   */
  abstract getWebSocketClients(): Set<unknown>;
}
