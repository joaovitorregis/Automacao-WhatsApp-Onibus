# Revisão das funcionalidades existentes

## Critérios de conclusão

| Prioridade | Critério | Evidência e pendências |
| --- | --- | --- |
| Estados da interface | Ações incompatíveis bloqueadas com orientação; falha de conexão não aparenta estado atual | Testes de interface e navegador Chromium cobrem lista vazia, seleção fictícia, bloqueio offline e retomada. QR fictício exibido com ações bloqueadas e ocultado após expiração simulada. Conflito externo e recarga após confirmação conferidos no navegador. Não houve nova vinculação real. |
| Configuração segura | Revisão impede sobrescrita; alterações locais sobrevivem a consultas e salvamentos concorrentes | Testes cobrem conflito externo, edição durante salvamento/recarga e preservação dos IDs dos destinos. Ensaio Chromium mostrou edição local preservada, gravação desatualizada rejeitada e recarga explícita dos dados externos. Seleção por ID usa confirmação e revisão. |
| Histórico | Confirmação, tentativa, incerteza e não início têm explicação sem prometer leitura | Explicações e limites cobertos por teste e revisão visual em Chromium com cinco estados fictícios, incluindo estado desconhecido. Registros antigos permanecem preservados. |
| Recuperação | Reinício e backup possuem evidência; falhas de rede têm comportamento seguro | Ensaio real documentado em `validacao-recuperacao.md`; testes de transporte simulado cobrem queda antes e depois da tentativa. Perda prolongada de rede real não foi validada. |
| Manutenção | Fonte de desenvolvimento identificada, instalação comparada e testes reproduzíveis | Manutenção autorizada em 03/10/2026 alinhou `src/lib.cjs`, `manage.cjs`, instalador e testes. Os 89 testes passaram no A10s; configuração, entregas e autenticação mantiveram seus hashes. Serviços retomados saudáveis e painel HTTP 200. O atalho privado do notebook delega à cópia atual e foi validado com Status. Partida privada difere intencionalmente; scripts de prévia e ensaio não são necessários em produção. |

Não considerar esta revisão concluída enquanto houver pendências. Não reiniciar serviços, desconectar a rede ou restaurar sobre produção somente para obter uma marca de aprovação. Esses ensaios exigem janela autorizada e preservação do registro de entregas.
