package br.rotadoedital.ui

import androidx.compose.runtime.Immutable
import br.rotadoedital.dominio.Questao
import kotlinx.serialization.json.JsonObject

/* Modelos imutáveis da UI (estáveis para o Compose: só leitura, montados no ViewModel). */

@Immutable
data class TopicoUi(
    val id: String, val nome: String, val materia: String, val inc: String, val estudado: Boolean, val em: String?,
    val feitas: Int, val acertos: Int, val proxRev: String?, val revsFeitas: Int, val temAula: Boolean, val pdfs: Int,
    val pesoTreino: Double,
) {
    val acc: Double? get() = if (feitas > 0) acertos.toDouble() / feitas else null
    val fraco: Boolean get() = feitas >= 3 && (acc ?: 1.0) < .6
}

@Immutable
data class MateriaUi(val id: String, val nome: String, val questoes: Int, val topicos: List<TopicoUi>, val acc: Double?) {
    val estudados get() = topicos.count { it.estudado }
}

enum class Tipo { REVISAO, NOVO, FEITO }

@Immutable
data class ItemPlano(val t: TopicoUi, val tag: String, val tipo: Tipo)

@Immutable
data class ErroUi(
    val id: String, val tid: String?, val materia: String, val topico: String, val enunciado: String, val alternativas: List<String>?,
    val gabarito: String, val marcada: String?, val explicacao: String, val conf: String?, val sorte: Boolean, val ok: Int,
    val dom: Boolean, val due: String, val tipo: String?,
)

@Immutable
data class Calib(val nivel: String, val f: Int, val a: Int)

@Immutable
data class UsoUi(val tid: String?, val pag: String?, val quando: String, val nota: String?, val questoes: List<Int>)

@Immutable
data class MaterialUi(
    val id: String, val titulo: String, val tipo: String, val fonte: String, val arquivo: String, val paginas: Int, val resumo: String?,
    val usos: List<UsoUi>, val gabaritoDe: String?, val respostas: Map<String, String>, val simulados: List<Triple<String, Int, Int>>,
    val bruto: JsonObject,
)

@Immutable
data class AulaUi(val resumo: String, val pegadinhas: List<String>, val porques: List<Pair<String, String>>, val questoes: List<Questao>)

@Immutable
data class ItemTreino(val tid: String, val qi: Int, val materia: String, val q: Questao)

@Immutable
data class Dados(
    val id: String, val orgao: String, val cargo: String, val banca: String, val estiloCE: Boolean,
    val dataProva: String?, val diasProva: Int?, val horas: Double, val seEntao: String?,
    val materias: List<MateriaUi>, val revsHoje: List<ItemPlano>, val revsTotal: Int,
    val feitosHoje: List<TopicoUi>, val revFeitasHoje: List<TopicoUi>, val novos: List<ItemPlano>, val novosPlanejados: Int,
    val errosHoje: Int, val minErr: Int, val minHoje: Int, val retaFinal: Boolean,
    val cobertura: Int, val estudados: Int, val totalTopicos: Int, val questoes: Int, val acertos: Int, val projecao: String,
    val erros: List<ErroUi>, val calib: List<Calib>, val ativ: Map<String, Int>, val materiais: List<MaterialUi>, val aulasSalvas: Int,
) {
    fun topico(tid: String): TopicoUi? = materias.firstNotNullOfOrNull { m -> m.topicos.firstOrNull { it.id == tid } }
    fun materiaisDo(tid: String): List<Pair<MaterialUi, UsoUi>> = materiais.flatMap { m -> m.usos.filter { it.tid == tid }.map { m to it } }
}
