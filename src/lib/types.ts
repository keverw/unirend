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
   * Optional configuration object to be injected into the frontend app
   * Will be serialized and injected as window.__APP_CONFIG__
   */
  frontendAppConfig?: Record<string, any>;
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
  frontendAppConfig?: Record<string, any>;
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
 * Represents a page to be generated during SSG (Static Site Generation)
 */
export interface IPageWanted {
  /** The URL path for the page */
  path: string;
  /** The output filename for the generated HTML */
  filename: string;
}

/**
 * Status code for a generated page
 */
export type SSGPageStatus = "success" | "not_found" | "error";

/**
 * Report for a single generated page
 */
export interface SSGPageReport extends IPageWanted {
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
