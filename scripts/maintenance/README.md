# Testes operacionais de manutenção

Estes scripts atuam sobre processos reais. Não fazem parte de `npm test` e não devem ser executados no servidor durante a operação normal.

`test-stall.cjs` suspende o agendador com `SIGSTOP`, altera o heartbeat e solicita recuperação pelo supervisor. Exige Linux/Termux, envios desativados e ausência de transmissão em andamento. Pode interromper a automação.

Use somente em janela de manutenção autorizada, com backup privado e acesso ao servidor. Execute na instalação que será testada:

```sh
node scripts/maintenance/test-stall.cjs
```

Após o teste, confira `node service.cjs status` e revise a habilitação dos envios antes de retomar a operação. O script não é um diagnóstico somente leitura.
