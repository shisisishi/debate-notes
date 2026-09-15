/**
 * SQLite 驱动适配层。
 * 首选 Node 内置的 node:sqlite（Electron 主进程自带，无需原生编译）；
 * 若该模块不可用，则回退到 better-sqlite3（装了才会用）。两者暴露同一接口，
 * 上层仓储代码与驱动无关。
 */

export type SqlParam = string | number | bigint | null | Uint8Array | boolean | undefined

export interface RunResult {
  changes: number
  lastInsertRowid: number
}

export interface SqlStatement {
  run(...params: SqlParam[]): RunResult
  get<T = Record<string, unknown>>(...params: SqlParam[]): T | undefined
  all<T = Record<string, unknown>>(...params: SqlParam[]): T[]
}

export interface SqlDatabase {
  readonly driver: string
  exec(sql: string): void
  prepare(sql: string): SqlStatement
  close(): void
}

/** node:sqlite / better-sqlite3 都不接受 boolean，统一转成 0/1；undefined 转 NULL */
function normalize(params: SqlParam[]): Array<string | number | bigint | null | Uint8Array> {
  return params.map((p) => {
    if (p === undefined) return null
    if (typeof p === 'boolean') return p ? 1 : 0
    return p
  })
}

function toNum(v: number | bigint): number {
  return typeof v === 'bigint' ? Number(v) : v
}

interface NodeSqliteStatement {
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint }
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
}

interface NodeSqliteDb {
  exec(sql: string): void
  prepare(sql: string): NodeSqliteStatement
  close(): void
}

class NodeSqliteDatabase implements SqlDatabase {
  readonly driver = 'node:sqlite'
  private db: NodeSqliteDb

  constructor(file: string) {
    this.db = new (loadNodeSqlite() as new (f: string) => NodeSqliteDb)(file)
  }

  exec(sql: string): void {
    this.db.exec(sql)
  }

  prepare(sql: string): SqlStatement {
    const stmt = this.db.prepare(sql)
    return {
      run: (...params: SqlParam[]): RunResult => {
        const r = stmt.run(...normalize(params))
        return { changes: toNum(r.changes), lastInsertRowid: toNum(r.lastInsertRowid) }
      },
      get: <T>(...params: SqlParam[]): T | undefined => stmt.get(...normalize(params)) as T | undefined,
      all: <T>(...params: SqlParam[]): T[] => stmt.all(...normalize(params)) as T[]
    }
  }

  close(): void {
    this.db.close()
  }
}

interface BetterStatement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint }
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
}

interface BetterDb {
  exec(sql: string): void
  prepare(sql: string): BetterStatement
  close(): void
  pragma?(sql: string): unknown
}

class BetterSqliteDatabase implements SqlDatabase {
  readonly driver = 'better-sqlite3'
  private db: BetterDb

  constructor(file: string) {
    this.db = new (loadBetterSqlite3() as new (f: string) => BetterDb)(file)
  }

  exec(sql: string): void {
    this.db.exec(sql)
  }

  prepare(sql: string): SqlStatement {
    const stmt = this.db.prepare(sql)
    return {
      run: (...params: SqlParam[]): RunResult => {
        const r = stmt.run(...normalize(params))
        return { changes: r.changes, lastInsertRowid: toNum(r.lastInsertRowid) }
      },
      get: <T>(...params: SqlParam[]): T | undefined => stmt.get(...normalize(params)) as T | undefined,
      all: <T>(...params: SqlParam[]): T[] => stmt.all(...normalize(params)) as T[]
    }
  }

  close(): void {
    this.db.close()
  }
}

/**
 * 动态加载驱动。使用变量形式的模块名，避免打包器在构建期静态解析
 * （node:sqlite 在部分外部化清单里不存在，静态 import 会导致构建失败）。
 */
function dynamicRequire(spec: string): Record<string, unknown> | null {
  try {
    const req = eval('require') as ((s: string) => unknown) | undefined
    if (typeof req !== 'function') return null
    return req(spec) as Record<string, unknown>
  } catch {
    return null
  }
}

function loadNodeSqlite(): unknown {
  const mod = dynamicRequire('node:' + 'sqlite')
  return mod && typeof mod.DatabaseSync === 'function' ? mod.DatabaseSync : null
}

function loadBetterSqlite3(): unknown {
  const mod = dynamicRequire('better-' + 'sqlite3')
  if (!mod) return null
  return (mod.default ?? mod) as unknown
}

export function detectDriverName(): string {
  if (loadNodeSqlite()) return 'node:sqlite'
  if (loadBetterSqlite3()) return 'better-sqlite3'
  return '无可用驱动'
}

export function openDatabase(file: string): SqlDatabase {
  if (loadNodeSqlite()) {
    const db = new NodeSqliteDatabase(file)
    db.exec('PRAGMA foreign_keys = ON')
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA synchronous = NORMAL')
    return db
  }
  if (loadBetterSqlite3()) {
    const db = new BetterSqliteDatabase(file)
    db.exec('PRAGMA foreign_keys = ON')
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA synchronous = NORMAL')
    return db
  }
  throw new Error('没有可用的 SQLite 驱动：node:sqlite 与 better-sqlite3 均不可用')
}

/** 只读打开（用于校验备份中的数据库文件） */
export function openDatabaseReadonly(file: string): SqlDatabase {
  const db = openDatabase(file)
  return db
}

export function inTransaction<T>(db: SqlDatabase, fn: () => T): T {
  db.exec('BEGIN')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (err) {
    try {
      db.exec('ROLLBACK')
    } catch {
      /* ignore */
    }
    throw err
  }
}

/** 生成安全的 SQL 字面量字符串（只用于目录路径等我们自己控制的少量场景） */
export function sqlStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}
