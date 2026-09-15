/**
 * 生成演示视频（B 站用）：驱动程序走一遍主要功能，ffmpeg 录屏，再合成带标题卡、字幕与光标轨迹的 1080p 成片。
 *
 * 用法：
 *   $env:FFMPEG='<ffmpeg.exe 路径>'; node tools/make-demo.mjs      # 录制 + 合成
 *   node tools/make-demo.mjs --skip-record                         # 只重新合成（改字幕/标题后重跑很快）
 *
 * 产物（交付/演示视频/）：
 *   辩论手记-演示视频-1080p.mp4 / 辩论手记-封面-1920x1080.png / 上传文案.md
 *
 * 注意：
 *   1) 录制期间会接管鼠标（演示里要看到光标移动），请不要操作电脑；
 *   2) 系统光标在 Electron 窗口上会被 Chromium 藏起来，录不到，所以光标是按记录的轨迹用 overlay 画上去的。
 */

import { _electron as electron } from 'playwright-core'
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const APP_ROOT = path.resolve(HERE, '..')
const ROOT = path.resolve(APP_ROOT, '..')
const FFMPEG = process.env.FFMPEG || 'ffmpeg'
const WORK = path.join(APP_ROOT, '.demo-video')
const RAW = path.join(WORK, 'raw.mp4')
const BODY = path.join(WORK, 'body.mp4')
const BODY_CURSOR = path.join(WORK, 'body-cursor.mp4')
const DEMO_DATA = path.join(APP_ROOT, '.demo-data')
const DATA = path.join(APP_ROOT, '.demo-video-data')
const OUT_DIR = path.join(ROOT, '交付', '演示视频')
const SKIP_RECORD = process.argv.includes('--skip-record')

const FPS = 30
const CW = 1600 // 窗口内容尺寸（DIP）
const CH = 900
const W = 1920
const H = 1080
const CAP_H = 132

const log = (...a) => console.log(...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ------------------------------------------------------------------ 光标 */

/** 常驻 PowerShell：stdin 收 "x,y"（物理像素）就移动系统光标，让演示操作真实发生在界面上 */
function startCursor() {
  const script =
    'Add-Type -AssemblyName System.Windows.Forms;' +
    "while($true){$l=[Console]::In.ReadLine(); if($null -eq $l -or $l -eq 'q'){break};" +
    '$p=$l.Split(",");[System.Windows.Forms.Cursor]::Position=New-Object System.Drawing.Point([int]$p[0]),([int]$p[1])}'
  const proc = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    stdio: ['pipe', 'ignore', 'ignore']
  })
  return {
    move(x, y) {
      try {
        proc.stdin.write(`${Math.round(x)},${Math.round(y)}\n`)
      } catch {
        /* ignore */
      }
    },
    stop() {
      try {
        proc.stdin.write('q\n')
        proc.stdin.end()
      } catch {
        /* ignore */
      }
    }
  }
}

/* ------------------------------------------------------------ 演示驱动器 */

