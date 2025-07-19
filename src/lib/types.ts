export type renderType = "ssg" | "ssr";
export interface IRenderRequest {
  type: renderType;
  fetchRequest: Request;
}

/**
 * Base interface for render results with a discriminated union type
 */
interface IRenderResultBase {
  resultType: "page" | "response";
}

/**
 * Page result containing HTML content
 */
export interface IRenderPageResult extends IRenderResultBase {
  resultType: "page";
  html: string;
  preloadLinks: string;
  helmet?: {
    title: { toString(): string };
    meta: { toString(): string };
    link: { toString(): string };
  };
  statusCode?: number;
  errorDetails?: string;
  ssOnlyData?: Record<string, unknown>;
}

/**
 * Response result wrapping a standard Response object
 * Used for redirects, errors, or any other non-HTML responses
 */
export interface IRenderResponseResult extends IRenderResultBase {
  resultType: "response";
  response: Response;
}

/**
 * Union type for all possible render results
 */
export type IRenderResult = IRenderPageResult | IRenderResponseResult;

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
 * Logger interface for SSG process
 */
export interface SSGLogger {
  /** Log info messages */
  info: (message: string) => void;
  /** Log warning messages */
  warn: (message: string) => void;
  /** Log error messages */
  error: (message: string) => void;
}

/**
 * Pre-built console logger for SSG with prefixed messages
 * Use this if you want basic console logging during SSG
 */
export const SSGConsoleLogger: SSGLogger = {
  info: (message: string) => console.log(`[SSG Info] ${message}`),
  warn: (message: string) => console.warn(`[SSG Warn] ${message}`),
  error: (message: string) => console.error(`[SSG Error] ${message}`),
};

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
  /**
   * Optional logger for the SSG process
   * Defaults to console if not provided
   */
  logger?: SSGLogger;
  /**
   * Name of the client folder within buildDir
   * Defaults to "client" if not provided
   */
  clientFolderName?: string;
  /**
   * Name of the server folder within buildDir
   * Defaults to "server" if not provided
   */
  serverFolderName?: string;
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
