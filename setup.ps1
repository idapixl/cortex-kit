# cortex-engine setup script for Windows
# Usage: .\setup.ps1 -Target C:\path\to\project
# Prefer: npx fozikio init (does this automatically)

param(
    [Parameter(Mandatory=$true)]
    [string]$Target
)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not (Test-Path $Target)) {
    Write-Error "Target directory does not exist: $Target"
    exit 1
}

$ClaudeDir = Join-Path $Target ".claude"
New-Item -ItemType Directory -Force -Path "$ClaudeDir\hooks", "$ClaudeDir\skills", "$ClaudeDir\agents", "$ClaudeDir\state" | Out-Null

Write-Host "Installing cortex-engine to $Target..."

# Copy hooks (Windows doesn't support symlinks reliably)
Get-ChildItem "$ScriptDir\hooks\*.sh" | ForEach-Object {
    Copy-Item $_.FullName "$ClaudeDir\hooks\$($_.Name)" -Force
    Write-Host "  Copied hook: $($_.Name)"
}

# Copy skills
Get-ChildItem "$ScriptDir\skills" -Directory | ForEach-Object {
    $skillDir = "$ClaudeDir\skills\$($_.Name)"
    New-Item -ItemType Directory -Force -Path $skillDir | Out-Null
    Copy-Item "$($_.FullName)\SKILL.md" "$skillDir\SKILL.md" -Force
    Write-Host "  Copied skill: $($_.Name)"
}

# Copy agents (skip existing)
Get-ChildItem "$ScriptDir\agents\*.md" | ForEach-Object {
    $dest = "$ClaudeDir\agents\$($_.Name)"
    if (Test-Path $dest) {
        Write-Host "  Skipped agent (exists): $($_.Name)"
    } else {
        Copy-Item $_.FullName $dest
        Write-Host "  Copied agent: $($_.Name)"
    }
}

# Write version
$version = (Get-Content "$ScriptDir\fozikio.json" | ConvertFrom-Json).version
Set-Content "$ClaudeDir\cortex-engine.version" $version

Write-Host ""
Write-Host "cortex-engine v$version installed successfully!"
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Set CORTEX_API_URL and CORTEX_API_TOKEN in your environment"
Write-Host "  2. Register hooks in your .claude/settings.json (see examples/)"
