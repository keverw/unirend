/**
 * File Upload Helpers
 *
 * Framework-provided utilities for handling single and multiple file uploads
 * with streaming validation, cleanup handlers, and standard API error envelopes.
 *
 * Features:
 * - Unified API (maxFiles defaults to 1)
 * - Mid-stream abort on size/MIME type violations
 * - Cleanup handlers via context.onCleanup()
 * - Fail-fast behavior (first error aborts all)
 * - Standard error envelopes for clients
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { Transform, type Readable } from 'stream';
import { APIResponseHelpers } from '../api-envelope/response-helpers';
import type { ControlledReply } from '../types';
import type { APIErrorResponse } from '../api-envelope/api-envelope-types';
import { matchesMimeTypePattern } from '../internal/mime-type-utils';

/**
 * Default rejection reason when MIME type validation fails
 */
const DEFAULT_MIME_TYPE_REJECTION_REASON = 'File type not allowed';

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
   * Note: You must consume the stream (via pipeline or similar). This helper monitors
   * the stream for size violations and aborts if exceeded.
   * The framework monitors the stream for size violations and will abort if exceeded.
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
   * const result = await FileUploadHelpers.processUpload({
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

/**
 * Internal state for tracking upload progress
 */
interface UploadState {
  aborted: boolean;
  abortReason?: AbortReason;
  abortDetails?: Record<string, unknown>;
  cleanupHandlers: Array<
    (
      reason: AbortReason,
      details?: Record<string, unknown>,
    ) => Promise<void> | void
  >;
  processedFiles: number;
}

/**
 * Error class for upload aborts
 */
class UploadAbortError extends Error {
  constructor(
    public readonly reason: AbortReason,
    public readonly details?: Record<string, unknown>,
  ) {
    super(`Upload aborted: ${reason}`);
    this.name = 'UploadAbortError';
  }
}

/**
 * Safely extract error message from unknown error value
 * Handles cases where error might be null, undefined, primitive, or object without message
 *
 * @param error - Unknown error value
 * @param fallback - Fallback message if error has no message
 * @returns Error message string
 */
function getErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message: unknown }).message;
    return typeof message === 'string' ? message : fallback;
  }
  return fallback;
}

/**
 * File Upload Helpers - Unified API for single and batch file uploads
 */
