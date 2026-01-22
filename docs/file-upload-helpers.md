# File Upload Helpers

Unirend provides a unified API for handling multipart uploads with streaming limits, cleanup hooks, and consistent error responses.

<!-- toc -->

- [What you get](#what-you-get)
- [Quickstart](#quickstart)
- [Server configuration](#server-configuration)
- [Using processFileUpload()](#using-processfileupload)
  - [Configuration options](#configuration-options)
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
  - [Timeout and connection handling](#timeout-and-connection-handling)
  - [Common HTTP statuses / error codes](#common-http-statuses--error-codes)
- [Testing](#testing)
- [Security notes](#security-notes)
  - [Image upload workflow (common pattern)](#image-upload-workflow-common-pattern)
- [Plugins / raw Fastify routes](#plugins--raw-fastify-routes)

<!-- tocstop -->

## What you get

- **Early MIME validation**: MIME types validated **before** consuming streams (prevents bandwidth waste / DoS attacks)
- **Streaming processing**: files processed one at a time (no memory buffering of multiple files)
- **Automatic cleanup**: `context.onCleanup()` handlers execute automatically on abort (after processor completes to avoid race conditions)
- **Fail-fast batch behavior**: first failure aborts the whole batch and runs all registered cleanup handlers
- **Consistent error handling**: check `result.success` — if false, just `return result.errorEnvelope`. If true, use `result.files` to build your response

## Quickstart

> **Security note:** Never trust client-provided MIME types or filenames. See [Security notes](#security-notes).

**1. Enable file uploads in your server:**

Works with both SSR servers (`serveSSRDev`/`serveSSRProd`) and standalone API servers (`serveAPI`):

```ts
import { serveSSRDev } from 'unirend/server';

const server = serveSSRDev(paths, {
  fileUploads: {
    enabled: true,
    allowedRoutes: ['/api/v1/upload/*'], // Pre-validation (prevents DoS)
  },
});

// Or with standalone API server (same config pattern):
// import { serveAPI } from 'unirend/server';
// const api = serveAPI({ fileUploads: { enabled: true, allowedRoutes: [...] } });
```

**2. Create an upload route:**

```ts
import { processFileUpload } from 'unirend/server';
import { APIResponseHelpers } from 'unirend/api-envelope';

server.api.post('upload/avatar', async (request, reply) => {
  const result = await processFileUpload({
    request,
    reply,
    maxSizePerFile: 5 * 1024 * 1024, // 5MB
    allowedMimeTypes: ['image/*'],
    processor: async (fileStream, metadata, context) => {
      // Store the stream (disk, object storage, etc) and return your app data
      // You MUST consume the stream (e.g. via pipeline())
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

For detailed configuration and examples, see [Server configuration](#server-configuration) and [Using processFileUpload()](#using-processfileupload).

## Server configuration

Enable multipart uploads in your server (works with both SSR and standalone API servers):

```ts
import { serveSSRDev } from 'unirend/server';
// Or: import { serveAPI } from 'unirend/server';

const server = serveSSRDev(paths, {
  apiEndpoints: {
    apiEndpointPrefix: '/api',
    versioned: true, // DEFAULT! Routes will be under /api/v1/, /api/v2/, etc.
    pageDataEndpoint: 'page_data',
  },
  fileUploads: {
    enabled: true,
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB default - max bytes per file
      files: 10, // default - max files per request
      fields: 10, // default - max non-file form fields
      fieldSize: 1024, // 1KB default - max bytes per non-file field value
    },
    // IMPORTANT: versioned defaults to TRUE, so routes are under /api/v{n}/...
    // Therefore allowedRoutes MUST include the version prefix!
    allowedRoutes: [
      '/api/v1/upload/avatar',
      '/api/v1/upload/document',
      '/api/v1/upload/*', // or use wildcards
    ],
    // Only if you explicitly set versioned: false, use unversioned paths:
    // allowedRoutes: ['/api/upload/*'],
    // optional: pre-validation before multipart parsing (saves bandwidth)
    preValidation: async (request) => {
      // Run lightweight checks (auth, rate limits, etc.)
      // Return true to allow, or { statusCode, error, message } to reject
      return true;
    },
  },
});
```

**Configuration notes:**

- **Global limits**: Set default limits for all upload routes via `fileUploads.limits`
- **Per-route overrides**: `processFileUpload()` can override these per route (see [Configuration options](#configuration-options))
- **Pre-validation with `allowedRoutes`**: Automatically rejects multipart requests to non-allowed routes before parsing (prevents bandwidth waste and DoS attacks)
  - Supports wildcard patterns:
    - `*` matches a single path segment: `/api/*/upload` matches `/api/foo/upload` but NOT `/api/foo/bar/upload`
    - `**` matches zero or more segments: `/api/upload/**` matches `/api/upload`, `/api/upload/foo`, `/api/upload/foo/bar`, etc.
  - **Important**: When using `apiEndpoints.versioned: true` (the default), routes registered with `server.api.*` helpers are exposed under `/api/v{n}/...`, so `allowedRoutes` must include the version prefix. Example: use `['/api/v1/upload/avatar']` instead of `['/api/upload/avatar']`. Only use unversioned paths if you explicitly set `versioned: false`.
- **Pre-validation with `preValidation`**: Runs after user plugins/hooks but before multipart parsing, allowing you to reject requests early based on headers, auth state, rate limits, etc.
  - Both `allowedRoutes` rejections and `preValidation` rejections are automatically wrapped in proper API envelopes (with `status`, `status_code`, `request_id`, etc.) using your server's `APIResponseHelpersClass` if provided, or the default `APIResponseHelpers`.

## Using processFileUpload()

### Configuration options

`processFileUpload(config)` accepts the following configuration:

- **`request`**: Fastify request
- **`reply`**: Fastify reply (or controlled reply)
- **`maxFiles`**: defaults to `1`
- **`maxSizePerFile`**: bytes (overrides server `limits.fileSize`)
- **`maxFields`**: optional max form fields (overrides server `limits.fields`)
- **`maxFieldSize`**: optional max field value size in bytes (overrides server `limits.fieldSize`)
- **`allowedMimeTypes`**: `string[]` supporting wildcards (e.g. `image/*`) or a validator function
- **`timeoutMS`**: optional upload timeout (per-route)
- **`processor(fileStream, metadata, context)`**: per-file handler (must consume stream)
  - `fileStream`: Readable stream of file data
  - `metadata`: `{ filename, mimetype, encoding, fieldname, fileIndex }`
  - `context`: `{ fileIndex, onCleanup, isAborted }`
    - `onCleanup(cleanupFn)`: Register cleanup handler that runs when upload fails (including processor errors, size exceeded, MIME rejected, timeout, connection broken, batch failures)
    - `isAborted()`: Check if upload aborted (timeout, connection broken, etc.)
- **`onComplete(finalResult)`**: optional post-processing hook (runs once after all files)

**Return type:**

- **Success**: `{ success: true; files: Array<{ fileIndex; filename; data }> }`
- **Failure**: `{ success: false; errorEnvelope }` (ready to return)

### Single file upload

Smallest "real" disk example:

```ts
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { processFileUpload } from 'unirend/server';
import { APIResponseHelpers } from 'unirend/api-envelope';

server.api.post('upload/avatar', async (request, reply) => {
  const result = await processFileUpload({
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
  const result = await processFileUpload({
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

Use `context.onCleanup(fn)` inside the processor to register cleanup. Cleanup runs automatically when uploads fail for ANY reason:

- Processor throws an error (storage failure, pipe break, etc.)
- File exceeds size limit
- MIME type validation fails
- Connection broken or timeout
- Batch upload: any file fails (fail-fast)

**Multiple cleanup handlers per file:**

You can register multiple cleanup handlers for a single file - all handlers will execute in parallel using `Promise.allSettled()`. If a cleanup handler throws, the error is logged but other handlers still run.

```ts
processor: async (fileStream, metadata, context) => {
  const tempPath = `./uploads/tmp/${metadata.filename}`;
  const thumbnailPath = `./uploads/tmp/thumb-${metadata.filename}`;

  // Register multiple cleanup handlers - both will run on failure
  context.onCleanup(async (reason, details) => {
    // reason: 'processor_error' | 'size_exceeded' | 'mime_type_rejected' | 'timeout' | etc.
    await safeDelete(tempPath);
  });

  context.onCleanup(async () => {
    await safeDelete(thumbnailPath);
  });

  // If this throws, ALL cleanup handlers WILL run
  await writeSomewhere(fileStream, tempPath);
  await generateThumbnail(tempPath, thumbnailPath);
  return { tempPath, thumbnailPath };
};
```

### Post-processing with `onComplete`

Use `onComplete` for a single step after all files finish (success or failure), like moving temp files to final location or committing a transaction.

**Key points:**

- On **success**: runs after all files processed
- On **failure**: runs after all cleanup handlers complete
- If `onComplete` throws after success, client gets a `file_upload_completion_failed` error

```ts
const result = await processFileUpload({
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

### Pre-validation (reject before parsing multipart)

You can reject requests _before_ multipart parsing to save bandwidth and work. Use `fileUploads.allowedRoutes` + `fileUploads.preValidation` in server config.

`preValidation` supports both **synchronous** and **asynchronous** validation functions:

```ts
const server = serveSSRDev(paths, {
  fileUploads: {
    enabled: true,
    allowedRoutes: ['/api/upload/*'],
    // Async validation (use when you need to check databases, external services, etc.)
    preValidation: async (request) => {
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
    // preValidation: (request) => {
    //   if (!request.headers['x-api-key']) {
    //     return { statusCode: 403, error: 'forbidden', message: 'API key required' };
    //   }
    //   return true;
    // },
  },
});
```

**Note:** Both `allowedRoutes` rejections and `preValidation` rejections are automatically wrapped in proper API envelopes (with `status`, `status_code`, `request_id`, etc.) using your server's `APIResponseHelpersClass` if provided, or the default `APIResponseHelpers`.

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

If you want "automatic" consistency, treat uploads like a state machine:

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
const result = await processFileUpload({
  request,
  reply,
  maxSizePerFile: 10 * 1024 * 1024,
  allowedMimeTypes: ['image/*'],
  processor: async (stream, metadata, context) => {
    const id = generateID(); // uuid/nanoid/cuid2/etc
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

**Cleanup job pattern:** periodically delete/expire `status='pending'` uploads older than 24–48 hours (these usually indicate failed uploads that weren't cleaned up, e.g. due to process crashes).

## Errors and abort reasons

On failure, `processFileUpload()` returns `{ success: false, errorEnvelope }`. In `server.api.*` routes you typically just `return result.errorEnvelope;`.

### Abort reasons

When uploads fail, cleanup handlers receive an `AbortReason` explaining why:

- `'size_exceeded'` - File exceeded size limit
- `'mime_type_rejected'` - MIME type not allowed
- `'connection_broken'` - Client disconnected
- `'timeout'` - Upload timed out
- `'processor_error'` - Processor threw an error
- `'batch_file_failed'` - Another file in batch failed
- `'files_limit_exceeded'` - Too many files uploaded
- `'no_files_provided'` - No files in request

### Timeout and connection handling

If you set `timeoutMS`, uploads automatically abort when time expires. The framework destroys the stream, your processor receives an error, and cleanup runs automatically. Same behavior for client disconnections.

**Connection monitoring implementation:**

The framework uses a dual-approach for detecting client disconnections:

1. **Event-based detection**: Listens for the `'close'` event on the request socket (immediate detection)
2. **Polling fallback**: Checks `reply.raw.destroyed` every 500ms as a safety net

This combination ensures reliable detection while minimizing unnecessary polling overhead for long-running uploads.

**Most common case - automatic handling:**

```typescript
processor: async (fileStream, metadata, context) => {
  const uploadID = generateID();

  // Cleanup runs automatically if processor throws (including stream errors)
  context.onCleanup(async () => {
    await deleteFromStorage(uploadID);
  });

  // If timeout/disconnect occurs, pipeline throws and cleanup runs
  await pipeline(fileStream, createUploadStream(uploadID));
  return { uploadID };
};
```

**Manual abort checks (for chunk-by-chunk processing):**

If you're processing chunks manually (e.g., computing hashes, custom validation), use `context.isAborted()`:

```typescript
processor: async (fileStream, metadata, context) => {
  for await (const chunk of fileStream) {
    if (context.isAborted()) {
      throw new Error('Upload aborted'); // Early exit
    }
    // Process chunk...
  }
};
```

### Common HTTP statuses / error codes

This is the "at a glance" mapping clients usually care about:

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
- **Size limit truncation behavior**: Due to how the multipart parser works with streaming, file size truncation is detected **after** the stream has been consumed. This means if a file exceeds `maxSizePerFile`, the processor will upload/process the truncated file before the framework detects it and triggers cleanup. The partial file is deleted by cleanup handlers, but bandwidth has already been consumed. This is a known limitation of streaming multipart parsing - the framework cannot know the total file size until the stream completes.
- **Do not trust client MIME type / filename**: consider validating via magic bytes after writing to temp storage.
- **Limit sizes and counts**: set `maxSizePerFile`/`maxFiles` and consider rate limiting to reduce abuse/DoS risk.
- **Scan if needed**: for untrusted uploads, consider virus/malware scanning as part of your ingestion pipeline.
- **Store outside web root**: don't directly serve uploaded files from the upload directory.
- **Generate your own filenames/IDs**: avoid path traversal and collisions; don't use the client filename as a path.
- **Harden permissions**: ensure uploaded files are not executable and are stored with restrictive permissions.
- **Isolate storage**: consider separate buckets/prefixes/domains for user uploads vs application assets.

### Image upload workflow (common pattern)

For image uploads, it's common to store the original file and enqueue background work to generate derived versions (thumbnails, multiple resolutions, format conversion/optimization) for efficient delivery.

## Plugins / raw Fastify routes

If you need to use file upload helpers in custom Fastify routes (non-envelope API routes), see the [File Upload Helpers section in the Server Plugins documentation](./server-plugins.md#file-upload-helpers). That section explains how to handle the envelope-to-Fastify conversion when using `processFileUpload()` with raw `pluginHost.post()` routes.
