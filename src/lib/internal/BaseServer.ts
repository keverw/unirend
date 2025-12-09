import type { FastifyInstance } from 'fastify';

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
  public abstract listen(port?: number, host?: string): Promise<void>;

  /**
   * Stop the server if it's currently running
   * @returns Promise that resolves when server is stopped
   */
  public abstract stop(): Promise<void>;

  /**
   * Check if the server is currently listening
   * @returns True if server is listening, false otherwise
   */
  public isListening(): boolean {
    return this._isListening;
  }

  // ---------------------------------------------------------------------------
  // WebSocket support
  // ---------------------------------------------------------------------------

  /**
   * Register a WebSocket handler for the specified path
   * @throws Error if WebSocket support is not enabled on the server
   */
  public abstract registerWebSocketHandler(config: unknown): void;

  /**
   * Get the list of active WebSocket clients (if enabled)
   */
  public abstract getWebSocketClients(): Set<unknown>;

  // ---------------------------------------------------------------------------
  // Server-level decorations (read-only access)
  // ---------------------------------------------------------------------------

  /**
   * Check if a server-level decoration exists. Returns false if the server is not started.
   * Use this to discover metadata decorated by plugins (e.g., "cookiePluginInfo").
   */
  public hasDecoration(property: string): boolean {
    const instance = this.fastifyInstance as unknown as Record<
      string,
      unknown
    > | null;
    if (!instance) {
      return false;
    }

    return Object.prototype.hasOwnProperty.call(instance, property);
  }

  /**
   * Read a server-level decoration value. Returns undefined if missing or server not started.
   * Decorations are attached via Fastify's decorate() API inside plugins.
   */
  public getDecoration<T = unknown>(property: string): T | undefined {
    const instance = this.fastifyInstance as unknown as Record<
      string,
      unknown
    > | null;
    if (!instance) {
      return undefined;
    }

    return instance[property] as T | undefined;
  }
}
