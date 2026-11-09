# Estilo do Rota do Edital

- **Preset:** clean (refinado a partir da identidade anterior)
- **Acento:** índigo `#4f46e5` (escuro: `#a5b1ff`). Escolhido por não colidir com verde/vermelho de acerto/erro.
- **Densidade:** confortável (controles de 44 px; chips de 36 px no mouse, 44 px em telas de toque).
- **Tema:** segue o sistema, com alternador manual (sistema → claro → escuro) guardado no `localStorage` do navegador.
- **Fontes (locais, offline):** Bricolage Grotesque nos títulos, Source Sans 3 no corpo, IBM Plex Mono em números e etiquetas. O preset clean sugere Inter; mantivemos as fontes já embarcadas por causa da regra offline.
- **Tokens:** gerados com `tokens.py --preset clean --accent "#4f46e5" --density comfortable`. Não editar os hex à mão; regenerar.

## Decisões
- Uma ação primária por tela: o cartão "Próximo passo" na aba Hoje.
- Avisos baseados em evidência usam a caixa `.dica` (azul informativo); pegadinhas usam âmbar.
- Fonte mínima de 12 px; corpo 16 px; resumo 17 px com entrelinha 1,6.
- Abas no endereço (`#hoje`, `#erros`, `#revisao/<tid>`) para o botão Voltar funcionar.

## Android
- Tema Compose gerado: `tokens.py --format compose` → `android/.../ui/theme/Tokens.kt`; ajustes (corpo 14 sp, títulos em negrito, cores semânticas) em `Tema.kt`.
- Fonte do sistema (Roboto): os .woff2 do web não servem no Android e o orçamento de tamanho é ≤ 5 MB.
- Barra inferior com 5 destinos rotulados (Hoje, Edital, Erros, Materiais, Mais); trilho lateral a partir de 600 dp.
- Ação principal no alcance do polegar: botão estendido "Começar" no Hoje e barra fixa "Marcar como estudado/Concluir revisão" na aula.
- Alvos ≥ 48 dp; etiquetas das listas com largura mínima de 92 dp para alinhar os títulos.
- Ícones das barras do sistema seguem o tema escolhido no app.

## Preferências do usuário
- Escolheu: clean refinado, índigo, confortável, sistema + botão.
