param(
  [string] $DshHome = $(if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }),
  [string] $SnowArtifact,
  [string] $NpmCli
)
$ErrorActionPreference = 'Stop'
$bundleName = 'qq-bridge-public'
function Get-ChatBridgeProfile([string] $Root) {
  $profiles = Join-Path $Root 'profiles'
  if (!(Test-Path -LiteralPath $profiles -PathType Container)) { return }
  foreach ($dir in (Get-ChildItem -LiteralPath $profiles -Directory | Sort-Object Name)) {
    $manifest = Join-Path $dir.FullName 'package.json'
    $bundleRoot = Join-Path $dir.FullName ('node_modules/' + $bundleName)
    $bundleManifest = Join-Path $bundleRoot 'package.json'
    if (!(Test-Path -LiteralPath $manifest) -or !(Test-Path -LiteralPath $bundleManifest)) { continue }
    $profileData = Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json
    $bundle = Get-Content -LiteralPath $bundleManifest -Raw | ConvertFrom-Json
    if ($profileData.dsh.profile.bundles -contains $bundleName -and
        $bundle.name -eq $bundleName -and $bundle.qqBridge.profileManaged -eq $true) {
      [pscustomobject]@{ Name = $dir.Name; BundleRoot = $bundleRoot }
    }
  }
}
function Receive-VerifiedFile([string] $Uri, [string] $Target, [string] $Algorithm, [string] $Digest) {
  Invoke-WebRequest -UseBasicParsing -Uri $Uri -OutFile $Target -TimeoutSec 180
  if ((Get-FileHash -LiteralPath $Target -Algorithm $Algorithm).Hash -ine $Digest) {
    throw 'Downloaded file failed verification.'
  }
}

$found = @(Get-ChatBridgeProfile $DshHome)
if ($found.Count -eq 0) {
  Write-Host 'Install Chat Bridge with DSH Plugin Manager first.'
  $custom = Read-Host 'If DSH uses a custom data directory, enter it here. Press Enter to exit'
  if (!$custom) { exit 1 }
  $DshHome = (Resolve-Path -LiteralPath $custom).Path
  $found = @(Get-ChatBridgeProfile $DshHome)
}
if ($found.Count -eq 0) { throw 'No DSH profile has the native Chat Bridge bundle installed.' }
$selected = $found[0]
if ($found.Count -gt 1) {
  for ($i = 0; $i -lt $found.Count; $i++) { Write-Host ('{0}. {1}' -f ($i + 1), $found[$i].Name) }
  $choice = 0
  if (![int]::TryParse((Read-Host 'Choose the DSH profile number'), [ref] $choice) -or
      $choice -lt 1 -or $choice -gt $found.Count) { throw 'Invalid profile number.' }
  $selected = $found[$choice - 1]
}

$temp = [System.IO.Path]::GetTempPath()
$stage = Join-Path $temp ('chat-bridge-bootstrap-' + [guid]::NewGuid().ToString('N'))
[void] (New-Item -ItemType Directory -Path $stage)
$priorNpm = $env:npm_execpath
try {
  $snowDigest = '93096cb6d4cf576999094e9f7d1c9fb08e22f6b41c879182f015e639dc437613'
  if (!$SnowArtifact) {
    $SnowArtifact = Join-Path $stage 'SnowLuma.zip'
    Write-Host 'Downloading SnowLuma 2.4.0 (Windows x64)...'
    Receive-VerifiedFile 'https://github.com/SnowLuma/SnowLuma/releases/download/v2.4.0/SnowLuma-v2.4.0-win-x64.zip' $SnowArtifact 'SHA256' $snowDigest
  } elseif ((Get-FileHash -LiteralPath $SnowArtifact -Algorithm SHA256).Hash -ine $snowDigest) {
    throw 'SnowLuma ZIP failed verification.'
  }
  $SnowArtifact = (Resolve-Path -LiteralPath $SnowArtifact).Path
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [System.IO.Compression.ZipFile]::OpenRead($SnowArtifact)
  try {
    $entries = @($archive.Entries | Where-Object { $_.FullName -ceq 'node.exe' })
    if ($entries.Count -ne 1) { throw 'The official SnowLuma package must contain one node.exe.' }
    $node = Join-Path $stage 'node.exe'
    [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entries[0], $node, $false)
  } finally { $archive.Dispose() }
  if (!$NpmCli) {
    $npmArchive = Join-Path $stage 'npm.tgz'
    Write-Host 'Preparing a temporary package installer...'
    Receive-VerifiedFile 'https://registry.npmjs.org/npm/-/npm-11.13.0.tgz' $npmArchive 'SHA512' '7119a16a0843580d65160977520e3f5710c974f04afd4fad36d9eb97d917ba716a856c35c78c4be6dc64367eeaccfb957ef5ce997ca31e9330b2e936ba2b1b92'
    tar.exe -xzf $npmArchive -C $stage
    if ($LASTEXITCODE) { throw 'Could not extract the temporary package installer.' }
    $NpmCli = Join-Path $stage 'package/bin/npm-cli.js'
  }
  $env:npm_execpath = (Resolve-Path -LiteralPath $NpmCli).Path
  $script = Join-Path $selected.BundleRoot 'scripts/setup-chat-bridge.mjs'
  & $node $script --home $DshHome --profile $selected.Name --snow $SnowArtifact
  if ($LASTEXITCODE) { throw 'Chat Bridge setup failed. See the message above.' }
} finally {
  $env:npm_execpath = $priorNpm
  $physicalTemp = [IO.Path]::GetFullPath($temp).TrimEnd('\','/')
  $physicalStage = (Resolve-Path -LiteralPath $stage).Path
  if ((Split-Path -Parent $physicalStage).TrimEnd('\','/') -ieq $physicalTemp -and
      (Split-Path -Leaf $physicalStage) -match '^chat-bridge-bootstrap-[a-f0-9]{32}$') {
    Remove-Item -LiteralPath $physicalStage -Recurse -Force
  }
}
