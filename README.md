# Rota do Edital

Envie o edital do concurso e o app monta tudo: edital verticalizado, plano diário em blocos de 50 minutos, resumo e pegadinhas de cada tópico, questões no estilo da banca, revisões em 1, 7 e 30 dias, desempenho por matéria e caderno de erros.

Roda no seu computador. Seus dados ficam em `dados/rota.db`, dentro desta pasta.

## 1. Instale o Python (uma vez só)

Precisa do Python 3.9 ou mais novo. Não há mais nada para instalar.

- **Windows:** baixe em https://www.python.org/downloads/ e, na instalação, marque **"Add python.exe to PATH"**.
- **macOS:** baixe no mesmo link, ou use `brew install python`.
- **Linux:** normalmente já vem instalado.

## 2. Abra o app

- **Windows:** dê dois cliques em `iniciar.bat`.
- **macOS / Linux:** no Terminal, dentro desta pasta, rode `./iniciar.sh`.

O navegador abre em **http://localhost:8765**. Deixe a janela preta aberta enquanto estuda; fechar a janela desliga o app.

## 3. Escolha a IA

Na primeira tela, em **Configurar IA**, escolha uma das opções.

**Claude pela API da Anthropic (precisa de internet, melhor qualidade).**
Crie uma chave em https://console.anthropic.com, em *API Keys*, e cole no app. A API é paga por uso e é cobrada à parte da assinatura do claude.ai. O modelo padrão é `claude-sonnet-5-5`; dá para trocar no mesmo lugar.

**Ollama (roda no seu computador, funciona sem internet).**
Instale o Ollama em https://ollama.com e baixe um modelo, por exemplo:

    ollama pull qwen2.5:14b

Modelos locais são mais fracos que o Claude, principalmente para ler editais longos, e precisam de um computador com bastante memória (16 GB de RAM ou mais para o modelo de 14b).

## Sem chave de API: importar um pacote

Você pode pedir ao Claude (no claude.ai) para processar o edital e gerar um **pacote**: um arquivo `.json` com as matérias, os tópicos, o plano e as aulas prontas. Na primeira tela do app, clique em **Importar pacote** e escolha o arquivo. O app funciona sem configurar IA e sem internet.

Se você importar outro pacote do mesmo edital (por exemplo, com mais aulas), seu progresso é mantido e só as aulas novas entram.

Formato do pacote, para referência:

    {
      "versao": 1,
      "tipo": "pacote",
      "editais": [{"id": "...", "dados": {
        "id": "...", "orgao": "...", "banca": "...", "cargo": "...",
        "dataProva": "AAAA-MM-DD" ou null, "horas": 3, "estilo": "CE" ou "ME",
        "dicas": "...", "erros": [],
        "materias": [{"id": "m0", "nome": "...", "questoes": 10, "topicos": [
          {"id": "m0t0", "nome": "...", "inc": "alta|media|baixa",
           "st": "novo", "em": null, "revs": [], "q": {"f": 0, "a": 0}}]}]}}],
      "conteudo": [{"ed": "<id do edital>", "tid": "m0t0", "dados": {
        "resumo": "Markdown", "pegadinhas": ["..."],
        "questoes": [{"enunciado": "...", "alternativas": ["..."] (só múltipla escolha),
                      "gabarito": "C|E ou A-E", "explicacao": "..."}]}}]
    }

## Questões do QConcursos

O app não acessa sua conta do QConcursos. Ele pergunta o seu desempenho e usa esses números no plano:

- **Em cada tópico**, a seção "No QConcursos" mostra um filtro sugerido (banca · disciplina · assunto), com botão para copiar, e um campo para registrar quantas questões você fez e quantas acertou.
- **Ao concluir um tópico ou uma revisão**, o app pergunta se você resolveu questões no QConcursos. Você registra ou conclui sem registrar.
- **Na aba Hoje**, tópicos estudados nos últimos 7 dias sem nenhum registro aparecem em "Lançar desempenho do QConcursos".

O acerto registrado soma com o das questões do app. Matérias com acerto baixo ganham mais tempo no plano, e um registro com menos de 60% de acerto (a partir de 5 questões) agenda uma revisão de reforço em 3 dias. A aba Desempenho mostra quantas questões vieram do QConcursos.

## Estudar offline

Tudo o que já foi gerado fica salvo e abre sem internet: plano, edital verticalizado, aulas, questões, desempenho e erros.

Para deixar o edital inteiro pronto antes de ficar sem conexão, vá em **Ajustes → Estudar sem internet → Salvar todas as aulas**. O app gera e guarda a aula de cada tópico, um por vez. Com a API da Anthropic isso consome créditos (é uma aula por tópico).

Sem internet e com a API da Anthropic, só não dá para gerar aulas novas nem enviar outro edital. Com o Ollama tudo funciona offline.

## Acessar pelo celular ou outro computador

- **Na mesma rede Wi-Fi:** abra `iniciar-na-rede.bat` (Windows) ou rode `./iniciar.sh --rede`. A janela mostra um endereço como `http://192.168.0.10:8765`; abra esse endereço no celular. O app não tem senha, então use isso só em redes de confiança, como a de casa.
- **De qualquer lugar pela internet:** a forma mais segura é instalar o Tailscale (https://tailscale.com) no computador e no celular e abrir o endereço do Tailscale do computador na porta 8765. Não recomendo abrir a porta no roteador, porque o app não tem login.

## Backup e outro computador

Em **Ajustes → Backup**, baixe um arquivo `.json` com todos os editais, progresso e aulas. Em outro computador, copie esta pasta, abra o app e use **Restaurar backup**. Também dá para copiar a pasta inteira, incluindo `dados/`.

## Opções do servidor

    python server.py --porta 9000       # outra porta
    python server.py --rede             # aceita outros aparelhos da rede
    python server.py --sem-navegador    # não abre o navegador sozinho

A chave da API também pode vir da variável de ambiente `ANTHROPIC_API_KEY`.

## Limites

- PDF escaneado (só imagem) não tem texto para ler. Nesse caso, cole o conteúdo programático no campo de texto.
- Resumos e questões são escritos pela IA, sem consulta a bancos de questões oficiais. Confira a redação atual da lei antes de memorizar detalhes.
- A incidência de cada tópico é uma estimativa da IA sobre o que a banca costuma cobrar.
