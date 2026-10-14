import { AsyncLocalStorage } from 'node:async_hooks';
import { isIP } from 'node:net';
import path from 'node:path';

// The CLI and Next's bundled route modules must use this same process-local
// object. No request header, cookie, URL or client body selects its channel.
const bridgeKey = Symbol.for('hirehire.node.request-context.v1');
const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1']);
const emptySession = Object.freeze({ configured: false, authenticated: false,
  authorized: false, email: null, subject: null, operatorName: null,
  authenticationMethod: null });

function flag(value, name) {
  if (value === undefined || value === '' || value === 'false') return false;
  if (value === 'true') return true;
  throw new Error(`${name} must be true or false.`);
}

function fixedOrigin(value, name, { loopbackOnly = false, allowLocalHttp = false } = {}) {
  if (typeof value !== 'string' || !value) throw new Error(`${name} is required.`);
  if (!/^https?:\/\/[^\s/?#]+\/?$/i.test(value)) throw new Error(`${name} must contain only an HTTP(S) authority.`);
  let url;
  try { url = new URL(value); } catch { throw new Error(`${name} is invalid.`); }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      !['http:', 'https:'].includes(url.protocol) || url.origin === 'null') {
    throw new Error(`${name} must be a fixed HTTP(S) origin without credentials or a path.`);
  }
  if (loopbackOnly && !loopbackHosts.has(hostname)) throw new Error(`${name} must use loopback.`);
  if (url.protocol !== 'https:' && !(allowLocalHttp && loopbackHosts.has(hostname))) {
    throw new Error(`${name} requires HTTPS, except explicitly permitted loopback use.`);
  }
  return url.origin;
}

function operatorText(value, name, maximum) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum ||
      /[\u0000-\u001f\u007f]/u.test(value)) throw new Error(`${name} is required and must be valid text.`);
  return value.trim().normalize('NFC');
}

/** Only server environment is read. This does not enable an account by itself. */
export function readNodeTransportConfig(environment = process.env) {
  const localQa = flag(environment.HIREHIRE_LOCAL_QA, 'HIREHIRE_LOCAL_QA');
  const appOrigin = fixedOrigin(environment.HIREHIRE_APP_ORIGIN, 'HIREHIRE_APP_ORIGIN', { allowLocalHttp: localQa });
  const listenHost = environment.HIREHIRE_LISTEN_HOST || '127.0.0.1';
  if (listenHost !== '127.0.0.1') throw new Error('HIREHIRE_LISTEN_HOST must be 127.0.0.1.');
  // This opt-in is an operational approval of a loopback reverse proxy which
  // overwrites the dedicated IP header. It never supplies an admin identity.
  const trustLocalProxy = flag(environment.HIREHIRE_TRUST_LOCAL_PROXY, 'HIREHIRE_TRUST_LOCAL_PROXY');
  const portText = environment.HIREHIRE_PORT || '3000';
  if (!/^[1-9]\d{0,4}$/.test(portText) || Number(portText) > 65535) throw new Error('HIREHIRE_PORT is invalid.');
  const enabled = flag(environment.HIREHIRE_MANAGEMENT_ENABLED, 'HIREHIRE_MANAGEMENT_ENABLED');
  let management = Object.freeze({ enabled: false, unixAccessConfirmed: false,
    origin: null, socketPath: null, operator: null });
  if (enabled) {
    const unixAccessConfirmed = flag(environment.HIREHIRE_UNIX_ACCESS_CONFIRMED, 'HIREHIRE_UNIX_ACCESS_CONFIRMED');
    if (!unixAccessConfirmed) throw new Error('Management requires explicit confirmation of Unix access scope.');
    const origin = fixedOrigin(environment.HIREHIRE_MANAGEMENT_ORIGIN, 'HIREHIRE_MANAGEMENT_ORIGIN',
      { loopbackOnly: true, allowLocalHttp: true });
    const socketPath = environment.HIREHIRE_MANAGEMENT_SOCKET;
    if (typeof socketPath !== 'string' || !path.isAbsolute(socketPath) || /[\u0000-\u001f\u007f]/u.test(socketPath) ||
        path.normalize(socketPath) !== socketPath) throw new Error('HIREHIRE_MANAGEMENT_SOCKET must be a normalized absolute path.');
    const operator = Object.freeze({
      subject: operatorText(environment.HIREHIRE_OPERATOR_SUBJECT, 'HIREHIRE_OPERATOR_SUBJECT', 200),
      name: operatorText(environment.HIREHIRE_OPERATOR_NAME, 'HIREHIRE_OPERATOR_NAME', 120),
    });
    management = Object.freeze({ enabled: true, unixAccessConfirmed, origin, socketPath, operator });
  }
  return Object.freeze({ version: 1, appOrigin, localQa, listenHost, port: Number(portText), trustLocalProxy, management });
}

