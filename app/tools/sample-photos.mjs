/**
 * 生成两张中性占位照片（竖幅，660×1435）放进 sources/。
 *
 * 用途：示例数据会把 sources/ 里的图片导入照片库，仓库里不包含任何个人照片，
 * 所以克隆下来之后先跑一次这个脚本，示例照片功能与相关测试就有素材了。
 * 已经存在图片时默认不覆盖（--force 可以重新生成）。
 *
 * 用法：npm run sample-photos        （生成到 ../sources）
 *       node tools/sample-photos.mjs <目录> --force
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const APP_ROOT = path.resolve(HERE, '..')
const args = process.argv.slice(2)
const force = args.includes('--force')
const targetDir = path.resolve(args.find((a) => !a.startsWith('--')) ?? path.join(APP_ROOT, '..', 'sources'))

mkdirSync(targetDir, { recursive: true })
const existing = readdirSync(targetDir).filter((f) => /\.(jpe?g|png)$/i.test(f))
if (existing.length >= 2 && !force) {
  console.log(`sources/ 里已经有 ${existing.length} 张图片，跳过生成（要重做加 --force）`)
  process.exit(0)
}

const W = 660
const H = 1435
const targets = [
  { name: '占位照片-01.jpg', top: '#e8dcc8', bottom: '#8fa6b8', accent: '#c98a6b' },
  { name: '占位照片-02.jpg', top: '#f0e6dc', bottom: '#6f8f7a', accent: '#b4795f' }
]

/** 用 Windows 自带的 GDI+ 画一张竖向渐变 + 斜纹的图片，画完存成 JPEG */
function draw({ name, top, bottom, accent }) {
  const hex = (c) => c.replace('#', '')
  const script = `
Add-Type -AssemblyName System.Drawing
$W = ${W}; $H = ${H}
$bmp = New-Object System.Drawing.Bitmap $W, $H
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$rect = New-Object System.Drawing.Rectangle 0, 0, $W, $H
$c1 = [System.Drawing.ColorTranslator]::FromHtml('#${hex(top)}')
$c2 = [System.Drawing.ColorTranslator]::FromHtml('#${hex(bottom)}')
$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, $c1, $c2, 90.0
$g.FillRectangle($brush, $rect)
# 一层斜纹，避免整张图太平看不出缩略图/裁剪效果
$pen = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml('#${hex(accent)}')), 3
for ($i = -$H; $i -lt $W; $i += 42) {
  $g.DrawLine($pen, $i, 0, $i + $H, $H)
}
$g.Dispose()
$bmp.Save('${path.join(targetDir, name)}', [System.Drawing.Imaging.ImageFormat]::Jpeg)
$bmp.Dispose()
`
  execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'inherit', timeout: 120_000 })
  return path.join(targetDir, name)
}

for (const t of targets) {
  const file = draw(t)
  console.log(`生成占位照片：${file}（${W}×${H}）${existsSync(file) ? '' : ' —— 失败'}`)
}
console.log('完成。示例数据首次启动时会把它们导入照片库。')
