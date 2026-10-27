import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateFetchUrl } from '../src/safe-fetch.js';

test('an HTTPS-only fetch policy rejects HTTP before looking up a host', async () => {
  await assert.rejects(
    validateFetchUrl('http://127.0.0.1/image.png', { allowedProtocols: ['https:'] }),
    /仅允许 https:/
  );
});
