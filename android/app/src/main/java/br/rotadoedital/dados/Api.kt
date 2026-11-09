package br.rotadoedital.dados

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.Cache
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.IOException
import java.util.concurrent.TimeUnit

/** Erros da API (problem+json) que a UI sabe mostrar. */
sealed class ErroApi(msg: String) : IOException(msg) {
    class SemConexao(msg: String) : ErroApi(msg)
    class NaoAutorizado(msg: String) : ErroApi(msg)
    class Servidor(val status: Int, val code: String?, msg: String) : ErroApi(msg)
}

/** Cliente da API /v1 do PC (contrato em contract/openapi.yaml). */
class Api(private val ctx: android.content.Context, private val prefs: Prefs) {
    private val json = Json { ignoreUnknownKeys = true }
    private val tipoJson = "application/json".toMediaType()
    // criado na primeira chamada (sempre em Dispatchers.IO): getCacheDir toca o disco
    private val http by lazy { OkHttpClient.Builder()
        .cache(Cache(File(ctx.cacheDir, "http"), 10L * 1024 * 1024))   // aproveita ETag/304 do servidor
        .connectTimeout(4, TimeUnit.SECONDS).readTimeout(60, TimeUnit.SECONDS)
        .build() }

    private fun url(end: String, caminho: String) = "http://${end.trim().removePrefix("http://").trimEnd('/')}$caminho"

    private suspend fun req(caminho: String, metodo: String = "GET", corpo: JsonElement? = null, auth: Boolean = true, endereco: String? = null): JsonElement =
        withContext(Dispatchers.IO) { reqIo(caminho, metodo, corpo, auth, endereco) }

    private suspend fun reqIo(caminho: String, metodo: String, corpo: JsonElement?, auth: Boolean, endereco: String?): JsonElement {
        val end = endereco ?: prefs.endereco() ?: throw ErroApi.SemConexao("Conecte o app ao PC em Ajustes.")
        val b = Request.Builder().url(url(end, caminho))
        if (auth) prefs.token()?.let { b.header("Authorization", "Bearer $it") }
        b.method(metodo, corpo?.toString()?.toRequestBody(tipoJson))
        val r = try { http.newCall(b.build()).execute() } catch (e: IOException) {
            throw ErroApi.SemConexao("Não encontrei o PC em $end. Confira se ele está ligado, no mesmo Wi-Fi e com o app aberto pelo iniciar-na-rede.")
        }
        r.use {
            val txt = it.body?.string().orEmpty()
            val el = if (txt.isBlank()) JsonObject(emptyMap()) else json.parseToJsonElement(txt)
            if (!it.isSuccessful) {
                val o = el as? JsonObject
                val code = o?.get("code")?.jsonPrimitive?.contentOrNull
                val detalhe = o?.get("detail")?.jsonPrimitive?.contentOrNull ?: "Erro ${it.code} no PC."
                if (it.code == 401 && (code == "codigo")) throw ErroApi.NaoAutorizado("Este celular foi desconectado do PC. Pareie de novo em Ajustes.")
                throw ErroApi.Servidor(it.code, code, detalhe)
            }
            return el
        }
    }

    suspend fun parear(endereco: String, codigo: String, nome: String): String {
        val r = req("/v1/dispositivos", "POST", buildJsonObject { put("codigo", codigo); put("nome", nome) }, auth = false, endereco = endereco)
        return (r as JsonObject)["token"]!!.jsonPrimitive.content
    }
    suspend fun estado(): JsonObject = req("/v1/sync/estado") as JsonObject
    suspend fun edital(id: String): JsonObject = req("/v1/editais/$id/rev") as JsonObject
    suspend fun mesclarNoPc(id: String, baseRev: Int, base: JsonElement?, doc: JsonElement): JsonObject =
        req("/v1/editais/$id/mesclar", "POST", buildJsonObject { put("base_rev", baseRev); put("base", base ?: kotlinx.serialization.json.JsonNull); put("doc", doc) }) as JsonObject
    suspend fun mesclar(base: JsonElement, local: JsonElement, remoto: JsonElement): JsonElement =
        (req("/v1/mesclar", "POST", buildJsonObject { put("base", base); put("local", local); put("remoto", remoto) }) as JsonObject)["doc"]!!
    suspend fun aulasAlteradas(ed: String, desde: Double, cursor: String?): JsonObject =
        req("/v1/conteudo/$ed/alteracoes?desde=$desde&limit=50" + (cursor?.let { "&cursor=" + java.net.URLEncoder.encode(it, "UTF-8") } ?: "")) as JsonObject
    suspend fun materiais(ed: String): JsonArray = req("/v1/materiais/$ed") as JsonArray
    suspend fun gravarMaterial(ed: String, id: String, doc: JsonElement) { req("/v1/materiais/$ed/$id", "PUT", doc) }
    suspend fun status(): JsonObject = req("/v1/status") as JsonObject
    suspend fun ia(prompt: String, maxTokens: Int): JsonElement =
        (req("/v1/ia", "POST", buildJsonObject { put("prompt", prompt); put("max_tokens", maxTokens) }) as JsonObject)["dados"]!!

    /** Baixa um PDF para `destino` (via arquivo temporário, para não deixar PDF pela metade). */
    suspend fun baixarPdf(ed: String, arquivo: String, destino: File) = withContext(Dispatchers.IO) {
        val end = prefs.endereco() ?: return@withContext
        val b = Request.Builder().url(url(end, "/materiais/$ed/$arquivo")).cacheControl(okhttp3.CacheControl.FORCE_NETWORK)
        prefs.token()?.let { b.header("Authorization", "Bearer $it") }
        val r = try { http.newCall(b.build()).execute() } catch (e: IOException) { throw ErroApi.SemConexao("A conexão com o PC caiu durante o download.") }
        r.use {
            if (!it.isSuccessful) throw ErroApi.Servidor(it.code, null, "Não consegui baixar $arquivo.")
            destino.parentFile?.mkdirs()
            val tmp = File(destino.parentFile, destino.name + ".parte")
            it.body!!.byteStream().use { inp -> tmp.outputStream().use { out -> inp.copyTo(out) } }
            tmp.renameTo(destino)
        }
        Unit
    }
}
