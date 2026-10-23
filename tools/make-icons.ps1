# Generates extension icons — clean flat vector shield on transparent background
# Usage: npm run icons
Add-Type -AssemblyName System.Drawing

$outDir = Join-Path $PSScriptRoot "..\icons"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

foreach ($size in @(16, 32, 48, 128)) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g   = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode         = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode     = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode       = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)

  # Coordinate geometry scaled to canvas size
  $s = [float]$size
  $padX = [float]($s * 0.10)
  $padTop = [float]($s * 0.08)
  $padBot = [float]($s * 0.08)

  $left   = $padX
  $right  = $s - $padX
  $width  = $right - $left
  $top    = $padTop
  $bottom = $s - $padBot
  $height = $bottom - $top
  $centerX = [float]($s * 0.5)

  # Shoulder radius
  $r = [float]($width * 0.22)
  if ($size -le 16) { $r = [float]($width * 0.18) }

  # Shield path
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath

  # Top-left corner to top-right corner
  $path.AddArc($left, $top, $r * 2, $r * 2, 180, 90)
  $path.AddLine([float]($left + $r), $top, [float]($right - $r), $top)
  $path.AddArc($right - $r * 2, $top, $r * 2, $r * 2, 270, 90)

  # Straight upper side
  $waistY = [float]($top + $height * 0.40)
  $path.AddLine($right, [float]($top + $r), $right, $waistY)

  # Right side bezier curve down to bottom tip
  $path.AddBezier(
    $right, $waistY,
    $right, [float]($top + $height * 0.70),
    [float]($centerX + $width * 0.20), [float]($bottom - $height * 0.03),
    $centerX, $bottom
  )

  # Left side bezier curve up from bottom tip
  $path.AddBezier(
    $centerX, $bottom,
    [float]($centerX - $width * 0.20), [float]($bottom - $height * 0.03),
    $left, [float]($top + $height * 0.70),
    $left, $waistY
  )

  # Straight upper left side
  $path.AddLine($left, $waistY, $left, [float]($top + $r))
  $path.CloseFigure()

  # Fill shield with solid, clean royal blue (#2563eb)
  $shieldBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 37, 99, 235))
  $g.FillPath($shieldBrush, $path)
  $shieldBrush.Dispose()

  # Inner Emblem: clean crisp white checkmark (protection active / verified shield)
  $emblemCenterY = [float]($top + $height * 0.45)
  $strokeW = [float]([Math]::Max(2.0, $width * 0.14))

  if ($size -ge 24) {
    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, $strokeW)
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap   = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

    $p1 = New-Object System.Drawing.PointF([float]($centerX - $width * 0.21), [float]($emblemCenterY - $height * 0.01))
    $p2 = New-Object System.Drawing.PointF([float]($centerX - $width * 0.05), [float]($emblemCenterY + $height * 0.14))
    $p3 = New-Object System.Drawing.PointF([float]($centerX + $width * 0.22), [float]($emblemCenterY - $height * 0.15))

    $points = [System.Drawing.PointF[]]@($p1, $p2, $p3)
    $g.DrawLines($pen, $points)
    $pen.Dispose()
  } else {
    # 16px size: simplified bold checkmark
    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, 2.0)
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap   = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

    $p1 = New-Object System.Drawing.PointF([float]($centerX - 3.2), [float]($emblemCenterY))
    $p2 = New-Object System.Drawing.PointF([float]($centerX - 0.8), [float]($emblemCenterY + 2.2))
    $p3 = New-Object System.Drawing.PointF([float]($centerX + 3.2), [float]($emblemCenterY - 2.2))

    $points = [System.Drawing.PointF[]]@($p1, $p2, $p3)
    $g.DrawLines($pen, $points)
    $pen.Dispose()
  }

  $path.Dispose()
  $g.Dispose()

  $filePath = Join-Path $outDir "icon${size}.png"
  $bmp.Save($filePath, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host "  icon${size}.png ($size x $size)"
}

Write-Host "Icon generation complete."
