# Free dev ports used by ai-quant-assistant (Windows).
$ports = @(8001, 3000, 3001, 3002)
$maxRounds = 4

function Get-ListenerPids([int]$port) {
  $found = @()
  $pattern = ":$port\s+"
  netstat -ano | Select-String "LISTENING" | Select-String $pattern | ForEach-Object {
    if ($_ -match '\s+(\d+)\s*$') {
      $found += [int]$Matches[1]
    }
  }
  return $found | Select-Object -Unique
}

for ($round = 1; $round -le $maxRounds; $round++) {
  $targetPids = @()
  foreach ($port in $ports) {
    $targetPids += Get-ListenerPids $port
  }
  $targetPids = $targetPids | Select-Object -Unique
  if (-not $targetPids) {
    break
  }
  foreach ($procId in $targetPids) {
    if ($procId -gt 0) {
      Write-Host "Killing PID $procId (round $round)"
      Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    }
  }
  Start-Sleep -Milliseconds 1200
}

$blocked = @()
foreach ($port in $ports) {
  $left = Get-ListenerPids $port
  if ($left) {
    $blocked += "port $port (PIDs: $($left -join ', '))"
  }
}

if ($blocked.Count -gt 0) {
  Write-Host ""
  Write-Host "WARNING: still in use: $($blocked -join '; ')"
  Write-Host "Close other terminals running npm/python/node, then: npm run dev:kill"
  exit 1
}

Write-Host "All dev ports free. Run: npm run dev"
exit 0
