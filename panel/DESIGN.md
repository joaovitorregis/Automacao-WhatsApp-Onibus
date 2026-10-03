# Rota: direção visual

O painel serve a uma rotina de transporte universitário: decidir quando uma lista pode ser enviada e verificar resultados. A referência visual é sinalização de transporte, sem simular uma passagem, mapa ou informação de viagem que o sistema não possui.

- Azul de sinalização `#2365d5`: ações e navegação.
- Azul estrutural `#18324b`: texto e quadro de horário.
- Amarelo de rota `#f4ca53`: marcador da marca e linha do quadro.
- Névoa `#eef3f7`: fundo.
- Branco `#ffffff`: superfícies de trabalho.
- Ardósia `#52677d`: texto secundário.

Tipografia: Bahnschrift nas chamadas e horários (com fallbacks condensados locais), Segoe UI no trabalho e nos formulários. Nenhum download de fonte ou serviço externo é necessário no A10s.

Estrutura: navegação estreita à esquerda; estado do envio e executor como indicadores discretos; próximo horário em quadro de sinalização destacado; controles e prévia lado a lado; formulários agrupados abaixo. No celular, navegação horizontal e conteúdo em uma coluna. Tudo alinhado à esquerda, sem animações decorativas.

O próximo horário concentra o destaque visual. Estados de atenção são distintos do estado saudável; o status do executor não representa confirmação de entrega.

Foco de teclado visível, toque mínimo de 44px, contraste de texto, redução de movimento e ausência de rolagem horizontal na página fazem parte da validação. A tabela possui sua própria rolagem no celular.