function makeDriver(page, cursor, region, clock) {
  let pos = { x: 800, y: 420 }
  const trail = []
  const clicks = []

  const api = {
    get pos() {
      return pos
    },
    get trail() {
      return trail
    },
    get clicks() {
      return clicks
    },
    /** OS 光标用物理像素，页面鼠标事件用 CSS 像素（= DIP），所以要乘缩放比；同时记录轨迹 */
    setCursor(x, y) {
      cursor.move(x * region.scale, y * region.scale)
      const last = trail[trail.length - 1]
      if (!last || last.x !== x || last.y !== y) trail.push({ t: clock(), x, y })
    },
    async goto(key) {
      await page.click(`[data-testid="nav-${key}"]`)
      await page.waitForSelector(`[data-testid="page-${key}"]`)
      await sleep(700)
    },
    async box(selector) {
      const loc = page.locator(selector).first()
      await loc.waitFor({ state: 'visible', timeout: 15_000 })
      const box = await loc.boundingBox()
      if (!box) throw new Error(`元素没有可见区域：${selector}`)
      return box
    },
    async moveTo(selector, glide = 420) {
      const box = await api.box(selector)
      const to = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
      const from = { ...pos }
      const steps = Math.max(8, Math.round(glide / 28))
      for (let i = 1; i <= steps; i++) {
        const t = i / steps
        const x = from.x + (to.x - from.x) * t
        const y = from.y + (to.y - from.y) * t
        api.setCursor(x, y)
        await page.mouse.move(x, y)
        await sleep(glide / steps)
      }
      pos = to
      return box
    },
    async click(selector, { glide = 420, after = 700 } = {}) {
      await api.moveTo(selector, glide)
      await sleep(180)
      await page.mouse.click(pos.x, pos.y)
      clicks.push({ t: clock(), x: pos.x, y: pos.y })
      await sleep(after)
    },
    async hover(selector, hold = 900, glide = 380) {
      await api.moveTo(selector, glide)
      await sleep(hold)
    },
    async type(selector, text, { delay = 55, after = 500 } = {}) {
      await api.click(selector, { glide: 300, after: 320 })
      await page.keyboard.type(text, { delay })
      await sleep(after)
    },
    /** 用鼠标拖滑块，画面里能看到真实拖动 */
    async slider(selector, ratio, { glide = 380, after = 600 } = {}) {
      const box = await api.moveTo(selector, glide)
      const y = box.y + box.height / 2
      const targetX = box.x + 12 + (box.width - 24) * Math.min(0.98, Math.max(0.02, ratio))
      await page.mouse.move(pos.x, y)
      await page.mouse.down()
      const steps = 12
      for (let i = 1; i <= steps; i++) {
        const x = pos.x + ((targetX - pos.x) * i) / steps
        api.setCursor(x, y)
        await page.mouse.move(x, y)
        await sleep(28)
      }
      pos = { x: targetX, y }
      await page.mouse.up()
      await sleep(after)
    },
    async scrollTo(selector) {
      await page.locator(selector).first().scrollIntoViewIfNeeded()
      await sleep(900)
    },
    async invoke(channel, ...args) {
      return page.evaluate(([c, a]) => window.api.invoke(c, ...a), [channel, args])
    }
  }
  return api
}

/* ------------------------------------------------------------------- 录制 */

function startFfmpeg(region) {
  const args = [
    '-hide_banner',
    '-loglevel', 'warning',
    '-f', 'gdigrab',
    '-framerate', String(FPS),
    '-draw_mouse', '0', // 系统光标在窗口上录不到，成片里另外画
    '-offset_x', String(region.x),
    '-offset_y', String(region.y),
    '-video_size', `${region.w}x${region.h}`,
    '-i', 'desktop',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '16',
    '-pix_fmt', 'yuv420p',
    '-r', String(FPS),
    '-y', RAW
  ]
  return spawn(FFMPEG, args, { stdio: ['pipe', 'ignore', 'pipe'] })
}

async function waitForFirstFrame(proc) {
  for (let i = 0; i < 150; i++) {
    await sleep(100)
    if (existsSync(RAW) && statSync(RAW).size > 4096) return Date.now()
  }
  throw new Error('录屏没有开始（ffmpeg 没写出数据）')
}

/* --------------------------------------------------------------- 界面流程 */

