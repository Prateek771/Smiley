import { constants, type BigIntStats } from "node:fs";
import { lstat, realpath, mkdir, open, unlink } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { AuthError } from "../auth";
import { MAX_DOCUMENT_BYTES } from "./validation";

export interface PrivateStorage {
  write(key: string, bytes: Uint8Array): Promise<void>;
  read(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}
export interface ExclusiveWriteHandle {
  stat(options: { bigint: true }): Promise<BigIntStats>;
  writeFile(bytes: Uint8Array): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}
export type StorageDependencies = { openExclusive?: (target: string) => Promise<ExclusiveWriteHandle> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
function inside(parent: string, child: string) {
  const path = relative(parent.toLowerCase(), child.toLowerCase());
  return path === "" || (!path.startsWith(".." + sep) && path !== ".." && !isAbsolute(path));
}
function assertPrivate(root: string) {
  for (const forbidden of [resolve(process.cwd(), "public"), resolve(process.cwd(), ".next")]) {
    if (inside(forbidden, root)) throw new AuthError(400, "Private document storage must be outside public and build directories.");
  }
}
async function rejectLinkedAncestors(path: string) {
  let current = path;
  while (true) {
    const stat = await lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (stat?.isSymbolicLink()) throw new AuthError(400, "Private storage paths cannot contain symbolic links.");
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}
export function createLocalStorage(rootDir = process.env.PRIVATE_STORAGE_DIR, dependencies: StorageDependencies = {}): PrivateStorage {
  if (!rootDir) throw new AuthError(400, "Private storage configuration is required.");
  const root = resolve(rootDir);
  assertPrivate(root);
  function file(key: string) {
    if (!uuid.test(key)) throw new AuthError(400, "The private document key is invalid.");
    const target = resolve(root, key);
    if (!inside(root, target) || target === root) throw new AuthError(400, "The private document key is outside storage.");
    return target;
  }
  async function prepareRoot() {
    await rejectLinkedAncestors(root);
    await mkdir(root, { recursive: true });
    const actual = await realpath(root);
    assertPrivate(actual);
    if (actual.toLowerCase() !== root.toLowerCase()) throw new AuthError(400, "The private storage directory changed.");
  }
  async function checkedFile(key: string) {
    const target = file(key);
    await prepareRoot();
    const stat = await lstat(target, { bigint: true });
    if (!stat.isFile() || stat.isSymbolicLink()) throw new AuthError(400, "Private document objects must be regular files.");
    return { target, stat };
  }
  return {
    async write(key, bytes) {
      const target = file(key);
      if (bytes.byteLength > MAX_DOCUMENT_BYTES) throw new AuthError(413, "Document storage is limited to 5 MiB per file.");
      await prepareRoot();
      const handle = await (dependencies.openExclusive ?? ((path: string) => open(path, "wx", 0o600)))(target);
      let identity: BigIntStats | undefined;
      let failure: unknown;
      let failed = false;
      let closed = false;
      const cleanupErrors: unknown[] = [];
      try {
        identity = await handle.stat({ bigint: true });
        await handle.writeFile(bytes);
        await handle.sync();
        await handle.close();
        closed = true;
      } catch (error) {
        failure = error;
        failed = true;
        // Capture ownership while the handle is still usable, before closing it.
        if (!identity) {
          try { identity = await handle.stat({ bigint: true }); }
          catch (identityError) {
            cleanupErrors.push(new Error("The new private object's identity could not be verified; it was preserved.", { cause: identityError }));
          }
        }
      } finally {
        if (!closed) {
          try { await handle.close(); closed = true; }
          catch (closeError) { cleanupErrors.push(new Error("The private document handle could not be closed during cleanup.", { cause: closeError })); }
        }
        if (failed && identity) {
          try {
            const current = await lstat(target, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
              if (error.code === "ENOENT") return null;
              throw error;
            });
            if (current) {
              if (!current.isFile() || current.isSymbolicLink() || current.ino !== identity.ino || current.dev !== identity.dev) {
                throw new Error("The private object identity changed; cleanup preserved the unowned object.");
              }
              await unlink(target).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
            }
          } catch (cleanupError) { cleanupErrors.push(cleanupError); }
        }
      }
      // Storage belongs to a trusted local host. Unverifiable ownership preserves
      // a private orphan for operator reconciliation rather than risking deletion.
      // The path identity check is not a sandbox against a hostile local process.
      if (failed) {
        if (cleanupErrors.length) throw new AggregateError([failure, ...cleanupErrors], "Private document write failed and cleanup could not be confirmed.");
        throw failure;
      }
    },
    async read(key) {
      const { target, stat } = await checkedFile(key);
      if (stat.size > BigInt(MAX_DOCUMENT_BYTES)) throw new AuthError(413, "Stored document exceeds 5 MiB.");
      const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const opened = await handle.stat({ bigint: true });
        if (!opened.isFile() || opened.ino !== stat.ino || opened.dev !== stat.dev) throw new AuthError(400, "The private document object changed.");
        const buffer = Buffer.alloc(MAX_DOCUMENT_BYTES + 1);
        let count = 0;
        while (count < buffer.length) {
          const result = await handle.read(buffer, count, buffer.length - count, count);
          if (!result.bytesRead) break;
          count += result.bytesRead;
        }
        if (count > MAX_DOCUMENT_BYTES) throw new AuthError(413, "Stored document exceeds 5 MiB.");
        return buffer.subarray(0, count);
      } finally { await handle.close(); }
    },
    async remove(key) {
      const target = file(key);
      await prepareRoot();
      const stat = await lstat(target).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (!stat) return;
      if (!stat.isFile() || stat.isSymbolicLink()) throw new AuthError(400, "Private document objects must be regular files.");
      await unlink(target).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
    },
  };
}
