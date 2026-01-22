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

import type { FastifyRequest } from 'fastify';
import { Transform, type Readable } from 'stream';
import type { APIErrorResponse } from '../api-envelope/api-envelope-types';
import { matchesMimeTypePattern } from '../internal/mime-type-utils';
import { getAPIResponseHelpersClass } from '../internal/api-response-helpers-utils';
import type {
  AbortReason,
  FileUploadConfig,
  UploadResult,
  UploadError,
  UploadSuccess,
  ProcessedFile,
  FileMetadata,
  ProcessorContext,
  MimeTypeValidationResult,
} from './process-file-upload-types';

/**
 * Default rejection reason when MIME type validation fails
 */
const DEFAULT_MIME_TYPE_REJECTION_REASON = 'File type not allowed';

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
 * Internal processor class that handles upload state and complexity
 */
class FileUploadProcessor<T = unknown> {
  private readonly config: FileUploadConfig<T>;
  private readonly state: UploadState;

  // Track if cleanup has been initiated (prevents duplicate cleanup calls)
  private hasCleanupStarted = false;

  // Track the current file stream being processed (so we can destroy it on timeout/abort)
  // Type is BusboyFileStream from @fastify/multipart (Node.js Readable with .destroy() method)
  private currentFileStream: Readable | null = null;

  // Timer handles for timeout and connection monitoring
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private connectionMonitor: ReturnType<typeof setInterval> | null = null;

  constructor(config: FileUploadConfig<T>) {
    this.config = config;
    this.state = {
      aborted: false,
      cleanupHandlers: [],
      processedFiles: 0,
    };
  }

  /**
   * Execute the upload process
   */
  public async execute(): Promise<UploadResult<T>> {
    const { request, onComplete } = this.config;

    // Check if multipart is enabled on the server
    const fastifyInstance = (
      request as { server?: { multipartEnabled?: boolean } }
    ).server;

    if (!fastifyInstance?.multipartEnabled) {
      throw new Error(
        'File uploads are not enabled. Add fileUploads: { enabled: true } to your server options.',
      );
    }

    // Validate Content-Type header first
    const contentTypeError = this.validateContentType();
    if (contentTypeError) {
      await this.executeOnCompleteCallback(onComplete, contentTypeError);
      return contentTypeError;
    }

    try {
      // Setup monitoring
      this.setupTimeoutHandler();
      this.setupConnectionMonitor();

      // Process files
      const results = await this.processFiles();

      // Cleanup timers
      this.cleanupTimers();

      // Handle success
      return await this.handleSuccess(results);
    } catch (error) {
      // Important: clear timers immediately on error
      this.cleanupTimers();

      // Handle error
      return await this.handleError(error);
    } finally {
      // Safety net: ensure timers are always cleared
      this.cleanupTimers();
    }
  }

  /**
   * Validate Content-Type header
   */
  private validateContentType(): UploadError | null {
    const { request } = this.config;
    const contentType = request.headers['content-type'];

    if (!contentType || !contentType.includes('multipart/form-data')) {
      // Note: No cleanup handlers to run here - this check happens before any file processing
      // and before the state object is created (no processors have run yet)

      // Create custom error response for invalid Content-Type
      const errorEnvelope = this.buildValidationErrorResponse(
        415,
        'invalid_content_type',
        'Content-Type must be multipart/form-data',
        {
          received_content_type: contentType || 'none',
          expected_content_type: 'multipart/form-data',
        },
      );

      return {
        success: false,
        errorEnvelope,
      };
    }

    return null;
  }

  /**
   * Setup timeout handler
   */
  private setupTimeoutHandler(): void {
    const { timeoutMS } = this.config;

    if (timeoutMS) {
      this.timeoutHandle = setTimeout(() => {
        if (!this.state.aborted) {
          this.state.aborted = true;
          this.state.abortReason = 'timeout';
          this.cleanupTimers();
          if (this.currentFileStream && !this.currentFileStream.destroyed) {
            this.currentFileStream.destroy(new Error('Upload timeout'));
          }
        }
      }, timeoutMS);
    }
  }

