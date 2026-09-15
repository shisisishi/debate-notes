/**
 * 验收：多套皮肤（极简手账 / 极简白 / 中式雅致 / 水墨夜色）——换肤生效、可持久化、不改变布局。
 */

import { expect, test } from '@playwright/test'
import { freshDataDir, goto, launchApp, readSettingsFile, screenshot, seed, type Launched } from './helpers'

test.describe.configure({ mode: 'serial' })

test.describe('皮肤', () => {
  let ctx: Launched

  test.beforeAll(async () => {
    ctx = await launchApp(freshDataDir('theme'))
  })

  test.afterAll(async () => {
    if (ctx) await ctx.app.close()
  })

  async function themeOf(): Promise<string> {
    return ctx.page.evaluate(() => document.documentElement.dataset.theme ?? '')
  }

  async function bodyBg(): Promise<string> {
    return ctx.page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  }

  async function layout(): Promise<{ side: number; head: number; mainLeft: number }> {
    return ctx.page.evaluate(() => {
      const side = document.querySelector('.sidebar')?.getBoundingClientRect()
      const head = document.querySelector('.page-head')?.getBoundingClientRect()
      const main = document.querySelector('.main')?.getBoundingClientRect()
      return { side: side?.width ?? 0, head: head?.height ?? 0, mainLeft: main?.left ?? 0 }
    })
  }

  test('四套皮肤都能切换，底色随之改变', async () => {
    await goto(ctx.page, 'settings')
    await expect(ctx.page.locator('[data-testid="theme-grid"] .theme-card')).toHaveCount(4)

    const seen = new Map<string, string>()
    for (const id of ['handbook', 'minimal', 'chinese', 'ink']) {
      await ctx.page.click(`[data-testid="theme-${id}"]`)
      await expect(ctx.page.locator(`[data-testid="theme-active-${id}"]`)).toHaveCount(1)
      expect(await themeOf()).toBe(id)
      seen.set(id, await bodyBg())
    }
    // 四套皮肤的底色互不相同
    expect(new Set(seen.values()).size).toBe(4)

    // 换皮肤不改变布局：侧栏宽度与内容起点一动不动，题头高度最多因字体度量微调
    await ctx.page.click('[data-testid="theme-handbook"]')
    const base = await layout()
    expect(base.side).toBeGreaterThan(200)
    for (const id of ['minimal', 'chinese', 'ink']) {
      await ctx.page.click(`[data-testid="theme-${id}"]`)
      await expect(ctx.page.locator(`[data-testid="theme-active-${id}"]`)).toHaveCount(1)
      const now = await layout()
      expect(now.side, `${id} 侧栏宽度`).toBe(base.side)
      expect(now.mainLeft, `${id} 内容起点`).toBe(base.mainLeft)
      expect(Math.abs(now.head - base.head), `${id} 题头高度`).toBeLessThanOrEqual(8)
    }
  })

  test('每个皮肤下正文都清楚（对比度足够）', async () => {
    for (const id of ['handbook', 'minimal', 'chinese', 'ink']) {
      await ctx.page.click(`[data-testid="theme-${id}"]`)
      await expect(ctx.page.locator(`[data-testid="theme-active-${id}"]`)).toHaveCount(1)
      await goto(ctx.page, 'overview')
      const contrast = await ctx.page.evaluate(() => {
        // 把祖先链条上的半透明底色逐层合成，得到文字真正压在什么颜色上。
        // 注意 color-mix() 会算成 color(srgb r g b / a)，分量是 0~1，需要区分处理。
        const parse = (c: string): { rgb: number[]; a: number } => {
          const nums = (c.match(/[\d.]+/g) ?? []).map(Number)
          const unit = c.startsWith('color(')
          const rgb = nums.slice(0, 3).map((n) => (unit ? Math.round(n * 255) : n))
          const a = nums.length > 3 ? nums[3] : 1
          return { rgb: rgb.length === 3 ? rgb : [255, 255, 255], a }
        }
        const lum = (rgb: number[]): number => {
          const f = (v: number): number => {
            const s = v / 255
            return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
          }
          return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2])
        }
        const paintedBg = (el: Element): number[] => {
          const chain: Element[] = []
          let node: Element | null = el
          while (node) {
            chain.unshift(node)
            node = node.parentElement
          }
          let acc = [255, 255, 255]
          for (const n of chain) {
            const { rgb, a } = parse(getComputedStyle(n).backgroundColor)
            if (a === 0) continue
            acc = [0, 1, 2].map((i) => rgb[i] * a + acc[i] * (1 - a))
          }
          return acc
        }
        const ratio = (el: Element): number => {
          const fg = parse(getComputedStyle(el).color)
          const bg = paintedBg(el)
          const a = lum(fg.rgb)
          const b = lum(bg)
          const [hi, lo] = a > b ? [a, b] : [b, a]
          return (hi + 0.05) / (lo + 0.05)
        }
        const pick = (sel: string): number | null => {
          const el = document.querySelector(sel)
          return el ? Math.round(ratio(el) * 100) / 100 : null
        }
        return {
          title: pick('.page-head__title'),
          statValue: pick('[data-testid="stat-finished"] .stat__value'),
          panelTitle: pick('.panel__title'),
          mutedLabel: pick('.stat__label')
        }
      })
      // 主要文字（题头、统计数字、面板标题）按 WCAG AA 大字号要求 ≥ 4.5
      expect(contrast.title, `${id} 题头对比度`).toBeGreaterThan(4.5)
      expect(contrast.statValue, `${id} 统计数字对比度`).toBeGreaterThan(4.5)
      expect(contrast.panelTitle, `${id} 面板标题对比度`).toBeGreaterThan(4.5)
      // 次要说明文字本身是低饱和灰，仍要求 ≥ 3
      expect(contrast.mutedLabel, `${id} 次要文字对比度`).toBeGreaterThan(3)
      await goto(ctx.page, 'settings')
    }
  })

  test('赛事成绩行的赛期不会压在赛事名上（四套皮肤都检查）', async () => {
    const page = ctx.page
    const ev1 = await seed<{ id: number }>(page, 'events:create', { name: '市大学生辩论赛', result: '冠军', note: '' })
    const ev2 = await seed<{ id: number }>(page, 'events:create', { name: '网辩邀请赛', result: '亚军', note: '' })
    const addMatch = (date: string, eventId: number, topic: string, status: string) =>
      seed(page, 'matches:create', {
        date,
        startTime: null,
        topic,
        category: '正赛',
        eventId,
        side: null,
        position: null,
        status,
        isBestDebater: false,
        comment: ''
      })
    // 赛期跨度越长，第一列文字越长——正是之前会压到赛事名上的情况
    await addMatch('2026-08-31', ev1.id, '赛期跨度长的第一场', '胜')
    await addMatch('2026-09-17', ev1.id, '赛期跨度长的第二场', '负')
    await addMatch('2026-08-26', ev2.id, '短赛期的一场', '胜')

    for (const id of ['handbook', 'minimal', 'chinese', 'ink']) {
      await goto(page, 'settings')
      await page.click(`[data-testid="theme-${id}"]`)
      await expect(page.locator(`[data-testid="theme-active-${id}"]`)).toHaveCount(1)
      await goto(page, 'overview')
      const rows = await page.evaluate(() => {
        // 文字溢出不会改变元素盒子的大小，所以必须量文字本身的范围（Range）
        const textRect = (el: Element | null): DOMRect | null => {
          if (!el) return null
          const range = document.createRange()
          range.selectNodeContents(el)
          const r = range.getBoundingClientRect()
          return r.width === 0 && r.height === 0 ? null : r
        }
        const panel = document.querySelector('[data-testid="overview-event-results"]')
        return Array.from(panel?.querySelectorAll('.day-row') ?? []).map((row) => {
          const range = textRect(row.querySelector('.day-row__range'))
          const name = textRect(row.children[1])
          const badge = row.children[2]?.getBoundingClientRect() ?? null
          return range && name && badge
            ? {
                text: (row.textContent ?? '').replace(/\s+/g, ' ').slice(0, 40),
                rangeRight: range.right,
                nameLeft: name.left,
                nameRight: name.right,
                badgeLeft: badge.left
              }
            : null
        })
      })
      expect(rows.length, `${id} 赛事成绩行数`).toBeGreaterThanOrEqual(2)
      for (const r of rows) {
        expect(r, `${id} 行结构`).not.toBeNull()
        expect(r!.rangeRight, `${id}「${r!.text}」赛期压到了赛事名`).toBeLessThanOrEqual(r!.nameLeft + 0.5)
        expect(r!.nameRight, `${id}「${r!.text}」赛事名压到了成绩徽标`).toBeLessThanOrEqual(r!.badgeLeft + 0.5)
      }
    }
    await goto(page, 'settings')
    await page.click('[data-testid="theme-handbook"]')
    await expect(page.locator('[data-testid="theme-active-handbook"]')).toHaveCount(1)
  })

  test('皮肤设置持久化，重启后仍然是选中的皮肤', async () => {
    await goto(ctx.page, 'settings')
    await ctx.page.click('[data-testid="theme-chinese"]')
    await expect(ctx.page.locator('[data-testid="theme-active-chinese"]')).toHaveCount(1)
    expect((await readSettingsFile(ctx.dataDir)).theme).toBe('chinese')
    await screenshot(ctx.page, '15-皮肤-中式雅致')
    await goto(ctx.page, 'overview')
    await screenshot(ctx.page, '16-皮肤-中式雅致-总览')

    await ctx.app.close()
    ctx = await launchApp(ctx.dataDir)
    expect(await themeOf()).toBe('chinese')

    await goto(ctx.page, 'settings')
    await expect(ctx.page.locator('[data-testid="theme-active-chinese"]')).toHaveCount(1)

    // 收尾切回默认皮肤，并各存一张截图
    await ctx.page.click('[data-testid="theme-handbook"]')
    await expect(ctx.page.locator('[data-testid="theme-active-handbook"]')).toHaveCount(1)
    await goto(ctx.page, 'overview')
    await screenshot(ctx.page, '17-皮肤-极简手账-总览')
    await goto(ctx.page, 'settings')
    await ctx.page.click('[data-testid="theme-minimal"]')
    await expect(ctx.page.locator('[data-testid="theme-active-minimal"]')).toHaveCount(1)
    await goto(ctx.page, 'overview')
    await screenshot(ctx.page, '18-皮肤-极简白-总览')
    await goto(ctx.page, 'settings')
    await ctx.page.click('[data-testid="theme-ink"]')
    await expect(ctx.page.locator('[data-testid="theme-active-ink"]')).toHaveCount(1)
    await goto(ctx.page, 'overview')
    await screenshot(ctx.page, '19-皮肤-水墨夜色-总览')
    await goto(ctx.page, 'settings')
    await ctx.page.click('[data-testid="theme-handbook"]')
    await expect(ctx.page.locator('[data-testid="theme-active-handbook"]')).toHaveCount(1)
  })
})
