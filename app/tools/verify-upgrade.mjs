/**
 * 老版本数据升级自检：拿一份真实数据目录的副本，用新版本启动，确认库结构升级、数据一条不少、新功能可用。
 * 用法：node tools/verify-upgrade.mjs [源数据目录] [可执行文件路径]
 * 默认源数据目录是 %APPDATA%\DebateNotes（只读拷贝，不动原数据）。
 */

import { _electron as electron } from 'playwright-core'
import { existsSync, cpSync, rmSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const APP_ROOT = path.resolve(HERE, '..')
const SOURCE = process.argv[2] || path.join(os.homedir(), 'AppData', 'Roaming', 'DebateNotes')
const EXE = process.argv[3] || path.join(APP_ROOT, 'dist', 'win-unpacked', '辩论手记.exe')
const WORK = path.join(APP_ROOT, '.upgrade-check')

if (!existsSync(SOURCE)) {
  console.error(`源数据目录不存在：${SOURCE}`)
  process.exit(1)
}
if (!existsSync(EXE)) {
  console.error(`找不到可执行文件：${EXE}`)
  process.exit(1)
}

const snapshot = (dir) => {
  const db = new DatabaseSync(path.join(dir, 'database.sqlite'))
  const count = (sql) => Number(db.prepare(sql).get().n)
  const info = {
    schemaVersion: Number(db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()?.value ?? 0),
    matches: count('SELECT COUNT(*) AS n FROM matches'),
    events: count('SELECT COUNT(*) AS n FROM events'),
    honors: count('SELECT COUNT(*) AS n FROM honors'),
    backgrounds: count('SELECT COUNT(*) AS n FROM backgrounds'),
    photos: db.prepare('SELECT file_name, original_name FROM backgrounds ORDER BY sort_order').all(),
    columns: db.prepare('PRAGMA table_info(backgrounds)').all().map((c) => c.name)
  }
  db.close()
  return info
}

rmSync(WORK, { recursive: true, force: true })
cpSync(SOURCE, WORK, { recursive: true })
const before = snapshot(WORK)

const app = await electron.launch({ executablePath: EXE, env: { ...process.env, DEBATE_NOTES_DATA_DIR: WORK } })
const page = await app.firstWindow()
await page.waitForSelector('[data-testid="nav"]', { timeout: 60_000 })
const invoke = (c, ...a) => page.evaluate(([ch, ar]) => window.api.invoke(ch, ...ar), [c, a])

const sampleTags = await page.locator('[data-testid^="sample-tag-"]').count()
const photos = await invoke('backgrounds:list')
const settings = await invoke('settings:get')
const stats = await invoke('stats:overview', { category: 'all', eventId: 'all', range: { preset: 'all', from: '', to: '', anchor: '' } })
// 升级后的库要能写新字段
if (photos.length > 0) {
  await invoke('backgrounds:adjust', photos[0].id, { scale: 1.25, offsetX: 10, opacity: 60 })
}
const adjusted = await invoke('backgrounds:list')
const draft = await invoke('resume:saveDraft', '升级自检：手动履历')
await app.close()

const after = snapshot(WORK)
const result = {
  exe: EXE,
  source: SOURCE,
  before: { ...before, photos: before.photos },
  after,
  ui: {
    sampleTags,
    photoCount: photos.length,
    activeBackgroundId: settings.activeBackgroundId,
    theme: settings.theme,
    totalMatches: stats.total,
    adjustSaved: adjusted.length > 0 ? { scale: adjusted[0].scale, offsetX: adjusted[0].offsetX, opacity: adjusted[0].opacity } : null,
    draftSaved: draft.text
  },
  ok: false
}

result.ok =
  after.schemaVersion >= 3 &&
  after.columns.includes('offset_x') &&
  after.columns.includes('fit') &&
  after.matches === before.matches &&
  after.events === before.events &&
  after.honors === before.honors &&
  after.backgrounds === before.backgrounds &&
  JSON.stringify(after.photos) === JSON.stringify(before.photos) &&
  result.ui.photoCount === before.backgrounds &&
  result.ui.totalMatches === before.matches &&
  (before.backgrounds === 0 || result.ui.adjustSaved?.scale === 1.25) &&
  result.ui.draftSaved === '升级自检：手动履历'

console.log(JSON.stringify(result, null, 2))
rmSync(WORK, { recursive: true, force: true })
process.exit(result.ok ? 0 : 1)
