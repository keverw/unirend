import { TEMPLATE_METAS_GLOBAL } from '../consts';
import { hashInlineContentForCSP } from '../csp-hash';

/**
 * Global carrying the dev-mode flag to the client, so it always agrees with the
 * server rather than re-deriving it from something the bundle can see.
 */
const DEV_MODE_GLOBAL = '__lifecycleion_is_dev__';

/**
 * `id` of the JSON data block the bootstrap reads.
 */
export const UNIREND_DATA_BLOCK_ID = '__unirend_data__';

/**
 * Everything the server hands the client before any application code runs.
 *
 * Optional members are genuinely optional: a key that is absent means the
 * server did not provide that value, and the bootstrap leaves the
 * corresponding global unset rather than defining it as `undefined`. That
 * distinction is why the bootstrap tests with `in` rather than reading and
 * comparing.
 */
export interface UnirendContextData {
  isDev: boolean;
  requestContext?: Record<string, unknown>;
  appConfig?: Record<string, unknown>;
  cdnBaseURL: string;
  domainInfo: unknown;
  templateAttrs: {
    html: Record<string, string>;
    body: Record<string, string>;
  };
  templateMetas: unknown[];
  /**
   * React Router's hydration payload, carried as the JSON **text** React Router
   * itself emitted rather than as a parsed object.
   *
   * Two reasons it stays a string. It is what React Router chose to emit, and
   * `JSON.parse` of one large string is measurably faster than parsing an
   * equivalent object literal, which is the whole point of the double encoding.
   * And carrying the exact characters means nothing here re-serializes a payload
   * this file does not own.
   *
   * Absent when the page has no hydration data, or when the emitted script did
   * not match the shape this can safely take apart.
   */
  routerHydration?: string;
}

/**
 * Serialize the payload for embedding in a `<script type="application/json">`
 * element.
 *
 * Every `<` is written as its `\u003c` escape, which is what stops a value
 * containing a closing script tag from ending the element early. JSON treats
 * the escape as the character it names, so `JSON.parse` on the client gets the
 * original text back.
 *
 * This is the same escaping the seven separate assignment scripts used, and it
 * matters at least as much here, since the whole payload now travels in one
 * element.
 */
export function serializeContextData(data: UnirendContextData): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

/**
 * The bootstrap that copies the data block onto the globals the client reads.
 *
 * **Why a data block plus a fixed script rather than seven assignments.** The
 * old form wrote each value straight into executable JavaScript, so the script
 * text changed with every request and no hash could ever cover it. Under a
 * strict `script-src` that leaves nonces as the only option, which in turn
 * rules out prerendered output, where there is no request to mint a nonce for.
 *
 * A `<script>` with a non-JavaScript `type` is never executed by any browser,
 * so there is nothing for `script-src` to govern and CSP does not apply to it.
 * The per-request bytes move there, and what remains executable is this
 * constant, which hashes once at module load and stays valid for every request
 * and every prerendered page.
 *
 * Written to survive a missing or malformed block rather than throwing. A throw
 * here happens while the head is still parsing and takes out every later script
 * on the page, so a data problem would become a blank page.
 *
 * Assembled from one statement per line and joined with nothing between them.
 * The delivered bytes are the same either way, and the digest covers them
 * exactly, so the only thing at stake is whether the next person can read it.
 * Every global assigned here is one line to find, change, or add.
 */
const BOOTSTRAP_STATEMENTS: string[] = [
  // Wrapped in an IIFE so `e` and `d` never reach the page's global scope.
  `(function(){`,
  `var e=document.getElementById(${JSON.stringify(UNIREND_DATA_BLOCK_ID)}),d={};`,
  // A missing or unparseable block leaves d as {}, and every assignment below
  // falls back to the same default it would use for an absent member.
  `if(e&&e.textContent){try{d=JSON.parse(e.textContent)}catch(x){}}`,
  `globalThis.${DEV_MODE_GLOBAL}=d.isDev===true;`,
  // Tested with `in` rather than by reading: an absent member means the server
  // did not provide one, and the global should stay undefined rather than be
  // defined as undefined.
  `if("requestContext" in d){window.__FRONTEND_REQUEST_CONTEXT__=d.requestContext}`,
  `if("appConfig" in d){window.__PUBLIC_APP_CONFIG__=d.appConfig}`,
  `window.__CDN_BASE_URL__=typeof d.cdnBaseURL==="string"?d.cdnBaseURL:"";`,
  `window.__DOMAIN_INFO__=d.domainInfo!==undefined?d.domainInfo:null;`,
  `window.__UNIREND_TEMPLATE_ATTRS__=d.templateAttrs||{html:{},body:{}};`,
  `window.${TEMPLATE_METAS_GLOBAL}=d.templateMetas||[];`,
  // Last, and separately guarded: everything above is already assigned by now,
  // so a malformed hydration payload must not undo it.
  `if(typeof d.routerHydration==="string"){try{window.__staticRouterHydrationData=JSON.parse(d.routerHydration)}catch(x){}}`,
  `})();`,
];

export const UNIREND_BOOTSTRAP_SCRIPT = BOOTSTRAP_STATEMENTS.join('');

/**
 * CSP `script-src` source expression for {@link UNIREND_BOOTSTRAP_SCRIPT}.
 *
 * Computed from the same constant the markup interpolates, so the two cannot
 * drift. Add it to `script-src` and unirend's own injected globals work under a
 * policy with no `'unsafe-inline'` and no nonce.
 */
export const UNIREND_BOOTSTRAP_SCRIPT_HASH = hashInlineContentForCSP(
  UNIREND_BOOTSTRAP_SCRIPT,
);

/**
 * Render the two elements that carry server context to the client.
 *
 * Order matters and is not incidental: the data block has to be in the DOM
 * before the bootstrap looks it up, and scripts run in document order, so the
 * block goes first.
 *
 * Both are written with nothing between the tags and the interpolated value.
 * The digest covers an element's text content byte for byte, so an indent added
 * to pretty-print this markup would land inside the hash and stop it matching.
 */
export function renderContextDataElements(data: UnirendContextData): string[] {
  return [
    `<script type="application/json" id="${UNIREND_DATA_BLOCK_ID}">${serializeContextData(data)}</script>`,
    `<script>${UNIREND_BOOTSTRAP_SCRIPT}</script>`,
  ];
}
