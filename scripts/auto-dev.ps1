<#
.SYNOPSIS
  Unattended story loop: runs BMAD's bmad-build-auto headless via Claude Code, one story at a time.

.DESCRIPTION
  Picks the next unfinished story from sprint-status.yaml, runs `claude -p "/bmad-build-auto ..."`,
  and checks the resulting spec status. Stops on the first story that does not reach `done`.
  It never pushes or merges; you review the local commits and push `development` yourself.

  Spec files under _bmad-output/implementation-artifacts are the source of truth for completion
  (sprint-status.yaml lags behind). A finished story is marked `review` in sprint-status.yaml,
  meaning it was built and agent-reviewed and is waiting for your checkpoint.

.EXAMPLE
  ./scripts/auto-dev.ps1 -DryRun            # show what would run
  ./scripts/auto-dev.ps1                    # build one story
  ./scripts/auto-dev.ps1 -Max 3 -FullSuite  # up to 3 stories, then the full Django suite
  ./scripts/auto-dev.ps1 -Story 4-5         # a specific story
#>
[CmdletBinding()]
param(
    [int]$Max = 1,
    [string]$Story = '',
    # Free-form work (e.g. a deferred-work item) instead of the next sprint story. Runs once.
    [string]$Intent = '',
    [switch]$FullSuite,
    [switch]$DryRun,
    [string]$Branch = 'development',
    [string]$Model = ''
)

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $Root

$Artifacts = Join-Path $Root '_bmad-output\implementation-artifacts'
$SprintFile = Join-Path $Artifacts 'sprint-status.yaml'
$LogDir = Join-Path $env:TEMP 'mawareeth-auto-dev'
New-Item -ItemType Directory -Force $LogDir | Out-Null
$PgBin = 'C:\Program Files\PostgreSQL\18\bin'
$PgData = 'C:\Program Files\PostgreSQL\18\data'

function Say([string]$msg, [string]$color = 'Cyan') { Write-Host "[auto-dev] $msg" -ForegroundColor $color }
function Fail([string]$msg) { Write-Host "[auto-dev] STOP: $msg" -ForegroundColor Red; exit 1 }

function Git-Out([string[]]$gitArgs) {
    $out = & git @gitArgs
    if ($LASTEXITCODE -ne 0) { Fail "git $($gitArgs -join ' ') failed" }
    return $out
}

function Get-SpecStatus([string]$path) {
    $lines = Get-Content $path -TotalCount 40
    if ($lines.Count -eq 0 -or $lines[0].Trim() -ne '---') { return '' }
    for ($i = 1; $i -lt $lines.Count; $i++) {
        if ($lines[$i].Trim() -eq '---') { break }
        if ($lines[$i] -match '^status:\s*[''"]?([\w-]+)[''"]?\s*$') { return $Matches[1] }
    }
    return ''
}

# Story number prefix "4-4" from key "4-4-share-report-...". Spec slugs differ from sprint keys,
# so specs are matched on this prefix; "spec-1-7-*" does not match "spec-1-7b-*".
function Get-StoryNum([string]$key) {
    if ($key -match '^(\d+-\d+[a-z]?)-') { return $Matches[1] } else { return $key }
}

function Find-Spec([string]$key) {
    $num = Get-StoryNum $key
    Get-ChildItem $Artifacts -Filter "spec-$num-*.md" -File |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
}

function Get-Stories {
    foreach ($line in Get-Content $SprintFile) {
        if ($line -match '^\s+(\d+-\d+[a-z]?-[\w-]+):\s*([\w-]+)\s*$') {
            [pscustomobject]@{ Key = $Matches[1]; Sprint = $Matches[2] }
        }
    }
}

function Pick-Next {
    foreach ($s in Get-Stories) {
        if ($Story -and (Get-StoryNum $s.Key) -ne $Story -and $s.Key -ne $Story) { continue }
        if ($s.Sprint -eq 'done') { continue }
        $spec = Find-Spec $s.Key
        $specStatus = if ($spec) { Get-SpecStatus $spec.FullName } else { '' }
        if ($specStatus -eq 'done') { continue }
        return [pscustomobject]@{ Key = $s.Key; Spec = $spec; SpecStatus = $specStatus }
    }
    return $null
}

