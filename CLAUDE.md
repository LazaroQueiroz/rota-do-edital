# Rota do Edital — instruções para o Claude Code

App local de estudo para concursos públicos brasileiros. O usuário envia o edital (PDF) e o app monta edital verticalizado, plano diário, aulas (resumo, pegadinhas, questões no estilo da banca), revisões espaçadas, desempenho e caderno de erros. Tudo roda no computador do usuário e funciona offline com o conteúdo já gerado.

Interface e textos em **português do Brasil**. Escreva mensagens de commit, comentários e textos da UI em português.

## Como rodar

    python server.py                 # http://localhost:8765, abre o navegador
    python server.py --sem-navegador --porta 8799
    python -m unittest discover -s tests -v

Não há build nem dependências: Python 3.9+ (só biblioteca padrão) e JavaScript puro no navegador.

## Estrutura

- `server.py` — servidor HTTP (ThreadingHTTPServer), API `/api/*`, SQLite em `dados/rota.db`, chamadas de IA (Anthropic ou Ollama).
- `static/index.html` — casca da página.
- `static/app.js` — todo o front: estado global `S`, `render()` gera HTML por string, eventos por delegação via `data-act`.
- `static/app.css` — tokens gerados (preset clean, índigo) em `:root` com tema escuro e alternador manual (`data-theme`); fontes locais em `static/fonts/`. Decisões visuais em `.design/style.md`.
- `static/vendor/` — pdf.js 3.11.174 (leitura de PDF no navegador). Não trocar por CDN.
- `tests/` — testes da API com um Ollama falso.
- `dados/` — banco do usuário. Nunca versionar (está no `.gitignore`).

## Regras do projeto

1. **Offline primeiro.** Nada de CDN, fontes remotas ou chamadas externas no front. A única saída para a internet é a API da Anthropic, feita pelo `server.py`.
2. **Sem dependências.** Servidor só com a biblioteca padrão; front sem framework e sem bundler. Se algo parecer exigir uma biblioteca, pergunte antes.
3. **Dados do usuário são sagrados.** Mudanças no formato do edital ou do conteúdo precisam ser compatíveis com bancos e backups antigos (campos novos opcionais, com valor padrão no código).
4. **QConcursos:** o app não acessa a conta do usuário nem extrai conteúdo da plataforma (termos de uso). O desempenho de lá entra só por registro manual (`t.qc`).
5. **Escape tudo** que vem de IA, PDF ou usuário com `esc()` antes de entrar no HTML.
6. Ao mudar a API, atualize `tests/test_api.py` e rode os testes.

## API (server.py)

| Método e rota | Uso |
|---|---|
| `GET /api/status` | provedor de IA, modelo, chave mascarada |
| `POST /api/config` | `{provedor, chave?, modelo_anthropic?, ollama_url?, modelo_ollama?}` |
| `POST /api/ia` | `{prompt, max_tokens}` → `{ok, dados}` (JSON já extraído) ou `{ok:false, code, message}` |
| `GET/PUT /api/ativo` | edital aberto |
| `GET /api/editais` | lista resumida |
| `GET/PUT/DELETE /api/editais/<id>` | edital completo (JSON) |
| `GET /api/conteudo/<ed>` | ids de tópicos com aula salva |
| `GET/PUT /api/conteudo/<ed>/<tid>` | aula de um tópico |
| `GET /api/materiais/<ed>` | materiais de apoio do edital (com `temArquivo`) |
| `PUT/DELETE /api/materiais/<ed>/<id>` | grava/apaga a descrição do material (apagar remove o PDF) |
| `PUT /api/materiais/<ed>/<id>/arquivo` | corpo bruto `application/pdf` (até 60 MB), salvo em `dados/materiais/<ed>/<id>.pdf` |
| `GET /materiais/<ed>/<id>.pdf` | serve o PDF local (abre no leitor do navegador; use `#page=N`) |
| `GET/POST /api/backup` | exporta tudo / importa backup ou pacote (inclui a descrição dos materiais, não os PDFs) |

Importação com `"tipo": "pacote"` não sobrescreve um edital existente (preserva o progresso); só adiciona ou atualiza aulas.

## Modelo de dados

Edital (`S.ed`):

    {id, criado, orgao, banca, cargo, dataProva: "AAAA-MM-DD"|null, horas, estilo: "CE"|"ME", dicas,
     exemplo?: true, seEntao?: string, hojeMin?: {d, min}, cal?: {certeza|duvida|chute: {f, a}}, ativ?: {"AAAA-MM-DD": n},
     erros: [{id, tid, mid, enunciado, alternativas|null, marcada, gabarito, explicacao, em,
              conf?, sorte?: true, due?, ok?: 0-3, dom?: true, domEm?, ult?, tipo?: "conteudo"|"confusao"|"leitura"|"atencao", nota?}],
     materias: [{id: "m0", nome, questoes|null, topicos: [{
        id: "m0t0", nome, inc: "alta"|"media"|"baixa", st: "novo"|"estudado", em: data|null, iv?: dias,
        revs: [{due, feita, em?, reforco?}],
        q: {f, a},                         // questões feitas/acertadas no app
        qc?: {f, a, s: [{d, f, a}]},       // registro manual do QConcursos
        qcPulado?: true, qcFiltro?: string // filtro sugerido vindo do pacote
     }]}]}

