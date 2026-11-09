/**
 * Detects whether the executable this process runs from has been replaced on
 * disk since it started.
 *
 * WHY THIS MATTERS ONLY FOR THE COMPILED BINARY. A standalone daemon starts its
 * workers by re-exec'ing `process.execPath` (see self-spawn.ts), so a worker runs
 * whatever bytes are at that path NOW, while the daemon keeps executing the image
 * it was started from. A global package update (npm/pnpm rewrite, install.sh
 * rename) therefore splits the fleet into an old daemon and new workers; such a
 * worker exits before ready with Bun's opaque `An unknown error occurred
 * (Unexpected)`. Under Node the daemon forks `dist/worker.js` from a tree it
 * loaded itself, and the same replacement is benign — so `standalone: false`
 * never reports a replacement.
 *
 * Identity is the file's inode + size + mtime, not its version: install.sh swaps
 * via rename (new inode), npm rewrites in place (same inode, new mtime/size), and
 * pnpm may prune the versioned store path entirely (ENOENT). All three read as
 * "replaced" without having to execute the new binary to ask its version.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isStandaloneBinary } from './self-spawn.js';

export interface BinaryIdentity {
  ino: number;
  size: number;
  mtimeMs: number;
}

/** stat-derived identity of `path`, or null when it cannot be read (removed / pruned). */
export function readBinaryIdentity(path: string): BinaryIdentity | null {
  try {
    const st = statSync(path);
    return { ino: st.ino, size: st.size, mtimeMs: st.mtimeMs };
  } catch {
    return null;
  }
}

/** A missing file counts as changed: the daemon's image no longer exists on disk. */
export function binaryIdentityChanged(before: BinaryIdentity, after: BinaryIdentity | null): boolean {
  if (!after) return true;
  return before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs;
}

/** Stable string for de-duplicating notices about one specific on-disk binary. */
export function binaryIdentityKey(id: BinaryIdentity | null): string {
  return id ? `${id.ino}:${id.size}:${Math.trunc(id.mtimeMs)}` : 'missing';
}

export interface RunningBinaryWatch {
  /** Record the current on-disk identity as "what this process runs". Idempotent;
   *  must be called at startup, before any update could have landed. */
  capture: () => void;
  /** True when the file at `path` differs from the captured identity. Always
   *  false when not standalone or before `capture()`. */
  replaced: () => boolean;
  /** Identity of the file currently on disk (for notice de-duplication). */
  currentKey: () => string;
}

export function createRunningBinaryWatch(opts: { path: string; standalone: boolean }): RunningBinaryWatch {
  let captured: BinaryIdentity | null | undefined;
  return {
    capture: () => {
      if (!opts.standalone || captured !== undefined) return;
      captured = readBinaryIdentity(opts.path);
    },
    replaced: () => {
      if (!opts.standalone || !captured) return false;
      return binaryIdentityChanged(captured, readBinaryIdentity(opts.path));
    },
    currentKey: () => binaryIdentityKey(readBinaryIdentity(opts.path)),
  };
}

/** The watch for this process's own executable. */
export const runningBinaryWatch: RunningBinaryWatch = createRunningBinaryWatch({
  path: process.execPath,
  standalone: isStandaloneBinary(),
});

// ---- host-wide notice marker ------------------------------------------------
//
// Every bot runs its own daemon, and any of them can be the first to fork a
// worker against a replaced binary. The owner should hear about one replaced
// binary once, not once per bot, so the marker lives in the shared data dir and
// is keyed by the on-disk identity that was reported.

const MARKER_FILE = 'binary-replaced-notice.json';

export function binaryReplacedNoticeMarkerPathIn(dir: string): string {
  return join(dir, MARKER_FILE);
}

export function readBinaryReplacedNoticeKey(dir: string): string | undefined {
  const path = binaryReplacedNoticeMarkerPathIn(dir);
  if (!existsSync(path)) return undefined;
  try {
    const v = JSON.parse(readFileSync(path, 'utf-8'));
    return v && typeof v === 'object' && typeof v.key === 'string' ? v.key : undefined;
  } catch {
    return undefined;
  }
}

export function writeBinaryReplacedNoticeKey(dir: string, key: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = binaryReplacedNoticeMarkerPathIn(dir);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ key, at: new Date().toISOString() }, null, 2) + '\n');
  renameSync(tmp, path);
}
