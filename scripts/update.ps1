# Brings this copy of the Marketing Machine up to date from GitHub, in place.
# Your data lives in "<home>\Marketing Machine data", outside this folder, so updating never touches it.
# Exit codes: 0 = nothing to do or updated without new packages, 10 = updated and packages changed (run npm install).
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$repo = 'jrmccracken/mccrackenmarketingmachine'
$branch = 'claude/mccracken-marketing-dashboard-jtitw7'
$app = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$stamp = Join-Path $app '.version'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

try {
  $sha = (Invoke-RestMethod "https://api.github.com/repos/$repo/commits/$branch" -Headers @{ 'User-Agent' = 'MarketingMachine' }).sha
} catch {
  Write-Host '  Could not check for updates (no internet?). Starting the version you have.'
  exit 0
}
if ((Test-Path $stamp) -and ((Get-Content $stamp -Raw).Trim() -eq $sha)) {
  Write-Host '  You have the latest version.'
  exit 0
}

try {
  Write-Host '  Installing the latest version...'
  $tmp = Join-Path $env:TEMP "marketing-machine-$($sha.Substring(0, 7))"
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
  Invoke-WebRequest "https://github.com/$repo/archive/$sha.zip" -OutFile "$tmp.zip" -UseBasicParsing
  Expand-Archive "$tmp.zip" -DestinationPath $tmp -Force
  $src = (Get-ChildItem $tmp -Directory | Select-Object -First 1).FullName

  $lock = Join-Path $app 'package-lock.json'
  $before = if (Test-Path $lock) { (Get-FileHash $lock).Hash } else { '' }
  # Copy the new files over this folder. Installed packages, old data folders and the running launcher are left alone.
  robocopy $src $app /E /XD node_modules data .git /XF 'Start Marketing Machine.bat' /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "copy failed ($LASTEXITCODE)" }
  $after = (Get-FileHash $lock).Hash
  Set-Content $stamp $sha
  Remove-Item "$tmp.zip", $tmp -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host '  Updated.'
  if ($before -ne $after) { exit 10 }
  exit 0
} catch {
  Write-Host "  Update didn't finish ($($_.Exception.Message)). Starting the version you have."
  exit 0
}
