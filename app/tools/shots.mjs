/**
 * 生成一份演示数据并把各页面截图到 docs/screenshots。
 * 用法：npm run shots    （可反复运行，数据存在 .demo-data，只补不删）
 */

import { _electron as electron } from 'playwright-core'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const APP_ROOT = path.resolve(HERE, '..')
const DATA_DIR = path.join(APP_ROOT, '.demo-data')
const SHOT_DIR = path.resolve(APP_ROOT, '..', 'docs', 'screenshots', '界面')

const pad = (n) => String(n).padStart(2, '0')
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const shift = (days) => {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return iso(d)
}

const log = (...a) => console.log(...a)
mkdirSync(DATA_DIR, { recursive: true })
mkdirSync(SHOT_DIR, { recursive: true })

const app = await electron.launch({
  args: [path.join(APP_ROOT, 'out', 'main', 'index.js')],
  // 截图用自己造的演示数据，关掉首次启动的示例数据，保证画面可预期
  env: { ...process.env, DEBATE_NOTES_DATA_DIR: DATA_DIR, DEBATE_NOTES_SKIP_SAMPLE: '1' }
})
const page = await app.firstWindow()
await page.waitForSelector('[data-testid="nav"]')

const invoke = (channel, ...args) => page.evaluate(([c, a]) => window.api.invoke(c, ...a), [channel, args])

async function seedDemoData() {
  const existing = await invoke('matches:list', {})
  if (existing.length > 0) {
    log(`已有 ${existing.length} 场比赛，跳过造数据`)
    return
  }
  log('生成演示数据…')
  const city = await invoke('events:create', { name: '市大学生辩论赛', result: '冠军', note: '决赛 3:2 胜出' })
  const school = await invoke('events:create', { name: '校内辩论联赛', result: '四强', note: '' })
  const online = await invoke('events:create', { name: '网辩邀请赛', result: null, note: '' })

  const rows = [
    { date: shift(0), startTime: '09:00', topic: '人工智能应当拥有著作权', category: '正赛', eventId: city.id, side: '正方', position: '一辩', status: '胜', isBestDebater: true, comment: '开篇立论抓住对方定义漏洞，评委点评时特别提到。' },
    { date: shift(-2), startTime: '14:30', topic: '短视频对青少年利大于弊', category: '正赛', eventId: school.id, side: '反方', position: '二辩', status: '负', isBestDebater: false, comment: '自由辩论阶段节奏被带走，需要加强追问。' },
    { date: shift(-6), startTime: '19:00', topic: '大学生创业应当缓行', category: '模拟赛', eventId: online.id, side: '正方', position: '三辩', status: '胜', isBestDebater: false, comment: '' },
    { date: shift(-9), startTime: null, topic: '城市应该限制私家车', category: '正赛', eventId: city.id, side: '反方', position: '四辩', status: '胜', isBestDebater: false, comment: '总结陈词收得比较稳。' },
    { date: shift(-16), startTime: '10:00', topic: '网络实名制利大于弊', category: '正赛', eventId: school.id, side: '正方', position: '一辩', status: '无胜负', isBestDebater: false, comment: '评委分歧，判了平局。' },
    { date: shift(-23), startTime: '15:00', topic: '躺平是青年对现实的妥协', category: '模拟赛', eventId: null, side: '反方', position: '二辩', status: '负', isBestDebater: false, comment: '' },
    { date: shift(-31), startTime: '09:30', topic: '电子竞技应当进入奥运会', category: '正赛', eventId: online.id, side: '正方', position: '三辩', status: '胜', isBestDebater: true, comment: '质询环节连追三问。' },
    { date: shift(-45), startTime: null, topic: '人工智能会取代教师吗', category: '模拟赛', eventId: null, side: '正方', position: '一辩', status: '未出结果', isBestDebater: false, comment: '' },
    { date: shift(3), startTime: '18:30', topic: '算法推荐应当公开', category: '正赛', eventId: city.id, side: '反方', position: '二辩', status: '待赛', isBestDebater: false, comment: '下周半决赛，先记下来。' },
    { date: shift(10), startTime: null, topic: '高校应当取消绩点排名', category: '正赛', eventId: school.id, side: '正方', position: '一辩', status: '待赛', isBestDebater: false, comment: '' }
  ]
  for (const row of rows) await invoke('matches:create', row)

  await invoke('honors:create', { name: '最佳辩手', date: shift(-31), eventId: online.id, note: '网辩邀请赛小组赛' })
  await invoke('honors:create', { name: '优秀志愿者', date: shift(-60), eventId: null, note: '校内赛事服务' })
  log('演示数据完成')
}

