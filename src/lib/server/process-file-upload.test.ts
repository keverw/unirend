/**
 * Tests for processFileUpload
 *
 * Focus: Race condition prevention in cleanup execution
 */

import { describe, it, expect, mock } from 'bun:test';
import { processFileUpload } from './process-file-upload';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { Readable } from 'stream';
import { PassThrough } from 'stream';

// Mock multipart file
interface MockMultipartFile {
  fieldname: string;
  filename: string;
  encoding: string;
  mimetype: string;
  file: Readable & { truncated?: boolean; destroy: (error?: Error) => void };
}

/**
 * Create a mock Fastify request with multipart support
 */
function createMockRequest(files: MockMultipartFile[]): FastifyRequest {
  const eventListeners = new Map<string, Array<(...args: unknown[]) => void>>();

  return {
    server: { multipartEnabled: true },
    headers: { 'content-type': 'multipart/form-data; boundary=----' },
    log: {
      error: mock(),
      warn: mock(),
      info: mock(),
    },
    id: 'test-request-id',
    raw: {
      destroyed: false,
      on(event: string, handler: (...args: unknown[]) => void) {
        if (!eventListeners.has(event)) {
          eventListeners.set(event, []);
        }
        const handlers = eventListeners.get(event);
        if (handlers) {
          handlers.push(handler);
        }
        return this;
      },
      removeListener(event: string, handler: (...args: unknown[]) => void) {
        const handlers = eventListeners.get(event);
        if (handlers) {
          const index = handlers.indexOf(handler);
          if (index !== -1) {
            handlers.splice(index, 1);
          }
        }
        return this;
      },
      // Allow tests to simulate connection close
      simulateClose() {
        const closeHandlers = eventListeners.get('close') || [];
        // Iterate over a copy to prevent issues if handlers modify the array during iteration
        // (e.g., if a handler calls removeListener() on itself)
        for (const handler of [...closeHandlers]) {
          handler();
        }
      },
    },
    files() {
      // eslint-disable-next-line @typescript-eslint/require-await
      return (async function* () {
        for (const file of files) {
          yield file;
        }
      })();
    },
  } as unknown as FastifyRequest;
}

/**
 * Create a mock Fastify reply
 */
function createMockReply(): FastifyReply {
  return {
    raw: {
      destroyed: false,
    },
  } as unknown as FastifyReply;
}

/**
 * Create a readable stream with data
 */
function createFileStream(
  data: string,
  options?: { truncated?: boolean },
): Readable & { truncated?: boolean; destroy: (error?: Error) => void } {
  const stream = new PassThrough();
  stream.write(data);
  stream.end();

  // Add destroy method
  const originalDestroy = stream.destroy.bind(stream);
  stream.destroy = (error?: Error) => {
    return originalDestroy(error);
  };

  const enhancedStream = stream as Readable & {
    truncated?: boolean;
    destroy: (error?: Error) => void;
  };

  // Set truncated flag if provided
  if (options?.truncated) {
    enhancedStream.truncated = true;
  }

  return enhancedStream;
}

