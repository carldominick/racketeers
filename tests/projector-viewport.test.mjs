import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = await mkdtemp(path.join(tmpdir(), 'projector-viewport-'));
await build({ entryPoints: ['lib/projector-viewport.ts'], outfile: path.join(dir, 'viewport.mjs'), bundle: true, platform: 'node', format: 'esm' });
const { projectorViewport } = await import(pathToFileURL(path.join(dir, 'viewport.mjs')));

test('720p through 4K scale the complete presentation without a maximum-size cap', () => {
  for (const [width, height] of [[1280, 720], [1366, 768], [1920, 1080], [2048, 1080], [2560, 1440], [2880, 1620], [3072, 1728], [3840, 2160], [4096, 2160]]) {
    const viewport = projectorViewport(width, height);
    assert.equal(viewport.scaled, true);
    assert.ok(Math.abs(viewport.width * viewport.scale - width) < 0.001);
    assert.ok(Math.abs(viewport.height * viewport.scale - height) < 0.001);
    assert.ok(viewport.width >= 1920 - 0.001);
    assert.ok(viewport.height >= 1080 - 0.001);
    assert.equal(viewport.scale, Math.min(width / 1920, height / 1080));
  }
  assert.equal(projectorViewport(3840, 2160).scale, 2);
  assert.equal(projectorViewport(1280, 720).scale, 2 / 3);
});

test('different aspect ratios fill the viewport without stretching or cropping', () => {
  for (const [width, height] of [[1024, 768], [1280, 800], [1920, 1200], [3440, 1440], [2160, 3840]]) {
    const viewport = projectorViewport(width, height);
    assert.ok(Math.abs(viewport.width / viewport.height - width / height) < 0.001);
    assert.equal(viewport.width * viewport.scale, width);
    assert.equal(viewport.height * viewport.scale, height);
  }
});

test('small previews retain readable responsive dimensions and invalid sizes stay finite', () => {
  for (const [width, height] of [[360, 640], [390, 844], [834, 1194]]) {
    assert.deepEqual(projectorViewport(width, height), { width, height, scale: 1, scaled: false });
  }
  assert.deepEqual(projectorViewport(NaN, Infinity), { width: 1, height: 1, scale: 1, scaled: false });
});

test.after(() => rm(dir, { recursive: true, force: true }));