export class FileUploadHelpers {
  /**
   * Process file upload(s) with validation, streaming, and cleanup handlers.
   *
   * @param config - Upload configuration
   * @returns UploadResult discriminated union (success or error)
   *
   * @example Single file upload
   * ```typescript
   * const result = await FileUploadHelpers.processUpload({
   *   request,
   *   reply,
   *   maxSizePerFile: 5 * 1024 * 1024, // 5MB
   *   allowedMimeTypes: ['image/jpeg', 'image/png'],
   *   processor: async (stream, metadata, context) => {
   *     const uploadID = generateId();
   *
   *     context.onCleanup(async () => {
   *       await deleteFromObjectStorage(uploadID);
   *     });
   *
   *     const url = await uploadToObjectStorage(stream, uploadID);
   *     return { url, uploadID };
   *   },
   * });
   * if (!result.success) return result.errorEnvelope;
   * // result.files: [{ fileIndex: 0, filename: 'photo.jpg', data: { url: '...', uploadID: '...' } }]
   * ```
   *
   * @example Batch file upload
   * ```typescript
   * const result = await FileUploadHelpers.processUpload({
   *   request,
   *   reply,
   *   maxFiles: 5,
   *   maxSizePerFile: 10 * 1024 * 1024, // 10MB
   *   allowedMimeTypes: (mime) => {
   *     if (mime.startsWith('image/')) return { allowed: true };
   *     return { allowed: false, allowedTypes: ['image/*'] };
   *   },
   *   processor: async (stream, metadata, context) => {
   *     const uploadID = `${context.fileIndex}-${generateId()}`;
   *
   *     context.onCleanup(async () => {
   *       await deleteFromObjectStorage(uploadID);
   *     });
   *
   *     const url = await uploadToObjectStorage(stream, uploadID);
   *     return { url, uploadID, index: context.fileIndex };
   *   },
   * });
   * if (!result.success) return result.errorEnvelope;
   * // result.files: Array of processed files with data
   * ```
   */
  public static async processUpload<T = unknown>(
    config: FileUploadConfig<T>,
  ): Promise<UploadResult<T>> {
    const {
      request,
      reply,
      maxFiles = 1,
      maxSizePerFile,
      maxFields,
      maxFieldSize,
      allowedMimeTypes,
      timeoutMS,
      processor,
      onComplete,
    } = config;

    // Check if multipart is enabled on the server
    const fastifyInstance = (
      request as { server?: { multipartEnabled?: boolean } }
    ).server;
    if (!fastifyInstance?.multipartEnabled) {
      throw new Error(
        'File uploads are not enabled. Add fileUploads: { enabled: true } to your server options.',
      );
    }

    // Validate Content-Type header first (before creating state/processing files)
    const contentType = request.headers['content-type'];

    if (!contentType || !contentType.includes('multipart/form-data')) {
      // Note: No cleanup handlers to run here - this check happens before any file processing
      // and before the state object is created (no processors have run yet)

      // Create custom error response for invalid Content-Type
      const errorEnvelope = this.buildValidationErrorResponse(
        request,
        415,
        'invalid_content_type',
        'Content-Type must be multipart/form-data',
        {
          received_content_type: contentType || 'none',
          expected_content_type: 'multipart/form-data',
        },
      );

      const errorResult: UploadError = {
        success: false,
        errorEnvelope,
      };

      // Call onComplete callback if provided
      if (onComplete) {
        try {
          await onComplete(errorResult);
        } catch (onCompleteError) {
          // Log but don't change the error response
          request.log.error(
            { err: onCompleteError },
            'onComplete callback failed during error handling',
          );
        }
      }

      return errorResult;
    }

    const state: UploadState = {
      aborted: false,
      cleanupHandlers: [],
      processedFiles: 0,
    };

    // Track if cleanup has been initiated (prevents duplicate cleanup calls)
    let hasCleanupStarted = false;

    // Track the current file stream being processed (so we can destroy it on timeout/abort)
    // Type is BusboyFileStream from @fastify/multipart (Node.js Readable with .destroy() method)
    let currentFileStream: Readable | null = null;

    // Timer handles (defined before they're used in callbacks)
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    let connectionMonitor: ReturnType<typeof setInterval> | null = null;

    // Define cleanup function before timers (so callbacks can reference it)
    const cleanupTimers = () => {
      if (connectionMonitor) {
        clearInterval(connectionMonitor);
        connectionMonitor = null;
      }

      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
    };

    // Setup timeout handler (if specified)
    if (timeoutMS) {
      timeoutHandle = setTimeout(() => {
        if (!state.aborted) {
          state.aborted = true;
          state.abortReason = 'timeout';
          // Clear timers immediately to prevent leaks
          cleanupTimers();
          // Destroy current file stream to interrupt processor
          if (currentFileStream && !currentFileStream.destroyed) {
            currentFileStream.destroy(new Error('Upload timeout'));
          }
        }
      }, timeoutMS);
    }

    try {
      // Monitor connection state using reply.raw.destroyed
      // Note: This is one of the few places that needs raw stream access
      // for detecting broken connections during long-running uploads
      connectionMonitor = setInterval(() => {
        if (reply.raw.destroyed && !state.aborted) {
          state.aborted = true;
          state.abortReason = 'connection_broken';
          // Clear timers immediately to prevent leaks
          cleanupTimers();
          // Destroy current file stream to interrupt processor
          if (currentFileStream && !currentFileStream.destroyed) {
            currentFileStream.destroy(new Error('Connection broken'));
          }
        }
      }, 100);

      // Process files inline during iteration
      // This is critical for:
      // 1. Validating MIME types BEFORE consuming bandwidth (DoS prevention)
      // 2. Consuming streams during iteration (prevents iterator hanging)
      // 3. No memory buffering (process one file at a time)
      const results: ProcessedFile<T>[] = [];
      let fileIndex = 0;

      const filesIterator = request.files({
        throwFileSizeLimit: false,
        limits: {
          fileSize: maxSizePerFile,
          files: maxFiles,
          ...(maxFields !== undefined && { fields: maxFields }),
          ...(maxFieldSize !== undefined && { fieldSize: maxFieldSize }),
        },
      });

      for await (const file of filesIterator) {
        // Check if already aborted (timeout, connection broken, etc.)
        // This check runs BETWEEN files - can't interrupt a running processor
        // If abort happened during previous processor, we detect it here before starting next file
        if (state.aborted) {
          // Destroy current file stream without consuming it
          if (file.file && !file.file.destroyed) {
            file.file.destroy();
          }

          // Drain remaining parts from iterator to prevent hanging
          // IMPORTANT: Use a timeout to prevent indefinite blocking if iterator is waiting for network data
          const drainTimeout = 1000; // 1 second max to drain remaining parts
          try {
            await Promise.race([
              // Drain iterator
              (async () => {
                for await (const remainingPart of filesIterator) {
                  if (remainingPart.file && !remainingPart.file.destroyed) {
                    remainingPart.file.destroy();
                  }
                }
              })(),
              // Timeout
              new Promise((_, reject) =>
                setTimeout(
                  () => reject(new Error('Iterator drain timeout')),
                  drainTimeout,
                ),
              ),
            ]);
          } catch (drainError) {
            // Ignore errors during cleanup drain (including timeout)
            // The important thing is we destroyed the current file stream
            // and attempted to clean up remaining streams
            request.log.warn(
              { err: drainError },
              'Failed to drain multipart iterator (timeout or error)',
            );
          }

          const abortReason = state.abortReason || 'processor_error';
          throw new UploadAbortError(
            abortReason,
            state.abortDetails || { fileIndex },
          );
        }

        // Validate MIME type BEFORE consuming stream (prevents bandwidth waste / DoS)
        const mimeTypeValidation: MimeTypeValidationResult =
          typeof allowedMimeTypes === 'function'
            ? allowedMimeTypes(file.mimetype)
            : allowedMimeTypes.some((pattern) =>
                  matchesMimeTypePattern(file.mimetype, pattern),
                )
              ? { allowed: true }
              : {
                  allowed: false,
                  rejectionReason: DEFAULT_MIME_TYPE_REJECTION_REASON,
                  allowedTypes: allowedMimeTypes,
                };

        if (!mimeTypeValidation.allowed) {
          state.aborted = true;

          const failureDetails: Record<string, unknown> = {
            fileIndex,
            filename: file.filename,
            receivedMimeType: file.mimetype,
            rejectionReason:
              mimeTypeValidation.rejectionReason ||
              DEFAULT_MIME_TYPE_REJECTION_REASON,
          };

          // Include allowed types if provided
          if (mimeTypeValidation.allowedTypes) {
            failureDetails.allowedMimeTypes = mimeTypeValidation.allowedTypes;
          }

          // In batch mode, wrap with BATCH_FILE_FAILED
          if (maxFiles > 1) {
            state.abortReason = 'batch_file_failed';
            state.abortDetails = {
              ...failureDetails,
              triggerReason: 'MIME_TYPE_REJECTED',
              totalFiles: fileIndex + 1,
              processedFiles: state.processedFiles,
            };
          } else {
            state.abortReason = 'mime_type_rejected';
            state.abortDetails = failureDetails;
          }

          // Destroy this file's stream without consuming bandwidth
          if (file.file && !file.file.destroyed) {
            file.file.destroy();
          }

          // Drain remaining parts from iterator to prevent hanging
          // IMPORTANT: Use a timeout to prevent indefinite blocking if iterator is waiting for network data
          const drainTimeout = 1000; // 1 second max to drain remaining parts
          try {
            await Promise.race([
              // Drain iterator
              (async () => {
                for await (const remainingPart of filesIterator) {
                  if (remainingPart.file && !remainingPart.file.destroyed) {
                    remainingPart.file.destroy();
                  }
                }
              })(),
              // Timeout
              new Promise((_, reject) =>
                setTimeout(
                  () => reject(new Error('Iterator drain timeout')),
                  drainTimeout,
                ),
              ),
            ]);
          } catch (drainError) {
            // Ignore errors during cleanup drain (including timeout)
            // The important thing is we destroyed the current file stream
            // and attempted to clean up remaining streams
            request.log.warn(
              { err: drainError },
              'Failed to drain multipart iterator after MIME rejection (timeout or error)',
            );
          }

          throw new UploadAbortError(state.abortReason, state.abortDetails);
        }

        // MIME type valid - create processor context and process file
        // Track this file's cleanup handlers separately to handle race conditions
        const fileCleanupHandlers: Array<
          (
            reason: AbortReason,
            details?: Record<string, unknown>,
          ) => Promise<void> | void
        > = [];

        const context: ProcessorContext = {
          fileIndex,
          onCleanup: (cleanupFn) => {
            // Add to both file-specific and global cleanup lists
            fileCleanupHandlers.push(cleanupFn);
            state.cleanupHandlers.push(cleanupFn);
          },
          isAborted: () => state.aborted,
        };

        const metadata: FileMetadata = {
          filename: file.filename,
          mimetype: file.mimetype,
          encoding: file.encoding,
          fieldname: file.fieldname,
          fileIndex,
        };

        // Create byte counter to track actual bytes received
        const byteCounter = this.createByteCounter();
        const wrappedStream = file.file.pipe(byteCounter.stream);

        try {
          // Track current file stream so timeout/connection monitor can destroy it
          currentFileStream = file.file;

          // Run processor (this consumes the stream)
          const processorResult = await processor(
            wrappedStream,
            metadata,
            context,
          );

          // Clear current file stream reference
          currentFileStream = null;

          // Check if aborted during processor execution (timeout, connection broken, etc.)
          // If stream was destroyed, processor likely threw an error (caught below)
          // CRITICAL: This check must happen IMMEDIATELY after processor completes to catch race conditions
          // where timeout/connection-break callbacks were scheduled during processor execution
          // but haven't executed yet
          if (state.aborted) {
            // Processor completed but we detected an abort - run THIS FILE's cleanup immediately
            // (prevents cleanup delay in batch uploads)
            // Note: We do NOT set hasCleanupStarted=true here because the outer catch block
            // needs to run cleanup for ALL files (including previously-successful ones)
            if (fileCleanupHandlers.length > 0) {
              await this.runCleanupHandlers(
                fileCleanupHandlers,
                state.abortReason || 'timeout',
                state.abortDetails || { fileIndex },
                request,
              );

              // Remove these handlers from global list to prevent double-cleanup
              state.cleanupHandlers = state.cleanupHandlers.filter(
                (handler) => !fileCleanupHandlers.includes(handler),
              );
            }

            // Processor completed but we timed out - treat as abort
            state.abortReason = state.abortReason || 'timeout';
            throw new UploadAbortError(
              state.abortReason,
              state.abortDetails || { fileIndex },
            );
          }

          // Check for truncation after stream is consumed
          if (file.file.truncated) {
            state.aborted = true;

            const bytesReceived = byteCounter.getBytesRead();

            const failureDetails = {
              fileIndex,
              filename: file.filename,
              maxSizePerFile,
              bytesReceived,
            };

            // In batch mode, wrap with BATCH_FILE_FAILED
            if (maxFiles > 1) {
              state.abortReason = 'batch_file_failed';
              state.abortDetails = {
                ...failureDetails,
                triggerReason: 'SIZE_EXCEEDED',
                totalFiles: fileIndex + 1,
                processedFiles: state.processedFiles,
              };
            } else {
              state.abortReason = 'size_exceeded';
              state.abortDetails = failureDetails;
            }

            // Run THIS FILE's cleanup immediately (before throwing to prevent delay in batch uploads)
            // Note: We do NOT set hasCleanupStarted=true here because the outer catch block
            // needs to run cleanup for ALL files (including previously-successful ones)
            if (fileCleanupHandlers.length > 0) {
              await this.runCleanupHandlers(
                fileCleanupHandlers,
                state.abortReason,
                state.abortDetails,
                request,
              );

              // Remove these handlers from global list to prevent double-cleanup
              state.cleanupHandlers = state.cleanupHandlers.filter(
                (handler) => !fileCleanupHandlers.includes(handler),
              );
            }

            throw new UploadAbortError(state.abortReason, state.abortDetails);
          }

          // File processed successfully
          results.push({
            fileIndex,
            filename: file.filename,
            data: processorResult,
          });

          state.processedFiles++;
          fileIndex++;
        } catch (processorError) {
          // Clear current file stream reference
          currentFileStream = null;

          // Processor threw an error (storage failure, stream destroyed, etc.)
          state.aborted = true;

          // Sanitize error message for production (don't expose internal details)
          const isDevelopment = (
            request as FastifyRequest & { isDevelopment?: boolean }
          ).isDevelopment;
          const errorMessage = isDevelopment
            ? getErrorMessage(processorError, 'Storage error')
            : 'Storage error';

          const failureDetails = {
            fileIndex,
            filename: file.filename,
            error: errorMessage,
          };

          // In batch mode, wrap with BATCH_FILE_FAILED
          if (maxFiles > 1) {
            state.abortReason = 'batch_file_failed';
            state.abortDetails = {
              ...failureDetails,
              triggerReason: 'PROCESSOR_ERROR',
              totalFiles: fileIndex + 1,
              processedFiles: state.processedFiles,
            };
          } else {
            state.abortReason = 'processor_error';
            state.abortDetails = failureDetails;
          }

          // Run THIS FILE's cleanup immediately (before throwing to prevent delay in batch uploads)
          // Note: We do NOT set hasCleanupStarted=true here because the outer catch block
          // needs to run cleanup for ALL files (including previously-successful ones)
          if (fileCleanupHandlers.length > 0) {
            await this.runCleanupHandlers(
              fileCleanupHandlers,
              state.abortReason,
              state.abortDetails,
              request,
            );

            // Remove these handlers from global list to prevent double-cleanup
            state.cleanupHandlers = state.cleanupHandlers.filter(
              (handler) => !fileCleanupHandlers.includes(handler),
            );
          }

          throw new UploadAbortError(state.abortReason, state.abortDetails);
        }
      }

      // Validate file count after iteration completes
      if (fileIndex === 0) {
        // Run cleanup handlers (defensive programming - should be empty, but ensures consistency)
        // In the current implementation, no processors ran so state.cleanupHandlers will be empty,
        // but we call this anyway to make the code more robust against future changes
        if (!hasCleanupStarted && state.cleanupHandlers.length > 0) {
          hasCleanupStarted = true;
          await this.runCleanupHandlers(
            state.cleanupHandlers,
            'no_files_provided',
            {
              message: 'No files were provided in the request',
              note: 'Defensive cleanup - this should not normally execute',
            },
            request,
          );
        }

        // No files uploaded - return 400 error
        const errorEnvelope = this.buildValidationErrorResponse(
          request,
          400,
          'file_not_provided',
          maxFiles === 1
            ? 'No file was provided in the request'
            : 'No files were provided in the request',
        );

        const errorResult: UploadError = {
          success: false,
          errorEnvelope,
        };

        // Call onComplete callback if provided (runs AFTER cleanup, per timing guarantees)
        if (onComplete) {
          try {
            await onComplete(errorResult);
          } catch (onCompleteError) {
            request.log.error(
              { err: onCompleteError },
              'onComplete callback failed (no files provided)',
            );
          }
        }

        return errorResult;
      }

      // All files processed successfully
      const successResult: UploadSuccess<T> = {
        success: true,
        files: results,
      };

      // Call onComplete callback if provided
      if (onComplete) {
        try {
          await onComplete(successResult);
        } catch (onCompleteError) {
          // onComplete failure after successful upload is a real error
          // (e.g., files uploaded but can't be moved to final location)
          request.log.error(
            { err: onCompleteError },
            'onComplete callback failed after successful upload',
          );

          // Sanitize error message for production (don't expose internal details)
          const isDevelopment = (
            request as FastifyRequest & { isDevelopment?: boolean }
          ).isDevelopment;
          const errorMessage = isDevelopment
            ? getErrorMessage(onCompleteError, 'Post-processing failed')
            : 'Post-processing failed';

          const errorEnvelope = this.buildValidationErrorResponse(
            request,
            500,
            'file_upload_completion_failed',
            'Files uploaded successfully but post-processing failed',
            {
              error: errorMessage,
              filesProcessed: results.length,
            },
          );

          return {
            success: false,
            errorEnvelope,
          };
        }
      }

      return successResult;
    } catch (error) {
      // Important: clear timers immediately on error to prevent leaks
      // (cleanup handlers / error handling may involve awaits)
      cleanupTimers();

      // Check for FilesLimitError from @fastify/multipart
      // The error has both .name ('FilesLimitError') and .code ('FST_FILES_LIMIT') properties
      // We check .name as it's more reliable for instanceof-like checks without access to the error constructor
      if (error instanceof Error && error.name === 'FilesLimitError') {
        // STEP 1: Run cleanup handlers FIRST (per documentation: "after abort cleanup has completed")
        if (!hasCleanupStarted) {
          hasCleanupStarted = true;
          await this.runCleanupHandlers(
            state.cleanupHandlers,
            'files_limit_exceeded',
            { maxFiles },
            request,
          );
        }

        // STEP 2: Build error envelope (cleanup is now complete)
        const errorEnvelope = this.buildValidationErrorResponse(
          request,
          413,
          'file_max_files_exceeded',
          'Number of files exceeds maximum allowed',
          {
            maxFiles,
          },
        );

        const errorResult: UploadError = {
          success: false,
          errorEnvelope,
        };

        // STEP 3: Call onComplete callback AFTER cleanup (if provided)
        if (onComplete) {
          try {
            await onComplete(errorResult);
          } catch (onCompleteError) {
            // Log but don't change the error response
            request.log.error(
              { err: onCompleteError },
              'onComplete callback failed (too many files)',
            );
          }
        }

        return errorResult;
      }

      // STEP 1 (for all other errors): Run cleanup handlers FIRST (if not already started)
      // This block runs before the UploadAbortError and unknown error handling below
      if (!hasCleanupStarted) {
        hasCleanupStarted = true;
        if (error instanceof UploadAbortError) {
          await this.runCleanupHandlers(
            state.cleanupHandlers,
            error.reason,
            error.details,
            request,
          );
        } else {
          // Unknown error - run cleanup without reason
          // Sanitize error message for production
          const isDevelopment = (
            request as FastifyRequest & { isDevelopment?: boolean }
          ).isDevelopment;
          const errorMessage = isDevelopment
            ? getErrorMessage(error, 'Unknown error')
            : 'Unknown error';

          await this.runCleanupHandlers(
            state.cleanupHandlers,
            'processor_error',
            { error: errorMessage },
            request,
          );
        }
      }

      // STEP 2 (for all other errors): Determine error response based on abort reason
      // Note: Cleanup has already run in the block above (lines 965-993)
      if (error instanceof UploadAbortError) {
        const errorEnvelope = this.buildAbortErrorResponse(
          request,
          error.reason,
          error.details,
        );

        const errorResult: UploadError = {
          success: false,
          errorEnvelope,
        };

        // STEP 3: Call onComplete callback AFTER cleanup (if provided)
        if (onComplete) {
          try {
            await onComplete(errorResult);
          } catch (onCompleteError) {
            // Log but don't change the error response
            request.log.error(
              { err: onCompleteError },
              'onComplete callback failed after upload abort',
            );
          }
        }

        return errorResult;
      }

      // STEP 2 (unknown error): Build error response
      // Note: Cleanup has already run in the block above (lines 965-993)
      request.log.error({ err: error }, 'Unexpected file upload error');

      // Sanitize error message for production (don't expose internal details)
      const isDevelopment = (
        request as FastifyRequest & { isDevelopment?: boolean }
      ).isDevelopment;
      const errorMessage = isDevelopment
        ? getErrorMessage(error, 'Unknown error')
        : 'Unknown error';

      const errorEnvelope = this.buildValidationErrorResponse(
        request,
        500,
        'file_upload_failed',
        'An unexpected error occurred during file upload',
        {
          error: errorMessage,
        },
      );

      const errorResult: UploadError = {
        success: false,
        errorEnvelope,
      };

      // STEP 3: Call onComplete callback AFTER cleanup (if provided)
      if (onComplete) {
        try {
          await onComplete(errorResult);
        } catch (onCompleteError) {
          // Log but don't change the error response
          request.log.error(
            { err: onCompleteError },
            'onComplete callback failed after unexpected error',
          );
        }
      }

      return errorResult;
    } finally {
      // Safety net: ensure timers are always cleared (including early returns)
      cleanupTimers();
    }
  }

