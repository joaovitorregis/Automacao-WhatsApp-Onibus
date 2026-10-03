# Servidor Android com Termux

## Arquitetura utilizada

Galaxy A10s → Termux → Node.js/agendador → conector Baileys → WhatsApp. O serviço fica no celular; o notebook é uma ferramenta de manutenção.

## Preparar uma instalação própria

1. Instale Termux de uma distribuição confiável e configure Node.js, bash, util-linux (flock) e termux-services. A rotina de recuperação utiliza Termux:API. A inicialização via boot depende da distribuição: a instalação testada possui receiver integrado; outras podem precisar de Termux:Boot.
2. Coloque o projeto em `~/whatsapp-onibus-rota-1-android`, caminho esperado pelos scripts de infraestrutura. Instale as dependências da raiz e de `socket/` conforme o README.
3. Copie `config.example.json` para `config.json`. Ajuste participantes, grupos e agenda, mantendo `sendingEnabled: false` durante a preparação.
4. Rode os testes e `npm run dry-run`. Crie `runtime/` e inicialize **somente em instalação nova** um estado `state.json` com `{"version":1,"deliveries":{}}`. Nunca substitua ou apague o estado de uma instalação em uso.
5. Vincule sua própria conta manualmente com `bash socket/run.sh`; o QR temporário fica em `socket/runtime/login.png`. Não publique essa imagem nem os arquivos de autenticação.
6. Confirme os grupos com `bash socket/run.sh --verify`, sem envio. Após revisar o destino e o horário, habilite o envio com `node service.cjs enable`.

## Operação

`node service.cjs status` consulta o supervisor. `node service.cjs disable` bloqueia novos envios. `node service.cjs start` inicia o agendador. Configurar boot e recuperação depende dos aplicativos e permissões instalados no Android; os arquivos não fazem isso automaticamente ao serem clonados.

Não execute agendadores concorrentes no Windows e no celular. Não apague o estado para repetir tentativas incertas: primeiro reconcilie o resultado da entrega.

## Registro histórico

O envio agendado de 25/09/2026 foi confirmado pelo ACK do servidor do WhatsApp. Os registros completos ficam fora do repositório porque contêm identificadores da operação.
