import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, renameSync, rmSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  binaryIdentityChanged,
  binaryIdentityKey,
  createRunningBinaryWatch,
  readBinaryIdentity,
  readBinaryReplacedNoticeKey,
  writeBinaryReplacedNoticeKey,
} from '../src/core/running-binary.js';

describe('running-binary watch', () => {
  let dir: string;
  let bin: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'botmux-running-binary-'));
    bin = join(dir, 'botmux');
    writeFileSync(bin, 'v1');
  });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('reads null for a missing file and treats that as changed', () => {
    const before = readBinaryIdentity(bin)!;
    unlinkSync(bin);
    expect(readBinaryIdentity(bin)).toBeNull();
    expect(binaryIdentityChanged(before, null)).toBe(true);
    expect(binaryIdentityKey(null)).toBe('missing');
  });

  it('is not replaced while the file is untouched', () => {
    const watch = createRunningBinaryWatch({ path: bin, standalone: true });
    watch.capture();
    expect(watch.replaced()).toBe(false);
  });

  it('detects an install.sh-style swap (rename over the path → new inode)', () => {
    const watch = createRunningBinaryWatch({ path: bin, standalone: true });
    watch.capture();
    const staged = join(dir, '.botmux-update.tmp');
    writeFileSync(staged, 'v2');
    renameSync(staged, bin);
    expect(watch.replaced()).toBe(true);
  });

  it('detects a package-manager-style in-place rewrite (same inode, new mtime)', () => {
    const watch = createRunningBinaryWatch({ path: bin, standalone: true });
    watch.capture();
    const before = readBinaryIdentity(bin)!;
    writeFileSync(bin, 'v1'); // same bytes and size — only the mtime moves
    const later = new Date(before.mtimeMs + 5_000);
    utimesSync(bin, later, later);
    expect(watch.replaced()).toBe(true);
  });

  it('detects a pruned versioned store path (file gone)', () => {
    const watch = createRunningBinaryWatch({ path: bin, standalone: true });
    watch.capture();
    unlinkSync(bin);
    expect(watch.replaced()).toBe(true);
  });

  it('never reports a replacement under Node (dist/ is loaded by the daemon itself)', () => {
    const watch = createRunningBinaryWatch({ path: bin, standalone: false });
    watch.capture();
    unlinkSync(bin);
    expect(watch.replaced()).toBe(false);
  });

  it('is inert until captured, and capture is idempotent', () => {
    const watch = createRunningBinaryWatch({ path: bin, standalone: true });
    expect(watch.replaced()).toBe(false);
    watch.capture();
    const staged = join(dir, 'next');
    writeFileSync(staged, 'v2');
    renameSync(staged, bin);
    watch.capture(); // must not re-baseline onto the replaced file
    expect(watch.replaced()).toBe(true);
  });

  it('currentKey follows the file on disk so a notice can be de-duplicated per binary', () => {
    const watch = createRunningBinaryWatch({ path: bin, standalone: true });
    const k1 = watch.currentKey();
    expect(watch.currentKey()).toBe(k1);
    const staged = join(dir, 'next');
    writeFileSync(staged, 'v2-longer');
    renameSync(staged, bin);
    expect(watch.currentKey()).not.toBe(k1);
  });
});

describe('binary-replaced notice marker', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'botmux-marker-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('reads undefined when absent and round-trips a key', () => {
    expect(readBinaryReplacedNoticeKey(dir)).toBeUndefined();
    writeBinaryReplacedNoticeKey(dir, '1:2:3');
    expect(readBinaryReplacedNoticeKey(dir)).toBe('1:2:3');
    writeBinaryReplacedNoticeKey(dir, '4:5:6');
    expect(readBinaryReplacedNoticeKey(dir)).toBe('4:5:6');
  });

  it('creates the data dir on first write', () => {
    const nested = join(dir, 'data');
    writeBinaryReplacedNoticeKey(nested, 'k');
    expect(readBinaryReplacedNoticeKey(nested)).toBe('k');
  });

  it('tolerates a corrupt marker (reads as undefined)', () => {
    writeFileSync(join(dir, 'binary-replaced-notice.json'), '{corrupt');
    expect(readBinaryReplacedNoticeKey(dir)).toBeUndefined();
  });
});
