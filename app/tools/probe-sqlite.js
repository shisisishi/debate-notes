/**
 * 环境探针：确认 Electron 主进程内可用的 SQLite 驱动与运行时版本。
 * 用法：node_modules/.bin/electron tools/probe-sqlite.js
 */
const { app } = require('electron')

app.disableHardwareAcceleration()

app.whenReady().then(() => {
  const out = {
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
    v8: process.versions.v8
  }

  try {
    const { DatabaseSync } = require('node:sqlite')
    const db = new DatabaseSync(':memory:')
    db.exec('CREATE TABLE t (a TEXT, b INTEGER, c REAL)')
    const info = db.prepare('INSERT INTO t (a, b, c) VALUES (?, ?, ?)').run('辩论', 7, 1.5)
    const row = db.prepare('SELECT a, b, c FROM t WHERE b = ?').get(7)
    db.exec('CREATE TABLE u (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT)')
    const info2 = db.prepare('INSERT INTO u (v) VALUES (?)').run('x')
    out.nodeSqlite = 'ok'
    out.insertInfo = { changes: String(info.changes), lastInsertRowid: String(info.lastInsertRowid) }
    out.autoId = String(info2.lastInsertRowid)
    out.row = row
    // 布尔绑定是否被接受（决定是否需要 0/1 归一化）
    try {
      db.prepare('INSERT INTO t (a, b, c) VALUES (?, ?, ?)').run('bool', true, 0)
      out.booleanBinding = 'accepted'
    } catch (e) {
      out.booleanBinding = 'rejected: ' + e.message
    }
    // 事务与 VACUUM INTO 支持
    try {
      db.exec('BEGIN')
      db.exec('COMMIT')
      out.transaction = 'ok'
    } catch (e) {
      out.transaction = 'fail: ' + e.message
    }
    try {
      db.exec("VACUUM INTO ':memory:'")
      out.vacuumInto = 'ok'
    } catch (e) {
      out.vacuumInto = 'fail: ' + e.message
    }
    db.close()
  } catch (e) {
    out.nodeSqlite = 'fail: ' + e.message
  }

  try {
    require('better-sqlite3')
    out.betterSqlite3 = 'ok'
  } catch (e) {
    out.betterSqlite3 = 'missing'
  }

  console.log('PROBE_RESULT ' + JSON.stringify(out))
  app.exit(0)
})