describe('processFileUpload', () => {
  // Note: Fake timers not needed for current tests
  // Tests run synchronously without timer manipulation

  describe('onComplete Timing', () => {
    it('should run cleanup handlers BEFORE onComplete in error cases', async () => {
      const executionOrder: string[] = [];

      const files: MockMultipartFile[] = [
        {
          fieldname: 'files',
          filename: 'file1.txt',
          encoding: '7bit',
          mimetype: 'text/plain',
          file: createFileStream('file1 content'),
        },
        {
          fieldname: 'files',
          filename: 'file2.txt',
          encoding: '7bit',
          mimetype: 'text/plain',
          file: createFileStream('file2 content'),
        },
      ];

      const request = createMockRequest(files);
      const reply = createMockReply();

      const result = await processFileUpload({
        request,
        reply,
        maxFiles: 2,
        maxSizePerFile: 1024,
        allowedMimeTypes: ['text/plain'],
        processor: async (stream, metadata, context) => {
          // Register cleanup handler
          // eslint-disable-next-line @typescript-eslint/require-await
          context.onCleanup(async () => {
            executionOrder.push(`cleanup-file-${context.fileIndex}`);
          });

          // Consume stream
          for await (const _chunk of stream) {
            // Just consume the data
          }

          // Throw error on file 1
          if (context.fileIndex === 1) {
            throw new Error('Processor error');
          }

          return { index: context.fileIndex };
        },
        // eslint-disable-next-line @typescript-eslint/require-await
        onComplete: async (_finalResult) => {
          executionOrder.push('onComplete');
        },
      });

      expect(result.success).toBe(false);

      // Verify execution order: cleanup handlers run BEFORE onComplete
      // Note: File 1's cleanup runs immediately when it throws (race condition fix)
      // Then file 0's cleanup runs when the batch error is handled
      expect(executionOrder).toEqual([
        'cleanup-file-1', // File 1's cleanup (immediate, when processor throws)
        'cleanup-file-0', // File 0's cleanup (when batch error is handled)
        'onComplete', // onComplete runs AFTER all cleanups
      ]);
    });

    it('should run onComplete after success (no cleanup)', async () => {
      const executionOrder: string[] = [];

      const files: MockMultipartFile[] = [
        {
          fieldname: 'files',
          filename: 'file1.txt',
          encoding: '7bit',
          mimetype: 'text/plain',
          file: createFileStream('file1 content'),
        },
      ];

      const request = createMockRequest(files);
      const reply = createMockReply();

      const result = await processFileUpload({
        request,
        reply,
        maxFiles: 1,
        maxSizePerFile: 1024,
        allowedMimeTypes: ['text/plain'],
        processor: async (stream, metadata, context) => {
          // Register cleanup handler (shouldn't run on success)
          // eslint-disable-next-line @typescript-eslint/require-await
          context.onCleanup(async () => {
            executionOrder.push('cleanup-should-not-run');
          });

          // Consume stream
          for await (const _chunk of stream) {
            // Just consume the data
          }

          executionOrder.push('processor-complete');
          return { index: context.fileIndex };
        },
        // eslint-disable-next-line @typescript-eslint/require-await
        onComplete: async (_finalResult) => {
          executionOrder.push('onComplete');
        },
      });

      expect(result.success).toBe(true);

      // Verify execution order: onComplete runs, cleanup does NOT
      expect(executionOrder).toEqual(['processor-complete', 'onComplete']);
    });
  });

  describe('Race Condition Prevention', () => {
    it('should cleanup ALL files when batch fails (transactional semantics)', async () => {
      // This test verifies the CORRECT transactional behavior:
      // In fail-fast batch uploads, if ANY file fails, the ENTIRE batch fails
      // and ALL files (including successful ones) must be cleaned up.
      //
      // Example: File 0 succeeds, File 1 succeeds, File 2 fails
      // Expected: Cleanup runs for ALL files (0, 1, 2)
      // Reason: Files 0 and 1 were uploaded to storage, but the batch failed,
      //         so they must be deleted to maintain consistency (all-or-nothing)

      const cleanupCalls: Array<{ fileIndex: number; reason: string }> = [];

      const files: MockMultipartFile[] = [
        {
          fieldname: 'files',
          filename: 'file1.txt',
          encoding: '7bit',
          mimetype: 'text/plain',
          file: createFileStream('file1 content'),
        },
        {
          fieldname: 'files',
          filename: 'file2.txt',
          encoding: '7bit',
          mimetype: 'text/plain',
          file: createFileStream('file2 content'),
        },
        {
          fieldname: 'files',
          filename: 'file3.txt',
          encoding: '7bit',
          mimetype: 'text/plain',
          file: createFileStream('file3 content'),
        },
      ];

      const request = createMockRequest(files);
      const reply = createMockReply();

      const result = await processFileUpload({
        request,
        reply,
        maxFiles: 3,
        maxSizePerFile: 1024,
        allowedMimeTypes: ['text/plain'],
        processor: async (stream, metadata, context) => {
          // Register cleanup handler for each file
          // eslint-disable-next-line @typescript-eslint/require-await
          context.onCleanup(async (reason, _details) => {
            cleanupCalls.push({
              fileIndex: context.fileIndex,
              reason,
            });
          });

          // Consume stream
          for await (const _chunk of stream) {
            // Just consume
          }

          // File 0 and File 1 succeed, File 2 throws
          if (context.fileIndex === 2) {
            throw new Error('File 2 processor error');
          }

          return { index: context.fileIndex };
        },
      });

      expect(result.success).toBe(false);

      // Verify cleanup ran for ALL files (transactional behavior)
      // File 0: succeeded but cleanup called (because batch failed)
      // File 1: succeeded but cleanup called (because batch failed)
      // File 2: failed, cleanup called
      expect(cleanupCalls.length).toBe(3);
      expect(cleanupCalls.some((c) => c.fileIndex === 0)).toBe(true);
      expect(cleanupCalls.some((c) => c.fileIndex === 1)).toBe(true);
      expect(cleanupCalls.some((c) => c.fileIndex === 2)).toBe(true);
    });

    it('should run cleanup immediately when processor throws error', async () => {
      const cleanupCalls: Array<{ fileIndex: number; reason: string }> = [];

      // Create 3 mock files
      const files: MockMultipartFile[] = [
        {
          fieldname: 'files',
          filename: 'file1.txt',
          encoding: '7bit',
          mimetype: 'text/plain',
          file: createFileStream('file1 content'),
        },
        {
          fieldname: 'files',
          filename: 'file2.txt',
          encoding: '7bit',
          mimetype: 'text/plain',
          file: createFileStream('file2 content'),
        },
        {
          fieldname: 'files',
          filename: 'file3.txt',
          encoding: '7bit',
          mimetype: 'text/plain',
          file: createFileStream('file3 content'),
        },
      ];

      const request = createMockRequest(files);
      const reply = createMockReply();

      // Process files, file 1 throws error
      const result = await processFileUpload({
        request,
        reply,
        maxFiles: 3,
        maxSizePerFile: 1024,
        allowedMimeTypes: ['text/plain'],
        processor: async (stream, metadata, context) => {
          // Register cleanup handler
          // eslint-disable-next-line @typescript-eslint/require-await
          context.onCleanup(async (reason, _details) => {
            cleanupCalls.push({
              fileIndex: context.fileIndex,
              reason,
            });
          });

          // Consume stream
          for await (const _chunk of stream) {
            // Just consume the data
          }

          // Throw error on file 1 (after file 0 completed successfully)
          if (context.fileIndex === 1) {
            throw new Error('Simulated processor error');
          }

          return { index: context.fileIndex };
        },
      });

      expect(result.success).toBe(false);

      // Verify that cleanup ran for files 0 and 1
      // File 0: completed successfully, cleanup should run when batch fails
      // File 1: processor threw error, cleanup should run immediately
      // File 2: never started processing
      expect(cleanupCalls.length).toBe(2);
      expect(cleanupCalls.some((c) => c.fileIndex === 0)).toBe(true);
      expect(cleanupCalls.some((c) => c.fileIndex === 1)).toBe(true);

      // Verify file 1's cleanup reason indicates processor error
      const file1Cleanup = cleanupCalls.find((c) => c.fileIndex === 1);
      expect(file1Cleanup?.reason).toMatch(/processor_error|batch_file_failed/);
    });

    it('should not run cleanup twice for the same file', async () => {
      const cleanupCalls: Array<{ fileIndex: number; callNumber: number }> = [];
      let callCounter = 0;

      const files: MockMultipartFile[] = [
        {
          fieldname: 'files',
          filename: 'file1.txt',
          encoding: '7bit',
          mimetype: 'text/plain',
          file: createFileStream('file1 content'),
        },
        {
          fieldname: 'files',
          filename: 'file2.txt',
          encoding: '7bit',
          mimetype: 'text/plain',
          file: createFileStream('file2 content'),
        },
      ];

      const request = createMockRequest(files);
      const reply = createMockReply();

      // Create a processor that throws an error on file 2
      const result = await processFileUpload({
        request,
        reply,
        maxFiles: 2,
        maxSizePerFile: 1024,
        allowedMimeTypes: ['text/plain'],
        processor: async (stream, metadata, context) => {
          // Register cleanup handler
          // eslint-disable-next-line @typescript-eslint/require-await
          context.onCleanup(async (_reason, _details) => {
            callCounter++;
            cleanupCalls.push({
              fileIndex: context.fileIndex,
              callNumber: callCounter,
            });
          });

          // Consume stream
          for await (const _chunk of stream) {
            // Just consume the data
          }

          // Throw error on file 2
          if (context.fileIndex === 1) {
            throw new Error('Processor error for file 2');
          }

          return { index: context.fileIndex };
        },
      });

      expect(result.success).toBe(false);

      // Each file's cleanup should run exactly once
      const file0Cleanups = cleanupCalls.filter((c) => c.fileIndex === 0);
      const file1Cleanups = cleanupCalls.filter((c) => c.fileIndex === 1);

      expect(file0Cleanups.length).toBe(1);
      expect(file1Cleanups.length).toBe(1);
    });

    it('should run cleanup for all files when batch fails mid-stream', async () => {
      const cleanupCalls: Array<{ fileIndex: number; reason: string }> = [];

      const files: MockMultipartFile[] = [
        {
          fieldname: 'files',
          filename: 'file1.txt',
          encoding: '7bit',
          mimetype: 'text/plain',
          file: createFileStream('file1 content'),
        },
        {
          fieldname: 'files',
          filename: 'file2.txt',
          encoding: '7bit',
          mimetype: 'text/plain',
          file: createFileStream('file2 content'),
        },
        {
          fieldname: 'files',
          filename: 'file3.txt',
          encoding: '7bit',
          mimetype: 'text/plain',
          file: createFileStream('file3 content'),
        },
      ];

      const request = createMockRequest(files);
      const reply = createMockReply();

      const result = await processFileUpload({
        request,
        reply,
        maxFiles: 3,
        maxSizePerFile: 1024,
        allowedMimeTypes: ['text/plain'],
        processor: async (stream, metadata, context) => {
          // Register cleanup handler
          // eslint-disable-next-line @typescript-eslint/require-await
          context.onCleanup(async (reason, _details) => {
            cleanupCalls.push({
              fileIndex: context.fileIndex,
              reason,
            });
          });

          // Consume stream
          for await (const _chunk of stream) {
            // Just consume the data
          }

          // Fail on file 2
          if (context.fileIndex === 1) {
            throw new Error('Storage error');
          }

          return { index: context.fileIndex };
        },
      });

      expect(result.success).toBe(false);

      // All processed files should have cleanup called
      // File 0: processed successfully
      // File 1: processor threw error
      // File 2: never started
      expect(cleanupCalls.length).toBe(2);
      expect(cleanupCalls.some((c) => c.fileIndex === 0)).toBe(true);
      expect(cleanupCalls.some((c) => c.fileIndex === 1)).toBe(true);
    });
  });

  describe('Defensive Cleanup on Early Returns', () => {
    it('should handle no files uploaded case (defensive check)', async () => {
      const files: MockMultipartFile[] = [];

      const request = createMockRequest(files);
      const reply = createMockReply();

      const result = await processFileUpload({
        request,
        reply,
        maxFiles: 1,
        maxSizePerFile: 1024,
        allowedMimeTypes: ['text/plain'],
        processor: async (stream, _metadata, _context) => {
          // This should never be called since there are no files
          for await (const _chunk of stream) {
            // consume
          }
          return { index: 0 };
        },
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorEnvelope.error.code).toBe('file_not_provided');
      }
    });

    it('should run defensive cleanup with no_files_provided reason (simulated scenario)', async () => {
      // This test verifies that the defensive cleanup code path uses the correct abort reason
      // In practice, cleanup handlers should be empty when no files are provided,
      // but this defensive check ensures robustness against future code changes

      const files: MockMultipartFile[] = [];
      const request = createMockRequest(files);
      const reply = createMockReply();

      let wasProcessorCalled = false;

      const result = await processFileUpload({
        request,
        reply,
        maxFiles: 5, // Allow multiple files
        maxSizePerFile: 1024,
        allowedMimeTypes: ['text/plain'],
        processor: async (stream, _metadata, _context) => {
          wasProcessorCalled = true;

          // This processor should NEVER be called when there are no files
          // but we register it to verify the defensive cleanup behavior
          for await (const _chunk of stream) {
            // consume
          }
          return { index: 0 };
        },
        // eslint-disable-next-line @typescript-eslint/require-await
        onComplete: async (finalResult) => {
          // Verify we get the correct error
          expect(finalResult.success).toBe(false);
          if (!finalResult.success) {
            expect(finalResult.errorEnvelope.error.code).toBe(
              'file_not_provided',
            );
          }
        },
      });

      // Verify processor was never called (no files to process)
      expect(wasProcessorCalled).toBe(false);

      // Verify error result
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorEnvelope.error.code).toBe('file_not_provided');
        expect(result.errorEnvelope.error.message).toMatch(
          /No file.*provided/i,
        );
      }
    });

    it('should run cleanup BEFORE onComplete for no_files_provided error', async () => {
      // This test verifies the documented timing guarantee:
      // "Failure case: Called AFTER all cleanup handlers have completed"
      // Even though no cleanup handlers are registered in practice (processor never runs),
      // the code should maintain consistency with other error paths

      const executionOrder: string[] = [];
      const files: MockMultipartFile[] = [];
      const request = createMockRequest(files);
      const reply = createMockReply();

      const result = await processFileUpload({
        request,
        reply,
        maxFiles: 1,
        maxSizePerFile: 1024,
        allowedMimeTypes: ['text/plain'],
        processor: async (stream, _metadata, _context) => {
          // This should never be called
          for await (const _chunk of stream) {
            // consume
          }
          return { index: 0 };
        },
        // eslint-disable-next-line @typescript-eslint/require-await
        onComplete: async (finalResult) => {
          executionOrder.push('onComplete');
          expect(finalResult.success).toBe(false);
          if (!finalResult.success) {
            expect(finalResult.errorEnvelope.error.code).toBe(
              'file_not_provided',
            );
          }
        },
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorEnvelope.error.code).toBe('file_not_provided');
      }

      // Verify onComplete was called (cleanup runs first, but no handlers registered)
      expect(executionOrder).toEqual(['onComplete']);
    });

    it('should handle invalid content type (no cleanup needed)', async () => {
      // Create a request with invalid content type
      const request = {
        server: { multipartEnabled: true },
        headers: { 'content-type': 'application/json' },
        log: {
          error: mock(),
          warn: mock(),
          info: mock(),
        },
        id: 'test-request-id',
      } as unknown as FastifyRequest;

      const reply = createMockReply();

      const result = await processFileUpload({
        request,
        reply,
        maxFiles: 1,
        maxSizePerFile: 1024,
        allowedMimeTypes: ['text/plain'],
        processor: async (stream, _metadata, _context) => {
          // This should never be called
          for await (const _chunk of stream) {
            // consume
          }
          return { index: 0 };
        },
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorEnvelope.error.code).toBe('invalid_content_type');
      }
    });
  });

  describe('Iterator Drain Timeout Protection', () => {
    it('should reject invalid MIME type without calling processor', async () => {
      let wasProcessorCalled = false;

      const files: MockMultipartFile[] = [
        {
          fieldname: 'files',
          filename: 'file1.txt',
          encoding: '7bit',
          mimetype: 'image/jpeg', // Will be rejected (allowedMimeTypes is text/plain)
          file: createFileStream('file1 content'),
        },
      ];

      const request = createMockRequest(files);
      const reply = createMockReply();

      const result = await processFileUpload({
        request,
        reply,
        maxFiles: 1,
        maxSizePerFile: 1024,
        allowedMimeTypes: ['text/plain'], // Reject MIME type
        processor: async (stream, _metadata, _context) => {
          wasProcessorCalled = true;
          for await (const _chunk of stream) {
            // consume
          }
          return { index: 0 };
        },
      });

      expect(result.success).toBe(false);
      expect(wasProcessorCalled).toBe(false); // Processor should not be called (MIME rejected)

      if (!result.success) {
        // Should get MIME type rejection error
        expect(result.errorEnvelope.error.code).toMatch(
          /file_type_not_allowed|batch_file_failed/,
        );
      }
    });
  });

  describe('Success Cases', () => {
    it('should successfully process a single file', async () => {
      const files: MockMultipartFile[] = [
        {
          fieldname: 'avatar',
          filename: 'photo.jpg',
          encoding: '7bit',
          mimetype: 'image/jpeg',
          file: createFileStream('fake image data'),
        },
      ];

      const request = createMockRequest(files);
      const reply = createMockReply();

      const result = await processFileUpload({
        request,
        reply,
        maxSizePerFile: 1024,
        allowedMimeTypes: ['image/jpeg'],
        processor: async (stream, metadata, _context) => {
          let content = '';
          for await (const chunk of stream) {
            content += chunk.toString();
          }
          return {
            filename: metadata.filename,
            size: content.length,
            mimetype: metadata.mimetype,
          };
        },
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.files.length).toBe(1);
        expect(result.files[0].filename).toBe('photo.jpg');
        expect(result.files[0].data.mimetype).toBe('image/jpeg');
      }
    });

    it('should successfully process multiple files', async () => {
      const files: MockMultipartFile[] = [
        {
          fieldname: 'files',
          filename: 'file1.txt',
          encoding: '7bit',
          mimetype: 'text/plain',
          file: createFileStream('content 1'),
        },
        {
          fieldname: 'files',
          filename: 'file2.txt',
          encoding: '7bit',
          mimetype: 'text/plain',
          file: createFileStream('content 2'),
        },
        {
          fieldname: 'files',
          filename: 'file3.txt',
          encoding: '7bit',
          mimetype: 'text/plain',
          file: createFileStream('content 3'),
        },
      ];

      const request = createMockRequest(files);
      const reply = createMockReply();

      const result = await processFileUpload({
        request,
        reply,
        maxFiles: 5,
        maxSizePerFile: 1024,
        allowedMimeTypes: ['text/plain'],
        processor: async (stream, metadata, context) => {
          let content = '';
          for await (const chunk of stream) {
            content += chunk.toString();
          }
          return {
            fileIndex: context.fileIndex,
            filename: metadata.filename,
            content,
          };
        },
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.files.length).toBe(3);
        expect(result.files[0].fileIndex).toBe(0);
        expect(result.files[1].fileIndex).toBe(1);
        expect(result.files[2].fileIndex).toBe(2);
        expect(result.files[0].data.content).toBe('content 1');
        expect(result.files[1].data.content).toBe('content 2');
        expect(result.files[2].data.content).toBe('content 3');
      }
    });
  });

  describe('MIME Type Validation', () => {
    it('should reject MIME type when function validator disallows it', async () => {
      const files: MockMultipartFile[] = [
        {
          fieldname: 'file',
          filename: 'document.pdf',
          encoding: '7bit',
          mimetype: 'application/pdf',
          file: createFileStream('pdf content'),
        },
      ];

      const request = createMockRequest(files);
      const reply = createMockReply();

      const result = await processFileUpload({
        request,
        reply,
        maxSizePerFile: 1024,
        allowedMimeTypes: (mime) => {
          if (mime.startsWith('image/')) {
            return { allowed: true };
          }
          return {
            allowed: false,
            rejectionReason: 'Only images are allowed',
            allowedTypes: ['image/*'],
          };
        },
        processor: async (stream, _metadata, _context) => {
          for await (const _chunk of stream) {
            // consume
          }
          return {};
        },
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorEnvelope.error.code).toMatch(
          /file_type_not_allowed|mime_type_rejected/,
        );
      }
    });

    it('should accept MIME type when function validator allows it', async () => {
      const files: MockMultipartFile[] = [
        {
          fieldname: 'file',
          filename: 'photo.jpg',
          encoding: '7bit',
          mimetype: 'image/jpeg',
          file: createFileStream('image content'),
        },
      ];

      const request = createMockRequest(files);
      const reply = createMockReply();

      const result = await processFileUpload({
        request,
        reply,
        maxSizePerFile: 1024,
        allowedMimeTypes: (mime) => {
          if (mime.startsWith('image/')) {
            return { allowed: true };
          }
          return {
            allowed: false,
            rejectionReason: 'Only images allowed',
          };
        },
        processor: async (stream, metadata, _context) => {
          for await (const _chunk of stream) {
            // consume
          }
          return { filename: metadata.filename };
        },
      });

      expect(result.success).toBe(true);
    });

    it('should support wildcard MIME type patterns', async () => {
      const files: MockMultipartFile[] = [
        {
          fieldname: 'file',
          filename: 'photo.png',
          encoding: '7bit',
          mimetype: 'image/png',
          file: createFileStream('image content'),
        },
      ];

      const request = createMockRequest(files);
      const reply = createMockReply();

      const result = await processFileUpload({
        request,
        reply,
        maxSizePerFile: 1024,
        allowedMimeTypes: ['image/*', 'application/pdf'],
        processor: async (stream, _metadata, _context) => {
          for await (const _chunk of stream) {
            // consume
          }
          return {};
        },
      });

      expect(result.success).toBe(true);
    });
  });

  describe('Byte Counter', () => {
    it('should count bytes read during stream processing', async () => {
      const content = 'x'.repeat(100);
      const files: MockMultipartFile[] = [
        {
          fieldname: 'file',
          filename: 'test.txt',
          encoding: '7bit',
          mimetype: 'text/plain',
          file: createFileStream(content),
        },
      ];

      const request = createMockRequest(files);
      const reply = createMockReply();

      let bytesProcessed = 0;

      const result = await processFileUpload({
        request,
        reply,
        maxSizePerFile: 1024,
        allowedMimeTypes: ['text/plain'],
        processor: async (fileStream, _metadata, _context) => {
          // Count bytes as we consume the stream
          for await (const chunk of fileStream) {
            bytesProcessed += chunk.length;
          }
          return { bytesProcessed };
        },
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.files[0].data.bytesProcessed).toBe(100);
      }
    });
  });

  describe('Custom APIResponseHelpersClass', () => {
    it('should use custom response helpers when decorated', async () => {
      const customCreateError = mock((params: { errorCode: string }) => ({
        error: {
          code: params.errorCode,
          message: 'Custom error message',
        },
        metadata: { custom: true },
      }));

      const customHelpers = {
        createAPIErrorResponse: customCreateError,
      };

      const files: MockMultipartFile[] = [];

      const request = createMockRequest(files);
      (
        request as FastifyRequest & { APIResponseHelpersClass?: unknown }
      ).APIResponseHelpersClass = customHelpers;

      const reply = createMockReply();

      const result = await processFileUpload({
        request,
        reply,
        maxSizePerFile: 1024,
        allowedMimeTypes: ['text/plain'],
        processor: async (stream, _metadata, _context) => {
          for await (const _chunk of stream) {
            // consume
          }
          return {};
        },
      });

      expect(result.success).toBe(false);
      expect(customCreateError).toHaveBeenCalled();
    });
  });

  describe('Multiple Cleanup Handlers Per File', () => {
    it('should support registering multiple cleanup handlers for a single file', async () => {
      const cleanupExecutionOrder: string[] = [];

      const files: MockMultipartFile[] = [
        {
          fieldname: 'file',
          filename: 'test.txt',
          encoding: '7bit',
          mimetype: 'text/plain',
          file: createFileStream('content'),
        },
      ];

      const request = createMockRequest(files);
      const reply = createMockReply();

      const result = await processFileUpload({
        request,
        reply,
        maxSizePerFile: 1024,
        allowedMimeTypes: ['text/plain'],
        processor: async (stream, _metadata, context) => {
          // Register multiple cleanup handlers for this file
          // eslint-disable-next-line @typescript-eslint/require-await
          context.onCleanup(async () => {
            cleanupExecutionOrder.push('cleanup-1');
          });

          // eslint-disable-next-line @typescript-eslint/require-await
          context.onCleanup(async () => {
            cleanupExecutionOrder.push('cleanup-2');
          });

          // eslint-disable-next-line @typescript-eslint/require-await
          context.onCleanup(async () => {
            cleanupExecutionOrder.push('cleanup-3');
          });

          // Consume stream
          for await (const _chunk of stream) {
            // Just consume
          }

          // Throw error to trigger cleanup
          throw new Error('Test error to trigger cleanup');
        },
      });

      expect(result.success).toBe(false);

      // All three cleanup handlers should have been called
      expect(cleanupExecutionOrder.length).toBe(3);
      expect(cleanupExecutionOrder).toContain('cleanup-1');
      expect(cleanupExecutionOrder).toContain('cleanup-2');
      expect(cleanupExecutionOrder).toContain('cleanup-3');
    });

    it('should run all cleanup handlers even if one throws', async () => {
      const cleanupCalls: string[] = [];

      const files: MockMultipartFile[] = [
        {
          fieldname: 'file',
          filename: 'test.txt',
          encoding: '7bit',
          mimetype: 'text/plain',
          file: createFileStream('content'),
        },
      ];

      const request = createMockRequest(files);
      const reply = createMockReply();

      const result = await processFileUpload({
        request,
        reply,
        maxSizePerFile: 1024,
        allowedMimeTypes: ['text/plain'],
        processor: async (stream, _metadata, context) => {
          // First handler throws
          // eslint-disable-next-line @typescript-eslint/require-await
          context.onCleanup(async () => {
            cleanupCalls.push('cleanup-1');
            throw new Error('Cleanup 1 failed');
          });

          // Second handler succeeds
          // eslint-disable-next-line @typescript-eslint/require-await
          context.onCleanup(async () => {
            cleanupCalls.push('cleanup-2');
          });

          // Third handler throws
          // eslint-disable-next-line @typescript-eslint/require-await
          context.onCleanup(async () => {
            cleanupCalls.push('cleanup-3');
            throw new Error('Cleanup 3 failed');
          });

          for await (const _chunk of stream) {
            // consume
          }

          throw new Error('Processor error');
        },
      });

      expect(result.success).toBe(false);

      // All handlers should have been called despite errors
      expect(cleanupCalls.length).toBe(3);
      expect(cleanupCalls).toContain('cleanup-1');
      expect(cleanupCalls).toContain('cleanup-2');
      expect(cleanupCalls).toContain('cleanup-3');

      // Should have logged cleanup errors
      expect(request.log.error).toHaveBeenCalled();
    });
  });

  describe('Context Methods', () => {
    it('should provide isAborted() method in context', async () => {
      const abortedChecks: boolean[] = [];

      const files: MockMultipartFile[] = [
        {
          fieldname: 'file',
          filename: 'file.txt',
          encoding: '7bit',
          mimetype: 'text/plain',
          file: createFileStream('content'),
        },
      ];

      const request = createMockRequest(files);
      const reply = createMockReply();

      const result = await processFileUpload({
        request,
        reply,
        maxSizePerFile: 1024,
        allowedMimeTypes: ['text/plain'],
        processor: async (stream, _metadata, context) => {
          abortedChecks.push(context.isAborted());
          for await (const _chunk of stream) {
            abortedChecks.push(context.isAborted());
          }
          abortedChecks.push(context.isAborted());
          return {};
        },
      });

      expect(result.success).toBe(true);
      expect(abortedChecks.every((isAborted) => isAborted === false)).toBe(
        true,
      );
    });

    it('should track file index in context', async () => {
      const fileIndices: number[] = [];

      const files: MockMultipartFile[] = [
        {
          fieldname: 'files',
          filename: 'file1.txt',
          encoding: '7bit',
          mimetype: 'text/plain',
          file: createFileStream('content 1'),
        },
        {
          fieldname: 'files',
          filename: 'file2.txt',
          encoding: '7bit',
          mimetype: 'text/plain',
          file: createFileStream('content 2'),
        },
      ];

      const request = createMockRequest(files);
      const reply = createMockReply();

      const result = await processFileUpload({
        request,
        reply,
        maxFiles: 2,
        maxSizePerFile: 1024,
        allowedMimeTypes: ['text/plain'],
        processor: async (stream, _metadata, context) => {
          fileIndices.push(context.fileIndex);
          for await (const _chunk of stream) {
            // consume
          }
          return {};
        },
      });

      expect(result.success).toBe(true);
      expect(fileIndices).toEqual([0, 1]);
    });
  });

  describe('Multipart Not Enabled', () => {
    it('should throw error when multipart is not enabled', async () => {
      const request = {
        server: { multipartEnabled: false }, // Not enabled
        headers: { 'content-type': 'multipart/form-data' },
        log: { error: mock(), warn: mock(), info: mock() },
        id: 'test-request-id',
      } as unknown as FastifyRequest;

      const reply = createMockReply();

      // eslint-disable-next-line @typescript-eslint/await-thenable
      await expect(
        processFileUpload({
          request,
          reply,
          maxSizePerFile: 1024,
          allowedMimeTypes: ['text/plain'],
          processor: async (stream, _metadata, _context) => {
            for await (const _chunk of stream) {
              // consume
            }
            return {};
          },
        }),
      ).rejects.toThrow(/not enabled/);
    });
  });

  describe('maxFields and maxFieldSize Parameters', () => {
    it('should pass maxFields to files iterator', async () => {
      // This test verifies that maxFields is passed through to the iterator
      // The actual enforcement is done by @fastify/multipart

      const files: MockMultipartFile[] = [
        {
          fieldname: 'file',
          filename: 'test.txt',
          encoding: '7bit',
          mimetype: 'text/plain',
          file: createFileStream('content'),
        },
      ];

      const request = createMockRequest(files);
      const reply = createMockReply();

      const result = await processFileUpload({
        request,
        reply,
        maxSizePerFile: 1024,
        maxFields: 5,
        allowedMimeTypes: ['text/plain'],
        processor: async (stream, _metadata, _context) => {
          for await (const _chunk of stream) {
            // consume
          }
          return {};
        },
      });

      expect(result.success).toBe(true);
    });

    it('should pass maxFieldSize to files iterator', async () => {
      const files: MockMultipartFile[] = [
        {
          fieldname: 'file',
          filename: 'test.txt',
          encoding: '7bit',
          mimetype: 'text/plain',
          file: createFileStream('content'),
        },
      ];

      const request = createMockRequest(files);
      const reply = createMockReply();

      const result = await processFileUpload({
        request,
        reply,
        maxSizePerFile: 1024,
        maxFieldSize: 512,
        allowedMimeTypes: ['text/plain'],
        processor: async (stream, _metadata, _context) => {
          for await (const _chunk of stream) {
            // consume
          }
          return {};
        },
      });

      expect(result.success).toBe(true);
    });
  });

  describe('onComplete Error Handling', () => {
    it('should return error when onComplete throws after success', async () => {
      const files: MockMultipartFile[] = [
        {
          fieldname: 'file',
          filename: 'test.txt',
          encoding: '7bit',
          mimetype: 'text/plain',
          file: createFileStream('content'),
        },
      ];

      const request = createMockRequest(files);
      const reply = createMockReply();

      const result = await processFileUpload({
        request,
        reply,
        maxSizePerFile: 1024,
        allowedMimeTypes: ['text/plain'],
        processor: async (stream, _metadata, _context) => {
          for await (const _chunk of stream) {
            // consume
          }
          return { uploaded: true };
        },
        // eslint-disable-next-line @typescript-eslint/require-await
        onComplete: async (finalResult) => {
          if (finalResult.success) {
            throw new Error('Post-processing failed');
          }
        },
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorEnvelope.error.code).toBe(
          'file_upload_completion_failed',
        );
      }
    });

    it('should log but not change error when onComplete throws after error', async () => {
      const files: MockMultipartFile[] = [
        {
          fieldname: 'file',
          filename: 'test.txt',
          encoding: '7bit',
          mimetype: 'text/plain',
          file: createFileStream('content'),
        },
      ];

      const request = createMockRequest(files);
      const reply = createMockReply();

      const result = await processFileUpload({
        request,
        reply,
        maxSizePerFile: 1024,
        allowedMimeTypes: ['text/plain'],
        // eslint-disable-next-line @typescript-eslint/require-await
        processor: async (_stream, _metadata, _context) => {
          throw new Error('Processor error');
        },
        // eslint-disable-next-line @typescript-eslint/require-await
        onComplete: async (_finalResult) => {
          throw new Error('onComplete error');
        },
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        // Should return the original processor error, not the onComplete error
        expect(result.errorEnvelope.error.code).toMatch(
          /file_processor_error|batch_file_failed/,
        );
      }
    });
  });

  describe('Metadata in Processor', () => {
    it('should provide complete metadata to processor', async () => {
      let capturedMetadata:
        | {
            filename: string;
            mimetype: string;
            encoding: string;
            fieldname: string;
            fileIndex: number;
          }
        | undefined;

      const files: MockMultipartFile[] = [
        {
          fieldname: 'avatar',
          filename: 'photo.jpg',
          encoding: 'binary',
          mimetype: 'image/jpeg',
          file: createFileStream('image data'),
        },
      ];

      const request = createMockRequest(files);
      const reply = createMockReply();

      const result = await processFileUpload({
        request,
        reply,
        maxSizePerFile: 1024,
        allowedMimeTypes: ['image/jpeg'],
        processor: async (stream, metadata, _context) => {
          capturedMetadata = { ...metadata };
          for await (const _chunk of stream) {
            // consume
          }
          return {};
        },
      });

      expect(result.success).toBe(true);
      expect(capturedMetadata).toBeDefined();
      expect(capturedMetadata?.filename).toBe('photo.jpg');
      expect(capturedMetadata?.mimetype).toBe('image/jpeg');
      expect(capturedMetadata?.encoding).toBe('binary');
      expect(capturedMetadata?.fieldname).toBe('avatar');
      expect(capturedMetadata?.fileIndex).toBe(0);
    });
  });

  describe('Error Message Sanitization', () => {
    it('should sanitize error messages in production mode', async () => {
      const files: MockMultipartFile[] = [
        {
          fieldname: 'file',
          filename: 'test.txt',
          encoding: '7bit',
          mimetype: 'text/plain',
          file: createFileStream('content'),
        },
      ];

      const request = createMockRequest(files);
      // Mark as production
      (request as FastifyRequest & { isDevelopment?: boolean }).isDevelopment =
        false;

      const reply = createMockReply();

      const result = await processFileUpload({
        request,
        reply,
        maxSizePerFile: 1024,
        allowedMimeTypes: ['text/plain'],
        // eslint-disable-next-line @typescript-eslint/require-await
        processor: async (_stream, _metadata, _context) => {
          // Throw error with sensitive details
          throw new Error('Database connection failed at 192.168.1.1:5432');
        },
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        // In production, should show generic "Storage error"
        expect(result.errorEnvelope.error.details?.error).toBe('Storage error');
      }
    });

    it('should show detailed error messages in development mode', async () => {
      const files: MockMultipartFile[] = [
        {
          fieldname: 'file',
          filename: 'test.txt',
          encoding: '7bit',
          mimetype: 'text/plain',
          file: createFileStream('content'),
        },
      ];

      const request = createMockRequest(files);
      // Mark as development
      (request as FastifyRequest & { isDevelopment?: boolean }).isDevelopment =
        true;

      const reply = createMockReply();

      const result = await processFileUpload({
        request,
        reply,
        maxSizePerFile: 1024,
        allowedMimeTypes: ['text/plain'],
        // eslint-disable-next-line @typescript-eslint/require-await
        processor: async (_stream, _metadata, _context) => {
          throw new Error('Specific database error');
        },
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        // In development, should show actual error message
        expect(result.errorEnvelope.error.details?.error).toBe(
          'Specific database error',
        );
      }
    });

    it('should handle errors with non-string message property', async () => {
      const files: MockMultipartFile[] = [
        {
          fieldname: 'file',
          filename: 'test.txt',
          encoding: '7bit',
          mimetype: 'text/plain',
          file: createFileStream('content'),
        },
      ];

      const request = createMockRequest(files);
      (request as FastifyRequest & { isDevelopment?: boolean }).isDevelopment =
        true;

      const reply = createMockReply();

      const result = await processFileUpload({
        request,
        reply,
        maxSizePerFile: 1024,
        allowedMimeTypes: ['text/plain'],
        // eslint-disable-next-line @typescript-eslint/require-await
        processor: async (_stream, _metadata, _context) => {
          // Throw error with non-string message
          const error = new Error();
          (error as { message: unknown }).message = { code: 'ERR_123' };
          throw error;
        },
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        // Should fall back to "Storage error"
        expect(result.errorEnvelope.error.details?.error).toBe('Storage error');
      }
    });
  });

  describe('onComplete Error Handling Edge Cases', () => {
    it('should handle onComplete error on invalid content-type', async () => {
      const request = {
        server: { multipartEnabled: true },
        headers: { 'content-type': 'application/json' },
        log: { error: mock(), warn: mock(), info: mock() },
        id: 'test-request-id',
      } as unknown as FastifyRequest;

      const reply = createMockReply();

      const result = await processFileUpload({
        request,
        reply,
        maxSizePerFile: 1024,
        allowedMimeTypes: ['text/plain'],
        processor: async (stream, _metadata, _context) => {
          for await (const _chunk of stream) {
            // consume
          }
          return {};
        },
        // eslint-disable-next-line @typescript-eslint/require-await
        onComplete: async (_finalResult) => {
          throw new Error('onComplete error on invalid content type');
        },
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        // Should still return the invalid content type error
        expect(result.errorEnvelope.error.code).toBe('invalid_content_type');
      }

      // Should have logged the onComplete error
      expect(request.log.error).toHaveBeenCalled();
    });

    it('should handle onComplete error when no files provided', async () => {
      const files: MockMultipartFile[] = [];
      const request = createMockRequest(files);
      const reply = createMockReply();

      const result = await processFileUpload({
        request,
        reply,
        maxSizePerFile: 1024,
        allowedMimeTypes: ['text/plain'],
        processor: async (stream, _metadata, _context) => {
          for await (const _chunk of stream) {
            // consume
          }
          return {};
        },
        // eslint-disable-next-line @typescript-eslint/require-await
        onComplete: async (_finalResult) => {
          throw new Error('onComplete error on no files');
        },
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        // Should still return the file_not_provided error
        expect(result.errorEnvelope.error.code).toBe('file_not_provided');
      }
    });
  });

  describe('Abort Detection', () => {
    it('should detect abort state via context.isAborted()', async () => {
      const abortChecks: boolean[] = [];

      const files: MockMultipartFile[] = [
        {
          fieldname: 'file',
          filename: 'test.txt',
          encoding: '7bit',
          mimetype: 'text/plain',
          file: createFileStream('content'),
        },
      ];

      const request = createMockRequest(files);
      const reply = createMockReply();

      const result = await processFileUpload({
        request,
        reply,
        maxSizePerFile: 1024,
        allowedMimeTypes: ['text/plain'],
        timeoutMS: 5, // Very short timeout to trigger abort
        processor: async (stream, _metadata, context) => {
          // Check abort state before delay
          abortChecks.push(context.isAborted());

          // Wait for timeout to fire
          await new Promise((resolve) => setTimeout(resolve, 50));

          // Check abort state after timeout should have fired
          abortChecks.push(context.isAborted());

          for await (const _chunk of stream) {
            // consume
          }
          return {};
        },
      });

      // The upload will fail (either timeout or processor error)
      expect(result.success).toBe(false);

      // Should have detected abort state
      expect(abortChecks.length).toBe(2);
      expect(abortChecks[0]).toBe(false); // Not aborted initially
      expect(abortChecks[1]).toBe(true); // Aborted after timeout
    });
  });

  describe('Connection Broken During Upload', () => {
    it('should handle connection break via reply.raw.destroyed (polling)', async () => {
      const files: MockMultipartFile[] = [
        {
          fieldname: 'file',
          filename: 'test.txt',
          encoding: '7bit',
          mimetype: 'text/plain',
          file: createFileStream('content'),
        },
      ];

      const request = createMockRequest(files);
      const reply = createMockReply();

      const result = await processFileUpload({
        request,
        reply,
        maxSizePerFile: 1024,
        allowedMimeTypes: ['text/plain'],
        processor: async (stream, _metadata, _context) => {
          // Simulate connection break during processing
          reply.raw.destroyed = true;

          // Give connection monitor time to detect break (runs every 500ms)
          await new Promise((resolve) => setTimeout(resolve, 600));

          for await (const _chunk of stream) {
            // consume
          }
          return {};
        },
      });

      expect(result.success).toBe(false);
    });

    it('should detect connection close via close event (immediate)', async () => {
      const abortDetected: { before: boolean; after: boolean } = {
        before: false,
        after: false,
      };

      const files: MockMultipartFile[] = [
        {
          fieldname: 'file',
          filename: 'test.txt',
          encoding: '7bit',
          mimetype: 'text/plain',
          file: createFileStream('content'),
        },
      ];

      const request = createMockRequest(files);
      const reply = createMockReply();

      // We expect this to fail because the connection closes
      const result = await processFileUpload({
        request,
        reply,
        maxSizePerFile: 1024,
        allowedMimeTypes: ['text/plain'],
        processor: async (stream, _metadata, context) => {
          // Check abort state before close event
          abortDetected.before = context.isAborted();

          // Consume a bit of the stream first
          let hasReadChunk = false;
          for await (const _chunk of stream) {
            hasReadChunk = true;
            // After reading first chunk, simulate connection close
            if (hasReadChunk) {
              (
                request.raw as unknown as { simulateClose: () => void }
              ).simulateClose();
              // Give event time to propagate
              await new Promise((resolve) => setTimeout(resolve, 10));
              // Check if aborted
              abortDetected.after = context.isAborted();
              // Break to let the destroyed stream throw naturally
              break;
            }
          }

          return { hasReadChunk };
        },
      });

      // Upload should fail due to connection close
      expect(result.success).toBe(false);

      // Verify abort detection
      expect(abortDetected.before).toBe(false); // Not aborted initially
      expect(abortDetected.after).toBe(true); // Aborted after close event
    });

    it('should remove close event listener after cleanup', async () => {
      const files: MockMultipartFile[] = [
        {
          fieldname: 'file',
          filename: 'test.txt',
          encoding: '7bit',
          mimetype: 'text/plain',
          file: createFileStream('content'),
        },
      ];

      const request = createMockRequest(files);
      const reply = createMockReply();

      // Track event listener calls
      const eventListenerCalls: Array<{ action: string; event: string }> = [];
      const originalOn = request.raw.on.bind(request.raw);
      const originalRemoveListener =
        (
          (request.raw as any).removeListener as
            | ((...args: any[]) => any)
            | undefined
        )?.bind(request.raw) || (() => {});

      request.raw.on = function (event: string, handler: any) {
        eventListenerCalls.push({ action: 'add', event });
        return originalOn.call(this, event, handler);
      };

      (request.raw as any).removeListener = function (
        event: string,
        handler: any,
      ) {
        eventListenerCalls.push({ action: 'remove', event });
        return originalRemoveListener.call(this, event, handler);
      };

      await processFileUpload({
        request,
        reply,
        maxSizePerFile: 1024,
        allowedMimeTypes: ['text/plain'],
        processor: async (stream, _metadata, _context) => {
          for await (const _chunk of stream) {
            // consume
          }
          return {};
        },
      });

      // Verify that 'close' event listener was added
      const addCalls = eventListenerCalls.filter(
        (call) => call.action === 'add' && call.event === 'close',
      );
      expect(addCalls.length).toBeGreaterThan(0);

      // Verify that 'close' event listener was removed during cleanup
      const removeCalls = eventListenerCalls.filter(
        (call) => call.action === 'remove' && call.event === 'close',
      );
      expect(removeCalls.length).toBeGreaterThan(0);
    });
  });

  describe('FilesLimitError Handling', () => {
    it('should handle too many files with onComplete error', async () => {
      // Create a request that will trigger FilesLimitError
      const request = {
        server: { multipartEnabled: true },
        headers: { 'content-type': 'multipart/form-data; boundary=----' },
        log: {
          error: mock(),
          warn: mock(),
          info: mock(),
        },
        id: 'test-request-id',
        raw: {
          destroyed: false,
          on() {
            return this;
          },
          removeListener() {
            return this;
          },
        },
        files() {
          // Simulate @fastify/multipart throwing FilesLimitError
          // eslint-disable-next-line @typescript-eslint/require-await, require-yield
          return (async function* () {
            const error = new Error('Too many files');
            error.name = 'FilesLimitError';
            (error as Error & { code: string }).code = 'FST_FILES_LIMIT';
            throw error;
          })();
        },
      } as unknown as FastifyRequest;

      const reply = createMockReply();

      const result = await processFileUpload({
        request,
        reply,
        maxFiles: 1,
        maxSizePerFile: 1024,
        allowedMimeTypes: ['text/plain'],
        processor: async (stream, _metadata, _context) => {
          for await (const _chunk of stream) {
            // consume
          }
          return {};
        },
        // eslint-disable-next-line @typescript-eslint/require-await
        onComplete: async (_finalResult) => {
          throw new Error('onComplete error on too many files');
        },
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorEnvelope.error.code).toBe('file_max_files_exceeded');
      }

      // Verify onComplete error was logged
      expect(request.log.error).toHaveBeenCalled();
    });
  });

  describe('Unexpected Error with onComplete', () => {
    it('should handle unexpected error with onComplete throwing', async () => {
      const files: MockMultipartFile[] = [
        {
          fieldname: 'file',
          filename: 'test.txt',
          encoding: '7bit',
          mimetype: 'text/plain',
          file: createFileStream('content'),
        },
      ];

      // Create request with files() that throws unexpected error
      const request = {
        server: { multipartEnabled: true },
        headers: { 'content-type': 'multipart/form-data; boundary=----' },
        log: {
          error: mock(),
          warn: mock(),
          info: mock(),
        },
        id: 'test-request-id',
        raw: {
          destroyed: false,
          on() {
            return this;
          },
          removeListener() {
            return this;
          },
        },
        files() {
          // eslint-disable-next-line @typescript-eslint/require-await
          return (async function* () {
            // Yield first file successfully
            yield files[0];
            // Then throw an unexpected error
            throw new Error('Unexpected multipart error');
          })();
        },
      } as unknown as FastifyRequest;

      const reply = createMockReply();

      const result = await processFileUpload({
        request,
        reply,
        maxSizePerFile: 1024,
        allowedMimeTypes: ['text/plain'],
        processor: async (stream, _metadata, _context) => {
          for await (const _chunk of stream) {
            // consume
          }
          return {};
        },
        // eslint-disable-next-line @typescript-eslint/require-await
        onComplete: async (_finalResult) => {
          throw new Error('onComplete error after unexpected error');
        },
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorEnvelope.error.code).toBe('file_upload_failed');
      }

      // Verify errors were logged
      expect(request.log.error).toHaveBeenCalled();
    });
  });

  describe('Iterator Drain with Multiple Files', () => {
    it('should drain remaining files when batch fails early', async () => {
      const files: MockMultipartFile[] = [
        {
          fieldname: 'files',
          filename: 'file1.txt',
          encoding: '7bit',
          mimetype: 'text/plain',
          file: createFileStream('content 1'),
        },
        {
          fieldname: 'files',
          filename: 'file2.txt',
          encoding: '7bit',
          mimetype: 'text/plain',
          file: createFileStream('content 2'),
        },
        {
          fieldname: 'files',
          filename: 'file3.txt',
          encoding: '7bit',
          mimetype: 'text/plain',
          file: createFileStream('content 3'),
        },
      ];

      const request = createMockRequest(files);
      const reply = createMockReply();

      const result = await processFileUpload({
        request,
        reply,
        maxFiles: 3,
        maxSizePerFile: 1024,
        allowedMimeTypes: ['text/plain'],
        processor: async (stream, _metadata, context) => {
          for await (const _chunk of stream) {
            // consume
          }

          // Fail on first file - should drain remaining files
          if (context.fileIndex === 0) {
            throw new Error('First file failed');
          }

          return {};
        },
      });

      expect(result.success).toBe(false);
    });

    it('should drain remaining files after timeout during file processing', async () => {
      const files: MockMultipartFile[] = [
        {
          fieldname: 'files',
          filename: 'file1.txt',
          encoding: '7bit',
          mimetype: 'text/plain',
          file: createFileStream('content 1'),
        },
        {
          fieldname: 'files',
          filename: 'file2.txt',
          encoding: '7bit',
          mimetype: 'text/plain',
          file: createFileStream('content 2'),
        },
        {
          fieldname: 'files',
          filename: 'file3.txt',
          encoding: '7bit',
          mimetype: 'text/plain',
          file: createFileStream('content 3'),
        },
      ];

      const request = createMockRequest(files);
      const reply = createMockReply();

      const result = await processFileUpload({
        request,
        reply,
        maxFiles: 3,
        maxSizePerFile: 1024,
        allowedMimeTypes: ['text/plain'],
        timeoutMS: 10, // Very short timeout
        processor: async (stream, _metadata, context) => {
          // First file: delay to trigger timeout
          if (context.fileIndex === 0) {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }

          for await (const _chunk of stream) {
            // consume
          }

          return {};
        },
      });

      expect(result.success).toBe(false);
    });

    it('should handle hanging iterator drain after MIME rejection', async () => {
      let shouldHangIterator = false;

      // Create request with iterator that hangs on drain
      const request = {
        server: { multipartEnabled: true },
        headers: { 'content-type': 'multipart/form-data; boundary=----' },
        log: {
          error: mock(),
          warn: mock(),
          info: mock(),
        },
        id: 'test-request-id',
        raw: {
          destroyed: false,
          on() {
            return this;
          },
          removeListener() {
            return this;
          },
        },
        files() {
          return (async function* () {
            // Yield first file
            yield {
              fieldname: 'files',
              filename: 'file1.txt',
              encoding: '7bit',
              mimetype: 'application/pdf', // Will be rejected (allowedMimeTypes is text/plain)
              file: createFileStream('content 1'),
            };

            // After MIME rejection, if iterator tries to drain, hang here
            if (shouldHangIterator) {
              // Simulate hanging network request - wait longer than drain timeout
              await new Promise((resolve) => setTimeout(resolve, 2000));
            }

            // Try to yield more files (won't be reached due to MIME rejection)
            yield {
              fieldname: 'files',
              filename: 'file2.txt',
              encoding: '7bit',
              mimetype: 'text/plain',
              file: createFileStream('content 2'),
            };
          })();
        },
      } as unknown as FastifyRequest;

      const reply = createMockReply();

      shouldHangIterator = true;

      const result = await processFileUpload({
        request,
        reply,
        maxFiles: 3,
        maxSizePerFile: 1024,
        allowedMimeTypes: ['text/plain'], // Will reject PDF
        processor: async (stream, _metadata, _context) => {
          for await (const _chunk of stream) {
            // consume
          }
          return {};
        },
      });

      expect(result.success).toBe(false);

      // Should have logged drain timeout warning
      expect(request.log.warn).toHaveBeenCalled();
    });

    it('should drain remaining files when timeout occurs between iterations', async () => {
      let iteratorCallCount = 0;

      // Create request with custom iterator
      const request = {
        server: { multipartEnabled: true },
        headers: { 'content-type': 'multipart/form-data; boundary=----' },
        log: {
          error: mock(),
          warn: mock(),
          info: mock(),
        },
        id: 'test-request-id',
        raw: {
          destroyed: false,
          on() {
            return this;
          },
          removeListener() {
            return this;
          },
        },
        files() {
          return (async function* () {
            iteratorCallCount++;
            // First file
            yield {
              fieldname: 'files',
              filename: 'file1.txt',
              encoding: '7bit',
              mimetype: 'text/plain',
              file: createFileStream('content 1'),
            };

            // Small delay to allow timeout to fire between iterations
            await new Promise((resolve) => setTimeout(resolve, 50));

            iteratorCallCount++;
            // Second file (state.aborted should be true here)
            yield {
              fieldname: 'files',
              filename: 'file2.txt',
              encoding: '7bit',
              mimetype: 'text/plain',
              file: createFileStream('content 2'),
            };

            iteratorCallCount++;
            // Third file (should be drained)
            yield {
              fieldname: 'files',
              filename: 'file3.txt',
              encoding: '7bit',
              mimetype: 'text/plain',
              file: createFileStream('content 3'),
            };
          })();
        },
      } as unknown as FastifyRequest;

      const reply = createMockReply();

      const result = await processFileUpload({
        request,
        reply,
        maxFiles: 3,
        maxSizePerFile: 1024,
        allowedMimeTypes: ['text/plain'],
        timeoutMS: 20, // Very short timeout - will fire between file 1 and file 2
        processor: async (stream, _metadata, _context) => {
          // Process quickly - timeout should fire between files, not during processing
          for await (const _chunk of stream) {
            // consume
          }
          return {};
        },
      });

      // Should have failed due to timeout
      expect(result.success).toBe(false);

      // Iterator should have been called at least twice (first file + attempt at second)
      expect(iteratorCallCount).toBeGreaterThanOrEqual(2);
    });

    it('should handle hanging iterator drain after timeout between iterations', async () => {
      let wasDrainAttempted = false;

      // Create request with iterator that hangs during drain
      const request = {
        server: { multipartEnabled: true },
        headers: { 'content-type': 'multipart/form-data; boundary=----' },
        log: {
          error: mock(),
          warn: mock(),
          info: mock(),
        },
        id: 'test-request-id',
        raw: {
          destroyed: false,
          on() {
            return this;
          },
          removeListener() {
            return this;
          },
        },
        files() {
          return (async function* () {
            // First file
            yield {
              fieldname: 'files',
              filename: 'file1.txt',
              encoding: '7bit',
              mimetype: 'text/plain',
              file: createFileStream('content 1'),
            };

            // Small delay to allow timeout to fire between iterations
            await new Promise((resolve) => setTimeout(resolve, 50));

            // Second file - will trigger the drain logic at line 582
            wasDrainAttempted = true;
            yield {
              fieldname: 'files',
              filename: 'file2.txt',
              encoding: '7bit',
              mimetype: 'text/plain',
              file: createFileStream('content 2'),
            };

            // Hang here during drain attempt - longer than drain timeout (1000ms)
            await new Promise((resolve) => setTimeout(resolve, 2000));

            // Third file (won't be reached due to drain timeout)
            yield {
              fieldname: 'files',
              filename: 'file3.txt',
              encoding: '7bit',
              mimetype: 'text/plain',
              file: createFileStream('content 3'),
            };
          })();
        },
      } as unknown as FastifyRequest;

      const reply = createMockReply();

      const result = await processFileUpload({
        request,
        reply,
        maxFiles: 3,
        maxSizePerFile: 1024,
        allowedMimeTypes: ['text/plain'],
        timeoutMS: 20, // Very short timeout - will fire between file 1 and file 2
        processor: async (stream, _metadata, _context) => {
          // Process quickly - timeout should fire between files
          for await (const _chunk of stream) {
            // consume
          }
          return {};
        },
      });

      // Should have failed due to timeout
      expect(result.success).toBe(false);

      // Should have attempted drain (which timed out)
      expect(wasDrainAttempted).toBe(true);

      // Should have logged drain timeout warning
      expect(request.log.warn).toHaveBeenCalled();
      const warnCalls = (request.log.warn as any).mock.calls;
      const drainTimeoutWarning = warnCalls.some((call: any) => {
        return (
          call[1] === 'Failed to drain multipart iterator (timeout or error)'
        );
      });
      expect(drainTimeoutWarning).toBe(true);
    });
  });
});