  /**
   * Setup connection monitoring
   */
  private setupConnectionMonitor(): void {
    const { reply } = this.config;

    // Monitor connection state using reply.raw.destroyed
    // Note: This is one of the few places that needs raw stream access
    // for detecting broken connections during long-running uploads
    this.connectionMonitor = setInterval(() => {
      if (reply.raw.destroyed && !this.state.aborted) {
        this.state.aborted = true;
        this.state.abortReason = 'connection_broken';
        this.cleanupTimers();
        if (this.currentFileStream && !this.currentFileStream.destroyed) {
          this.currentFileStream.destroy(new Error('Connection broken'));
        }
      }
    }, 100);
  }

  /**
   * Cleanup timers
   */
  private cleanupTimers(): void {
    if (this.connectionMonitor) {
      clearInterval(this.connectionMonitor);
      this.connectionMonitor = null;
    }

    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
  }

  /**
   * Process files from multipart iterator
   */
  private async processFiles(): Promise<ProcessedFile<T>[]> {
    const {
      request,
      maxFiles = 1,
      maxSizePerFile,
      maxFields,
      maxFieldSize,
    } = this.config;

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
      if (this.state.aborted) {
        if (file.file && !file.file.destroyed) {
          file.file.destroy();
        }

        await this.drainMultipartIterator(filesIterator);
        const abortReason = this.state.abortReason || 'processor_error';

        throw new UploadAbortError(
          abortReason,
          this.state.abortDetails || { fileIndex },
        );
      }

      // Validate MIME type BEFORE consuming stream (prevents bandwidth waste / DoS)
      await this.validateMimeType(file, fileIndex, filesIterator);

      // Process the file
      const result = await this.processFile(file, fileIndex);
      results.push(result);
      fileIndex++;
    }

    // Validate file count
    if (fileIndex === 0) {
      throw new UploadAbortError('no_files_provided', {
        message: 'No files were provided in the request',
      });
    }

