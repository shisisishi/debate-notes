/** 端到端测试基础设施：每次用例一个独立数据目录，支持重启复用同一目录。 */

import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'

export const APP_ROOT = path.resolve(__dirname, '..')
export const MAIN_ENTRY = path.join(APP_ROOT, 'out', 'main', 'index.js')
export const E2E_ROOT = path.join(APP_ROOT, '.e2e-data')
export const SHOT_DIR = path.resolve(APP_ROOT, '..', 'docs', 'screenshots', '验收')

export interface Launched {
  app: ElectronApplication
  page: Page
  dataDir: string
}

export function freshDataDir(name: string): string {
  const dir = path.join(E2E_ROOT, name)
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  return dir
}

async function openWindow(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow()
  await page.waitForSelector('[data-testid="nav"]', { timeout: 30_000 })
  return page
}

export interface LaunchOptions {
  /** 是否允许首次启动写入示例数据（默认关闭，避免影响其它用例的计数断言） */
  seedSamples?: boolean
}

export async function launchApp(dataDir: string, options: LaunchOptions = {}): Promise<Launched> {
  const app = await electron.launch({
    args: [MAIN_ENTRY],
    env: {
      ...process.env,
      DEBATE_NOTES_DATA_DIR: dataDir,
      ...(options.seedSamples ? {} : { DEBATE_NOTES_SKIP_SAMPLE: '1' })
    }
  })
  const page = await openWindow(app)
  return { app, page, dataDir }
}

/**
 * 用「默认位置」启动：只指定 HOME（相当于 %APPDATA%\DebateNotes），不设 DEBATE_NOTES_DATA_DIR，
 * 这样才能测「数据目录搬到别的盘」——数据目录由 home 里的 location.json 指针决定。
 */
export async function launchAppAtHome(home: string, options: LaunchOptions = {}): Promise<Launched> {
  const env: Record<string, string> = { ...(process.env as Record<string, string>), DEBATE_NOTES_HOME: home }
  delete env.DEBATE_NOTES_DATA_DIR
  if (!options.seedSamples) env.DEBATE_NOTES_SKIP_SAMPLE = '1'
  const app = await electron.launch({ args: [MAIN_ENTRY], env })
  const page = await openWindow(app)
  return { app, page, dataDir: home }
}

export async function restart(launched: Launched, options: LaunchOptions = {}): Promise<Launched> {
  await launched.app.close()
  return launchApp(launched.dataDir, options)
}

/** 直接经 IPC 造数据（用于批量准备，不绕过被测的读写路径） */
export async function seed<T>(page: Page, channel: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(
    async ([ch, a]) => {
      return (globalThis as unknown as { api: { invoke: (c: string, ...rest: unknown[]) => Promise<unknown> } }).api.invoke(
        ch as string,
        ...(a as unknown[])
      )
    },
    [channel, args] as const
  ) as Promise<T>
}

export async function goto(page: Page, pageKey: string): Promise<void> {
  await page.click(`[data-testid="nav-${pageKey}"]`)
  await page.waitForSelector(`[data-testid="page-${pageKey}"]`)
}

export async function readSettingsFile(dataDir: string): Promise<Record<string, unknown>> {
  return JSON.parse(readFileSync(path.join(dataDir, 'settings.json'), 'utf8')) as Record<string, unknown>
}

export async function readDbCounts(
  dataDir: string
): Promise<{ matches: number; events: number; honors: number; backgrounds: number }> {
  const sqlite = require('node:sqlite') as {
    DatabaseSync: new (f: string) => {
      prepare: (s: string) => { get: () => { c: number | bigint } }
      close: () => void
    }
  }
  const db = new sqlite.DatabaseSync(path.join(dataDir, 'database.sqlite'))
  const count = (t: string): number => Number(db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c)
  const counts = {
    matches: count('matches'),
    events: count('events'),
    honors: count('honors'),
    backgrounds: count('backgrounds')
  }
  db.close()
  return counts
}

export interface MatchFormValues {
  date: string
  time?: string
  topic: string
  category?: '正赛' | '模拟赛'
  eventName?: string
  side?: string
  position?: string
  status?: '待赛' | '未出结果' | '胜' | '负' | '无胜负'
  best?: boolean
  comment?: string
}

/** 通过界面完整走一遍「新增比赛」表单 */
export async function fillMatchForm(page: Page, v: MatchFormValues): Promise<void> {
  await page.waitForSelector('[data-testid="match-modal"]')
  await page.fill('[data-testid="match-date"]', v.date)
  if (v.time) await page.fill('[data-testid="match-time"]', v.time)
  await page.fill('[data-testid="match-topic"]', v.topic)
  if (v.category) await page.click(`[data-testid="match-category-${v.category}"]`)
  if (v.status) await page.click(`[data-testid="match-status-${v.status}"]`)
  if (v.eventName) {
    const value = await page
      .locator('[data-testid="match-event"] option', { hasText: v.eventName })
      .first()
      .getAttribute('value')
    if (!value) throw new Error(`找不到赛事选项：${v.eventName}`)
    await page.selectOption('[data-testid="match-event"]', value)
  }
  if (v.side) await page.selectOption('[data-testid="match-side"]', v.side)
  if (v.position) await page.selectOption('[data-testid="match-position"]', v.position)
  if (v.best) await page.check('[data-testid="match-best"]')
  if (v.comment) await page.fill('[data-testid="match-comment"]', v.comment)
  await page.click('[data-testid="match-save"]')
  await expect(page.locator('[data-testid="match-modal"]')).toHaveCount(0)
}

export async function screenshot(page: Page, name: string): Promise<void> {
  mkdirSync(SHOT_DIR, { recursive: true })
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`), fullPage: false })
}

export function statValue(page: Page, testId: string): Promise<string> {
  return page.locator(`[data-testid="${testId}"] .stat__value`).innerText()
}
