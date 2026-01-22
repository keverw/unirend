/**
 * File Upload Helpers - Type Definitions
 *
 * Public types for the file upload API.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import type { APIErrorResponse } from '../api-envelope/api-envelope-types';
import type { ControlledReply } from '../types';

/**
 * Reasons why an upload was aborted
 */
export type AbortReason =
  /** File exceeded size limit during streaming */
  | 'size_exceeded'
  /** File MIME type not in allowed list */
  | 'mime_type_rejected'
  /** Client disconnected during upload */
  | 'connection_broken'
  /** Upload timed out */
  | 'timeout'
  /** One file in batch failed (fail-fast) */
  | 'batch_file_failed'
  /** Storage processor threw an error */
  | 'processor_error'
  /** Too many files provided (exceeds maxFiles limit) */
  | 'files_limit_exceeded'
  /** No files were provided in the request */
  | 'no_files_provided';

/**
 * Result from MIME type validator function - discriminated union
 */
export type MimeTypeValidationResult =
  | { allowed: true }
  | {
      allowed: false;
      /** Human-readable rejection reason (defaults to DEFAULT_MIME_TYPE_REJECTION_REASON if not provided) */
      rejectionReason?: string;
      /** Optional list of allowed MIME types to show in error */
      allowedTypes?: string[];
    };

/**
 * Metadata about a file being uploaded
 */
export interface FileMetadata {
  /** Original filename from client */
  filename: string;
  /** MIME type from client */
  mimetype: string;
  /** Encoding (e.g., '7bit', 'binary') */
  encoding: string;
  /** Form field name */
  fieldname: string;
  /** Index in batch (0 for single uploads) */
  fileIndex: number;
}

/**
 * Context provided to processor function
 *
 * The processor is called once per file, sequentially (file 0, then file 1, ...).
 * Each call receives a `ProcessorContext` instance for that specific file.
 *
 * - fileIndex: The current file's index (0, 1, 2, ...)
 * - onCleanup: register a cleanup handler for this file's side effects
 *   - cleanup handlers are stored in a shared list for the whole batch
 *   - ALL registered handlers run if ANY file fails (fail-fast batch abort)
 *   - handlers run AFTER processor completes or is interrupted
 *   - triggered by: processor error, size exceeded, MIME reject, timeout, connection break
 *   - use closures to capture file-specific data (IDs, paths, keys, etc.)
 * - isAborted: check if upload was aborted (timeout, connection broken, etc.)
 *   - Important: If timeout fires WHILE processor is running, the processor continues
 *     until completion. Check isAborted() periodically in long-running operations.
 *
 * Example:
 * ```typescript
 * processor: async (fileStream, metadata, context) => {
 *   // Use a collision-resistant ID in real systems (uuid/nanoid/cuid2/etc).
 *   const uploadID = `${context.fileIndex}-${createUploadId()}`;
 *
 *   // This cleanup runs if THIS file OR ANY OTHER file in the batch fails
 *   // (or if processor throws, stream breaks, size exceeded, etc.)
 *   context.onCleanup(async (reason, details) => {
 *     await deleteFile(uploadID); // uploadID captured in closure
 *   });
 *
 *   // For long operations, check if aborted to save resources
 *   if (context.isAborted()) {
 *     throw new Error('Upload aborted');
 *   }
 *
 *   // ... process file (if this throws, cleanup WILL run)
 * }
 * ```
 */
export interface ProcessorContext {
  /** Index of this file in the batch (0-based) */
  fileIndex: number;
  /**
   * Register cleanup handler that runs when upload fails.
   *
   * Cleanup handlers are called in these scenarios:
   * - Processor throws an error (storage failure, pipe break, etc.)
   * - File exceeds size limit during streaming
   * - MIME type validation fails
   * - Connection broken or timeout
   * - Batch upload: any file fails (fail-fast)
   *
   * Important: Handlers run AFTER the processor completes (or is interrupted),
   * not during processor execution.
   *
   * Note: Cleanup handlers are called for their side effects only. Any return
   * value is ignored.
   */
  onCleanup: (
    cleanupFn: (
      reason: AbortReason,
      details?: Record<string, unknown>,
    ) => Promise<void> | void,
  ) => void;
  /**
   * Check if upload has been aborted (timeout, connection broken, etc.)
   * Use this to interrupt long-running operations (object storage uploads, image processing, etc.)
   * Note: Processor continues until completion unless you check this periodically
   */
  isAborted: () => boolean;
}

/**
 * Result from processing a single file
 */
export interface ProcessedFile<T = unknown> {
  /** File index in batch */
  fileIndex: number;
  /** Original filename */
  filename: string;
  /** Custom data returned by processor */
  data: T;
}

/**
 * Success result from processUpload - contains processed files
 */
export interface UploadSuccess<T = unknown> {
  success: true;
  files: ProcessedFile<T>[];
}

/**
 * Error result from processUpload - contains error envelope to return
 */
export interface UploadError {
  success: false;
  errorEnvelope: APIErrorResponse;
}

/**
 * Result from processUpload - discriminated union
 */
export type UploadResult<T = unknown> = UploadSuccess<T> | UploadError;

/**
 * Configuration for file upload processing
 */
