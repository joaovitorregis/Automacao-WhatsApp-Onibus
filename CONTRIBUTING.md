# Contribuir e manter

Use Node.js 24, a versão validada pela CI. Instale com `npm ci --ignore-scripts` na raiz e em `socket/`; não atualize dependências junto de uma correção sem justificar a mudança.

## Antes de alterar

- Trabalhe em uma cópia de desenvolvimento, nunca sobre a sessão ativa do servidor.
- Não inclua configuração pessoal, participantes, QR, cookies, senhas, chaves SSH ou logs reais.
- Preserve o registro de tentativas. Uma tentativa incerta não autoriza reenvio.
- Separe refatoração, correção funcional e atualização de dependências em commits distintos.

## Critério de entrega

1. Adicione um teste isolado que reproduza o problema ou cubra a funcionalidade.
2. Execute `npm test` e `git diff --check`.
3. Inspecione `git diff --cached` antes de publicar; `.gitignore` não remove segredos já rastreados.
4. Aguarde os jobs Windows e Linux na aba Actions.
5. Informe o comportamento anterior, a mudança, a evidência dos testes e os limites.
6. Mudanças no executor exigem plano de rollback e validação no Termux. CI não valida automaticamente Android, rede ou entrega.

Não use testes de unidade para publicar mensagens reais. Teste operacional exige revisão de destino, confirmação explícita e conferência de ACK.

## Relatar problemas

Abra uma issue com versão/commit, ambiente, comando executado, resultado esperado e erro sanitizado. Oculte nomes, números, IDs de mensagens e dados de autenticação. Não anexe o diretório `runtime/` completo.

Suspeitas de exposição de credenciais não devem incluir o segredo em uma issue pública. Revogue a credencial comprometida e comunique ao mantenedor por um canal privado.
