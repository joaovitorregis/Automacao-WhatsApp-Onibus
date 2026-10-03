'use strict';
const $ = id => document.getElementById(id);
let csrf = '', dashboard, formRevision, formConfig, dirty = false, busy = false, challenge, pollTimer;
const fmt = value => value ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Fortaleza', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '—';
const dateFmt = value => value.split('-').reverse().join('/');
function toast(message, error = false) { $('toast').textContent = message; $('toast').classList.toggle('error', error); $('toast').hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => $('toast').hidden = true, 6500); }
function loggedIn(value) { $('login-view').hidden = value; $('app-view').hidden = !value; if (!value) { csrf = ''; clearTimeout(pollTimer); } }
async function api(url, method = 'GET', body) {
  const res = await fetch('/api/' + url, { method, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await res.json();
  if (!res.ok) { if (res.status === 401 && url !== 'login') loggedIn(false); throw Error(result.error || 'O servidor não respondeu.'); }
  return result;
}
async function action(fn) { if (busy) return; busy = true; try { await fn(); } catch (error) { toast(error.message, true); } finally { busy = false; } }
function render(d, fillForms = false) {
  dashboard = d;
  const c = d.config, h = d.health;
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
  $('toggle-enabled').disabled = false; $('toggle-enabled').textContent = c.sendingEnabled ? 'Desativar envios automáticos' : 'Ativar envios automáticos';
  $('message-preview').textContent = d.preview; $('destination').textContent = c.productionGroup;
  $('connection-warning').hidden = h.healthy; $('connection-warning').textContent = 'O executor precisa de atenção. Não trate o agendamento ativo como garantia de envio.';
  const formKeys = ['productionGroup', 'testGroup', 'studentLines', 'schedule'];
  const serverFieldsUnchanged = formConfig && formKeys.every(key => JSON.stringify(c[key]) === JSON.stringify(formConfig[key]));
  if (dirty && serverFieldsUnchanged) formRevision = d.revision;
  $('form-conflict').hidden = fillForms || !dirty || serverFieldsUnchanged;
  if (fillForms || !dirty) {
    formRevision = d.revision;
    formConfig = JSON.parse(JSON.stringify(c));
    $('production-group').value = c.productionGroup; $('test-group').value = c.testGroup;
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
    const result = cell(''); result.textContent = ''; const badge = document.createElement('span'); badge.className = 'result' + (['uncertain','attempting'].includes(record.status) ? ' warn' : record.status === 'not_started' ? ' bad' : ''); badge.textContent = statuses[record.status] || record.status || 'Desconhecido'; result.append(badge);
    if (record.error) { const error = document.createElement('small'); error.textContent = record.error; result.append(error); }
    const confirmation = cell(fmt(record.confirmedAt)); if (record.messageId) { const id = document.createElement('small'); id.textContent = 'ID ' + record.messageId; confirmation.append(id); }
    $('history-body').append(row);
  }
  $('updated-at').textContent = `Última consulta: ${fmt(d.now)} · A automação roda no celular, mesmo com este painel fechado.`;
}
async function refresh(fillForms = false) {
  clearTimeout(pollTimer);
  try { render(await api('dashboard'), fillForms); }
  catch (error) { $('connection-warning').hidden = false; $('connection-warning').textContent = 'Sem comunicação com o servidor. Confira internet e Tailscale. Isso não comprova que a automação parou.'; $('toggle-enabled').disabled = true; throw error; }
  finally { if (csrf) pollTimer = setTimeout(() => refresh().catch(() => {}), 30000); }
}
async function save(changes, revision = dashboard.revision) { await api('config', 'PUT', { revision, changes }); await refresh(); }
$('login-form').onsubmit = async event => { event.preventDefault(); const button = event.target.querySelector('button'); button.disabled = true; $('login-error').textContent = ''; try { const r = await api('login','POST',{ password: new FormData(event.target).get('password') }); csrf = r.csrf; event.target.reset(); dirty = false; loggedIn(true); await refresh(true); } catch(error) { $('login-error').textContent = error.message; } finally { button.disabled = false; } };
$('refresh').onclick = () => action(async () => { await refresh(); toast('Estado atualizado.'); });
$('logout').onclick = () => action(async () => { await api('logout','POST',{}); loggedIn(false); });
$('toggle-enabled').onclick = () => action(async () => { const enabled = !dashboard.config.sendingEnabled; $('toggle-enabled').disabled = true; try { await api('enabled','POST',{ enabled, revision: dashboard.revision }); await refresh(); toast(enabled ? 'Envios automáticos ativados.' : 'Próximos envios automáticos desativados.'); } finally { $('toggle-enabled').disabled = !$('connection-warning').hidden; } });
$('settings-form').oninput = () => { dirty = true; };
$('form-reload').onclick = () => action(async () => { if (!window.confirm('Descartar as alterações não salvas e carregar os campos atuais do servidor?')) return; await refresh(true); dirty = false; toast('Campos atuais carregados.'); });
$('settings-form').onsubmit = event => { event.preventDefault(); action(async () => { const [hour, minute] = $('schedule-time').value.split(':').map(Number); await save({ productionGroup: $('production-group').value, testGroup: $('test-group').value, studentLines: $('student-lines').value.split('\n').filter(x => x.trim()), schedule: { hour, minute, graceMinutes: Number($('grace').value), weekdays: [...document.querySelectorAll('.day-picker input:checked')].map(x => x.value) } }, formRevision); dirty = false; await refresh(true); toast('Agendamento e mensagem salvos.'); }); };
$('pause-form').onsubmit = event => { event.preventDefault(); action(async () => { await save({ pausedDates: [...dashboard.config.pausedDates, $('pause-date').value] }); event.target.reset(); toast('Data pausada.'); }); };
$('test-open').onclick = () => action(async () => { const p = await api('test/prepare','POST',{}); challenge = p.challenge; $('confirm-group').textContent = p.group; $('confirm-text').textContent = p.text; $('test-confirm').disabled = false; $('test-dialog').showModal(); });
$('test-confirm').onclick = () => action(async () => { $('test-confirm').disabled = true; try { const job = await api('test/send','POST',{challenge}); $('test-dialog').close(); $('test-open').disabled = true; $('test-status').textContent = 'Teste em andamento. Aguarde a confirmação; não repita o comando.'; const deadline = Date.now() + 150000; while (Date.now() < deadline && csrf) { await new Promise(r => setTimeout(r, 2500)); const result = await api('test/' + job.id); if (result.status !== 'running') { const ok = ['sent','server_accepted'].includes(result.status); $('test-status').textContent = ok ? 'Confirmado pelo servidor do WhatsApp.' : (result.error || 'Resultado incerto. Confira o WhatsApp antes de repetir.'); toast($('test-status').textContent, !ok); await refresh(); return; } } $('test-status').textContent = 'Ainda sem resultado conclusivo. Confira o histórico antes de repetir.'; } finally { $('test-open').disabled = false; $('test-confirm').disabled = false; } });
$('password-open').onclick = () => $('password-dialog').showModal();
$('password-form').onsubmit = event => { event.preventDefault(); action(async () => { await api('password','POST',Object.fromEntries(new FormData(event.target))); event.target.reset(); $('password-dialog').close(); loggedIn(false); toast('Senha alterada. Entre novamente.'); }); };
document.querySelectorAll('.nav-link').forEach(a => a.onclick = () => { document.querySelectorAll('.nav-link').forEach(x => x.classList.toggle('active', x === a)); });
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
(async () => { try { csrf = (await api('session')).csrf; loggedIn(true); await refresh(true); } catch { loggedIn(false); } })();
