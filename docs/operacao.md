# Operação e resposta a incidentes

O celular executa a automação. O notebook mantém o código e acessa o painel privado. GitHub e CI não executam os envios.

## Diagnóstico sem mudanças

No Termux, na raiz da instalação:

```sh
cd ~/whatsapp-onibus-rota-1-android
npm run doctor
node service.cjs status
```

Os caminhos dos scripts são relativos à raiz do projeto, não à pasta inicial do Termux. Para executar de qualquer pasta, use `node ~/whatsapp-onibus-rota-1-android/scripts/doctor.cjs`. No notebook, `painel.ps1 -Action Doctor` faz essa consulta por SSH no diretório correto.

## Armazenamento compartilhado do Android

O atalho padrão do Termux é `~/storage/shared`, apontando para o armazenamento interno compartilhado. Para abrir a pasta de downloads no terminal, use `cd ~/storage/shared/Download`. Isso não configura acesso pelo Explorador do Windows: esse acesso depende do aplicativo ou protocolo de compartilhamento instalado.

Se o próprio Termux receber “Permission denied”, confira a permissão de arquivos nas configurações do Android e execute `termux-setup-storage` no celular, confirmando a solicitação exibida. Não redefina permissões se o diretório já for legível. Mantenha sessão WhatsApp, configuração pessoal e backups sensíveis no diretório privado do Termux, não no armazenamento compartilhado.

Para integrar a consulta em outra ferramenta: `npm run doctor -- --json`. Para uma pasta diferente: `node scripts/doctor.cjs --root /caminho/da/instalacao --json`.

O diagnóstico não cria arquivos, não repara estado, não reinicia o executor e não conecta ao WhatsApp. Código de saída 0 significa somente ausência de erros nas verificações locais; 1 indica erro; 2 indica argumentos inválidos. Avisos não tornam o resultado uma falha: envios desabilitados podem ser intencionais.

O diagnóstico omite nomes, participantes e conteúdo dos registros. Ele não verifica sessão WhatsApp, internet, supervisor, entrega ou boot. Campos novos podem exigir atualização desse verificador.

## Três evidências diferentes

| Evidência | O que demonstra | O que não demonstra |
| --- | --- | --- |
| Heartbeat recente | O agendador gravou atividade recentemente | Processo ainda vivo ou mensagem enviada |
| Status saudável do supervisor | Processo supervisionado ativo e heartbeat recente | Internet e entrega |
| Tentativa com ACK e ID correspondente | Aceitação da mensagem pelo servidor WhatsApp | Leitura dos participantes |

## Quando não envia

1. Confira internet no celular, energia, relógio e restrições de bateria do Termux.
2. Confira no painel habilitação, dias, horário, janela de recuperação e pausas por data.
3. Consulte diagnóstico e status sem reiniciar imediatamente.
4. Confira o registro da data/grupo e os eventos correspondentes. Registros de tentativa impedem repetição automática por segurança.
5. Se a tentativa estiver incerta, confira o WhatsApp e reconcilie o resultado antes de qualquer decisão de reenvio. Não apague `state.json` nem mude a data para forçar outra tentativa.
6. Se a sessão estiver desconectada, vincule manualmente em uma janela de manutenção. Não publique o QR.

Notebook ou SSH indisponível não prova falha do celular. Consulte novamente quando o acesso voltar.

## Atualização e retorno

Para o painel, use `painel.ps1 -Action Install` no notebook. O instalador testa o candidato usando as dependências existentes, verifica hashes e guarda backup. Preserva configuração e estado. Confira o status depois; um upload completo não é comprovação de saúde.

Para o executor, não há atualização automática transacional. Planeje uma janela sem envio, bloqueie próximos envios, confirme que não há transmissão em andamento e obtenha backup privado consistente antes de substituir arquivos. Registre commit anterior e novo. Restaurar código não significa restaurar estado: nunca volte o registro de entregas para uma versão anterior que permita duplicações.

## Backup e recuperação

Guarde código/commit, configuração, registro de entregas, autenticação socket e credencial do painel em armazenamento privado protegido. Uma cópia feita durante gravação pode ser inconsistente; obtenha um snapshot com processos escritores parados numa janela de manutenção. Não publique backups no GitHub.

Não foi comprovada restauração integral nem retomada após reinicialização nesta documentação. Não reinicie um servidor ativo só para testar. A validação deve ser planejada, com acompanhamento do acesso, heartbeat, supervisor e próximo envio autorizado.
