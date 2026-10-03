# Automação WhatsApp · Ônibus universitário

Automação da publicação da lista diária do ônibus universitário em um grupo de WhatsApp. O sistema monta a mensagem com a data e os participantes e faz o envio nos dias e horários configurados.

Autor: João Vitor Regis.

[![Tests](https://github.com/joaovitorregis/Automacao-WhatsApp-Onibus/actions/workflows/test.yml/badge.svg)](https://github.com/joaovitorregis/Automacao-WhatsApp-Onibus/actions/workflows/test.yml)

Aplicação pessoal implantada em Android/Termux, com painel privado e testes em Windows/Linux. Não é um serviço hospedado nem uma API oficial do WhatsApp. A confiabilidade operacional depende do celular, da rede e da sessão.

## Documentação

- [Instalação Android](docs/servidor-android.md)
- [Painel e comandos do notebook](docs/painel-rota.md)
- [Diagnóstico e incidentes](docs/operacao.md)
- [Arquitetura e decisões](docs/arquitetura.md)
- [Contribuição e critérios de entrega](CONTRIBUTING.md)

## Um celular como servidor

O projeto foi implantado em um Samsung Galaxy A10s com Termux, usando o celular como servidor. Node.js executa o agendador e o conector do WhatsApp; o notebook foi utilizado para desenvolvimento e manutenção.

A execução no celular teve um envio agendado confirmado em 25/09/2026, às 02:00, no fuso America/Fortaleza.

## O que o código faz

- Monta a lista com a data e os participantes configurados.
- Agenda a execução por dias da semana, horário e janela de recuperação.
- Confere o grupo de destino e permite um grupo separado para testes.
- Registra o estado antes do envio e verifica o ACK do servidor.
- Bloqueia repetições quando uma tentativa já existe ou seu resultado é incerto.
- Oferece supervisor, trava de concorrência e recuperação do processo no Android.
- Inclui o painel Rota: controle de envios, agenda, pausas por data, prévia da mensagem e histórico de confirmações.

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

Para desenvolvimento, use Node.js 24, execute `npm test` e acompanhe a CI. No servidor configurado, `npm run doctor` faz um diagnóstico somente leitura; ele não comprova envio nem altera a instalação.

A instalação no Termux está documentada no [guia do servidor Android](docs/servidor-android.md). A autenticação e a habilitação de envio são etapas manuais da instalação.

## Estrutura

```text
src/                  lógica de mensagem e componentes do executor
socket/               conector WhatsApp, autenticação, política e testes
test/                 testes da lógica e dos processos
scheduler.cjs         agendador
service.cjs           controle do supervisor
config.example.json   configuração fictícia, com envios desativados
docs/                 instalação e limites de operação
panel/                painel web privado e interface responsiva
painel.ps1            instalação e consulta pelo notebook
```

## Painel de controle Rota

O painel foi desenvolvido e instalado no servidor Android. A interface foi verificada em desktop e telas estreitas; testes automatizados usam envio simulado, sem publicar mensagens reais. A configuração pública usa localhost por padrão e dados fictícios.

O acesso operacional é pelo notebook na rede privada. Não foi configurado acesso público pela internet. Código no GitHub não hospeda o painel nem dá acesso ao WhatsApp.

Veja [configuração e uso do painel](docs/painel-rota.md). O painel exige login, protege alterações com token de sessão e confirmação de teste, e mantém credenciais e registros fora do Git.

## Limites

O funcionamento depende de conexão, energia e permissão para executar o Termux em segundo plano. O Android pode encerrar o processo. Não há registro de validação da retomada automática após reinicialização. A integração depende da compatibilidade do conector com o WhatsApp.

A configuração pessoal, a sessão do WhatsApp e os registros de operação ficam fora do repositório. Cada instalação requer a configuração dos grupos e participantes e a vinculação de uma conta do WhatsApp.

## Licenças

- Código, scripts, testes e configuração de exemplo: [MIT](LICENSE).
- README e documentação em `docs/`: [CC BY 4.0](LICENSE-MATERIALS), com atribuição a João Vitor Regis.

As dependências conservam suas próprias licenças.
