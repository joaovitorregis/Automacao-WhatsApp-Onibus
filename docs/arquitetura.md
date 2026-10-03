# Arquitetura e decisões

```text
Notebook ── rede privada ── painel HTTP no Termux
                              │ configuração validada
                              ▼
                       config.json
                              │
                       agendador (runit)
                              │ janela / pausa / habilitação
                              ▼
                  flock → conector Baileys → WhatsApp
                              │ tentativa persistida / ACK
                              ▼
                       runtime/state.json
```

## Responsabilidades

- `src/lib.cjs`: mensagem, fuso, datas e regras de agenda.
- `scheduler.cjs`: heartbeat e seleção da janela de execução.
- `service.cjs` e scripts de supervisão: estado e ciclo de vida do processo.
- `socket/policy.mjs`: elegibilidade do envio e bloqueio de tentativas anteriores.
- `socket/auth-store.mjs`: snapshot privado de autenticação com gravação atômica.
- `panel/`: sessão de acesso, CSRF, alterações validadas com revisão, histórico e teste confirmado.
- `scripts/doctor.cjs`: diagnóstico local somente leitura, independente de login no painel.

## Entrega e repetição

A tentativa é persistida antes da transmissão. O resultado precisa de confirmação correspondente à mensagem. Qualquer registro anterior da mesma data/grupo bloqueia repetição no conector. Uma interrupção ou falta de ACK não se converte em sucesso.

Essa política prioriza não duplicar mensagens. Pode exigir reconciliação manual quando o processo perde a confirmação. Não oferece garantia de “exactly once”: não há transação distribuída entre arquivo local e WhatsApp.

## Fronteiras

O painel é privado. Não existe hospedagem pública, recuperação automática de senha ou canal de suporte remoto. O conector depende de compatibilidade externa com o WhatsApp e não é uma API oficial do projeto.

Os componentes antigos de navegador permanecem em `src/` por compatibilidade e testes. O caminho operacional Android utiliza `socket/`; não execute os dois em paralelo.
