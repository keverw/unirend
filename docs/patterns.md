# Patterns

Recurring architectural patterns for Unirend applications.

<!-- toc -->

- [Resilient Write Queue](#resilient-write-queue)
- [Dark Mode with Cookie Persistence](#dark-mode-with-cookie-persistence)

<!-- tocstop -->

## Resilient Write Queue

When writing to an external store (database, analytics service, etc.) from a log sink or access log handler, network issues or downtime can silently drop data. A resilient write queue keeps data safe by falling back to a local queue and retrying in the background.

**How it works:**

1. Attempt the write to the primary store.
2. On failure, append the payload to a local queue (SQLite is a good fit, flat JSON files also work for low volume).
3. A background timer (`setInterval`, registered in a plugin or your main server script) periodically reads the queue and retries failed entries.
4. On successful retry, remove the entry from the queue.

**Pseudocode sketch:**

```
// Custom Lifecycleion sink

onLog(entry):
  try:
    writeToDatabase(entry)
  catch:
    appendToLocalQueue(entry)  // SQLite or flat JSON file

// Server setup (plugin or main script)

onSetup():
  retryTimer = setInterval(() => {
    entries = readLocalQueue()

    for entry in entries:
      try:
        writeToDatabase(entry)
        removeFromQueue(entry)
      catch:
        // leave in queue, try again next tick
  }, retryIntervalMs)

  // Save retryTimer so you can clearInterval(retryTimer) on shutdown
```

This pattern applies anywhere you can't afford to lose data on write failure — access logs, audit trails, analytics events, etc. For Lifecycleion logger adaptor users, the natural place to implement this is a custom sink.

## Dark Mode with Cookie Persistence

Store the user's theme preference in a cookie so it's available server-side on the first render — avoiding a flash of the wrong theme. A server plugin reads the cookie in an `onRequest` hook and sets it on the request context, so SSR components can render the correct theme class immediately. The client keeps the cookie in sync as the user changes their preference.

See [Theme Management (Hydration-Safe)](./unirend-context.md#theme-management-hydration-safe) in the context docs for a full walkthrough including the plugin, SSR component, and client-side cookie update.
