import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { ProviderCallError } from '../core/errors.js';
import { checkFetchableUrl, HttpWebsiteFetcher, isBlockedAddress } from './fetcher.js';

const o = () => ({ signal: AbortSignal.timeout(5000) });

describe('website fetch security (SSRF)', () => {
  test('private, loopback, link-local, CGNAT, reserved and mapped addresses are blocked', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1']) {
      assert.equal(isBlockedAddress(ip), true, ip);
    }
    for (const ip of ['93.184.216.34', '8.8.8.8', '2606:4700:4700::1111']) assert.equal(isBlockedAddress(ip), false, ip);
  });

  test('only http(s) on standard ports, no credentials, no internal names', () => {
    const bad = ['file:///etc/passwd', 'ftp://x.com/', 'http://user:pw@x.com/', 'http://x.com:8080/', 'http://localhost/', 'http://127.0.0.1/', 'http://[::1]/', 'http://intranet/', 'http://db.internal/', 'javascript:alert(1)'];
    for (const url of bad) assert.equal(checkFetchableUrl(url).ok, false, url);
    assert.equal(checkFetchableUrl('https://www.example.com/contact').ok, true);
  });

  test('the fetcher refuses a blocked URL before any network call', async () => {
    await assert.rejects(new HttpWebsiteFetcher().fetchPage('http://169.254.169.254/latest/meta-data/', o()), (e) => e instanceof ProviderCallError && e.kind === 'INVALID_REQUEST');
    await assert.rejects(new HttpWebsiteFetcher().fetchPage('http://localhost:3000/', o()), (e) => e instanceof ProviderCallError && e.kind === 'INVALID_REQUEST');
  });
});

describe('HttpWebsiteFetcher (local test server)', () => {
  let server: Server;
  let base: string;
  before(async () => {
    server = createServer((req, res) => {
      const url = req.url ?? '/';
      if (url === '/') return res.writeHead(200, { 'content-type': 'text/html' }).end('<title>Home</title>');
      if (url === '/gz') return res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' }).end(gzipSync('<title>Zipped</title>'));
      if (url === '/hop') return res.writeHead(301, { location: '/' }).end();
      if (url === '/loop') return res.writeHead(302, { location: '/loop' }).end();
      if (url === '/to-metadata') return res.writeHead(302, { location: 'http://169.254.169.254/' }).end();
      if (url === '/pdf') return res.writeHead(200, { 'content-type': 'application/pdf' }).end('%PDF');
      if (url === '/big') return res.writeHead(200, { 'content-type': 'text/html' }).end('x'.repeat(5000));
      if (url === '/slow') return void setTimeout(() => res.writeHead(200, { 'content-type': 'text/html' }).end('late'), 1500);
      res.writeHead(404, { 'content-type': 'text/html' }).end('nope');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => new Promise<void>((r) => server.close(() => r())));

  // Only the loopback test server is exempt; every other private address stays blocked, redirects included.
  const fetcher = (opts = {}) => new HttpWebsiteFetcher({ allowHosts: ['127.0.0.1'], maxBytes: 1000, timeoutMs: 800, ...opts });

  test('reads HTML, decompresses, follows redirects and records them', async () => {
    assert.equal((await fetcher().fetchPage(`${base}/`, o())).body, '<title>Home</title>');
    assert.equal((await fetcher().fetchPage(`${base}/gz`, o())).body, '<title>Zipped</title>');
    const hop = await fetcher().fetchPage(`${base}/hop`, o());
    assert.equal(hop.finalUrl, `${base}/`);
    assert.deepEqual(hop.redirects, [`${base}/hop`]);
  });

  test('website problems come back as data, not provider errors', async () => {
    assert.equal((await fetcher().fetchPage(`${base}/loop`, o())).failure, 'TOO_MANY_REDIRECTS');
    assert.equal((await fetcher().fetchPage(`${base}/pdf`, o())).failure, 'NOT_HTML');
    assert.equal((await fetcher().fetchPage(`${base}/missing`, o())).failure, 'HTTP_ERROR');
    assert.equal((await fetcher().fetchPage(`${base}/slow`, o())).failure, 'TIMEOUT');
    const big = await fetcher().fetchPage(`${base}/big`, o());
    assert.equal(big.truncated, true);
    assert.equal(big.body.length, 1000);
  });

  test('a redirect into a private address is refused even when the first hop was allowed', async () => {
    await assert.rejects(new HttpWebsiteFetcher().fetchPage(`${base}/to-metadata`, o()), 'a loopback first hop is refused outright');
    const r = await fetcher().fetchPage(`${base}/to-metadata`, o());
    assert.equal(r.failure, 'BLOCKED');
    assert.match(r.failureDetail ?? '', /private or reserved/);
  });
});
