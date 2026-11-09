package br.rotadoedital.dominio

import java.time.LocalDate
import java.time.temporal.ChronoUnit
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/*
 * Regras de estudo, iguais às do web (web/app.js). Mudou lá, mude aqui (e nos testes).
 * Fundamentos: prática espaçada e de testes (Dunlosky 2013, Cepeda 2008), reaprendizagem
 * sucessiva (Rawson & Dunlosky), pré-teste (Pan & Sana 2021), intercalação (Brunmair & Richter 2019).
 */

val INC_RANK = mapOf("alta" to 0, "media" to 1, "baixa" to 2)
fun iso(d: LocalDate): String = d.toString()
fun data(s: String): LocalDate = LocalDate.parse(s)
fun dias(de: String, ate: String): Int = ChronoUnit.DAYS.between(data(de), data(ate)).toInt()
fun soma(s: String, n: Int): String = iso(data(s).plusDays(n.toLong()))

class Estudo(val ed: Obj, private val hojeD: LocalDate = LocalDate.now()) {
    val hoje: String get() = iso(hojeD)

    fun materias(): List<Obj> = ed.objs("materias")
    fun achar(tid: String): Pair<Obj, Obj>? {
        for (m in materias()) for (t in m.objs("topicos")) if (t.s("id") == tid) return m to t
        return null
    }

    // ---------- acerto
    /** Questões feitas/acertadas: app + QConcursos. */
    fun qt(t: Obj): Pair<Int, Int> {
        val q = t.obj("q"); val qc = t.obj("qc")
        return ((q?.i("f") ?: 0) + (qc?.i("f") ?: 0)) to ((q?.i("a") ?: 0) + (qc?.i("a") ?: 0))
    }
    fun accTop(t: Obj): Double? = qt(t).let { (f, a) -> if (f > 0) a.toDouble() / f else null }
    fun accMat(m: Obj): Double? {
        var f = 0; var a = 0
        m.objs("topicos").forEach { val (ff, aa) = qt(it); f += ff; a += aa }
        return if (f > 0) a.toDouble() / f else null
    }
    private fun pesoMat(m: Obj): Double {
        val acc = accMat(m)
        return (m.i("questoes").takeIf { it > 0 } ?: 1) * (if (acc != null && acc < .6) 1.4 else 1.0)
    }

    // ---------- plano
    fun blocosDia(): Int = max(1, floor(horas() * 60 / 50).toInt())
    fun horas(): Double = ed.n("horas").takeIf { it > 0 } ?: 3.0
    fun minutosHoje(): Int {
        val hm = ed.obj("hojeMin")
        return if (hm != null && hm.s("d") == hoje) hm.i("min") else (horas() * 60).roundToInt()
    }
    fun diasAteProva(): Int? = ed.s("dataProva")?.let { dias(hoje, it) }

    /** Round-robin ponderado entre matérias; dentro da matéria, incidência alta primeiro. */
    fun fila(): List<Pair<Obj, Obj>> {
        class F(val m: Obj, val w: Double, var cur: Double, val pend: ArrayDeque<Obj>)
        val ms = materias().map { m ->
            val pend = m.objs("topicos").withIndex().filter { it.value.s("st") == "novo" }
                .sortedWith(compareBy({ INC_RANK[it.value.s("inc")] ?: 1 }, { it.index })).map { it.value }
            F(m, pesoMat(m), 0.0, ArrayDeque(pend))
        }.filter { it.pend.isNotEmpty() }
        val out = ArrayList<Pair<Obj, Obj>>()
        var resto = ms.sumOf { it.pend.size }
        while (resto > 0) {
            var best: F? = null; var sw = 0.0
            for (x in ms) {
                if (x.pend.isEmpty()) continue
                x.cur += x.w; sw += x.w
                if (best == null || x.cur > best.cur) best = x
            }
            best!!.cur -= sw; out.add(best.m to best.pend.removeFirst()); resto--
        }
        return out
    }

    data class Pendente(val m: Obj, val t: Obj, val r: Obj, val atraso: Int)
    fun revisoesPendentes(): List<Pendente> {
        val out = ArrayList<Pendente>()
        for (m in materias()) for (t in m.objs("topicos")) {
            val r = t.objs("revs").firstOrNull { !it.b("feita") && (it.s("due") ?: "9") <= hoje } ?: continue
            out.add(Pendente(m, t, r, dias(r.s("due")!!, hoje)))
        }
        return out.sortedByDescending { it.atraso }
    }
    fun revsFeitas(t: Obj) = t.objs("revs").count { it.b("feita") }

    fun errDue(x: Obj): String = x.s("due") ?: soma(x.s("em") ?: hoje, 1)
    fun errosParaHoje(): List<Obj> = ed.objs("erros").filter { !it.b("dom") && errDue(it) <= hoje }

