param(
  [string] $DshHome = $(if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }),
  [string] $Profile,
  [switch] $Yes
)
$ErrorActionPreference = 'Stop'
$bundle = 'qq-bridge-public'
$homeDir = (Get-Item -LiteralPath $DshHome).FullName
$management = Join-Path $homeDir 'bot-instances'
$runtime = Join-Path $management 'runtime'
if (!$Profile) {
  $choices = @(Get-ChildItem -LiteralPath $runtime -Directory | Where-Object {
    Test-Path -LiteralPath (Join-Path $_.FullName "$bundle/chat-bridge-runtime.json")
  })
  if ($choices.Count -eq 1) { $Profile = $choices[0].Name }
  else {
    $choices | ForEach-Object { Write-Host $_.Name }
    $Profile = Read-Host 'Enter the name of the profile whose Chat Bridge data should be removed'
  }
}
if ($Profile -notmatch '^[a-zA-Z0-9][a-zA-Z0-9_-]*$') { throw 'Invalid DSH profile name.' }
$parent = Join-Path $runtime $Profile
$target = Join-Path $parent $bundle
if (!(Test-Path -LiteralPath $target)) { Write-Host 'No Chat Bridge runtime data to remove.'; exit 0 }
foreach ($directory in @($homeDir, $management, $runtime, $parent, $target)) {
  $item = Get-Item -LiteralPath $directory -Force
  if (!$item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw 'Runtime ownership cannot be verified through a link.'
  }
}
$physicalTarget = (Get-Item -LiteralPath $target).FullName
if ($physicalTarget -ine [IO.Path]::GetFullPath($target) -or
    !$physicalTarget.StartsWith($homeDir.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Runtime directory does not match the expected DSH location.'
}

$profileDir = Join-Path $homeDir ('profiles/' + $Profile)
function Assert-PluginRemoved {
  $file = Join-Path $profileDir 'package.json'
  if (Test-Path -LiteralPath $file) {
    $p = Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
    if ($p.dsh.profile.bundles -contains $bundle -or
        ($p.dependencies -and $p.dependencies.PSObject.Properties[$bundle])) {
      throw 'Remove Chat Bridge in DSH Plugin Manager before removing its data.'
    }
  }
  if (Get-Item -LiteralPath (Join-Path $profileDir "node_modules/$bundle") -Force -ErrorAction SilentlyContinue) {
    throw 'DSH still has a Chat Bridge package link.'
  }
}
Assert-PluginRemoved
$receipt = Get-Content -LiteralPath (Join-Path $target 'chat-bridge-runtime.json') -Raw | ConvertFrom-Json
$descriptor = Get-Content -LiteralPath (Join-Path $target '.qq-bridge-instance.json') -Raw | ConvertFrom-Json
$manifest = Get-Content -LiteralPath (Join-Path $target '.qq-bridge-instance-manifest.json') -Raw | ConvertFrom-Json
if ($receipt.version -ne 1 -or $descriptor.root -ine $target -or $descriptor.dshHome -ine $homeDir -or
    $descriptor.profile -ine $Profile -or $descriptor.bundleName -cne $bundle -or
    $descriptor.entryId -cne 'public-bot-mode' -or $manifest.root -ine $target -or
    $manifest.instanceId -cne $descriptor.instanceId -or $manifest.bundleName -cne $bundle -or
    $manifest.profile -ine $Profile -or $manifest.dshHome -ine $homeDir -or !$manifest.installationId) {
  throw 'Chat Bridge ownership records do not match this DSH profile.'
}
if (@($manifest.sessions | Where-Object { $_ }).Count -gt 0) {
  throw 'This runtime has recorded DSH sessions. Preserve it until its session data has been reviewed.'
}
if (@($manifest.paths | Where-Object { $_.cleanup -eq 'preserve' }).Count -gt 0) {
  throw 'This runtime contains paths marked for preservation.'
}
$todo = [Collections.Generic.Stack[string]]::new()
$todo.Push($target)
while ($todo.Count -gt 0) {
  foreach ($item in (Get-ChildItem -LiteralPath $todo.Pop() -Force)) {
    if ($item.Name -eq '.git' -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
      throw 'Runtime contains a Git checkout or linked path. Cleanup stopped.'
    }
    if ($item.PSIsContainer) { $todo.Push($item.FullName) }
  }
}
if (!$Yes -and (Read-Host "Type REMOVE to delete Chat Bridge runtime data in $target") -cne 'REMOVE') { exit 1 }

$inventory = Join-Path $management 'installation-roots.json'
$guard = $inventory + '.lock'
[void] (New-Item -ItemType Directory -Path $guard -ErrorAction Stop)
$quarantine = Join-Path $parent ('chat-bridge-remove-' + [guid]::NewGuid().ToString('N'))
$moved = $false
$registered = $true
try {
  Assert-PluginRemoved
  if (Test-Path -LiteralPath (Join-Path $parent '.chat-bridge-setup.lock')) { throw 'Chat Bridge setup is still running.' }
  $running = Get-CimInstance Win32_Process | Where-Object {
    ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($target + '\', [StringComparison]::OrdinalIgnoreCase)) -or
    ($_.CommandLine -and ($_.CommandLine.IndexOf($target + '\', [StringComparison]::OrdinalIgnoreCase) -ge 0 -or
      $_.CommandLine.IndexOf($target.Replace('\','/') + '/', [StringComparison]::OrdinalIgnoreCase) -ge 0))
  }
  if ($running) { throw 'Chat Bridge runtime processes still hold the data directory.' }
  $registeredRoots = Get-Content -LiteralPath $inventory -Raw | ConvertFrom-Json
  $owned = @($registeredRoots.roots | Where-Object {
    $_.root -ieq $target -and $_.installationId -ceq $manifest.installationId -and
    $_.instanceId -ceq $manifest.instanceId -and $_.bundleName -ceq $bundle -and $_.state -ceq 'ready'
  })
  if ($registeredRoots.version -ne 1 -or $owned.Count -ne 1) { throw 'No matching runtime registration.' }
  if ((Split-Path -Parent $quarantine) -ine $parent -or (Test-Path -LiteralPath $quarantine)) {
    throw 'Invalid cleanup destination.'
  }
  Move-Item -LiteralPath $physicalTarget -Destination $quarantine
  $moved = $true
  $remaining = @($registeredRoots.roots | Where-Object { $_.installationId -cne $manifest.installationId })
  if ($remaining.Count -eq 0) { Remove-Item -LiteralPath $inventory }
  else {
    $registeredRoots.roots = $remaining
    $temporary = $inventory + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
    try {
      [IO.File]::WriteAllText($temporary, ($registeredRoots | ConvertTo-Json -Depth 12), [Text.UTF8Encoding]::new($false))
      [IO.File]::Replace($temporary, $inventory, $null)
    } finally {
      if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary }
    }
  }
  $registered = $false
  if ($remaining.Count -eq 0) {
    $leases = Join-Path $management 'account-leases'
    if (Test-Path -LiteralPath $leases) {
      $leaseDir = Get-Item -LiteralPath $leases -Force
      if ($leaseDir.PSIsContainer -and !($leaseDir.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        foreach ($row in ($manifest.paths | Where-Object { $_.producer -ceq 'managed-snow-account' })) {
          if ((Split-Path -Leaf $row.path) -match '^onebot_([1-9][0-9]{4,19})\.json$') {
            $account = $Matches[1]
            $lockFile = Join-Path $leases ($account + '.guard')
            $claim = Join-Path $leases ($account + '.json')
            $item = Get-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue
            if ($item -and !$item.PSIsContainer -and !($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -and
                $item.Length -eq 0 -and !(Test-Path -LiteralPath $claim)) { Remove-Item -LiteralPath $lockFile }
          }
        }
        if (!(Get-ChildItem -LiteralPath $leases -Force | Select-Object -First 1)) { Remove-Item -LiteralPath $leases }
      }
    }
  }
  $physicalQuarantine = (Get-Item -LiteralPath $quarantine).FullName
  if ((Split-Path -Parent $physicalQuarantine) -ine $parent -or
      (Split-Path -Leaf $physicalQuarantine) -notmatch '^chat-bridge-remove-[a-f0-9]{32}$') {
    throw 'Cleanup location no longer matches its verified quarantine.'
  }
  Remove-Item -LiteralPath $physicalQuarantine -Recurse -Force
  Write-Host 'Chat Bridge runtime data removed.'
} catch {
  if ($moved -and $registered) { Move-Item -LiteralPath $quarantine -Destination $physicalTarget }
  if ($moved -and !$registered) { Write-Host "Remaining cleanup files, if any: $quarantine" }
  throw
} finally {
  Remove-Item -LiteralPath $guard
}
foreach ($directory in @($parent, $runtime, $management)) {
  if ((Test-Path -LiteralPath $directory) -and !(Get-ChildItem -LiteralPath $directory -Force | Select-Object -First 1)) {
    Remove-Item -LiteralPath $directory
  }
}
