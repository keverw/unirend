import { ServeSSRDevOptions, ServeSSRProdOptions } from "../types";

type SSRServerConfigDev = {
  mode: "development";
  serverSourceEntryPath: string; // Path to the source entry file for development
  options: ServeSSRDevOptions;
};

type SSRServerConfigProd = {
  mode: "production";
  buildDir: string; // Directory containing built assets (HTML template, static files, manifest, etc.)
  importFn: () => Promise<{ render: (req: Request) => Promise<Response> }>;
  options: ServeSSRProdOptions;
};

type SSRServerConfig = SSRServerConfigDev | SSRServerConfigProd;

/**
 * Internal server class for handling SSR rendering
 * Not intended to be used directly by library consumers
 */
export class SSRServer {
}