export interface FileUploadConfig<T = unknown> {
  /** Fastify request object */
  request: FastifyRequest;
  /** Reply object (for early abort responses) - accepts both ControlledReply and FastifyReply */
  reply: ControlledReply | FastifyReply;
  /** Maximum number of files (default: 1) */
  maxFiles?: number;
  /** Maximum size per file in bytes */
  maxSizePerFile: number;
  /** Maximum number of form fields (optional, uses server default if not specified) */
  maxFields?: number;
  /** Maximum size of form field values in bytes (optional, uses server default if not specified) */
  maxFieldSize?: number;
  /**
   * Allowed MIME types - can be an array of strings (supports wildcards) or a validator function.
   *
   * Array form supports wildcard patterns:
   * - Exact matches: `'image/jpeg'`, `'application/pdf'`
   * - Wildcards: `'image/*'` (all images), `'text/*'` (all text), `'*' + '/*'` (all types)
   *
   * Validator function returns a discriminated union:
   * - `{ allowed: true }` - File type is allowed
   * - `{ allowed: false, rejectionReason?: string, allowedTypes?: string[] }` - Rejected (rejectionReason optional, defaults to DEFAULT_MIME_TYPE_REJECTION_REASON)
   *
   * @example Array of allowed types (with wildcards)
   * ```typescript
   * allowedMimeTypes: ['image/*', 'application/pdf']
   * // Allows all image types and PDFs
   * ```
   *
   * @example Array of exact types
   * ```typescript
   * allowedMimeTypes: ['image/jpeg', 'image/png', 'image/gif']
   * ```
   *
   * @example Function validator with custom rejection reason
   * ```typescript
   * allowedMimeTypes: (mime) => {
   *   if (mime.startsWith('image/')) {
   *     return { allowed: true };
   *   }
   *   return {
   *     allowed: false,
   *     rejectionReason: 'Only image files are allowed',
   *     allowedTypes: ['image/*']
   *   };
   * }
   * ```
   *
   * @example Function validator without custom rejection reason (uses default)
   * ```typescript
   * allowedMimeTypes: (mime) => {
   *   if (mime.startsWith('image/')) {
   *     return { allowed: true };
   *   }
   *   return { allowed: false, allowedTypes: ['image/*'] };
   * }
   * ```
   */
  allowedMimeTypes: string[] | ((mimetype: string) => MimeTypeValidationResult);
  /** Timeout in milliseconds (optional) */
  timeoutMS?: number;
  /**
   * Processor function that handles file stream and returns custom data.
   * Called for each file in the upload.
   *
   * @param fileStream - Readable stream of file data
   * @param metadata - File metadata (filename, mimetype, etc.)
   * @param context - Upload context (abort handlers, file index, etc.)
   * @returns Custom data to include in response (e.g., { url: string, id: string })
   *
   * Note: You must consume the stream (via pipeline or similar). The framework monitors
   * the stream for size violations and will abort if exceeded.
   */
  processor: (
    fileStream: NodeJS.ReadableStream,
    metadata: FileMetadata,
    context: ProcessorContext,
  ) => Promise<T>;
  /**
   * Optional completion callback that runs once after all processing is done.
   *
   * TIMING GUARANTEES:
   * - Success case: Called after all files are processed successfully (no cleanup has run)
   * - Failure case: Called AFTER all cleanup handlers have completed
   *
   * This ensures that in error cases, per-file cleanups registered via context.onCleanup()
   * have already run before onComplete is called. This gives you a consistent view of the
   * system state (e.g., temp files already deleted, transactions rolled back, etc.).
   *
   * ERROR HANDLING:
   * - If `onComplete` throws after a successful upload, the operation is treated as failed
   *   (500 with code `file_upload_completion_failed`).
   * - If `onComplete` throws after an already-failed upload, the original error is returned
   *   (onComplete failure is logged only).
   *
   * COMMON USE CASES:
   * - Atomic file moves (move all uploaded files to final location after success)
   * - Transaction commits (commit database after all files processed)
   * - Cleanup of shared resources (temp directories, database connections)
   * - Logging aggregate upload results
   *
   * @param result - The final upload result (success or error)
   *
   * @example Atomic batch move
   * ```typescript
   * const tempDir = `/tmp/upload-${Date.now()}`;
   * const fileMoves: Array<{temp: string, final: string}> = [];
   *
   * const result = await processFileUpload({
   *   request,
   *   reply,
   *   maxFiles: 5,
   *   maxSizePerFile: 10 * 1024 * 1024,
   *   allowedMimeTypes: ['image/*'],
   *   processor: async (fileStream, metadata, context) => {
   *     const tempPath = `${tempDir}/${metadata.filename}`;
   *     await pipeline(fileStream, createWriteStream(tempPath));
   *     fileMoves.push({ temp: tempPath, final: `/uploads/${metadata.filename}` });
   *     return { url: '...' };
   *   },
   *   onComplete: async (result) => {
   *     if (result.success) {
   *       // Move ALL files atomically (if this fails, client gets error)
   *       for (const move of fileMoves) {
   *         await rename(move.temp, move.final);
   *       }
   *     }
   *     // Always cleanup temp directory
   *     await rm(tempDir, { recursive: true, force: true });
   *   }
   * });
   * ```
   */
  onComplete?: (result: UploadResult<T>) => Promise<void> | void;
}
