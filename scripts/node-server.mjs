import { createServer } from 'node:http';
import { chmod, lstat, unlink } from 'node:fs/promises';
import { isIP } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import next from 'next';
import { initializeRequestContext, readNodeTransportConfig, runWithRequestContext,
  setManagementTransportReady } from '../lib/node/request-context.mjs';
import { initializeNodeRuntime, closeNodeRuntime } from '../lib/node/runtime.mjs';

// This custom server owns the transport boundary. Ship it with full .next,
// public, and locked production dependencies. Next standalone does not trace
// custom server files; do not launch its generated server instead of this one.
// Disabled management is the default. The configuration is operator supplied;
// this program does not create users/directories, change IAM, or infer a person.

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const loopbackPeers = new Set(['127.0.0.1']);
const removedHeaders = new Set(['authorization', 'proxy-authorization', 'forwarded',
  'x-real-ip', 'cf-connecting-ip', 'true-client-ip', 'cf-access-jwt-assertion',
  'cf-access-authenticated-user-email', 'x-goog-iap-jwt-assertion',
  'x-goog-authenticated-user-email', 'x-goog-authenticated-user-id']);

function normalizePeer(value) {
  if (typeof value !== 'string') return null;
  const result = value.startsWith('::ffff:') ? value.slice(7) : value;
  return isIP(result) ? result : null;
}

function removedHeader(name) {
  return removedHeaders.has(name) || name.startsWith('oai-authenticated-user-') ||
    name.startsWith('x-forwarded-') || name.startsWith('x-hirehire-') ||
    name.startsWith('x-internal-') || name.startsWith('x-admin-') || name.startsWith('x-middleware-');
}

function replaceHeader(request, name, value) {
  delete request.headers[name];
  for (let index = request.rawHeaders.length - 2; index >= 0; index -= 2) {
    if (request.rawHeaders[index].toLowerCase() === name) request.rawHeaders.splice(index, 2);
  }
  request.headers[name] = value;
  request.rawHeaders.push(name, value);
}

function requestClientIp(request, config, peerAddress) {
  // Only the approved loopback proxy can supply a dedicated *rate-limit* IP.
  // Raw duplicates, lists, missing headers and malformed IPs fall back to peer.
  // Identity headers and all other forwarded IP headers remain irrelevant.
  if (config.trustLocalProxy && loopbackPeers.has(peerAddress)) {
    const values = [];
    for (let index = 0; index < request.rawHeaders.length; index += 2) {
      if (request.rawHeaders[index].toLowerCase() === 'x-hirehire-client-ip') values.push(request.rawHeaders[index + 1]);
    }
    if (values.length === 1 && isIP(values[0])) {
      return { clientIp: values[0], ipSource: 'reviewed-local-proxy' };
    }
  }
  return { clientIp: peerAddress, ipSource: 'peer' };
}

function sanitizeRequest(request, expectedOrigin, peerAddress) {
  const origin = new URL(expectedOrigin);
  let hosts = 0, origins = 0;
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    const name = request.rawHeaders[index].toLowerCase();
    if (name === 'host') hosts++;
    if (name === 'origin') origins++;
  }
  // Fail closed on authorities that the server did not explicitly configure.
  if (hosts !== 1 || origins > 1 || typeof request.headers.host !== 'string' ||
      request.headers.host.toLowerCase() !== origin.host.toLowerCase()) return false;
  if (typeof request.url !== 'string' || !request.url.startsWith('/') || request.url.startsWith('//')) return false;
  try { if (new URL(request.url, expectedOrigin).origin !== expectedOrigin) return false; } catch { return false; }
  for (const name of Object.keys(request.headers)) if (removedHeader(name.toLowerCase())) delete request.headers[name];
  for (let index = request.rawHeaders.length - 2; index >= 0; index -= 2) {
    if (removedHeader(request.rawHeaders[index].toLowerCase())) request.rawHeaders.splice(index, 2);
  }
  // These replacement values do not authenticate anyone or select a channel.
  // Origin and rate limiting read the process-local context, not these headers.
  replaceHeader(request, 'host', origin.host);
  replaceHeader(request, 'x-forwarded-host', origin.host);
  replaceHeader(request, 'x-forwarded-proto', origin.protocol.slice(0, -1));
  replaceHeader(request, 'x-forwarded-port', origin.port || (origin.protocol === 'https:' ? '443' : '80'));
  if (peerAddress) replaceHeader(request, 'x-forwarded-for', peerAddress);
  return true;
}

