param(
  [string]$HostName = "azureuser@20.193.251.109",
  [string]$KeyPath = "$HOME\.ssh\hyperspace-deployment.pem"
)

$ErrorActionPreference = "Stop"

$repo = Resolve-Path (Join-Path $PSScriptRoot "..")
$archiveName = "hermes-profile-snapshot.tar.gz"
$remoteArchive = "/home/azureuser/$archiveName"
$localArchive = Join-Path $env:TEMP $archiveName
$extract = Join-Path $env:TEMP "hermes-profile-snapshot"

ssh -i $KeyPath -o BatchMode=yes $HostName "rm -f $remoteArchive && tar -czf $remoteArchive -C /home/azureuser/.hermes config.yaml SOUL.md cron/jobs.json skills -C /home/azureuser/.hermes/hermes-agent AGENTS.md"
scp -i $KeyPath "${HostName}:$remoteArchive" $localArchive

if (Test-Path -LiteralPath $extract) {
  Remove-Item -LiteralPath $extract -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $extract | Out-Null
tar -xzf $localArchive -C $extract

New-Item -ItemType Directory -Force -Path (Join-Path $repo "hermes-home") | Out-Null
Copy-Item -LiteralPath (Join-Path $extract "config.yaml") -Destination (Join-Path $repo "hermes-home/config.yaml") -Force
Copy-Item -LiteralPath (Join-Path $extract "SOUL.md") -Destination (Join-Path $repo "hermes-home/SOUL.md") -Force

$cronDest = Join-Path $repo "hermes-home/cron"
New-Item -ItemType Directory -Force -Path $cronDest | Out-Null
Copy-Item -LiteralPath (Join-Path $extract "cron/jobs.json") -Destination (Join-Path $cronDest "jobs.json") -Force

$skillsDest = Join-Path $repo "hermes-home/skills"
if (Test-Path -LiteralPath $skillsDest) {
  Remove-Item -LiteralPath $skillsDest -Recurse -Force
}
Copy-Item -LiteralPath (Join-Path $extract "skills") -Destination $skillsDest -Recurse -Force

foreach ($runtimePath in @(".hub", ".curator_state", ".usage.json", ".usage.json.lock")) {
  $path = Join-Path $skillsDest $runtimePath
  if (Test-Path -LiteralPath $path) {
    Remove-Item -LiteralPath $path -Recurse -Force
  }
}

Copy-Item -LiteralPath (Join-Path $extract "AGENTS.md") -Destination (Join-Path $repo "AGENTS.remote.md") -Force

Remove-Item -LiteralPath $extract -Recurse -Force
Write-Host "Snapshot updated. Review with: git status"
