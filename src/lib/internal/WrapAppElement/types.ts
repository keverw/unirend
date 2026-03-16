import type { ComponentType, ReactNode } from 'react';
import type { UnirendContextValue } from '../UnirendContext';

/**
 * Options for wrapping app elements with various React wrappers
 */
export type WrapAppElementOptions = {
  /**
   * Whether to wrap the app element with React.StrictMode
   * @default true
   */
  strictMode?: boolean;
  /**
   * Optional custom wrapper component for additional providers
   * Applied after UnirendHeadProvider but before StrictMode (StrictMode is always outermost)
   * Must be a React component that accepts children
   */
  wrapProviders?: ComponentType<{ children: ReactNode }>;
  /**
   * Unirend context value to provide to the app
   * Contains render mode, development status, and server request info
   * Always provided by mountApp, SSRServer, or SSG
   */
  unirendContext: UnirendContextValue;
};
