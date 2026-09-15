/**
 * 打包自检：直接启动打包后的正式程序（dist/win-unpacked/辩论手记.exe），
 * 用全新的数据目录跑一遍关键链路，确认 asar、资源路径、示例数据、照片导入、皮肤、数据库都正常。
 * 用法：node tools/verify-package.mjs [可执行文件路径]
 */

import { _electron as electron } from 'playwright-core'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const APP_ROOT = path.resolve(HERE, '..')
const EXE = process.argv[2] || path.join(APP_ROOT, 'dist', 'win-unpacked', '辩论手记.exe')
const DATA_DIR = path.join(APP_ROOT, '.pkg-check-data')
const HOME_DIR = path.join(APP_ROOT, '.pkg-check-home')
const MOVE_DIR = path.join(APP_ROOT, '.pkg-check-moved')
const TMP_DIR = path.join(APP_ROOT, '.pkg-check-tmp')
const SHOT = path.join(APP_ROOT, '.pkg-check-shots')
const SOURCE_PHOTO = path.resolve(APP_ROOT, '..', 'sources', '参考照片-01.jpg')

if (!existsSync(EXE)) {
  console.error(`找不到可执行文件：${EXE}`)
  process.exit(1)
}

for (const dir of [DATA_DIR, HOME_DIR, MOVE_DIR, TMP_DIR, SHOT]) rmSync(dir, { recursive: true, force: true })
mkdirSync(DATA_DIR, { recursive: true })
mkdirSync(HOME_DIR, { recursive: true })
mkdirSync(MOVE_DIR, { recursive: true })
mkdirSync(TMP_DIR, { recursive: true })
mkdirSync(SHOT, { recursive: true })
const importedSource = path.join(TMP_DIR, '自检用照片.jpg')
copyFileSync(SOURCE_PHOTO, importedSource)

const result = { exe: EXE, steps: [], ok: false }

const app = await electron.launch({
  executablePath: EXE,
  env: { ...process.env, DEBATE_NOTES_DATA_DIR: DATA_DIR, DEBATE_NOTES_HOME: HOME_DIR }
})
result.steps.push('已启动打包后的程序')

const page = await app.firstWindow()
await page.waitForSelector('[data-testid="nav"]', { timeout: 60_000 })
result.steps.push(`界面已渲染：${await page.title()}`)

const invoke = (channel, ...args) => page.evaluate(([c, a]) => window.api.invoke(c, ...a), [channel, args])
const count = (sel) => page.locator(sel).count()

// 0) 打包资源里带着示例照片（示例数据靠它导入照片库）
// 免安装版是自解压到临时目录的，资源不在 exe 旁边，这种情况只看「示例照片是否真的入库」
const unpackedResources = path.join(path.dirname(EXE), 'resources')
const isUnpackedLayout = existsSync(path.join(unpackedResources, 'app.asar'))
const seedPhotoDir = path.join(unpackedResources, 'seed-photos')
result.seedResources = {
  dir: seedPhotoDir,
  layout: isUnpackedLayout ? 'win-unpacked' : 'portable',
  exists: existsSync(seedPhotoDir),
  files: existsSync(seedPhotoDir) ? readdirSync(seedPhotoDir) : []
}
result.steps.push(
  `打包资源示例照片：${isUnpackedLayout ? result.seedResources.exists : '（免安装版内嵌，跳过目录检查）'}（${result.seedResources.files.length} 个）`
)

// 1) 首次启动写入示例数据：10 场比赛 / 3 个赛事 / 2 条荣誉，照片入库但不设为背景
const samples = await invoke('samples:status')
const settings1 = await invoke('settings:get')
const activeImages = await count('[data-testid="bg-image"][data-active="true"]')
const opacities = await page.evaluate(() =>
  Array.from(document.querySelectorAll('[data-testid="bg-image"]')).map(
    (el) => getComputedStyle(el).opacity
  )
)
result.firstLaunch = {
  samples,
  activeBackgroundId: settings1.activeBackgroundId,
  theme: settings1.theme,
  activeImages,
  allPhotosHidden: opacities.length > 0 && opacities.every((o) => Number(o) === 0)
}
result.steps.push(
  `首次启动示例数据：${samples.matches} 场比赛 / ${samples.events} 个赛事 / ${samples.honors} 条荣誉；照片 ${samples.photos} 张且未设为背景`
)

await page.click('[data-testid="nav-matches"]')
await page.waitForSelector('[data-testid="page-matches"]')
const sampleTags = await count('[data-testid^="sample-tag-"]')
result.steps.push(`比赛记录里带「示例」标记的记录：${sampleTags} 条`)
await page.screenshot({ path: path.join(SHOT, '打包版-示例数据.png') })

