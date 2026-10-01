# Automação WhatsApp · Ônibus universitário

Automação desenvolvida por **João Vitor Regis** para preparar e enviar a lista diária do transporte universitário em um grupo de WhatsApp, conforme dias e horário configurados.

## Um celular como servidor

O projeto foi implantado em um **Samsung Galaxy A10s com Termux**, usando o próprio celular como servidor. Node.js executa o agendador e o conector do WhatsApp; o notebook foi utilizado para desenvolvimento e manutenção.

A documentação operacional original registra um envio agendado confirmado pelo servidor do WhatsApp em **25/09/2026, às 02:00, no fuso America/Fortaleza**. Esse registro descreve a execução observada naquela data, não uma verificação de disponibilidade atual ou permanente.

## O que o código faz

- Monta a lista com a data e os participantes configurados.
- Agenda a execução por dias da semana, horário e janela de recuperação.
- Confere o grupo de destino e permite um grupo separado para testes.
- Registra o estado antes do envio e verifica o ACK do servidor.
- Bloqueia repetições quando uma tentativa já existe ou seu resultado é incerto.
- Oferece supervisor, trava de concorrência e recuperação do processo no Android.

ACK confirma aceitação pelo servidor; não significa leitura pelos integrantes do grupo.

## Tecnologias

JavaScript · Node.js · Termux · Baileys · runit · testes nativos do Node.js. O código também preserva componentes da adaptação anterior por navegador com whatsapp-web.js; o conector de operação no Android fica em `socket/`.

## Começar com segurança

```sh
# Na raiz do projeto
npm ci --ignore-scripts
cd socket
npm ci --ignore-scripts
cd ..
cp config.example.json config.json
npm test
npm run dry-run
```

O exemplo contém participantes e grupos fictícios e mantém `sendingEnabled: false`. Os testes usam clientes simulados e arquivos temporários; não precisam da sessão real nem enviam mensagens.

Para implantar no Termux, veja [o guia do servidor Android](docs/servidor-android.md). Autenticação e habilitação de envio são etapas manuais na sua própria instalação.

## Estrutura

```text
src/                  lógica de mensagem e componentes do executor
socket/               conector WhatsApp, autenticação, política e testes
test/                 testes da lógica e dos processos
scheduler.cjs         agendador
service.cjs           controle do supervisor
config.example.json   configuração fictícia, com envios desativados
docs/                 instalação e limites de operação
```

## Limites

O Android pode encerrar o Termux; rede, energia e permissões de execução em segundo plano afetam a operação. A sobrevivência a reinicialização física não foi comprovada na documentação consultada. A integração usa bibliotecas de terceiros e pode exigir manutenção quando o WhatsApp muda.

Esta publicação não inclui credenciais, QR codes, sessões, números reais, logs operacionais ou a lista original. A instalação em uso no celular não foi alterada para preparar o repositório.