await seedDemoData()

// 照片库演示：把照片放进照片库（只入库、不设为当前背景，保持干净底色）
// 默认用 sources/ 里的图；设置了 SHOTS_PHOTOS_DIR 就用那个目录（用于生成不含个人照片的截图）
const photoCount = (await invoke('backgrounds:list')).length
if (photoCount === 0) {
  const sourceDir = process.env.SHOTS_PHOTOS_DIR
    ? path.resolve(process.env.SHOTS_PHOTOS_DIR)
    : path.resolve(APP_ROOT, '..', 'sources')
  const picks = readdirSync(sourceDir)
    .filter((f) => /\.(jpe?g|png)$/i.test(f))
    .sort((a, b) => a.localeCompare(b, 'zh-CN'))
    .map((f) => path.join(sourceDir, f))
  if (picks.length > 0) {
    await app.evaluate(({ dialog }, paths) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths })
    }, picks)
    await page.click('[data-testid="nav-settings"]')
    await page.waitForSelector('[data-testid="page-settings"]')
    await page.click('[data-testid="bg-add"]')
    await page.waitForTimeout(1200)
    log(`照片库演示数据：${(await invoke('backgrounds:list')).length} 张`)
  }
}

// 截图与实际默认观感保持一致：照片只在库里有，不当背景
await invoke('settings:update', { activeBackgroundId: null })

await page.reload()
await page.waitForSelector('[data-testid="nav"]')

async function resize(w, h) {
  await app.evaluate(({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) win.setContentSize(size.w, size.h)
  }, { w, h })
  await page.waitForTimeout(400)
}

async function shot(name, w = 1440, h = 900) {
  await resize(w, h)
  const file = path.join(SHOT_DIR, `${name}.png`)
  await page.screenshot({ path: file })
  log(`截图：${path.basename(file)}`)
}

const go = async (p) => {
  await page.click(`[data-testid="nav-${p}"]`)
  await page.waitForSelector(`[data-testid="page-${p}"]`)
  await page.waitForTimeout(500)
}

await go('overview')
await shot('01-战绩总览')
await go('matches')
await shot('02-比赛记录')
await go('calendar')
await shot('03-比赛日历-月视图')
await page.click('[data-testid="view-week"]')
await page.waitForTimeout(400)
await shot('04-比赛日历-周视图')
await go('resume')
await shot('05-履历')
await go('settings')
await shot('06-设置')
await go('overview')
await shot('07-窗口-1024x660', 1024, 660)

// 皮肤演示：同一个总览页在四套皮肤下的样子
const THEMES = [
  ['handbook', '极简手账'],
  ['minimal', '极简白'],
  ['chinese', '中式雅致'],
  ['ink', '水墨夜色']
]
for (const [index, [id, name]] of THEMES.entries()) {
  await invoke('settings:update', { theme: id })
  await page.reload()
  await page.waitForSelector('[data-testid="nav"]')
  await go('overview')
  await shot(`${pad(8 + index)}-皮肤-${name}`)
}
// 收尾切回默认皮肤，截图流程可重复运行
await invoke('settings:update', { theme: 'handbook' })
await page.reload()
await page.waitForSelector('[data-testid="nav"]')

// 履历：可手动编辑
await go('resume')
await page.click('[data-testid="resume-edit"]')
await page.waitForTimeout(400)
await shot('12-履历-手动编辑')
await page.click('[data-testid="resume-cancel"]')

// 背景照片：单张调整（位置 / 大小 / 透明度）
await go('settings')
const photoRows = await invoke('backgrounds:list')
await page.click(`[data-testid="bg-adjust-${photoRows[0].id}"]`)
await page.waitForTimeout(400)
await shot('13-照片调整-位置与大小')
await page.click('[data-testid="adjust-done"]')

await app.close()
log('完成')
