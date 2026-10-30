import { readConsoleTestSource } from './console-test-source.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const html = readConsoleTestSource();

test('console inline scripts remain valid JavaScript', () => {
  for (const [, source] of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
    new vm.Script(source);
  }
});

test('image generation has a dedicated E page form with all public configuration fields', () => {
  assert.match(html, /id="envCompImageGeneration"[^>]*data-ids="exec-image-generation"/);
  const form = readFileSync(new URL('../console/layers/E/components/exec-image-generation.js', import.meta.url), 'utf8');
  assert.ok(form, 'image generation form must be declared');
  const keys = [...form.matchAll(/key:\s*'([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(keys, [
    'apiBase', 'proxyUrl', 'model', 'size', 'quality', 'quotaMode', 'dailyGlobalLimit',
    'dailySessionLimit', 'maxPromptChars', 'maxReferenceImages', 'maxReferenceBytes',
    'maxOutputBytes', 'timeoutSeconds', 'cooldownSeconds', 'allowAutomatic',
    'allowedSessions', 'assetRetentionDays'
  ]);
  assert.doesNotMatch(form, /key:\s*'apiKey'/);
});

test('secret is edited outside config and is never echoed into HTML', () => {
  assert.match(html, /type="password"[^>]*class="[^"]*image-secret-input/);
  assert.match(html, /tool:\s*'image_generation_secret'/);
  assert.match(html, /op:\s*'status'/);
  assert.match(html, /op:\s*'set'/);
  assert.match(html, /op:\s*'clear'/);
  assert.match(html, /tool:\s*'image_generation_status'/);
  assert.match(html, /compFieldValue\(f,\s*fields?\[index\]\)/);
});
