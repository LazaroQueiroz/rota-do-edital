# Rota do Edital

Envie o edital do concurso e o app monta tudo: edital verticalizado, plano diário em blocos de 50 minutos, resumo e pegadinhas de cada tópico, questões no estilo da banca, revisões espaçadas que se alongam conforme você acerta, treino misto de questões, desempenho por matéria (com confiança × acerto) e caderno de erros que você refaz até dominar.

Roda no seu computador. Seus dados ficam em `dados/rota.db`, dentro desta pasta.

## Como o app organiza o estudo

As escolhas seguem o que a pesquisa em aprendizagem mostra que funciona para quem tem pouco tempo:

- **Prática de testes e revisão espaçada** (Dunlosky et al., 2013; Cepeda et al., 2008): revisões que se espaçam conforme você acerta, sempre começando pelas questões.
- **Pré-teste** (Pan & Sana, 2021): duas questões de aquecimento antes de ler o resumo de um tópico novo.
- **Reaprendizagem sucessiva** (Rawson & Dunlosky): o caderno de erros pede para refazer cada questão sem ver o gabarito, até acertar em três dias diferentes.
- **Confiança antes de responder** (hipercorreção, Butterfield & Metcalfe, 2001): erros cometidos com certeza ficam em destaque.
- **Prática intercalada** (Brunmair & Richter, 2019): treino misto com questões de vários tópicos.
- **Planos se–então** (Gollwitzer & Sheeran, 2006): um compromisso de quando e onde estudar, mostrado na aba Hoje.

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

## Materiais de apoio (PDFs)

Cada tópico pode ter PDFs ligados a ele: provas anteriores da banca (com as questões daquele assunto e o gabarito oficial), leis, normas do CNJ, guias oficiais e livros gratuitos. A aula mostra **onde** (páginas) e **quando** usar cada um: aprofundar depois do resumo, questões reais na revisão ou texto oficial para consulta.

Os arquivos ficam em `dados/materiais/<edital>/` e abrem no leitor de PDF do navegador, sem internet. Na aba **Materiais** você pode adicionar seus próprios PDFs e registrar o resultado de simulados.

O backup em `.json` leva só a descrição dos materiais. Para levar os PDFs a outro computador, copie também a pasta `dados/materiais`.

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

## App Android (sincronizado com o PC)

O app Android (pasta `android/`) é nativo: guarda edital, progresso, aulas e PDFs no celular, funciona sem internet e sincroniza com o PC pelo Wi-Fi de casa. O que você estudar em qualquer um dos dois é **mesclado**, sem perder nada: as questões dos dois lados somam, um tópico estudado continua estudado, as revisões feitas continuam feitas e os erros entram no mesmo caderno.

1. No PC, abra o app em modo rede: `iniciar-na-rede.bat` (Windows) ou `./iniciar.sh --rede`.
2. No PC, vá em **Ajustes → Celular** e anote o endereço (ex.: `192.168.0.10:8765`) e o código de 6 letras.
3. No celular, abra o Rota do Edital, digite o endereço e o código e toque em **Conectar e sincronizar**.

Na primeira vez vêm o edital, as aulas e depois os PDFs (cerca de 76 MB no edital do TJPB), em segundo plano. Depois disso o app sincroniza sozinho ao abrir, pouco depois de cada estudo e a cada hora, sempre em Wi-Fi. O código só serve para parear: cada aparelho recebe uma chave própria, guardada cifrada no Android Keystore, e você pode desconectá-lo em **Ajustes → Celular** no PC.

Para instalar a partir do código (precisa do Android SDK e do JDK 17):

    cd android
    ./gradlew assembleRelease
    adb install -r app/build/outputs/apk/release/app-release.apk

Gerar aulas e ler editais novos continua no PC, porque usa a IA configurada lá.

## Acessar pelo navegador de outro aparelho

Com o PC em modo rede, abra no navegador o endereço mostrado (ex.: `http://192.168.0.10:8765`). Na primeira vez o app pede o código de pareamento. Use só em redes de confiança, como a de casa. Para acessar de fora de casa, prefira o Tailscale (https://tailscale.com) a abrir portas no roteador.

## Backup e outro computador

Em **Ajustes → Backup**, baixe um arquivo `.json` com todos os editais, progresso e aulas. Em outro computador, copie esta pasta, abra o app e use **Restaurar backup**. Também dá para copiar a pasta inteira, incluindo `dados/`.

## Opções do servidor

    python backend/server.py --porta 9000       # outra porta
    python backend/server.py --rede             # aceita outros aparelhos da rede (celular)
    python backend/server.py --sem-navegador    # não abre o navegador sozinho

A chave da API também pode vir da variável de ambiente `ANTHROPIC_API_KEY`.

## Limites

- PDF escaneado (só imagem) não tem texto para ler. Nesse caso, cole o conteúdo programático no campo de texto.
- Resumos e questões das aulas são escritos pela IA. As questões reais ficam nas provas anteriores da aba Materiais. Confira a redação atual da lei antes de memorizar detalhes.
- A incidência de cada tópico é uma estimativa da IA sobre o que a banca costuma cobrar.

## Estrutura do projeto

    backend/           servidor local (só biblioteca padrão do Python), API /v1, SQLite e mesclagem
    backend/tests/     testes da API (com um Ollama falso) e da mesclagem
    web/               interface do PC: index.html, app.js, app.css, fontes e pdf.js
    android/           app Android nativo (Kotlin, Jetpack Compose, Material 3)
    contract/          openapi.yaml (contrato da API) e tokens.json (cores, tipos, espaços)
    dados/             seu banco e seus PDFs (fora do git)
    .design/style.md   decisões visuais (cores, fontes, densidade)
    iniciar.*          atalhos para abrir o app no Windows, macOS e Linux

## Testes

    cd backend && python -m unittest discover -s tests -v
    cd android && ./gradlew testDebugUnitTest

## Licença

[MIT](LICENSE).
