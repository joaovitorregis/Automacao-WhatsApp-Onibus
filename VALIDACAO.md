# Validação da cópia pública

Verificação em 01/10/2026, no Windows, com Node.js 24:

- 35 testes: 34 aprovados e 1 ignorado por depender do kernel Linux/Android.
- Configuração fictícia e envios desativados.
- Testes de ACK usam clientes simulados; nenhum envio real é necessário.
- O teste de CLI utiliza `config.example.json`, sem depender de configuração privada.
- Arquivos de código verificados com `node --check`.

O teste de exclusão concorrente e liberação após SIGKILL precisa ser executado no Termux/Linux. Testes em Windows não comprovam boot, disponibilidade de rede ou envio no celular.

O registro histórico de envio no A10s em 25/09/2026 vem da documentação operacional original; não houve acesso ao servidor ou nova mensagem para preparar esta publicação.
