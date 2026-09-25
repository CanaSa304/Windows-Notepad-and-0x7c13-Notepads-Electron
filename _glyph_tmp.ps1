Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Image]::FromFile('C:\Users\LyraInc\AppData\Local\CodeBuddyExtension\Data\d84b31c5-b6ea-454f-b2c1-d654d291b118\CodeBuddyIDE\d84b31c5-b6ea-454f-b2c1-d654d291b118\history\9dcc2683c1db5c2b44e617d14f026e75\a2e0fcc7ec2f4781a3747ccaeb3103a2\assets\image.73af29a1d3.png')
$codes = @(0xE789, 0xE73C, 0xE747, 0xE73B, 0xE738, 0xE849, 0xE8A8, 0xE73D, 0xE992, 0xEC13, 0xEF2D, 0xE978)
$cw = 90; $ch = 120
$bmp = New-Object System.Drawing.Bitmap ($cw * ($codes.Count + 1)), $ch
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::FromArgb(31, 31, 31))
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.DrawImage($src, (New-Object System.Drawing.Rectangle 15, 15, 60, 55), (New-Object System.Drawing.Rectangle 1044, 8, 26, 24), [System.Drawing.GraphicsUnit]::Pixel)
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$iconFont = New-Object System.Drawing.Font('Segoe MDL2 Assets', 46)
$white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(240, 240, 240))
$gray = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(150, 200, 255))
$lblFont = New-Object System.Drawing.Font('Consolas', 13)
$sf = New-Object System.Drawing.StringFormat
$sf.Alignment = [System.Drawing.StringAlignment]::Center
for ($i = 0; $i -lt $codes.Count; $i++) {
  $x = ($i + 1) * $cw
  $g.DrawString([string][char]$codes[$i], $iconFont, $white, (New-Object System.Drawing.RectangleF $x, 10, $cw, 80), $sf)
  $g.DrawString(('{0:X4}' -f $codes[$i]), $lblFont, $gray, $x + 20, $ch - 26)
}
$g.DrawString('TARGET', $lblFont, $gray, 22, $ch - 26)
$big = New-Object System.Drawing.Bitmap ($bmp.Width * 3), ($bmp.Height * 3)
$g2 = [System.Drawing.Graphics]::FromImage($big)
$g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
$g2.DrawImage($bmp, 0, 0, $big.Width, $big.Height)
$out = Join-Path $env:TEMP 'glyphs_top.png'
$big.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
Write-Output ('SAVED ' + $out)
