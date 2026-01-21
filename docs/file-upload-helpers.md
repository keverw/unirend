# File Upload Helpers

Unirend provides a unified API for handling multipart uploads with streaming limits, cleanup hooks, and consistent error responses.

<!-- toc -->

- [What you get](#what-you-get)
- [Quickstart](#quickstart)
- [Common recipes](#common-recipes)
  - [Single file upload](#single-file-upload)
  - [Multiple files (batch)](#multiple-files-batch)
  - [Cleanup on abort](#cleanup-on-abort)
  - [Post-processing with `onComplete`](#post-processing-with-oncomplete)
  - [Early validation (reject before parsing multipart)](#early-validation-reject-before-parsing-multipart)
  - [Custom MIME type validation with validator function](#custom-mime-type-validation-with-validator-function)
  - [Production: tracking uploads in a database](#production-tracking-uploads-in-a-database)
    - [Background processing (video, thumbnails, OCR, etc.)](#background-processing-video-thumbnails-ocr-etc)
- [Errors and abort reasons](#errors-and-abort-reasons)
  - [Abort reasons](#abort-reasons)
  - [Timeout and Abort Handling](#timeout-and-abort-handling)
    - [How Timeouts Work](#how-timeouts-work)
    - [Stream Destruction and Processor Interruption](#stream-destruction-and-processor-interruption)
    - [Connection Break Detection](#connection-break-detection)
    - [Manual Abort Checks](#manual-abort-checks)
  - [Common HTTP statuses / error codes](#common-http-statuses--error-codes)
- [Implementation details](#implementation-details)
  - [Cleanup handler execution guarantees](#cleanup-handler-execution-guarantees)
  - [Iterator drain timeout protection](#iterator-drain-timeout-protection)
- [API reference](#api-reference)
  - [`FileUploadHelpers.processUpload(config)`](#fileuploadhelpersprocessuploadconfig)
- [Server configuration](#server-configuration)
- [Testing](#testing)
- [Security notes](#security-notes)
  - [Image upload workflow (common pattern)](#image-upload-workflow-common-pattern)
- [Plugins / raw Fastify routes](#plugins--raw-fastify-routes)

<!-- tocstop -->

## What you get

- **Unified API**: one entry point: `FileUploadHelpers.processUpload()`
- **Early MIME validation**: MIME types validated **before** consuming streams (prevents bandwidth waste / DoS attacks)
- **Streaming processing**: files processed during iteration, one at a time (no memory buffering of multiple files)
- **Automatic cleanup**: `context.onCleanup()` handlers execute automatically on abort (after processor completes to avoid race conditions)
- **Fail-fast batch behavior**: first failure aborts the whole batch and runs all registered cleanup handlers
- **Consistent errors**: `server.api.*` handlers return API envelopes (success or error), so failures can just `return result.errorEnvelope`. On success, use `result.files` to build whatever success payload your endpoint needs.

## Quickstart

> **Security note:** Never trust client-provided MIME types or filenames. See [Security notes](#security-notes).

1. **Enable uploads in server config** (see [Server configuration](#server-configuration)).

2. **Create an API upload route** and call `processUpload()`:

```ts
import { FileUploadHelpers } from 'unirend/server';
import { APIResponseHelpers } from 'unirend/api-envelope';

server.api.post('upload/avatar', async (request, reply) => {
  const result = await FileUploadHelpers.processUpload({
    request,
    reply,
    maxSizePerFile: 5 * 1024 * 1024, // 5MB
    allowedMimeTypes: ['image/*'], // supports wildcards, exact types, or a validator function
    processor: async (fileStream, metadata, context) => {
      // Store the stream somewhere (disk, object storage, etc) and return app data.
      // IMPORTANT: you must consume the stream (e.g. pipeline()).
      return { filename: metadata.filename };
    },
  });

  if (!result.success) return result.errorEnvelope;

  return APIResponseHelpers.createAPISuccessResponse({
    request,
    statusCode: 200,
    data: { file: result.files[0].data },
  });
});
```

## Common recipes

### Single file upload

Smallest “real” disk example:

```ts
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { FileUploadHelpers } from 'unirend/server';
import { APIResponseHelpers } from 'unirend/api-envelope';

server.api.post('upload/avatar', async (request, reply) => {
  const result = await FileUploadHelpers.processUpload({
    request,
    reply,
    maxSizePerFile: 5 * 1024 * 1024,
    allowedMimeTypes: ['image/*'],
    processor: async (fileStream, metadata, context) => {
      await mkdir('./uploads', { recursive: true });
      // Real systems: generate your own collision-resistant ID (uuid/nanoid/cuid2/etc)
      // and avoid using the client filename as a path without sanitizing it.
      const path = `./uploads/${randomUUID()}-${metadata.filename}`;

      context.onCleanup(async () => {
        try {
          await unlink(path);
        } catch {
          // file might not exist yet
        }
      });

      await pipeline(fileStream, createWriteStream(path));
      return { path };
    },
  });

  if (!result.success) return result.errorEnvelope;

  return APIResponseHelpers.createAPISuccessResponse({
    request,
    statusCode: 200,
    data: { file: result.files[0].data },
  });
});
```

### Multiple files (batch)

Batch uploads are **sequential** and **fail-fast**. The first failure aborts the rest and runs all registered abort cleanups.

```ts
server.api.post('upload/gallery', async (request, reply) => {
  const result = await FileUploadHelpers.processUpload({
    request,
    reply,
    maxFiles: 10,
    maxSizePerFile: 5 * 1024 * 1024,
    allowedMimeTypes: ['image/*'],
    processor: async (fileStream, metadata, context) => {
      // context.fileIndex increments per file (0, 1, 2, ...)
      return { index: context.fileIndex, filename: metadata.filename };
    },
  });

  if (!result.success) return result.errorEnvelope;

  return APIResponseHelpers.createAPISuccessResponse({
    request,
    statusCode: 200,
    data: { files: result.files.map((f) => f.data) },
  });
});
```

### Cleanup on abort

Use `context.onCleanup(fn)` inside the processor to register per-file cleanup. Cleanup handlers run automatically when uploads fail, including **when your processor throws an error** (pipe breaks, storage failures, etc.).

**When cleanup handlers execute:**

- Registered via `context.onCleanup()` inside your processor function
- Execute automatically when upload fails for ANY reason:
  - **Processor throws an error** (storage failure, pipe break, stream errors)
  - File exceeds size limit during streaming
  - MIME type validation fails
  - Connection broken or timeout
  - Batch upload: any file fails (fail-fast)
- Always run **after** the processor that registered them completes (or is interrupted)
- This prevents race conditions (cleanup won't delete resources the processor is still creating/uploading)
- **Called for side effects only** — any return value is ignored by the framework

**Cleanup timing guarantees (race condition prevention):**

In batch uploads, cleanup handlers run **immediately** when a file's processing phase ends with a failure or abort detection. This prevents cleanup delays that could occur in the following scenario:

1. File N's processor is running
2. Timeout/connection break occurs during processor execution
3. File N's processor completes successfully (it already read all needed data)
4. **Abort check runs immediately after processor completes**
5. File N's cleanup runs **immediately** (before file N+1 starts)
6. All previously-successful files (0 through N-1) have their cleanup run when the batch error is returned

This guarantees that:

- Cleanup for a failed file runs immediately (not delayed until the batch completes)
- Cleanup for all previously-successful files runs when the batch fails
- No cleanup handler runs twice
- Resources are released as early as possible

```ts
processor: async (fileStream, metadata, context) => {
  const tempPath = `./uploads/tmp/${context.fileIndex}-${metadata.filename}`;

  // Cleanup runs when upload fails for ANY reason (including if this processor throws!)
  context.onCleanup(async (reason, details) => {
    // reason: 'processor_error' | 'size_exceeded' | 'mime_type_rejected' | 'timeout' | 'connection_broken' | 'batch_file_failed' | 'files_limit_exceeded' | 'no_files_provided'
    // details: contextual metadata (fileIndex, filename, error message, etc.)
    await safeDelete(tempPath);
  });

  // If writeSomewhere throws (storage failure, network error, etc.),
  // the cleanup handler above WILL run after this processor completes
  await writeSomewhere(fileStream, tempPath);
  return { tempPath };
};
```

### Post-processing with `onComplete`

Use `onComplete` when you need to do a **single** step after all files finish (success or failure), e.g. move temp files into a final location, commit a transaction, or remove a temp directory.

**Timing guarantees:**

1. **Success case**: `onComplete` runs after all files are processed successfully (no cleanup handlers have run)
2. **Failure case**: `onComplete` runs **AFTER** all cleanup handlers have completed
   - Cleanup handlers registered via `context.onCleanup()` run first
   - Then `onComplete` runs with the error result
   - This ensures `onComplete` has a consistent view of the system state

**Error handling:**

- If `onComplete` throws **after success**, the client gets a `file_upload_completion_failed` error
- If `onComplete` throws **after failure**, the original upload error is returned (onComplete failure is logged only)

```ts
const result = await FileUploadHelpers.processUpload({
  request,
  reply,
  maxFiles: 5,
  maxSizePerFile: 10 * 1024 * 1024,
  allowedMimeTypes: ['application/pdf', 'image/*'],
  processor: async (fileStream, metadata, context) => {
    // Upload to temp storage
    const tempPath = `/tmp/${metadata.filename}`;

    // Register per-file cleanup (runs BEFORE onComplete in error cases)
    context.onCleanup(async () => {
      await fs.unlink(tempPath);
    });

    await writeToTemp(fileStream, tempPath);
    return { tempPath };
  },
  onComplete: async (finalResult) => {
    if (finalResult.success) {
      // All files uploaded successfully - finalize them
      // (move temp → final, commit transaction, etc.)
      for (const file of finalResult.files) {
        await moveToFinal(file.data.tempPath);
      }
    } else {
      // Upload failed - per-file cleanups have ALREADY run
      // You only need to clean up shared resources here (if any)
      await cleanupSharedResources();
    }
  },
});
```

### Early validation (reject before parsing multipart)

You can reject requests _before_ multipart parsing to save bandwidth and work. Use `fileUploads.allowedRoutes` + `fileUploads.earlyValidation` in server config.

`earlyValidation` supports both **synchronous** and **asynchronous** validation functions:

```ts
const server = serveSSRDev(paths, {
  fileUploads: {
    enabled: true,
    allowedRoutes: ['/api/upload/*'],
    // Async validation (use when you need to check databases, external services, etc.)
    earlyValidation: async (request) => {
      // lightweight checks only (headers, auth context, quotas, rate limits, etc)
      // this runs after your plugins/hooks, so you can read things like request.user

      // Return true to allow the request
      if (isAuthorized(request)) {
        return true;
      }

      // Return rejection object to deny (framework wraps this in a proper API envelope)
      return {
        statusCode: 401,
        error: 'unauthorized',
        message: 'Authentication required for file uploads',
      };
    },
    // Or use sync validation for simple header checks:
    // earlyValidation: (request) => {
    //   if (!request.headers['x-api-key']) {
    //     return { statusCode: 403, error: 'forbidden', message: 'API key required' };
    //   }
    //   return true;
    // },
  },
});
```

**Note:** Both `allowedRoutes` rejections and `earlyValidation` rejections are automatically wrapped in proper API envelopes (with `status`, `status_code`, `request_id`, etc.) using your server's `APIResponseHelpersClass` if provided, or the default `APIResponseHelpers`.

### Custom MIME type validation with validator function

Use a validator function when you need custom rules and/or a custom rejection reason:

```ts
allowedMimeTypes: (mime) => {
  if (mime.startsWith('image/')) return { allowed: true };
  return {
    allowed: false,
    rejectionReason: 'Only images are allowed for this endpoint',
    allowedTypes: ['image/*'],
  };
};
```

### Production: tracking uploads in a database

This is commonly called a **staging upload** (or **temp-then-finalize**) pattern.

If you want “automatic” consistency, treat uploads like a state machine:

- **Before streaming**: create a DB row per file with `status='pending'` and a generated ID/path/key.
- **On abort** (`context.onCleanup`): mark the row `status='failed'` and cleanup the partial object (runs automatically after processor completes or is interrupted - including when processor throws errors).
- **On success**: finalize (move temp → final / commit transaction) and mark `status='complete'`.
- **Cleanup job**: periodically delete/expire old `pending` uploads and reconcile DB vs storage (e.g. file moved but DB not updated).

This keeps storage and your DB in sync and makes retries/cleanup straightforward.

#### Background processing (video, thumbnails, OCR, etc.)

For heavy work (video transcoding into multiple resolutions, thumbnail generation, OCR, malware scanning), prefer:

- **Request path**: stream to storage + do lightweight validation + enqueue a job
- **Async worker**: do CPU/IO heavy processing and update DB status/progress

This keeps upload latency predictable and avoids tying up server request threads.

Minimal sketch:

```ts
const result = await FileUploadHelpers.processUpload({
  request,
  reply,
  maxSizePerFile: 10 * 1024 * 1024,
  allowedMimeTypes: ['image/*'],
  processor: async (stream, metadata, context) => {
    const id = generateId(); // uuid/nanoid/cuid2/etc
    await db.uploads.insert({
      id,
      filename: metadata.filename,
      status: 'pending',
      createdAt: new Date(),
    });

    // Cleanup runs automatically if processor throws or upload fails for any reason
    context.onCleanup(async () =>
      db.uploads.update(id, { status: 'failed', failedAt: new Date() }),
    );

    await writeToTempStorage(stream, id);
    return { id };
  },
  onComplete: async (finalResult) => {
    if (!finalResult.success) return;
    for (const f of finalResult.files) {
      // Typical pattern: finalize storage first (e.g. temp → final), then mark complete.
      await moveFromTempToFinalStorage(f.data.id);
      await db.uploads.update(f.data.id, {
        status: 'complete',
        completedAt: new Date(),
      });
    }
  },
});
```

**Cleanup job pattern:** periodically delete/expire `status='pending'` uploads older than 24–48 hours (these usually indicate failed uploads that weren’t cleaned up, e.g. due to process crashes).

## Errors and abort reasons

On failure, `processUpload()` returns `{ success: false, errorEnvelope }`. In `server.api.*` routes you typically just `return result.errorEnvelope;`.

### Abort reasons

`AbortReason` is a string union (e.g. `'size_exceeded'`, `'mime_type_rejected'`, `'connection_broken'`, `'timeout'`, `'batch_file_failed'`, `'processor_error'`, `'files_limit_exceeded'`).

### Timeout and Abort Handling

When `timeoutMS` is specified, the upload will abort if the total time exceeds the limit. The framework automatically handles interruption via stream destruction.

#### How Timeouts Work

1. **Timeout fires** → timers cleared, `state.aborted = true`
2. **Current file stream destroyed** → processor receives stream error (interrupts processor!)
3. **Abort detected** and cleanup handlers called
4. **Returns timeout error** (HTTP 408)

**File processing model:**

- Files are **NOT** collected into an array or buffered in memory
- Each file is processed **during iteration** (one at a time)
- MIME validation happens **before** stream consumption (prevents bandwidth waste)
- Stream flows: network → multipart parser → **byte counter** → processor
  - The byte counter is a lightweight Transform stream that tracks bytes read
  - It uses minimal chunk-by-chunk buffering (not full-file buffering)
  - This enables accurate byte counting for truncation detection
- If timeout fires, stream is destroyed and processor is interrupted

#### Stream Destruction and Processor Interruption

When timeout or connection break occurs, the current file's stream is **destroyed immediately**. This interrupts your processor by causing a stream error (e.g., `pipeline` throws), which triggers cleanup automatically.

**Automatic interruption example:**

```typescript
processor: async (fileStream, metadata, context) => {
  const uploadID = generateId();

  // Register cleanup - runs automatically when upload fails
  context.onCleanup(async () => {
    await deleteFromStorage(uploadID);
  });

  // Stream is automatically destroyed on timeout/connection break
  // Your pipeline/pipe will receive an error and throw
  await uploadToStorage(fileStream, uploadID);

  return { uploadID };
};
```

**How it works:**

- ✅ Timeout fires → stream destroyed → processor throws error → cleanup runs
- ✅ No manual `isAborted()` checks needed (unless you want early bailout before stream processing)

**Handling stream errors explicitly:**

```typescript
processor: async (fileStream, metadata, context) => {
  const uploadID = generateId();
  context.onCleanup(async () => await deleteFromStorage(uploadID));

  try {
    // If timeout fires mid-upload, stream.destroy() is called
    // → pipeline/pipe throws error (e.g., ERR_STREAM_PREMATURE_CLOSE)
    await pipeline(fileStream, createUploadStream(uploadID));
    return { uploadID };
  } catch (streamError) {
    // Stream destroyed by timeout/connection break
    // Error propagates → cleanup runs automatically
    throw streamError;
  }
};
```

#### Connection Break Detection

The framework monitors for client disconnections to prevent wasted processing:

- Polled every 100ms via `reply.raw.destroyed`
- Destroys current file stream (same as timeout)
- Timers cleared immediately
- Triggers same interruption flow as timeouts

#### Manual Abort Checks

For most cases, automatic stream destruction is sufficient. However, if you need finer-grained control (e.g., early bailout before stream processing, or custom chunk-by-chunk processing), use `context.isAborted()`.

**Early bailout before stream processing:**

```typescript
processor: async (fileStream, metadata, context) => {
  if (context.isAborted()) throw new Error('Aborted'); // Stop before starting
  await uploadToStorage(fileStream, uploadID);
  return { uploadID };
};
```

**Custom stream processing with abort checks:**

For checksums, transformation, or validation that processes chunks manually:

```typescript
processor: async (fileStream, metadata, context) => {
  const uploadID = generateId();
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  context.onCleanup(async () => {
    await deleteFromStorage(uploadID);
  });

  // Process stream chunk by chunk
  for await (const chunk of fileStream) {
    // Check if aborted before processing this chunk
    if (context.isAborted()) {
      throw new Error('Upload aborted');
    }

    totalBytes += chunk.length;
    chunks.push(chunk);

    // Example: compute hash, validate content, etc.
    // Each iteration checks for abort, allowing early bailout
  }

  // Save processed data
  const buffer = Buffer.concat(chunks);
  await saveToStorage(uploadID, buffer);

  return { uploadID, size: totalBytes };
};
```

This allows interrupting **between chunks** rather than waiting for stream destruction error.

### Common HTTP statuses / error codes

This is the “at a glance” mapping clients usually care about:

| Scenario                          | Typical HTTP | Typical `error.code`            |
| --------------------------------- | -----------: | ------------------------------- |
| File too large                    |          413 | `file_too_large`                |
| Too many files                    |          413 | `file_max_files_exceeded`       |
| MIME/type rejected                |          415 | `file_type_not_allowed`         |
| Invalid content type              |          415 | `invalid_content_type`          |
| Client disconnected               |          499 | `file_upload_connection_broken` |
| Timeout                           |          408 | `file_upload_timeout`           |
| Processor threw                   |          500 | `file_processor_error`          |
| Batch aborted due to one failure  |          400 | `file_batch_upload_failed`      |
| Nothing uploaded                  |          400 | `file_not_provided`             |
| Unexpected upload failure         |          500 | `file_upload_failed`            |
| `onComplete` failed after success |          500 | `file_upload_completion_failed` |

**Note:** Errors are returned as full API envelopes (`status`, `status_code`, `request_id`, `error`, etc.). See [API envelope structure](./api-envelope-structure.md) for the full shape.

## Implementation details

### Cleanup handler execution guarantees

Cleanup handlers registered via `context.onCleanup()` are guaranteed to execute in all error scenarios, including:

1. **Processor throws error**: Cleanup runs immediately for that file, then for all previously-successful files
   - Abort reason: `'processor_error'` or `'batch_file_failed'`
2. **File size exceeded**: Cleanup runs immediately for that file, then for all previously-successful files
   - Abort reason: `'size_exceeded'` or `'batch_file_failed'`
3. **MIME type rejected**: Stream destroyed, cleanup runs for all previously-processed files
   - Abort reason: `'mime_type_rejected'` or `'batch_file_failed'`
4. **Timeout during upload**: Current stream destroyed, cleanup runs for all processed files
   - Abort reason: `'timeout'`
5. **Connection broken**: Current stream destroyed, cleanup runs for all processed files
   - Abort reason: `'connection_broken'`
6. **Too many files (FilesLimitError)**: Cleanup runs for all processed files
   - Abort reason: `'files_limit_exceeded'`
7. **No files provided**: Defensive cleanup check (should be empty, but ensures consistency)
   - Abort reason: `'no_files_provided'`

**Early return paths** (where no files are processed):

- Invalid Content-Type: No processors run → no cleanup handlers can exist
- No files provided: Defensive cleanup check runs with `'no_files_provided'` reason (cleanup handlers array should be empty since no processors ran, but checked for defensive programming)

This defensive programming ensures that future code changes won't accidentally skip cleanup.

### Iterator drain timeout protection

When aborting mid-upload (timeout, MIME rejection, etc.), the implementation attempts to drain remaining files from the multipart iterator to prevent resource leaks. However, this drain operation itself could hang if the iterator is blocked waiting for network data.

**Protection mechanism:**

- Iterator drain uses `Promise.race` with a 1-second timeout
- If drain completes within 1 second, all remaining streams are destroyed cleanly
- If drain times out, the drain is aborted and execution continues
- Timeout failures are logged as warnings but don't affect error response

This prevents the server from hanging indefinitely on slow/stalled connections while still attempting best-effort cleanup of remaining streams.

## API reference

### `FileUploadHelpers.processUpload(config)`

Key config fields:

- **`request`**: Fastify request
- **`reply`**: Fastify reply (or controlled reply)
- **`maxFiles`**: defaults to `1`
- **`maxSizePerFile`**: bytes
- **`allowedMimeTypes`**: `string[]` supporting wildcards (e.g. `image/*`) or a validator function
- **`timeoutMS`**: optional upload timeout
- **`processor(fileStream, metadata, context)`**: per-file handler (must consume stream)
  - `fileStream`: Readable stream of file data
  - `metadata`: `{ filename, mimetype, encoding, fieldname, fileIndex }`
  - `context`: `{ fileIndex, onCleanup, isAborted }`
    - `onCleanup(cleanupFn)`: Register cleanup handler that runs when upload fails (including processor errors, size exceeded, MIME rejected, timeout, connection broken, batch failures)
    - `isAborted()`: Check if upload aborted (timeout, connection broken, etc.)
- **`onComplete(finalResult)`**: optional post-processing hook (runs once)

Return type:

- **Success**: `{ success: true; files: Array<{ fileIndex; filename; data }> }`
- **Failure**: `{ success: false; errorEnvelope }` (ready to return)

For the authoritative types/behavior, see the implementation in `src/lib/server/file-upload-helpers.ts`.

## Server configuration

Enable multipart uploads in your server:

```ts
const server = serveSSRDev(paths, {
  fileUploads: {
    enabled: true,
    limits: {
      fileSize: 10 * 1024 * 1024, // global default per file
      files: 10, // global default max files
      fields: 10,
      fieldSize: 1024,
    },
    // recommended: restrict which routes accept multipart
    allowedRoutes: ['/api/upload/*'],
    // optional: early validation before multipart parsing (saves bandwidth)
    earlyValidation: async (request) => {
      // Run lightweight checks (auth, rate limits, etc.)
      // Return true to allow, or { statusCode, error, message } to reject
      return true;
    },
  },
});
```

Notes:

- `processUpload()` can override global defaults per route:
  - `maxSizePerFile` (overrides `limits.fileSize`)
  - `maxFiles` (overrides `limits.files`)
  - `maxFields` (overrides `limits.fields`)
  - `maxFieldSize` (overrides `limits.fieldSize`)
  - `timeoutMS` (per-route upload timeout)
- Prefer `allowedRoutes` to reduce accidental multipart parsing on non-upload endpoints.
- `earlyValidation` runs after user plugins/hooks but before multipart parsing, allowing you to reject requests early based on headers, auth state, rate limits, etc.

## Testing

```bash
# single file
curl -X POST http://localhost:3000/api/upload/avatar \
  -F "file=@photo.jpg"

# multiple files (same field name repeated)
curl -X POST http://localhost:3000/api/upload/gallery \
  -F "file=@photo1.jpg" \
  -F "file=@photo2.jpg"
```

## Security notes

- **Early MIME validation prevents bandwidth DoS**: MIME types are validated **before** consuming file streams. This means an attacker can't upload 5GB of valid files followed by an invalid file to waste your bandwidth - the invalid file is rejected immediately without downloading.
- **Do not trust client MIME type / filename**: consider validating via magic bytes after writing to temp storage.
- **Limit sizes and counts**: set `maxSizePerFile`/`maxFiles` and consider rate limiting to reduce abuse/DoS risk.
- **Scan if needed**: for untrusted uploads, consider virus/malware scanning as part of your ingestion pipeline.
- **Store outside web root**: don’t directly serve uploaded files from the upload directory.
- **Generate your own filenames/IDs**: avoid path traversal and collisions; don’t use the client filename as a path.
- **Harden permissions**: ensure uploaded files are not executable and are stored with restrictive permissions.
- **Isolate storage**: consider separate buckets/prefixes/domains for user uploads vs application assets.

### Image upload workflow (common pattern)

For image uploads, it’s common to store the original file and enqueue background work to generate derived versions (thumbnails, multiple resolutions, format conversion/optimization) for efficient delivery.

## Plugins / raw Fastify routes

If you need to use file upload helpers in custom Fastify routes (non-envelope API routes), see the [File Upload Helpers section in the Server Plugins documentation](./server-plugins.md#file-upload-helpers). That section explains how to handle the envelope-to-Fastify conversion when using `FileUploadHelpers.processUpload()` with raw `pluginHost.post()` routes.