function bridge() {
  const value = globalThis[bridgeKey];
  if (!value || value.version !== 1 || typeof value.storage?.getStore !== 'function' ||
      typeof value.storage?.run !== 'function' || typeof value.managementReady !== 'function') return undefined;
  return value;
}

/** Called once by the custom server, never by route modules. */
export function initializeRequestContext(config) {
  if (globalThis[bridgeKey] !== undefined) throw new Error('Node request context is already initialized.');
  // Accept only the validated, immutable config made by the parser above.
  if (!config || config.version !== 1 || !Object.isFrozen(config) || !Object.isFrozen(config.management)) {
    throw new Error('Validated Node transport configuration is required.');
  }
  let ready = false;
  const storage = new AsyncLocalStorage();
  const value = Object.freeze({ version: 1, config, storage,
    managementReady: () => ready,
    setReady(value) { ready = value === true && config.management.enabled && config.management.unixAccessConfirmed; },
  });
  Object.defineProperty(globalThis, bridgeKey, { value, writable: false, configurable: false, enumerable: false });
}

/** Server-only: true follows actual 0700 directory / 0600 socket verification. */
export function setManagementTransportReady(ready) {
  const current = bridge();
  if (!current) throw new Error('Node request context is not initialized.');
  current.setReady(ready);
}

export function getNodeTransportConfig() { return bridge()?.config; }
export function getRequestContext() { return bridge()?.storage.getStore(); }

/** The HTTP listener passes a literal channel. Nothing in request input chooses it. */
export function runWithRequestContext(input, callback) {
  const current = bridge();
  if (!current) throw new Error('Node request context is not initialized.');
  if (input.channel === 'public') {
    const ipSource = input.ipSource || 'peer';
    if (input.transport !== 'tcp-loopback' || input.peerAddress !== '127.0.0.1' ||
        !isIP(input.clientIp || '') || !['peer', 'reviewed-local-proxy'].includes(ipSource) ||
        (ipSource === 'peer' && input.clientIp !== input.peerAddress) ||
        (ipSource === 'reviewed-local-proxy' && !current.config.trustLocalProxy)) {
      throw new Error('Public transport context is invalid.');
    }
    const context = Object.freeze({ channel: 'public', transport: 'tcp-loopback',
      peerAddress: input.peerAddress, clientIp: input.clientIp, ipSource, principal: null });
    return current.storage.run(context, callback);
  }
  if (input.channel === 'management' && input.transport === 'unix-socket' && input.peerAddress === null) {
    const principal = current.managementReady() ? current.config.management.operator : null;
    const context = Object.freeze({ channel: 'management', transport: 'unix-socket',
      peerAddress: null, clientIp: 'local-unix', ipSource: 'unix-transport', principal });
    return current.storage.run(context, callback);
  }
  throw new Error('Unsupported Node transport context.');
}

/** A verified OS access boundary is not a verified personal IAP/OIDC identity. */
export function managementSession() {
  const current = bridge(), context = getRequestContext();
  if (!current || !context || context.channel !== 'management' || context.transport !== 'unix-socket' ||
      !current.managementReady() || !context.principal) return emptySession;
  const operator = current.config.management.operator;
  if (!operator || context.principal.subject !== operator.subject || context.principal.name !== operator.name) return emptySession;
  return Object.freeze({ configured: true, authenticated: true, authorized: true,
    email: null, subject: operator.subject, operatorName: operator.name,
    authenticationMethod: 'unix-transport' });
}

/** Use this with the existing strict Origin/Sec-Fetch-Site mutation check. */
export function expectedRequestOrigin() {
  const current = bridge(), context = getRequestContext();
  if (!current || !context) return undefined;
  return context.channel === 'management' ? current.config.management.origin || undefined : current.config.appOrigin;
}
