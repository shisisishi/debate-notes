/** 主进程数据库单例。恢复备份时需要关闭/重开，所以统一从这里取句柄。 */

import { getPaths } from '../paths'
import { seedSamplesIfNeeded } from '../samples'
import { openDatabase, type SqlDatabase } from './driver'
import { migrate } from './schema'

let handle: SqlDatabase | null = null

export function openDb(): SqlDatabase {
  if (handle) return handle
  const { databaseFile } = getPaths()
  const db = openDatabase(databaseFile)
  migrate(db)
  // 首次启动（数据为空）写入示例数据；标记文件保证只写一次
  try {
    seedSamplesIfNeeded(db)
  } catch (err) {
    console.error('[样本] 写入示例数据失败：', (err as Error).message)
  }
  handle = db
  return handle
}

export function getDb(): SqlDatabase {
  if (!handle) return openDb()
  return handle
}

export function closeDb(): void {
  if (!handle) return
  try {
    handle.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  } catch {
    /* ignore */
  }
  try {
    handle.close()
  } catch {
    /* ignore */
  }
  handle = null
}

export function reopenDb(): SqlDatabase {
  closeDb()
  return openDb()
}