  /**
   * Get the APIResponseHelpersClass to use for creating error responses.
   *
   * Priority:
   * 1. Decorated class from request (if user provided custom class)
   * 2. Default APIResponseHelpers class via dynamic import
   * 3. null (caller will use plain error object fallback)
   *
   * @returns The helpers class or null if unavailable
   */
  private static getAPIResponseHelpersClass(request: FastifyRequest): {
    createAPIErrorResponse: (params: {
      request: FastifyRequest;
      statusCode: number;
      errorCode: string;
      errorMessage: string;
      errorDetails?: Record<string, unknown>;
    }) => APIErrorResponse;
  } {
    // Try to get the decorated class from request (allows server customization)
    const decoratedClass = (
      request as FastifyRequest & {
        APIResponseHelpersClass?: {
          createAPIErrorResponse: (params: {
            request: FastifyRequest;
            statusCode: number;
            errorCode: string;
            errorMessage: string;
            errorDetails?: Record<string, unknown>;
          }) => APIErrorResponse;
        };
      }
    ).APIResponseHelpersClass;

    if (decoratedClass?.createAPIErrorResponse) {
      return decoratedClass;
    }

    // Fallback to built-in APIResponseHelpers class
    return APIResponseHelpers;
  }

  /**
   * Build validation error response with explicit parameters using API envelope pattern if available.
   *
   * Used for early validation errors before file processing begins (e.g., invalid Content-Type,
   * no files provided, too many files). These errors don't map to AbortReason.
   *
   * @returns Tuple of [statusCode, responseBody]
   */
  private static buildValidationErrorResponse(
    request: FastifyRequest,
    statusCode: number,
    errorCode: string,
    errorMessage: string,
    details?: Record<string, unknown>,
  ): APIErrorResponse {
    const helpersClass = this.getAPIResponseHelpersClass(request);

    return helpersClass.createAPIErrorResponse({
      request,
      statusCode,
      errorCode,
      errorMessage,
      errorDetails: details,
    });
  }

