# Validação de recuperação

Ensaio realizado em 03/10/2026 no Galaxy A10s com Termux. Os resultados se aplicam à instalação testada.

## Reinício

Após reinício real e desbloqueio da tela, SSH, agendador, painel e compartilhamento de arquivos voltaram sem comando manual de partida. O identificador de boot mudou e o heartbeat correspondia ao novo processo supervisionado.

Os hashes da configuração, estado de entregas e credenciais permaneceram iguais antes da verificação da sessão. O conector retornou `auth_verified_no_send`, sem transmitir mensagens.

## Backup e restauração

Com os escritores parados e as guardas adquiridas, um snapshot de 6.950 arquivos foi restaurado em diretório isolado. O manifesto SHA-256 verificou código, dependências, configuração, estado, credenciais e definições dos serviços.

Os 51 testes daquela instalação passaram na cópia restaurada, incluindo a trava real de processos Linux. Nenhum serviço de produção foi iniciado pela cópia. Os serviços originais foram retomados com configuração e estado preservados.

Uma cópia privada foi transferida ao notebook, com hashes iguais nas duas máquinas. Credenciais e registros detalhados ficam fora do repositório.

## Limites do ensaio

Não foram testados boot antes do primeiro desbloqueio, perda prolongada de energia ou rede, reset de fábrica, migração para outra plataforma ou promoção do backup sobre uma instalação ativa.

Consulte o [procedimento de backup](backup.md) e o [guia de operação](operacao.md) antes de realizar manutenção.