async function runDemo(app, page, cursor, region, sink) {
  const t0 = Date.now()
  const clock = () => (Date.now() - t0) / 1000
  const d = makeDriver(page, cursor, region, clock)
  const caps = []
  sink.trail = d.trail
  sink.clicks = d.clicks

  async function segment(text, fn) {
    const start = clock()
    log(`  ▶ ${text}`)
    await fn()
    caps.push({ text, start, end: clock() })
    sink.caps = caps // 中途失败也能保住已录到的字幕时间轴
    sink.duration = clock()
  }

  await page.waitForSelector('[data-testid="nav"]')
  await d.invoke('settings:update', { activeBackgroundId: null })
  await page.reload()
  await page.waitForSelector('[data-testid="nav"]')
  await sleep(1500)

  // 1) 战绩总览
  await segment('战绩总览：胜率、场次、最佳辩手一眼看到，算式直接写在界面上', async () => {
    await d.goto('overview')
    await d.hover('[data-testid="stat-winrate"]', 1600)
    await d.hover('[data-testid="overview-by-category"]', 700)
    await d.moveTo('[data-testid="category-formula-正赛"]')
    await sleep(1600)
    await d.scrollTo('[data-testid="overview-event-results"]')
    await d.hover('[data-testid="overview-event-results"]', 1500)
  })

  // 2) 时间范围
  await segment('按时间范围看：本月 / 今年 / 全部，也能自选日期，随点随算', async () => {
    await d.scrollTo('[data-testid="overview-filters"]')
    await d.click('[data-testid="overview-range-month"]', { after: 1700 })
    await d.hover('[data-testid="stat-winrate"]', 1300)
    await d.click('[data-testid="overview-range-year"]', { after: 1400 })
    await d.click('[data-testid="overview-range-all"]', { after: 1600 })
  })

  // 3) 记一场比赛
  await segment('记一场比赛：辩题、正赛 / 模拟赛、赛事、正反方、辩位、结果、最佳辩手、简评', async () => {
    await d.goto('matches')
    await sleep(900)
    await d.click('[data-testid="matches-add"]', { after: 1200 })
    await d.type('[data-testid="match-topic"]', '短视频应当限制未成年人使用', { delay: 62 })
    await d.click('[data-testid="match-category"]', { after: 550 })
    await d.click('[data-testid="match-status"]', { after: 550 })
    await d.click('[data-testid="match-position"]', { after: 550 })
    await d.click('[data-testid="match-best"]', { after: 550 })
    await d.type('[data-testid="match-comment"]', '自由辩论连追三问，收尾比上次稳。', { delay: 45 })
    await d.click('[data-testid="match-save"]', { after: 2000 })
    await d.hover('[data-testid="matches-list"]', 1500)
  })

  // 4) 日历
  await segment('比赛日历：待赛、胜、负一眼分清，点日期就能开新比赛', async () => {
    await d.goto('calendar')
    await sleep(1300)
    await d.click('[data-testid="view-week"]', { after: 2000 })
    await d.hover('[data-testid="calendar-panel"]', 1500)
    await d.click('[data-testid="view-month"]', { after: 1500 })
  })

  // 5) 履历
  await segment('履历：按荣誉与战绩自动生成，也能自己改写', async () => {
    await d.goto('resume')
    await sleep(1500)
    await d.scrollTo('[data-testid="resume-experience"]')
    await d.hover('[data-testid="resume-experience"]', 1300)
    await d.scrollTo('[data-testid="resume-summary"]')
    await d.click('[data-testid="resume-edit"]', { after: 1300 })
    await d.moveTo('[data-testid="resume-editor"]')
    await page.keyboard.press('End')
    await page.keyboard.type('\n大二赛季重点补自由辩论的追问节奏。', { delay: 48 })
    await sleep(600)
    await d.click('[data-testid="resume-save"]', { after: 2000 })
  })

  // 6) 皮肤
  await segment('四套皮肤随时换，只改配色，不改布局和数据', async () => {
    await d.goto('settings')
    await d.scrollTo('[data-testid="settings-theme"]')
    await d.click('[data-testid="theme-chinese"]', { after: 2000 })
    await d.click('[data-testid="theme-ink"]', { after: 2200 })
    await d.click('[data-testid="theme-minimal"]', { after: 1900 })
    await d.click('[data-testid="theme-handbook"]', { after: 1800 })
  })

  // 7) 背景照片
  await segment('背景照片：位置、大小、透明度、模糊都能单独调', async () => {
    const photos = await d.invoke('backgrounds:list')
    const id = photos[0].id
    await d.scrollTo('[data-testid="settings-background"]')
    await d.click(`[data-testid="bg-adjust-${id}"]`, { after: 1500 })
    await d.slider('[data-testid="adjust-scale"]', 0.42, { after: 900 })
    await d.slider('[data-testid="adjust-opacity"]', 0.62, { after: 900 })
    await d.slider('[data-testid="adjust-blur"]', 0.3, { after: 900 })
    await d.click('[data-testid="adjust-set-active"]', { after: 1800 })
    await d.click('[data-testid="adjust-done"]', { after: 2000 })
    await d.hover('[data-testid="bg-cards"]', 1300)
  })

  // 8) 备份与数据目录
  await segment('每天自动备份成 zip，可导出 / 恢复；数据目录还能搬到 D 盘', async () => {
    await d.scrollTo('[data-testid="settings-backup"]')
    await d.click('[data-testid="backup-now"]', { after: 2400 })
    await d.hover('[data-testid="backup-list"]', 1700)
    await d.scrollTo('[data-testid="settings-about"]')
    await d.hover('[data-testid="data-dir-change"]', 1600)
    await sleep(700)
  })

  return { caps, trail: d.trail, clicks: d.clicks, duration: clock() }
}

