"use strict";
/* Rota do Edital — app local. Conversa com server.py pela API /api/*. */

/* ---------- utilidades ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const pad = n => String(n).padStart(2, "0");
const isoDe = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const hoje = () => isoDe(new Date());
const dataDe = iso => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
const addDias = (iso, n) => { const d = dataDe(iso); d.setDate(d.getDate() + n); return isoDe(d); };
const diasEntre = (a, b) => Math.round((dataDe(b) - dataDe(a)) / 864e5);
const fmtData = iso => dataDe(iso).toLocaleDateString("pt-BR", {day: "2-digit", month: "short", year: "numeric"});
const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
const uid = () => Math.random().toString(36).slice(2, 10);
const INC_RANK = {alta: 0, media: 1, baixa: 2};
const INC_TXT = {alta: "Incidência alta", media: "Incidência média", baixa: "Incidência baixa"};
let toastT;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 4200); }
function md(s) {
  const lines = esc(s).split(/\n/); let h = "", ul = false;
  const inl = x => x.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/(^|\s)_(.+?)_(?=\s|$|[.,;:])/g, "$1<em>$2</em>");
  for (let l of lines) {
    l = l.trimEnd();
    if (/^#{1,5}\s/.test(l)) { if (ul) { h += "</ul>"; ul = false; } h += "<h3>" + inl(l.replace(/^#+\s/, "")) + "</h3>"; }
    else if (/^\s*([-*•]|\d+[.)])\s+/.test(l)) { if (!ul) { h += "<ul>"; ul = true; } h += "<li>" + inl(l.replace(/^\s*([-*•]|\d+[.)])\s+/, "")) + "</li>"; }
    else if (!l.trim()) { if (ul) { h += "</ul>"; ul = false; } }
    else { if (ul) { h += "</ul>"; ul = false; } h += "<p>" + inl(l) + "</p>"; }
  }
  if (ul) h += "</ul>"; return h;
}

/* ---------- API do servidor local ---------- */
async function api(metodo, caminho, corpo) {
  let r;
  try {
    r = await fetch("/api/" + caminho, {method: metodo, headers: corpo !== undefined ? {"content-type": "application/json"} : {}, body: corpo !== undefined ? JSON.stringify(corpo) : undefined});
  } catch (e) { throw {code: "servidor", message: "O servidor local não respondeu. Confira se a janela do Rota do Edital ainda está aberta."}; }
  const d = await r.json().catch(() => null);
  if (!r.ok) { if (r.status === 404 && caminho.startsWith("conteudo/")) return null; throw {code: (d && d.code) || "servidor", message: (d && (d.message || d.erro)) || "Erro " + r.status}; }
  return d;
}
async function ia(prompt, maxTokens) {
  const d = await api("POST", "ia", {prompt, max_tokens: maxTokens || 8000});
  if (!d || !d.ok) throw {code: d && d.code, message: d && d.message};
  return d.dados;
}
const erroTxt = e => (e && e.message) || "Algo falhou. Tente de novo.";

/* ---------- estado ---------- */
const S = {ready: false, ed: null, view: "hoje", topic: null, iaStatus: null, online: navigator.onLine, lista: [],
  file: null, colado: "", horas: 3, dataProva: "", pipe: null, content: {}, temAula: new Set(), gen: {}, resp: {},
  confirmTroca: false, pre: null, cfgAberta: false, concluindo: null,
  conf: {},            // confiança escolhida antes de responder: "tid:qi" -> "certeza"|"duvida"|"chute"
  preQ: new Set(),     // questões respondidas como pré-teste (não contam no desempenho)
  treino: null,        // treino misto em andamento
  errView: null, errResp: {}, errDel: null,
  mats: [],            // materiais de apoio (PDFs) do edital aberto
  matFiltro: "todos", matForm: false, matDel: null, gabVer: {}};

/* ---------- tema (preferência só deste navegador) ---------- */
const TEMAS = ["sistema", "claro", "escuro"];
let tema = "sistema";
try { tema = localStorage.getItem("rota-tema") || "sistema"; } catch (e) {}
function aplicarTema() {
  const r = document.documentElement;
  if (tema === "claro") r.dataset.theme = "light"; else if (tema === "escuro") r.dataset.theme = "dark"; else delete r.dataset.theme;
}
aplicarTema();
const ICO_TEMA = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 1.75a6.25 6.25 0 0 1 0 12.5z" fill="currentColor"/></svg>';
const btnTema = () => `<button class="ghost small" data-act="tema" title="Alternar entre tema do sistema, claro e escuro">${ICO_TEMA}<span>${tema === "sistema" ? "Tema do sistema" : tema === "claro" ? "Tema claro" : "Tema escuro"}</span></button>`;

/* ---------- persistência ---------- */
let saveT = null, saving = false, dirty = false;
function save() { dirty = true; clearTimeout(saveT); saveT = setTimeout(flush, 500); }
async function flush() {
  if (saving || !dirty || !S.ed) return; saving = true; dirty = false;
  try { await api("PUT", "editais/" + S.ed.id, S.ed); }
  catch (e) { toast(erroTxt(e)); dirty = true; }
  saving = false; if (dirty) setTimeout(flush, 1500);
}
async function getContent(tid) {
  if (S.content[tid]) return S.content[tid];
  try { const c = await api("GET", `conteudo/${S.ed.id}/${tid}`); if (c) { S.content[tid] = c; S.temAula.add(tid); return c; } } catch (e) {}
  return null;
}
async function putContent(tid) {
  const c = S.content[tid]; if (!c) return;
  try { await api("PUT", `conteudo/${S.ed.id}/${tid}`, c); S.temAula.add(tid); } catch (e) { toast(erroTxt(e)); }
}
async function abrirEdital(id) {
  const e = await api("GET", "editais/" + id).catch(() => null);
  if (!e) { toast("Não encontrei esse edital."); return; }
  S.ed = e; S.content = {}; S.resp = {}; S.gen = {}; S.topic = null; S.view = "hoje"; S.treino = null; S.conf = {}; S.preQ = new Set(); S.errResp = {}; S.errView = null;
  const ids = await api("GET", "conteudo/" + id).catch(() => []);
  S.temAula = new Set(ids || []);
  await carregarMats();
  await api("PUT", "ativo", {id}).catch(() => {});
  render();
}
async function carregarMats() {
  S.mats = S.ed ? (await api("GET", "materiais/" + S.ed.id).catch(() => [])) || [] : [];
}
async function carregarStatus() { S.iaStatus = await api("GET", "status").catch(() => null); }

async function init() {
  render();
  await carregarStatus();
  const a = await api("GET", "ativo").catch(() => null);
  S.lista = await api("GET", "editais").catch(() => []);
  S.ready = true;
  const h0 = location.hash;
  if (a && a.id) { await abrirEdital(a.id); if (h0) { history.replaceState(null, "", h0); aplicarHash(); } } else render();
}
window.addEventListener("online", () => { S.online = true; render(); });
window.addEventListener("offline", () => { S.online = false; render(); });

/* ---------- leitura do edital ---------- */
async function lerArquivo(file) {
  if (/\.txt$/i.test(file.name) || file.type === "text/plain") return {texto: await file.text(), paginas: null};
  if (!window.pdfjsLib) throw new Error("O leitor de PDF não carregou. Cole o texto do edital no campo de texto.");
  pdfjsLib.GlobalWorkerOptions.workerSrc = "/vendor/pdf.worker.min.js";
  const pdf = await pdfjsLib.getDocument({data: await file.arrayBuffer()}).promise;
  let out = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const pg = await pdf.getPage(i); const tc = await pg.getTextContent();
    out += tc.items.map(it => it.str + (it.hasEOL ? "\n" : " ")).join("") + "\n";
    if (i % 10 === 0) setInfo(0, `Lendo página ${i} de ${pdf.numPages}…`);
  }
  return {texto: out.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n"), paginas: pdf.numPages};
}
function recortarConteudo(t) {
  const MAX = 150000; if (t.length <= MAX) return t;
  const re = /conte[úu]dos?\s+program[áa]ticos?|conhecimentos\s+(b[áa]sicos|gerais|espec[íi]ficos)|objetos?\s+de\s+avalia[çc][ãa]o/gi;
  let m, pos = -1; while ((m = re.exec(t))) { if (m.index > 15000) { pos = m.index; break; } }
  if (pos < 0) return t.slice(0, MAX);
  return t.slice(0, 14000) + "\n[...]\n" + t.slice(pos, pos + MAX - 14000);
}
const recortarMeta = t => t.length <= 60000 ? t : t.slice(0, 48000) + "\n[...]\n" + t.slice(-10000);

/* ---------- pipeline automático ---------- */
const PASSOS = ["Ler o edital", "Identificar órgão, banca, cargos e data da prova", "Extrair matérias e tópicos do conteúdo programático", "Montar o plano de estudos e as revisões", "Preparar sua primeira aula"];
function setStep(i, st, info) { S.pipe.steps[i].st = st; if (info !== undefined) S.pipe.steps[i].info = info; S.pipe.steps[i].desde = st === "run" ? Date.now() : null; render(); }
function setInfo(i, info) { if (S.pipe) { S.pipe.steps[i].info = info; render(); } }
async function iniciar() {
  if (!S.iaStatus || !S.iaStatus.provedor) { toast("Configure a IA primeiro (logo abaixo). Sem ela não dá para ler e organizar o edital."); S.cfgAberta = true; render(); return; }
  if (!S.file && S.colado.trim().length < 300) { toast("Envie o PDF do edital ou cole o texto dele."); return; }
  S.pipe = {steps: PASSOS.map(t => ({t, st: "wait", info: ""})), cargos: null}; render();
  let texto, paginas;
  try {
    setStep(0, "run");
    if (S.file) { const r = await lerArquivo(S.file); texto = r.texto; paginas = r.paginas; } else texto = S.colado;
    if (texto.replace(/\s/g, "").length < 400) throw new Error("Não encontrei texto nesse arquivo. Se for um PDF escaneado (imagem), copie o conteúdo programático e cole no campo de texto.");
    setStep(0, "ok", (paginas ? paginas + " páginas · " : "") + texto.length.toLocaleString("pt-BR") + " caracteres");
  } catch (e) { return falhar(0, e.message || String(e)); }
  let meta;
  try {
    setStep(1, "run", "Lendo regras, cargos e cronograma…");
    meta = await ia(
`Abaixo está o texto (possivelmente com trechos omitidos) de um edital de concurso público brasileiro.
Extraia as informações e responda APENAS com um objeto JSON neste formato:
{"orgao": "nome curto do órgão", "banca": "nome da banca organizadora ou null", "cargos": ["nome de cada cargo/especialidade que tenha conteúdo programático próprio, exatamente como no edital"], "data_prova": "AAAA-MM-DD da prova objetiva, ou null se não houver", "estilo": "CE" se as provas são de itens Certo/Errado (típico do Cebraspe/Cespe) ou "ME" se são de múltipla escolha}

TEXTO DO EDITAL:
${recortarMeta(texto)}`, 4000);
    if (!meta || !Array.isArray(meta.cargos)) throw {message: "A IA não devolveu os dados do edital no formato esperado. Tente de novo."};
    meta.cargos = meta.cargos.map(String).filter(Boolean);
    setStep(1, "ok", [meta.orgao, meta.banca, meta.cargos.length + " cargo(s)", meta.data_prova ? "prova em " + fmtData(meta.data_prova) : "data da prova não informada"].filter(Boolean).join(" · "));
  } catch (e) { return falhar(1, erroTxt(e)); }
  let cargo = meta.cargos[0] || "Cargo do edital";
  if (meta.cargos.length > 1) {
    S.pipe.cargos = meta.cargos; S.pipe.filtro = ""; render();
    cargo = await new Promise(res => S.pipe.escolher = res);
    S.pipe.cargos = null;
  }
  let est;
  try {
    setStep(2, "run", "Isso costuma levar de 30 segundos a 2 minutos.");
    est = await ia(
`Você organiza editais de concursos públicos brasileiros. Do edital abaixo, extraia o conteúdo programático completo do cargo "${cargo}", incluindo os conhecimentos básicos/gerais comuns a todos os cargos e os conhecimentos específicos deste cargo.
Responda APENAS com um objeto JSON:
{"materias":[{"nome":"nome da disciplina","questoes": número de questões (ou pontos) da disciplina no quadro de provas deste cargo, ou null se não informado,"topicos":[{"nome":"tópico curto e autoexplicativo, até 140 caracteres","inc":"alta" | "media" | "baixa"}]}],
"dicas":"3 a 5 frases objetivas sobre o estilo da banca ${meta.banca || "organizadora"} e como estudar para esta prova"}
Regras: mantenha a ordem do edital; divida itens longos em tópicos estudáveis e agrupe subitens muito pequenos (no máximo 35 tópicos por disciplina); "inc" é sua estimativa de quanto o assunto costuma ser cobrado por essa banca; não invente disciplinas que não estão no edital.

TEXTO DO EDITAL:
${recortarConteudo(texto)}`, 16000);
    if (!est || !Array.isArray(est.materias) || !est.materias.length) throw {message: "A IA não devolveu as matérias no formato esperado. Tente de novo."};
  } catch (e) { return falhar(2, erroTxt(e)); }
  const materias = est.materias.filter(m => m && m.nome && Array.isArray(m.topicos) && m.topicos.length).map((m, i) => ({
    id: "m" + i, nome: String(m.nome).slice(0, 120), questoes: Number(m.questoes) > 0 ? Number(m.questoes) : null,
    topicos: m.topicos.map((t, j) => ({id: `m${i}t${j}`, nome: String((t && t.nome) || t).slice(0, 220), inc: INC_RANK[t && t.inc] !== undefined ? t.inc : "media", st: "novo", em: null, revs: [], q: {f: 0, a: 0}}))}));
  const total = materias.reduce((s, m) => s + m.topicos.length, 0);
  setStep(2, "ok", `${materias.length} matérias · ${total} tópicos`);
  setStep(3, "run");
  S.ed = {id: uid(), criado: hoje(), orgao: meta.orgao || "Concurso", banca: meta.banca || "", cargo,
    dataProva: S.dataProva || (/^\d{4}-\d{2}-\d{2}$/.test(meta.data_prova || "") ? meta.data_prova : null),
    horas: Number(S.horas) || 3, estilo: meta.estilo === "CE" ? "CE" : "ME", dicas: String(est.dicas || ""), materias, erros: []};
  S.content = {}; S.resp = {}; S.gen = {}; S.temAula = new Set();
  dirty = true; await flush(); await api("PUT", "ativo", {id: S.ed.id}).catch(() => {});
  const dias = S.ed.dataProva ? diasEntre(hoje(), S.ed.dataProva) : null;
  setStep(3, "ok", `${blocosDia()} blocos de 50 min por dia` + (dias !== null ? ` · ${dias} dias até a prova` : ""));
  setStep(4, "run");
  const primeiro = fila()[0];
  if (primeiro) gerarConteudo(primeiro.t, primeiro.m).catch(() => {});
  setTimeout(() => { setStep(4, "ok"); S.pipe = null; S.view = "hoje"; render(); toast("Plano pronto. Comece pelo primeiro tópico de hoje."); }, 600);
}
function falhar(i, msg) { setStep(i, "err", msg); S.pipe.falhou = true; render(); }

