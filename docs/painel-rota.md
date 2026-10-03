# Painel Rota

Interface para controlar uma instalação já existente da automação no Termux. Permite habilitar/bloquear envios automáticos, alterar horário e conteúdo, pausar datas, consultar a prévia e o histórico e confirmar um envio de teste.

## Segurança e configuração

O código publicado não contém endereço do servidor, senha real, participantes reais ou sessão WhatsApp. O backend escuta `127.0.0.1:8787` por padrão. Para acessar a partir do notebook, configure `PANEL_HOST` com o IP privado do seu servidor no arquivo `panel/run.sh`. O supervisor executa esse arquivo; configurar a variável apenas em um terminal não altera o ambiente do serviço existente.

Não use `0.0.0.0` nem exponha a porta no roteador. O HTTP deve ficar restrito a um transporte privado protegido, por exemplo Tailscale. Não foi implementado acesso público, HTTPS direto ou recuperação automática de senha.

A primeira execução gera a senha em `runtime/panel-access.txt` e o hash em `runtime/panel-auth.json`. Ambos são privados e ignorados pelo Git. Use Alterar senha após entrar. A senha de demonstração em `panel/preview.cjs` é fictícia e funciona somente na demonstração isolada.

## Conta WhatsApp e grupos

A seção Conta WhatsApp permite verificar a sessão e listar grupos, ou iniciar vinculação pelo QR. São ações explícitas, sem envio de mensagens, disponíveis somente com envios automáticos desativados. Não apagam a sessão existente. O conector mantém a mesma trava de concorrência dos envios.

O QR exige login e não é publicado como arquivo estático. A vinculação tem limite de cinco minutos; a verificação, 90 segundos. Ao concluir, a conexão de consulta é encerrada. “Conta verificada” representa a última consulta, não conexão permanente nem confirmação de entrega. A lista de grupos expira em cinco minutos.

Selecione o destino pelo nome e ID. A seleção grava ambos e exige configuração sem alterações concorrentes. Se o grupo for renomeado, o envio é recusado até nova seleção. Alterar o nome manualmente remove a seleção por ID. As chaves históricas permanecem baseadas em data/nome: selecionar outro ID com o mesmo nome não libera automaticamente uma tentativa antiga.

Após a manutenção, confira os destinos e reative manualmente os envios. O instalador agora também atualiza o adaptador do conector e exige envios desativados; não substitui credenciais ou registros de entrega.

As funcionalidades foram inspiradas no [WA-AKG](https://github.com/mrifqidaffaaditya/WA-AKG), com implementação própria para a arquitetura existente, sem importar Next.js ou banco de dados.

Validação operacional em 03/10/2026 no A10s: consulta real da sessão e listagem de grupos aprovadas; seleção por ID testada em configuração isolada. O fluxo de QR foi testado com imagem fictícia, incluindo login, ausência de cache e revogação de acesso após logout. Nova vinculação com QR real não foi testada, pois a sessão existente estava válida. A manutenção preservou configuração e histórico, sem transmitir mensagens, e os envios automáticos foram reabilitados ao terminar.

## Comandos do notebook

Configure variáveis locais no PowerShell, usando os dados da sua instalação:

```powershell
$env:ROTA_SSH_KEY = 'C:\caminho\para\sua-chave-ssh'
$env:ROTA_SSH_TARGET = 'usuario-termux@ip-privado-do-servidor'
$env:ROTA_PANEL_URL = 'http://ip-privado-do-servidor:8787'
.\painel.ps1 -Action Install
.\painel.ps1 -Action Status
.\painel.ps1 -Action Doctor
.\painel.ps1 -Action Access
.\painel.ps1 -Action Open
```

O instalador pressupõe a automação funcionando em `~/whatsapp-onibus-rota-1-android`, com runit, flock, Node.js e dependências socket instalados. Faz upload para uma área de preparação, executa testes sem envio real, guarda backup e instala o painel e os adaptadores de conexão/grupos/teste. Agenda e estado dos envios são preservados. O script não configura sozinho o IP privado: ajuste `panel/run.sh` antes de instalar.

Os testes remotos usam a biblioteca e a política já instaladas no servidor. Antes de substituir arquivos, o instalador compara seus hashes com os da área de testes e cancela se houver diferença. Não atualiza essas dependências silenciosamente.

Se outro acesso alterar os mesmos campos enquanto você edita, o painel preserva seu texto e informa o conflito. Use “Carregar campos atuais” para descartar a edição e recuperar a versão do servidor. Pausas e ativação não descartam os campos em edição. Falhas de conexão aparecem como erro, nunca como atualização confirmada.

O painel usa a estrutura de supervisão já existente. Desativar bloqueia próximos envios; não cancela uma mensagem em andamento nem derruba o servidor. Fechar o navegador não para a automação. Internet, energia, sessão WhatsApp válida e Termux ativo continuam necessários.

Cada teste exige uma confirmação explícita. Resultado incerto não é repetido automaticamente. Confirmação no histórico significa ACK do servidor do WhatsApp, não leitura pelos integrantes.

## Demonstração e testes

```sh
node panel/preview.cjs
node --test test/panel.test.cjs
```

A demonstração usa `config.example.json`, dados fictícios e envio simulado em `http://127.0.0.1:8788`. Não é o painel de produção. As fontes e os assets são locais, sem dependência de CDN.

O design usa sinalização de transporte como referência. A direção visual está em `panel/DESIGN.md`.

## Verificação contínua

O workflow `Tests` executa a verificação de sintaxe e os testes isolados em Windows e Linux, usando Node.js 24 e os dois arquivos de dependências travadas. Não recebe credenciais do servidor e não envia mensagens. No Linux também roda o teste real de exclusão por `flock` e liberação após encerramento do processo. Consulte a aba Actions do GitHub; testes verdes não comprovam internet, energia ou entrega no celular.