function saveTimeline(sink) {
  writeFileSync(path.join(WORK, 'timeline.json'), JSON.stringify(sink, null, 2), 'utf8')
}

/* ------------------------------------------------------------ 标题卡/字幕 */

function buildOverlaySpec(caps) {
  return {
    images: [
      {
        kind: 'card',
        out: path.join(WORK, 'intro.png'),
        w: W,
        h: H,
        bg: ['#191512', '#3b2f24'],
        accent: '#c9a06a',
        title: '辩论手记',
        sub: '辩手自用的离线比赛记录程序 · Windows',
        bullets: [
          '战绩总览 / 比赛记录 / 比赛日历 / 履历 / 设置',
          '胜率、场次、最佳辩手自动统计，算式写在界面上',
          '四套皮肤 · 背景照片 · 每日自动备份',
          '完全离线：不联网、不登录，数据只在本机'
        ],
        footer: 'github.com/shisisishi/debate-notes'
      },
      {
        kind: 'cover',
        out: path.join(OUT_DIR, '辩论手记-封面-1920x1080.png'),
        w: W,
        h: H,
        bg: ['#161311', '#3a2d23'],
        accent: '#c9a06a',
        title: '辩论手记',
        sub: '辩手自己用的离线比赛记录程序',
        line1: '战绩总览 · 比赛记录 · 日历 · 履历 · 四套皮肤',
        line2: '不联网 · 不登录 · 数据全在自己电脑上',
        footer: 'github.com/shisisishi/debate-notes'
      },
      {
        kind: 'card',
        out: path.join(WORK, 'outro.png'),
        w: W,
        h: H,
        bg: ['#191512', '#3b2f24'],
        accent: '#c9a06a',
        title: '免费开源',
        sub: 'github.com/shisisishi/debate-notes',
        bullets: [
          'Windows 10 / 11 64 位，安装版与免安装版都有',
          '示例数据可一键写入，先看看效果再删掉',
          '数据在你自己的文件夹里，卸载程序也不会删',
          '每天自动备份 zip，坏备份不会覆盖现有数据'
        ],
        footer: 'Electron + React + SQLite · 个人自用项目'
      },
      {
        kind: 'cursor',
        out: path.join(WORK, 'cursor.png'),
        w: 40,
        h: 56
      },
      ...caps.map((c, i) => ({
        kind: 'caption',
        out: path.join(WORK, `cap-${i}.png`),
        w: W,
        h: CAP_H,
        accent: '#c9a06a',
        text: c.text
      }))
    ]
  }
}

function renderOverlays(spec) {
  const specFile = path.join(WORK, 'overlays.json')
  writeFileSync(specFile, JSON.stringify(spec, null, 2), 'utf8')
  const r = spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(HERE, 'demo-overlays.ps1'),
      '-Spec',
      specFile
    ],
    { stdio: 'inherit' }
  )
  if (r.status !== 0) throw new Error('生成标题卡/字幕失败')
}

/* ------------------------------------------------------------------ 编码 */

function run(args, label) {
  const r = spawnSync(FFMPEG, args, { stdio: ['ignore', 'ignore', 'pipe'] })
  if (r.status !== 0) {
    throw new Error(`${label} 失败：\n${(r.stderr || '').toString().split('\n').slice(-14).join('\n')}`)
  }
}

function rawDuration() {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-i', RAW], { encoding: 'utf8' })
  const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(r.stderr || '')
  if (!m) throw new Error('读不出录制时长')
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
}