/* ---------- plano ---------- */
const blocosDia = () => Math.max(1, Math.floor((S.ed.horas || 3) * 60 / 50));
const qt = t => ({f: t.q.f + ((t.qc && t.qc.f) || 0), a: t.q.a + ((t.qc && t.qc.a) || 0)});
function txtQ(t) { const T = qt(t); if (!T.f) return "sem questões feitas"; return `${T.a}/${T.f} acertos` + (t.qc && t.qc.f ? ` (QConcursos ${t.qc.a}/${t.qc.f})` : ""); }
function accMat(m) { let f = 0, a = 0; m.topicos.forEach(t => { const T = qt(t); f += T.f; a += T.a; }); return f ? a / f : null; }
const accTop = t => { const T = qt(t); return T.f ? T.a / T.f : null; };
function pesoMat(m) { const acc = accMat(m); return (m.questoes || 1) * (acc !== null && acc < .6 ? 1.4 : 1); }
function fila() {
  const ms = S.ed.materias.map(m => ({m, w: pesoMat(m), cur: 0, pend: m.topicos.map((t, i) => ({t, i})).filter(x => x.t.st === "novo").sort((a, b) => INC_RANK[a.t.inc] - INC_RANK[b.t.inc] || a.i - b.i).map(x => x.t)})).filter(x => x.pend.length);
  const out = []; let rest = ms.reduce((s, x) => s + x.pend.length, 0);
  while (rest > 0) {
    let best = null, sw = 0;
    for (const x of ms) { if (!x.pend.length) continue; x.cur += x.w; sw += x.w; if (!best || x.cur > best.cur) best = x; }
    best.cur -= sw; out.push({m: best.m, t: best.pend.shift()}); rest--;
  }
  return out;
}
function revisoesPendentes() {
  const h = hoje(), out = [];
  S.ed.materias.forEach(m => m.topicos.forEach(t => { const r = t.revs.find(r => !r.feita && r.due <= h); if (r) out.push({m, t, r, atraso: diasEntre(r.due, h)}); }));
  return out.sort((a, b) => b.atraso - a.atraso);
}
function achar(tid) { for (const m of S.ed.materias) for (const t of m.topicos) if (t.id === tid) return {m, t}; return null; }
/* Revisões com intervalos crescentes (prática espaçada + reaprendizagem sucessiva):
   1ª revisão no dia seguinte; depois o intervalo cresce ×2,5 se o acerto da revisão foi ≥ 80%,
   ×1,8 se ficou entre 60% e 80%, e volta para 2 dias se ficou abaixo de 60%.
   Com data de prova, nenhum intervalo passa da metade do tempo restante, para a última revisão cair perto da prova. */
function limitarIntervalo(d) {
  d = Math.max(1, Math.min(60, Math.round(d)));
  const dp = S.ed.dataProva ? diasEntre(hoje(), S.ed.dataProva) : null;
  if (dp !== null && dp > 1) d = Math.min(d, Math.max(1, Math.floor(dp / 2)));
  return d;
}
function agendarRevisoes(t) {
  t.iv = 1; t.revs = [{due: addDias(hoje(), 1), feita: false}];
}
function proximaRevisao(t, acc, n) {
  if (t.revs.some(r => !r.feita)) return null;   // bancos antigos: já há revisões agendadas
  let iv = t.iv || 1, reforco = false;
  if (n >= 3 && acc < .6) { iv = 2; reforco = true; t.iv = 1; }
  else { iv = iv * (n >= 3 ? (acc >= .8 ? 2.5 : 1.8) : 2); t.iv = iv; }
  const d = limitarIntervalo(iv);
  t.revs.push(reforco ? {due: addDias(hoje(), d), feita: false, reforco: true} : {due: addDias(hoje(), d), feita: false});
  return d;
}
const revsFeitas = t => t.revs.filter(r => r.feita).length;
/* registro de atividade diária (questões respondidas), para consistência no Desempenho */
function marcarAtiv() {
  const e = S.ed; e.ativ = e.ativ || {}; const h = hoje(); e.ativ[h] = (e.ativ[h] || 0) + 1;
  const ks = Object.keys(e.ativ).sort(); while (ks.length > 90) delete e.ativ[ks.shift()];
}
/* tempo disponível hoje (minutos) */
const minutosHoje = () => { const e = S.ed; return e.hojeMin && e.hojeMin.d === hoje() ? e.hojeMin.min : Math.round((e.horas || 3) * 60); };
/* caderno de erros: quando refazer cada item */
const errDue = x => x.due || addDias(x.em || hoje(), 1);
const errosParaHoje = () => S.ed.erros.filter(x => !x.dom && errDue(x) <= hoje());

/* ---------- geração de conteúdo ---------- */
function formatoQuestoes(n) {
  return S.ed.estilo === "CE"
    ? `${n} itens no estilo Cebraspe (julgue Certo ou Errado). Cada item: {"enunciado":"afirmação a ser julgada, podendo ter um breve texto-base antes","gabarito":"C" ou "E","explicacao":"1 a 3 frases dizendo por que está certo ou errado"}. Equilibre itens certos e errados.`
    : `${n} questões de múltipla escolha no estilo da banca ${S.ed.banca || "organizadora"}. Cada questão: {"enunciado":"...","alternativas":["texto A","texto B","texto C","texto D","texto E"],"gabarito":"letra correta, de A a E","explicacao":"1 a 3 frases justificando a correta e apontando o erro da alternativa mais tentadora"}. Não escreva as letras dentro do texto das alternativas.`;
}
const contexto = (m, t) => `Concurso: ${S.ed.orgao} — cargo ${S.ed.cargo}${S.ed.banca ? " — banca " + S.ed.banca : ""}.\nDisciplina: ${m.nome}.\nTópico do edital: "${t.nome}".`;
async function gerarConteudo(t, m, refazer) {
  if (S.gen[t.id] && S.gen[t.id].run) return;
  if (!refazer) { const c = await getContent(t.id); if (c) { render(); return; } }
  if (!S.iaStatus || !S.iaStatus.provedor) { S.gen[t.id] = {err: "Esta aula ainda não foi gerada e não há IA configurada. Configure em Ajustes."}; render(); return; }
  S.gen[t.id] = {run: true, desde: Date.now()}; render();
  try {
    const r = await ia(
`Você é professor de cursinho preparatório para concursos públicos no Brasil.
${contexto(m, t)}
Produza material de estudo em português do Brasil e responda APENAS com um objeto JSON:
{"resumo":"Markdown simples (use ### para subtítulos, - para listas e **negrito**), de 350 a 550 palavras, direto ao ponto, citando artigos de lei, súmulas e entendimentos quando cabíveis. Organize por ideias (não por parágrafos corridos), dê um exemplo concreto quando ajudar, aponte o que a banca mais cobra e termine com a seção ### Para lembrar, com 3 a 5 itens curtos. Se o tema depende de legislação que pode ter mudado recentemente, diga ao aluno para conferir a redação vigente.",
"pegadinhas":["3 a 5 frases curtas com armadilhas típicas da banca neste tópico"],
"porques":[2 ou 3 objetos {"p":"pergunta começando com Por que… ou Qual a diferença entre…, que obrigue o aluno a explicar a lógica do tópico","r":"resposta em 1 a 3 frases"}],
"questoes":[${formatoQuestoes(6)}]}
As questões devem ser inéditas, ir do nível fácil ao difícil e cobrar o que a banca costuma cobrar neste tópico. Não repita a mesma ideia em duas questões.`, 9000);
    if (!r || typeof r.resumo !== "string" || !Array.isArray(r.questoes)) throw {message: "A aula veio em formato inesperado. Tente de novo."};
    S.content[t.id] = {resumo: r.resumo, pegadinhas: (r.pegadinhas || []).map(String).slice(0, 6), porques: limparPorques(r.porques), questoes: limparQuestoes(r.questoes), geradoEm: hoje()};
    S.resp[t.id] = {}; S.gen[t.id] = null; await putContent(t.id);
  } catch (e) { S.gen[t.id] = {err: erroTxt(e)}; render(); throw e; }
  render();
}
function limparPorques(ps) {
  return Array.isArray(ps) ? ps.filter(x => x && x.p && x.r).map(x => ({p: String(x.p).slice(0, 300), r: String(x.r).slice(0, 800)})).slice(0, 4) : [];
}
function limparQuestoes(qs) {
  return qs.filter(q => q && q.enunciado && q.gabarito).map(q => {
    const o = {enunciado: String(q.enunciado), gabarito: String(q.gabarito).trim().toUpperCase().slice(0, 1), explicacao: String(q.explicacao || "")};
    if (Array.isArray(q.alternativas) && q.alternativas.length >= 2) o.alternativas = q.alternativas.map(a => String(a).replace(/^\s*\(?[A-E][).:-]\s*/, "")).slice(0, 5);
    return o;
  });
}
async function maisQuestoes(t, m) {
  const c = S.content[t.id]; if (!c) return;
  const k = "q_" + t.id; if (S.gen[k] && S.gen[k].run) return;
  S.gen[k] = {run: true, desde: Date.now()}; render();
  try {
    const ja = c.questoes.map(q => "- " + q.enunciado.slice(0, 90)).join("\n");
    const r = await ia(
`Você é professor de cursinho preparatório para concursos públicos no Brasil.
${contexto(m, t)}
Crie novas questões inéditas, diferentes destas já usadas:
${ja}
Responda APENAS com um objeto JSON {"questoes":[${formatoQuestoes(5)}]}`, 6000);
    if (!r || !Array.isArray(r.questoes)) throw {message: "As questões vieram em formato inesperado. Tente de novo."};
    c.questoes = c.questoes.concat(limparQuestoes(r.questoes)).slice(-40);
    S.gen[k] = null; await putContent(t.id);
  } catch (e) { S.gen[k] = {err: erroTxt(e)}; }
  render();
}

/* pré-geração para estudar offline */
async function preGerar() {
  if (S.pre && S.pre.run) return;
  const ordem = [...S.ed.materias.flatMap(m => m.topicos.filter(t => t.st !== "novo").map(t => ({m, t}))), ...fila()];
  const falta = ordem.filter(x => !S.temAula.has(x.t.id));
  if (!falta.length) { toast("Todas as aulas deste edital já estão salvas."); return; }
  S.pre = {run: true, feitos: 0, total: falta.length, parar: false, erro: null}; render();
  for (const x of falta) {
    if (S.pre.parar) break;
    try { await gerarConteudo(x.t, x.m); S.pre.feitos++; }
    catch (e) { S.pre.erro = erroTxt(e); break; }
    render();
  }
  S.pre.run = false; render();
  if (!S.pre.erro && !S.pre.parar) toast("Aulas salvas. Você pode estudar este edital sem internet.");
}

/* ---------- ações ---------- */
function abrirTopico(tid, modo) {
  const f = achar(tid); if (!f) return;
  S.concluindo = null;
  S.topic = {tid, modo: modo || (f.t.st === "novo" ? "estudo" : "revisao")}; render(); window.scrollTo(0, 0);
  gerarConteudo(f.t, f.m).catch(() => {});
  if (S.topic.modo === "estudo" && S.iaStatus && S.iaStatus.provedor) {
    const prox = fila().find(x => x.t.id !== tid);
    if (prox && !S.temAula.has(prox.t.id)) setTimeout(() => gerarConteudo(prox.t, prox.m).catch(() => {}), 1500);
  }
}
const CONF_TXT = {certeza: "Certeza", duvida: "Dúvida", chute: "Chute"};
function responder(tid, qi, op) {
  const f = achar(tid), c = S.content[tid]; if (!f || !c) return;
  S.resp[tid] = S.resp[tid] || {}; if (S.resp[tid][qi] !== undefined) return;
  const k = tid + ":" + qi, pre = S.preQ.has(k) || (S.topic && S.topic.tid === tid && S.topic.modo === "estudo" && f.t.st === "novo" && qi < nPre(c));
  S.resp[tid][qi] = op; const q = c.questoes[qi]; const certo = op === q.gabarito; const conf = S.conf[k];
  if (pre) { S.preQ.add(k); render(); return; }   // pré-teste: errar aqui faz parte, não entra nas estatísticas
  f.t.q.f++; if (certo) f.t.q.a++;
  if (conf) { const cal = S.ed.cal = S.ed.cal || {}; cal[conf] = cal[conf] || {f: 0, a: 0}; cal[conf].f++; if (certo) cal[conf].a++; }
  marcarAtiv();
  if (!certo || conf === "chute") {
    // erro, ou acerto no chute: vai para o caderno para ser refeito em dias diferentes
    const ja = S.ed.erros.find(x => !x.dom && x.enunciado === q.enunciado.slice(0, 1200));
    const base = {marcada: op, em: hoje(), due: addDias(hoje(), 1), ok: 0, conf: conf || undefined, sorte: certo || undefined};
    if (ja) Object.assign(ja, base);
    else S.ed.erros.unshift(Object.assign({id: uid(), tid, mid: f.m.id, enunciado: q.enunciado.slice(0, 1200), alternativas: q.alternativas || null, gabarito: q.gabarito, explicacao: q.explicacao.slice(0, 800)}, base));
    S.ed.erros = S.ed.erros.slice(0, 400);
    if (!certo && conf === "certeza") toast("Erro com certeza: leia a explicação com calma. É o tipo de erro que mais vale corrigir agora.");
  }
  save(); render();
}
/* nº de questões usadas como pré-teste no estudo de um tópico novo */
const nPre = c => c && c.questoes.length >= 4 ? 2 : 0;
function sessaoAcc(tid) {
  const c = S.content[tid]; const sess = Object.entries(S.resp[tid] || {}).filter(([i]) => !S.preQ.has(tid + ":" + i));
  if (!c || !sess.length) return {n: 0, acc: null};
  const ac = sess.filter(([i, o]) => c.questoes[i] && c.questoes[i].gabarito === o).length;
  return {n: sess.length, acc: ac / sess.length};
}
function concluirEstudo(tid) {
  const f = achar(tid); if (!f) return;
  if (f.t.st !== "novo" && f.t.em === hoje()) { S.topic = null; render(); window.scrollTo(0, 0); toast("Este tópico já foi concluído hoje."); return; }
  f.t.st = "estudado"; f.t.em = hoje(); agendarRevisoes(f.t); save();
  S.topic = null; render(); window.scrollTo(0, 0);
  toast("Primeira revisão amanhã. Os intervalos crescem conforme você acerta.");
}
function concluirRevisao(tid) {
  const f = achar(tid); if (!f) return;
  const r = f.t.revs.find(r => !r.feita && r.due <= hoje()) || f.t.revs.find(r => !r.feita);
  if (r) { r.feita = true; r.em = hoje(); }
  const {n, acc} = sessaoAcc(tid);
  let msg = "Revisão registrada.";
  if (n >= 3 && acc < .6 && f.t.revs.some(x => !x.feita) && !f.t.revs.some(x => !x.feita && x.due <= addDias(hoje(), 3))) {
    f.t.revs.push({due: addDias(hoje(), 3), feita: false, reforco: true}); f.t.revs.sort((a, b) => a.due < b.due ? -1 : 1);
    msg = "Acerto abaixo de 60%: reforço em 3 dias.";
  }
  const d = proximaRevisao(f.t, acc, n);
  if (d !== null) msg = n >= 3 && acc < .6 ? `Acerto abaixo de 60%: reforço em ${d} dias.` : `Próxima revisão em ${d} dia${d > 1 ? "s" : ""}.`;
  save(); S.topic = null; render(); window.scrollTo(0, 0); toast(msg);
}