function reject(response, status) {
  response.writeHead(status, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Content-Type': 'text/plain; charset=utf-8' });
  response.end(status === 503 ? 'Service unavailable.' : 'Request refused.');
}

async function verifyPrivateDirectory(directory, uid) {
  let current = path.parse(directory).root;
  for (const component of directory.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    const info = await lstat(current);
    if (info.isSymbolicLink() || !info.isDirectory() || (info.mode & 0o022) !== 0 ||
        (info.uid !== 0 && info.uid !== uid)) throw new Error('Management directory ancestry is unsafe.');
    if (current === directory && (info.uid !== uid || (info.mode & 0o777) !== 0o700)) {
      throw new Error('Management socket parent must be owned by the server UID with mode 0700.');
    }
  }
}

async function mustNotExist(socketPath) {
  try { await lstat(socketPath); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  // A stale/foreign socket is not automatically deleted or adopted.
  throw new Error('Management socket path already exists.');
}

async function verifySocket(socketPath, uid) {
  const info = await lstat(socketPath);
  if (info.isSymbolicLink() || !info.isSocket() || info.uid !== uid || (info.mode & 0o777) !== 0o600) {
    throw new Error('Management socket must be owned by the server UID with mode 0600.');
  }
  return info;
}

function listen(server, options) {
  return new Promise((resolve, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(options, () => { server.removeListener('error', rejectPromise); resolve(); });
  });
}

function boundedServer(handler) {
  const server = createServer({ maxHeaderSize: 16384 }, handler);
  server.headersTimeout = 30000;
  server.requestTimeout = 60000;
  server.keepAliveTimeout = 5000;
  // Next receives a separate unbound httpServer for its automatic upgrade hook,
  // so these actual listeners only ever reject upgrades. Destroy alone would
  // not prevent later EventEmitter listeners from seeing the same request.
  server.on('upgrade', (_request, socket) => socket.destroy());
  server.on('clientError', (_error, socket) => socket.destroy());
  return server;
}

export async function startNodeServer(environment = process.env) {
  const config = readNodeTransportConfig(environment);
  if (typeof process.getuid !== 'function') throw new Error('This server requires Linux/Unix.');
  const uid = process.getuid();
  if (uid === 0 && !config.localQa) throw new Error('Production server must run as a reviewed non-root OS user.');
  let socketIdentity, managementServer, publicServer, application;
  let managementReady = false, stopRequested = false, startupComplete = false, closePromise;
  if (config.management.enabled) {
    await verifyPrivateDirectory(path.dirname(config.management.socketPath), uid);
    await mustNotExist(config.management.socketPath);
  }
  initializeRequestContext(config);
  function close() {
    if (closePromise) return closePromise;
    stopRequested = true; managementReady = false; setManagementTransportReady(false);
    closePromise = (async () => {
      const errors = [];
      const results = await Promise.allSettled([publicServer, managementServer].filter(Boolean).map(server => new Promise((resolve, rejectPromise) => {
        if (!server.listening) { resolve(); return; }
        server.close(error => error ? rejectPromise(error) : resolve());
        server.closeIdleConnections?.();
        const timeout = setTimeout(() => server.closeAllConnections?.(), 10000);
        timeout.unref();
      })));
      for (const result of results) if (result.status === 'rejected') errors.push(result.reason);
      if (socketIdentity) {
        try {
          const current = await lstat(config.management.socketPath);
          if (current.isSocket() && current.uid === uid && current.ino === socketIdentity.ino && current.dev === socketIdentity.dev) {
            await unlink(config.management.socketPath);
          }
        } catch (error) { if (error.code !== 'ENOENT') errors.push(error); }
      }
      try { if (application) await application.close(); } catch (error) { errors.push(error); }
      // Close/checkpoint the SQLite WAL even if Next prepare or cleanup failed.
      try { await closeNodeRuntime(); } catch (error) { errors.push(error); }
      for (const signal of ['SIGTERM', 'SIGINT']) process.removeListener(signal, onSignal);
      if (errors.length) throw new AggregateError(errors, 'Node service cleanup failed.');
    })();
    return closePromise;
  }

  function onSignal() {
    stopRequested = true; managementReady = false; setManagementTransportReady(false);
    // During initialization the startup path observes this flag after each
    // await and enters the same cleanup. No new listener becomes ready then.
    if (startupComplete) void close().catch(() => { process.exitCode = 1; });
  }
  function ensureRunning() { if (stopRequested) throw new Error('Node startup was interrupted.'); }
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, onSignal);

  try {
    await initializeNodeRuntime();
    ensureRunning();
    // Next 16 automatically registers an upgrade handler on its httpServer option
    // (otherwise it takes request.socket.server). Keep that hook off both live
    // listeners. This receiver never listens or receives any network requests.
    const unusedUpgradeReceiver = createServer();
    application = next({ dev: process.argv.includes('--dev'), dir: projectRoot, customServer: true,
      hostname: config.listenHost, port: config.port, httpServer: unusedUpgradeReceiver });
    await application.prepare();
    ensureRunning();
    const handle = application.getRequestHandler();

    publicServer = boundedServer((request, response) => {
      const peerAddress = normalizePeer(request.socket.remoteAddress);
      if (!peerAddress || !loopbackPeers.has(peerAddress)) { reject(response, 403); return; }
      const rateLimitContext = requestClientIp(request, config, peerAddress);
      if (!sanitizeRequest(request, config.appOrigin, peerAddress)) { reject(response, 400); return; }
      runWithRequestContext({ channel: 'public', transport: 'tcp-loopback', peerAddress, ...rateLimitContext },
        () => Promise.resolve(handle(request, response)).catch(() => {
          if (!response.headersSent) reject(response, 503); else response.destroy();
        }));
    });
    if (config.management.enabled) {
      managementServer = boundedServer((request, response) => {
        if (!managementReady) { reject(response, 503); return; }
        if (!sanitizeRequest(request, config.management.origin, null)) { reject(response, 400); return; }
        runWithRequestContext({ channel: 'management', transport: 'unix-socket', peerAddress: null },
          () => Promise.resolve(handle(request, response)).catch(() => {
            if (!response.headersSent) reject(response, 503); else response.destroy();
          }));
      });
      // Protect the initial bind too. chmod alone after bind leaves a window.
      const previousMask = process.umask(0o077);
      try { await listen(managementServer, config.management.socketPath); }
      finally { process.umask(previousMask); }
      socketIdentity = await lstat(config.management.socketPath);
      ensureRunning();
      await chmod(config.management.socketPath, 0o600);
      socketIdentity = await verifySocket(config.management.socketPath, uid);
      await verifyPrivateDirectory(path.dirname(config.management.socketPath), uid);
      ensureRunning();
      setManagementTransportReady(true); managementReady = true;
    }
    await listen(publicServer, { host: config.listenHost, port: config.port });
    ensureRunning();
    startupComplete = true;
  } catch (error) {
    try { await close(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Node startup and cleanup failed.'); }
    throw error;
  }
  for (const server of [publicServer, managementServer].filter(Boolean)) {
    server.on('error', () => { process.exitCode = 1; void close().catch(() => { process.exitCode = 1; }); });
  }
  return { close, config };
}

// Importing this file for review does not start a listener.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startNodeServer().then(() => {
    console.log('HireHire Node service started.');
  }).catch(() => {
    // Never print environment values, request bodies or authentication material.
    console.error('HireHire Node service could not start; check reviewed server configuration.');
    process.exitCode = 1;
  });
}
