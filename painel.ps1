[CmdletBinding()]
param([ValidateSet('Open','Install','Status','Access')][string]$Action='Open')
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
if($Action -eq 'Status'){Invoke-PanelRemote "cd '$panelRootTask' && sv status '$panelRootTask/runtime/services/rota-panel' && node service.cjs status";return}
& node --test (Join-Path $PSScriptRoot 'test/panel.test.cjs')
if($LASTEXITCODE -ne 0){throw 'Testes locais falharam; servidor preservado.'}
$panelReleaseTask='panel-'+[DateTime]::UtcNow.ToString('yyyyMMddHHmmss')+'-'+[Guid]::NewGuid().ToString('N').Substring(0,8)
$panelStageTask="$panelRootTask/.incoming/$panelReleaseTask"
Invoke-PanelRemote "mkdir -p '$panelStageTask/src' '$panelStageTask/socket' '$panelStageTask/test'"
& scp -r -P 8022 -i $panelKeyTask -o BatchMode=yes -o StrictHostKeyChecking=yes (Join-Path $PSScriptRoot 'panel') "${panelRemoteTask}:$panelStageTask/"
if($LASTEXITCODE -ne 0){throw 'Upload do painel falhou; versão ativa preservada.'}
foreach($panelFileTask in @('socket/test-send.mjs','socket/send.test.mjs','test/panel.test.cjs')) {
  & scp -P 8022 -i $panelKeyTask -o BatchMode=yes -o StrictHostKeyChecking=yes (Join-Path $PSScriptRoot $panelFileTask) "${panelRemoteTask}:$panelStageTask/$panelFileTask"
  if($LASTEXITCODE -ne 0){throw 'Upload incompleto; versão ativa preservada.'}
}
Invoke-PanelRemote "cd '$panelRootTask' && cp src/lib.cjs '$panelStageTask/src/lib.cjs' && cp socket/policy.mjs '$panelStageTask/socket/policy.mjs' && ln -s '$panelRootTask/socket/node_modules' '$panelStageTask/socket/node_modules' && cd '$panelStageTask' && node --test test/panel.test.cjs socket/send.test.mjs && cd '$panelRootTask' && flock -n -F runtime/automation.guard node '$panelStageTask/panel/install.cjs'"
Invoke-PanelRemote "cd '$panelRootTask' && node service.cjs start"
Invoke-PanelRemote "cd '$panelRootTask' && sv -w 15 up '$panelRootTask/runtime/services/rota-panel' && sv status '$panelRootTask/runtime/services/rota-panel'"
Write-Host 'Painel instalado. Configure PANEL_HOST com seu endereço privado. Configuração, sessão WhatsApp e histórico preservados.'
