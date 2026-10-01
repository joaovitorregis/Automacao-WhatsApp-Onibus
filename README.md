# Automação WhatsApp · Ônibus universitário

Criei este projeto para automatizar uma tarefa recorrente: publicar a lista diária do ônibus universitário no grupo de WhatsApp. A automação monta a mensagem com a data e os participantes e faz o envio nos dias e horários configurados.

**Autor:** João Vitor Regis.

## Um celular como servidor

O projeto foi implantado em um **Samsung Galaxy A10s com Termux**, usando o próprio celular como servidor. Node.js executa o agendador e o conector do WhatsApp; o notebook foi utilizado para desenvolvimento e manutenção.

A execução no celular teve um envio agendado confirmado em **25/09/2026, às 02:00**, no fuso America/Fortaleza.

## O que o código faz

- Monta a lista com a data e os participantes configurados.
- Agenda a execução por dias da semana, horário e janela de recuperação.
- Confere o grupo de destino e permite um grupo separado para testes.
- Registra o estado antes do envio e verifica o ACK do servidor.
- Bloqueia repetições quando uma tentativa já existe ou seu resultado é incerto.
- Oferece supervisor, trava de concorrência e recuperação do processo no Android.

ACK confirma aceitação pelo servidor; não significa leitura pelos integrantes do grupo.

## Tecnologias

JavaScript · Node.js · Termux · Baileys · runit. O código também preserva componentes da adaptação anterior por navegador com whatsapp-web.js; o conector de operação no Android fica em `socket/`.

## Como configurar

```sh
# Na raiz do projeto
npm ci --ignore-scripts
cd socket
npm ci --ignore-scripts
cd ..
cp config.example.json config.json
npm run dry-run
```

O exemplo contém participantes e grupos fictícios e mantém `sendingEnabled: false`. O comando `dry-run` mostra a mensagem que seria gerada, sem enviá-la.

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

O celular precisa de conexão, energia e permissão para executar o Termux em segundo plano. O Android pode encerrar o processo, e a retomada após uma reinicialização ainda precisa ser verificada. A integração pode exigir manutenção quando o WhatsApp muda.

A configuração pessoal, a sessão do WhatsApp e os registros de operação ficam fora do repositório. Para usar o projeto, configure seus próprios grupos e participantes e vincule sua conta no celular.
