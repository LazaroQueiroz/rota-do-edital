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
- `static/app.css` — tokens de cor em `:root` com tema escuro; fontes locais em `static/fonts/`.
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
| `GET/POST /api/backup` | exporta tudo / importa backup ou pacote |

Importação com `"tipo": "pacote"` não sobrescreve um edital existente (preserva o progresso); só adiciona ou atualiza aulas.

## Modelo de dados

Edital (`S.ed`):

    {id, criado, orgao, banca, cargo, dataProva: "AAAA-MM-DD"|null, horas, estilo: "CE"|"ME", dicas,
     exemplo?: true, erros: [{id, tid, mid, enunciado, alternativas|null, marcada, gabarito, explicacao, em}],
     materias: [{id: "m0", nome, questoes|null, topicos: [{
        id: "m0t0", nome, inc: "alta"|"media"|"baixa", st: "novo"|"estudado", em: data|null,
        revs: [{due, feita, em?, reforco?}],
        q: {f, a},                         // questões feitas/acertadas no app
        qc?: {f, a, s: [{d, f, a}]},       // registro manual do QConcursos
        qcPulado?: true, qcFiltro?: string // filtro sugerido vindo do pacote
     }]}]}

Aula (conteúdo de um tópico): `{resumo (Markdown simples), pegadinhas: [str], questoes: [{enunciado, alternativas?, gabarito, explicacao, origem?}], geradoEm}`.

## Lógica do plano (app.js)

- `fila()` — ordem dos tópicos novos por round-robin ponderado entre matérias (peso = nº de questões da matéria × 1,4 se acerto < 60%); dentro da matéria, incidência alta primeiro.
- Blocos por dia = `horas × 60 / 50`; revisões pendentes descontam 15 min cada.
- Revisões em 1, 7 e 30 dias ao concluir; reforço em 2 dias (acerto < 60% com ≥ 3 questões) ou 3 dias (registro do QConcursos < 60% com ≥ 5 questões, ou revisão ruim).
- Acerto = app + QConcursos (`qt(t)`).

## Ideias pendentes

- Modo simulado cronometrado na proporção do quadro de provas.
- Questões de provas anteriores reais no pacote, marcadas com `origem: "prova"` e exibidas com selo próprio.
- Cronômetro de sessão e horas líquidas por matéria.
