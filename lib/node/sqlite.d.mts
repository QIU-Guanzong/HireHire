export type SqliteValue = null | string | number | bigint | ArrayBufferView;
export interface SqliteOptions {
  dataRoot: string;
  migrationDirectory: string;
  databaseName?: string;
  busyTimeoutMs?: number;
  forbiddenRoots?: string[];
  /** Explicit isolated fixture opt-in. Production configuration must omit this. */
  allowTemporaryRootForTests?: boolean;
}
export interface SqliteResult<T = Record<string, unknown>> {
  results: T[];
  success: true;
  meta: { changes: number; last_row_id: number };
}
export class SqlitePreparedStatement {
  private constructor();
  bind(...bindings: SqliteValue[]): SqlitePreparedStatement;
  first<T = Record<string, unknown>>(columnName?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<SqliteResult<T>>;
  run(): Promise<SqliteResult>;
}
export class SqliteDatabase {
  private constructor();
  prepare(sql: string): SqlitePreparedStatement;
  batch<T = Record<string, unknown>>(statements: SqlitePreparedStatement[]): Promise<SqliteResult<T>[]>;
  close(): void;
}
export function openSqliteDatabase(options: SqliteOptions): SqliteDatabase;
export function isSafeSqliteVersion(version: unknown): boolean;
