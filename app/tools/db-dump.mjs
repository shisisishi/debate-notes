/** 直接读数据库里的行数（用于 packaged 自检，不启动界面）：node tools/db-dump.mjs <数据目录> */

import { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'node:fs'
import path from 'node:path'

const dir = process.argv[2]
if (!dir) {
  console.error('用法：node tools/db-dump.mjs <数据目录>')
  process.exit(1)
}
const dbPath = path.join(dir, 'database.sqlite')
if (!existsSync(dbPath)) {
  console.log(JSON.stringify({ ok: false, reason: '没有 database.sqlite' }))
  process.exit(1)
}

const db = new DatabaseSync(dbPath)
const count = (table) => {
  try {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()
    return row && row.n !== undefined ? Number(row.n) : -1
  } catch (err) {
    console.error(`数 ${table} 失败：${err.message}`)
    return -1
  }
}
const version = (() => {
  try {
    return db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()?.value ?? null
  } catch {
    return null
  }
})()
const columns = db.prepare('PRAGMA table_info(backgrounds)').all().map((c) => c.name)
const photos = db.prepare('SELECT * FROM backgrounds ORDER BY sort_order').all()
const counts = {
  matches: count('matches'),
  events: count('events'),
  honors: count('honors'),
  backgrounds: count('backgrounds'),
  sampleMatches: (() => {
    try {
      return Number(db.prepare('SELECT COUNT(*) AS n FROM matches WHERE is_sample = 1').get()?.n ?? -1)
    } catch {
      return 0
    }
  })()
}
db.close()

console.log(
  JSON.stringify(
    {
      ok: true,
      schemaVersion: version === null ? null : Number(version),
      backgroundColumns: columns,
      counts,
      photos
    },
    null,
    2
  )
)
