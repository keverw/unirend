export const TAB_SPACES = ' '.repeat(4);

/**
 * Marks a <meta> in the served head as coming from the app's index.html template rather than
 * from a page's UnirendHead. The client needs to tell the two apart to reconcile them across
 * navigations: it owns the template's metas (removing one when a page overrides it, putting it
 * back when the page navigates away) but must never touch the ones React hoists.
 */
export const TEMPLATE_META_MARKER_ATTRIBUTE = 'data-unirend-template-meta';

/**
 * Global carrying the template's full <meta> baseline to the client, including the metas the
 * server stripped from the served head because the current page overrides them. Without those,
 * navigating away from an overriding page would leave no baseline to restore.
 */
export const TEMPLATE_METAS_GLOBAL = '__UNIREND_TEMPLATE_METAS__';

/**
 * Default API endpoint prefix (e.g., "/api")
 * Used when apiEndpoints.apiEndpointPrefix is not configured
 */
export const DEFAULT_API_PREFIX = '/api';

/**
 * Default page data endpoint name (e.g., "page_data")
 * Used when apiEndpoints.pageDataEndpoint is not configured
 */
export const DEFAULT_PAGE_DATA_ENDPOINT = 'page_data';
