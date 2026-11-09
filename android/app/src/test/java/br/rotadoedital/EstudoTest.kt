package br.rotadoedital

import br.rotadoedital.dominio.Estudo
import br.rotadoedital.dominio.Obj
import br.rotadoedital.dominio.Questao
import br.rotadoedital.dominio.mut
import br.rotadoedital.dominio.objs
import br.rotadoedital.dominio.paraJson
import br.rotadoedital.dominio.s
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

class EstudoTest {
    private val hoje = LocalDate.of(2026, 11, 9)

    @Suppress("UNCHECKED_CAST")
    private fun edital(dataProva: String? = null): Obj = Json.parseToJsonElement(
        """{"id":"e","horas":3,"dataProva":${dataProva?.let { "\"$it\"" } ?: "null"},"estilo":"CE","campoDesconhecido":{"x":[1,2]},
        "materias":[{"id":"m0","nome":"Português","questoes":10,"topicos":[
          {"id":"m0t0","nome":"A","inc":"baixa","st":"novo","em":null,"revs":[],"q":{"f":0,"a":0}},
          {"id":"m0t1","nome":"B","inc":"alta","st":"novo","em":null,"revs":[],"q":{"f":0,"a":0}}]},
         {"id":"m1","nome":"TI","questoes":30,"topicos":[
          {"id":"m1t0","nome":"C","inc":"alta","st":"novo","em":null,"revs":[],"q":{"f":0,"a":0}}]}],"erros":[]}"""
    ).mut() as Obj

    @Test fun preservaCamposDesconhecidos() {
        val e = edital()
        val volta = e.paraJson() as JsonObject
        assertEquals("[1,2]", volta["campoDesconhecido"].toString().substringAfter(":").trimEnd('}'))
    }

    @Test fun filaPriorizaPesoEIncidencia() {
        val f = Estudo(edital(), hoje).fila().map { it.second.s("id") }
        assertEquals("m1t0", f[0])           // matéria com mais questões vem primeiro
        assertEquals(listOf("m0t1", "m0t0"), f.drop(1)) // dentro da matéria, alta antes de baixa
    }

    @Test fun revisoesCrescemComAcerto() {
        val est = Estudo(edital(), hoje)
        est.concluirEstudo("m1t0")
        val t = est.achar("m1t0")!!.second
        assertEquals("2026-11-10", t.objs("revs")[0].s("due"))
        val amanha = Estudo(est.ed, hoje.plusDays(1))
        val msg = amanha.concluirRevisao("m1t0", n = 5, acc = 1.0)
        assertEquals("Próxima revisão em 3 dias.", msg) // 1 × 2,5 ≈ 3
    }

    @Test fun reforcoComAcertoBaixoEIntervaloLimitadoPelaProva() {
        val est = Estudo(edital(dataProva = "2026-11-15"), hoje)
        est.concluirEstudo("m1t0")
        val msg = Estudo(est.ed, hoje.plusDays(1)).concluirRevisao("m1t0", n = 4, acc = .25)
        assertTrue(msg, msg.startsWith("Acerto abaixo de 60%: reforço em 2 dias"))
        // com a prova a 6 dias, nenhum intervalo passa de 3
        val e2 = Estudo(edital(dataProva = "2026-11-15"), hoje)
        e2.concluirEstudo("m0t1")
        val t = e2.achar("m0t1")!!.second; t["iv"] = 20.0
        @Suppress("UNCHECKED_CAST") (t["revs"] as MutableList<Any?>).clear()
        (t["revs"] as MutableList<Any?>).add(linkedMapOf<String, Any?>("due" to "2026-11-09", "feita" to false))
        assertEquals("Próxima revisão em 3 dias.", e2.concluirRevisao("m0t1", n = 5, acc = 1.0))
    }

    @Test fun erroEChuteVaoParaOCaderno() {
        val est = Estudo(edital(), hoje)
        var n = 0
        val q = Questao("Enunciado", null, "C", "Porque sim")
        est.responder("m0t0", q, "E", "certeza", pre = false) { "id${n++}" }
        est.responder("m0t0", q.copy(enunciado = "Outro"), "C", "chute", pre = false) { "id${n++}" }
        est.responder("m0t0", q.copy(enunciado = "Aquecimento"), "E", null, pre = true) { "id${n++}" }
        val erros = est.ed.objs("erros")
        assertEquals(2, erros.size)
        assertEquals(true, erros[0]["sorte"])
        val t = est.achar("m0t0")!!.second
        assertEquals(2L, (t["q"] as Map<*, *>)["f"])
    }

    @Test fun cadernoDominaComTresAcertos() {
        val est = Estudo(edital(), hoje)
        est.responder("m0t0", Questao("X", null, "C", ""), "E", null, false) { "e1" }
        assertNull(est.refazerErro("e1", "C"))
        assertEquals("2026-11-12", est.ed.objs("erros")[0].s("due"))
        est.refazerErro("e1", "C")
        assertEquals("Dominado: acertou em três dias diferentes.", est.refazerErro("e1", "C"))
    }

    @Test fun planoComPoucoTempoSoRevisa() {
        val est = Estudo(edital(), hoje)
        est.concluirEstudo("m0t0")
        val amanha = Estudo(est.ed, hoje.plusDays(1))
        amanha.tempoHoje(30)
        val p = amanha.planoDia()
        assertEquals(1, p.nRev)
        assertEquals(0, p.novos)
    }
}
