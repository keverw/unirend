import { describe, it, expect } from 'bun:test';
import fastify from 'fastify';
import {
  collectCORSIssues,
  validateCORSPolicy,
  DEFAULT_CORS_CONFIG,
} from './cors-validation';
import type { CORSConfig } from './cors-validation';
import { securityHeaders } from '../built-in-plugins/security-headers';
import type {
  PluginHostInstance,
  PluginOptions,
  UnirendServerMode,
} from '../types';

function createMockOptions(): PluginOptions {
  return {
    mode: 'ssr' as UnirendServerMode,
    isDevelopment: false,
    serverType: 'ssr',
  } as unknown as PluginOptions;
}

/** The paths reported, for asserting which field a caller would be pointed at. */
function paths(cors: unknown): string[] {
  return validateCORSPolicy(cors).issues.map((issue) => issue.path);
}

describe('validateCORSPolicy', () => {
  it('accepts a valid block', () => {
    const result = validateCORSPolicy({
      origin: ['https://example.com', '*.example.com'],
      credentials: ['https://example.com'],
      methods: ['GET', 'POST'],
      maxAge: 600,
    });

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('accepts an empty block and an absent one', () => {
    // Every field has a default, so nothing set is nothing to complain about.
    expect(validateCORSPolicy({}).valid).toBe(true);
    expect(validateCORSPolicy(undefined).valid).toBe(true);
  });

  it('returns the block typed, not the normalized form', () => {
    // What a caller stores should be what they wrote. Normalization fills in
    // defaults and folds the credentials list into origin, and neither belongs
    // in someone's saved configuration.
    const input = { origin: 'https://example.com' };
    const result = validateCORSPolicy(input);

    expect(result.valid).toBe(true);
    expect(result.policy).toBe(input);
  });

  it('rejects anything that is not an object', () => {
    for (const value of ['https://example.com', 42, null, []]) {
      expect(validateCORSPolicy(value).valid).toBe(false);
    }
  });

  it('reports a misspelled field rather than ignoring it', () => {
    // The failure this prevents is a silent one: the form saves, the page says
    // it worked, and the header never changes.
    const result = validateCORSPolicy({ allowedHeader: ['X-Thing'] });

    expect(result.valid).toBe(false);
    expect(result.issues[0]?.path).toBe('allowedHeader');
    expect(result.issues[0]?.message).toMatch(/is not a CORS option/);
  });

  describe('field shapes', () => {
    // The checks that only matter for input nobody vouched for. A TypeScript
    // caller cannot write any of these, and a JSON column can write all of them.
    it('rejects an origin that is not a string, list, or function', () => {
      expect(paths({ origin: 42 })).toEqual(['origin']);
      expect(paths({ origin: ['https://example.com', 7] })).toEqual(['origin']);
    });

    it('rejects credentials that are not a boolean, list, or function', () => {
      expect(paths({ credentials: 'yes' })).toEqual(['credentials']);
    });

    it('rejects a non-list where a list of names belongs', () => {
      expect(paths({ methods: 'GET' })).toEqual(['methods']);
      expect(paths({ allowedHeaders: {} })).toEqual(['allowedHeaders']);
      expect(paths({ exposedHeaders: [1] })).toEqual(['exposedHeaders']);
    });

    it('rejects a maxAge that is not a whole non-negative number', () => {
      expect(paths({ maxAge: -1 })).toEqual(['maxAge']);
      expect(paths({ maxAge: '600' })).toEqual(['maxAge']);
      expect(paths({ maxAge: Infinity })).toEqual(['maxAge']);

      // A fraction is the one that used to pass. Access-Control-Max-Age takes
      // delta-seconds, a run of digits, so `1.5` is a value a browser cannot
      // parse: it drops the header and falls back to its own preflight cache
      // default of a few seconds, and preflight requests start firing far more often
      // than the configuration says with nothing reporting it. `hours * 3600`
      // with a half-hour is the realistic way in.
      expect(paths({ maxAge: 1.5 })).toEqual(['maxAge']);
      expect(paths({ maxAge: 1800.5 })).toEqual(['maxAge']);

      // Zero is valid and means "do not cache the preflight".
      expect(
        validateCORSPolicy({ origin: ['https://example.com'], maxAge: 0 })
          .valid,
      ).toBe(true);
    });

    it('rejects a preflight status that cannot mean success', () => {
      // The value goes straight onto the preflight response, and this field
      // names the status of a *successful* preflight, so anything outside 2xx
      // is a contradiction rather than a customization.
      expect(paths({ optionsSuccessStatus: 42 })).toEqual([
        'optionsSuccessStatus',
      ]);
      expect(paths({ optionsSuccessStatus: 204.5 })).toEqual([
        'optionsSuccessStatus',
      ]);

      // These used to pass, and each one stops every cross-origin request that
      // needs a preflight: a browser reads any non-2xx preflight as failed, and
      // does not follow a redirect from one.
      for (const status of [301, 302, 400, 403, 404, 500]) {
        expect(paths({ optionsSuccessStatus: status })).toEqual([
          'optionsSuccessStatus',
        ]);
      }

      // The whole 2xx range stays open, since which one to send is a real
      // choice: 204 is the default, and 200 is what some older clients want.
      for (const status of [200, 202, 204, 299]) {
        expect(
          validateCORSPolicy({
            origin: ['https://example.com'],
            optionsSuccessStatus: status,
          }).valid,
        ).toBe(true);
      }
      // With an origin, since a preflight status on a block that does no CORS
      // is inert and reported as such.
      expect(
        validateCORSPolicy({
          origin: ['https://example.com'],
          optionsSuccessStatus: 200,
        }).valid,
      ).toBe(true);
    });

    it('rejects a non-boolean where a flag belongs', () => {
      expect(paths({ credentialsAllowWildcardSubdomains: 'true' })).toEqual([
        'credentialsAllowWildcardSubdomains',
      ]);
    });

    it('does not pile consequences on top of a malformed origin', () => {
      // The rules below the shape checks all ask what a *combination* means,
      // and there is no useful answer for `origin: 42` next to a credentials
      // list. One mistake, one complaint.
      expect(
        paths({ origin: 42, credentials: ['https://example.com'] }),
      ).toEqual(['origin']);
    });
  });

  describe('list entries are RFC 9110 tokens', () => {
    // All three fields are written into their response header verbatim, and a
    // browser drops a header value it cannot parse rather than the offending
    // entry, so one bad name takes every other name in the list with it.
    it('rejects a method name that is not a token', () => {
      expect(
        paths({ origin: ['https://example.com'], methods: ['GET POST'] }),
      ).toEqual(['methods']);
    });

    it('rejects an exposed header name that is not a token', () => {
      expect(
        paths({
          origin: ['https://example.com'],
          exposedHeaders: ['X Total Count'],
        }),
      ).toEqual(['exposedHeaders']);
    });

    it('names the field and the entry, so the message points somewhere', () => {
      const [issue] = validateCORSPolicy({
        origin: ['https://example.com'],
        methods: ['GET POST'],
      }).issues;

      expect(issue.path).toBe('methods');
      expect(issue.message).toContain('"GET POST"');
      expect(issue.message).toContain('Access-Control-Allow-Methods');
      expect(issue.message).toContain('method name');
    });

    // `*` is a legal token character, so it satisfies the grammar in every one
    // of these fields on its own terms. Whether a browser reads it as a
    // wildcard or as a literal name is the Fetch specification's business (it
    // depends on whether the request is credentialed), not something this
    // validator takes a position on.
    it('accepts a wildcard entry in methods and exposedHeaders', () => {
      expect(
        validateCORSPolicy({ origin: ['https://example.com'], methods: ['*'] })
          .valid,
      ).toBe(true);

      expect(
        validateCORSPolicy({
          origin: ['https://example.com'],
          exposedHeaders: ['*'],
        }).valid,
      ).toBe(true);
    });

    it('reports every bad entry, not just the first in a field', () => {
      // Two offenders in one field and one in another, so this pins both that
      // each entry is judged on its own and that the field it belongs to is the
      // path reported.
      expect(
        paths({
          origin: ['https://example.com'],
          methods: ['GET', 'bad method', 'also bad'],
          exposedHeaders: ['X Bad', 'X-Good'],
        }),
      ).toEqual(['methods', 'methods', 'exposedHeaders']);
    });

    // Padding is refused rather than trimmed, matching how a CSP source
    // expression is treated, and it gets a message of its own: the general one
    // says a browser cannot parse the value, and for whitespace that is simply
    // untrue. HTTP allows optional whitespace around a list element, so
    // `Content-Type , X-Ok` parses exactly as intended.
    it('reports whitespace padding as itself, not as an unparseable name', () => {
      const [issue] = validateCORSPolicy({
        origin: ['https://example.com'],
        allowedHeaders: ['Content-Type ', 'X-Ok'],
      }).issues;

      expect(issue.path).toBe('allowedHeaders');
      expect(issue.message).toContain('leading or trailing whitespace');
      expect(issue.message).toContain('Write it as "Content-Type"');
      expect(issue.message).not.toContain('cannot parse');
    });

    // Padding around a name that is broken anyway points at the padding only if
    // that is the whole problem. Here it is not, so the grammar message is the
    // useful one.
    it('reports the grammar when trimming would not rescue the entry', () => {
      const [issue] = validateCORSPolicy({
        origin: ['https://example.com'],
        allowedHeaders: [' bad name '],
      }).issues;

      expect(issue.message).toContain('is not a valid header name');
      expect(issue.message).not.toContain('leading or trailing whitespace');
    });

    // A repeat says nothing the first copy did not, so it is a list assembled
    // from two places rather than a policy. Compared without regard to case,
    // because that is how both kinds of name compare by the time a browser sees
    // them: field names are case-insensitive, and methods are upper-cased on
    // the way out.
    it('rejects a repeated entry, case-insensitively', () => {
      expect(
        paths({
          origin: ['https://example.com'],
          allowedHeaders: ['Content-Type', 'content-type'],
        }),
      ).toEqual(['allowedHeaders']);

      expect(
        paths({ origin: ['https://example.com'], methods: ['GET', 'get'] }),
      ).toEqual(['methods']);
    });

    it('shows both spellings when a repeat is spelled differently', () => {
      const [issue] = validateCORSPolicy({
        origin: ['https://example.com'],
        allowedHeaders: ['Content-Type', 'content-type'],
      }).issues;

      expect(issue.message).toContain('"Content-Type"');
      expect(issue.message).toContain('"content-type"');
    });

    it('reports a repeated name once however often it repeats', () => {
      expect(
        paths({
          origin: ['https://example.com'],
          methods: ['GET', 'GET', 'GET', 'GET'],
        }),
      ).toEqual(['methods']);
    });

    // One complaint per mistake. A name that is not a name is reported as that,
    // rather than as that plus a complaint that it appears twice.
    it('does not also report a repeat of an already-invalid name', () => {
      expect(
        paths({
          origin: ['https://example.com'],
          methods: ['bad method', 'bad method'],
        }),
      ).toEqual(['methods', 'methods']);
    });

    // A list that is not a list of strings is that one mistake, not that
    // mistake plus a complaint about entries nothing could have read.
    it('does not report entry problems for a list that is not one', () => {
      expect(
        paths({ origin: ['https://example.com'], methods: 'GET' }),
      ).toEqual(['methods']);
    });
  });

  describe('allowedHeaders rules', () => {
    const withOrigin = (allowedHeaders: string[]) => ({
      origin: ['https://example.com'],
      allowedHeaders,
    });

    // The configured list is written into Access-Control-Allow-Headers with no
    // filtering, so a name a browser cannot parse takes the whole header with
    // it and every custom-header request starts failing. Nothing downstream
    // would report it, which is why it is refused here.
    it('rejects a name that is not a header name', () => {
      // A space is the realistic one: "Content Type" for "Content-Type".
      expect(paths(withOrigin(['Content Type']))).toEqual(['allowedHeaders']);
      expect(paths(withOrigin(['X-Ok', 'bad(header)']))).toEqual([
        'allowedHeaders',
      ]);
      expect(paths(withOrigin(['']))).toEqual(['allowedHeaders']);
    });

    it('names the offending entry in the message', () => {
      const [issue] = validateCORSPolicy(withOrigin(['Content Type'])).issues;

      expect(issue.message).toContain('"Content Type"');
    });

    // `*` is itself a legal token character, so the wildcard passes the name
    // check on grammar alone. It is matched literally before that, which is
    // what keeps it from being read as a header genuinely named "*".
    it('accepts the bare wildcard', () => {
      expect(validateCORSPolicy(withOrigin(['*'])).valid).toBe(true);
    });

    // Refused as a duplicate rather than as a wildcard mixed with names. The
    // distinction is what the message says: the mixed-wildcard rule would have
    // named an empty list of offending headers and advised writing exactly what
    // was already there.
    it('rejects a repeated wildcard as a duplicate, not as a mix', () => {
      const result = validateCORSPolicy(withOrigin(['*', '*']));

      expect(result.valid).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].message).toContain('more than once');
      expect(result.issues[0].message).not.toContain('combines');
    });

    it('rejects the wildcard alongside named headers', () => {
      expect(paths(withOrigin(['*', 'X-Thing']))).toEqual(['allowedHeaders']);

      const [issue] = validateCORSPolicy(
        withOrigin(['*', 'X-Thing', 'X-Other']),
      ).issues;

      // The named entries are listed, since the fix is to drop either them or
      // the wildcard and the author needs to see which ones are inert.
      expect(issue.message).toContain('X-Thing, X-Other');
    });

    // Deliberately valid, and not the same shape as `origin: []`. An empty list
    // sends no header, which leaves a browser permitting the CORS-safelisted
    // request headers and nothing else. That is a real policy, and there is no
    // other way to spell it, where `origin: []` can only ever be a mistake
    // because `cors: false` already says "no CORS" out loud.
    it('accepts an empty list, which permits only the safelisted headers', () => {
      expect(validateCORSPolicy(withOrigin([])).valid).toBe(true);
    });

    // One complaint per mistake: a list that is not a list of strings is
    // reported as that, without also reporting what is wrong with entries
    // nothing could have read.
    it('does not report entry problems for a list that is not one', () => {
      expect(
        paths({ origin: ['https://example.com'], allowedHeaders: {} }),
      ).toEqual(['allowedHeaders']);
    });
  });

  describe('origin and credentials rules', () => {
    it("rejects credentials: true with origin '*'", () => {
      expect(validateCORSPolicy({ origin: '*', credentials: true }).valid).toBe(
        false,
      );
    });

    it('rejects a protocol wildcard with credentials unless opted in', () => {
      expect(
        validateCORSPolicy({ origin: 'https://*', credentials: true }).valid,
      ).toBe(false);

      expect(
        validateCORSPolicy({
          origin: 'https://*',
          credentials: true,
          allowCredentialsWithProtocolWildcard: true,
        }).valid,
      ).toBe(true);
    });

    it("rejects the 'null' origin in a credentials list", () => {
      const result = validateCORSPolicy({
        origin: ['https://example.com'],
        credentials: ['null'],
      });

      expect(result.valid).toBe(false);
      expect(result.issues[0]?.message).toMatch(/'null' origin/);
    });

    it('rejects a subdomain wildcard in credentials unless opted in', () => {
      expect(
        validateCORSPolicy({
          origin: ['*.example.com'],
          credentials: ['*.example.com'],
        }).valid,
      ).toBe(false);

      expect(
        validateCORSPolicy({
          origin: ['*.example.com'],
          credentials: ['*.example.com'],
          credentialsAllowWildcardSubdomains: true,
        }).valid,
      ).toBe(true);
    });

    it('rejects more than one wildcard token in an origin list', () => {
      expect(
        validateCORSPolicy({ origin: ['https://*', 'http://*'] }).valid,
      ).toBe(false);
    });

    it("rejects a wildcard paired with anything but 'null'", () => {
      expect(
        validateCORSPolicy({ origin: ['https://*', 'https://example.com'] })
          .valid,
      ).toBe(false);

      expect(validateCORSPolicy({ origin: ['*', 'null'] }).valid).toBe(true);
    });

    it('reports every problem rather than the first', () => {
      // The reason this returns a list at all. Someone editing a block in a
      // form should see all of it, not fix one field and resubmit to find the
      // next.
      const result = validateCORSPolicy({
        origin: ['https://example.com'],
        credentials: ['null', 'https://not a host'],
        maxAge: -1,
      });

      expect(result.valid).toBe(false);
      expect(result.issues.length).toBeGreaterThan(2);
    });

    it('says one thing about a list with several stray entries', () => {
      // Same mistake repeated is one mistake. Saying the same sentence three
      // times reads as three problems.
      const result = validateCORSPolicy({
        origin: ['https://*', 'https://a.example.com', 'https://b.example.com'],
      });

      expect(result.issues).toHaveLength(1);
    });

    it('does not judge whether a block is a good one', () => {
      // Validation answers "will this work", not "is this wise".
      expect(validateCORSPolicy({ origin: '*' }).valid).toBe(true);
    });
  });

  describe('normalization', () => {
    it("collapses ['*'] to '*'", () => {
      expect(collectCORSIssues({ origin: ['*'] }).normalized.origin).toBe('*');
    });

    it('folds a credentials allowlist into the origin list', () => {
      // The mistake this configuration invites most often: an origin trusted
      // with cookies left out of the list that decides whether it is allowed at
      // all.
      const { normalized } = collectCORSIssues({
        origin: ['https://app.example.com'],
        credentials: ['https://admin.example.com'],
      });

      expect(normalized.origin).toEqual([
        'https://app.example.com',
        'https://admin.example.com',
      ]);
    });

    it("leaves origin '*' alone beside a credentials allowlist", () => {
      // The two lists are separate on purpose: a broadly readable API, with
      // credentials for first-party origins only. Replacing the origin with the
      // credentials list collapsed those into one and removed the first half.
      for (const origin of ['*', ['*']]) {
        const { normalized } = collectCORSIssues({
          origin,
          credentials: ['https://example.com'],
        });

        expect(normalized.origin, JSON.stringify(origin)).toBe('*');
        expect(normalized.credentials).toEqual(['https://example.com']);
      }
    });

    it('collapses the array wildcard before any rule reads it', () => {
      // `['*']` and `'*'` are one policy, and every relational rule tests the
      // string. Collapsing afterwards let the array spelling past all of them,
      // including the guard against pairing a wildcard with unbounded
      // credentials.
      expect(collectCORSIssues({ origin: ['*'] }).normalized.origin).toBe('*');

      for (const origin of ['*', ['*']]) {
        expect(
          collectCORSIssues({ origin, credentials: true }).issues,
          JSON.stringify(origin),
        ).not.toEqual([]);
      }
    });

    it('does not append a credentials list to a wildcard origin', () => {
      // A wildcard token already allows them, and the origin rules refuse a
      // wildcard paired with anything but 'null', so appending produced a
      // normalized value nobody would have been allowed to write.
      expect(
        collectCORSIssues({
          origin: ['*', 'null'],
          credentials: ['https://example.com'],
        }).normalized.origin,
      ).toEqual(['*', 'null']);

      expect(
        collectCORSIssues({
          origin: ['https://*'],
          credentials: ['https://example.com'],
        }).normalized.origin,
      ).toEqual(['https://*']);

      // A subdomain pattern is not a blanket wildcard, so a credentialed origin
      // beside one still gets merged in, which is the mistake this exists for.
      expect(
        collectCORSIssues({
          origin: ['*.example.com'],
          credentials: ['https://app.example.com'],
        }).normalized.origin,
      ).toEqual(['*.example.com', 'https://app.example.com']);
    });

    it('fills in the defaults, with CORS off', () => {
      // `origin: false` is the default, so registering the plugin for `csp` or
      // `hsts` sends no CORS headers at all rather than echoing back whatever
      // origin asked. A wildcard has to be written.
      const { normalized } = collectCORSIssues(undefined);

      expect(normalized.origin).toBe(false);
      expect(normalized.credentials).toBe(false);
      expect(normalized.maxAge).toBe(86400);
    });

    it('treats cors: false as the defaults', () => {
      const { issues, normalized } = collectCORSIssues(false);

      expect(issues).toEqual([]);
      expect(normalized.origin).toBe(false);
    });

    it('hands cors: false back as itself, not as an empty block', () => {
      // An admin form rebuilding its fields from `policy` has to be able to
      // tell "the operator turned CORS off" from "nothing configured yet".
      // Flattening false to {} loses the only thing they said.
      const result = validateCORSPolicy(false);

      expect(result.valid).toBe(true);
      expect(result.valid && result.policy).toBe(false);
    });

    it('fills in a default for a field written as undefined', () => {
      // A key set to undefined reads as "not set" everywhere the config is
      // examined, so it has to mean that here too. Spread straight over the
      // defaults it meant the opposite: the key was copied and the default was
      // deleted, leaving fields the request path dereferences holding nothing.
      // `exposedHeaders: cfg.exposed` type-checks against an optional field and
      // is exactly how a config gets assembled from optional values.
      const optional: string[] | undefined = undefined;

      const { issues, normalized } = collectCORSIssues({
        origin: ['https://app.example.com'],
        methods: optional,
        allowedHeaders: optional,
        exposedHeaders: optional,
        maxAge: undefined,
      });

      expect(issues).toEqual([]);
      expect(normalized.methods).toEqual(DEFAULT_CORS_CONFIG.methods);
      expect(normalized.origin).toEqual(['https://app.example.com']);
      expect(normalized.allowedHeaders).toEqual(
        DEFAULT_CORS_CONFIG.allowedHeaders,
      );
      expect(normalized.exposedHeaders).toEqual([]);
      expect(normalized.maxAge).toBe(86400);
    });

    it('still names a misspelled key whose value is undefined', () => {
      // The other half of the rule above, and the reason inheriting is keyed on
      // "is there a default here" rather than on the value alone. `undefined`
      // means "inherit", and an unknown key has nothing to inherit, so dropping
      // it would not preserve anything. It would only delete the evidence, and
      // this is the exact shape a typo takes when a config is assembled from
      // optional values: `originList: process.env.CORS_ORIGINS?.split(',')` with the
      // variable unset would start clean on the default origin, with nothing
      // saying the key was never read.
      expect(paths({ origin: '*', originList: undefined })).toEqual([
        'originList',
      ]);
      expect(paths({ origin: '*', originList: ['https://a.example'] })).toEqual(
        ['originList'],
      );
    });
  });

  describe('agreement with the plugin', () => {
    /**
     * Whether `securityHeaders` accepts this CORS block at startup. The whole
     * promise of the validator is that its answer matches, so the two are asked
     * the same questions rather than trusted to have been written alike.
     */
    async function pluginAccepts(cors: CORSConfig): Promise<boolean> {
      try {
        await securityHeaders({ cors })(
          fastify() as unknown as PluginHostInstance,
          createMockOptions(),
        );

        return true;
      } catch {
        return false;
      }
    }

    const cases: { name: string; cors: CORSConfig }[] = [
      { name: 'a plain allowlist', cors: { origin: ['https://example.com'] } },
      { name: 'the wide-open default', cors: { origin: '*' } },
      {
        name: "credentials with origin '*'",
        cors: { origin: '*', credentials: true },
      },
      {
        name: 'a protocol wildcard with credentials',
        cors: { origin: 'https://*', credentials: true },
      },
      {
        name: 'the same, opted in',
        cors: {
          origin: 'https://*',
          credentials: true,
          allowCredentialsWithProtocolWildcard: true,
        },
      },
      {
        name: 'an empty credentials list under a wildcard origin',
        cors: { origin: '*', credentials: [] },
      },
      {
        name: "'null' in a credentials list",
        cors: { origin: ['https://example.com'], credentials: ['null'] },
      },
      {
        name: 'a subdomain wildcard in credentials',
        cors: { origin: ['*.example.com'], credentials: ['*.example.com'] },
      },
      {
        name: 'the same, opted in',
        cors: {
          origin: ['*.example.com'],
          credentials: ['*.example.com'],
          credentialsAllowWildcardSubdomains: true,
        },
      },
      {
        name: 'two wildcard tokens in an origin list',
        cors: { origin: ['https://*', 'http://*'] },
      },
      {
        name: "'*' buried in an origin list",
        cors: { origin: ['*', 'https://example.com'] },
      },
      { name: "'*' paired with 'null'", cors: { origin: ['*', 'null'] } },
      { name: 'a malformed origin', cors: { origin: 'not a host' } },
      {
        name: 'a dynamic credentials function under a wildcard',
        cors: { origin: '*', credentials: () => true },
      },
      {
        name: 'a malformed allowedHeaders name',
        cors: {
          origin: ['https://example.com'],
          allowedHeaders: ['Content Type'],
        },
      },
      {
        name: 'the allowedHeaders wildcard beside a named header',
        cors: {
          origin: ['https://example.com'],
          allowedHeaders: ['*', 'X-Thing'],
        },
      },
      {
        name: 'a bare allowedHeaders wildcard',
        cors: { origin: ['https://example.com'], allowedHeaders: ['*'] },
      },
      {
        name: 'an empty allowedHeaders list',
        cors: { origin: ['https://example.com'], allowedHeaders: [] },
      },
      {
        name: 'a malformed method name',
        cors: { origin: ['https://example.com'], methods: ['GET POST'] },
      },
      {
        name: 'a malformed exposedHeaders name',
        cors: {
          origin: ['https://example.com'],
          exposedHeaders: ['X Total Count'],
        },
      },
      {
        name: 'a wildcard in methods and exposedHeaders',
        cors: {
          origin: ['https://example.com'],
          methods: ['*'],
          exposedHeaders: ['*'],
        },
      },
    ];

    for (const { name, cors } of cases) {
      it(`agrees with the plugin on ${name}`, async () => {
        const wasAccepted = await pluginAccepts(cors);

        expect(validateCORSPolicy(cors).valid).toBe(wasAccepted);
      });
    }

    it('keeps the error class the plugin has always thrown', () => {
      // Which class a startup failure throws is something a caller may be
      // catching on, so the collector records it rather than flattening every
      // rule to a plain Error.
      expect(() =>
        securityHeaders({ cors: { origin: '*', credentials: () => true } }),
      ).toThrow(TypeError);

      let thrown: unknown;

      try {
        securityHeaders({ cors: { origin: '*', credentials: true } });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(Error);
      expect(thrown).not.toBeInstanceOf(TypeError);
    });
  });
});