/* ---------- treino misto (questões intercaladas de vários tópicos já estudados) ---------- */
async function montarTreino(n) {
  n = n || 10;
  const h = hoje(), cands = [];
  S.ed.materias.forEach(m => m.topicos.forEach(t => {
    if (t.st === "novo" || !S.temAula.has(t.id)) return;
    const acc = accTop(t), ult = [t.em, ...t.revs.filter(r => r.feita).map(r => r.em)].filter(Boolean).sort().pop() || h;
    const w = 1 + (acc !== null && acc < .6 ? 2 : 0) + (t.inc === "alta" ? 1 : 0) + Math.min(3, diasEntre(ult, h) / 7);
    cands.push({m, t, w});
  }));
  if (cands.length < 2) { toast("Estude pelo menos dois tópicos (com aula salva) para fazer um treino misto."); return; }
  S.treino = {carregando: true}; S.view = "treino"; S.topic = null; render(); window.scrollTo(0, 0);
  const escolhidos = []; const pool = cands.slice();
  while (pool.length && escolhidos.length < n) {
    const tot = pool.reduce((s, x) => s + x.w, 0); let r = Math.random() * tot, i = 0;
    while (r > pool[i].w && i < pool.length - 1) { r -= pool[i].w; i++; }
    escolhidos.push(pool.splice(i, 1)[0]);
  }
  const itens = [];
  for (let volta = 0; volta < 3 && itens.length < n; volta++) {
    for (const x of escolhidos) {
      if (itens.length >= n) break;
      const c = await getContent(x.t.id); if (!c) continue;
      const livres = c.questoes.map((q, i) => i).filter(i => !itens.some(it => it.tid === x.t.id && it.qi === i) && !(S.resp[x.t.id] && S.resp[x.t.id][i] !== undefined));
      if (!livres.length) continue;
      itens.push({tid: x.t.id, qi: livres[Math.floor(Math.random() * livres.length)]});
    }
  }
  if (!itens.length) { S.treino = null; S.view = "hoje"; render(); toast("Você já respondeu todas as questões salvas desses tópicos nesta sessão. Gere mais questões nos tópicos."); return; }
  for (let i = itens.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [itens[i], itens[j]] = [itens[j], itens[i]]; }
  S.treino = {itens, inicio: Date.now()}; render();
}
function treinoPlacar() {
  const T = S.treino; let resp = 0, ac = 0;
  T.itens.forEach(it => { const o = S.resp[it.tid] && S.resp[it.tid][it.qi]; if (o !== undefined) { resp++; if (S.content[it.tid].questoes[it.qi].gabarito === o) ac++; } });
  return {resp, ac, tot: T.itens.length};
}

/* ---------- caderno de erros: refazer em dias diferentes até acertar 3 vezes ---------- */
const ERR_PASSOS = [3, 7];   // depois do 1º acerto volta em 3 dias, do 2º em 7; o 3º acerto marca como dominado
function refazerErro(id, op) {
  const x = S.ed.erros.find(e => e.id === id); if (!x || S.errResp[id] !== undefined) return;
  S.errResp[id] = op; marcarAtiv();
  if (op === x.gabarito) {
    x.ok = (x.ok || 0) + 1;
    if (x.ok >= 3) { x.dom = true; x.domEm = hoje(); toast("Dominado: acertou em três dias diferentes."); }
    else x.due = addDias(hoje(), ERR_PASSOS[x.ok - 1]);
  } else { x.ok = 0; x.due = addDias(hoje(), 1); }
  x.ult = hoje(); save(); render();
}
const TIPOS_ERRO = {conteudo: "Não sabia o conteúdo", confusao: "Confundi conceitos", leitura: "Li errado / pegadinha", atencao: "Desatenção"};

function carregarExemplo() {
  const mk = (i, nome, q, tops) => ({id: "m" + i, nome, questoes: q, topicos: tops.map(([n, inc], j) => ({id: `m${i}t${j}`, nome: n, inc, st: "novo", em: null, revs: [], q: {f: 0, a: 0}}))});
  S.ed = {id: "exemplo", exemplo: true, criado: hoje(), orgao: "Tribunal Regional (exemplo fictício)", banca: "Cebraspe", cargo: "Técnico Judiciário — Área Administrativa", dataProva: addDias(hoje(), 90), horas: 3, estilo: "CE",
    dicas: "O Cebraspe cobra itens de Certo ou Errado e um item errado anula um certo. Leia cada afirmação procurando a palavra que a torna falsa. Lei seca e jurisprudência dos tribunais superiores aparecem com frequência.",
    materias: [
      mk(0, "Língua Portuguesa", 20, [["Compreensão e interpretação de textos", "alta"], ["Emprego dos sinais de pontuação", "alta"], ["Concordância verbal e nominal", "media"], ["Regência e crase", "media"], ["Reescrita de frases e parágrafos", "alta"]]),
      mk(1, "Direito Administrativo", 15, [["Atos administrativos: requisitos, atributos e extinção", "alta"], ["Poderes administrativos", "alta"], ["Licitações: Lei nº 14.133/2021", "alta"], ["Agentes públicos e regime da Lei nº 8.112/1990", "media"], ["Controle da administração pública", "baixa"]]),
      mk(2, "Direito Constitucional", 15, [["Direitos e garantias fundamentais (art. 5º)", "alta"], ["Organização do Poder Judiciário", "media"], ["Administração pública (arts. 37 a 41)", "alta"], ["Remédios constitucionais", "media"]]),
      mk(3, "Noções de Informática", 10, [["Segurança da informação e malwares", "alta"], ["Planilhas eletrônicas", "media"], ["Redes, internet e navegadores", "media"]])], erros: []};
  S.content = {}; S.resp = {}; S.gen = {}; S.temAula = new Set(); S.view = "hoje";
  dirty = true; flush(); api("PUT", "ativo", {id: "exemplo"}).catch(() => {});
  render(); toast("Exemplo carregado. A aula de cada tópico é gerada quando você abre.");
}
async function trocarEdital() {
  S.ed = null; S.topic = null; S.confirmTroca = false; S.content = {}; S.file = null; S.colado = ""; S.pre = null; S.treino = null; S.view = "hoje";
  await api("PUT", "ativo", {id: ""}).catch(() => {});
  S.lista = await api("GET", "editais").catch(() => []);
  render();
}
async function salvarIA() {
  const corpo = {provedor: $("#c-prov").value};
  if (corpo.provedor === "anthropic") { const ch = $("#c-chave").value.trim(); if (ch) corpo.chave = ch; corpo.modelo_anthropic = $("#c-mod-a").value.trim(); }
  if (corpo.provedor === "ollama") { corpo.ollama_url = $("#c-url").value.trim(); corpo.modelo_ollama = $("#c-mod-o").value.trim(); }
  try { await api("POST", "config", corpo); await carregarStatus(); S.cfgAberta = false; render(); toast("IA configurada."); }
  catch (e) { toast(erroTxt(e)); }
}
async function testarIA() {
  const b = $("#c-testar"); if (b) { b.disabled = true; b.textContent = "Testando…"; }
  try { const r = await ia('Responda apenas com o JSON {"ok": true}', 50); toast(r && r.ok ? "A IA respondeu. Tudo certo." : "A IA respondeu, mas em formato inesperado."); }
  catch (e) { toast(erroTxt(e)); }
  render();
}
async function importarBackup(file) {
  try {
    const dados = JSON.parse(await file.text());
    const r = await api("POST", "backup", dados);
    toast(r.pacote ? `Pacote importado: ${r.aulas} aula(s) prontas para estudar.` : `Backup restaurado: ${r.editais} edital(is) e ${r.aulas} aula(s).`);
    const a = await api("GET", "ativo").catch(() => null);
    S.lista = await api("GET", "editais").catch(() => []);
    if (a && a.id) await abrirEdital(a.id); else render();
  } catch (e) { toast(e.message ? erroTxt(e) : "Esse arquivo não é um backup válido."); }
}

