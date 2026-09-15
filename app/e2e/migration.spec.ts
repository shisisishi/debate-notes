/**
 * 验收：老版本的数据库会自动升级到最新结构（新增的照片调整字段会被补上），数据不丢。
 */

import { expect, test, type ElectronApplication } from '@playwright/test'
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { freshDataDir, goto, launchApp, type Launched } from './helpers'

const ADJUST_COLUMNS = ['offset_x', 'offset_y', 'scale', 'opacity', 'blur', 'fit']

async function stubOpenDialog(app: ElectronApplication, filePaths: string[]): Promise<void> {
  await app.evaluate(({ dialog }, paths) => {
    ;(dialog as unknown as Record<string, unknown>).showOpenDialog = async () => ({
      canceled: (paths as string[]).length === 0,
      filePaths: paths as string[]
    })
  }, filePaths)
}

test.describe.configure({ mode: 'serial' })

test('旧数据库自动升级：背景照片的调整字段被补上，照片与数据都在', async () => {
  let ctx: Launched = await launchApp(freshDataDir('migrate'))
  const dataDir = ctx.dataDir
  const { page } = ctx

  // 先正常用一次：录一场比赛 + 导入一张照片
  await page.evaluate((input) => window.api.invoke('matches:create', input), {
    date: '2026-09-08',
    startTime: null,
    topic: '升级用例：这场比赛要活过数据库升级',
    category: '正赛',
    eventId: null,
    side: null,
    position: null,
    status: '胜',
    isBestDebater: false,
    comment: ''
  } as const)
  await stubOpenDialog(ctx.app, [path.join(path.resolve(process.cwd(), '..'), 'sources', '参考照片-01.jpg')])
  await goto(page, 'settings')
  await page.click('[data-testid="bg-add"]')
  await expect(page.locator('[data-testid="bg-cards"] .bg-card')).toHaveCount(1)
  await ctx.app.close()

  // 手工把库降回旧版本：去掉 v3 新增的列并把版本号写回 2
  const dbPath = path.join(dataDir, 'database.sqlite')
  const old = new DatabaseSync(dbPath)
  for (const col of ADJUST_COLUMNS) old.exec(`ALTER TABLE backgrounds DROP COLUMN ${col}`)
  old.prepare("UPDATE meta SET value = '2' WHERE key = 'schema_version'").run()
  old.close()

  // 重新打开：迁移应该自动补齐列，并且原有数据一条不少
  ctx = await launchApp(dataDir)
  const photos = (await ctx.page.evaluate(() => window.api.invoke('backgrounds:list'))) as unknown as Array<Record<string, unknown>>
  expect(photos.length).toBe(1)
  // 补上的列默认是「跟随全局设置」
  expect(photos[0].offsetX).toBeNull()
  expect(photos[0].scale).toBeNull()
  expect(photos[0].fit).toBeNull()

  const matches = (await ctx.page.evaluate(() => window.api.invoke('matches:list', { order: 'date-desc' }))) as Array<{ topic: string }>
  expect(matches.some((m) => m.topic.includes('活过数据库升级'))).toBe(true)

  // 升级后的库能正常写入调整
  const photoId = photos[0].id as number
  await ctx.page.evaluate(
    ([id, patch]) => window.api.invoke('backgrounds:adjust', id, patch),
    [photoId, { scale: 1.5, offsetX: 20, opacity: 55, fit: 'cover' }] as const
  )
  const after = (await ctx.page.evaluate(() => window.api.invoke('backgrounds:list'))) as unknown as Array<Record<string, unknown>>
  expect(after[0].scale).toBe(1.5)
  expect(after[0].opacity).toBe(55)
  await ctx.app.close()

  const db = new DatabaseSync(dbPath)
  const version = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string }
  const cols = db.prepare('PRAGMA table_info(backgrounds)').all() as Array<{ name: string }>
  db.close()
  expect(Number(version.value)).toBeGreaterThanOrEqual(3)
  for (const col of ADJUST_COLUMNS) {
    expect(cols.some((c) => c.name === col)).toBe(true)
  }
})