/** 正片第一步：缩放 + 字幕叠加 */
function encodeBody(caps, duration) {
  const inputs = ['-i', RAW]
  caps.forEach((c, i) => inputs.push('-loop', '1', '-i', path.join(WORK, `cap-${i}.png`)))

  const filters = [`[0:v]scale=${W}:${H}:flags=lanczos,fps=${FPS},format=yuv420p[base]`]
  let last = 'base'
  caps.forEach((c, i) => {
    const s = Math.max(0, c.start - 0.15)
    const e = Math.min(duration, c.end + 0.5)
    filters.push(
      `[${i + 1}:v]format=yuva420p,fade=t=in:st=${s.toFixed(2)}:d=0.35:alpha=1,` +
        `fade=t=out:st=${Math.max(s + 0.4, e - 0.35).toFixed(2)}:d=0.35:alpha=1[cap${i}]`
    )
    filters.push(
      `[${last}][cap${i}]overlay=x=0:y=${H - CAP_H}:enable='between(t,${s.toFixed(2)},${e.toFixed(2)})'[v${i}]`
    )
    last = `v${i}`
  })
  filters.push(`[${last}]fade=t=in:st=0:d=0.5,fade=t=out:st=${Math.max(0, duration - 0.8).toFixed(2)}:d=0.8[vout]`)

  run(
    [
      '-hide_banner',
      ...inputs,
      '-filter_complex', filters.join(';'),
      '-map', '[vout]',
      '-t', duration.toFixed(2),
      '-r', String(FPS),
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '20',
      '-pix_fmt', 'yuv420p',
      '-y', BODY
    ],
    '合成正片（字幕）'
  )
}

/** 正片第二步：按记录的轨迹把光标画上去 */
function addCursor(trail, clicks, duration, region) {
  const sx = W / region.dip.width
  const sy = H / region.dip.height
  const lines = []
  const push = (t, cmd, v) => lines.push(`${t.toFixed(2)} overlay ${cmd} ${Math.round(v)};`)
  for (const p of trail) {
    if (p.t < 0 || p.t > duration) continue
    push(p.t, 'x', p.x * sx - 4)
    push(p.t, 'y', p.y * sy - 3)
  }
  // 最后停在原位，避免结尾光标跳回原点
  const lastPoint = trail.filter((p) => p.t <= duration).pop() || { x: 0, y: 0 }
  push(duration, 'x', lastPoint.x * sx - 4)
  push(duration, 'y', lastPoint.y * sy - 3)
  const cmdFile = path.join(WORK, 'cursor.cmd')
  writeFileSync(cmdFile, lines.join('\n'), 'utf8')
  log(`  光标轨迹：${trail.length} 个采样点、${clicks.length} 次点击`)

  run(
    [
      '-hide_banner',
      '-i', BODY,
      '-loop', '1',
      '-i', path.join(WORK, 'cursor.png'),
      '-filter_complex',
      `[0:v]sendcmd=f='${cmdFile.replace(/\\/g, '/')}'[main];` +
        `[1:v]format=yuva420p[cur];[main][cur]overlay=x=${Math.round((trail[0]?.x ?? 0) * sx)}:y=${Math.round((trail[0]?.y ?? 0) * sy)}`,
      '-t', duration.toFixed(2),
      '-r', String(FPS),
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '20',
      '-pix_fmt', 'yuv420p',
      '-y', BODY_CURSOR
    ],
    '叠加光标'
  )
}

function encodeCard(png, seconds, out) {
  run(
    [
      '-hide_banner',
      '-loop', '1',
      '-i', png,
      '-t', String(seconds),
      '-r', String(FPS),
      '-vf', `scale=${W}:${H},format=yuv420p,fade=t=in:st=0:d=0.5,fade=t=out:st=${(seconds - 0.6).toFixed(2)}:d=0.6`,
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '20',
      '-pix_fmt', 'yuv420p',
      '-y', out
    ],
    `生成 ${path.basename(out)}`
  )
}

