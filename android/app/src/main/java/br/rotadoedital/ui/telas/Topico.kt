package br.rotadoedital.ui.telas

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import br.rotadoedital.dominio.Estudo
import br.rotadoedital.ui.AulaUi
import br.rotadoedital.ui.Dados
import br.rotadoedital.ui.MaterialUi
import br.rotadoedital.ui.UsoUi
import br.rotadoedital.ui.comp.Cartao
import br.rotadoedital.ui.comp.Dica
import br.rotadoedital.ui.comp.Etiqueta
import br.rotadoedital.ui.comp.Markdown
import br.rotadoedital.ui.comp.QuestaoCard
import br.rotadoedital.ui.comp.Secao
import br.rotadoedital.ui.theme.Dimens
import br.rotadoedital.ui.theme.LocalSemantica

val QUANDO = mapOf("estudo" to "Para aprofundar, depois do resumo", "questoes" to "Questões reais da banca",
    "revisao" to "Na revisão", "consulta" to "Texto oficial para consulta")
val TIPO_MAT = mapOf("prova" to "Prova anterior", "gabarito" to "Gabarito", "edital" to "Edital", "norma" to "Norma", "lei" to "Lei",
    "guia" to "Guia oficial", "livro" to "Livro", "apostila" to "Apostila", "outro" to "PDF")

