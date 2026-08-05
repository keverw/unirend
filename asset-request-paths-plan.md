# Asset request paths plan

Two pieces of work for their own branch, kept out of `security-headers-plan.md` so they survive that file being deleted when its branch merges.

Both come from the same observation, reached from opposite directions while fixing a static content access-control bug: **some requests should not get full-application treatment.** A favicon should not open a database session, and a missing `.js` should not render a branded 404 page through the SSR pipeline.

They are separable but land better together, since anyone reading one will ask about the other.

## Background: what was rejected, and why

An earlier attempt inferred all of this from the static content mappings. Static handling was split into a match phase before user plugins and a serve phase after, with the match setting a `request.staticContentMatched` flag that plugins could read to skip work.

It was dropped. Three problems, all of which the design below avoids:

- **It could not be uniform.** On a multi-app SSR server the cache that serves is chosen by `request.activeSSRApp`, which a user plugin sets, so matching before user plugins did not know which app's mappings to consult. A unanimity rule (mark it only when every app's mappings resolve the URL) works but is subtle, and a request property that exists on one server type and not another is a smell.
- **Matching was mappings, not existence**, deliberately, since checking existence is the I/O the early phase existed to avoid. So a mapped-but-missing file got marked and then was not served, and on SSR that falls through to page rendering without whatever the plugin skipped.
- **It guessed.** Whether a path is worth authenticating is the app's call, not something to infer from whether a file happens to be mapped.

The fix that shipped instead was one line: `StaticWebServer` registers static serving after `options.plugins` rather than before, matching what the SSR server always did. That closed the bypass and added no API. What it did not do is make asset requests cheap, which is what the first item below is for.

## URL Patterns That Plugins May Skip

The real want behind the rejected flag, stated directly instead of inferred: a favicon should not open a database session.

The mechanism should be **URL patterns declared at the server**, not anything derived from the static caches. That is the part that makes it work where the flag could not:

- **App-independent.** A pattern is matched against the request URL, so nothing has to consult per-app static config, and nothing has to be reconciled across a multi-app server. Two apps can overlap on `/favicon.ico` without either one being consulted. The unanimity rule the rejected flag needed simply does not arise.
- **Existence-independent.** A pattern says "this URL is not worth authenticating", which stays true whether or not a file is on disk. No mapped-but-missing edge, no `updateConfig()` race.
- **Uniform.** Identical behavior on `APIServer`, `SSRServer`, and `StaticWebServer`, because none of them need to know anything the others do not.
- **Explicit.** The app declares which paths are cheap. The framework does not guess from whether a file happens to be mapped, which was the original mistake.

Rough shape: a server-level list of URL patterns, exposed to plugins as a boolean on the request or a helper they call. `['/favicon.ico', '/robots.txt', '/assets/*']` covers most of it.

- [ ] Decide the pattern syntax. Prefix and glob probably suffice; check whether an existing matcher in the codebase already covers it rather than adding a third pattern dialect.
- [ ] Decide the surface: a config list plus a request boolean, or a helper a plugin calls with its own criteria
- [ ] Decide whether unirend acts on it at all or only publishes it. Publishing only is safer, since which plugins are skippable is the app's call, not the framework's.
- [ ] Must not become a way to skip security checks by accident. Domain validation is cheap string matching and should always run; this is aimed at session and database work.
- [ ] Name it for what it means to the app, not for static content. It has nothing to do with static content, which is the whole point.

## A Static Asset 404 Handler

Independent of the above and worth doing on its own merits.

Today a mapped-but-missing static path on SSR falls through to the catch-all route and renders the full application 404, chrome and all. For a missing `.js` or `.png` that is wrong twice over: the response body is an HTML page for a request that wanted a script, and a full SSR render is burned on a broken asset request.

Direct URL access to an asset is rare but real, an image someone linked to directly or a stale link, so the answer is not a bare status line. Mirror what already exists for the 500 page: a default unirend provides, overridable per app, with an example in the starter templates. Branded enough not to look broken, light enough to cost nothing.

- [ ] Serve a dedicated static 404 for a URL that matched static mappings but resolved to no file, rather than falling through to page rendering
- [ ] Default provided by unirend, following `get500ErrorPage`'s shape for consistency
- [ ] Starter template example, since the whole point is that an app can brand it
- [ ] Decide the boundary: only paths that matched a static mapping, so an ordinary unknown route still renders the real application 404
- [ ] Changelog: behavior change. A missing asset stops returning the full app 404 page.
