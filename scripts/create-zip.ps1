param(
  [string]$SourceDir = "C:\Users\nisch\Documents\imap-toolkit",
  [string]$ZipFile   = "C:\Users\nisch\Documents\imap-toolkit\nemo-imap.zip"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

if (Test-Path $ZipFile) {
  Write-Host "Removing existing $ZipFile..." -ForegroundColor Yellow
  Remove-Item -Force $ZipFile
}

$tempStage = Join-Path $env:TEMP "nemo-imap-stage-$([System.Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $tempStage -Force | Out-Null

try {
  Write-Host "Collecting and staging files..." -ForegroundColor Cyan
  $allFiles = Get-ChildItem -Path $SourceDir -Recurse -Force | Where-Object {
    -not $_.PSIsContainer -and
    $_.FullName -notmatch '[\\/](\.git|data|dist|node_modules)[\\/]' -and
    $_.FullName -notmatch '[\\/](\.git|data|dist|node_modules)$' -and
    $_.Name -ne '.env' -and
    $_.Extension -ne '.zip'
  }

  foreach ($item in $allFiles) {
    $rel = $item.FullName.Substring($SourceDir.Length).TrimStart('\', '/')
    $dest = Join-Path $tempStage $rel
    $destDir = Split-Path -Parent $dest
    if (-not (Test-Path $destDir)) {
      New-Item -ItemType Directory -Path $destDir -Force | Out-Null
    }
    Copy-Item -Path $item.FullName -Destination $dest -Force
  }

  Write-Host "Compressing $($allFiles.Count) files into $ZipFile..." -ForegroundColor Cyan
  $itemsToZip = Get-ChildItem -Path $tempStage -Force
  Compress-Archive -Path $itemsToZip.FullName -DestinationPath $ZipFile -CompressionLevel Optimal -Force

  $info = Get-Item $ZipFile
  Write-Host "Done! Successfully created $($info.Name) ($([math]::Round($info.Length / 1KB, 1)) KB)" -ForegroundColor Green
} finally {
  if (Test-Path $tempStage) {
    Remove-Item -Path $tempStage -Recurse -Force -ErrorAction SilentlyContinue
  }
}
