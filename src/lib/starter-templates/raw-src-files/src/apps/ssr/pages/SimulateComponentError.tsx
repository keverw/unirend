// Throws immediately (server and client) to trigger the ApplicationError boundary.
// No SSG-style window check needed since SSR renders per-request, not at build time.
export function SimulateComponentError(): never {
  throw new Error('Simulated component error');
}