function concatParts() {
  const list = path.join(WORK, 'parts.txt')
  writeFileSync(
    list,
    ['intro.mp4', 'body-cursor.mp4', 'outro.mp4']
      .map((f) => `file '${path.join(WORK, f).replace(/\\/g, '/')}'`)
      .join('\n'),
    'utf8'
  )
  const final = path.join(OUT_DIR, '辩论手记-演示视频-1080p.mp4')
  run(
    [
      '-hide_banner',
      '-f', 'concat',
      '-safe', '0',
      '-i', list,
      '-f', 'lavfi',
      '-i', 'anullsrc=r=48000:cl=stereo',
      '-map', '0:v',
      '-map', '1:a',
      '-shortest',
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '20',
      '-pix_fmt', 'yuv420p',
      '-r', String(FPS),
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      '-y', final
    ],
    '拼接成片'
  )
  return final
}

/* ------------------------------------------------------------ 上传文案 */

function hhmmss(sec) {
  const s = Math.max(0, Math.round(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  const pad = (n) => String(n).padStart(2, '0')
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(ss)}` : `${pad(m)}:${pad(ss)}`
}

function writeUploadKit(caps, finalDuration) {
  const lead = 4.5 // 片头标题卡
  const chapterLines = caps.map((c) => `${hhmmss(lead + c.start)} ${c.text.split('：')[0]}`)
  const body = `# B 站投稿文案（辩论手记演示视频）

## 推荐标题（挑一个）

1. 辩论手记 · 给辩手自己用的离线比赛记录程序（Windows 免费开源）
2. 自己做了一个辩手用的比赛记录程序：胜率、日历、履历一次搞定
3. 辩手向 · 离线比赛记录工具「辩论手记」演示（不联网 不登录 无广告）

## 简介（可直接粘贴）

一个给辩手自己用的离线比赛记录程序：记比赛、看胜率、翻日历、攒履历、换皮肤。
Windows 桌面软件，**不联网、不登录、没有手机端**，所有数据只存在你自己电脑的一个文件夹里。

- 战绩总览：胜率（胜 ÷（胜 + 负））、场次、最佳辩手，按本月 / 今年 / 全部 / 自选日期切换
- 比赛记录：日期、辩题、正赛 / 模拟赛、赛事、正反方、辩位、结果、最佳辩手、简评
- 比赛日历：月视图 / 周视图，待赛、胜、负、无胜负分色
- 履历：按荣誉与战绩自动生成，也能自己改写
- 设置：四套皮肤、背景照片与轮播、每张照片单独调整、每日自动备份、数据目录可搬到 D 盘

项目地址（免费开源）：https://github.com/shisisishi/debate-notes
下载安装包：https://github.com/shisisishi/debate-notes/releases

## 章节（可直接粘贴到简介里）

${chapterLines.join('\n')}

## 标签

辩论, 辩论手记, 辩手, 效率工具, 桌面软件, 开源软件, Electron, 比赛记录, 软件演示, 大学生

## 分区建议

科技 → 软件应用（或 数码 → 电脑软件）

## 封面

用同目录下的 \`辩论手记-封面-1920x1080.png\`（B 站会自动裁成 16:9）。

## 上传参数

- 文件：\`辩论手记-演示视频-1080p.mp4\`（1920×1080 / 30fps / H.264，约 ${Math.round(finalDuration)} 秒）
- 音轨：静音，方便你配 BGM（B 站会自动加片头片尾）
- 建议开启「允许他人下载」与「转载需授权」
`
  writeFileSync(path.join(OUT_DIR, '上传文案.md'), body, 'utf8')
}

/* ------------------------------------------------------------------ 主流程 */

async function main() {
  mkdirSync(WORK, { recursive: true })
  mkdirSync(OUT_DIR, { recursive: true })

  let caps = []
  let trail = []
  let clicks = []
  let duration = 0
  let region = null
  const sink = { caps: [], trail: [], clicks: [], duration: 0, region: null }

  if (!SKIP_RECORD) {
    if (!existsSync(path.join(DEMO_DATA, 'database.sqlite'))) {
      throw new Error('缺少演示数据，请先运行：npm run shots（造一份演示数据）')
    }
    rmSync(DATA, { recursive: true, force: true })
    cpSync(DEMO_DATA, DATA, { recursive: true })
    rmSync(RAW, { force: true })
    for (const f of readdirSync(WORK)) if (/^(cap-|body|intro\.mp4|outro\.mp4)/.test(f)) rmSync(path.join(WORK, f), { force: true })

    const cursor = startCursor()
    const app = await electron.launch({
      args: [path.join(APP_ROOT, 'out', 'main', 'index.js')],
      env: { ...process.env, DEBATE_NOTES_DATA_DIR: DATA, DEBATE_NOTES_SKIP_SAMPLE: '1' }
    })
    const page = await app.firstWindow()
    let ff = null
    try {
      // 窗口内容区 1600×900，并把内容区左上角顶到屏幕 (0,0)：录出来正好是内容本身，没有标题栏和任务栏
      region = await app.evaluate(({ BrowserWindow, screen }, size) => {
        const win = BrowserWindow.getAllWindows()[0]
        const scale = screen.getPrimaryDisplay().scaleFactor
        win.setContentSize(size.w, size.h)
        win.setPosition(0, 0)
        const c = win.getContentBounds()
        win.setPosition(0 - c.x, 0 - c.y)
        const c2 = win.getContentBounds()
        win.setAlwaysOnTop(true)
        win.show()
        win.focus()
        const pw = Math.round(c2.width * scale)
        const ph = Math.round(c2.height * scale)
        let vw = Math.floor(pw / 2) * 2
        let vh = Math.floor((vw * 9) / 16 / 2) * 2
        if (vh > ph) {
          vh = Math.floor(ph / 2) * 2
          vw = Math.floor((vh * 16) / 9 / 2) * 2
        }
        return {
          x: Math.round(c2.x * scale),
          y: Math.round(c2.y * scale),
          w: vw,
          h: vh,
          scale,
          dip: { width: c2.width, height: c2.height }
        }
      }, { w: CW, h: CH })
      log('录制区域：', JSON.stringify(region))

      ff = startFfmpeg(region)
      ff.stderr.on('data', (b) => {
        const s = b.toString().trim()
        if (s) log('  ffmpeg:', s)
      })
      await waitForFirstFrame(ff)
      log('开始录制')

      const result = await runDemo(app, page, cursor, region, sink)
      caps = result.caps
      trail = result.trail
      clicks = result.clicks
      duration = result.duration
      await sleep(900)
      log(`演示结束：${duration.toFixed(1)} 秒，字幕 ${caps.length} 条`)

      ff.stdin.write('q')
      await new Promise((r) => ff.once('exit', r))
      ff = null
    } finally {
      cursor.stop()
      if (ff) {
        try {
          ff.stdin.write('q')
        } catch {
          /* ignore */
        }
        ff.kill()
      }
      await app.close()
      sink.region = region
      saveTimeline(sink)
    }
  } else {
    const saved = JSON.parse(readFileSync(path.join(WORK, 'timeline.json'), 'utf8'))
    Object.assign(sink, saved)
    log(`复用上次时间轴：${sink.caps.length} 条字幕、${sink.trail.length} 个光标采样，${sink.duration.toFixed(1)} 秒`)
  }

  caps = sink.caps
  trail = sink.trail
  clicks = sink.clicks
  duration = sink.duration
  region = sink.region

  const real = rawDuration()
  log(`录制文件时长：${real.toFixed(1)} 秒`)
  duration = Math.min(duration, real)

  log('生成标题卡、字幕与光标图形…')
  renderOverlays(buildOverlaySpec(caps))

  log('合成正片（字幕）…')
  encodeBody(caps, duration)
  log('叠加光标轨迹…')
  addCursor(trail, clicks, duration, region)
  log('生成片头片尾…')
  encodeCard(path.join(WORK, 'intro.png'), 4.5, path.join(WORK, 'intro.mp4'))
  encodeCard(path.join(WORK, 'outro.png'), 6.5, path.join(WORK, 'outro.mp4'))
  const final = concatParts()

  writeUploadKit(caps, 4.5 + duration + 6.5)

  log(`成片：${final}（${(statSync(final).size / 1048576).toFixed(1)} MB）`)
  log(`封面：${path.join(OUT_DIR, '辩论手记-封面-1920x1080.png')}`)
  log(`文案：${path.join(OUT_DIR, '上传文案.md')}`)
}

await main()