/**
 * Aula de um tópico. Estudo: aquecimento (pré-teste) → resumo → porquês → questões.
 * Revisão: lembrar → questões → reler só se precisar. Barra de conclusão fixa embaixo (alcance do polegar).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun TelaTopico(
    d: Dados, tid: String, revisao: Boolean, conteudo: PaddingValues,
    carregar: suspend (String) -> AulaUi?,
    responder: (q: br.rotadoedital.dominio.Questao, op: String, conf: String?, pre: Boolean) -> Unit,
    concluir: (n: Int, acc: Double?) -> Unit,
    abrirPdf: (MaterialUi, String?) -> Unit,
) {
    val t = d.topico(tid) ?: return
    var aula by remember(tid) { mutableStateOf<AulaUi?>(null) }
    var carregou by remember(tid) { mutableStateOf(false) }
    LaunchedEffect(tid) { aula = carregar(tid); carregou = true }
    val resp = remember(tid) { mutableStateMapOf<Int, String>() }
    val conf = remember(tid) { mutableStateMapOf<Int, String>() }
    var reler by rememberSaveable(tid) { mutableStateOf(false) }
    var lembro by rememberSaveable(tid) { mutableStateOf("") }
    val a = aula
    val pre = if (!revisao && !t.estudado && a != null) Estudo.nPre(a.questoes.size) else 0
    val s = LocalSemantica.current

    fun questoes(de: Int, ate: Int, scope: androidx.compose.foundation.lazy.LazyListScope) {
        val qs = a!!.questoes
        scope.itemsIndexed(qs.subList(de, minOf(ate, qs.size)), key = { i, _ -> "q${de + i}" }) { i, q ->
            val qi = de + i
            Box(Modifier.padding(bottom = Dimens.p3)) {
                QuestaoCard(q, if (qi < pre) "Aquecimento" else "${if (q.alternativas == null) "Item" else "Questão"} ${qi + 1}", resp[qi], conf[qi], qi < pre,
                    onConf = { c -> if (c == null) conf.remove(qi) else conf[qi] = c },
                    onResponder = { op -> resp[qi] = op; responder(q, op, conf[qi], qi < pre) })
            }
        }
    }

    Box(Modifier.fillMaxSize()) {
        LazyColumn(contentPadding = PaddingValues(start = Dimens.p4, end = Dimens.p4, top = conteudo.calculateTopPadding() + Dimens.p2, bottom = conteudo.calculateBottomPadding() + 96.dp)) {
            item(key = "cab") {
                Column(verticalArrangement = Arrangement.spacedBy(Dimens.p2)) {
                    Text("${t.materia.uppercase()} · ${if (revisao) "REVISÃO" else "ESTUDO"}", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(t.nome, style = MaterialTheme.typography.headlineSmall, modifier = Modifier.semantics { heading() })
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(Dimens.p2), verticalArrangement = Arrangement.spacedBy(Dimens.p2)) {
                        Etiqueta("Incidência ${t.inc.replace("media", "média")}", MaterialTheme.colorScheme.primaryContainer, MaterialTheme.colorScheme.onPrimaryContainer)
                        t.em?.let { Etiqueta("Estudado em ${br(it)}", s.okFundo, s.okTexto) }
                        t.proxRev?.let { Etiqueta("Próxima revisão ${br(it)}", s.alertaFundo, s.alertaTexto) }
                    }
                }
            }
            when {
                a == null && !carregou -> item { Box(Modifier.fillMaxWidth().padding(Dimens.p8), contentAlignment = Alignment.Center) { CircularProgressIndicator() } }
                a == null -> item { Box(Modifier.padding(top = Dimens.p4)) { Dica("Aula ainda não está no celular", "Ela é gerada no PC. Abra este tópico lá (ou use \"Salvar todas as aulas\" em Ajustes no PC) e sincronize.") } }
                else -> {
                    if (revisao) {
                        item { Box(Modifier.padding(top = Dimens.p4)) { Dica("Revisão: primeiro lembre, depois releia.", "Tentar lembrar fixa mais do que reler. Pense nos pontos principais, resolva as questões e só então abra o resumo, se precisar.") } }
                        item {
                            OutlinedTextField(lembro, { lembro = it }, label = { Text("O que você lembra deste tópico? (rascunho, não é salvo)") },
                                modifier = Modifier.fillMaxWidth().padding(top = Dimens.p3), minLines = 3)
                        }
                        item { Secao("Questões", extra = "${t.acertos}/${t.feitas} no total") }
                        questoes(0, a.questoes.size, this)
                        item {
                            Surface(onClick = { reler = !reler }, shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.surfaceVariant,
                                modifier = Modifier.fillMaxWidth().heightIn(min = Dimens.toque).semantics { stateDescription = if (reler) "aberto" else "fechado" }) {
                                Text(if (reler) "Esconder o resumo" else "Reler o resumo, as pegadinhas e os porquês", style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(Dimens.p4))
                            }
                        }
                        if (reler) resumo(a, this)
                    } else {
                        if (pre > 0) {
                            item { Secao("Aquecimento") }
                            item { Box(Modifier.padding(bottom = Dimens.p3)) { Dica("Tente antes de ler.", "Errar aqui é esperado e não conta no desempenho: arriscar uma resposta antes do conteúdo faz você prestar atenção no que importa.") } }
                            questoes(0, pre, this)
                        }
                        resumo(a, this)
                        item { Secao("Questões", extra = "marque a confiança antes de responder") }
                        questoes(pre, a.questoes.size, this)
                    }
                    item { Text("Material gerado por IA a partir do tópico do edital. Confira a redação atual da lei antes de memorizar detalhes.",
                        style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(vertical = Dimens.p3)) }
                }
            }
            val mats = d.materiaisDo(tid)
            if (mats.isNotEmpty()) {
                item { Secao("Materiais de apoio") }
                item { Dica(if (revisao) "Primeiro as questões, depois a consulta." else "Onde e quando usar.",
                    if (revisao) "Comece pelas questões reais da banca, sem consultar. Abra o texto oficial só para conferir o que errou."
                    else "Leia o resumo e faça as questões primeiro. Use os trechos indicados para tirar dúvidas; deixe as questões reais da banca para o fim ou para a revisão.") }
                val ordem = if (revisao) listOf("questoes", "revisao", "consulta", "estudo") else listOf("estudo", "consulta", "questoes", "revisao")
                ordem.forEach { q ->
                    val l = mats.filter { it.second.quando == q }
                    if (l.isNotEmpty()) {
                        item { Text(QUANDO[q] ?: q, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = Dimens.p4, bottom = Dimens.p2)) }
                        l.forEach { (m, u) -> item { MaterialDoTopico(m, u, abrirPdf) } }
                    }
                }
            }
        }
        // barra de conclusão fixa
        Surface(tonalElevation = 3.dp, shadowElevation = 6.dp, modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth()) {
            // o Scaffold já consumiu o inset da barra de navegação: usa o padding que ele passou
            Row(Modifier.padding(bottom = conteudo.calculateBottomPadding()).padding(horizontal = Dimens.p4, vertical = Dimens.p3), verticalAlignment = Alignment.CenterVertically) {
                Text("${resp.size} de ${a?.questoes?.size ?: 0} respondidas", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
                Button(onClick = {
                    val validas = resp.filterKeys { it >= pre }
                    val ac = validas.count { (qi, op) -> a?.questoes?.getOrNull(qi)?.gabarito == op }
                    concluir(validas.size, if (validas.isEmpty()) null else ac.toDouble() / validas.size)
                }, modifier = Modifier.heightIn(min = Dimens.toque)) { Text(if (revisao) "Concluir revisão" else "Marcar como estudado") }
            }
        }
    }
}

private fun resumo(a: AulaUi, scope: androidx.compose.foundation.lazy.LazyListScope) {
    scope.item { Secao("Resumo") }
    scope.item { Cartao { Box(Modifier.padding(Dimens.p4)) { Markdown(a.resumo) } } }
    if (a.pegadinhas.isNotEmpty()) {
        scope.item { Secao("Pegadinhas da banca") }
        scope.item {
            val s = LocalSemantica.current
            Column(verticalArrangement = Arrangement.spacedBy(Dimens.p2)) {
                a.pegadinhas.forEach { p -> Text(p, style = MaterialTheme.typography.bodyLarge, color = s.alertaTexto,
                    modifier = Modifier.fillMaxWidth().background(s.alertaFundo, RoundedCornerShape(8.dp)).padding(Dimens.p3)) }
            }
        }
    }
    if (a.porques.isNotEmpty()) {
        scope.item { Secao("Explique para si mesmo") }
        scope.item { Text("Responda de cabeça antes de abrir. Explicar o porquê fixa mais do que reler.", style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(bottom = Dimens.p2)) }
        scope.item { Cartao { Column { a.porques.forEachIndexed { i, (p, r) -> if (i > 0) HorizontalDivider(); Porque(p, r) } } } }
    }
}

@Composable
private fun Porque(p: String, r: String) {
    var aberto by rememberSaveable(p) { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().clickable(role = Role.Button) { aberto = !aberto }.heightIn(min = Dimens.toque).padding(Dimens.p4)
        .semantics { stateDescription = if (aberto) "resposta visível" else "resposta escondida" }) {
        Text(p, style = MaterialTheme.typography.titleSmall)
        AnimatedVisibility(aberto) { Text(r, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(top = Dimens.p2)) }
    }
}

@Composable
fun MaterialDoTopico(m: MaterialUi, u: UsoUi, abrirPdf: (MaterialUi, String?) -> Unit) {
    var gab by rememberSaveable(m.id + u.tid) { mutableStateOf(false) }
    Box(Modifier.padding(bottom = Dimens.p2)) {
        Cartao {
            Column(Modifier.padding(Dimens.p4), verticalArrangement = Arrangement.spacedBy(Dimens.p1)) {
                Etiqueta(TIPO_MAT[m.tipo] ?: "PDF", MaterialTheme.colorScheme.surfaceVariant, MaterialTheme.colorScheme.onSurfaceVariant)
                Text(m.titulo, style = MaterialTheme.typography.titleSmall)
                val onde = listOfNotNull(u.questoes.takeIf { it.isNotEmpty() }?.let { "Questões ${it.joinToString(", ")}" }, u.pag?.let { pagTxt(it) })
                if (onde.isNotEmpty()) Text(onde.joinToString(" · "), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                u.nota?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
                Row(horizontalArrangement = Arrangement.spacedBy(Dimens.p2)) {
                    TextButton(onClick = { abrirPdf(m, u.pag) }) { Text(if (m.tipo == "prova") "Abrir prova" else "Abrir PDF") }
                    if (m.respostas.isNotEmpty() && u.questoes.isNotEmpty()) TextButton(onClick = { gab = !gab }) { Text(if (gab) "Esconder gabarito" else "Ver gabarito") }
                }
                if (gab) Text(u.questoes.joinToString("  ·  ") { q -> "$q: ${m.respostas[q.toString()]?.let { if (it == "*") "anulada" else it } ?: "?"}" },
                    style = MaterialTheme.typography.bodyLarge)
            }
        }
    }
}

fun pagTxt(p: String) = if (p.contains('-') || p.contains(',')) "págs. ${p.replace("-", "–")}" else "pág. $p"
fun br(iso: String): String = iso.split("-").let { if (it.size == 3) "${it[2]}/${it[1]}/${it[0]}" else iso }