    data class Plano(
        val min: Int, val dias: Int?, val retaFinal: Boolean,
        val revs: List<Pendente>, val nRev: Int, val errs: List<Obj>, val minErr: Int,
        val feitosHoje: List<Pair<Obj, Obj>>, val revFeitasHoje: List<Pair<Obj, Obj>>,
        val lista: List<Pair<Obj, Obj>>, val novos: Int,
    )

    /** Dívida de revisão primeiro, depois caderno de erros, depois tópicos novos no tempo que sobrar. */
    fun planoDia(): Plano {
        val min = minutosHoje(); val d = diasAteProva()
        val reta = d != null && d in 0..14
        val revs = revisoesPendentes(); val errs = errosParaHoje()
        var resto = min
        val nRev = min(revs.size, max(1, resto / 15)); resto -= nRev * 15
        val minErr = if (errs.isNotEmpty()) min(20, max(6, errs.size * 2)) else 0
        resto -= minErr
        val feitos = ArrayList<Pair<Obj, Obj>>(); val revFeitas = ArrayList<Pair<Obj, Obj>>()
        for (m in materias()) for (t in m.objs("topicos")) {
            if (t.s("em") == hoje) feitos.add(m to t)
            if (t.objs("revs").any { it.b("feita") && it.s("em") == hoje }) revFeitas.add(m to t)
        }
        var q = fila(); if (reta) q = q.filter { it.second.s("inc") == "alta" }
        var novos = max(0, resto / 50)
        if (novos == 0 && revs.isEmpty() && errs.isEmpty() && min >= 25) novos = 1
        return Plano(min, d, reta, revs, nRev, errs, minErr, feitos, revFeitas, q.take(max(0, novos - feitos.size)), novos)
    }

    // ---------- revisões adaptativas
    private fun limitarIntervalo(d0: Double): Int {
        var d = max(1, min(60, d0.roundToInt()))
        val dp = diasAteProva()
        if (dp != null && dp > 1) d = min(d, max(1, dp / 2))
        return d
    }
    private fun ordenarRevs(t: Obj) {
        @Suppress("UNCHECKED_CAST")
        (t.lista("revs") as MutableList<Any?>).sortBy { (it as? Map<*, *>)?.get("due") as? String ?: "" }
    }

    fun concluirEstudo(tid: String): String {
        val (_, t) = achar(tid) ?: return ""
        if (t.s("st") != "novo" && t.s("em") == hoje) return "Este tópico já foi concluído hoje."
        t["st"] = "estudado"; t["em"] = hoje; t["iv"] = 1L
        t["revs"] = arrayListOf<Any?>(obj("due" to soma(hoje, 1), "feita" to false))
        return "Primeira revisão amanhã. Os intervalos crescem conforme você acerta."
    }

    /** n = questões respondidas na revisão; acc = acerto nelas. */
    fun concluirRevisao(tid: String, n: Int, acc: Double?): String {
        val (_, t) = achar(tid) ?: return ""
        val revs = t.objs("revs")
        val r = revs.firstOrNull { !it.b("feita") && (it.s("due") ?: "9") <= hoje } ?: revs.firstOrNull { !it.b("feita") }
        if (r != null) { r["feita"] = true; r["em"] = hoje }
        val ruim = n >= 3 && (acc ?: 1.0) < .6
        var msg = "Revisão registrada."
        if (ruim && t.objs("revs").any { !it.b("feita") } && t.objs("revs").none { !it.b("feita") && (it.s("due") ?: "") <= soma(hoje, 3) }) {
            t.lista("revs").add(obj("due" to soma(hoje, 3), "feita" to false, "reforco" to true)); ordenarRevs(t)
            msg = "Acerto abaixo de 60%: reforço em 3 dias."
        }
        if (t.objs("revs").none { !it.b("feita") }) {
            var iv = t.n("iv").takeIf { it > 0 } ?: 1.0
            val reforco = ruim
            if (reforco) { iv = 2.0; t["iv"] = 1L } else { iv *= if (n >= 3) (if ((acc ?: 0.0) >= .8) 2.5 else 1.8) else 2.0; t["iv"] = iv }
            val d = limitarIntervalo(iv)
            t.lista("revs").add(if (reforco) obj("due" to soma(hoje, d), "feita" to false, "reforco" to true) else obj("due" to soma(hoje, d), "feita" to false))
            msg = if (reforco) "Acerto abaixo de 60%: reforço em $d dias." else "Próxima revisão em $d dia${if (d > 1) "s" else ""}."
        }
        return msg
    }