// 2) 手动添加一张照片（只替换文件选择对话框，导入代码路径照旧）
await page.click('[data-testid="nav-settings"]')
await page.waitForSelector('[data-testid="page-settings"]')
await app.evaluate(({ dialog }, paths) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths })
}, [importedSource])
await page.click('[data-testid="bg-add"]')
await page.waitForTimeout(1500)
const photos = await invoke('backgrounds:list')
const latest = photos.find((p) => p.originalName === '自检用照片.jpg')
result.importedPhoto = {
  count: photos.length,
  originalName: latest?.originalName ?? null,
  copiedToDataDir: latest ? existsSync(path.join(DATA_DIR, 'photos', latest.fileName)) : false,
  activeId: (await invoke('settings:get')).activeBackgroundId
}
result.steps.push(
  `导入照片后共 ${result.importedPhoto.count} 张，已复制到数据目录：${result.importedPhoto.copiedToDataDir}`
)

// 3) 照片手动调整：设为当前背景后立刻生效（行内样式），并随重启保留
const adjustId = latest ? latest.id : photos[0].id
await invoke('backgrounds:adjust', adjustId, { scale: 1.6, offsetX: 40, offsetY: -25, opacity: 55, blur: 4, fit: 'cover' })
await invoke('backgrounds:setActive', adjustId)
await page.reload()
await page.waitForSelector('[data-testid="nav"]')
await page.click('[data-testid="nav-settings"]')
await page.waitForSelector('[data-testid="page-settings"]')
const readFrame = (id) =>
  page.evaluate((pid) => {
    const img = document.querySelector(`[data-testid="bg-image"][data-photo-id="${pid}"]`)
    if (!img) return null
    const cs = getComputedStyle(img)
    const r = img.getBoundingClientRect()
    return {
      active: img.dataset.active === 'true',
      transform: cs.transform,
      objectPosition: cs.objectPosition,
      objectFit: cs.objectFit,
      opacity: cs.opacity,
      filter: cs.filter,
      covers: r.left <= 0.5 && r.top <= 0.5 && r.right >= window.innerWidth - 0.5 && r.bottom >= window.innerHeight - 0.5
    }
  }, id)
const adjustedPhotos = await invoke('backgrounds:list')
const adjustedRow = adjustedPhotos.find((p) => p.id === adjustId)
const frame = await readFrame(adjustId)
result.photoAdjust = {
  saved: adjustedRow
    ? { scale: adjustedRow.scale, offsetX: adjustedRow.offsetX, offsetY: adjustedRow.offsetY, opacity: adjustedRow.opacity, blur: adjustedRow.blur, fit: adjustedRow.fit }
    : null,
  frame
}
result.steps.push(
  `照片调整：scale=${adjustedRow?.scale} offset=${adjustedRow?.offsetX}/${adjustedRow?.offsetY} opacity=${adjustedRow?.opacity} blur=${adjustedRow?.blur}，画面仍然铺满：${frame?.covers}`
)
// 调整界面能打开
await page.click(`[data-testid="bg-adjust-${adjustId}"]`)
await page.waitForSelector('[data-testid="photo-adjust-modal"]')
await page.screenshot({ path: path.join(SHOT, '打包版-照片调整.png') })
await page.click('[data-testid="adjust-done"]')

// 4) 履历：手动编辑并保存（打包版同样能落库）
await page.click('[data-testid="nav-resume"]')
await page.waitForSelector('[data-testid="page-resume"]')
await page.click('[data-testid="resume-edit"]')
await page.locator('[data-testid="resume-editor"]').fill('打包自检：手动编辑的履历内容')
await page.click('[data-testid="resume-save"]')
await page.waitForTimeout(500)
const draft = await invoke('resume:draft')
result.resumeDraft = { saved: draft.text, updatedAt: Boolean(draft.updatedAt), badge: await count('[data-testid="resume-draft-badge"]') }
result.steps.push(`履历手动编辑：已保存 ${draft.text === '打包自检：手动编辑的履历内容'}，标记显示 ${result.resumeDraft.badge === 1}`)

