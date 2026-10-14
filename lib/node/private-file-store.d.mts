export interface PrivateFileStoreOptions {
  objectRoot: string;
  /** May lower the upload boundary; must not exceed the existing 2MiB limit. */
  maxBytes?: number;
  forbiddenRoots?: string[];
  /** Explicit isolated fixture opt-in. Production configuration must omit this. */
  allowTemporaryRootForTests?: boolean;
}
export interface PrivateStoredObject {
  size: number;
  body: ReadableStream<Uint8Array>;
  arrayBuffer(): Promise<ArrayBuffer>;
}
export class PrivateFileStore {
  constructor(options: PrivateFileStoreOptions);
  ready(): Promise<void>;
  checkReady(): Promise<void>;
  put(key: string, input: ArrayBuffer | ArrayBufferView | ReadableStream<Uint8Array>, options?: { httpMetadata?: { contentType?: string } }): Promise<void>;
  get(key: string): Promise<PrivateStoredObject | null>;
  delete(key: string): Promise<void>;
}
