export type OperatorPrincipal = Readonly<{ subject: string; name: string }>;
export type NodeTransportConfig = Readonly<{
  version: 1;
  appOrigin: string;
  localQa: boolean;
  listenHost: '127.0.0.1';
  port: number;
  trustLocalProxy: boolean;
  management: Readonly<{
    enabled: boolean;
    unixAccessConfirmed: boolean;
    origin: string | null;
    socketPath: string | null;
    operator: OperatorPrincipal | null;
  }>;
}>;
export type NodeRequestContext = Readonly<{
  channel: 'public' | 'management';
  transport: 'tcp-loopback' | 'unix-socket';
  peerAddress: string | null;
  clientIp: string;
  ipSource: 'peer' | 'reviewed-local-proxy' | 'unix-transport';
  principal: OperatorPrincipal | null;
}>;
export type ContextInput =
  | { channel: 'public'; transport: 'tcp-loopback'; peerAddress: string; clientIp: string;
      ipSource?: 'peer' | 'reviewed-local-proxy' }
  | { channel: 'management'; transport: 'unix-socket'; peerAddress: null };
export type ManagementSession = Readonly<{
  configured: boolean;
  authenticated: boolean;
  authorized: boolean;
  email: null;
  subject: string | null;
  operatorName: string | null;
  authenticationMethod: 'unix-transport' | null;
}>;
export function readNodeTransportConfig(environment?: Record<string, string | undefined>): NodeTransportConfig;
export function initializeRequestContext(config: NodeTransportConfig): void;
export function setManagementTransportReady(ready: boolean): void;
export function getNodeTransportConfig(): NodeTransportConfig | undefined;
export function getRequestContext(): NodeRequestContext | undefined;
export function runWithRequestContext<T>(input: ContextInput, callback: () => T): T;
export function managementSession(): ManagementSession;
export function expectedRequestOrigin(): string | undefined;