  /**
   * Build abort error response from AbortReason using API envelope pattern if available.
   *
   * Maps AbortReason to status code/error metadata, then creates response.
   * Used for errors that occur during file processing (e.g., size exceeded, MIME type rejected, processor errors).
   *
   * @returns APIErrorResponse envelope
   */
  private static buildAbortErrorResponse(
    request: FastifyRequest,
    reason: AbortReason,
    details?: Record<string, unknown>,
  ): APIErrorResponse {
    // Map abort reason to status code and error metadata
    let statusCode: number;
    let errorCode: string;
    let errorMessage: string;

    switch (reason) {
      case 'size_exceeded':
        statusCode = 413;
        errorCode = 'file_too_large';
        errorMessage =
          'File exceeded maximum size limit during streaming and was truncated';
        break;

      case 'mime_type_rejected':
        statusCode = 415;
        errorCode = 'file_type_not_allowed';
        errorMessage = 'File type is not allowed for this endpoint';
        break;

      case 'connection_broken':
        statusCode = 499; // Client Closed Request (non-standard but widely used)
        errorCode = 'file_upload_connection_broken';
        errorMessage =
          'Client disconnected during upload, partial data discarded';
        break;

      case 'timeout':
        statusCode = 408;
        errorCode = 'file_upload_timeout';
        errorMessage = 'Upload timed out, partial data discarded';
        break;

      case 'batch_file_failed':
        statusCode = 400;
        errorCode = 'file_batch_upload_failed';
        errorMessage =
          'One or more files in batch upload failed, all uploads aborted';
        break;

      case 'processor_error':
        statusCode = 500;
        errorCode = 'file_processor_error';
        errorMessage = 'Failed to process file';
        break;

      case 'files_limit_exceeded':
        statusCode = 413;
        errorCode = 'file_max_files_exceeded';
        errorMessage = 'Number of files exceeds maximum allowed';
        break;

      case 'no_files_provided':
        statusCode = 400;
        errorCode = 'file_not_provided';
        errorMessage = 'No files were provided in the request';
        break;

      default:
        statusCode = 500;
        errorCode = 'file_upload_failed';
        errorMessage = 'Upload failed for unknown reason';
        break;
    }

    // Get the helpers class and create error response
    const helpersClass = this.getAPIResponseHelpersClass(request);

    return helpersClass.createAPIErrorResponse({
      request,
      statusCode,
      errorCode,
      errorMessage,
      errorDetails: details,
    });
  }