/* ---------- renderização ---------- */
function render() {
  const app = $("#app");
  if (!S.ed) { app.innerHTML = S.pipe ? vPipe() : vEnvio(); return; }
  syncHash();
  app.innerHTML = vTopo() + (S.topic ? vTopico() : S.view === "treino" && S.treino ? vTreino() : S.view === "hoje" ? vHoje() : S.view === "edital" ? vEdital() : S.view === "desempenho" ? vDesempenho() : S.view === "erros" ? vErros() : S.view === "materiais" ? vMateriais() : vAjustes());
}
function chipIA() {
  const st = S.iaStatus;
  if (!st || !st.provedor) return `<span class="chip ia off">IA não configurada</span>`;
  if (st.provedor === "ollama") return `<span class="chip ia on">IA local · ${esc(st.modelo)}</span>`;
  return S.online ? `<span class="chip ia on">IA online · Claude</span>` : `<span class="chip ia off">Offline · usando aulas salvas</span>`;
}
function vConfigIA() {
  const st = S.iaStatus || {};
  const prov = st.provedor || "anthropic";
  return `<div class="panel"><h3>Inteligência artificial</h3>
<p class="muted" style="font-size:var(--text-base)">A IA lê o edital e escreve as aulas. Com a API da Anthropic ela precisa de internet; com o Ollama roda no seu computador, sem internet. Aulas já geradas funcionam offline em qualquer caso.</p>
<div class="cfg-grid">
<div class="field"><label class="label" for="c-prov">Provedor</label><select id="c-prov">
<option value="anthropic" ${prov === "anthropic" ? "selected" : ""}>Claude, pela API da Anthropic (online)</option>
<option value="ollama" ${prov === "ollama" ? "selected" : ""}>Ollama, modelo local (offline)</option></select></div>
<div class="field" data-p="anthropic" ${prov !== "anthropic" ? "hidden" : ""}><label class="label" for="c-chave">Chave da API</label><input id="c-chave" type="password" autocomplete="off" placeholder="${st.chave ? "Salva: " + esc(st.chave) + " (deixe vazio para manter)" : "sk-ant-…"}"></div>
<div class="field" data-p="anthropic" ${prov !== "anthropic" ? "hidden" : ""}><label class="label" for="c-mod-a">Modelo</label><input id="c-mod-a" value="${esc(st.modelo_anthropic || "claude-sonnet-5-5")}"></div>
<div class="field" data-p="ollama" ${prov !== "ollama" ? "hidden" : ""}><label class="label" for="c-url">Endereço do Ollama</label><input id="c-url" value="${esc(st.ollama_url || "http://localhost:11434")}"></div>
<div class="field" data-p="ollama" ${prov !== "ollama" ? "hidden" : ""}><label class="label" for="c-mod-o">Modelo do Ollama</label><input id="c-mod-o" value="${esc(st.modelo_ollama || "qwen2.5:14b")}"></div>
</div>
<div class="row"><button class="primary" data-act="salvarIA">Salvar</button><button id="c-testar" data-act="testarIA" ${st.provedor ? "" : "disabled"}>Testar conexão</button></div></div>`;
}
function vEnvio() {
  const semIA = S.ready && (!S.iaStatus || !S.iaStatus.provedor);
  return `<div class="hero"><p class="label">Rota do Edital</p><h1 style="margin-top:8px">Envie o edital. O plano, os resumos e as questões saem dele.</h1>
<p>Lê o PDF, encontra seu cargo e monta um roteiro diário com revisões, resumo de cada tópico e questões no estilo da banca. Tudo fica salvo neste computador.</p></div>
${S.lista.length ? `<div class="section"><h2 style="margin-bottom:10px">Seus editais</h2><div class="list">${S.lista.map(e => `<button class="item" data-act="abrirEd" data-id="${esc(e.id)}"><span class="tag">${pct(e.estudados, e.topicos)}%</span><span class="t"><strong>${esc(e.orgao)}</strong><span>${esc(e.cargo || "")}${e.banca ? " · " + esc(e.banca) : ""} · ${e.estudados}/${e.topicos} tópicos</span></span><span class="muted">›</span></button>`).join("")}</div></div><h2 style="margin-bottom:10px">Novo edital</h2>` : ""}
<div class="panel" style="margin-bottom:22px"><h3>Recebeu um pacote do Claude?</h3>
<p class="muted" style="font-size:var(--text-base)">Importe o arquivo .json com o edital já processado e as aulas prontas. Não precisa de chave de API nem de internet.</p>
<div class="row" style="margin-top:10px"><label class="btn" for="f-pacote" style="cursor:pointer">Importar pacote<input id="f-pacote" type="file" accept=".json,application/json" hidden></label></div></div>
${semIA ? `<p class="banner" style="margin-bottom:14px">Para o app ler um edital novo sozinho, configure a IA abaixo. Com um pacote importado, isso não é necessário.</p>` : ""}
<div class="stack">
<label class="drop" id="drop" for="f-edital"><input type="file" id="f-edital" accept=".pdf,.txt,application/pdf,text/plain">
<strong>${S.file ? "Edital selecionado" : "Escolha ou arraste o PDF do edital"}</strong>
${S.file ? `<span class="file-ok">${esc(S.file.name)}</span>` : `<span class="muted">PDF com texto selecionável, ou arquivo .txt</span>`}</label>
<details ${S.colado ? "open" : ""}><summary>Prefere colar o texto do edital?</summary><div style="margin-top:10px"><textarea id="f-colado" aria-label="Texto do edital" placeholder="Cole aqui o edital ou só o anexo de conteúdo programático">${esc(S.colado)}</textarea></div></details>
<div class="row" style="align-items:flex-end">
<div class="field"><label class="label" for="f-horas">Horas de estudo por dia</label><input id="f-horas" type="number" min="1" max="14" step="0.5" value="${esc(S.horas)}"></div>
<div class="field"><label class="label" for="f-data">Data da prova (opcional)</label><input id="f-data" type="date" value="${esc(S.dataProva)}"></div></div>
<div class="row"><button class="primary" data-act="iniciar">Montar meu plano</button><button class="ghost" data-act="exemplo">Ver com um edital de exemplo</button>
<span class="spacer"></span>${chipIA()}${btnTema()}</div></div>
<div style="margin-top:22px">${semIA || S.cfgAberta ? vConfigIA() : `<button class="ghost" data-act="abrirCfg">Configurar IA</button>`}</div>
<div class="how">
<div><b>1 · LEITURA</b>Extrai o texto do PDF e localiza o conteúdo programático.</div>
<div><b>2 · ESTRUTURA</b>Identifica banca, cargo e data e transforma o edital em matérias e tópicos, com a incidência estimada de cada um.</div>
<div><b>3 · PLANO</b>Distribui os tópicos por dia conforme o peso de cada matéria e o seu índice de acerto.</div>
<div><b>4 · AULA</b>Gera resumo, pegadinhas e questões, salva tudo no computador e agenda revisões que se espaçam conforme você acerta.</div></div>`;
}
function vPipe() {
  const p = S.pipe; let cargos = "";
  if (p.cargos) {
    const f = (p.filtro || "").toLowerCase();
    cargos = `<div class="panel" style="margin-top:14px"><h3>Este edital tem ${p.cargos.length} cargos. Qual é o seu?</h3>
${p.cargos.length > 8 ? `<input id="f-filtro" aria-label="Filtrar cargos" style="margin-top:10px" placeholder="Filtrar cargos" value="${esc(p.filtro || "")}">` : ""}
<div class="cargos">${p.cargos.map((c, i) => c.toLowerCase().includes(f) ? `<button data-act="cargo" data-i="${i}">${esc(c)}</button>` : "").join("")}</div></div>`;
  }
  return `<div class="hero"><p class="label">Montando seu plano</p><h1 style="margin-top:8px">Lendo o edital</h1><p>Deixe esta página aberta. Leva de um a três minutos.</p></div>
<ol class="steps">${p.steps.map(s => `<li class="${s.st}"><span class="dot" aria-hidden="true"></span><div><strong>${esc(s.t)}</strong>${s.info ? `<div class="info">${esc(s.info)}</div>` : ""}${s.desde ? `<div class="info" data-desde="${s.desde}"></div>` : ""}</div></li>`).join("")}</ol>
${cargos}${p.falhou ? `<div class="row" style="margin-top:16px"><button class="primary" data-act="voltar">Voltar e tentar de novo</button></div>` : ""}`;
}
/* endereço da página acompanha a tela, para o botão Voltar do navegador funcionar */
const VIEWS = ["hoje", "edital", "desempenho", "erros", "materiais", "ajustes", "treino"];
function syncHash() {
  const h = S.topic ? `#${S.topic.modo}/${S.topic.tid}` : "#" + S.view;
  if (location.hash !== h) { if (location.hash) history.pushState(null, "", h); else history.replaceState(null, "", h); }
}
function aplicarHash() {
  if (!S.ed) return;
  const h = decodeURIComponent(location.hash.slice(1)), m = h.match(/^(estudo|revisao)\/(.+)$/);
  if (m && achar(m[2])) { if (!S.topic || S.topic.tid !== m[2]) abrirTopico(m[2], m[1]); return; }
  S.topic = null; S.concluindo = null;
  S.view = VIEWS.includes(h) && (h !== "treino" || S.treino) ? h : "hoje";
  if (S.view !== "treino") S.treino = null;
  render();
}
window.addEventListener("popstate", aplicarHash);
function vTopo() {
  const e = S.ed; const dias = e.dataProva ? diasEntre(hoje(), e.dataProva) : null;
  const revs = revisoesPendentes().length, errs = errosParaHoje().length;
  const n = v => v ? ` <span class="n">${v}</span>` : "";
  return `${e.exemplo ? `<p class="banner" style="margin-bottom:14px">Exemplo fictício. <button class="small" data-act="trocar" style="margin-left:6px">Enviar meu edital</button></p>` : ""}
<header class="top"><div class="who"><p class="label">${esc(e.banca || "Banca não identificada")} · ${e.estilo === "CE" ? "Certo ou Errado" : "Múltipla escolha"}</p>
<h1>${esc(e.orgao)}</h1><p class="cargo">${esc(e.cargo)}</p><div class="row" style="margin-top:8px;gap:6px">${chipIA()}${btnTema()}</div></div>
<div class="count">${dias !== null ? `<b>${Math.max(0, dias)}</b><span class="muted">dias até a prova<br>${fmtData(e.dataProva)}</span>` : `<span class="muted">Sem data de prova</span><br><button class="small" data-act="tab" data-v="ajustes" style="margin-top:6px">Definir data</button>`}</div></header>
${!S.topic && S.view !== "treino" ? `<nav class="tabs" aria-label="Seções">${[["hoje", "Hoje" + n(revs + errs)], ["edital", "Edital verticalizado"], ["desempenho", "Desempenho"], ["erros", "Caderno de erros" + n(errs)], ["materiais", "Materiais" + (S.mats.length ? ` <span class="n">${S.mats.length}</span>` : "")], ["ajustes", "Ajustes"]].map(([k, t]) => `<button data-act="tab" data-v="${k}" aria-current="${S.view === k}">${t}</button>`).join("")}</nav>` : ""}`;
}

