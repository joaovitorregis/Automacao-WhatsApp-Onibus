# Backup e restauração controlada

O snapshot contém segredos. Guarde-o em pasta privada, fora do compartilhamento e do repositório. SHA-256 detecta alteração em relação ao manifesto; não é criptografia nem assinatura de autenticidade. Um atacante com acesso de escrita pode alterar arquivos e manifesto.

## Coleta

Antes de coletar, confirme uma janela sem envio, pause o painel e o agendador e mantenha as guardas de recuperação e envio adquiridas. Não confunda `sendingEnabled: false` com ausência de processos escritores. Retome os serviços originais mesmo se a coleta falhar.

Com os escritores já parados:

```sh
cd ~/whatsapp-onibus-rota-1-android
node scripts/recovery-snapshot.cjs create "$PWD" ~/.local/share/rota-recovery/snapshot-NOVO
```

O destino precisa ser novo e fora da origem. O programa recusa destinos existentes, sobreposição, links externos, arquivos obrigatórios ausentes e divergência de integridade. Uma coleta interrompida pode deixar uma pasta parcial: ela não é um backup validado. Não a use para restauração.

Copie também os scripts de boot por um meio privado. O snapshot da aplicação não inclui configurações do Android, chaves do SSH ou preferências do Tailscale. Ao transferir um arquivo compactado, confira SHA-256 antes e depois.

## Ensaio de restauração

```sh
node scripts/recovery-snapshot.cjs restore ~/.local/share/rota-recovery/snapshot-NOVO ~/.local/share/rota-recovery/restored-NOVO
```

A restauração verifica o manifesto antes de copiar e novamente verifica os arquivos recuperados. Não inicia nenhum serviço. Na cópia, execute somente testes isolados:

```sh
cd ~/.local/share/rota-recovery/restored-NOVO
node --test test/*.test.cjs socket/*.test.mjs
```

Não execute `service.cjs start`, `scheduler.cjs`, `socket/run.sh`, autenticação ou comandos de envio nessa cópia. Os scripts operacionais usam o caminho da instalação original; iniciar código restaurado sem revisar caminhos pode alcançar o servidor ativo.

Os PIDs, heartbeat, locks e sockets transitórios não são restaurados. Eles precisam ser gerados pelos serviços no processo de recuperação. Reinstalar dependências em outro sistema pode ser necessário; os módulos nativos da cópia são da plataforma de origem.

## Recuperação de produção

Ensaio em pasta isolada não autoriza sobrescrever o servidor. Antes de recuperação real, obtenha o estado de entregas mais recente disponível, bloqueie envios, pare escritores e guarde a instalação atual. Se houver tentativas posteriores à data do backup, reconciliar esses registros é obrigatório: voltar a um estado antigo pode duplicar mensagens.

Não há comando de promoção automática da cópia restaurada para produção. Essa etapa deve revisar caminhos, identidade do aparelho, acesso à rede privada e registro de entregas antes de ativar qualquer executor.

Veja [o ensaio realizado no A10s](validacao-recuperacao.md).