// 5) 皮肤：切换后写入设置，重启级别的刷新后仍然生效
await page.click('[data-testid="nav-settings"]')
await page.waitForSelector('[data-testid="page-settings"]')
await page.click('[data-testid="theme-chinese"]')
await page.waitForTimeout(400)
const themeAfterSwitch = await page.evaluate(() => document.documentElement.dataset.theme)
const bgAfterSwitch = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
await page.screenshot({ path: path.join(SHOT, '打包版-中式皮肤.png') })
await page.reload()
await page.waitForSelector('[data-testid="nav"]')
const themeAfterReload = await page.evaluate(() => document.documentElement.dataset.theme)
result.theme = { afterSwitch: themeAfterSwitch, afterReload: themeAfterReload, bodyBg: bgAfterSwitch }
result.steps.push(`皮肤切换：${themeAfterSwitch}，刷新后：${themeAfterReload}`)

// 5.1) 刷新后照片调整与履历草稿都还在
const frameAfterReload = await readFrame(adjustId)
const draftAfterReload = await invoke('resume:draft')
result.persisted = {
  frame: frameAfterReload,
  adjustKept: frameAfterReload?.transform === frame?.transform && frameAfterReload?.objectPosition === frame?.objectPosition,
  draftKept: draftAfterReload.text === '打包自检：手动编辑的履历内容'
}
result.steps.push(`刷新后：照片调整保留 ${result.persisted.adjustKept}，履历草稿保留 ${result.persisted.draftKept}`)

// 6) 示例数据一键删除：示例清空，照片与后面的自检数据保留
await page.click('[data-testid="nav-settings"]')
await page.waitForSelector('[data-testid="page-settings"]')
await page.click('[data-testid="samples-clear"]')
await page.click('[data-testid="confirm-ok"]')
await page.waitForTimeout(800)
result.samplesAfterClear = await invoke('samples:status')
result.steps.push(
  `删除示例后：${result.samplesAfterClear.matches} 场比赛 / ${result.samplesAfterClear.events} 个赛事 / ${result.samplesAfterClear.honors} 条荣誉，照片 ${result.samplesAfterClear.photos} 张`
)

// 6b) 重新写入示例：补回 10/3/2，且重复点不会翻倍
await page.click('[data-testid="samples-reseed"]')
await page.click('[data-testid="confirm-ok"]')
await page.waitForTimeout(900)
result.samplesAfterReseed = await invoke('samples:status')
await page.click('[data-testid="samples-reseed"]')
await page.click('[data-testid="confirm-ok"]')
await page.waitForTimeout(900)
result.samplesAfterReseedAgain = await invoke('samples:status')
result.steps.push(
  `重新写入示例：${result.samplesAfterReseed.matches}/${result.samplesAfterReseed.events}/${result.samplesAfterReseed.honors}，再点一次仍然是 ${result.samplesAfterReseedAgain.matches}/${result.samplesAfterReseedAgain.events}/${result.samplesAfterReseedAgain.honors}，照片 ${result.samplesAfterReseedAgain.photos} 张`
)

// 6c) 数据目录搬迁：复制到别的目录 + 在「默认位置」写下指针（自检用的是临时 HOME，不会碰真实用户目录）
const inspection = await invoke('dataDir:inspect', MOVE_DIR)
const moved = await invoke('dataDir:relocate', MOVE_DIR)
const pointerFile = path.join(HOME_DIR, 'location.json')
const pointerData = existsSync(pointerFile) ? JSON.parse(readFileSync(pointerFile, 'utf8')) : null
result.dataDirMove = {
  inspection,
  ok: moved.ok,
  adopted: moved.adopted,
  copiedFiles: moved.copiedFiles,
  targetHasDb: existsSync(path.join(MOVE_DIR, 'database.sqlite')),
  targetPhotos: existsSync(path.join(MOVE_DIR, 'photos')) ? readdirSync(path.join(MOVE_DIR, 'photos')).length : 0,
  originKept: existsSync(path.join(DATA_DIR, 'database.sqlite')),
  pointer: pointerData?.dataDir ?? null,
  error: moved.error
}
result.steps.push(
  `数据目录搬迁：复制 ${moved.copiedFiles} 个文件到 ${path.basename(MOVE_DIR)}，指针 -> ${pointerData?.dataDir ? path.basename(pointerData.dataDir) : '（无）'}，原位置保留 ${existsSync(path.join(DATA_DIR, 'database.sqlite'))}`
)

