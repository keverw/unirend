import { useMemo } from 'react';
import { useLocation } from 'react-router';
import qs from 'qs';

/**
 * Returns the current URL's query parameters parsed with qs, supporting nested
 * objects and arrays (e.g. `?filters[status]=active&ids[]=1&ids[]=2`).
 *
 * The returned object matches the shape of `params.queryParams` in page data
 * loader handlers — so what you read in a component is consistent with what
 * the server handler receives.
 *
 * Re-parses only when the search string changes.
 *
 * @example
 * ```tsx
 * import { useQueryParams } from 'unirend/client';
 *
 * function ProductsPage() {
 *   const { filters } = useQueryParams() as { filters: { status: string } };
 *   return <div>Status: {filters?.status}</div>;
 * }
 * ```
 */
export function useQueryParams(): Record<string, unknown> {
  const { search } = useLocation();

  return useMemo(() => qs.parse(search, { ignoreQueryPrefix: true }), [search]);
}

/**
 * Serializes a params object into a query string using qs, supporting nested
 * objects and arrays. Returns the string without a leading `?` — prepend one
 * yourself when passing to `navigate()` or building a `<Link to>`.
 *
 * @example
 * ```ts
 * import { stringifyQueryParams } from 'unirend/router-utils';
 * import { useNavigate } from 'react-router';
 *
 * const navigate = useNavigate();
 * navigate(`?${stringifyQueryParams({ filters: { status: 'active' }, ids: [1, 2] })}`);
 * // → ?filters%5Bstatus%5D=active&ids%5B0%5D=1&ids%5B1%5D=2
 * ```
 */
export function stringifyQueryParams(params: Record<string, unknown>): string {
  return qs.stringify(params);
}