    // ---------- respostas
    private fun marcarAtiv() {
        val a = ed.obj("ativ") ?: linkedMapOf<String, Any?>().also { ed["ativ"] = it }
        a[hoje] = (a.i(hoje) + 1).toLong()
        val ks = a.keys.sorted(); if (ks.size > 90) ks.take(ks.size - 90).forEach { a.remove(it) }
    }

    /**
     * Registra uma resposta. pre = questão de aquecimento (não conta). conf = certeza|duvida|chute.
     * Erro, ou acerto no chute, entra no caderno para ser refeito em dias diferentes.
     */
    fun responder(tid: String, q: Questao, op: String, conf: String?, pre: Boolean, novoId: () -> String): Boolean {
        val (m, t) = achar(tid) ?: return false
        val certo = op == q.gabarito
        if (pre) return certo
        val qq = t.obj("q") ?: linkedMapOf<String, Any?>().also { t["q"] = it }
        qq["f"] = (qq.i("f") + 1).toLong(); if (certo) qq["a"] = (qq.i("a") + 1).toLong()
        if (conf != null) {
            val cal = ed.obj("cal") ?: linkedMapOf<String, Any?>().also { ed["cal"] = it }
            val c = cal.obj(conf) ?: linkedMapOf<String, Any?>("f" to 0L, "a" to 0L).also { cal[conf] = it }
            c["f"] = (c.i("f") + 1).toLong(); if (certo) c["a"] = (c.i("a") + 1).toLong()
        }
        marcarAtiv()
        if (!certo || conf == "chute") {
            val enun = q.enunciado.take(1200)
            val erros = ed.lista("erros")
            val base = linkedMapOf<String, Any?>("marcada" to op, "em" to hoje, "due" to soma(hoje, 1), "ok" to 0L)
            if (conf != null) base["conf"] = conf
            if (certo) base["sorte"] = true
            @Suppress("UNCHECKED_CAST")
            val ja = erros.filterIsInstance<MutableMap<String, Any?>>().firstOrNull { !it.b("dom") && it.s("enunciado") == enun }
            if (ja != null) { ja.putAll(base); if (conf == null) ja.remove("conf"); if (!certo) ja.remove("sorte") }
            else erros.add(0, linkedMapOf<String, Any?>("id" to novoId(), "tid" to tid, "mid" to m.s("id"), "enunciado" to enun,
                "alternativas" to q.alternativas?.let { ArrayList<Any?>(it) }, "gabarito" to q.gabarito,
                "explicacao" to q.explicacao.take(800)).apply { putAll(base) })
            while (erros.size > 400) erros.removeAt(erros.size - 1)
        }
        return certo
    }

    /** Caderno: acertou volta em 3 e depois 7 dias; errou volta amanhã; 3 acertos = dominada. */
    fun refazerErro(id: String, op: String): String? {
        val x = ed.objs("erros").firstOrNull { it.s("id") == id } ?: return null
        marcarAtiv()
        var msg: String? = null
        if (op == x.s("gabarito")) {
            val ok = x.i("ok") + 1; x["ok"] = ok.toLong()
            if (ok >= 3) { x["dom"] = true; x["domEm"] = hoje; msg = "Dominado: acertou em três dias diferentes." }
            else x["due"] = soma(hoje, if (ok == 1) 3 else 7)
        } else { x["ok"] = 0L; x["due"] = soma(hoje, 1) }
        x["ult"] = hoje
        return msg
    }

    fun tipoErro(id: String, tipo: String?) {
        val x = ed.objs("erros").firstOrNull { it.s("id") == id } ?: return
        if (tipo == null || x.s("tipo") == tipo) x.remove("tipo") else x["tipo"] = tipo
    }

    fun tempoHoje(min: Int) {
        if (min == (horas() * 60).roundToInt()) ed.remove("hojeMin") else ed["hojeMin"] = obj("d" to hoje, "min" to min.toLong())
    }

    /** Peso do tópico no treino misto: acerto baixo, incidência alta e tempo sem revisar pesam mais. */
    fun pesoTreino(t: Obj): Double {
        val acc = accTop(t)
        val ult = (listOfNotNull(t.s("em")) + t.objs("revs").filter { it.b("feita") }.mapNotNull { it.s("em") }).maxOrNull() ?: hoje
        return 1.0 + (if (acc != null && acc < .6) 2 else 0) + (if (t.s("inc") == "alta") 1 else 0) + min(3.0, dias(ult, hoje) / 7.0)
    }

    companion object {
        /** Questões de aquecimento ao estudar um tópico novo. */
        fun nPre(nQuestoes: Int) = if (nQuestoes >= 4) 2 else 0
    }
}

/** Questão de uma aula (imutável, para a UI). */
data class Questao(val enunciado: String, val alternativas: List<String>?, val gabarito: String, val explicacao: String)
