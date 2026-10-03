# Painel Rota

Interface para controlar uma instalação já existente da automação no Termux. Permite habilitar/bloquear envios automáticos, alterar horário e conteúdo, pausar datas, consultar a prévia e o histórico e confirmar um envio de teste.

## Segurança e configuração

O código publicado não contém endereço do servidor, senha real, participantes reais ou sessão WhatsApp. O backend escuta `127.0.0.1:8787` por padrão. Para acessar a partir do notebook, configure `PANEL_HOST` com o IP privado do seu servidor no arquivo `panel/run.sh`. O supervisor executa esse arquivo; configurar a variável apenas em um terminal não altera o ambiente do serviço existente.

Não use `0.0.0.0` nem exponha a porta no roteador. O HTTP deve ficar restrito a um transporte privado protegido, por exemplo Tailscale. Não foi implementado acesso público, HTTPS direto ou recuperação automática de senha.

A primeira execução gera a senha em `runtime/panel-access.txt` e o hash em `runtime/panel-auth.json`. Ambos são privados e ignorados pelo Git. Use Alterar senha após entrar. A senha de demonstração em `panel/preview.cjs` é fictícia e funciona somente na demonstração isolada.

## Notebook

Configure variáveis locais no PowerShell, usando os dados da sua instalação:

```powershell
$env:ROTA_SSH_KEY = 'C:\caminho\para\sua-chave-ssh'
$env:ROTA_SSH_TARGET = 'usuario-termux@ip-privado-do-servidor'
$env:ROTA_PANEL_URL = 'http://ip-privado-do-servidor:8787'
.\painel.ps1 -Action Install
.\painel.ps1 -Action Status
.\painel.ps1 -Action Access
.\painel.ps1 -Action Open
```

O instalador pressupõe a automação funcionando em `~/whatsapp-onibus-rota-1-android`, com runit, flock, Node.js e dependências socket instalados. Faz upload para uma área de preparação, executa testes sem envio real, guarda backup e instala somente o painel/adaptador de teste. Agenda e estado dos envios são preservados. O script não configura sozinho o IP privado: ajuste `panel/run.sh` antes de instalar.

O painel usa a estrutura de supervisão já existente. Desativar bloqueia próximos envios; não cancela uma mensagem em andamento nem derruba o servidor. Fechar o navegador não para a automação. Internet, energia, sessão WhatsApp válida e Termux ativo continuam necessários.

Cada teste exige uma confirmação explícita. Resultado incerto não é repetido automaticamente. Confirmação no histórico significa ACK do servidor do WhatsApp, não leitura pelos integrantes.

## Demonstração e testes

```sh
node panel/preview.cjs
node --test test/panel.test.cjs
```

A demonstração usa `config.example.json`, dados fictícios e envio simulado em `http://127.0.0.1:8788`. Não é o painel de produção. As fontes e os assets são locais, sem dependência de CDN.

O design usa sinalização de transporte como referência. A direção visual está em `panel/DESIGN.md`.
