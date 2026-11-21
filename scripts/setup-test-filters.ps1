# ─── NeMo IMAP — Test Filter Setup Script ─────────────────────────────────────
# Creates minimal targeted filters to verify each core logic path:
#   1. Subject contains  (OR logic)
#   2. Sender domain contains  (OR logic)
#   3. Sender email contains  (OR logic)
#   4. AND logic (both subject AND sender must match)
#   5. Body contains
# After running, send one email per filter to verify deletion + logging.

param(
  [string]$BaseUrl  = "http://localhost:3000",
  [string]$Password = "changeme"
)

$ErrorActionPreference = "Stop"

# ─── 1. Login ─────────────────────────────────────────────────────────────────
Write-Host "`n[1/6] Logging in to $BaseUrl ..." -ForegroundColor Cyan
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$loginResp = Invoke-RestMethod `
  -Uri        "$BaseUrl/api/auth/login" `
  -Method     POST `
  -Body       (ConvertTo-Json @{ password = $Password }) `
  -ContentType "application/json" `
  -WebSession  $session

if (-not $loginResp.ok) { Write-Error "Login failed"; exit 1 }
Write-Host "  ✓ Logged in" -ForegroundColor Green

# helper
function Api($method, $path, $body = $null) {
  $params = @{
    Uri         = "$BaseUrl/api$path"
    Method      = $method
    WebSession  = $session
    ContentType = "application/json"
  }
  if ($body) { $params.Body = ConvertTo-Json $body -Depth 5 }
  Invoke-RestMethod @params
}

# ─── 2. Show existing filters ─────────────────────────────────────────────────
Write-Host "`n[2/6] Existing filters:" -ForegroundColor Cyan
$existing = Api GET /filters
if ($existing.Count -eq 0) {
  Write-Host "  (none)" -ForegroundColor DarkGray
} else {
  $existing | ForEach-Object { Write-Host "  • [$($_.id)] $($_.name)  enabled=$($_.enabled)" }
}

# ─── 3. Show existing accounts ────────────────────────────────────────────────
Write-Host "`n[3/6] Connected accounts:" -ForegroundColor Cyan
$accounts = Api GET /accounts
if ($accounts.Count -eq 0) {
  Write-Host "  (none — add an account first!)" -ForegroundColor Yellow
} else {
  $accounts | ForEach-Object {
    Write-Host "  • [$($_.id)] $($_.email)  status=$($_.status)  enabled=$($_.enabled)"
  }
}

# ─── 4. Create test filters ───────────────────────────────────────────────────
Write-Host "`n[4/6] Creating test filters..." -ForegroundColor Cyan

# ── Filter A: Subject contains "TEST-SUBJECT" (OR) ──
$fA = Api POST /filters @{
  name  = "[TEST-A] Subject match (OR)"
  logic = "OR"
  conditions = @(
    @{ field = "subject"; match_type = "contains"; values = @("TEST-SUBJECT") }
  )
}
Write-Host "  ✓ Created filter A  id=$($fA.id)  — subject contains 'TEST-SUBJECT'" -ForegroundColor Green

# ── Filter B: Sender domain ends_with "mailtest.dev" (OR) ──
$fB = Api POST /filters @{
  name  = "[TEST-B] Sender domain match (OR)"
  logic = "OR"
  conditions = @(
    @{ field = "from_domain"; match_type = "ends_with"; values = @("mailtest.dev") }
  )
}
Write-Host "  ✓ Created filter B  id=$($fB.id)  — from_domain ends_with 'mailtest.dev'" -ForegroundColor Green

# ── Filter C: Sender email contains "deletebot" (OR) ──
$fC = Api POST /filters @{
  name  = "[TEST-C] Sender email match (OR)"
  logic = "OR"
  conditions = @(
    @{ field = "from_email"; match_type = "contains"; values = @("deletebot") }
  )
}
Write-Host "  ✓ Created filter C  id=$($fC.id)  — from_email contains 'deletebot'" -ForegroundColor Green

# ── Filter D: AND logic — subject contains "TEST-AND" AND from_name contains "NeMoBot" ──
$fD = Api POST /filters @{
  name  = "[TEST-D] AND logic (subject + sender name)"
  logic = "AND"
  conditions = @(
    @{ field = "subject";   match_type = "contains"; values = @("TEST-AND") }
    @{ field = "from_name"; match_type = "contains"; values = @("NeMoBot") }
  )
}
Write-Host "  ✓ Created filter D  id=$($fD.id)  — AND: subject='TEST-AND' + from_name='NeMoBot'" -ForegroundColor Green

# ── Filter E: Body contains "DELETE-THIS-BODY" ──
$fE = Api POST /filters @{
  name  = "[TEST-E] Body match (OR)"
  logic = "OR"
  conditions = @(
    @{ field = "body"; match_type = "contains"; values = @("DELETE-THIS-BODY") }
  )
}
Write-Host "  ✓ Created filter E  id=$($fE.id)  — body contains 'DELETE-THIS-BODY'" -ForegroundColor Green

# ── Filter F: Regex subject match ──
$fF = Api POST /filters @{
  name  = "[TEST-F] Subject regex match (OR)"
  logic = "OR"
  conditions = @(
    @{ field = "subject"; match_type = "regex"; values = @("^REGEX-\d+") }
  )
}
Write-Host "  ✓ Created filter F  id=$($fF.id)  — subject regex '^REGEX-\d+'" -ForegroundColor Green

# ─── 5. Print test email instructions ────────────────────────────────────────
Write-Host @"

[5/6] ─── TEST EMAIL CHECKLIST ───────────────────────────────────────────────
Send these 7 emails TO your connected inbox ($($accounts[0].email)):

  FILTER A — should DELETE (subject hit):
    Subject : TEST-SUBJECT hello world
    From    : anyone@anywhere.com
    Body    : anything

  FILTER B — should DELETE (domain hit):
    Subject : normal subject
    From    : bot@mailtest.dev
    Body    : anything

  FILTER C — should DELETE (email hit):
    Subject : normal subject
    From    : deletebot@example.com
    Body    : anything

  FILTER D — should DELETE (AND: both conditions met):
    Subject : TEST-AND please delete
    From    : NeMoBot <nemobot@example.com>
    Body    : anything

  FILTER D — should NOT delete (AND: only one condition met):
    Subject : TEST-AND please delete
    From    : someone else <other@example.com>
    Body    : anything

  FILTER E — should DELETE (body hit):
    Subject : innocent subject
    From    : anyone@anywhere.com
    Body    : DELETE-THIS-BODY is in the body

  FILTER F — should DELETE (regex hit):
    Subject : REGEX-42 test email
    From    : anyone@anywhere.com
    Body    : anything

  CONTROL — should NOT be deleted:
    Subject : normal email please keep
    From    : normal@example.com
    Body    : nothing special here

Expected: 6 deletions logged, 2 not deleted (AND partial + control)
"@ -ForegroundColor Yellow

# ─── 6. Final filter listing ──────────────────────────────────────────────────
Write-Host "[6/6] All filters now:" -ForegroundColor Cyan
$allFilters = Api GET /filters
$allFilters | ForEach-Object {
  $conds = $allFilters | Where-Object { $_.id -eq $_.id } | Select-Object -ExpandProperty conditions -ErrorAction SilentlyContinue
  Write-Host "  [$($_.id)] $($_.name)  logic=$($_.logic)  enabled=$($_.enabled)"
}

Write-Host "`nDone! Watch Dashboard > Active Inboxes for live stats as emails arrive.`n" -ForegroundColor Green
