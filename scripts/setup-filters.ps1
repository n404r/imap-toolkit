param(
  [string]$BaseUrl = "http://localhost:3000",
  [string]$Password = "changeme"
)

$ErrorActionPreference = "Stop"
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession

function Api($method, $path, $body = $null) {
  $p = @{ Uri = "$BaseUrl/api$path"; Method = $method; WebSession = $session; ContentType = "application/json" }
  if ($body) { $p.Body = $body | ConvertTo-Json -Depth 5 }
  Invoke-RestMethod @p
}

Write-Host "Logging in..." -ForegroundColor Cyan
$login = Api POST /auth/login @{ password = $Password }
Write-Host "Login OK: $($login.ok)"

Write-Host "`nAccounts:" -ForegroundColor Cyan
$accounts = Api GET /accounts
$accounts | ForEach-Object { Write-Host "  id=$($_.id) email=$($_.email) status=$($_.status)" }

Write-Host "`nExisting filters:" -ForegroundColor Cyan
$existing = Api GET /filters
$existing | ForEach-Object { Write-Host "  id=$($_.id) name=$($_.name) enabled=$($_.enabled)" }

Write-Host "`nCreating test filters..." -ForegroundColor Cyan

$fA = Api POST /filters @{
  name = "[TEST-A] Subject contains"
  logic = "OR"
  conditions = @(@{ field = "subject"; match_type = "contains"; values = @("TEST-SUBJECT") })
}
Write-Host "  Created A id=$($fA.id) - subject contains TEST-SUBJECT"

$fB = Api POST /filters @{
  name = "[TEST-B] Domain ends_with"
  logic = "OR"
  conditions = @(@{ field = "from_domain"; match_type = "ends_with"; values = @("mailtest.dev") })
}
Write-Host "  Created B id=$($fB.id) - from_domain ends_with mailtest.dev"

$fC = Api POST /filters @{
  name = "[TEST-C] Email contains"
  logic = "OR"
  conditions = @(@{ field = "from_email"; match_type = "contains"; values = @("deletebot") })
}
Write-Host "  Created C id=$($fC.id) - from_email contains deletebot"

$fD = Api POST /filters @{
  name = "[TEST-D] AND logic"
  logic = "AND"
  conditions = @(
    @{ field = "subject";   match_type = "contains"; values = @("TEST-AND") }
    @{ field = "from_name"; match_type = "contains"; values = @("NeMoBot") }
  )
}
Write-Host "  Created D id=$($fD.id) - AND: subject=TEST-AND AND from_name=NeMoBot"

$fE = Api POST /filters @{
  name = "[TEST-E] Body contains"
  logic = "OR"
  conditions = @(@{ field = "body"; match_type = "contains"; values = @("DELETE-THIS-BODY") })
}
Write-Host "  Created E id=$($fE.id) - body contains DELETE-THIS-BODY"

$fF = Api POST /filters @{
  name = "[TEST-F] Subject regex"
  logic = "OR"
  conditions = @(@{ field = "subject"; match_type = "regex"; values = @("^REGEX-\d+") })
}
Write-Host "  Created F id=$($fF.id) - subject regex ^REGEX-\d+"

Write-Host "`nAll filters now:" -ForegroundColor Cyan
$all = Api GET /filters
$all | ForEach-Object { Write-Host "  id=$($_.id) [$($_.logic)] $($_.name) enabled=$($_.enabled)" }

Write-Host "`nDone! Now send these test emails to $($accounts[0].email):" -ForegroundColor Green
Write-Host "  A: Subject='TEST-SUBJECT hello'           From=any            -> DELETED"
Write-Host "  B: Subject=anything                       From=bot@mailtest.dev -> DELETED"
Write-Host "  C: Subject=anything                       From=deletebot@x.com  -> DELETED"
Write-Host "  D-hit:  Subject='TEST-AND del'            From='NeMoBot <x@y>'  -> DELETED"
Write-Host "  D-miss: Subject='TEST-AND del'            From=other@x.com      -> KEPT (AND fails)"
Write-Host "  E: Subject=innocent  Body='DELETE-THIS-BODY ...'                -> DELETED"
Write-Host "  F: Subject='REGEX-42 test'                From=any              -> DELETED"
Write-Host "  G: Subject='normal keep this'             From=normal@x.com     -> KEPT (no match)"