function Set-SprintStatus([string]$key, [string]$status) {
    $text = [IO.File]::ReadAllText($SprintFile)
    $new = [regex]::Replace($text, "(?m)^(\s+$([regex]::Escape($key)):\s*)[\w-]+", "`${1}$status")
    [IO.File]::WriteAllText($SprintFile, $new, (New-Object Text.UTF8Encoding $false))
}

function Assert-Clean {
    $dirty = Git-Out @('status', '--porcelain')
    if ($dirty) { Fail "working tree is not clean:`n$($dirty -join "`n")" }
}

function Ensure-Postgres {
    & "$PgBin\pg_isready.exe" -h localhost -p 5432 | Out-Null
    if ($LASTEXITCODE -eq 0) { return }
    Say 'Postgres is down; starting it with pg_ctl'
    & "$PgBin\pg_ctl.exe" start -D $PgData -l (Join-Path $env:TEMP 'pg18.log') -w | Out-Null
    & "$PgBin\pg_isready.exe" -h localhost -p 5432 | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail 'Postgres did not start (see %TEMP%\pg18.log)' }
}

# Per-run permissions: edits are auto-accepted, Bash is limited to an allowlist, and anything
# that leaves the machine or rewrites history is denied. In -p mode, unlisted calls are refused
# rather than prompting, so a story that needs more access halts as blocked instead of hanging.
function Write-RunSettings([string]$path) {
    $settings = @{
        permissions = @{
            defaultMode = 'acceptEdits'
            allow = @(
                'Read', 'Edit', 'Write', 'Glob', 'Grep', 'Agent', 'Task', 'Skill', 'TodoWrite',
                'Bash(uv run:*)', 'Bash(uv sync:*)',
                'Bash(npm install:*)', 'Bash(npm ci:*)', 'Bash(npm run:*)', 'Bash(npm test:*)',
                'Bash(npx:*)', 'Bash(node:*)', 'Bash(cd web:*)',
                'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(git show:*)',
                'Bash(git add:*)', 'Bash(git commit:*)', 'Bash(git rev-parse:*)', 'Bash(git ls-files:*)',
                'Bash(git branch --show-current)', 'Bash(git stash list)',
                'Bash(ls:*)', 'Bash(cat:*)', 'Bash(head:*)', 'Bash(tail:*)', 'Bash(grep:*)',
                'Bash(find:*)', 'Bash(wc:*)', 'Bash(sed -n:*)', 'Bash(diff:*)', 'Bash(mkdir:*)'
            )
            deny = @(
                'Bash(git push:*)', 'Bash(git merge:*)', 'Bash(git rebase:*)', 'Bash(git reset:*)',
                'Bash(git checkout:*)', 'Bash(git switch:*)', 'Bash(git tag:*)', 'Bash(git remote:*)',
                'Bash(gh:*)', 'Bash(ssh:*)', 'Bash(scp:*)', 'Bash(tailscale:*)', 'Bash(curl:*)',
                'Bash(rm -rf:*)', 'PowerShell', 'WebFetch'
            )
        }
    }
    $settings | ConvertTo-Json -Depth 5 | Set-Content -Path $path -Encoding ascii
}

# ---- prechecks ----
$current = (Git-Out @('branch', '--show-current')) | Select-Object -First 1
if ($current -ne $Branch) { Fail "on branch '$current', expected '$Branch'" }
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) { Fail 'claude CLI not found on PATH' }
if (-not $DryRun) { Assert-Clean; Ensure-Postgres }

$originRef = "origin/$Branch"
$originBefore = & git rev-parse --verify --quiet $originRef
# A nested Claude Code session refuses to start while this marker is inherited.
Remove-Item Env:CLAUDECODE -ErrorAction SilentlyContinue

function Run-Claude([string]$prompt, [string]$tag) {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $log = Join-Path $LogDir "$stamp-$tag.log"
    $settingsPath = Join-Path $LogDir "$stamp-settings.json"
    Write-RunSettings $settingsPath
    $claudeArgs = @('-p', $prompt, '--settings', $settingsPath)
    if ($Model) { $claudeArgs += @('--model', $Model) }
    Say "running headless; log: $log"
    # PS 5.1 turns native stderr lines into errors under -ErrorAction Stop; keep them as output.
    $ErrorActionPreference = 'Continue'
    & claude @claudeArgs 2>&1 | Tee-Object -FilePath $log | Out-Host
    return @{ Exit = $LASTEXITCODE; Log = $log }
}

if ($Intent) {
    if ($DryRun) { Say "would run: claude -p `"/bmad-build-auto $Intent`""; exit 0 }
    $started = Get-Date
    $headBefore = (Git-Out @('rev-parse', 'HEAD')) | Select-Object -First 1
    $r = Run-Claude "/bmad-build-auto $Intent" 'intent'
    $spec = Get-ChildItem $Artifacts -Filter 'spec-*.md' -File |
        Where-Object { $_.LastWriteTime -ge $started } |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    $status = if ($spec) { Get-SpecStatus $spec.FullName } else { '' }
    if ($r.Exit -ne 0) { Fail "claude exited with $($r.Exit); log: $($r.Log)" }
    if ($status -ne 'done') { Fail "ended with spec status '$status' ($(if ($spec) { $spec.FullName } else { 'no spec written' })); log: $($r.Log)" }
    $headAfter = (Git-Out @('rev-parse', 'HEAD')) | Select-Object -First 1
    if ($headAfter -eq $headBefore) { Fail "reports done but made no commit; log: $($r.Log)" }
    Assert-Clean
    Say "done: $($spec.Name) ($headBefore..$headAfter)" 'Green'
    exit 0
}

$built = @()
for ($n = 1; $n -le $Max; $n++) {
    $next = Pick-Next
    if (-not $next) { Say 'No unfinished stories left.' 'Green'; break }

    if ($next.SpecStatus -eq 'blocked') {
        Fail "$($next.Key) is blocked from an earlier run; see $($next.Spec.FullName) (## Auto Run Result)"
    }

    # Resume an existing in-flight spec by path; otherwise start from the story key.
    $intent = if ($next.Spec) { $next.Spec.FullName } else { $next.Key }
    $prompt = "/bmad-build-auto $intent"

    Say "[$n/$Max] $($next.Key)  (spec: $(if ($next.Spec) { "$($next.Spec.Name) [$($next.SpecStatus)]" } else { 'none yet' }))"
    if ($DryRun) {
        Say "would run: claude -p `"$prompt`" --settings <per-run settings>"
        break
    }

    $headBefore = (Git-Out @('rev-parse', 'HEAD')) | Select-Object -First 1
    $r = Run-Claude $prompt (Get-StoryNum $next.Key)
    $exit = $r.Exit; $log = $r.Log

    $spec = Find-Spec $next.Key
    $status = if ($spec) { Get-SpecStatus $spec.FullName } else { '' }
    if ($exit -ne 0) { Fail "claude exited with $exit on $($next.Key); log: $log" }
    if ($status -ne 'done') {
        Fail "$($next.Key) ended with spec status '$status'. Read ## Auto Run Result in $(if ($spec) { $spec.FullName } else { '(no spec written)' }); log: $log"
    }

    $headAfter = (Git-Out @('rev-parse', 'HEAD')) | Select-Object -First 1
    if ($headAfter -eq $headBefore) { Fail "$($next.Key) reports done but made no commit; log: $log" }
    Assert-Clean

    Set-SprintStatus $next.Key 'review'
    Git-Out @('add', '--', $SprintFile) | Out-Null
    Git-Out @('commit', '-q', '-m', "chore: mark story $(Get-StoryNum $next.Key) built by auto-dev, awaiting review") | Out-Null
    $built += $next.Key
    Say "$($next.Key) done ($headBefore..$headAfter)" 'Green'
}

$originAfter = & git rev-parse --verify --quiet $originRef
if ($originBefore -ne $originAfter) { Say "WARNING: $originRef moved during the run; check what was pushed." 'Yellow' }

if ($FullSuite -and $built.Count -gt 0) {
    Say 'Running the full calc+api suite serially (~45 min)'
    $ErrorActionPreference = 'Continue'
    & uv run python manage.py test calc api --noinput 2>&1 | Tee-Object -FilePath (Join-Path $LogDir "$(Get-Date -Format 'yyyyMMdd-HHmmss')-full-suite.log")
    if ($LASTEXITCODE -ne 0) { Fail 'full suite failed' }
}

if ($built.Count -gt 0) {
    Say "Built: $($built -join ', '). Review with bmad-checkpoint-preview, then push $Branch yourself." 'Green'
}
