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
    if (/^#{1,5}\s/.test(l)) { if (ul) { h += "</ul>"; ul = false; } h += "<h4>" + inl(l.replace(/^#+\s/, "")) + "</h4>"; }
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
  confirmTroca: false, pre: null, cfgAberta: false, concluindo: null};

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
  S.ed = e; S.content = {}; S.resp = {}; S.gen = {}; S.topic = null; S.view = "hoje";
  const ids = await api("GET", "conteudo/" + id).catch(() => []);
  S.temAula = new Set(ids || []);
  await api("PUT", "ativo", {id}).catch(() => {});
  render();
}
async function carregarStatus() { S.iaStatus = await api("GET", "status").catch(() => null); }

async function init() {
  render();
  await carregarStatus();
  const a = await api("GET", "ativo").catch(() => null);
  S.lista = await api("GET", "editais").catch(() => []);
  S.ready = true;
  if (a && a.id) await abrirEdital(a.id); else render();
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
function agendarRevisoes(t) {
  const h = hoje(); t.revs = [1, 7, 30].map(d => ({due: addDias(h, d), feita: false}));
  const acc = accTop(t); if (acc !== null && qt(t).f >= 3 && acc < .6) t.revs.unshift({due: addDias(h, 2), feita: false, reforco: true});
  t.revs.sort((a, b) => a.due < b.due ? -1 : 1);
}

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
{"resumo":"Markdown simples (use ### para subtítulos, - para listas e **negrito**), de 350 a 550 palavras, direto ao ponto, citando artigos de lei, súmulas e entendimentos quando cabíveis. Se o tema depende de legislação que pode ter mudado recentemente, diga ao aluno para conferir a redação vigente.",
"pegadinhas":["3 a 5 frases curtas com armadilhas típicas da banca neste tópico"],
"questoes":[${formatoQuestoes(5)}]}
As questões devem ser inéditas e cobrar o que a banca costuma cobrar neste tópico.`, 8000);
    if (!r || typeof r.resumo !== "string" || !Array.isArray(r.questoes)) throw {message: "A aula veio em formato inesperado. Tente de novo."};
    S.content[t.id] = {resumo: r.resumo, pegadinhas: (r.pegadinhas || []).map(String).slice(0, 6), questoes: limparQuestoes(r.questoes), geradoEm: hoje()};
    S.resp[t.id] = {}; S.gen[t.id] = null; await putContent(t.id);
  } catch (e) { S.gen[t.id] = {err: erroTxt(e)}; render(); throw e; }
  render();
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
function responder(tid, qi, op) {
  const f = achar(tid), c = S.content[tid]; if (!f || !c) return;
  S.resp[tid] = S.resp[tid] || {}; if (S.resp[tid][qi] !== undefined) return;
  S.resp[tid][qi] = op; const q = c.questoes[qi]; const certo = op === q.gabarito;
  f.t.q.f++; if (certo) f.t.q.a++;
  if (!certo) { S.ed.erros.unshift({id: uid(), tid, mid: f.m.id, enunciado: q.enunciado.slice(0, 1200), alternativas: q.alternativas || null, marcada: op, gabarito: q.gabarito, explicacao: q.explicacao.slice(0, 800), em: hoje()}); S.ed.erros = S.ed.erros.slice(0, 300); }
  save(); render();
}
function concluirEstudo(tid) {
  const f = achar(tid); if (!f) return;
  if (f.t.st !== "novo" && f.t.em === hoje()) { S.topic = null; render(); window.scrollTo(0, 0); toast("Este tópico já foi concluído hoje."); return; } f.t.st = "estudado"; f.t.em = hoje(); agendarRevisoes(f.t); save();
  S.topic = null; render(); window.scrollTo(0, 0);
  toast(f.t.revs.some(r => r.reforco) ? "Revisão de reforço em 2 dias, depois em 7 e 30 dias." : "Revisões agendadas para amanhã, em 7 e em 30 dias.");
}
function concluirRevisao(tid) {
  const f = achar(tid); if (!f) return;
  const r = f.t.revs.find(r => !r.feita && r.due <= hoje()) || f.t.revs.find(r => !r.feita);
  if (r) { r.feita = true; r.em = hoje(); }
  const sess = Object.entries(S.resp[tid] || {});
  if (sess.length >= 3) {
    const c = S.content[tid]; const ac = sess.filter(([i, o]) => c.questoes[i] && c.questoes[i].gabarito === o).length;
    if (ac / sess.length < .6 && !f.t.revs.some(x => !x.feita && x.due <= addDias(hoje(), 3))) { f.t.revs.push({due: addDias(hoje(), 3), feita: false, reforco: true}); f.t.revs.sort((a, b) => a.due < b.due ? -1 : 1); }
  }
  save(); S.topic = null; render(); window.scrollTo(0, 0); toast("Revisão registrada.");
}
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
  S.ed = null; S.topic = null; S.confirmTroca = false; S.content = {}; S.file = null; S.colado = ""; S.pre = null;
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
  app.innerHTML = vTopo() + (S.topic ? vTopico() : S.view === "hoje" ? vHoje() : S.view === "edital" ? vEdital() : S.view === "desempenho" ? vDesempenho() : S.view === "erros" ? vErros() : vAjustes());
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
<p class="muted" style="font-size:15px">A IA lê o edital e escreve as aulas. Com a API da Anthropic ela precisa de internet; com o Ollama roda no seu computador, sem internet. Aulas já geradas funcionam offline em qualquer caso.</p>
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
<p class="muted" style="font-size:15px">Importe o arquivo .json com o edital já processado e as aulas prontas. Não precisa de chave de API nem de internet.</p>
<div class="row" style="margin-top:10px"><label class="btn" for="f-pacote" style="cursor:pointer">Importar pacote<input id="f-pacote" type="file" accept=".json,application/json" hidden></label></div></div>
${semIA ? `<p class="banner" style="margin-bottom:14px">Para o app ler um edital novo sozinho, configure a IA abaixo. Com um pacote importado, isso não é necessário.</p>` : ""}
<div class="stack">
<label class="drop" id="drop" for="f-edital"><input type="file" id="f-edital" accept=".pdf,.txt,application/pdf,text/plain">
<strong>${S.file ? "Edital selecionado" : "Escolha ou arraste o PDF do edital"}</strong>
${S.file ? `<span class="file-ok">${esc(S.file.name)}</span>` : `<span class="muted">PDF com texto selecionável, ou arquivo .txt</span>`}</label>
<details ${S.colado ? "open" : ""}><summary>Prefere colar o texto do edital?</summary><div style="margin-top:10px"><textarea id="f-colado" placeholder="Cole aqui o edital ou só o anexo de conteúdo programático">${esc(S.colado)}</textarea></div></details>
<div class="row" style="align-items:flex-end">
<div class="field"><label class="label" for="f-horas">Horas de estudo por dia</label><input id="f-horas" type="number" min="1" max="14" step="0.5" value="${esc(S.horas)}"></div>
<div class="field"><label class="label" for="f-data">Data da prova (opcional)</label><input id="f-data" type="date" value="${esc(S.dataProva)}"></div></div>
<div class="row"><button class="primary" data-act="iniciar">Montar meu plano</button><button class="ghost" data-act="exemplo">Ver com um edital de exemplo</button>
<span class="spacer"></span>${chipIA()}</div></div>
<div style="margin-top:22px">${semIA || S.cfgAberta ? vConfigIA() : `<button class="ghost" data-act="abrirCfg">Configurar IA</button>`}</div>
<div class="how">
<div><b>1 · LEITURA</b>Extrai o texto do PDF e localiza o conteúdo programático.</div>
<div><b>2 · ESTRUTURA</b>Identifica banca, cargo e data e transforma o edital em matérias e tópicos, com a incidência estimada de cada um.</div>
<div><b>3 · PLANO</b>Distribui os tópicos por dia conforme o peso de cada matéria e o seu índice de acerto.</div>
<div><b>4 · AULA</b>Gera resumo, pegadinhas e questões, salva tudo no computador e agenda revisões em 1, 7 e 30 dias.</div></div>`;
}
function vPipe() {
  const p = S.pipe; let cargos = "";
  if (p.cargos) {
    const f = (p.filtro || "").toLowerCase();
    cargos = `<div class="panel" style="margin-top:14px"><h3>Este edital tem ${p.cargos.length} cargos. Qual é o seu?</h3>
${p.cargos.length > 8 ? `<input id="f-filtro" style="margin-top:10px" placeholder="Filtrar cargos" value="${esc(p.filtro || "")}">` : ""}
<div class="cargos">${p.cargos.map((c, i) => c.toLowerCase().includes(f) ? `<button data-act="cargo" data-i="${i}">${esc(c)}</button>` : "").join("")}</div></div>`;
  }
  return `<div class="hero"><p class="label">Montando seu plano</p><h1 style="margin-top:8px">Lendo o edital</h1><p>Deixe esta página aberta. Leva de um a três minutos.</p></div>
<ol class="steps">${p.steps.map(s => `<li class="${s.st}"><span class="dot" aria-hidden="true"></span><div><strong>${esc(s.t)}</strong>${s.info ? `<div class="info">${esc(s.info)}</div>` : ""}${s.desde ? `<div class="info" data-desde="${s.desde}"></div>` : ""}</div></li>`).join("")}</ol>
${cargos}${p.falhou ? `<div class="row" style="margin-top:16px"><button class="primary" data-act="voltar">Voltar e tentar de novo</button></div>` : ""}`;
}
function vTopo() {
  const e = S.ed; const dias = e.dataProva ? diasEntre(hoje(), e.dataProva) : null;
  const revs = revisoesPendentes().length, erros = e.erros.length;
  return `${e.exemplo ? `<p class="banner" style="margin-bottom:14px">Exemplo fictício. <button class="small" data-act="trocar" style="margin-left:6px">Enviar meu edital</button></p>` : ""}
<header class="top"><div class="who"><p class="label">${esc(e.banca || "Banca não identificada")} · ${e.estilo === "CE" ? "Certo ou Errado" : "Múltipla escolha"}</p>
<h1 style="margin-top:6px">${esc(e.orgao)}</h1><p class="muted" style="margin-top:4px">${esc(e.cargo)}</p><div style="margin-top:8px">${chipIA()}</div></div>
<div class="count">${dias !== null ? `<b class="mono">${Math.max(0, dias)}</b><span class="muted">dias até a prova<br>${fmtData(e.dataProva)}</span>` : `<span class="muted">Sem data de prova</span><br><button class="small" data-act="tab" data-v="ajustes" style="margin-top:6px">Definir data</button>`}</div></header>
${!S.topic ? `<nav class="tabs" role="tablist">${[["hoje", "Hoje" + (revs ? ` · ${revs} rev.` : "")], ["edital", "Edital verticalizado"], ["desempenho", "Desempenho"], ["erros", "Caderno de erros" + (erros ? ` · ${erros}` : "")], ["ajustes", "Ajustes"]].map(([k, t]) => `<button role="tab" data-act="tab" data-v="${k}" aria-current="${S.view === k}">${t}</button>`).join("")}</nav>` : ""}`;
}
function vHoje() {
  const e = S.ed, h = hoje(), revs = revisoesPendentes(), blocos = blocosDia();
  const q = fila(); const novos = Math.max(1, blocos - Math.floor(revs.length * 15 / 50));
  const feitosHoje = []; e.materias.forEach(m => m.topicos.forEach(t => { if (t.em === h) feitosHoje.push({m, t}); }));
  const lista = q.slice(0, Math.max(0, novos - feitosHoje.length));
  const total = e.materias.reduce((s, m) => s + m.topicos.length, 0), estud = total - q.length;
  let f = 0, a = 0; e.materias.forEach(m => m.topicos.forEach(t => { const T = qt(t); f += T.f; a += T.a; }));
  const diasNec = Math.ceil(q.length / blocos), dias = e.dataProva ? diasEntre(h, e.dataProva) : null;
  let proj;
  if (q.length === 0) proj = "Você passou por todos os tópicos do edital. Agora o plano é revisar e fazer questões.";
  else if (dias === null) proj = `No ritmo de ${blocos} blocos por dia, você termina a primeira passada pelo edital em ${diasNec} dias.`;
  else if (diasNec <= dias) proj = `No ritmo atual você fecha o edital em ${diasNec} dias e sobram ${dias - diasNec} para revisão final.`;
  else proj = `No ritmo atual faltariam ${diasNec - dias} dias para fechar o edital. O plano já prioriza os tópicos de incidência alta; considere aumentar as horas diárias em Ajustes.`;
  const item = (x, tag, cls, act) => `<button class="item" data-act="${act}" data-t="${x.t.id}"><span class="tag ${cls}">${tag}</span><span class="t"><strong>${esc(x.t.nome)}</strong><span>${esc(x.m.nome)} · ${INC_TXT[x.t.inc]}${S.temAula.has(x.t.id) ? ` · <span class="off-tag">aula salva</span>` : ""}</span></span><span class="muted" aria-hidden="true">›</span></button>`;
  return `<div class="kpis">
<div class="kpi"><span class="label">Edital coberto</span><b class="mono">${pct(estud, total)}%</b><small>${estud} de ${total} tópicos</small></div>
<div class="kpi"><span class="label">Acerto geral</span><b class="mono">${f ? pct(a, f) + "%" : "—"}</b><small>${f} questões resolvidas</small></div>
<div class="kpi"><span class="label">Aulas salvas</span><b class="mono">${S.temAula.size}/${total}</b><small>disponíveis sem internet</small></div></div>
<div class="section"><div class="row"><h2>Revisões de hoje</h2><span class="spacer"></span><span class="muted">${revs.length ? revs.length + " pendente(s)" : ""}</span></div>
${revs.length ? `<div class="list">${revs.map(x => item(x, x.atraso > 0 ? `atrasada ${x.atraso}d` : (x.r.reforco ? "reforço" : "revisão"), "rev", "abrirRev")).join("")}</div>` : `<div class="list"><p class="empty">Nenhuma revisão para hoje. Elas aparecem aqui 1, 7 e 30 dias depois de cada tópico estudado.</p></div>`}</div>
${pendentesQC().length ? `<div class="section"><div class="row"><h2>Lançar desempenho do QConcursos</h2></div><p class="note" style="margin:0 0 10px">Quantas questões você resolveu destes tópicos estudados nos últimos dias?</p>
<div class="stack">${pendentesQC().map(x => `<div class="panel"><strong>${esc(x.t.nome)}</strong><div class="muted" style="font-size:13px;margin-bottom:8px">${esc(x.m.nome)} · filtro: ${esc(filtroQC(x.t, x.m))}</div>${vQCForm(x.t, "h", `<button data-act="qcReg" data-t="${x.t.id}" data-pre="h">Registrar</button><button class="ghost" data-act="qcPular" data-t="${x.t.id}">Não fiz</button>`)}</div>`).join("")}</div></div>` : ""}
<div class="section"><div class="row"><h2>Tópicos novos</h2><span class="spacer"></span><span class="muted">${Math.max(0, novos - feitosHoje.length)} de ${novos} restantes · ${blocos}×50 min</span></div>
<div class="list">${feitosHoje.map(x => item(x, "feito hoje", "done", "abrir")).join("")}${lista.map((x, i) => item(x, "bloco " + (feitosHoje.length + i + 1), "", "abrir")).join("")}
${!lista.length && !feitosHoje.length ? `<p class="empty">Nenhum tópico novo pendente.</p>` : ""}</div>
<p class="note">${esc(proj)}</p></div>
${e.dicas ? `<div class="section"><h2 style="margin-bottom:10px">Como a banca cobra</h2><div class="doc"><p>${esc(e.dicas)}</p></div></div>` : ""}`;
}
function bolinhas(m) {
  return `<div class="bubbles" aria-hidden="true">${m.topicos.map(t => { const acc = accTop(t); const c = t.st === "novo" ? "" : (acc !== null && qt(t).f >= 3 && acc < .6 ? "f" : t.revs.length && t.revs.every(r => r.feita) ? "r" : "s"); return `<span class="bub ${c}" title="${esc(t.nome)}"></span>`; }).join("")}</div>`;
}
function vEdital() {
  return `<div class="legend"><span><i class="bub"></i>a estudar</span><span><i class="bub s"></i>estudado</span><span><i class="bub r"></i>revisões concluídas</span><span><i class="bub f"></i>acerto abaixo de 60%</span></div>
<div>${S.ed.materias.map(m => {
    const est = m.topicos.filter(t => t.st !== "novo").length; const acc = accMat(m);
    return `<details class="mat"><summary><div class="row"><h3>${esc(m.nome)}</h3><span class="spacer"></span><span class="muted mono" style="font-size:14px">${m.questoes ? m.questoes + " questões · " : ""}${est}/${m.topicos.length}${acc !== null ? " · " + Math.round(acc * 100) + "% acerto" : ""}</span></div>${bolinhas(m)}</summary>
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
  return `<div class="section"><h2 style="margin-bottom:12px">Acerto por matéria</h2><div class="panel"><div class="bars">${rows.map(r => {
    const acc = r.f ? r.a / r.f : null;
    return `<div class="bar"><span class="nm">${esc(r.m.nome)}</span><span class="mono" style="text-align:right">${acc === null ? "—" : Math.round(acc * 100) + "%"}</span><div class="track"><i style="width:${acc === null ? 0 : Math.round(acc * 100)}%;background:${cor(acc)}"></i></div><span class="muted" style="font-size:13px;grid-column:1/-1">${r.f} questões${r.qc ? ` (${r.qc} no QConcursos)` : ""} · ${r.est} de ${r.tot} tópicos estudados</span></div>`;
  }).join("")}</div></div></div>
<div class="section"><h2 style="margin-bottom:12px">Cobertura do edital</h2><div class="panel"><div class="bars">${rows.map(r => `<div class="bar"><span class="nm">${esc(r.m.nome)}</span><span class="mono" style="text-align:right">${pct(r.est, r.tot)}%</span><div class="track"><i style="width:${pct(r.est, r.tot)}%;background:var(--accent)"></i></div></div>`).join("")}</div></div>
<p class="note">${atrasadas ? `${atrasadas} revisão(ões) atrasada(s). Elas aparecem primeiro na aba Hoje.` : "Nenhuma revisão atrasada."}</p></div>
<div class="section"><h2 style="margin-bottom:12px">Tópicos para reforçar</h2><div class="list">${fracos.length ? fracos.sort((a, b) => a.acc - b.acc).map(x => `<button class="item" data-act="abrirRev" data-t="${x.t.id}"><span class="chip bad">${Math.round(x.acc * 100)}%</span><span class="t"><strong>${esc(x.t.nome)}</strong><span>${esc(x.m.nome)} · ${txtQ(x.t)}</span></span><span class="muted">›</span></button>`).join("") : `<p class="empty">Os tópicos com acerto abaixo de 60% (a partir de 3 questões) aparecem aqui e ganham mais tempo no plano.</p>`}</div></div>`;
}
function vErros() {
  const e = S.ed; if (!e.erros.length) return `<div class="list"><p class="empty">Cada questão que você errar entra aqui com o gabarito comentado.</p></div>`;
  return `<div class="stack">${e.erros.map(x => {
    const f = achar(x.tid);
    return `<div class="q"><div class="row"><span class="label">${esc(f ? f.m.nome : "")}</span><span class="spacer"></span><span class="muted mono" style="font-size:13px">${fmtData(x.em)}</span></div>
<p class="enun">${esc(x.enunciado)}</p>
${x.alternativas ? `<div class="opts">${x.alternativas.map((a, i) => { const L = "ABCDE"[i]; return `<div class="opt btn ${L === x.gabarito ? "right" : L === x.marcada ? "wrong" : ""}"><span class="l">${L}</span><span>${esc(a)}</span></div>`; }).join("")}</div>` : `<p><span class="chip bad">Você marcou ${x.marcada === "C" ? "Certo" : "Errado"}</span> <span class="chip ok">Gabarito: ${x.gabarito === "C" ? "Certo" : "Errado"}</span></p>`}
<div class="expl">${esc(x.explicacao)}</div>
<div class="row" style="margin-top:10px">${f ? `<button class="small" data-act="abrirRev" data-t="${x.tid}">Abrir o tópico</button>` : ""}<span class="spacer"></span><button class="small ghost" data-act="tirarErro" data-id="${x.id}">Já aprendi, remover</button></div></div>`;
  }).join("")}</div>`;
}
function vAjustes() {
  const e = S.ed, total = e.materias.reduce((s, m) => s + m.topicos.length, 0), p = S.pre;
  return `<div class="panel"><h3>Plano</h3><div class="settings" style="margin-top:10px">
<div class="field"><label class="label" for="a-horas">Horas por dia</label><input id="a-horas" type="number" min="1" max="14" step="0.5" value="${esc(e.horas)}"></div>
<div class="field"><label class="label" for="a-data">Data da prova</label><input id="a-data" type="date" value="${esc(e.dataProva || "")}"></div></div>
<button class="primary" data-act="salvarAjustes">Salvar e recalcular</button></div>
<div class="panel"><h3>Estudar sem internet</h3>
<p class="muted" style="font-size:15px">Gera e salva agora a aula de todos os tópicos (${S.temAula.size} de ${total} já salvas). Depois disso, resumos e questões abrem sem conexão. ${S.iaStatus && S.iaStatus.provedor === "anthropic" ? "Cada aula consome créditos da sua API." : ""}</p>
${p && p.run ? `<div class="prog"><i style="width:${pct(p.feitos, p.total)}%"></i></div><div class="row"><span class="mono">${p.feitos}/${p.total} aulas</span><span class="spacer"></span><button class="small" data-act="pararPre">Parar</button></div>`
  : `<div class="row" style="margin-top:10px"><button data-act="preGerar" ${!S.iaStatus || !S.iaStatus.provedor || S.temAula.size >= total ? "disabled" : ""}>Salvar todas as aulas</button>${p && p.erro ? `<span style="color:var(--bad)">${esc(p.erro)}</span>` : ""}</div>`}</div>
${vConfigIA()}
<div class="panel"><h3>Backup</h3><p class="muted" style="font-size:15px">Leve seu progresso para outro computador ou guarde uma cópia.</p>
<div class="row" style="margin-top:10px"><a class="btn" href="/api/backup" download>Baixar backup</a>
<label class="btn" for="f-backup" style="cursor:pointer">Restaurar backup ou importar pacote<input id="f-backup" type="file" accept=".json,application/json" hidden></label></div></div>
<div class="panel"><h3>Edital</h3><div class="row" style="margin-top:8px">
${S.confirmTroca ? `<span>Abrir outro edital? Este fica guardado.</span><button class="small" data-act="trocar">Sim</button><button class="small ghost" data-act="cancelTroca">Cancelar</button>` : `<button data-act="pedirTroca">Abrir ou enviar outro edital</button>`}</div></div>`;
}
function vTopico() {
  const f = achar(S.topic.tid); if (!f) { S.topic = null; return vHoje(); }
  const {m, t} = f, c = S.content[t.id], g = S.gen[t.id], gq = S.gen["q_" + t.id], resp = S.resp[t.id] || {};
  const rev = S.topic.modo === "revisao";
  let corpo;
  if (c) {
    corpo = `<div class="section"><h2 style="margin-bottom:10px">Resumo</h2><div class="doc">${md(c.resumo)}</div></div>
${c.pegadinhas && c.pegadinhas.length ? `<div class="section"><h2 style="margin-bottom:10px">Pegadinhas da banca</h2><ul class="pegas">${c.pegadinhas.map(p => `<li>${esc(p)}</li>`).join("")}</ul></div>` : ""}
<div class="section"><div class="row" style="margin-bottom:10px"><h2>Questões</h2><span class="spacer"></span><span class="muted mono">${t.q.a}/${t.q.f} no app</span></div>
<div class="stack">${c.questoes.map((q, i) => vQuestao(t.id, q, i, resp[i])).join("")}</div>
<div style="margin-top:12px">${gq && gq.run ? `<div class="gen"><span class="spin"></span><span>Criando novas questões… <span data-desde="${gq.desde}"></span></span></div>` : `<button data-act="mais" data-t="${t.id}">Gerar mais 5 questões</button>`}
${gq && gq.err ? `<p class="note" style="color:var(--bad)">${esc(gq.err)}</p>` : ""}</div></div>
<p class="note">Material gerado por IA a partir do tópico do edital. Confira a redação atual da lei antes de memorizar detalhes.</p>`;
  } else if (g && g.err) corpo = `<div class="gen" style="border-color:var(--bad);color:var(--bad)">${esc(g.err)}</div><div class="row" style="margin:10px 0 26px"><button data-act="refazer" data-t="${t.id}">Tentar de novo</button></div>`;
  else corpo = `<div class="gen"><span class="spin"></span><span>Preparando a aula deste tópico. Leva de 20 a 60 segundos. ${g && g.desde ? `<span data-desde="${g.desde}"></span>` : ""}</span></div>`;
  const prox = t.revs.find(r => !r.feita);
  return `<button class="ghost back" data-act="fechar">‹ Voltar</button>
<p class="label">${esc(m.nome)}</p><h1 style="margin:6px 0 10px">${esc(t.nome)}</h1>
<div class="row" style="margin-bottom:22px"><span class="chip ${t.inc === "alta" ? "alta" : ""}">${INC_TXT[t.inc]}</span>${t.st !== "novo" ? `<span class="chip ok">Estudado em ${fmtData(t.em)}</span>` : ""}${prox ? `<span class="chip warn">Próxima revisão ${fmtData(prox.due)}</span>` : ""}</div>
${corpo}
${S.concluindo === t.id ? "" : vQCTopico(t, m)}
<div class="actions">${S.concluindo === t.id
  ? `<div class="stack" style="width:100%"><strong>Antes de concluir: resolveu questões deste tópico no QConcursos?</strong>
${vQCForm(t, "c", `<button class="primary" data-act="qcConcluir" data-t="${t.id}">Registrar e concluir</button><button data-act="concluirDireto" data-t="${t.id}">Não fiz, só concluir</button><button class="ghost" data-act="cancelConcluir">Cancelar</button>`)}</div>`
  : `${rev ? `<button class="primary" data-act="pedirConcluir" data-t="${t.id}">Concluir revisão</button>` : `<button class="primary" data-act="pedirConcluir" data-t="${t.id}">Marcar como estudado</button>`}
${c ? `<button class="ghost" data-act="refazer" data-t="${t.id}">Refazer aula</button>` : ""}`}</div>`;
}
function filtroQC(t, m) { return t.qcFiltro || [S.ed.banca, m.nome, t.nome].filter(Boolean).join(" · "); }
function vQCForm(t, pre, botoes) {
  return `<div class="row qcform" style="align-items:flex-end"><div class="field qcn"><label class="label" for="${pre}f-${t.id}">Questões feitas</label><input id="${pre}f-${t.id}" type="number" min="1" inputmode="numeric"></div>
<div class="field qcn"><label class="label" for="${pre}a-${t.id}">Acertos</label><input id="${pre}a-${t.id}" type="number" min="0" inputmode="numeric"></div>${botoes}</div>`;
}
function vQCTopico(t, m) {
  const s = (t.qc && t.qc.s) || [];
  return `<div class="section"><h2 style="margin-bottom:10px">No QConcursos</h2><div class="panel stack">
<div><span class="label">Filtro sugerido</span><div class="row" style="margin-top:4px"><span class="mono" style="font-size:14px;overflow-wrap:anywhere;min-width:0">${esc(filtroQC(t, m))}</span>
<button class="small" data-act="copiarFiltro" data-t="${t.id}">Copiar</button><a class="btn small" href="https://www.qconcursos.com" target="_blank" rel="noopener">Abrir o QConcursos</a></div></div>
${vQCForm(t, "t", `<button data-act="qcReg" data-t="${t.id}" data-pre="t">Registrar</button>`)}
<p class="muted" style="font-size:14px">${s.length ? `Registrado: ${t.qc.a}/${t.qc.f} acertos (${pct(t.qc.a, t.qc.f)}%) em ${s.length} sessão(ões), a última em ${fmtData(s[s.length - 1].d)}.` : "Nenhuma sessão registrada ainda. O acerto daqui entra no plano e nas revisões."}</p></div></div>`;
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
function vQuestao(tid, q, i, r) {
  const resp = r !== undefined; const certo = resp && r === q.gabarito;
  const cls = L => resp ? (L === q.gabarito ? "right" : L === r ? "wrong" : "") : "";
  const opts = q.alternativas
    ? `<div class="opts">${q.alternativas.map((a, k) => { const L = "ABCDE"[k]; return `<button class="opt ${cls(L)}" data-act="resp" data-t="${tid}" data-i="${i}" data-o="${L}" ${resp ? "disabled" : ""}><span class="l">${L}</span><span>${esc(a)}</span></button>`; }).join("")}</div>`
    : `<div class="ce">${["C", "E"].map(L => `<button class="opt ${cls(L)}" data-act="resp" data-t="${tid}" data-i="${i}" data-o="${L}" ${resp ? "disabled" : ""}><span class="l">${L}</span><span>${L === "C" ? "Certo" : "Errado"}</span></button>`).join("")}</div>`;
  return `<div class="q"><span class="label">${q.alternativas ? "Questão" : "Item"} ${i + 1}</span><p class="enun">${esc(q.enunciado)}</p>${opts}
${resp ? `<div class="expl"><strong style="color:${certo ? "var(--ok)" : "var(--bad)"}">${certo ? "Acertou." : "Errou. Gabarito: " + (q.alternativas ? q.gabarito : (q.gabarito === "C" ? "Certo" : "Errado")) + "."}</strong> ${esc(q.explicacao)}</div>` : ""}</div>`;
}
/* cronômetro dos itens em andamento */
setInterval(() => document.querySelectorAll("[data-desde]").forEach(el => { const s = Math.round((Date.now() - +el.dataset.desde) / 1000); el.textContent = s + " s"; }), 1000);

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
  else if (a === "tirarErro") { S.ed.erros = S.ed.erros.filter(x => x.id !== b.dataset.id); save(); render(); }
  else if (a === "salvarAjustes") { const h = parseFloat($("#a-horas").value); const d = $("#a-data").value; if (h > 0) S.ed.horas = h; S.ed.dataProva = d || null; save(); S.view = "hoje"; render(); toast("Plano recalculado."); }
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
  if (t.id === "f-colado") S.colado = t.value;
  else if (t.id === "f-filtro") { S.pipe.filtro = t.value; const pos = t.selectionStart; render(); const n = $("#f-filtro"); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} } }
});
["dragover", "dragenter"].forEach(n => document.addEventListener(n, ev => { const d = ev.target.closest && ev.target.closest("#drop"); if (d) { ev.preventDefault(); d.classList.add("over"); } }));
document.addEventListener("dragleave", ev => { const d = ev.target.closest && ev.target.closest("#drop"); if (d) d.classList.remove("over"); });
document.addEventListener("drop", ev => { const d = ev.target.closest && ev.target.closest("#drop"); if (!d) return; ev.preventDefault(); const f = ev.dataTransfer.files && ev.dataTransfer.files[0]; if (f) { S.file = f; render(); } });
window.addEventListener("pagehide", () => { if (dirty && S.ed) navigator.sendBeacon && fetch("/api/editais/" + S.ed.id, {method: "PUT", keepalive: true, headers: {"content-type": "application/json"}, body: JSON.stringify(S.ed)}); });
init();
