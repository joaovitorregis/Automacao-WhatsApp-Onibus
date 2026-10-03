[CmdletBinding()]
param([ValidateSet('Open','Install','Status','Access','Doctor')][string]$Action='Open')
$ErrorActionPreference='Stop'
$panelKeyTask=$env:ROTA_SSH_KEY
$panelRemoteTask=$env:ROTA_SSH_TARGET
$panelRootTask='/data/data/com.termux/files/home/whatsapp-onibus-rota-1-android'
$panelSshTask=@('-i',$panelKeyTask,'-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10','-p','8022',$panelRemoteTask)
function Invoke-PanelRemote([string]$Command) { & ssh @panelSshTask $Command; if($LASTEXITCODE -ne 0){throw 'Operação remota falhou. Consulte a saída acima; isso não significa necessariamente falha de conexão.'} }
function Get-PanelAccess {
  $panelAccessTask=Join-Path $PSScriptRoot 'runtime/panel-access.txt'
  New-Item -ItemType Directory -Force -Path (Split-Path $panelAccessTask) | Out-Null
  & scp -P 8022 -i $panelKeyTask -o BatchMode=yes -o StrictHostKeyChecking=yes "${panelRemoteTask}:$panelRootTask/runtime/panel-access.txt" $panelAccessTask
  if($LASTEXITCODE -ne 0){throw 'Senha inicial indisponível. Se você já a alterou, use sua senha atual.'}
  Write-Host "Credencial salva em arquivo privado: $panelAccessTask"
}
if($Action -eq 'Open'){if(-not $env:ROTA_PANEL_URL){throw 'Configure ROTA_PANEL_URL.'};Start-Process $env:ROTA_PANEL_URL;return}
if(-not $panelKeyTask -or -not $panelRemoteTask){throw 'Configure ROTA_SSH_KEY e ROTA_SSH_TARGET.'}
if($Action -eq 'Access'){Get-PanelAccess;return}
if($Action -eq 'Doctor'){Invoke-PanelRemote "cd '$panelRootTask' && node scripts/doctor.cjs --json";return}
if($Action -eq 'Status'){Invoke-PanelRemote "cd '$panelRootTask' && sv status '$panelRootTask/runtime/services/rota-panel' && node service.cjs status";return}
$panelUrlTask=$null
if(-not [Uri]::TryCreate($env:ROTA_PANEL_URL,[UriKind]::Absolute,[ref]$panelUrlTask) -or $panelUrlTask.Scheme -ne 'http' -or $panelUrlTask.UserInfo -or $panelUrlTask.Query -or $panelUrlTask.Fragment -or $panelUrlTask.AbsolutePath -ne '/' -or $panelUrlTask.Host -notmatch '^[a-zA-Z0-9.-]+$'){throw 'Configure ROTA_PANEL_URL com a URL HTTP privada do painel.'}
$panelHostTask=$panelUrlTask.Host
$panelPortTask=$panelUrlTask.Port
& node --test (Join-Path $PSScriptRoot 'test/panel.test.cjs') (Join-Path $PSScriptRoot 'test/whatsapp-panel.test.cjs') (Join-Path $PSScriptRoot 'socket/groups.test.mjs') (Join-Path $PSScriptRoot 'socket/mode.test.mjs') (Join-Path $PSScriptRoot 'test/panel-network.test.cjs')
if($LASTEXITCODE -ne 0){throw 'Testes locais falharam; servidor preservado.'}
$panelReleaseTask='panel-'+[DateTime]::UtcNow.ToString('yyyyMMddHHmmss')+'-'+[Guid]::NewGuid().ToString('N').Substring(0,8)
$panelStageTask="$panelRootTask/.incoming/$panelReleaseTask"
Invoke-PanelRemote "mkdir -p '$panelStageTask/src' '$panelStageTask/socket' '$panelStageTask/test'"
& scp -r -P 8022 -i $panelKeyTask -o BatchMode=yes -o StrictHostKeyChecking=yes (Join-Path $PSScriptRoot 'panel') "${panelRemoteTask}:$panelStageTask/"
if($LASTEXITCODE -ne 0){throw 'Upload do painel falhou; versão ativa preservada.'}
foreach($panelFileTask in @('socket/auth.mjs','socket/groups.mjs','socket/groups.test.mjs','socket/mode.mjs','socket/mode.test.mjs','socket/test-send.mjs','socket/send.test.mjs','test/panel.test.cjs','test/whatsapp-panel.test.cjs','test/panel-network.test.cjs')) {
  & scp -P 8022 -i $panelKeyTask -o BatchMode=yes -o StrictHostKeyChecking=yes (Join-Path $PSScriptRoot $panelFileTask) "${panelRemoteTask}:$panelStageTask/$panelFileTask"
  if($LASTEXITCODE -ne 0){throw 'Upload incompleto; versão ativa preservada.'}
}
Invoke-PanelRemote "cd '$panelRootTask' && cp src/lib.cjs '$panelStageTask/src/lib.cjs' && cp socket/policy.mjs socket/auth-store.mjs socket/lock.mjs '$panelStageTask/socket/' && ln -s '$panelRootTask/socket/node_modules' '$panelStageTask/socket/node_modules' && cd '$panelStageTask' && node --check socket/auth.mjs && node --test test/panel.test.cjs test/whatsapp-panel.test.cjs test/panel-network.test.cjs socket/send.test.mjs socket/groups.test.mjs socket/mode.test.mjs && cd '$panelRootTask' && ROTA_PANEL_HOST='$panelHostTask' ROTA_PANEL_PORT='$panelPortTask' flock -n -F runtime/automation.guard node '$panelStageTask/panel/install.cjs'"
Invoke-PanelRemote "cd '$panelRootTask' && node service.cjs start"
Invoke-PanelRemote "cd '$panelRootTask' && sv -w 15 up '$panelRootTask/runtime/services/rota-panel' && sv status '$panelRootTask/runtime/services/rota-panel'"
Invoke-WebRequest -Uri $panelUrlTask.AbsoluteUri -TimeoutSec 10 | Out-Null
Write-Host 'Painel instalado. Configure PANEL_HOST com seu endereço privado. Configuração, sessão WhatsApp e histórico preservados.'
