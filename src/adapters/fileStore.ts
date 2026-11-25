// What: the FileStore interface (where PDF bytes are kept) and a local-folder implementation.
// Who calls it: the intake service saves uploads; the download route handler and extractors read them back.
// To extend: S3FileStore (s3FileStore.ts) is the AWS version; getDeps() picks one from STORAGE_BACKEND.
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export interface FileStore {
  /** Saves bytes under a key such as "documents/ab12...ef.pdf". Saving the same key twice overwrites. */
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  exists(key: string): Promise<boolean>;
}

export class LocalFileStore implements FileStore {
  constructor(private readonly rootDir: string) {}

  async put(key: string, bytes: Uint8Array): Promise<void> {
    const target = this.resolve(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }

  async get(key: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.resolve(key)));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  /** Keys are relative paths. Anything that would escape the root folder is refused. */
  private resolve(key: string): string {
    const target = path.resolve(this.rootDir, key);
    const root = path.resolve(this.rootDir);
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new Error(`File key escapes the storage folder: ${key}`);
    }
    return target;
  }
}
