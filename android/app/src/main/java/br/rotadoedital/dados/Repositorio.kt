package br.rotadoedital.dados

import android.content.Context
import br.rotadoedital.dominio.Estudo
import br.rotadoedital.dominio.Obj
import br.rotadoedital.dominio.mut
import br.rotadoedital.dominio.paraJson
import br.rotadoedital.sync.Sincronia
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File

/**
 * Fonte única dos dados no celular. A UI lê do Room (funciona offline); o SyncWorker
 * troca as mudanças com o PC. Edições do edital passam por um mutex para não colidirem
 * com a gravação do resultado da sincronização.
 */
class Repositorio(private val ctx: Context, private val db: Banco, val prefs: Prefs, val api: Api) {
    private val trava = Mutex()
    private val json = Json { ignoreUnknownKeys = true }

    val ativo: Flow<String?> = prefs.ativo
    val idsEditais: Flow<List<String>> = db.editais().ids()

    fun edital(id: String): Flow<JsonObject?> = db.editais().observar(id)
        .map { it?.json }.distinctUntilChanged()
        .map { s -> s?.let { json.parseToJsonElement(it).jsonObject } }
        .flowOn(Dispatchers.Default)

    fun aulasSalvas(ed: String): Flow<Set<String>> = db.aulas().tids(ed).map { it.toSet() }
    suspend fun aula(ed: String, tid: String): JsonObject? = withContext(Dispatchers.IO) {
        db.aulas().ler(ed, tid)?.let { json.parseToJsonElement(it.json).jsonObject }
    }
    suspend fun aulas(ed: String, tids: List<String>): Map<String, JsonObject> = withContext(Dispatchers.IO) {
        db.aulas().varias(ed, tids).associate { it.tid to json.parseToJsonElement(it.json).jsonObject }
    }
    fun materiais(ed: String): Flow<List<JsonObject>> = db.materiais().observar(ed)
        .map { l -> l.map { json.parseToJsonElement(it.json).jsonObject } }.flowOn(Dispatchers.Default)
    fun arquivo(ed: String, arquivo: String) = File(ctx.filesDir, "materiais/$ed/$arquivo")

    /** Aplica uma ação de estudo ao edital, grava e agenda a sincronização. */
    suspend fun <T> editar(id: String, acao: (Estudo) -> T): T? = withContext(Dispatchers.Default) {
        val r = trava.withLock {
            val e = db.editais().ler(id) ?: return@withLock null
            @Suppress("UNCHECKED_CAST")
            val doc = json.parseToJsonElement(e.json).mut() as Obj
            val res = acao(Estudo(doc))
            db.editais().gravar(e.copy(json = doc.paraJson().toString(), sujo = true, versao = e.versao + 1))
            Holder(res)
        }
        if (r != null) Sincronia.agendarEmBreve(ctx)
        r?.v
    }
    private class Holder<T>(val v: T)

    suspend fun registrarSimulado(ed: String, mat: JsonObject, acertos: Int, total: Int, hoje: String) = withContext(Dispatchers.IO) {
        val sims = (mat["simulados"] as? JsonArray).orEmpty() + JsonObject(mapOf("d" to JsonPrimitive(hoje), "a" to JsonPrimitive(acertos), "n" to JsonPrimitive(total)))
        val novo = JsonObject(mat + ("simulados" to JsonArray(sims.takeLast(20))))
        val ent = db.materiais().lista(ed).first { it.id == mat.s("id") }
        db.materiais().gravar(ent.copy(json = novo.toString(), sujo = true))
        Sincronia.agendarEmBreve(ctx)
    }

    suspend fun definirAtivo(id: String) = prefs.definirAtivo(id)

    // ------------------------------------------------------------------ sincronização
    data class Resumo(val pdfsFaltando: Int)