    return results;
  }

  /**
   * Validate MIME type for a file
   */
  private async validateMimeType(
    file: {
      file: Readable;
      fieldname: string;
      filename: string;
      encoding: string;
      mimetype: string;
    },
    fileIndex: number,
    filesIterator: AsyncIterableIterator<{
      file: Readable;
      fieldname: string;
      filename: string;
      encoding: string;
      mimetype: string;
    }>,
  ): Promise<void> {
    const { allowedMimeTypes, maxFiles = 1 } = this.config;

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
      this.state.aborted = true;

      const failureDetails: Record<string, unknown> = {
        fileIndex,
        filename: file.filename,
        receivedMimeType: file.mimetype,
        rejectionReason:
          mimeTypeValidation.rejectionReason ||
          DEFAULT_MIME_TYPE_REJECTION_REASON,
      };

      if (mimeTypeValidation.allowedTypes) {
        failureDetails.allowedMimeTypes = mimeTypeValidation.allowedTypes;
      }

      const abortReason = this.buildAbortDetails(
        maxFiles,
        fileIndex,
        'mime_type_rejected',
        'MIME_TYPE_REJECTED',
        failureDetails,
      );

      if (file.file && !file.file.destroyed) {
        file.file.destroy();
      }

      await this.drainMultipartIterator(filesIterator);
      throw new UploadAbortError(abortReason, this.state.abortDetails);
    }
  }

  /**
   * Process a single file
   */
  private async processFile(
    file: {
      file: Readable;
      fieldname: string;
      filename: string;
      encoding: string;
      mimetype: string;
    },
    fileIndex: number,
  ): Promise<ProcessedFile<T>> {
    const { processor, maxFiles = 1 } = this.config;

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
        this.state.cleanupHandlers.push(cleanupFn);
      },
      isAborted: () => this.state.aborted,
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
      this.currentFileStream = file.file;
      // Run processor (this consumes the stream)
      const processorResult = await processor(wrappedStream, metadata, context);
      // Clear current file stream reference
      this.currentFileStream = null;

      // Check if aborted during processor execution (timeout, connection broken, etc.)
      // If stream was destroyed, processor likely threw an error (caught below)
      // CRITICAL: This check must happen IMMEDIATELY after processor completes to catch race conditions
      // where timeout/connection-break callbacks were scheduled during processor execution
      // but haven't executed yet
      if (this.state.aborted) {
        // Processor completed but we detected an abort - run THIS FILE's cleanup immediately
        // (prevents cleanup delay in batch uploads)
        // Note: We do NOT set hasCleanupStarted=true here because the outer catch block
        // needs to run cleanup for ALL files (including previously-successful ones)
        await this.runFileCleanupAndRemoveFromBatch(
          fileCleanupHandlers,
          this.state.abortReason || 'timeout',
          this.state.abortDetails || { fileIndex },
        );

        // Processor completed but we timed out - treat as abort
        this.state.abortReason = this.state.abortReason || 'timeout';
        throw new UploadAbortError(
          this.state.abortReason,
          this.state.abortDetails || { fileIndex },
        );
      }

      // Check for truncation
      // Note: 'truncated' property is added by @fastify/multipart on BusboyFileStream
      if ((file.file as Readable & { truncated?: boolean }).truncated) {
        this.state.aborted = true;

        const bytesReceived = byteCounter.getBytesRead();
        const failureDetails = {
          fileIndex,
          filename: file.filename,
          maxSizePerFile: this.config.maxSizePerFile,
          bytesReceived,
        };

        // Build abort details with batch mode wrapping if needed
        const abortReason = this.buildAbortDetails(
          maxFiles,
          fileIndex,
          'size_exceeded',
          'SIZE_EXCEEDED',
          failureDetails,
        );

        // Run THIS FILE's cleanup immediately (before throwing to prevent delay in batch uploads)
        // Note: We do NOT set hasCleanupStarted=true here because the outer catch block
        // needs to run cleanup for ALL files (including previously-successful ones)
        await this.runFileCleanupAndRemoveFromBatch(
          fileCleanupHandlers,
          abortReason,
          this.state.abortDetails,
        );

        throw new UploadAbortError(abortReason, this.state.abortDetails);
      }

      // File processed successfully
      this.state.processedFiles++;

      return {
        fileIndex,
        filename: file.filename,
        data: processorResult,
      };
    } catch (processorError) {
      // Clear current file stream reference
      this.currentFileStream = null;

      // Processor threw an error (storage failure, stream destroyed, etc.)
      this.state.aborted = true;

      // Sanitize error message for production (don't expose internal details)
      const errorMessage = this.getSanitizedErrorMessage(
        processorError,
        'Storage error',
      );

      const failureDetails = {
        fileIndex,
        filename: file.filename,
        error: errorMessage,
      };

      // Build abort details with batch mode wrapping if needed
      const abortReason = this.buildAbortDetails(
        maxFiles,
        fileIndex,
        'processor_error',
        'PROCESSOR_ERROR',
        failureDetails,
      );

      // Run THIS FILE's cleanup immediately (before throwing to prevent delay in batch uploads)
      // Note: We do NOT set hasCleanupStarted=true here because the outer catch block
      // needs to run cleanup for ALL files (including previously-successful ones)
      await this.runFileCleanupAndRemoveFromBatch(
        fileCleanupHandlers,
        abortReason,
        this.state.abortDetails,
      );

      throw new UploadAbortError(abortReason, this.state.abortDetails);
    }
  }

  /**
   * Handle successful upload
   */
  private async handleSuccess(
    results: ProcessedFile<T>[],
  ): Promise<UploadResult<T>> {
    const { onComplete } = this.config;

    const successResult: UploadSuccess<T> = {
      success: true,
      files: results,
    };

    if (onComplete) {
      let onCompleteError: unknown = null;

      await Promise.resolve()
        .then(() => onComplete(successResult))
        .catch((error) => {
          onCompleteError = error;
        });

      if (onCompleteError) {
        this.config.request.log.error(
          { err: onCompleteError },
          'onComplete callback failed after successful upload',
        );

        const errorMessage = this.getSanitizedErrorMessage(
          onCompleteError,
          'Post-processing failed',
        );

        const errorEnvelope = this.buildValidationErrorResponse(
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
  }

  /**
   * Handle upload error
   */
  private async handleError(error: unknown): Promise<UploadError> {
    const { request, onComplete, maxFiles = 1 } = this.config;

    // Handle FilesLimitError from @fastify/multipart
    if (error instanceof Error && error.name === 'FilesLimitError') {
      if (!this.hasCleanupStarted) {
        this.hasCleanupStarted = true;
        await this.runCleanupHandlers('files_limit_exceeded', { maxFiles });
      }

      const errorEnvelope = this.buildValidationErrorResponse(
        413,
        'file_max_files_exceeded',
        'Number of files exceeds maximum allowed',
        { maxFiles },
      );

      const errorResult: UploadError = {
        success: false,
        errorEnvelope,
      };

      await this.executeOnCompleteCallback(onComplete, errorResult);
      return errorResult;
    }

    // Handle no files provided
    if (
      error instanceof UploadAbortError &&
      error.reason === 'no_files_provided'
    ) {
      if (!this.hasCleanupStarted) {
        this.hasCleanupStarted = true;
        await this.runCleanupHandlers('no_files_provided', {});
      }

      const errorEnvelope = this.buildValidationErrorResponse(
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

      await this.executeOnCompleteCallback(onComplete, errorResult);
      return errorResult;
    }

    // Run cleanup handlers if not already started
    if (!this.hasCleanupStarted) {
      this.hasCleanupStarted = true;
      if (error instanceof UploadAbortError) {
        await this.runCleanupHandlers(error.reason, error.details);
      } else {
        const errorMessage = this.getSanitizedErrorMessage(
          error,
          'Unknown error',
        );
        await this.runCleanupHandlers('processor_error', {
          error: errorMessage,
        });
      }
    }

    // Build error response
    let errorEnvelope: APIErrorResponse;

    if (error instanceof UploadAbortError) {
      errorEnvelope = this.buildAbortErrorResponse(error.reason, error.details);
    } else {
      request.log.error({ err: error }, 'Unexpected file upload error');

      const errorMessage = this.getSanitizedErrorMessage(
        error,
        'Unknown error',
      );

      errorEnvelope = this.buildValidationErrorResponse(
        500,
        'file_upload_failed',
        'An unexpected error occurred during file upload',
        { error: errorMessage },
      );
    }

    const errorResult: UploadError = {
      success: false,
      errorEnvelope,
    };

    await this.executeOnCompleteCallback(onComplete, errorResult);
    return errorResult;
  }

  /**
   * Build validation error response
   */
  private buildValidationErrorResponse(
    statusCode: number,
    errorCode: string,
    errorMessage: string,
    details?: Record<string, unknown>,
  ): APIErrorResponse {
    const helpersClass = getAPIResponseHelpersClass(this.config.request);

    return helpersClass.createAPIErrorResponse({
      request: this.config.request,
      statusCode,
      errorCode,
      errorMessage,
      errorDetails: details,
    });
  }

  /**
   * Build abort error response from AbortReason
   */
  private buildAbortErrorResponse(
    reason: AbortReason,
    details?: Record<string, unknown>,
  ): APIErrorResponse {
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
        statusCode = 499;
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

    const helpersClass = getAPIResponseHelpersClass(this.config.request);

    return helpersClass.createAPIErrorResponse({
      request: this.config.request,
      statusCode,
      errorCode,
      errorMessage,
      errorDetails: details,
    });
  }

  /**
   * Create a byte-counting transform stream wrapper
   */
  private createByteCounter(): {
    stream: Transform;
    getBytesRead: () => number;
  } {
    let bytesRead = 0;

    const stream = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytesRead += chunk.length;
        callback(null, chunk);
      },
    });

    return {
      stream,
      getBytesRead: () => bytesRead,
    };
  }

  /**
   * Run all cleanup handlers
   */
  private async runCleanupHandlers(
    reason: AbortReason,
    details: Record<string, unknown> | undefined,
  ): Promise<void> {
    const cleanupPromises = this.state.cleanupHandlers.map(async (handler) => {
      try {
        await handler(reason, details);
      } catch (cleanupError) {
        this.config.request.log.error(
          { err: cleanupError, reason, details },
          'File upload cleanup handler error',
        );
      }
    });

    await Promise.allSettled(cleanupPromises);
  }

  /**
   * Execute onComplete callback with error handling
   */
  private async executeOnCompleteCallback(
    onComplete: ((result: UploadResult<T>) => Promise<void> | void) | undefined,
    result: UploadResult<T>,
  ): Promise<void> {
    if (!onComplete) {
      return;
    }

    try {
      await Promise.resolve()
        .then(() => onComplete(result))
        .catch((onCompleteError) => {
          this.config.request.log.error(
            { err: onCompleteError },
            'onComplete callback failed during error handling',
          );
        });
    } catch (onCompleteError) {
      this.config.request.log.error(
        { err: onCompleteError },
        'onComplete callback failed during error handling (outer catch)',
      );
    }
  }

  /**
   * Drain remaining parts from multipart iterator
   */
  private async drainMultipartIterator(
    filesIterator: AsyncIterableIterator<{
      file: Readable;
      fieldname: string;
      filename: string;
      encoding: string;
      mimetype: string;
    }>,
    drainTimeout: number = 1000,
  ): Promise<void> {
    try {
      await Promise.race([
        (async () => {
          for await (const remainingPart of filesIterator) {
            if (remainingPart.file && !remainingPart.file.destroyed) {
              remainingPart.file.destroy();
            }
          }
        })(),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error('Iterator drain timeout')),
            drainTimeout,
          ),
        ),
      ]);
    } catch (drainError) {
      this.config.request.log.warn(
        { err: drainError },
        'Failed to drain multipart iterator (timeout or error)',
      );
    }
  }

  /**
   * Build abort details with batch mode wrapping if needed
   */
  private buildAbortDetails(
    maxFiles: number,
    fileIndex: number,
    singleAbortReason: AbortReason,
    triggerReason: string,
    failureDetails: Record<string, unknown>,
  ): AbortReason {
    if (maxFiles > 1) {
      this.state.abortReason = 'batch_file_failed';
      this.state.abortDetails = {
        ...failureDetails,
        triggerReason,
        totalFiles: fileIndex + 1,
        processedFiles: this.state.processedFiles,
      };
      return 'batch_file_failed';
    } else {
      this.state.abortReason = singleAbortReason;
      this.state.abortDetails = failureDetails;
      return singleAbortReason;
    }
  }

  /**
   * Run file-specific cleanup handlers and remove them from batch-level list
   */
  private async runFileCleanupAndRemoveFromBatch(
    fileCleanupHandlers: Array<
      (
        reason: AbortReason,
        details?: Record<string, unknown>,
      ) => Promise<void> | void
    >,
    reason: AbortReason,
    details: Record<string, unknown> | undefined,
  ): Promise<void> {
    if (fileCleanupHandlers.length === 0) {
      return;
    }

    // Run only THIS FILE's cleanup handlers (not all handlers)
    const cleanupPromises = fileCleanupHandlers.map(async (handler) => {
      try {
        await handler(reason, details);
      } catch (cleanupError) {
        this.config.request.log.error(
          { err: cleanupError, reason, details },
          'File upload cleanup handler error',
        );
      }
    });

    await Promise.allSettled(cleanupPromises);

    // Remove these handlers from batch-level list to prevent double-cleanup
    const fileHandlersSet = new Set(fileCleanupHandlers);
    this.state.cleanupHandlers = this.state.cleanupHandlers.filter(
      (handler) => !fileHandlersSet.has(handler),
    );
  }

  /**
   * Get sanitized error message based on environment
   */
  private getSanitizedErrorMessage(error: unknown, fallback: string): string {
    const isDevelopment = (
      this.config.request as FastifyRequest & { isDevelopment?: boolean }
    ).isDevelopment;
    if (!isDevelopment) {
      return fallback;
    }

    // Extract error message in development mode
    if (error && typeof error === 'object' && 'message' in error) {
      const message = (error as { message: unknown }).message;
      return typeof message === 'string' ? message : fallback;
    }
    return fallback;
  }
}

/**
 * Process file upload(s) with validation, streaming, and cleanup handlers.
 *
 * @param config - Upload configuration
 * @returns UploadResult discriminated union (success or error)
 *
 * @example Single file upload
 * ```typescript
 * const result = await processFileUpload({
 *   request,
 *   reply,
 *   maxSizePerFile: 5 * 1024 * 1024, // 5MB
 *   allowedMimeTypes: ['image/jpeg', 'image/png'],
 *   processor: async (stream, metadata, context) => {
 *     const uploadID = generateID();
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
 * const result = await processFileUpload({
 *   request,
 *   reply,
 *   maxFiles: 5,
 *   maxSizePerFile: 10 * 1024 * 1024, // 10MB
 *   allowedMimeTypes: (mime) => {
 *     if (mime.startsWith('image/')) return { allowed: true };
 *     return { allowed: false, allowedTypes: ['image/*'] };
 *   },
 *   processor: async (stream, metadata, context) => {
 *     const uploadID = `${context.fileIndex}-${generateID()}`;
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
export async function processFileUpload<T = unknown>(
  config: FileUploadConfig<T>,
): Promise<UploadResult<T>> {
  const processor = new FileUploadProcessor(config);
  return processor.execute();
}
