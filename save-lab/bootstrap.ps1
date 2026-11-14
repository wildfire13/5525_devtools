param([string[]]$LaunchArgs = @('--gui'))
$ErrorActionPreference = 'Stop'
try {
    $file = Join-Path $PSScriptRoot '.env'
    if (Test-Path -LiteralPath $file) {
        foreach ($line in [IO.File]::ReadAllLines($file)) {
            if ($line.Trim() -notmatch '^(SAVE_LAB_(?:NODE|PYTHON|SAVE_DIR|CACHE_DIR))\s*=\s*(.*)$') { continue }
            $name = $Matches[1]
            $value = $Matches[2].Trim()
            if ($null -ne [Environment]::GetEnvironmentVariable($name, 'Process')) { continue }
            if ($value -match '^([''"])(.*)\1$') { $value = $Matches[2] }
            if (!$value) { continue }
            if (![IO.Path]::IsPathRooted($value)) { $value = Join-Path $PSScriptRoot $value }
            [Environment]::SetEnvironmentVariable($name, [IO.Path]::GetFullPath($value), 'Process')
        }
    }
    $node = $env:SAVE_LAB_NODE
    if (!$node) { $node = 'node' }
    Push-Location $PSScriptRoot
    try { & $node (Join-Path $PSScriptRoot 'launch.cjs') @LaunchArgs; $code = $LASTEXITCODE }
    finally { Pop-Location }
    exit $code
} catch {
    Write-Error 'Cannot launch save-lab. Check SAVE_LAB_NODE in the process environment or .env and ensure Node.js 18+ is installed.' -ErrorAction Continue
    exit 2
}