Material de apoio (tabela `materiais`, um PDF local por material):

    {id, titulo, tipo: "edital"|"prova"|"gabarito"|"norma"|"lei"|"guia"|"livro"|"apostila"|"outro",
     fonte, url, licenca?, resumo?, arquivo: "<id>.pdf", paginas, tamanho, adicionado, proprio?: true,
     usos: [{tid|null, pag: "70-113"|null, quando: "estudo"|"questoes"|"revisao"|"consulta", nota, questoes?: [n]}],
     gab?: {id, pag}, respostas?: {"1": "A", …, "23": "*"},   // provas: gabarito oficial tipo 1 ("*" = anulada)
     simulados?: [{d, a, n}]}

Só baixe para `dados/materiais` material oficial ou de distribuição gratuita autorizada (bancas, CNJ, gov.br, W3C, OWASP, guias com licença aberta). Nada de apostilas de cursinho nem cópias não autorizadas.

Aula (conteúdo de um tópico): `{resumo (Markdown simples), pegadinhas: [str], porques?: [{p, r}], questoes: [{enunciado, alternativas?, gabarito, explicacao, origem?}], geradoEm}`.

## Lógica do plano (app.js)

- `fila()` — ordem dos tópicos novos por round-robin ponderado entre matérias (peso = nº de questões da matéria × 1,4 se acerto < 60%); dentro da matéria, incidência alta primeiro.
- `planoDia()` — orçamento em minutos do dia (`minutosHoje()`: `horas` ou o tempo escolhido só para hoje em `hojeMin`): revisões pendentes primeiro (15 min cada, as mais atrasadas antes), depois caderno de erros (~2 min por item, até 20), e tópicos novos em blocos de 50 min no que sobrar. Nas duas últimas semanas antes da prova ("reta final"), só entram tópicos novos de incidência alta.
- Revisões adaptativas: ao concluir o estudo, 1ª revisão no dia seguinte (`t.iv = 1`). A cada revisão concluída, o intervalo cresce ×2,5 (acerto ≥ 80%), ×1,8 (60–80%) ou ×2 (menos de 3 questões); abaixo de 60% com ≥ 3 questões volta para 2 dias (reforço). Limite de 60 dias e de metade dos dias até a prova (`limitarIntervalo`). Tópicos de bancos antigos com revisões 1/7/30 já agendadas seguem com elas até acabarem. Reforço de 3 dias pelo QConcursos (< 60% com ≥ 5 questões) continua.
- Estudo de tópico novo: as 2 primeiras questões são pré-teste ("Aquecimento", `nPre`), antes do resumo, e não contam no desempenho (`S.preQ`). Revisão: questões primeiro, resumo recolhido.
- Confiança (Certeza/Dúvida/Chute) antes de responder: alimenta `ed.cal`; erro com certeza fica em destaque no caderno; acerto no chute também entra no caderno.
- Caderno de erros (reaprendizagem sucessiva): refazer sem ver o gabarito; acerto → volta em 3, depois 7 dias; erro → amanhã; 3 acertos em dias diferentes → `dom`.
- Materiais (`vMatsTopico`): no estudo aparecem primeiro os trechos para aprofundar e o texto oficial; na revisão, primeiro as questões reais da banca. Provas trazem as questões de cada tópico e o gabarito oficial. A aba Materiais lista tudo, recebe PDFs do usuário e registra simulados. Com metade do edital estudada, ou na reta final, a aba Hoje sugere um simulado com prova real.
- Treino misto (`montarTreino`): 10 questões intercaladas de tópicos estudados com aula salva, com peso maior para acerto < 60%, incidência alta e tempo desde a última revisão.
- Fundamentos: Dunlosky et al. 2013 (prática de testes e prática espaçada), Cepeda et al. 2008 (intervalo × prazo), Rawson & Dunlosky (reaprendizagem sucessiva), Butterfield & Metcalfe 2001 (hipercorreção), Brunmair & Richter 2019 (intercalação), Pan & Sana 2021 (pré-teste), Gollwitzer & Sheeran 2006 (planos se–então).
- Acerto = app + QConcursos (`qt(t)`).

## Ideias pendentes

- Modo simulado cronometrado na proporção do quadro de provas (o treino misto já tem cronômetro e ritmo de prova).
- Questões de provas anteriores reais no pacote, marcadas com `origem: "prova"` e exibidas com selo próprio.
- Cronômetro de sessão e horas líquidas por matéria.