function vHoje() {
  const e = S.ed, P = planoDia(), blocos = blocosDia();
  const total = e.materias.reduce((s, m) => s + m.topicos.length, 0), restantes = fila().length, estud = total - restantes;
  let f = 0, a = 0; e.materias.forEach(m => m.topicos.forEach(t => { const T = qt(t); f += T.f; a += T.a; }));
  const diasNec = Math.ceil(restantes / blocos);
  let proj;
  if (restantes === 0) proj = "Você passou por todos os tópicos do edital. Agora o plano é revisar, refazer erros e treinar questões misturadas.";
  else if (P.dias === null) proj = `No ritmo de ${blocos} blocos por dia, você termina a primeira passada pelo edital em ${diasNec} dias.`;
  else if (diasNec <= P.dias) proj = `No ritmo atual você fecha o edital em ${diasNec} dias e sobram ${P.dias - diasNec} para revisão final.`;
  else proj = `No ritmo atual faltariam ${diasNec - P.dias} dias para fechar o edital. O plano já prioriza incidência alta; nas duas últimas semanas, só entram tópicos de incidência alta.`;
  const item = (x, tag, cls, act) => `<button class="item" data-act="${act}" data-t="${x.t.id}"><span class="tag ${cls}">${tag}</span><span class="t"><strong>${esc(x.t.nome)}</strong><span>${esc(x.m.nome)} · ${INC_TXT[x.t.inc]}${S.temAula.has(x.t.id) ? ` · <span class="off-tag">aula salva</span>` : ""}${nMats(x.t.id) ? ` · ${nMats(x.t.id)} PDF${nMats(x.t.id) > 1 ? "s" : ""}` : ""}</span></span><span class="muted" aria-hidden="true">›</span></button>`;
  // próximo passo
  const revHoje = P.revs.slice(0, P.nRev);
  let prox;
  if (revHoje.length) prox = {tit: P.revs[0].t.nome, sub: `Revisão · ${P.revs[0].m.nome}`, act: "abrirRev", t: P.revs[0].t.id, porque: "Revisar na hora certa custa pouco e segura o que você já estudou."};
  else if (P.errs.length) prox = {tit: `Refazer ${P.errs.length} ${P.errs.length > 1 ? "questões" : "questão"} do caderno de erros`, sub: `Cerca de ${P.minErr} min`, act: "irErros", porque: "Refazer sem olhar o gabarito, em dias diferentes, é o que transforma erro em acerto."};
  else if (P.lista.length) prox = {tit: P.lista[0].t.nome, sub: `Tópico novo · ${P.lista[0].m.nome}`, act: "abrir", t: P.lista[0].t.id, porque: "Comece pelas duas questões de aquecimento, depois leia o resumo."};
  const podeTreino = e.materias.some(m => m.topicos.filter(t => t.st !== "novo" && S.temAula.has(t.id)).length) && e.materias.reduce((s, m) => s + m.topicos.filter(t => t.st !== "novo" && S.temAula.has(t.id)).length, 0) >= 2;
  const planejado = revHoje.length + P.revFeitasHoje.length + (P.errs.length ? 1 : 0) + Math.max(P.novos, P.feitosHoje.length);
  const feito = P.revFeitasHoje.length + P.feitosHoje.length;
  const normal = Math.round((e.horas || 3) * 60);
  const opMin = [[30, "30 min"], [60, "1 h"], [120, "2 h"]].filter(([x]) => x < normal).concat([[normal, `Plano normal · ${String(e.horas).replace(".", ",")} h`]]);
  const mHoje = e.hojeMin && e.hojeMin.d === hoje() ? e.hojeMin.min : null;
  return `${P.retaFinal ? `<p class="banner info" style="margin-bottom:16px">Reta final: priorize revisões, caderno de erros e treinos mistos. Tópicos novos só de incidência alta.</p>` : ""}
<section class="next" aria-labelledby="prox-h"><div class="row" style="margin:0"><span class="label">Próximo passo</span><span class="spacer"></span><span class="muted mono" style="font-size:var(--text-sm)">${feito} de ${Math.max(planejado, feito)} feitos hoje</span></div>
${prox ? `<h2 id="prox-h">${esc(prox.tit)}</h2><p class="muted">${esc(prox.sub)}. ${esc(prox.porque)}</p>
<div class="row"><button class="primary" data-act="${prox.act}" ${prox.t ? `data-t="${prox.t}"` : ""}>Começar</button>${podeTreino ? `<button data-act="treino">Treino misto · 10 questões</button>` : ""}</div>`
  : `<h2 id="prox-h">Plano de hoje concluído</h2><p class="muted">Se ainda tiver tempo, um treino misto com questões de vários tópicos é o melhor uso dele.</p>
<div class="row">${podeTreino ? `<button class="primary" data-act="treino">Treino misto · 10 questões</button>` : ""}<button data-act="maisUm">Estudar mais um tópico</button></div>`}
<div class="meter" aria-hidden="true">${Array.from({length: Math.max(planejado, feito, 1)}, (_, i) => `<i class="${i < feito ? "on" : ""}"></i>`).join("")}</div>
<div style="margin-top:14px"><span class="label" id="tempo-l">Quanto tempo você tem hoje?</span><div class="tempo" role="group" aria-labelledby="tempo-l">${opMin.map(([v, t], i) => `<button data-act="tempoHoje" data-min="${v}" aria-pressed="${v === normal ? mHoje === null || mHoje === v : mHoje === v}">${t}</button>`).join("")}</div></div>
${e.seEntao ? `<p class="compromisso">Seu compromisso: ${esc(e.seEntao)}</p>` : `<p class="note">Dica: definir quando e onde você vai estudar aumenta a chance de cumprir. <button class="ghost small" data-act="tab" data-v="ajustes">Definir em Ajustes</button></p>`}
</section>
<div class="kpis">
<div class="kpi"><span class="label">Edital coberto</span><b>${pct(estud, total)}%</b><small>${estud} de ${total} tópicos</small></div>
<div class="kpi"><span class="label">Acerto geral</span><b>${f ? pct(a, f) + "%" : "—"}</b><small>${f} questões resolvidas</small></div>
<div class="kpi"><span class="label">Aulas salvas</span><b>${S.temAula.size}/${total}</b><small>disponíveis sem internet</small></div></div>
<div class="section"><div class="row"><h2>Revisões</h2><span class="spacer"></span><span class="muted">${P.revs.length ? `${revHoje.length} de ${P.revs.length} cabem hoje · 15 min cada` : ""}</span></div>
${P.revs.length || P.revFeitasHoje.length ? `<div class="list">${P.revFeitasHoje.map(x => item(x, "feita hoje", "done", "abrirRev")).join("")}${revHoje.map(x => item(x, x.atraso > 0 ? `atrasada ${x.atraso}d` : (x.r.reforco ? "reforço" : "revisão"), "rev", "abrirRev")).join("")}</div>
${P.revs.length > revHoje.length ? `<p class="note">${P.revs.length - revHoje.length} revisão(ões) ficam para amanhã; as mais atrasadas vêm primeiro.</p>` : ""}` : `<div class="list"><p class="empty">Nenhuma revisão para hoje. A primeira vem no dia seguinte ao estudo; as próximas se espaçam conforme você acerta.</p></div>`}</div>
${P.errs.length ? `<div class="section"><div class="row"><h2>Caderno de erros</h2></div><div class="list"><button class="item" data-act="irErros"><span class="tag err">${P.errs.length} hoje</span><span class="t"><strong>Refazer questões erradas sem ver o gabarito</strong><span>Cada uma sai do caderno quando você acerta em três dias diferentes · cerca de ${P.minErr} min</span></span><span class="muted" aria-hidden="true">›</span></button></div></div>` : ""}
${vSimuladoHoje(P, estud / Math.max(1, total))}
${pendentesQC().length ? `<div class="section"><div class="row"><h2>Lançar desempenho do QConcursos</h2></div><p class="note" style="margin:0 0 10px">Quantas questões você resolveu destes tópicos estudados nos últimos dias?</p>
<div class="stack">${pendentesQC().map(x => `<div class="panel"><strong>${esc(x.t.nome)}</strong><div class="muted" style="font-size:var(--text-sm);margin-bottom:8px">${esc(x.m.nome)} · filtro: ${esc(filtroQC(x.t, x.m))}</div>${vQCForm(x.t, "h", `<button data-act="qcReg" data-t="${x.t.id}" data-pre="h">Registrar</button><button class="ghost" data-act="qcPular" data-t="${x.t.id}">Não fiz</button>`)}</div>`).join("")}</div></div>` : ""}
<div class="section"><div class="row"><h2>Tópicos novos</h2><span class="spacer"></span><span class="muted">${P.novos ? `${Math.max(0, P.novos - P.feitosHoje.length)} de ${P.novos} restantes · blocos de 50 min` : "sem tempo para tópico novo hoje"}</span></div>
<div class="list">${P.feitosHoje.map(x => item(x, "feito hoje", "done", "abrir")).join("")}${P.lista.map((x, i) => item(x, "bloco " + (P.feitosHoje.length + i + 1), "", "abrir")).join("")}
${!P.lista.length && !P.feitosHoje.length ? `<p class="empty">${P.novos ? "Nenhum tópico novo pendente." : "Com o tempo de hoje, o plano fica só com revisões e erros. Isso já conta."}</p>` : ""}</div>
<p class="note">${esc(proj)}</p></div>
${e.dicas ? `<div class="section"><h2 class="sec-h">Como a banca cobra</h2><div class="doc"><p>${esc(e.dicas)}</p></div></div>` : ""}`;
}
function bolinhas(m) {
  return `<div class="bubbles" aria-hidden="true">${m.topicos.map(t => { const acc = accTop(t); const c = t.st === "novo" ? "" : (acc !== null && qt(t).f >= 3 && acc < .6 ? "f" : revsFeitas(t) >= 3 ? "r" : "s"); return `<span class="bub ${c}" title="${esc(t.nome)}"></span>`; }).join("")}</div>`;
}
function vEdital() {
  return `<div class="legend"><span><i class="bub"></i>a estudar</span><span><i class="bub s"></i>estudado</span><span><i class="bub r"></i>revisões concluídas</span><span><i class="bub f"></i>acerto abaixo de 60%</span></div>
<div>${S.ed.materias.map(m => {
    const est = m.topicos.filter(t => t.st !== "novo").length; const acc = accMat(m);
    return `<details class="mat"><summary><div class="row"><h3>${esc(m.nome)}</h3><span class="spacer"></span><span class="muted mono" style="font-size:var(--text-sm)">${m.questoes ? m.questoes + " questões · " : ""}${est}/${m.topicos.length}${acc !== null ? " · " + Math.round(acc * 100) + "% acerto" : ""}</span></div>${bolinhas(m)}</summary>
<div class="list tops">${m.topicos.map(t => {
      const nx = t.revs.find(r => !r.feita);
      return `<button class="item" data-act="${t.st === "novo" ? "abrir" : "abrirRev"}" data-t="${t.id}"><span class="chip ${t.inc === "alta" ? "alta" : ""}">${t.inc}</span><span class="t"><strong>${esc(t.nome)}</strong><span>${txtQ(t)}${nx ? ` · próxima revisão ${fmtData(nx.due)}` : ""}${S.temAula.has(t.id) ? ` · <span class="off-tag">aula salva</span>` : ""}</span></span>${t.st === "novo" ? `<span class="chip">a estudar</span>` : `<span class="chip ok">estudado</span>`}</button>`;
    }).join("")}</div></details>`;
  }).join("")}</div>`;
}
function vDesempenho() {
  const e = S.ed;
  const rows = e.materias.map(m => { const tot = m.topicos.length, est = m.topicos.filter(t => t.st !== "novo").length; let f = 0, a = 0, qc = 0; m.topicos.forEach(t => { const T = qt(t); f += T.f; a += T.a; qc += (t.qc && t.qc.f) || 0; }); return {m, tot, est, f, a, qc}; });
  const atrasadas = revisoesPendentes().filter(x => x.atraso > 0).length;
  const fracos = []; e.materias.forEach(m => m.topicos.forEach(t => { const acc = accTop(t); if (qt(t).f >= 3 && acc < .6) fracos.push({m, t, acc}); }));
  const cor = v => v === null ? "var(--line)" : v >= .75 ? "var(--ok)" : v >= .6 ? "var(--warn)" : "var(--bad)";
  // calibração (confiança × acerto)
  const cal = e.cal || {}, niveis = ["certeza", "duvida", "chute"].filter(k => cal[k] && cal[k].f);
  let calTxt = "";
  if (niveis.length) {
    const liq = k => cal[k] ? 2 * cal[k].a - cal[k].f : 0;
    const d = cal.duvida && cal.duvida.f >= 5 ? cal.duvida.a / cal.duvida.f : null;
    calTxt = `<div class="calib">${niveis.map(k => `<div class="kpi"><span class="label">${CONF_TXT[k]}</span><b>${pct(cal[k].a, cal[k].f)}%</b><small>${cal[k].a} de ${cal[k].f} certas</small></div>`).join("")}</div>
${e.estilo === "CE" ? `<p class="note">Em prova com “uma errada anula uma certa”, vale responder um item quando a chance de acerto passa de 50%. Saldo (certos − errados): <b class="mono">${niveis.reduce((s, k) => s + liq(k), 0)}</b>${cal.chute && cal.chute.f ? `; sem os chutes seria <b class="mono">${niveis.filter(k => k !== "chute").reduce((s, k) => s + liq(k), 0)}</b>` : ""}.${d !== null ? (d > .5 ? ` Seus itens de dúvida acertam ${Math.round(d * 100)}%: compensa responder.` : ` Seus itens de dúvida acertam ${Math.round(d * 100)}%: na prova, deixe em branco.`) : ""}</p>`
  : `<p class="note">Se você erra muito com “certeza”, há conceitos confundidos: esses erros estão marcados no caderno. Se acerta muito na “dúvida”, você sabe mais do que acha e pode ganhar tempo na prova.</p>`}`;
  }
  // tipos de erro
  const tipos = {}; e.erros.forEach(x => { if (x.tipo) tipos[x.tipo] = (tipos[x.tipo] || 0) + 1; });
  const totTipos = Object.values(tipos).reduce((s, v) => s + v, 0);
  // atividade dos últimos 14 dias
  const ativ = e.ativ || {}, dias14 = Array.from({length: 14}, (_, i) => addDias(hoje(), i - 13));
  const maxA = Math.max(1, ...dias14.map(d => ativ[d] || 0)), diasAtivos = dias14.filter(d => ativ[d]).length;
  return `<div class="section"><h2 class="sec-h">Acerto por matéria</h2><div class="panel"><div class="bars">${rows.map(r => {
    const acc = r.f ? r.a / r.f : null;
    return `<div class="bar"><span class="nm">${esc(r.m.nome)}</span><span class="mono" style="text-align:right">${acc === null ? "—" : Math.round(acc * 100) + "%"}</span><div class="track"><i style="width:${acc === null ? 0 : Math.round(acc * 100)}%;background:${cor(acc)}"></i></div><span class="muted" style="font-size:var(--text-sm);grid-column:1/-1">${r.f} questões${r.qc ? ` (${r.qc} no QConcursos)` : ""} · ${r.est} de ${r.tot} tópicos estudados</span></div>`;
  }).join("")}</div></div></div>
<div class="section"><h2 class="sec-h">Confiança × acerto</h2>${calTxt || `<div class="list"><p class="empty">Marque “Certeza”, “Dúvida” ou “Chute” antes de responder. Aqui aparece o quanto sua confiança acompanha o acerto, e ${e.estilo === "CE" ? "se vale responder itens em que você tem dúvida." : "onde estão os conceitos confundidos."}</p></div>`}</div>
<div class="section"><h2 class="sec-h">Constância</h2><div class="panel"><div class="row" style="align-items:flex-end;gap:4px;height:64px" aria-hidden="true">${dias14.map(d => `<span title="${fmtData(d)}: ${ativ[d] || 0} questões" style="flex:1;border-radius:3px 3px 0 0;background:${ativ[d] ? "var(--accent)" : "var(--color-surface-2)"};height:${ativ[d] ? Math.max(12, Math.round((ativ[d] / maxA) * 64)) : 6}px"></span>`).join("")}</div>
<p class="note">Estudou em ${diasAtivos} dos últimos 14 dias. Pouco todo dia rende mais do que muito de vez em quando.</p></div></div>
${totTipos ? `<div class="section"><h2 class="sec-h">Por que você erra</h2><div class="panel"><div class="bars">${Object.entries(TIPOS_ERRO).filter(([k]) => tipos[k]).map(([k, t]) => `<div class="bar"><span class="nm">${t}</span><span class="mono" style="text-align:right">${tipos[k]}</span><div class="track"><i style="width:${pct(tipos[k], totTipos)}%;background:var(--accent)"></i></div></div>`).join("")}</div>
<p class="note">Muitas “desatenções” costumam ser conteúdo mal fixado. Confusão entre conceitos pede um quadro comparativo; erro de leitura pede treino de questões da banca.</p></div></div>` : ""}
<div class="section"><h2 class="sec-h">Cobertura do edital</h2><div class="panel"><div class="bars">${rows.map(r => `<div class="bar"><span class="nm">${esc(r.m.nome)}</span><span class="mono" style="text-align:right">${pct(r.est, r.tot)}%</span><div class="track"><i style="width:${pct(r.est, r.tot)}%;background:var(--accent)"></i></div></div>`).join("")}</div></div>
<p class="note">${atrasadas ? `${atrasadas} revisão(ões) atrasada(s). Elas aparecem primeiro na aba Hoje.` : "Nenhuma revisão atrasada."}</p></div>
<div class="section"><h2 class="sec-h">Tópicos para reforçar</h2><div class="list">${fracos.length ? fracos.sort((a, b) => a.acc - b.acc).map(x => `<button class="item" data-act="abrirRev" data-t="${x.t.id}"><span class="chip bad">${Math.round(x.acc * 100)}%</span><span class="t"><strong>${esc(x.t.nome)}</strong><span>${esc(x.m.nome)} · ${txtQ(x.t)}</span></span><span class="muted" aria-hidden="true">›</span></button>`).join("") : `<p class="empty">Os tópicos com acerto abaixo de 60% (a partir de 3 questões) aparecem aqui e ganham mais tempo no plano.</p>`}</div></div>`;
}
function vErros() {
  const e = S.ed, devidos = errosParaHoje(), ativos = e.erros.filter(x => !x.dom), dom = e.erros.filter(x => x.dom);
  if (!e.erros.length) return `<div class="list"><p class="empty">Cada questão que você errar (ou acertar no chute) entra aqui. Você refaz sem ver o gabarito em dias diferentes; depois de três acertos, ela sai da fila.</p></div>`;
  const v = S.errView || (devidos.length ? "hoje" : "todos");
  const lista = v === "hoje" ? devidos.concat(e.erros.filter(x => S.errResp[x.id] !== undefined && !devidos.includes(x))) : v === "dom" ? dom : ativos;
  // erros cometidos com certeza primeiro: são os mais fáceis de corrigir e os que mais indicam confusão
  const ord = lista.slice().sort((a, b) => (b.conf === "certeza" && !b.sorte) - (a.conf === "certeza" && !a.sorte));
  const btn = (k, t) => `<button data-act="errView" data-v="${k}" aria-pressed="${v === k}">${t}</button>`;
  return `<div class="err-filtros" role="group" aria-label="Filtrar caderno">${btn("hoje", `Refazer hoje · ${devidos.length}`)}${btn("todos", `Na fila · ${ativos.length}`)}${btn("dom", `Dominados · ${dom.length}`)}</div>
${v === "hoje" ? `<div class="dica"><strong>Responda antes de ver o gabarito.</strong>Acertou: a questão volta em 3 e depois em 7 dias. Errou: volta amanhã. Três acertos em dias diferentes e ela está dominada.</div>` : ""}
${ord.length ? `<div class="stack">${ord.map(x => vErroItem(x, v === "hoje")).join("")}</div>` : `<div class="list"><p class="empty">${v === "hoje" ? "Nada para refazer hoje." : v === "dom" ? "Nenhuma questão dominada ainda." : "Fila vazia."}</p></div>`}`;
}
function vAjustes() {
  const e = S.ed, total = e.materias.reduce((s, m) => s + m.topicos.length, 0), p = S.pre;
  return `<div class="panel"><h3>Plano</h3><div class="settings" style="margin-top:10px">
<div class="field"><label class="label" for="a-horas">Horas por dia</label><input id="a-horas" type="number" min="0.5" max="14" step="0.5" value="${esc(e.horas)}"></div>
<div class="field"><label class="label" for="a-data">Data da prova</label><input id="a-data" type="date" value="${esc(e.dataProva || "")}"></div></div>
<div class="field" style="margin-bottom:12px"><label class="label" for="a-seentao">Meu compromisso: quando e onde vou estudar</label><input id="a-seentao" maxlength="200" value="${esc(e.seEntao || "")}" placeholder="Se eu chegar do trabalho às 19h, então estudo 50 min na mesa da sala antes de ligar a TV.">
<span class="muted" style="font-size:var(--text-sm)">Planos no formato “se… então…” aumentam a chance de cumprir. Aparece na aba Hoje.</span></div>
<button class="primary" data-act="salvarAjustes">Salvar e recalcular</button></div>
<div class="panel"><h3>Estudar sem internet</h3>
<p class="muted">Gera e salva agora a aula de todos os tópicos (${S.temAula.size} de ${total} já salvas). Depois disso, resumos e questões abrem sem conexão. ${S.iaStatus && S.iaStatus.provedor === "anthropic" ? "Cada aula consome créditos da sua API." : ""}</p>
${p && p.run ? `<div class="row"><div class="prog"><i style="width:${pct(p.feitos, p.total)}%"></i></div></div><div class="row"><span class="mono">${p.feitos}/${p.total} aulas</span><span class="spacer"></span><button class="small" data-act="pararPre">Parar</button></div>`
  : `<div class="row" style="margin-top:10px"><button data-act="preGerar" ${!S.iaStatus || !S.iaStatus.provedor || S.temAula.size >= total ? "disabled" : ""}>Salvar todas as aulas</button>${p && p.erro ? `<span style="color:var(--bad)">${esc(p.erro)}</span>` : ""}</div>`}</div>
${vConfigIA()}
<div class="panel"><h3>Backup</h3><p class="muted">Leve seu progresso para outro computador ou guarde uma cópia.</p>
<div class="row" style="margin-top:10px"><a class="btn" href="/api/backup" download>Baixar backup</a>
<label class="btn" for="f-backup" style="cursor:pointer">Restaurar backup ou importar pacote<input id="f-backup" type="file" accept=".json,application/json" hidden></label></div></div>
<div class="panel"><h3>Edital</h3><div class="row" style="margin-top:8px">
${S.confirmTroca ? `<span>Abrir outro edital? Este fica guardado.</span><button class="small" data-act="trocar">Sim</button><button class="small ghost" data-act="cancelTroca">Cancelar</button>` : `<button data-act="pedirTroca">Abrir ou enviar outro edital</button>`}</div></div>`;
}
function vTopico() {
  const f = achar(S.topic.tid); if (!f) { S.topic = null; return vHoje(); }
  const {m, t} = f, c = S.content[t.id], g = S.gen[t.id], gq = S.gen["q_" + t.id], resp = S.resp[t.id] || {};
  const rev = S.topic.modo === "revisao", pre = !rev && t.st === "novo" ? nPre(c) : 0;
  let corpo;
  if (c) {
    const qs = (de, ate) => c.questoes.map((q, i) => i >= de && i < ate ? vQuestao(t.id, q, i, resp[i], i < pre) : "").join("");
    const resumo = `<div class="section" id="s-resumo"><h2 class="sec-h">Resumo</h2><div class="doc">${md(c.resumo)}</div></div>
${c.pegadinhas && c.pegadinhas.length ? `<div class="section"><h2 class="sec-h">Pegadinhas da banca</h2><ul class="pegas">${c.pegadinhas.map(p => `<li>${esc(p)}</li>`).join("")}</ul></div>` : ""}
${c.porques && c.porques.length ? `<div class="section" id="s-porques"><h2 class="sec-h">Explique para si mesmo</h2><p class="note" style="margin:0 0 10px">Responda de cabeça antes de abrir. Explicar o porquê fixa mais do que reler.</p><div class="porq">${c.porques.map(x => `<details><summary>${esc(x.p)}</summary><p>${esc(x.r)}</p></details>`).join("")}</div></div>` : ""}`;
    const questoes = `<div class="section" id="s-questoes"><div class="row" style="margin-bottom:10px"><h2>Questões</h2><span class="spacer"></span><span class="muted mono">${t.q.a}/${t.q.f} no app</span></div>
<p class="note" style="margin:0 0 10px">Marque sua confiança antes de responder: errar com certeza e acertar no chute vão para o caderno de erros.<span class="kbd-hint"> Atalhos: <span class="kbd">${S.ed.estilo === "CE" ? "C E" : "A–E"}</span> responde, <span class="kbd">1 2 3</span> confiança.</span></p>
<div class="stack">${qs(pre, 999)}</div>
<div style="margin-top:12px">${gq && gq.run ? `<div class="gen"><span class="spin"></span><span>Criando novas questões… <span data-desde="${gq.desde}"></span></span></div>` : `<button data-act="mais" data-t="${t.id}">Gerar mais 5 questões</button>`}
${gq && gq.err ? `<p class="note" style="color:var(--bad)">${esc(gq.err)}</p>` : ""}</div></div>`;
    if (rev) corpo = `<div class="dica"><strong>Revisão: primeiro lembre, depois releia.</strong>Tentar lembrar fixa mais do que reler. Pense nos pontos principais do tópico, resolva as questões e só então abra o resumo, se precisar.</div>
<div class="field" style="margin-bottom:24px"><label class="label" for="recall">O que você lembra deste tópico? (rascunho, não é salvo)</label><textarea id="recall" style="min-height:84px" placeholder="Escreva em um minuto os pontos de que se lembra."></textarea></div>
${questoes}<details class="reler section"><summary>Reler o resumo, as pegadinhas e os porquês</summary>${resumo}</details>`;
    else corpo = `${pre ? `<div class="section" id="s-aquec"><h2 class="sec-h">Aquecimento</h2><div class="dica"><strong>Tente antes de ler.</strong>Errar aqui é esperado e não conta no seu desempenho: arriscar uma resposta antes do conteúdo faz você prestar atenção no que importa quando ler o resumo.</div><div class="stack">${qs(0, pre)}</div></div>` : ""}
${resumo}${questoes}`;
    corpo += `<p class="note" style="margin-bottom:var(--space-8)">Material gerado por IA a partir do tópico do edital. Confira a redação atual da lei antes de memorizar detalhes.</p>`;
  } else if (g && g.err) corpo = `<div class="gen" style="border-color:var(--bad);color:var(--bad)">${esc(g.err)}</div><div class="row" style="margin:10px 0 26px"><button data-act="refazer" data-t="${t.id}">Tentar de novo</button></div>`;
  else corpo = `<div class="gen" role="status"><span class="spin"></span><span>Preparando a aula deste tópico. Leva de 20 a 60 segundos. ${g && g.desde ? `<span data-desde="${g.desde}"></span>` : ""}</span></div>`;
  const prox = t.revs.find(r => !r.feita);
  const passos = c ? (rev ? [["s-questoes", "Questões"], ["", "Reler, se precisar"]] : [pre ? ["s-aquec", "Aquecimento"] : null, ["s-resumo", "Resumo"], c.porques && c.porques.length ? ["s-porques", "Porquês"] : null, ["s-questoes", "Questões"]].filter(Boolean)) : [];
  return `<button class="ghost back" data-act="fechar">‹ Voltar</button>
<p class="label">${esc(m.nome)} · ${rev ? "Revisão" : "Estudo"}</p><h1 style="margin:6px 0 10px">${esc(t.nome)}</h1>
<div class="row" style="margin-bottom:14px;gap:6px"><span class="chip ${t.inc === "alta" ? "alta" : ""}">${INC_TXT[t.inc]}</span>${t.st !== "novo" ? `<span class="chip ok">Estudado em ${fmtData(t.em)}</span>` : ""}${prox ? `<span class="chip warn">Próxima revisão ${fmtData(prox.due)}</span>` : ""}${revsFeitas(t) ? `<span class="chip">${revsFeitas(t)} revisão(ões) feita(s)</span>` : ""}</div>
${passos.length ? `<ol class="passos" aria-label="Roteiro">${passos.map(([id, n]) => `<li>${id ? `<a href="#${id}">${n}</a>` : n}</li>`).join("")}</ol>` : ""}
${corpo}
${c ? vMatsTopico(t, rev) : ""}
${S.concluindo === t.id ? "" : vQCTopico(t, m)}
<div class="actions">${S.concluindo === t.id
  ? `<div class="stack" style="width:100%"><strong>Antes de concluir: resolveu questões deste tópico no QConcursos?</strong>
${vQCForm(t, "c", `<button class="primary" data-act="qcConcluir" data-t="${t.id}">Registrar e concluir</button><button data-act="concluirDireto" data-t="${t.id}">Não fiz, só concluir</button><button class="ghost" data-act="cancelConcluir">Cancelar</button>`)}</div>`
  : `${rev ? `<button class="primary" data-act="pedirConcluir" data-t="${t.id}">Concluir revisão</button>` : `<button class="primary" data-act="pedirConcluir" data-t="${t.id}">Marcar como estudado</button>`}
${c ? `<button class="ghost" data-act="refazer" data-t="${t.id}">Refazer aula</button>` : ""}${c ? `<span class="spacer"></span><span class="muted mono" style="font-size:var(--text-sm)">${Object.keys(resp).length} de ${c.questoes.length} respondidas</span>` : ""}`}</div>`;
}
function filtroQC(t, m) { return t.qcFiltro || [S.ed.banca, m.nome, t.nome].filter(Boolean).join(" · "); }
function vQCForm(t, pre, botoes) {
  return `<div class="row qcform" style="align-items:flex-end"><div class="field qcn"><label class="label" for="${pre}f-${t.id}">Questões feitas</label><input id="${pre}f-${t.id}" type="number" min="1" inputmode="numeric"></div>
<div class="field qcn"><label class="label" for="${pre}a-${t.id}">Acertos</label><input id="${pre}a-${t.id}" type="number" min="0" inputmode="numeric"></div>${botoes}</div>`;
}
function vQCTopico(t, m) {
  const s = (t.qc && t.qc.s) || [];
  return `<div class="section"><h2 style="margin-bottom:10px">No QConcursos</h2><div class="panel stack">
<div><span class="label">Filtro sugerido</span><div class="row" style="margin-top:4px"><span class="mono" style="font-size:var(--text-sm);overflow-wrap:anywhere;min-width:0">${esc(filtroQC(t, m))}</span>
<button class="small" data-act="copiarFiltro" data-t="${t.id}">Copiar</button><a class="btn small" href="https://www.qconcursos.com" target="_blank" rel="noopener">Abrir o QConcursos</a></div></div>
${vQCForm(t, "t", `<button data-act="qcReg" data-t="${t.id}" data-pre="t">Registrar</button>`)}
<p class="muted" style="font-size:var(--text-sm)">${s.length ? `Registrado: ${t.qc.a}/${t.qc.f} acertos (${pct(t.qc.a, t.qc.f)}%) em ${s.length} sessão(ões), a última em ${fmtData(s[s.length - 1].d)}.` : "Nenhuma sessão registrada ainda. O acerto daqui entra no plano e nas revisões."}</p></div></div>`;
}
function registrarQC(tid, pre) {
  const f = achar(tid); if (!f) return false;
  const nf = parseInt(($("#" + pre + "f-" + tid) || {}).value, 10), na = parseInt(($("#" + pre + "a-" + tid) || {}).value, 10);
  if (!(nf > 0) || !(na >= 0) || na > nf) { toast("Informe quantas questões fez e quantas acertou (acertos não podem passar do total)."); return false; }
  const t = f.t; t.qc = t.qc || {f: 0, a: 0, s: []};
  t.qc.f += nf; t.qc.a += na; t.qc.s.push({d: hoje(), f: nf, a: na}); t.qc.s = t.qc.s.slice(-60); delete t.qcPulado;
  if (t.st !== "novo" && nf >= 5 && na / nf < .6 && !t.revs.some(r => !r.feita && r.due <= addDias(hoje(), 3))) {
    t.revs.push({due: addDias(hoje(), 3), feita: false, reforco: true}); t.revs.sort((a, b) => a.due < b.due ? -1 : 1);
    toast(`Registrado: ${na}/${nf} (${pct(na, nf)}%). Agendei uma revisão de reforço em 3 dias.`);
  } else toast(`Registrado: ${na}/${nf} (${pct(na, nf)}%).`);
  save(); return true;
}
function pendentesQC() {
  const lim = addDias(hoje(), -7), out = [];
  S.ed.materias.forEach(m => m.topicos.forEach(t => { if (t.st !== "novo" && t.em && t.em >= lim && !(t.qc && t.qc.s && t.qc.s.length) && !t.qcPulado) out.push({m, t}); }));
  return out.slice(0, 4);
}
function vQuestao(tid, q, i, r, pre, rotulo) {
  const resp = r !== undefined; const certo = resp && r === q.gabarito; const k = tid + ":" + i, conf = S.conf[k];
  const cls = L => resp ? (L === q.gabarito ? "right" : L === r ? "wrong" : "") : "";
  const opts = q.alternativas
    ? `<div class="opts">${q.alternativas.map((a, n) => { const L = "ABCDE"[n]; return `<button class="opt ${cls(L)}" data-act="resp" data-t="${tid}" data-i="${i}" data-o="${L}" ${resp ? "disabled" : ""}><span class="l">${L}</span><span>${esc(a)}</span></button>`; }).join("")}</div>`
    : `<div class="ce">${["C", "E"].map(L => `<button class="opt ${cls(L)}" data-act="resp" data-t="${tid}" data-i="${i}" data-o="${L}" ${resp ? "disabled" : ""}><span class="l">${L}</span><span>${L === "C" ? "Certo" : "Errado"}</span></button>`).join("")}</div>`;
  const confRow = resp || pre ? "" : `<div class="conf" role="group" aria-label="Confiança antes de responder"><span>Confiança:</span>${Object.entries(CONF_TXT).map(([v, t]) => `<button data-act="conf" data-k="${k}" data-v="${v}" aria-pressed="${conf === v}">${t}</button>`).join("")}</div>`;
  return `<div class="q${pre ? " pre" : ""}" ${resp ? "" : "data-pend"}><div class="q-head"><span class="label">${rotulo ? esc(rotulo) : (pre ? "Aquecimento" : (q.alternativas ? "Questão" : "Item") + " " + (i + 1))}</span>${resp && conf ? `<span class="chip">${CONF_TXT[conf]}</span>` : ""}</div><p class="enun">${esc(q.enunciado)}</p>${confRow}${opts}
${resp ? `<div class="expl" role="status"><strong style="color:${certo ? "var(--ok)" : "var(--bad)"}">${certo ? (conf === "chute" ? "Acertou no chute: vai para o caderno para confirmar." : "Acertou.") : "Errou. Gabarito: " + (q.alternativas ? q.gabarito : (q.gabarito === "C" ? "Certo" : "Errado")) + "."}</strong> ${esc(q.explicacao)}</div>` : ""}</div>`;
}
/* Plano do dia: dívida de revisão primeiro, depois caderno de erros, depois tópicos novos no tempo que sobrar. */
function planoDia() {
  const e = S.ed, h = hoje(), min = minutosHoje();
  const dias = e.dataProva ? diasEntre(h, e.dataProva) : null, retaFinal = dias !== null && dias >= 0 && dias <= 14;
  const revs = revisoesPendentes(), errs = errosParaHoje();
  let resto = min;
  const nRev = Math.min(revs.length, Math.max(1, Math.floor(resto / 15))); resto -= nRev * 15;
  const minErr = errs.length ? Math.min(20, Math.max(6, errs.length * 2)) : 0; if (minErr) resto -= minErr;
  const feitosHoje = []; e.materias.forEach(m => m.topicos.forEach(t => { if (t.em === h) feitosHoje.push({m, t}); }));
  const revFeitasHoje = []; e.materias.forEach(m => m.topicos.forEach(t => { if (t.revs.some(r => r.feita && r.em === h)) revFeitasHoje.push({m, t}); }));
  let q = fila(); if (retaFinal) q = q.filter(x => x.t.inc === "alta");
  let novos = Math.max(0, Math.floor(resto / 50));
  if (!novos && !revs.length && !errs.length && min >= 25) novos = 1;
  const lista = q.slice(0, Math.max(0, novos - feitosHoje.length));
  return {min, dias, retaFinal, revs, nRev, errs, minErr, feitosHoje, revFeitasHoje, lista, novos, fila: q};
}
function vErroItem(x, refazer) {
  const f = achar(x.tid), r = S.errResp[x.id], oculto = refazer && r === undefined;
  const L = o => x.alternativas ? o : (o === "C" ? "Certo" : "Errado");
  const cls = o => oculto ? "" : o === x.gabarito ? "right" : (o === (r !== undefined ? r : x.marcada) ? "wrong" : "");
  const opts = x.alternativas
    ? `<div class="opts">${x.alternativas.map((a, i) => { const o = "ABCDE"[i]; return `<button class="opt ${cls(o)}" ${oculto ? `data-act="refazerErro" data-id="${x.id}" data-o="${o}"` : "disabled"}><span class="l">${o}</span><span>${esc(a)}</span></button>`; }).join("")}</div>`
    : `<div class="ce">${["C", "E"].map(o => `<button class="opt ${cls(o)}" ${oculto ? `data-act="refazerErro" data-id="${x.id}" data-o="${o}"` : "disabled"}><span class="l">${o}</span><span>${o === "C" ? "Certo" : "Errado"}</span></button>`).join("")}</div>`;
  const dots = `<span class="dots" title="${x.ok || 0} de 3 acertos" aria-label="${x.ok || 0} de 3 acertos">${[0, 1, 2].map(i => `<i class="${i < (x.ok || 0) || x.dom ? "on" : ""}"></i>`).join("")}</span>`;
  const selo = x.sorte ? `<span class="chip warn">acertou no chute</span>` : x.conf === "certeza" ? `<span class="chip bad">errou com certeza</span>` : "";
  return `<div class="q"><div class="q-head"><span class="label">${esc(f ? f.m.nome : "")}</span>${selo}<span class="spacer"></span>${dots}<span class="muted" style="font-size:var(--text-sm)">${x.dom ? "dominada" : errDue(x) <= hoje() ? "refazer hoje" : "volta " + fmtData(errDue(x))}</span></div>
${f ? `<p class="muted" style="font-size:var(--text-sm);margin-top:2px">${esc(f.t.nome)}</p>` : ""}
<p class="enun">${esc(x.enunciado)}</p>${opts}
${oculto ? "" : `${r !== undefined ? `<div class="expl"><strong style="color:${r === x.gabarito ? "var(--ok)" : "var(--bad)"}">${r === x.gabarito ? "Acertou." : "Errou de novo. Gabarito: " + L(x.gabarito) + "."}</strong> ${esc(x.explicacao)}</div>` : `<div class="expl">${!x.sorte && x.marcada ? `Você marcou <b>${L(x.marcada)}</b>; gabarito <b>${L(x.gabarito)}</b>. ` : ""}${esc(x.explicacao)}</div>`}
<div style="margin-top:12px"><span class="label">Por que errei?</span><div class="tipos" role="group" aria-label="Tipo de erro">${Object.entries(TIPOS_ERRO).map(([k, t]) => `<button data-act="tipoErro" data-id="${x.id}" data-v="${k}" aria-pressed="${x.tipo === k}">${t}</button>`).join("")}</div></div>
<div class="field" style="margin-top:10px"><label class="label" for="nota-${x.id}">A regra que vou lembrar (opcional)</label><textarea id="nota-${x.id}" data-nota="${x.id}" style="min-height:64px" placeholder="Ex.: ato vinculado não admite revogação.">${esc(x.nota || "")}</textarea></div>
<div class="row" style="margin-top:10px">${f ? `<button class="small" data-act="abrirRev" data-t="${x.tid}">Abrir o tópico</button>` : ""}<span class="spacer"></span>${S.errDel === x.id ? `<span class="muted" style="font-size:var(--text-sm)">Remover do caderno?</span><button class="small" data-act="tirarErro" data-id="${x.id}">Remover</button><button class="small ghost" data-act="cancelDel">Cancelar</button>` : `<button class="small ghost" data-act="pedirDel" data-id="${x.id}">Remover</button>`}</div>`}</div>`;
}
function vTreino() {
  const T = S.treino;
  if (T.carregando) return `<button class="ghost back" data-act="sairTreino">‹ Voltar</button><div class="gen" role="status"><span class="spin"></span><span>Separando questões de tópicos diferentes…</span></div>`;
  const P = treinoPlacar(), fim = P.resp === P.tot;
  if (fim && !T.fim) T.fim = Date.now();
  const seg = Math.round(((T.fim || Date.now()) - T.inicio) / 1000), ritmo = S.ed.estilo === "CE" ? 90 : 180;
  return `<button class="ghost back" data-act="sairTreino">‹ Voltar</button>
<p class="label">Treino misto</p><h1 style="margin:6px 0 10px">Questões intercaladas de vários tópicos</h1>
<div class="dica"><strong>Por que misturar?</strong>Sem saber de que assunto é a próxima questão, você treina reconhecer o que ela pede, como na prova. Tópicos com acerto baixo e revisões antigas aparecem mais.</div>
<div class="treino-top"><span class="mono">${P.resp}/${P.tot}</span><div class="prog" role="progressbar" aria-valuemin="0" aria-valuemax="${P.tot}" aria-valuenow="${P.resp}" aria-label="Progresso do treino"><i style="width:${pct(P.resp, P.tot)}%"></i></div><span class="mono muted" ${fim ? "" : `data-relogio="${T.inicio}"`}>${fmtSeg(seg)}</span></div>
${fim ? `<div class="panel" role="status"><h3>Treino concluído</h3><div class="resultado">
<div class="kpi"><span class="label">Acerto</span><b>${pct(P.ac, P.tot)}%</b><small>${P.ac} de ${P.tot}</small></div>
<div class="kpi"><span class="label">Tempo por questão</span><b>${fmtSeg(Math.round(seg / P.tot))}</b><small>ritmo de prova: até ${fmtSeg(ritmo)}</small></div></div>
<p class="muted">Os erros e os acertos no chute já estão no caderno de erros.</p>
<div class="row" style="margin-top:12px"><button class="primary" data-act="treino">Outro treino</button><button data-act="sairTreino">Voltar para Hoje</button></div></div>` : ""}
<div class="stack" style="margin-top:16px">${T.itens.map((it, n) => { const f = achar(it.tid), c = S.content[it.tid]; if (!f || !c || !c.questoes[it.qi]) return ""; return vQuestao(it.tid, c.questoes[it.qi], it.qi, (S.resp[it.tid] || {})[it.qi], false, `${n + 1} · ${f.m.nome}`); }).join("")}</div>
${fim ? "" : `<p class="note">Ritmo de prova: cerca de ${fmtSeg(ritmo)} por ${S.ed.estilo === "CE" ? "item" : "questão"}.</p>`}`;
}
const fmtSeg = s => Math.floor(s / 60) + ":" + pad(s % 60);
/* ---------- materiais de apoio (PDFs locais ligados aos tópicos) ---------- */
const TIPO_MAT = {prova: "Prova anterior", gabarito: "Gabarito", edital: "Edital", norma: "Norma", lei: "Lei", guia: "Guia oficial", livro: "Livro", apostila: "Apostila", outro: "Outro"};
const QUANDO_MAT = {
  estudo: "Para aprofundar, depois do resumo",
  questoes: "Questões reais da banca",
  revisao: "Na revisão",
  consulta: "Texto oficial para consulta"
};
const ORDEM_QUANDO = {estudo: ["estudo", "consulta", "questoes", "revisao"], revisao: ["questoes", "revisao", "consulta", "estudo"]};
const usosDe = mat => Array.isArray(mat.usos) ? mat.usos : [];
function matsDoTopico(tid) {
  const out = [];
  S.mats.forEach(mat => usosDe(mat).forEach(u => { if (u.tid === tid) out.push({mat, u}); }));
  return out;
}
const nMats = tid => new Set(matsDoTopico(tid).map(x => x.mat.id)).size;
const pagIni = p => { const n = parseInt(String(p || ""), 10); return n > 0 ? n : null; };
const fmtPag = p => !p ? "" : /[-–,]/.test(String(p)) ? "págs. " + String(p).replace("-", "–") : "pág. " + p;
function linkMat(mat, pag) {
  if (mat.temArquivo) return `/materiais/${encodeURIComponent(S.ed.id)}/${encodeURIComponent(mat.arquivo)}` + (pagIni(pag) ? "#page=" + pagIni(pag) : "");
  return mat.url && /^https?:\/\//.test(mat.url) ? mat.url : null;
}
function btnMat(mat, pag, rotulo, cls) {
  const href = linkMat(mat, pag);
  if (!href) return `<span class="muted" style="font-size:var(--text-sm)">Arquivo ausente neste computador</span>`;
  const externo = !mat.temArquivo;
  return `<a class="btn small ${cls || ""}" href="${esc(href)}" target="_blank" rel="noopener">${esc(rotulo || "Abrir PDF")}${pagIni(pag) ? " · pág. " + pagIni(pag) : ""}${externo ? " (on-line)" : ""}</a>`;
}
const fmtMB = b => b ? (b / 1048576 >= 1 ? (b / 1048576).toFixed(1).replace(".", ",") + " MB" : Math.max(1, Math.round(b / 1024)) + " KB") : "";
function gabTxt(mat, qs, chave) {
  if (!mat.respostas || !qs || !qs.length) return "";
  const aberto = S.gabVer[chave];
  return `<button class="small ghost" data-act="verGab" data-k="${esc(chave)}" aria-expanded="${!!aberto}">${aberto ? "Esconder gabarito" : "Ver gabarito"}</button>
${aberto ? `<span class="mono" style="font-size:var(--text-sm)">${qs.map(q => `${q}: <b>${esc(mat.respostas[q] === "*" ? "anulada" : mat.respostas[q] || "?")}</b>`).join(" · ")}</span>` : ""}`;
}
function vMatsTopico(t, rev) {
  const lista = matsDoTopico(t.id); if (!lista.length) return "";
  const ordem = ORDEM_QUANDO[rev ? "revisao" : "estudo"];
  lista.sort((a, b) => ordem.indexOf(a.u.quando) - ordem.indexOf(b.u.quando));
  const grupos = ordem.map(q => [q, lista.filter(x => x.u.quando === q)]).filter(([, l]) => l.length);
  const dica = rev
    ? "Na revisão, comece pelas questões reais da banca, sem consultar nada. Abra o texto oficial só para conferir o que errou."
    : "Leia o resumo e faça as questões do app primeiro. Use os trechos indicados para tirar dúvidas, e deixe as questões reais da banca para o fim do estudo ou para a revisão.";
  return `<div class="section" id="s-mats"><h2 class="sec-h">Materiais de apoio</h2><div class="dica"><strong>${rev ? "Primeiro as questões, depois a consulta." : "Onde e quando usar."}</strong>${dica}</div>
${grupos.map(([q, l]) => `<h3 class="label" style="margin:16px 0 8px">${QUANDO_MAT[q] || q}</h3><div class="stack">${l.map(({mat, u}) => {
    const k = mat.id + ":" + t.id;
    return `<div class="mat-card"><div class="row" style="gap:8px"><span class="chip">${TIPO_MAT[mat.tipo] || "PDF"}</span><strong>${esc(mat.titulo)}</strong></div>
${u.questoes && u.questoes.length ? `<p class="muted" style="font-size:var(--text-sm)">Questões ${u.questoes.join(", ")}${u.pag ? " · " + fmtPag(u.pag) : ""}</p>` : u.pag ? `<p class="muted" style="font-size:var(--text-sm)">${fmtPag(u.pag)}</p>` : ""}
${u.nota ? `<p style="font-size:var(--text-sm)">${esc(u.nota)}</p>` : ""}
<div class="row" style="gap:8px;margin-top:8px">${btnMat(mat, u.pag, mat.tipo === "prova" ? "Abrir prova" : "Abrir PDF")}${gabTxt(mat, u.questoes, k)}</div></div>`;
  }).join("")}</div>`).join("")}</div>`;
}
function vMateriais() {
  const f = S.matFiltro, grupos = {prova: ["prova"], normas: ["norma", "lei", "edital"], estudo: ["guia", "livro", "apostila", "outro"]};
  const vis = S.mats.filter(m => m.tipo !== "gabarito" && (f === "todos" || (grupos[f] || []).includes(m.tipo)));
  const ord = ["edital", "prova", "norma", "lei", "guia", "livro", "apostila", "outro"];
  vis.sort((a, b) => ord.indexOf(a.tipo) - ord.indexOf(b.tipo) || a.titulo.localeCompare(b.titulo, "pt-BR"));
  const nomeTop = tid => { const x = achar(tid); return x ? x.t.nome : null; };
  const btn = (k, t) => `<button data-act="matFiltro" data-v="${k}" aria-pressed="${f === k}">${t}</button>`;
  const totMB = S.mats.reduce((s, m) => s + (m.tamanho || 0), 0);
  return `<div class="row" style="margin-bottom:12px"><p class="muted" style="font-size:var(--text-sm)">${S.mats.length} materiais · ${fmtMB(totMB)} salvos neste computador. Cada tópico mostra o trecho certo na hora de estudar ou revisar.</p><span class="spacer"></span><button class="${S.matForm ? "ghost" : "tonal"}" data-act="matForm">${S.matForm ? "Fechar" : "Adicionar PDF"}</button></div>
${S.matForm ? vMatForm() : ""}
<div class="err-filtros" role="group" aria-label="Filtrar materiais">${btn("todos", "Todos")}${btn("prova", "Provas anteriores")}${btn("normas", "Edital, normas e leis")}${btn("estudo", "Guias, livros e apostilas")}</div>
${vis.length ? `<div class="stack">${vis.map(mat => {
    const tops = [...new Set(usosDe(mat).map(u => u.tid).filter(Boolean))];
    const geral = usosDe(mat).find(u => !u.tid);
    const gab = mat.gab && S.mats.find(x => x.id === mat.gab.id);
    const nq = mat.respostas ? Object.keys(mat.respostas).length : 0;
    const sims = mat.simulados || [];
    return `<div class="mat-card"><div class="row" style="gap:8px"><span class="chip ${mat.tipo === "prova" ? "alta" : ""}">${TIPO_MAT[mat.tipo] || "PDF"}</span><strong style="flex:1;min-width:0">${esc(mat.titulo)}</strong>${mat.temArquivo ? "" : `<span class="chip warn">sem arquivo</span>`}</div>
<p class="muted" style="font-size:var(--text-sm);margin-top:4px">${[mat.fonte, mat.paginas ? mat.paginas + " páginas" : "", fmtMB(mat.tamanho), mat.licenca].filter(Boolean).map(esc).join(" · ")}</p>
${mat.resumo ? `<p style="font-size:var(--text-sm);margin-top:6px">${esc(mat.resumo)}</p>` : ""}
${geral && geral.nota ? `<p style="font-size:var(--text-sm);margin-top:6px"><b>Quando usar:</b> ${esc(geral.nota)}</p>` : ""}
<div class="row" style="gap:8px;margin-top:10px">${btnMat(mat, geral && geral.pag)}${gab ? btnMat(gab, mat.gab.pag, "Gabarito oficial") : ""}${mat.url ? `<a class="btn small ghost" href="${esc(mat.url)}" target="_blank" rel="noopener">Fonte</a>` : ""}
<span class="spacer"></span>${S.matDel === mat.id ? `<span class="muted" style="font-size:var(--text-sm)">Apagar este material?</span><button class="small" data-act="delMat" data-id="${esc(mat.id)}">Apagar</button><button class="small ghost" data-act="cancelDelMat">Cancelar</button>` : `<button class="small ghost" data-act="pedirDelMat" data-id="${esc(mat.id)}">Apagar</button>`}</div>
${mat.tipo === "prova" && nq ? `<div class="sim"><span class="label">Simulado</span><p style="font-size:var(--text-sm);margin:4px 0 8px">Faça a prova inteira de uma vez, cronometrando (cerca de ${Math.round(nq * 3 / 60 * 2) / 2} h para ${nq} questões), e confira com o gabarito oficial.${sims.length ? ` Feita ${sims.length}×; última: ${sims[sims.length - 1].a}/${sims[sims.length - 1].n} em ${fmtData(sims[sims.length - 1].d)}.` : ""}</p>
<div class="row qcform" style="align-items:flex-end"><div class="field qcn"><label class="label" for="sim-${esc(mat.id)}">Acertos (de ${nq})</label><input id="sim-${esc(mat.id)}" type="number" min="0" max="${nq}" inputmode="numeric"></div><button class="small" data-act="simReg" data-id="${esc(mat.id)}">Registrar simulado</button></div></div>` : ""}
${tops.length ? `<details class="mat-tops"><summary>${tops.length} tópico${tops.length > 1 ? "s" : ""} do edital</summary><div class="tipos">${tops.map(tid => nomeTop(tid) ? `<button data-act="abrirRev" data-t="${esc(tid)}">${esc(nomeTop(tid))}</button>` : "").join("")}</div></details>` : ""}</div>`;
  }).join("")}</div>` : `<div class="list"><p class="empty">${S.mats.length ? "Nenhum material neste filtro." : "Nenhum material ainda. Adicione PDFs (leis, provas anteriores, apostilas) e ligue cada um a um tópico."}</p></div>`}`;
}
function vMatForm() {
  const ops = S.ed.materias.map(m => `<optgroup label="${esc(m.nome)}">${m.topicos.map(t => `<option value="${t.id}">${esc(t.nome)}</option>`).join("")}</optgroup>`).join("");
  return `<div class="panel" style="margin-bottom:16px"><h3>Adicionar PDF</h3><p class="muted">O arquivo fica salvo neste computador, em dados/materiais. Use só material que você tem direito de usar.</p>
<div class="cfg-grid">
<div class="field"><label class="label" for="mf-arq">Arquivo PDF</label><input id="mf-arq" type="file" accept="application/pdf,.pdf"></div>
<div class="field"><label class="label" for="mf-tit">Título</label><input id="mf-tit" maxlength="160" placeholder="Ex.: Lei 14.133/2021 (texto compilado)"></div>
<div class="field"><label class="label" for="mf-tipo">Tipo</label><select id="mf-tipo">${Object.entries(TIPO_MAT).filter(([k]) => k !== "gabarito").map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div>
<div class="field"><label class="label" for="mf-top">Tópico (opcional)</label><select id="mf-top"><option value="">Material geral do edital</option>${ops}</select></div>
<div class="field"><label class="label" for="mf-pag">Páginas (opcional)</label><input id="mf-pag" maxlength="20" placeholder="Ex.: 12-20"></div>
<div class="field"><label class="label" for="mf-quando">Quando usar</label><select id="mf-quando">${Object.entries(QUANDO_MAT).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div>
</div>
<div class="field" style="margin-bottom:12px"><label class="label" for="mf-nota">Nota (opcional)</label><input id="mf-nota" maxlength="300" placeholder="Ex.: ler os arts. 37 a 41 antes das questões"></div>
<button class="primary" data-act="matSalvar">Salvar material</button></div>`;
}
async function salvarMatProprio() {
  const arq = $("#mf-arq").files[0], titulo = $("#mf-tit").value.trim() || (arq && arq.name.replace(/\.pdf$/i, ""));
  if (!arq) { toast("Escolha um arquivo PDF."); return; }
  if (arq.size > 60 * 1048576) { toast("O arquivo passa de 60 MB."); return; }
  const id = (titulo.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "material") + "-" + uid().slice(0, 4);
  const tid = $("#mf-top").value || null, pag = $("#mf-pag").value.trim(), quando = $("#mf-quando").value, nota = $("#mf-nota").value.trim();
  const mat = {id, titulo, tipo: $("#mf-tipo").value, fonte: "Adicionado por você", proprio: true, adicionado: hoje(), arquivo: id + ".pdf", tamanho: arq.size,
    usos: [{tid, pag: pag || null, quando, nota: nota || null}]};
  try {
    const r = await fetch(`/api/materiais/${encodeURIComponent(S.ed.id)}/${id}/arquivo`, {method: "PUT", headers: {"content-type": "application/pdf"}, body: arq});
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw {message: d.erro || "Não consegui salvar o arquivo."};
    await api("PUT", `materiais/${S.ed.id}/${id}`, mat);
    await carregarMats(); S.matForm = false; render(); toast("Material salvo.");
  } catch (e) { toast(erroTxt(e)); }
}
async function atualizarMat(mat) {
  const c = Object.assign({}, mat); delete c.temArquivo;
  await api("PUT", `materiais/${S.ed.id}/${mat.id}`, c);
}
/* Simulado com prova real: aparece com metade do edital estudada ou na reta final */
function vSimuladoHoje(P, cobertura) {
  const provas = S.mats.filter(m => m.tipo === "prova" && m.respostas && m.temArquivo);
  if (!provas.length || !(P.retaFinal || cobertura >= .5)) return "";
  const prox = provas.slice().sort((a, b) => (a.simulados || []).length - (b.simulados || []).length)[0];
  const n = Object.keys(prox.respostas).length;
  return `<div class="section"><div class="row"><h2>Simulado com prova real</h2></div><div class="list"><a class="item" href="${esc(linkMat(prox))}" target="_blank" rel="noopener"><span class="tag">${n} questões</span><span class="t"><strong>${esc(prox.titulo)}</strong><span>${(prox.simulados || []).length ? "Refaça para medir a evolução" : "Ainda não feita"} · reserve cerca de ${Math.round(n * 3 / 60 * 2) / 2} h · registre o resultado em Materiais</span></span><span class="muted" aria-hidden="true">›</span></a></div>
<p class="note">Uma prova inteira por semana na reta final treina ritmo e resistência. Os erros dela viram tópicos de revisão.</p></div>`;
}
/* cronômetro dos itens em andamento */
setInterval(() => {
  document.querySelectorAll("[data-desde]").forEach(el => { const s = Math.round((Date.now() - +el.dataset.desde) / 1000); el.textContent = s + " s"; });
  document.querySelectorAll("[data-relogio]").forEach(el => { el.textContent = fmtSeg(Math.round((Date.now() - +el.dataset.relogio) / 1000)); });
}, 1000);