  /**
   * Create a byte-counting transform stream wrapper
   *
   * This lightweight Transform stream sits between the multipart parser and the processor,
   * tracking the exact number of bytes read from the stream. This enables accurate truncation
   * detection when a file exceeds maxSizePerFile.
   *
   * Note: While this is technically an "intermediate buffering layer", it uses minimal
   * chunk-by-chunk buffering (not full-file buffering). Each chunk is counted and passed
   * through immediately to the processor.
   *
   * Stream flow: network → multipart parser → byte counter → processor
   *
   * @returns Object with:
   *   - stream: Transform stream to pipe through
   *   - getBytesRead: Function that returns total bytes counted
   */
  private static createByteCounter(): {
    stream: Transform;
    getBytesRead: () => number;
  } {
    let bytesRead = 0;

    const stream = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytesRead += chunk.length;
        callback(null, chunk); // Pass chunk through immediately
      },
    });

    return {
      stream,
      getBytesRead: () => bytesRead,
    };
  }

  /**
   * Run all cleanup handlers (called when upload is aborted)
   */
  private static async runCleanupHandlers(
    handlers: Array<
      (
        reason: AbortReason,
        details?: Record<string, unknown>,
      ) => Promise<void> | void
    >,
    reason: AbortReason,
    details: Record<string, unknown> | undefined,
    request: FastifyRequest,
  ): Promise<void> {
    // Run cleanup handlers in parallel
    const cleanupPromises = handlers.map(async (handler) => {
      try {
        await handler(reason, details);
      } catch (cleanupError) {
        // Log cleanup errors but don't throw
        request.log.error(
          { err: cleanupError, reason, details },
          'File upload cleanup handler error',
        );
      }
    });

    await Promise.allSettled(cleanupPromises);
  }
}
