Add-Type -AssemblyName System.Drawing
$p = 'C:\Users\LyraInc\AppData\Local\CodeBuddyExtension\Data\d84b31c5-b6ea-454f-b2c1-d654d291b118\CodeBuddyIDE\d84b31c5-b6ea-454f-b2c1-d654d291b118\history\9dcc2683c1db5c2b44e617d14f026e75\a2e0fcc7ec2f4781a3747ccaeb3103a2\assets\image.73af29a1d3.png'
$src = [System.Drawing.Image]::FromFile($p)
$rect = New-Object System.Drawing.Rectangle 1044, 8, 26, 24
$bmp = New-Object System.Drawing.Bitmap 26, 24
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.DrawImage($src, (New-Object System.Drawing.Rectangle 0, 0, 26, 24), $rect, [System.Drawing.GraphicsUnit]::Pixel)
$big = New-Object System.Drawing.Bitmap 780, 720
$g2 = [System.Drawing.Graphics]::FromImage($big)
$g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
$g2.DrawImage($bmp, 0, 0, 780, 720)
$out = Join-Path $env:TEMP 'crop_icon6.png'
$big.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
Write-Output ('SAVED ' + $out)