/* ---------- eventos ---------- */
document.addEventListener("click", ev => {
  const b = ev.target.closest("[data-act]"); if (!b) return; const a = b.dataset.act, tid = b.dataset.t;
  if (a === "iniciar") iniciar();
  else if (a === "exemplo") carregarExemplo();
  else if (a === "abrirEd") abrirEdital(b.dataset.id);
  else if (a === "abrirCfg") { S.cfgAberta = true; render(); }
  else if (a === "salvarIA") salvarIA();
  else if (a === "testarIA") testarIA();
  else if (a === "cargo" && S.pipe && S.pipe.escolher) S.pipe.escolher(S.pipe.cargos[+b.dataset.i]);
  else if (a === "voltar") { S.pipe = null; render(); }
  else if (a === "tab") { S.view = b.dataset.v; S.topic = null; S.concluindo = null; S.confirmTroca = false; render(); }
  else if (a === "abrir") abrirTopico(tid, "estudo");
  else if (a === "abrirRev") abrirTopico(tid, "revisao");
  else if (a === "fechar") { S.topic = null; S.concluindo = null; render(); window.scrollTo(0, 0); }
  else if (a === "resp") responder(tid, +b.dataset.i, b.dataset.o);
  else if (a === "mais") { const f = achar(tid); if (f) maisQuestoes(f.t, f.m); }
  else if (a === "refazer") { const f = achar(tid); if (f) { S.content[tid] = null; gerarConteudo(f.t, f.m, true).catch(() => {}); } }
  else if (a === "pedirConcluir") { S.concluindo = tid; render(); const el = $("#cf-" + tid); if (el) el.focus(); }
  else if (a === "cancelConcluir") { S.concluindo = null; render(); }
  else if (a === "qcConcluir" || a === "concluirDireto") {
    if (a === "qcConcluir" && !registrarQC(tid, "c")) return;
    S.concluindo = null; S.topic && S.topic.modo === "revisao" ? concluirRevisao(tid) : concluirEstudo(tid);
  }
  else if (a === "qcReg") { if (registrarQC(tid, b.dataset.pre)) render(); }
  else if (a === "qcPular") { const f = achar(tid); if (f) { f.t.qcPulado = true; save(); render(); } }
  else if (a === "copiarFiltro") { const f = achar(tid); if (f) { const txt = filtroQC(f.t, f.m); (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => toast("Filtro copiado."), () => toast(txt)); } }
  else if (a === "tirarErro") { S.ed.erros = S.ed.erros.filter(x => x.id !== b.dataset.id); S.errDel = null; save(); render(); }
  else if (a === "pedirDel") { S.errDel = b.dataset.id; render(); }
  else if (a === "cancelDel") { S.errDel = null; render(); }
  else if (a === "salvarAjustes") { const h = parseFloat($("#a-horas").value); const d = $("#a-data").value; if (h > 0) S.ed.horas = h; S.ed.dataProva = d || null; const se = $("#a-seentao").value.trim(); if (se) S.ed.seEntao = se; else delete S.ed.seEntao; save(); S.view = "hoje"; render(); window.scrollTo(0, 0); toast("Plano recalculado."); }
  else if (a === "tema") { tema = TEMAS[(TEMAS.indexOf(tema) + 1) % TEMAS.length]; try { localStorage.setItem("rota-tema", tema); } catch (e) {} aplicarTema(); render(); }
  else if (a === "conf") { const k = b.dataset.k; S.conf[k] = S.conf[k] === b.dataset.v ? undefined : b.dataset.v; render(); }
  else if (a === "tempoHoje") { const v = +b.dataset.min; if (v === Math.round((S.ed.horas || 3) * 60)) delete S.ed.hojeMin; else S.ed.hojeMin = {d: hoje(), min: v}; save(); render(); }
  else if (a === "irErros") { S.view = "erros"; S.errView = "hoje"; S.topic = null; render(); window.scrollTo(0, 0); }
  else if (a === "errView") { S.errView = b.dataset.v; render(); }
  else if (a === "refazerErro") refazerErro(b.dataset.id, b.dataset.o);
  else if (a === "tipoErro") { const x = S.ed.erros.find(e => e.id === b.dataset.id); if (x) { x.tipo = x.tipo === b.dataset.v ? undefined : b.dataset.v; save(); render(); } }
  else if (a === "treino") montarTreino(10);
  else if (a === "sairTreino") { S.treino = null; S.view = "hoje"; render(); window.scrollTo(0, 0); }
  else if (a === "verGab") { S.gabVer[b.dataset.k] = !S.gabVer[b.dataset.k]; render(); }
  else if (a === "matFiltro") { S.matFiltro = b.dataset.v; render(); }
  else if (a === "matForm") { S.matForm = !S.matForm; render(); }
  else if (a === "matSalvar") salvarMatProprio();
  else if (a === "pedirDelMat") { S.matDel = b.dataset.id; render(); }
  else if (a === "cancelDelMat") { S.matDel = null; render(); }
  else if (a === "delMat") { const id = b.dataset.id; api("DELETE", `materiais/${S.ed.id}/${id}`).then(async () => { S.matDel = null; await carregarMats(); render(); toast("Material apagado."); }, e => toast(erroTxt(e))); }
  else if (a === "simReg") {
    const mat = S.mats.find(x => x.id === b.dataset.id), inp = $("#sim-" + b.dataset.id); if (!mat || !inp) return;
    const n = Object.keys(mat.respostas || {}).length, v = parseInt(inp.value, 10);
    if (!(v >= 0 && v <= n)) { toast(`Informe quantas acertou, de 0 a ${n}.`); return; }
    mat.simulados = (mat.simulados || []).concat([{d: hoje(), a: v, n}]).slice(-20);
    atualizarMat(mat).then(() => { render(); toast(`Simulado registrado: ${v}/${n} (${pct(v, n)}%).`); }, e => toast(erroTxt(e)));
  }
  else if (a === "maisUm") { const x = fila()[0]; if (x) abrirTopico(x.t.id, "estudo"); else toast("Não há tópicos novos pendentes."); }
  else if (a === "preGerar") preGerar();
  else if (a === "pararPre") { if (S.pre) S.pre.parar = true; toast("Parando depois da aula em andamento."); }
  else if (a === "pedirTroca") { S.confirmTroca = true; render(); }
  else if (a === "cancelTroca") { S.confirmTroca = false; render(); }
  else if (a === "trocar") trocarEdital();
});
document.addEventListener("change", ev => {
  const t = ev.target;
  if (t.id === "f-edital" && t.files && t.files[0]) { S.file = t.files[0]; render(); }
  else if ((t.id === "f-backup" || t.id === "f-pacote") && t.files && t.files[0]) importarBackup(t.files[0]);
  else if (t.id === "f-horas") S.horas = t.value;
  else if (t.id === "f-data") S.dataProva = t.value;
  else if (t.id === "c-prov") document.querySelectorAll("[data-p]").forEach(el => el.hidden = el.dataset.p !== t.value);
});
document.addEventListener("input", ev => {
  const t = ev.target;
  if (t.dataset && t.dataset.nota) { const x = S.ed && S.ed.erros.find(e => e.id === t.dataset.nota); if (x) { x.nota = t.value.slice(0, 500); save(); } }
  else if (t.id === "f-colado") S.colado = t.value;
  else if (t.id === "f-filtro") { S.pipe.filtro = t.value; const pos = t.selectionStart; render(); const n = $("#f-filtro"); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} } }
});
["dragover", "dragenter"].forEach(n => document.addEventListener(n, ev => { const d = ev.target.closest && ev.target.closest("#drop"); if (d) { ev.preventDefault(); d.classList.add("over"); } }));
document.addEventListener("dragleave", ev => { const d = ev.target.closest && ev.target.closest("#drop"); if (d) d.classList.remove("over"); });
document.addEventListener("drop", ev => { const d = ev.target.closest && ev.target.closest("#drop"); if (!d) return; ev.preventDefault(); const f = ev.dataTransfer.files && ev.dataTransfer.files[0]; if (f) { S.file = f; render(); } });
/* atalhos: responder a primeira questão pendente da tela (A–E ou C/E) e marcar confiança (1, 2, 3) */
document.addEventListener("keydown", ev => {
  if (ev.ctrlKey || ev.metaKey || ev.altKey || (ev.target.closest && ev.target.closest("input,textarea,select,details"))) return;
  const q = document.querySelector(".q[data-pend]"); if (!q) return;
  const k = ev.key.toUpperCase();
  if ("123".includes(k) && k) { const bs = q.querySelectorAll('[data-act="conf"]'); if (bs[+k - 1]) { ev.preventDefault(); bs[+k - 1].click(); } return; }
  const b = q.querySelector(`[data-act="resp"][data-o="${k}"]`);
  if (b && k.length === 1) { ev.preventDefault(); b.click(); }
});
window.addEventListener("pagehide", () => { if (dirty && S.ed) navigator.sendBeacon && fetch("/api/editais/" + S.ed.id, {method: "PUT", keepalive: true, headers: {"content-type": "application/json"}, body: JSON.stringify(S.ed)}); });
init();