// 7) 数据库读写
const match = await invoke('matches:create', {
  date: '2026-09-14',
  startTime: '20:00',
  topic: '打包自检：这场比赛应当能被写入并读回',
  category: '正赛',
  eventId: null,
  side: '正方',
  position: '一辩',
  status: '胜',
  isBestDebater: true,
  comment: 'verify-package'
})
const list = await invoke('matches:list', {})
const found = list.find((m) => m.id === match.id)
result.matchRoundTrip = Boolean(found && found.topic.includes('打包自检'))
const stats = await invoke('stats:overview', {
  category: 'all',
  eventId: 'all',
  range: { preset: 'all', from: '', to: '', anchor: '' }
})
result.stats = { wins: stats.wins, finished: stats.finished, winRate: stats.winRate, bestDebater: stats.bestDebaterCount }
result.steps.push(`比赛写入并读回：${result.matchRoundTrip}，统计胜场 ${stats.wins}`)

await page.click('[data-testid="nav-overview"]')
await page.waitForSelector('[data-testid="page-overview"]')
await page.waitForTimeout(800)
await page.screenshot({ path: path.join(SHOT, '打包版-总览.png') })

await app.close()
result.steps.push('程序已正常退出')

// 落盘检查
result.disk = {
  database: existsSync(path.join(DATA_DIR, 'database.sqlite')),
  settings: existsSync(path.join(DATA_DIR, 'settings.json')),
  seedMarker: existsSync(path.join(DATA_DIR, 'seed.json')),
  photos: existsSync(path.join(DATA_DIR, 'photos')) ? readdirSync(path.join(DATA_DIR, 'photos')) : [],
  backups: existsSync(path.join(DATA_DIR, 'backups')) ? readdirSync(path.join(DATA_DIR, 'backups')) : []
}
if (result.disk.settings) {
  const s = JSON.parse(readFileSync(path.join(DATA_DIR, 'settings.json'), 'utf8'))
  result.settingsOnDisk = {
    theme: s.theme,
    backgroundOpacity: s.backgroundOpacity,
    panelOpacity: s.panelOpacity,
    backgroundCover: s.backgroundCover,
    rotationIntervalMs: s.rotationIntervalMs
  }
}

result.ok =
  (!isUnpackedLayout || result.seedResources.exists) &&
  result.firstLaunch.samples.matches === 10 &&
  result.firstLaunch.samples.events === 3 &&
  result.firstLaunch.samples.honors === 2 &&
  result.firstLaunch.samples.photos === 2 &&
  result.firstLaunch.activeBackgroundId === null &&
  result.firstLaunch.activeImages === 0 &&
  result.firstLaunch.allPhotosHidden === true &&
  sampleTags === 10 &&
  result.importedPhoto.count === 3 &&
  result.importedPhoto.copiedToDataDir === true &&
  result.photoAdjust.saved?.scale === 1.6 &&
  result.photoAdjust.saved?.opacity === 55 &&
  result.photoAdjust.saved?.fit === 'cover' &&
  result.photoAdjust.frame?.opacity === '0.55' &&
  result.photoAdjust.frame?.objectPosition === '30% 62.5%' &&
  result.photoAdjust.frame?.objectFit === 'cover' &&
  result.photoAdjust.frame?.filter.includes('blur(4px)') &&
  result.photoAdjust.frame?.covers === true &&
  result.resumeDraft.saved === '打包自检：手动编辑的履历内容' &&
  result.resumeDraft.badge === 1 &&
  result.persisted.adjustKept === true &&
  result.persisted.draftKept === true &&
  result.theme.afterSwitch === 'chinese' &&
  result.theme.afterReload === 'chinese' &&
  result.samplesAfterClear.matches === 0 &&
  result.samplesAfterClear.events === 0 &&
  result.samplesAfterClear.honors === 0 &&
  result.samplesAfterClear.photos === 3 &&
  result.samplesAfterReseed.matches === 10 &&
  result.samplesAfterReseed.events === 3 &&
  result.samplesAfterReseed.honors === 2 &&
  result.samplesAfterReseed.photos === 3 &&
  result.samplesAfterReseedAgain.matches === 10 &&
  result.samplesAfterReseedAgain.events === 3 &&
  result.samplesAfterReseedAgain.honors === 2 &&
  result.dataDirMove.ok === true &&
  result.dataDirMove.adopted === false &&
  result.dataDirMove.copiedFiles > 0 &&
  result.dataDirMove.targetHasDb === true &&
  result.dataDirMove.targetPhotos === 3 &&
  result.dataDirMove.originKept === true &&
  path.resolve(result.dataDirMove.pointer ?? '') === path.resolve(MOVE_DIR) &&
  result.matchRoundTrip === true &&
  result.disk.database &&
  result.disk.settings &&
  result.disk.seedMarker &&
  result.disk.photos.length === 3 &&
  result.settingsOnDisk.theme === 'chinese'

console.log(JSON.stringify(result, null, 2))
process.exit(result.ok ? 0 : 1)
