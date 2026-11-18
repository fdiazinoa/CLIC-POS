import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { assertReferenceAuditNotAborted, REFERENCE_AUDIT_LINE_BYTES, type BaselineReferenceInventory, type BaselineReferenceInventoryOptions, type BaselineReferenceProgress } from './BaselineReferenceInventory';

export interface BaselineReferenceWriter {
  append(line: string): Promise<void>;
  complete(summary: BaselineReferenceInventory, assertContext: () => void): Promise<string>;
  abort(): Promise<void>;
}
/** A single bounded buffer, with awaited native writes. Partial files are never published as final reports. */
export async function createBaselineReferenceWriter(
  filesystem: Pick<typeof Filesystem, 'writeFile' | 'appendFile' | 'rename' | 'deleteFile'> = Filesystem,
  native = Capacitor.isNativePlatform(),
): Promise<BaselineReferenceWriter> {
  if (!native) throw new Error('REFERENCE_AUDIT_ANDROID_REQUIRED');
  const name = `Download/clic-v3-inventario-local-${crypto.randomUUID()}.jsonl`;
  const partial = name + '.partial';
  let buffer = '', bufferBytes = 0, closed = false, renameAttempted = false;
  // Permission/storage failure happens before the caller opens a SQLite snapshot.
  await filesystem.writeFile({ path: partial, data: '', directory: Directory.Documents, encoding: Encoding.UTF8, recursive: true });
  const flush = async () => {
    if (!buffer) return;
    await filesystem.appendFile({path: partial, data: buffer, directory: Directory.Documents, encoding: Encoding.UTF8});
    buffer = ''; bufferBytes = 0;
  };
  const append = async (line: string) => {
    if (closed) throw new Error('REFERENCE_AUDIT_WRITER_CLOSED');
    const bytes = new TextEncoder().encode(line).length;
    if (bytes > REFERENCE_AUDIT_LINE_BYTES) throw new Error('REFERENCE_AUDIT_ENTRY_TOO_LARGE');
    if (bufferBytes + bytes > REFERENCE_AUDIT_LINE_BYTES) await flush();
    buffer += line; bufferBytes += bytes;
  };
  return {
    append,
    complete: async (summary, assertContext) => {
      assertContext();
      await append(JSON.stringify({type:'complete',summary}) + '\n');
      await flush();
      assertContext();
      renameAttempted = true;
      await filesystem.rename({from:partial,to:name,directory:Directory.Documents,toDirectory:Directory.Documents});
      assertContext();
      closed = true;
      return `Documents/${name}`;
    },
    // All callers wait for the pending read/append to settle before cleanup. Never touches DB files.
    abort: async () => {
      closed = true; buffer = ''; bufferBytes = 0;
      let cleanupError: unknown;
      for (const path of renameAttempted ? [partial,name] : [partial]) {
        try { await filesystem.deleteFile({path,directory:Directory.Documents}); }
        catch (error) {
          if (!(error instanceof Error && /does not exist|not exist|no such file|not found|ENOENT/i.test(error.message))) cleanupError = error;
        }
      }
      if (cleanupError) throw new Error('REFERENCE_AUDIT_REPORT_CLEANUP_FAILED', {cause:cleanupError});
    },
  };
}

export interface RunBaselineReferenceExportOptions {
  read(options: BaselineReferenceInventoryOptions): Promise<BaselineReferenceInventory>;
  readBinding(): string;
  readIdentity(): Record<string, string> | undefined;
  createWriter?(): Promise<BaselineReferenceWriter>;
  signal?: AbortSignal;
  onProgress?(progress: BaselineReferenceProgress): void;
  onPreview?(preview: string): void;
}
export async function runBaselineReferenceExport(options: RunBaselineReferenceExportOptions): Promise<{summary: BaselineReferenceInventory; path: string}> {
  const guard = options.readBinding(), identity = options.readIdentity();
  if (!identity) throw new Error('SYNC_V3_ERP_BINDING_REQUIRED');
  const assertContext = () => {
    assertReferenceAuditNotAborted(options.signal);
    if (options.readBinding() !== guard) throw new Error('SYNC_V3_BINDING_CHANGED');
  };
  assertContext();
  const writer = await (options.createWriter || createBaselineReferenceWriter)();
  let preview = '', lastPreviewAt = 0;
  try {
    assertContext();
    await writer.append(JSON.stringify({type:'header',schemaVersion:2,identity,migrationAllowed:false}) + '\n');
    const summary = await options.read({
      signal: options.signal,
      assertContext,
      emitLine: async line => {
        assertContext();
        await writer.append(line);
        // Only the current small excerpt exists in React. The complete report stays in the file.
        preview = (preview + line).slice(-2048); // <= 6144 UTF-8 bytes even for unpaired UTF-16 surrogates.
      },
      onProgress: progress => {
        assertContext();
        const now = performance.now();
        if (now - lastPreviewAt >= 100 || lastPreviewAt === 0) {
          lastPreviewAt = now;
          options.onProgress?.(progress); options.onPreview?.(preview);
        }
      },
    });
    assertContext();
    options.onPreview?.(preview);
    const path = await writer.complete(summary, assertContext);
    return {summary,path};
  } catch (error) {
    await writer.abort();
    throw error;
  }
}
