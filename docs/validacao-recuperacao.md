# Validação de recuperação — 03/10/2026

Este registro descreve testes realizados no Galaxy A10s existente. Não é garantia de disponibilidade contínua nem de recuperação em qualquer aparelho.

## Reinício real

O reinício foi solicitado às 10:08, no fuso America/Fortaleza. O identificador de boot mudou. Após o desbloqueio da tela pelo proprietário, SSH, agendador, painel e servidor de arquivos responderam sem comando manual de partida. A unidade Z: voltou a ser acessível.

O agendador e o painel tinham novos processos; o heartbeat correspondia ao novo agendador. Antes da verificação de sessão, os hashes da configuração, estado de entregas, autenticação WhatsApp e credencial do painel eram iguais aos anteriores ao reinício.

A sessão e os dois grupos configurados foram verificados pelo conector, com resultado `auth_verified_no_send`. Nenhuma mensagem foi transmitida nesse teste. Não foi testada recuperação antes do primeiro desbloqueio, nem após perda prolongada de energia/rede.

Dois arquivos antigos de boot, `start-server.bak` e `start-server.erro`, foram arquivados fora da pasta executável. A versão instalada do Termux possui receiver de boot integrado e tenta executar todos os arquivos dessa pasta. Não foi necessário instalar outro aplicativo ou trocar o Termux.

## Restauração da aplicação

Os processos escritores foram pausados durante a coleta, com guardas de recuperação e envio. Um snapshot de 6.950 arquivos foi criado e restaurado em um diretório novo, separado da instalação ativa.

O manifesto SHA-256 verificou código, dependências instaladas, configuração, estado, autenticação WhatsApp, credencial do painel e definições dos serviços. Os 51 testes existentes naquela instalação passaram na cópia restaurada, incluindo a trava real de processos Linux.

A cópia restaurada não iniciou agendador, conector ou serviço de produção. Testes usam fixtures isoladas. A configuração e o estado ativos permaneceram com os mesmos hashes; os serviços originais foram retomados.

Uma cópia compactada, incluindo os scripts de boot, foi transferida ao notebook. Os hashes no celular e no notebook coincidiram. A pasta local tem acesso restrito à conta do proprietário; o backup contém segredos e não está no GitHub.

Esse teste valida restauração da aplicação na mesma plataforma. Não valida reinstalação do Android/Termux, migração de bibliotecas nativas para outro sistema, recuperação após reset de fábrica ou retorno direto sobre uma instalação ativa.

## Reconciliação histórica de 20–22/09

Foram revisados cinco registros pendentes e sete arquivos de eventos retidos, sem linhas JSON inválidas. Nenhum registro possuía confirmação correspondente nos eventos disponíveis; dois sequer tinham ID de mensagem.

Resultado: **não confirmável com a evidência retida**. Isso não significa “não enviado”. Os registros permaneceram intactos e sem autorização para repetir aquelas tentativas.

Também foi verificado, sem iniciar sender, que uma próxima data elegível continua aceita pela política mesmo com esses registros históricos. A revisão documental está concluída; confirmação factual dessas entregas antigas só seria possível com evidência adicional no WhatsApp.

## Correção do indicador de saúde

O status agora exige concordância entre PID do agendador, PID do heartbeat e PID reportado pelo supervisor, além de heartbeat recente. Um heartbeat do processo anterior não é mais aceito como prova de saúde do novo.
