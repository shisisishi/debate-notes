# 生成演示视频用的标题卡与字幕条（GDI+ 绘制，中文无编码问题）
# 用法：powershell -NoProfile -File demo-overlays.ps1 -Spec <spec.json>
param([Parameter(Mandatory = $true)][string]$Spec)

Add-Type -AssemblyName System.Drawing

$cfg = [System.IO.File]::ReadAllText($Spec, [System.Text.Encoding]::UTF8) | ConvertFrom-Json

function New-Brush([string]$hex, [int]$alpha = 255) {
  $h = $hex.TrimStart('#')
  $r = [Convert]::ToInt32($h.Substring(0, 2), 16)
  $g = [Convert]::ToInt32($h.Substring(2, 2), 16)
  $b = [Convert]::ToInt32($h.Substring(4, 2), 16)
  return New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb($alpha, $r, $g, $b))
}

function New-Font([single]$size, [string]$style = 'Regular') {
  return [System.Drawing.Font]::new('Microsoft YaHei', $size, [System.Drawing.FontStyle]::$style, [System.Drawing.GraphicsUnit]::Pixel)
}

function New-RoundedPath([int]$x, [int]$y, [int]$w, [int]$h, [int]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

foreach ($img in $cfg.images) {
  $w = [int]$img.w
  $h = [int]$img.h
  $bmp = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.TextRenderingHint = 'ClearTypeGridFit'

  if ($img.kind -eq 'card') {
    $rect = New-Object System.Drawing.Rectangle 0, 0, $w, $h
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, (([System.Drawing.ColorTranslator]::FromHtml($img.bg[0]))), (([System.Drawing.ColorTranslator]::FromHtml($img.bg[1]))), 25.0
    $g.FillRectangle($brush, $rect)
    $brush.Dispose()

    # 左侧竖条 + 顶部细线，呼应程序的装饰风格
    $accent = New-Brush $img.accent
    $g.FillRectangle($accent, 0, 0, 10, $h)
    $g.FillRectangle($accent, 120, 300, 92, 6)

    $titleFont = New-Font 108 'Bold'
    $subFont = New-Font 40
    $bulletFont = New-Font 32
    $footFont = New-Font 28
    $white = New-Brush '#ffffff'
    $soft = New-Brush '#e8ded1'
    $muted = New-Brush '#a89b8c'

    $g.DrawString($img.title, $titleFont, $white, 118, 320)
    $g.DrawString($img.sub, $subFont, $soft, 122, 470)

    $y = 580
    foreach ($b in $img.bullets) {
      $g.FillEllipse($accent, 126, $y + 14, 10, 10)
      $g.DrawString($b, $bulletFont, $soft, 156, $y)
      $y += 62
    }

    if ($img.footer) {
      $g.DrawString($img.footer, $footFont, $muted, 122, ($h - 110))
    }
  }
  elseif ($img.kind -eq 'caption') {
    $g.Clear([System.Drawing.Color]::Transparent)
    $barH = $h - 28
    $path = New-RoundedPath 60 14 ($w - 120) $barH 22
    $bgBrush = New-Brush '#141210' 168
    $g.FillPath($bgBrush, $path)
    $accent = New-Brush $img.accent
    $g.FillRectangle($accent, 92, 40, 6, $barH - 52)
    $textFont = New-Font 38
    $white = New-Brush '#ffffff'
    $fmt = New-Object System.Drawing.StringFormat
    $fmt.LineAlignment = 'Center'
    $g.DrawString($img.text, $textFont, $white, (New-Object System.Drawing.RectangleF 122, 14, ($w - 260), $barH), $fmt)
  }
  elseif ($img.kind -eq 'cursor') {
    # 经典箭头光标：白底 + 深色描边，热点在左上角 (3,2)
    $g.Clear([System.Drawing.Color]::Transparent)
    $pts = @(
      (New-Object System.Drawing.PointF 3, 2),
      (New-Object System.Drawing.PointF 3, 40),
      (New-Object System.Drawing.PointF 12, 31),
      (New-Object System.Drawing.PointF 18, 44),
      (New-Object System.Drawing.PointF 24, 41),
      (New-Object System.Drawing.PointF 18, 28),
      (New-Object System.Drawing.PointF 31, 27)
    )
    $fill = New-Brush '#ffffff'
    $g.FillPolygon($fill, $pts)
    $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 20, 20, 20)), 2.4
    $g.DrawPolygon($pen, $pts)
  }
  elseif ($img.kind -eq 'cover') {
    $rect = New-Object System.Drawing.Rectangle 0, 0, $w, $h
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, (([System.Drawing.ColorTranslator]::FromHtml($img.bg[0]))), (([System.Drawing.ColorTranslator]::FromHtml($img.bg[1]))), 20.0
    $g.FillRectangle($brush, $rect)
    $brush.Dispose()
    $accent = New-Brush $img.accent
    $g.FillRectangle($accent, 0, 0, $w, 12)

    $big = New-Font 132 'Bold'
    $mid = New-Font 46
    $small = New-Font 34
    $white = New-Brush '#ffffff'
    $soft = New-Brush '#e8ded1'
    $g.DrawString($img.title, $big, $white, 120, 150)
    $g.DrawString($img.sub, $mid, $soft, 128, 330)
    $g.FillRectangle($accent, 128, 420, 120, 6)
    $g.DrawString($img.line1, $small, $soft, 128, 480)
    $g.DrawString($img.line2, $small, $soft, 128, 540)
    $g.DrawString($img.footer, $small, $accent, 128, ($h - 180))
  }

  $g.Dispose()
  $dir = Split-Path $img.out -Parent
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $bmp.Save($img.out, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host "生成：$($img.out)"
}
