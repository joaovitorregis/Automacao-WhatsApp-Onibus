# Revisão das funcionalidades existentes

## Critérios de conclusão

| Prioridade | Critério | Evidência e pendências |
| --- | --- | --- |
| Estados da interface | Ações incompatíveis bloqueadas com orientação; falha de conexão não aparenta estado atual | Testes de interface cobrem lista vazia, perda de comunicação, bloqueio e retomada. Falta conferir visualmente os fluxos completos no navegador. |
| Configuração segura | Revisão impede sobrescrita; alterações locais sobrevivem a consultas e salvamentos concorrentes | Testes cobrem conflito externo, edição durante salvamento e preservação dos IDs dos destinos. Seleção por ID usa confirmação e revisão. |
| Histórico | Confirmação, tentativa, incerteza e não início têm explicação sem prometer leitura | Explicações e limites cobertos por teste; registros antigos permanecem preservados. Falta revisão visual com todos os estados. |
| Recuperação | Reinício e backup possuem evidência; falhas de rede têm comportamento seguro | Ensaio real documentado em `validacao-recuperacao.md`; testes de transporte simulado cobrem queda antes e depois da tentativa. Perda prolongada de rede real não foi validada. |
| Manutenção | Fonte de desenvolvimento identificada, instalação comparada e testes reproduzíveis | Orientação em `operacao.md`; hashes dos módulos centrais comparados no A10s. Restam auditoria completa da distribuição e verificação das cópias antigas do notebook. |

Não considerar esta revisão concluída enquanto houver pendências. Não reiniciar serviços, desconectar a rede ou restaurar sobre produção somente para obter uma marca de aprovação. Esses ensaios exigem janela autorizada e preservação do registro de entregas.
