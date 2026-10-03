'use strict';
const $ = id => document.getElementById(id);
let csrf = '', dashboard, formRevision, formConfig, dirty = false, busy = false, challenge, pollTimer;
let editGeneration=0;
const fmt = value => value ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Fortaleza', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '—';
const dateFmt = value => value.split('-').reverse().join('/');
function deliveryExplanation(status) {
  if(['sent','server_accepted'].includes(status)) return 'O servidor do WhatsApp confirmou o envio; isso não comprova leitura pelos participantes.';
  if(status==='uncertain') return 'Não há confirmação conclusiva. Confira a conversa antes de qualquer novo envio; a automação não repete esta tentativa.';
  if(status==='attempting') return 'Tentativa registrada, ainda sem confirmação. Este registro também pode indicar interrupção; confira a conversa antes de repetir.';
  if(status==='not_started') return 'Esta tentativa não iniciou o envio. Confira o motivo registrado; isto não comprova que outras tentativas não enviaram.';
  return 'Estado não reconhecido. Este registro não comprova entrega.';
}
function toast(message, error = false) { $('toast').textContent = message; $('toast').classList.toggle('error', error); $('toast').hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => $('toast').hidden = true, 6500); }
let waTimer,qrExpiry,waGroups=[],sendingTest=false;
let panelOnline=true;
const offlineControls=new Map();
function connectionState(online) {
  panelOnline=online;
  const controls=document.querySelectorAll('#app-view button:not(#logout):not(#refresh), #whatsapp select');
  if(!online) {
    for(const control of controls) { if(!offlineControls.has(control)) offlineControls.set(control,control.disabled); control.disabled=true; }
    $('wa-status').textContent='Sem consulta atual';
    $('health-label').textContent='Sem consulta atual';
    $('health-label').classList.toggle('attention',true);
    $('health-detail').textContent='O último estado conhecido não comprova a situação atual do executor.';
    $('wa-guidance').textContent='Sem comunicação com o servidor. Os destinos exibidos podem estar desatualizados. Reconecte e atualize o painel.';
  } else {
    for(const [control,disabled] of offlineControls) control.disabled=disabled;
    offlineControls.clear();
  }
}
function loggedIn(value) { $('login-view').hidden = value; $('app-view').hidden = !value; if (!value) { csrf = ''; clearTimeout(pollTimer); clearTimeout(waTimer); clearTimeout(qrExpiry); $('wa-qr').hidden=true; $('wa-qr').removeAttribute('src'); } }
async function api(url, method = 'GET', body) {
  let res;
  try { res = await fetch('/api/' + url, { method, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
  catch(error) { if(error instanceof TypeError) throw Error('Sem comunicação com o servidor. Confira a conexão e atualize o painel.'); throw error; }
  const result = await res.json();
  if (!res.ok) { if (res.status === 401 && url !== 'login') loggedIn(false); throw Error(result.error || 'O servidor não respondeu.'); }
  return result;
}
async function action(fn) { if (busy) return; busy = true; try { await fn(); } catch (error) { toast(error.message, true); } finally { busy = false; if(!panelOnline) connectionState(false); } }
function render(d, fillForms = false) {
  dashboard = d;
  const c = d.config, h = d.health;
  if(d.whatsapp) renderWhatsApp(d.whatsapp);
  $('wa-destinations').textContent='Destino principal: '+c.productionGroup+'. Destino de teste: '+(c.testGroup || 'não configurado')+'.';
  $('enabled-label').textContent = c.sendingEnabled ? 'Ativo' : 'Desativado';
  $('enabled-label').classList.toggle('attention', !c.sendingEnabled);
  $('enabled-detail').textContent = c.sendingEnabled ? 'Envios automáticos habilitados' : 'Próximos envios bloqueados';
  $('enabled-pill').textContent = c.sendingEnabled ? 'Habilitado' : 'Desabilitado'; $('enabled-pill').classList.toggle('off', !c.sendingEnabled);
  $('health-label').textContent = h.healthy ? 'Saudável' : 'Requer atenção';
  $('health-label').classList.toggle('attention', !h.healthy);
  $('health-detail').textContent = h.healthy ? `Sinal de vida há ${h.heartbeatAgeSeconds ?? '?'} segundos` : 'Executor indisponível ou sem sinal recente';
  $('next-label').textContent = d.nextRun ? fmt(d.nextRun) : 'Sem previsão';
  const dayNames = { Mon: 'Seg', Tue: 'Ter', Wed: 'Qua', Thu: 'Qui', Fri: 'Sex', Sat: 'Sáb', Sun: 'Dom' };
  $('schedule-summary').textContent = c.schedule.weekdays.map(day => dayNames[day]).join(' / ') + ' — ' + String(c.schedule.hour).padStart(2,'0') + ':' + String(c.schedule.minute).padStart(2,'0');
  $('toggle-enabled').disabled = !!d.whatsapp?.active; $('toggle-enabled').textContent = c.sendingEnabled ? 'Desativar envios automáticos' : 'Ativar envios automáticos';
  $('message-preview').textContent = d.preview; $('destination').textContent = c.productionGroup;
  $('connection-warning').hidden = h.healthy; $('connection-warning').textContent = 'O executor precisa de atenção. Não trate o agendamento ativo como garantia de envio.';
  const formKeys = ['studentLines', 'schedule'];
  const serverFieldsUnchanged = formConfig && formKeys.every(key => JSON.stringify(c[key]) === JSON.stringify(formConfig[key]));
  if (dirty && serverFieldsUnchanged) formRevision = d.revision;
  $('form-conflict').hidden = fillForms || !dirty || serverFieldsUnchanged;
  if (fillForms || !dirty) {
    formRevision = d.revision;
    formConfig = JSON.parse(JSON.stringify(c));
    $('schedule-time').value = `${String(c.schedule.hour).padStart(2,'0')}:${String(c.schedule.minute).padStart(2,'0')}`;
    $('grace').value = c.schedule.graceMinutes; $('student-lines').value = c.studentLines.join('\n');
    document.querySelectorAll('.day-picker input').forEach(el => el.checked = c.schedule.weekdays.includes(el.value));
  }
  $('pause-list').replaceChildren();
  for (const date of c.pausedDates) {
    const chip = document.createElement('span'); chip.className = 'pause-chip'; chip.append(document.createTextNode(dateFmt(date)));
    const button = document.createElement('button'); button.textContent = '×'; button.setAttribute('aria-label', `Remover pausa de ${dateFmt(date)}`);
    button.onclick = () => action(async () => { await save({ pausedDates: dashboard.config.pausedDates.filter(x => x !== date) }); toast('Pausa removida.'); });
    chip.append(button); $('pause-list').append(chip);
  }
  if (!c.pausedDates.length) { const empty = document.createElement('small'); empty.textContent = 'Nenhuma data pausada.'; $('pause-list').append(empty); }
  $('history-body').replaceChildren(); $('empty-history').hidden = d.history.length > 0;
  const statuses = { sent: 'Confirmado pelo servidor', server_accepted: 'Confirmado pelo servidor', attempting: 'Iniciado · confira o WhatsApp', uncertain: 'Resultado incerto', not_started: 'Não iniciado' };
  for (const record of d.history) {
    const row = document.createElement('tr');
    const cell = value => { const td = document.createElement('td'); td.textContent = value || '—'; row.append(td); return td; };
    cell(fmt(record.timestamp)); const group = cell(record.group); if (record.test) { const tag = document.createElement('small'); tag.textContent = 'ENVIO DE TESTE'; group.append(tag); }
    const result = cell(''); result.textContent = ''; const badge = document.createElement('span'); badge.className = 'result' + (!['sent','server_accepted','not_started'].includes(record.status) ? ' warn' : record.status === 'not_started' ? ' bad' : ''); badge.textContent = statuses[record.status] || 'Estado desconhecido'; result.append(badge);
    const explanation=document.createElement('small');explanation.textContent=deliveryExplanation(record.status);result.append(explanation);
    if (record.error) { const error = document.createElement('small'); error.textContent = 'Motivo registrado: '+record.error; result.append(error); }
    const confirmation = cell(fmt(record.confirmedAt)); if (record.messageId) { const id = document.createElement('small'); id.textContent = 'ID ' + record.messageId; confirmation.append(id); }
    $('history-body').append(row);
  }
  $('updated-at').textContent = `Atualizado em ${fmt(d.now)}`;
}
async function refresh(fillForms = false) {
  clearTimeout(pollTimer);
  const generation=editGeneration;
  try { const data=await api('dashboard'); connectionState(true); render(data, fillForms && generation===editGeneration); }
  catch (error) { $('wa-qr').hidden=true; $('wa-qr').removeAttribute('src'); $('connection-warning').hidden = false; $('connection-warning').textContent = 'Sem comunicação com o servidor. Confira internet e Tailscale. Isso não comprova que a automação parou.'; $('toggle-enabled').disabled = true; connectionState(false); throw error; }
  finally { if (csrf) pollTimer = setTimeout(() => refresh().catch(() => {}), 30000); }
}
function renderWhatsApp(state) {
  waGroups=state.groups || [];
  const enabled=dashboard?.config.sendingEnabled!==false, active=!!state.active;
  const groups=state.groups || [];
  $('toggle-enabled').disabled=!panelOnline || active;
  $('toggle-enabled').title=active ? 'Aguarde a verificação da conta terminar.' : '';
  $('test-open').disabled=!panelOnline || active || sendingTest;
  $('test-open').title=active ? 'Aguarde a verificação da conta terminar.' : '';
  $('wa-check').disabled=enabled || active;
  $('wa-pair').disabled=enabled || active;
  $('wa-disable').hidden=!enabled;
  $('wa-disable').disabled=active;
  $('wa-guidance').textContent=enabled ? 'Desative os envios aqui para verificar a conta e carregar os grupos. Nenhuma mensagem será enviada pela verificação.' : active ? 'Verificação em andamento. Aguarde para selecionar os grupos.' : groups.length ? 'Selecione os destinos abaixo. Ao terminar, reative os envios em Visão geral.' : 'Envios desativados. Clique em “Verificar conta e grupos” para carregar os destinos. Use o QR somente se precisar vincular a conta.';
  const labels={unknown:'Não verificada',checking:'Verificando…',qr:'Aguardando leitura do QR',verified:'Conta verificada',disconnected:'Desconectada',failed:'Verificação não concluída',expired:'Verificação expirada'};
  $('wa-status').textContent=labels[state.status] || 'Não verificada';
  $('wa-detail').textContent=state.timestamp ? 'Atualizado em '+fmt(state.timestamp) : '';
  $('wa-detail').hidden=!state.timestamp;
  const age=Date.now()-Date.parse(state.timestamp);
  const show=state.status==='qr' && state.active && age>=0 && age<300000 && typeof state.qr==='string' && state.qr.startsWith('data:image/png;base64,');
  $('wa-qr').hidden=!show;
  clearTimeout(qrExpiry);
  if(show) qrExpiry=setTimeout(()=>{$('wa-qr').hidden=true;$('wa-qr').removeAttribute('src');},300000-age);
  if(show) $('wa-qr').src=state.qr; else $('wa-qr').removeAttribute('src');
  for(const id of ['wa-production','wa-test']) {
    const select=$(id),old=select.value;
    select.replaceChildren();
    select.disabled=enabled || active || !groups.length;
    const empty=document.createElement('option');empty.value='';empty.textContent=groups.length ? 'Selecione um grupo' : active ? 'Carregando grupos…' : 'Verifique a conta para carregar grupos';select.append(empty);
    for(const group of state.groups || []) {
      const option=document.createElement('option');option.value=group.id;option.textContent=group.name+' ('+group.id+')';select.append(option);
    }
    select.value=old || dashboard?.config[id==='wa-production'?'productionGroupId':'testGroupId'] || '';
    $(id==='wa-production'?'wa-save-production':'wa-save-test').disabled=select.disabled || !select.value;
  }
}
for(const id of ['wa-production','wa-test']) $(id).onchange=()=>{ $(id==='wa-production'?'wa-save-production':'wa-save-test').disabled=$(id).disabled || !$(id).value; };
$('wa-disable').onclick=()=>action(async()=>{
  if(!window.confirm('Desativar os próximos envios automáticos para verificar a conta? Um envio já iniciado pode terminar. Você precisará reativar os envios manualmente.')) return;
  await api('enabled','POST',{enabled:false,revision:dashboard.revision});await refresh();toast('Envios desativados. Agora verifique a conta e os grupos.');
});
async function pollWhatsApp() {
  clearTimeout(waTimer);
  try { const state=await api('whatsapp'); if(!csrf || !panelOnline) return; renderWhatsApp(state); if(state.active) waTimer=setTimeout(()=>pollWhatsApp().catch(()=>{}),2000); }
  catch(error) { $('wa-status').textContent='Sem consulta atual'; $('wa-qr').hidden=true; $('wa-qr').removeAttribute('src'); throw error; }
}
$('wa-check').onclick=()=>action(async()=>{
  await api('whatsapp','POST',{mode:'check'});await pollWhatsApp();
});
$('wa-pair').onclick=()=>action(async()=>{
  if(!window.confirm('Iniciar vinculação da conta pelo QR? Nenhuma mensagem será enviada. Não será apagada a sessão existente.')) return;
  await api('whatsapp','POST',{mode:'pair',confirm:true});await pollWhatsApp();
});
for(const [button,select,field] of [['wa-save-production','wa-production','productionGroup'],['wa-save-test','wa-test','testGroup']]) {
  $(button).onclick=()=>action(async()=>{
    if(dirty) throw Error('Salve ou descarte as alterações do formulário antes de selecionar o grupo.');
    const id=$(select).value;if(!id) throw Error('Selecione um grupo.');
    const group=waGroups.find(group=>group.id===id);
    if(!group) throw Error('Verifique a conta novamente para atualizar os grupos.');
    if(!window.confirm('Definir “'+group.name+'” ('+group.id+') como destino '+(field==='productionGroup'?'principal':'de teste')+'?')) return;
    await api('whatsapp/group','POST',{id,field,revision:dashboard.revision});await refresh();toast('Grupo selecionado.');
  });
}
async function save(changes, revision = dashboard.revision) { await api('config', 'PUT', { revision, changes }); await refresh(); }
$('login-form').onsubmit = async event => { event.preventDefault(); const button = event.target.querySelector('button'); button.disabled = true; $('login-error').textContent = ''; try { const r = await api('login','POST',{ password: new FormData(event.target).get('password') }); csrf = r.csrf; event.target.reset(); dirty = false; loggedIn(true); await refresh(true); await pollWhatsApp(); } catch(error) { $('login-error').textContent = error.message; } finally { button.disabled = false; } };
$('refresh').onclick = () => action(async () => { await refresh(); await pollWhatsApp(); toast('Estado atualizado.'); });
$('logout').onclick = () => action(async () => { await api('logout','POST',{}); loggedIn(false); });
$('toggle-enabled').onclick = () => action(async () => { const enabled = !dashboard.config.sendingEnabled; $('toggle-enabled').disabled = true; try { await api('enabled','POST',{ enabled, revision: dashboard.revision }); await refresh(); toast(enabled ? 'Envios automáticos ativados.' : 'Próximos envios automáticos desativados.'); } finally { $('toggle-enabled').disabled = !panelOnline || !!dashboard.whatsapp?.active; } });
$('settings-form').oninput = () => { dirty = true; editGeneration++; };
$('form-reload').onclick = () => action(async () => { if (!window.confirm('Descartar as alterações não salvas e carregar os campos atuais do servidor?')) return; const generation=editGeneration; await refresh(true); if(generation===editGeneration) { dirty = false; toast('Campos atuais carregados.'); } else { toast('Sua edição feita durante a consulta foi preservada e ainda não está salva.'); } });
$('settings-form').onsubmit = event => { event.preventDefault(); action(async () => { const generation=editGeneration; const [hour, minute] = $('schedule-time').value.split(':').map(Number); await save({ studentLines: $('student-lines').value.split('\n').filter(x => x.trim()), schedule: { hour, minute, graceMinutes: Number($('grace').value), weekdays: [...document.querySelectorAll('.day-picker input:checked')].map(x => x.value) } }, formRevision); if(editGeneration===generation) { dirty = false; render(dashboard,true); toast('Agendamento e mensagem salvos.'); } else { formConfig=JSON.parse(JSON.stringify(dashboard.config)); formRevision=dashboard.revision; $('form-conflict').hidden=true; toast('Alterações enviadas foram salvas. Sua edição posterior permanece no formulário e ainda precisa ser salva.'); } }); };
$('pause-form').onsubmit = event => { event.preventDefault(); action(async () => { await save({ pausedDates: [...dashboard.config.pausedDates, $('pause-date').value] }); event.target.reset(); toast('Data pausada.'); }); };
$('test-open').onclick = () => action(async () => { const p = await api('test/prepare','POST',{}); challenge = p.challenge; $('confirm-group').textContent = p.group+(p.groupId?' ('+p.groupId+')':' (seleção por nome)'); $('confirm-text').textContent = p.text; $('test-confirm').disabled = false; $('test-dialog').showModal(); });
$('test-confirm').onclick = () => action(async () => { sendingTest=true; $('test-confirm').disabled = true; try { const job = await api('test/send','POST',{challenge}); $('test-dialog').close(); $('test-open').disabled = true; $('test-status').textContent = 'Teste em andamento. Aguarde a confirmação; não repita o comando.'; const deadline = Date.now() + 150000; while (Date.now() < deadline && csrf) { await new Promise(r => setTimeout(r, 2500)); const result = await api('test/' + job.id); if (result.status !== 'running') { const ok = ['sent','server_accepted'].includes(result.status); $('test-status').textContent = ok ? 'Confirmado pelo servidor do WhatsApp.' : (result.error || 'Resultado incerto. Confira o WhatsApp antes de repetir.'); toast($('test-status').textContent, !ok); await refresh(); return; } } $('test-status').textContent = 'Ainda sem resultado conclusivo. Confira o histórico antes de repetir.'; } finally { sendingTest=false; $('test-open').disabled = !panelOnline || !!dashboard.whatsapp?.active; $('test-confirm').disabled = false; } });
$('password-open').onclick = () => $('password-dialog').showModal();
$('password-form').onsubmit = event => { event.preventDefault(); action(async () => { await api('password','POST',Object.fromEntries(new FormData(event.target))); event.target.reset(); $('password-dialog').close(); loggedIn(false); toast('Senha alterada. Entre novamente.'); }); };
// Keep every form mounted: changing screens must not discard unsaved edits.
const panelRoutes = ['overview', 'settings', 'whatsapp', 'pauses', 'history'];
function navigatePanel() {
  const requested = (window.location?.hash || '#overview').slice(1);
  const route = panelRoutes.includes(requested) ? requested : 'overview';
  for (const id of panelRoutes) $(id).hidden = id !== route;
  document.querySelectorAll('.nav-link').forEach(link => {
    const active = link.getAttribute('href') === '#' + route;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  const current = document.querySelectorAll('.nav-link.active')[0];
  if ($('page-title')) $('page-title').textContent = current?.textContent || 'Visão geral';
}
window.addEventListener('hashchange', navigatePanel);
navigatePanel();
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
(async () => { try { csrf = (await api('session')).csrf; loggedIn(true); await refresh(true); await pollWhatsApp(); } catch { loggedIn(false); } })();