    /** Troca editais, aulas e materiais com o PC. Chamado pelo SyncWorker. */
    suspend fun sincronizar(progresso: suspend (String, Int, Int) -> Unit): Resumo = withContext(Dispatchers.IO) {
        val est = api.estado()
        val remotos = est["editais"]!!.jsonArray.map { it.jsonObject }
        progresso("editais", 0, remotos.size)
        for (r in remotos) sincronizarEdital(r.s("id")!!, r.i("rev"))
        if (prefs.ativoAgora() == null) (est["ativo"] as? JsonPrimitive)?.contentOrNull?.let { prefs.definirAtivo(it) }
            ?: remotos.firstOrNull()?.let { prefs.definirAtivo(it.s("id")!!) }

        progresso("aulas", 0, remotos.size)
        for (r in remotos) baixarAulas(r.s("id")!!)

        // materiais: envia simulados registrados aqui, depois baixa descrições
        for (m in db.materiais().sujos()) {
            api.gravarMaterial(m.ed, m.id, json.parseToJsonElement(m.json))
            db.materiais().gravar(m.copy(sujo = false))
        }
        val remMat = est["materiais"]!!.jsonArray.map { it.jsonObject }
        val locais = remMat.map { it.s("ed")!! }.distinct().associateWith { ed -> db.materiais().lista(ed).associateBy { it.id } }
        for (ed in locais.keys) {
            val mudou = remMat.any { it.s("ed") == ed && (locais[ed]!![it.s("id")]?.atualizadoPc ?: -1.0) < it.d("atualizado") }
            if (!mudou) continue
            val quando = remMat.filter { it.s("ed") == ed }.associate { it.s("id")!! to it.d("atualizado") }
            for (m in api.materiais(ed)) {
                val o = m.jsonObject; val id = o.s("id")!!
                if (locais[ed]!![id]?.sujo == true) continue
                db.materiais().gravar(MaterialEnt(ed, id, o.toString(), quando[id] ?: 0.0, false))
            }
        }
        // PDFs que ainda não estão no celular
        val faltam = remMat.filter { it.b("temArquivo") && !arquivo(it.s("ed")!!, it.s("arquivo")!!).exists() }
        faltam.forEachIndexed { i, m ->
            progresso("pdfs", i, faltam.size)
            api.baixarPdf(m.s("ed")!!, m.s("arquivo")!!, arquivo(m.s("ed")!!, m.s("arquivo")!!))
        }
        Resumo(0)
    }

    private suspend fun sincronizarEdital(id: String, revPc: Int) {
        val local = db.editais().ler(id)
        if (local == null || (!local.sujo && local.rev != revPc)) {
            val r = api.edital(id)
            val doc = r["doc"].toString()
            trava.withLock {
                val agora = db.editais().ler(id)
                if (agora == null || agora.versao == (local?.versao ?: agora.versao) && !agora.sujo)
                    db.editais().gravar(EditalEnt(id, doc, doc, r.i("rev"), false, (agora?.versao ?: 0) + 1))
            }
            return
        }
        if (!local.sujo) return
        // o celular mudou: envia com a base; o PC mescla se também tiver mudado
        var enviado: EditalEnt = local
        repeat(3) {
            val doc = json.parseToJsonElement(enviado.json)
            val base = enviado.base?.let { json.parseToJsonElement(it) }
            val r = api.mesclarNoPc(id, enviado.rev, base, doc)
            val noPc: JsonElement = (r["doc"] as? JsonObject) ?: doc
            val rev = r.i("rev")
            val pronto = trava.withLock {
                val agora = db.editais().ler(id)!!
                if (agora.versao == enviado.versao) {
                    db.editais().gravar(agora.copy(json = noPc.toString(), base = noPc.toString(), rev = rev, sujo = false, versao = agora.versao + 1)); true
                } else false
            }
            if (pronto) return
            // editado durante o envio: junta a edição nova com o que o PC devolveu e envia de novo
            val atual = db.editais().ler(id)!!
            val junto = api.mesclar(doc, json.parseToJsonElement(atual.json), noPc)
            enviado = trava.withLock {
                val a2 = db.editais().ler(id)!!
                val e = a2.copy(json = junto.toString(), base = noPc.toString(), rev = rev, sujo = true, versao = a2.versao + 1)
                db.editais().gravar(e); e
            }
        }
    }

    private suspend fun baixarAulas(ed: String) {
        var desde = prefs.desde(ed); var cursor: String? = null; var maior = desde
        do {
            val pg = api.aulasAlteradas(ed, desde, cursor)
            val itens = pg["itens"]!!.jsonArray.map { it.jsonObject }
            db.aulas().gravar(itens.map { AulaEnt(ed, it.s("tid")!!, it["dados"].toString(), it.d("atualizado")) })
            itens.maxOfOrNull { it.d("atualizado") }?.let { if (it > maior) maior = it }
            cursor = (pg["proximo"] as? JsonPrimitive)?.contentOrNull
        } while (cursor != null)
        if (maior > desde) prefs.definirDesde(ed, maior)
    }
}

fun JsonObject.s(k: String): String? = (this[k] as? JsonPrimitive)?.takeIf { it.isString }?.content
fun JsonObject.i(k: String): Int = (this[k] as? JsonPrimitive)?.intOrNull ?: (this[k] as? JsonPrimitive)?.doubleOrNull?.toInt() ?: 0
fun JsonObject.d(k: String): Double = (this[k] as? JsonPrimitive)?.doubleOrNull ?: 0.0
fun JsonObject.b(k: String): Boolean = (this[k] as? JsonPrimitive)?.booleanOrNull ?: false
