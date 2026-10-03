# Revisão das funcionalidades existentes

## Critérios de conclusão

| Prioridade | Critério | Evidência e pendências |
| --- | --- | --- |
| Estados da interface | Ações incompatíveis bloqueadas com orientação; falha de conexão não aparenta estado atual | Testes de interface e navegador Chromium cobrem lista vazia, seleção fictícia, bloqueio offline e retomada. QR fictício exibido com ações bloqueadas e ocultado após expiração simulada. Conflito externo e recarga após confirmação conferidos no navegador. Não houve nova vinculação real. |
| Configuração segura | Revisão impede sobrescrita; alterações locais sobrevivem a consultas e salvamentos concorrentes | Testes cobrem conflito externo, edição durante salvamento/recarga e preservação dos IDs dos destinos. Ensaio Chromium mostrou edição local preservada, gravação desatualizada rejeitada e recarga explícita dos dados externos. Seleção por ID usa confirmação e revisão. |
| Histórico | Confirmação, tentativa, incerteza e não início têm explicação sem prometer leitura | Explicações e limites cobertos por teste e revisão visual em Chromium com cinco estados fictícios, incluindo estado desconhecido. Registros antigos permanecem preservados. |
| Recuperação | Reinício e backup possuem evidência; falhas de rede têm comportamento seguro | Ensaio real documentado em `validacao-recuperacao.md`; testes de transporte simulado cobrem queda antes e depois da tentativa. Perda prolongada de rede real não foi validada. |
| Manutenção | Fonte de desenvolvimento identificada, instalação comparada e testes reproduzíveis | Manutenção autorizada em 03/10/2026 alinhou `src/lib.cjs`, `manage.cjs`, instalador e testes. Os 89 testes passaram no A10s; configuração, entregas e autenticação mantiveram seus hashes. Serviços retomados saudáveis e painel HTTP 200. O atalho privado do notebook delega à cópia atual e foi validado com Status. Partida privada difere intencionalmente; scripts de prévia e ensaio não são necessários em produção. |

## Auditoria final de 03/10/2026

As cinco prioridades foram verificadas com testes isolados, ensaios em Chromium, registros privados do reinício/restauração e consulta à instalação ativa. A suíte atual passou no A10s; no Windows, 89 testes passaram e o teste de trava Linux foi ignorado. A CI passou em Windows e Ubuntu.

A comparação de todos os arquivos JavaScript, HTML, CSS e shell publicados encontrou apenas três diferenças esperadas: `panel/run.sh` usa o endereço e os caminhos privados; `panel/preview.cjs` e `scripts/maintenance/test-stall.cjs` são ferramentas de desenvolvimento, não componentes do serviço ativo. Os demais arquivos comparados, incluindo testes, coincidem por SHA-256.

A validação de rede foi proporcional e não destrutiva: transporte simulado antes/depois da tentativa e navegador offline/online. Não inclui desligamento prolongado da internet real do aparelho. O QR visual era fictício; a sessão válida não foi removida para forçar uma nova vinculação. Esses limites não são prova de falha nem garantia de recuperação em qualquer condição.

Configuração, registros antigos e sessão foram preservados. Nenhuma mensagem real foi enviada durante esta revisão. Novos ensaios com desconexão real, reinício ou restauração sobre produção exigem janela autorizada e preservação do registro de entregas.
