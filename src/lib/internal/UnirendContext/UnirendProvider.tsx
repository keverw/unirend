import { UnirendContext } from './context';
import type { UnirendProviderProps } from './context';

/**
 * UnirendProvider component that provides context to the app
 *
 * @example
 * ```tsx
 * <UnirendProvider value={{ renderMode: 'ssr', isDevelopment: true }}>
 *   <App />
 * </UnirendProvider>
 * ```
 */
export function UnirendProvider({ children, value }: UnirendProviderProps) {
  return (
    <UnirendContext.Provider value={value}>{children}</UnirendContext.Provider>
  );
}
