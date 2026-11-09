package br.rotadoedital.ui

import android.app.Application
import android.os.Build
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import br.rotadoedital.RotaApp
import br.rotadoedital.dados.Conexao
import br.rotadoedital.dados.ErroApi
import br.rotadoedital.dados.b
import br.rotadoedital.dados.i
import br.rotadoedital.dados.s
import br.rotadoedital.dominio.Estudo
import br.rotadoedital.dominio.Obj
import br.rotadoedital.dominio.Questao
import br.rotadoedital.dominio.b as ob
import br.rotadoedital.dominio.i as oi
import br.rotadoedital.dominio.mut
import br.rotadoedital.dominio.n
import br.rotadoedital.dominio.obj
import br.rotadoedital.dominio.objs
import br.rotadoedital.dominio.s as os_
import br.rotadoedital.sync.EstadoSync
import br.rotadoedital.sync.Sincronia
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import java.time.LocalDate
import java.util.UUID

/** Tudo que as telas mostram, calculado fora da main thread a partir do edital. */
@OptIn(ExperimentalCoroutinesApi::class)
class EstudoViewModel(app: Application) : AndroidViewModel(app) {
    private val repo = (app as RotaApp).repo
    private val ctx = app

    val conexao: StateFlow<Conexao?> = repo.prefs.conexao.stateIn(viewModelScope, SharingStarted.Eagerly, null)
    val sync: StateFlow<EstadoSync> = Sincronia.estado(app).stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), EstadoSync(false, null, 0, 0))
    val tema: StateFlow<String> = repo.prefs.tema.stateIn(viewModelScope, SharingStarted.Eagerly, "sistema")

    private val _avisos = MutableSharedFlow<String>(extraBufferCapacity = 4)
    val avisos = _avisos.asSharedFlow()

    private val ativo = combine(repo.ativo, repo.idsEditais) { a, ids -> a?.takeIf { it in ids } ?: ids.firstOrNull() }

    val tela: StateFlow<Tela> = ativo.flatMapLatest { id ->
        if (id == null) flowOf(Tela.SemDados)
        else combine(repo.edital(id), repo.aulasSalvas(id), repo.materiais(id)) { doc, aulas, mats ->
            if (doc == null) Tela.SemDados else Tela.Pronto(montar(id, doc, aulas, mats))
        }
    }.flowOn(Dispatchers.Default).stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), Tela.Carregando)

    // ------------------------------------------------------------------ ações
    fun sincronizarAgora() = Sincronia.agora(ctx)

    fun conectar(endereco: String, codigo: String, pronto: () -> Unit) = viewModelScope.launch {
        try {
            val nome = "Android · " + (Build.MODEL ?: "celular")
            val token = repo.api.parear(endereco.trim(), codigo.trim().uppercase(), nome)
            repo.prefs.parear(endereco.trim(), token)
            Sincronia.agora(ctx); Sincronia.periodica(ctx)
            pronto()
        } catch (e: ErroApi) { _avisos.tryEmit(e.message ?: "Não consegui conectar."); pronto() }
        catch (e: Exception) { _avisos.tryEmit("Não consegui conectar: resposta inesperada do PC."); pronto() }
    }

    fun desconectar() = viewModelScope.launch { repo.prefs.esquecerToken(); Sincronia.cancelarTudo(ctx) }
    fun definirTema(t: String) = viewModelScope.launch { repo.prefs.definirTema(t) }

    private fun ed(): String? = (tela.value as? Tela.Pronto)?.d?.id
    private fun editar(acao: (Estudo) -> String?) = viewModelScope.launch {
        val id = ed() ?: return@launch
        repo.editar(id, acao)?.let { if (it.isNotBlank()) _avisos.tryEmit(it) }
    }

    fun concluirEstudo(tid: String) = editar { it.concluirEstudo(tid) }
    fun concluirRevisao(tid: String, n: Int, acc: Double?) = editar { it.concluirRevisao(tid, n, acc) }
    fun tempoHoje(min: Int) = editar { it.tempoHoje(min); null }
    fun refazerErro(id: String, op: String) = editar { it.refazerErro(id, op) }
    fun tipoErro(id: String, tipo: String) = editar { it.tipoErro(id, tipo); null }
    fun ajustes(horas: Double, dataProva: String?, seEntao: String) = editar { e ->
        e.ed["horas"] = horas; e.ed["dataProva"] = dataProva
        if (seEntao.isBlank()) e.ed.remove("seEntao") else e.ed["seEntao"] = seEntao.trim().take(200)
        "Plano recalculado."
    }

    /** Registra uma resposta; devolve se acertou (para o feedback imediato). */
    fun responder(tid: String, q: Questao, op: String, conf: String?, pre: Boolean) = editar { e ->
        val certo = e.responder(tid, q, op, conf, pre) { UUID.randomUUID().toString().take(8) }
        if (!certo && conf == "certeza" && !pre) "Erro com certeza: leia a explicação com calma. É o tipo de erro que mais vale corrigir agora." else null
    }

    suspend fun aula(tid: String): AulaUi? = ed()?.let { id -> repo.aula(id, tid)?.let(::aulaUi) }

    fun registrarSimulado(mat: MaterialUi, acertos: Int) = viewModelScope.launch {
        val id = ed() ?: return@launch
        repo.registrarSimulado(id, mat.bruto, acertos, mat.respostas.size, LocalDate.now().toString())
        _avisos.tryEmit("Simulado registrado: $acertos/${mat.respostas.size}.")
    }

    fun arquivoPdf(mat: MaterialUi) = ed()?.let { repo.arquivo(it, mat.arquivo) }

    /** Treino misto: até 10 questões de tópicos estudados, sorteadas pelo peso. */
    suspend fun montarTreino(): List<ItemTreino> {
        val d = (tela.value as? Tela.Pronto)?.d ?: return emptyList()
        val estud = d.materias.flatMap { m -> m.topicos.filter { it.estudado && it.temAula }.map { m to it } }
        if (estud.size < 2) return emptyList()
        val aulas = repo.aulas(d.id, estud.map { it.second.id })
        val pool = estud.toMutableList(); val escolhidos = ArrayList<Pair<MateriaUi, TopicoUi>>()
        while (pool.isNotEmpty() && escolhidos.size < 10) {
            val tot = pool.sumOf { it.second.pesoTreino }; var r = Math.random() * tot; var i = 0
            while (r > pool[i].second.pesoTreino && i < pool.size - 1) { r -= pool[i].second.pesoTreino; i++ }
            escolhidos.add(pool.removeAt(i))
        }
        val itens = ArrayList<ItemTreino>()
        for (volta in 0 until 3) for ((m, t) in escolhidos) {
            if (itens.size >= 10) break
            val qs = aulas[t.id]?.let { aulaUi(it).questoes } ?: continue
            val livres = qs.indices.filter { qi -> itens.none { it.tid == t.id && it.qi == qi } }
            if (livres.isEmpty()) continue
            val qi = livres.random(); itens.add(ItemTreino(t.id, qi, m.nome, qs[qi]))
        }
        return itens.shuffled()
    }

    // ------------------------------------------------------------------ montagem do estado
    private fun montar(id: String, doc: JsonObject, aulas: Set<String>, mats: List<JsonObject>): Dados {
        @Suppress("UNCHECKED_CAST")
        val e = Estudo(doc.mut() as Obj)
        val materiais = mats.map(::materialUi)
        val pdfsPorTopico = HashMap<String, Int>()
        materiais.forEach { m -> m.usos.mapNotNull { it.tid }.toSet().forEach { pdfsPorTopico[it] = (pdfsPorTopico[it] ?: 0) + 1 } }
        val mats_ = e.materias().map { m ->
            val tops = m.objs("topicos").map { t ->
                val (f, a) = e.qt(t)
                TopicoUi(t.os_("id")!!, t.os_("nome") ?: "", m.os_("nome") ?: "", t.os_("inc") ?: "media", t.os_("st") != "novo",
                    t.os_("em"), f, a, t.objs("revs").firstOrNull { !it.ob("feita") }?.os_("due"), e.revsFeitas(t),
                    t.os_("id") in aulas, pdfsPorTopico[t.os_("id")] ?: 0, e.pesoTreino(t))
            }
            MateriaUi(m.os_("id")!!, m.os_("nome") ?: "", m.oi("questoes"), tops, e.accMat(m))
        }
        val porId = mats_.flatMap { it.topicos }.associateBy { it.id }
        val p = e.planoDia()
        val item = { mt: Pair<Obj, Obj> -> porId[mt.second.os_("id")]!! }
        val revsHoje = p.revs.take(p.nRev).map { ItemPlano(porId[it.t.os_("id")]!!, if (it.atraso > 0) "atrasada ${it.atraso}d" else if (it.r.ob("reforco")) "reforço" else "revisão", Tipo.REVISAO) }
        val novos = p.lista.mapIndexed { i, x -> ItemPlano(item(x), "bloco ${p.feitosHoje.size + i + 1}", Tipo.NOVO) }
        val total = mats_.sumOf { it.topicos.size }; val estud = mats_.sumOf { m -> m.topicos.count { it.estudado } }
        var f = 0; var a = 0; mats_.forEach { m -> m.topicos.forEach { f += it.feitas; a += it.acertos } }
        val restantes = e.fila().size; val diasNec = if (restantes == 0) 0 else (restantes + e.blocosDia() - 1) / e.blocosDia()
        val proj = when {
            restantes == 0 -> "Você passou por todos os tópicos. Agora é revisar, refazer erros e treinar questões misturadas."
            p.dias == null -> "No ritmo de ${e.blocosDia()} blocos por dia, a primeira passada pelo edital termina em $diasNec dias."
            diasNec <= p.dias -> "No ritmo atual você fecha o edital em $diasNec dias e sobram ${p.dias - diasNec} para revisão final."
            else -> "No ritmo atual faltariam ${diasNec - p.dias} dias para fechar o edital. Nas duas últimas semanas só entram tópicos de incidência alta."
        }
        val erros = e.ed.objs("erros").map { x ->
            ErroUi(x.os_("id") ?: "", x.os_("tid"), porId[x.os_("tid")]?.materia ?: "", porId[x.os_("tid")]?.nome ?: "", x.os_("enunciado") ?: "",
                (x["alternativas"] as? List<*>)?.map { it.toString() }, x.os_("gabarito") ?: "", x.os_("marcada"), x.os_("explicacao") ?: "",
                x.os_("conf"), x.ob("sorte"), x.oi("ok"), x.ob("dom"), e.errDue(x), x.os_("tipo"))
        }
        val cal = (e.ed.obj("cal") ?: obj()).let { c -> listOf("certeza", "duvida", "chute").mapNotNull { k -> c.obj(k)?.let { Calib(k, it.oi("f"), it.oi("a")) }?.takeIf { it.f > 0 } } }
        val ativ = (e.ed.obj("ativ") ?: obj()).mapValues { (it.value as? Number)?.toInt() ?: 0 }
        return Dados(
            id = id, orgao = e.ed.os_("orgao") ?: "", cargo = e.ed.os_("cargo") ?: "", banca = e.ed.os_("banca") ?: "", estiloCE = e.ed.os_("estilo") == "CE",
            dataProva = e.ed.os_("dataProva"), diasProva = p.dias, horas = e.horas(), seEntao = e.ed.os_("seEntao"),
            materias = mats_, revsHoje = revsHoje, revsTotal = p.revs.size, feitosHoje = p.feitosHoje.map { item(it) }, revFeitasHoje = p.revFeitasHoje.map { item(it) },
            novos = novos, novosPlanejados = p.novos, errosHoje = p.errs.size, minErr = p.minErr, minHoje = p.min, retaFinal = p.retaFinal,
            cobertura = if (total > 0) Math.round(estud * 100.0 / total).toInt() else 0, estudados = estud, totalTopicos = total, questoes = f, acertos = a,
            projecao = proj, erros = erros, calib = cal, ativ = ativ, materiais = materiais, aulasSalvas = aulas.size,
        )
    }

    private fun aulaUi(o: JsonObject) = AulaUi(
        o.s("resumo") ?: "",
        (o["pegadinhas"] as? JsonArray)?.map { (it as JsonPrimitive).content } ?: emptyList(),
        (o["porques"] as? JsonArray)?.map { val x = it.jsonObject; (x.s("p") ?: "") to (x.s("r") ?: "") } ?: emptyList(),
        (o["questoes"] as? JsonArray)?.map { el ->
            val q = el.jsonObject
            Questao(q.s("enunciado") ?: "", (q["alternativas"] as? JsonArray)?.map { (it as JsonPrimitive).content }, q.s("gabarito") ?: "", q.s("explicacao") ?: "")
        } ?: emptyList(),
    )

    private fun materialUi(o: JsonObject): MaterialUi = MaterialUi(
        id = o.s("id") ?: "", titulo = o.s("titulo") ?: "", tipo = o.s("tipo") ?: "outro", fonte = o.s("fonte") ?: "", arquivo = o.s("arquivo") ?: "",
        paginas = o.i("paginas"), resumo = o.s("resumo"),
        usos = (o["usos"] as? JsonArray)?.map { el ->
            val u = el.jsonObject
            UsoUi(u.s("tid"), u.s("pag"), u.s("quando") ?: "consulta", u.s("nota"), (u["questoes"] as? JsonArray)?.map { (it as JsonPrimitive).content.toInt() } ?: emptyList())
        } ?: emptyList(),
        gabaritoDe = (o["gab"] as? JsonObject)?.s("id"),
        respostas = (o["respostas"] as? JsonObject)?.mapValues { (it.value as JsonPrimitive).content } ?: emptyMap(),
        simulados = (o["simulados"] as? JsonArray)?.map { val s = it.jsonObject; Triple(s.s("d") ?: "", s.i("a"), s.i("n")) } ?: emptyList(),
        bruto = o,
    )
}

sealed interface Tela {
    data object Carregando : Tela
    data object SemDados : Tela
    data class Pronto(val d: Dados) : Tela
}
