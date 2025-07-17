export type renderType = "ssg" | "ssr";
export interface IRenderRequest {
  type: renderType;
}

export interface IRenderResult {
  html: string;
}

/**
 * Base options for SSR
 */
interface ServeSSROptions {
  /**
   * ID of the container element (defaults to "root")
   * This element will be formatted inline to prevent hydration issues
   */
  containerID?: string;
  onRequest?: (req: Request) => void | Promise<void>;
}

export interface ServeSSRDevOptions extends ServeSSROptions {
}

export interface ServeSSRProdOptions extends ServeSSROptions {
  /**
   * Optional configuration object to be injected into the frontend app
   * Will be serialized and injected as window.__APP_CONFIG__
   *
   * NOTE: This only works in production builds. In development with Vite,
   * use environment variables (import.meta.env) or other dev-time config methods.
   * Your app should check for window.__APP_CONFIG__ and fallback to dev defaults:
   *
   * const apiUrl = window.__APP_CONFIG__?.apiUrl || 'http://localhost:3001';
   */
  frontendAppConfig?: Record<string, unknown>;
  /**
   * Name of the server entry file to look for in the Vite manifest
   * Defaults to "entry-server" if not provided
   */
  serverEntry?: string;
}

/**
 * Options for Static Site Generation
 */
export interface SSGOptions {
  /**
   * Optional configuration object to be injected into the frontend app
   * Will be serialized and injected as window.__APP_CONFIG__
   */
  frontendAppConfig?: Record<string, unknown>;
  /**
   * ID of the container element (defaults to "root")
   * This element will be formatted inline to prevent hydration issues
   */
  containerID?: string;
  /**
   * Name of the server entry file to look for in the Vite manifest
   * Defaults to "entry-server" if not provided
   */
  serverEntry?: string;
}

/**
 * Base interface for pages to be generated
 */
export interface IGeneratorPageBase {
  /** The output filename for the generated HTML */
  filename: string;
}

/**
 * SSG page - server-side rendered at build time
 */
export interface ISSGPage extends IGeneratorPageBase {
  /** Type of page generation */
  type: "ssg";
  /** The URL path for the page (required for SSG) */
  path: string;
}

/**
 * SPA page - client-side rendered with custom metadata
 */
export interface ISPAPage extends IGeneratorPageBase {
  /** Type of page generation */
  type: "spa";
  /** Custom title for the SPA page */
  title?: string;
  /** Custom meta description for the SPA page */
  description?: string;
  /** Additional meta tags as key-value pairs */
  meta?: Record<string, string>;
}

/**
 * Union type for all page types
 */
export type IPageWanted = ISSGPage | ISPAPage;

/**
 * Status code for a generated page
 */
export type SSGPageStatus = "success" | "not_found" | "error";

/**
 * Report for a single generated page
 */
export interface SSGPageReport {
  /** The page that was processed */
  page: IPageWanted;
  /** Status of the generation */
  status: SSGPageStatus;
  /** Full path to the generated file (if successful) */
  outputPath?: string;
  /** Error details (if status is 'error') */
  errorDetails?: string;
  /** Time taken to generate the page in milliseconds */
  timeMs: number;
}

/**
 * Collection of page reports for the SSG process
 */
export interface SSGPagesReport {
  /** Reports for each page */
  pages: SSGPageReport[];
  /** Total number of pages processed */
  totalPages: number;
  /** Number of successfully generated pages */
  successCount: number;
  /** Number of pages with errors */
  errorCount: number;
  /** Number of pages not found (404) */
  notFoundCount: number;
  /** Total time taken for the entire generation process in milliseconds */
  totalTimeMs: number;
  /** Directory where files were generated */
  buildDir: string;
}

/**
 * Complete report for the SSG process, including potential fatal errors
 */
export interface SSGReport {
  /** Fatal error if the process failed before page generation */
  fatalError?: Error;
  /** Page generation reports (always present, even on error) */
  pagesReport: SSGPagesReport;
}
