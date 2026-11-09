package br.rotadoedital.ui.telas

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import br.rotadoedital.ui.Dados
import br.rotadoedital.ui.ItemPlano
import br.rotadoedital.ui.Tipo
import br.rotadoedital.ui.TopicoUi
import br.rotadoedital.ui.comp.Barra
import br.rotadoedital.ui.comp.Cartao
import br.rotadoedital.ui.comp.Dica
import br.rotadoedital.ui.comp.Etiqueta
import br.rotadoedital.ui.comp.Linha
import br.rotadoedital.ui.comp.Secao
import br.rotadoedital.ui.theme.Dimens
import br.rotadoedital.ui.theme.LocalSemantica

/** O que fazer agora: o primeiro item do plano do dia (ação do botão "Começar"). */
data class Proximo(val titulo: String, val detalhe: String, val porque: String, val acao: () -> Unit)

fun proximoPasso(d: Dados, abrir: (String, Boolean) -> Unit, irErros: () -> Unit): Proximo? = when {
    d.revsHoje.isNotEmpty() -> d.revsHoje[0].t.let { Proximo(it.nome, "Revisão · ${it.materia}", "Revisar na hora certa custa pouco e segura o que você já estudou.") { abrir(it.id, true) } }
    d.errosHoje > 0 -> Proximo("Refazer ${d.errosHoje} ${if (d.errosHoje > 1) "questões" else "questão"} do caderno", "Cerca de ${d.minErr} min",
        "Refazer sem olhar o gabarito, em dias diferentes, é o que transforma erro em acerto.", irErros)
    d.novos.isNotEmpty() -> d.novos[0].t.let { Proximo(it.nome, "Tópico novo · ${it.materia}", "Comece pelas duas questões de aquecimento, depois leia o resumo.") { abrir(it.id, false) } }
    else -> null
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun TelaHoje(
    d: Dados, conteudo: PaddingValues,
    abrir: (String, Boolean) -> Unit, irErros: () -> Unit, treino: () -> Unit, tempo: (Int) -> Unit,
) {
    val s = LocalSemantica.current
    val prox = proximoPasso(d, abrir, irErros)
    val planejado = d.revsHoje.size + d.revFeitasHoje.size + (if (d.errosHoje > 0) 1 else 0) + maxOf(d.novosPlanejados, d.feitosHoje.size)
    val feito = d.revFeitasHoje.size + d.feitosHoje.size
    val podeTreino = d.materias.sumOf { m -> m.topicos.count { it.estudado && it.temAula } } >= 2
    val normal = (d.horas * 60).toInt()
    val opcoes = listOf(30 to "30 min", 60 to "1 h", 120 to "2 h").filter { it.first < normal } + (normal to "Normal · ${fmtHoras(d.horas)}")

    LazyColumn(contentPadding = PaddingValues(start = Dimens.p4, end = Dimens.p4, top = conteudo.calculateTopPadding() + Dimens.p2, bottom = conteudo.calculateBottomPadding() + 88.dp)) {
        if (d.retaFinal) item { Dica("Reta final", "Priorize revisões, caderno de erros e treinos mistos. Tópicos novos, só de incidência alta.", Modifier.padding(bottom = Dimens.p4)) }
        item(key = "prox") {
            Cartao {
                Column(Modifier.padding(Dimens.p4), verticalArrangement = Arrangement.spacedBy(Dimens.p2)) {
                    Row { Text("PRÓXIMO PASSO", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
                        Text("$feito de ${maxOf(planejado, feito)} feitos", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    if (prox != null) {
                        Text(prox.titulo, style = MaterialTheme.typography.titleLarge, modifier = Modifier.semantics { heading() })
                        Text("${prox.detalhe}. ${prox.porque}", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    } else {
                        Text("Plano de hoje concluído", style = MaterialTheme.typography.titleLarge, modifier = Modifier.semantics { heading() })
                        Text("Se ainda tiver tempo, um treino misto com questões de vários tópicos é o melhor uso dele.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Barra(if (planejado > 0) feito.toFloat() / planejado else 0f, MaterialTheme.colorScheme.primary, Modifier.padding(vertical = Dimens.p1))
                    if (podeTreino) OutlinedButton(onClick = treino, modifier = Modifier.fillMaxWidth()) { Text("Treino misto · 10 questões") }
                    Text("QUANTO TEMPO VOCÊ TEM HOJE?", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = Dimens.p2))
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(Dimens.p2)) {
                        opcoes.forEach { (v, t) -> FilterChip(selected = d.minHoje == v, onClick = { tempo(v) }, label = { Text(t) }) }
                    }
                    d.seEntao?.let { Text("Seu compromisso: $it", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                }
            }
        }
        item(key = "kpis") {
            Row(Modifier.fillMaxWidth().padding(top = Dimens.p4), horizontalArrangement = Arrangement.spacedBy(Dimens.p2)) {
                Kpi("Edital", "${d.cobertura}%", "${d.estudados} de ${d.totalTopicos}", Modifier.weight(1f))
                Kpi("Acerto", if (d.questoes > 0) "${Math.round(d.acertos * 100.0 / d.questoes)}%" else "—", "${d.questoes} questões", Modifier.weight(1f))
                Kpi("Prova", d.diasProva?.let { "${maxOf(0, it)}" } ?: "—", if (d.diasProva != null) "dias" else "sem data", Modifier.weight(1f))
            }
        }
        item(key = "h-rev") { Secao("Revisões", extra = if (d.revsTotal > 0) "${d.revsHoje.size} de ${d.revsTotal} cabem hoje" else null) }
        if (d.revsHoje.isEmpty() && d.revFeitasHoje.isEmpty()) item { Vazio("Nenhuma revisão para hoje. A primeira vem no dia seguinte ao estudo; as próximas se espaçam conforme você acerta.") }
        else item(key = "revs") { Lista(d.revFeitasHoje.map { ItemPlano(it, "feita hoje", Tipo.FEITO) } + d.revsHoje, abrir) }
        if (d.errosHoje > 0) {
            item(key = "h-err") { Secao("Caderno de erros") }
            item(key = "err") {
                Cartao { Linha("Refazer questões erradas sem ver o gabarito", "${d.errosHoje} para hoje · cerca de ${d.minErr} min",
                    etiqueta = { Etiqueta("${d.errosHoje} hoje", s.ruimFundo, s.ruimTexto) }, onClick = irErros) }
            }
        }
        item(key = "h-novos") { Secao("Tópicos novos", extra = if (d.novosPlanejados > 0) "blocos de 50 min" else "sem tempo hoje") }
        if (d.novos.isEmpty() && d.feitosHoje.isEmpty()) item {
            Vazio(if (d.novosPlanejados > 0) "Nenhum tópico novo pendente." else "Com o tempo de hoje, o plano fica com revisões e erros. Isso já conta.")
        } else item(key = "novos") { Lista(d.feitosHoje.map { ItemPlano(it, "feito hoje", Tipo.FEITO) } + d.novos, abrir) }
        item(key = "proj") { Text(d.projecao, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = Dimens.p3)) }
    }
}

@Composable
private fun Lista(itens: List<ItemPlano>, abrir: (String, Boolean) -> Unit) {
    val s = LocalSemantica.current
    Cartao {
        Column {
            itens.forEachIndexed { i, x ->
                if (i > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                val (f, c) = when (x.tipo) {
                    Tipo.REVISAO -> s.alertaFundo to s.alertaTexto
                    Tipo.FEITO -> s.okFundo to s.okTexto
                    Tipo.NOVO -> MaterialTheme.colorScheme.primaryContainer to MaterialTheme.colorScheme.onPrimaryContainer
                }
                Linha(x.t.nome, detalhe(x.t), etiqueta = { Etiqueta(x.tag, f, c) }) { abrir(x.t.id, x.tipo == Tipo.REVISAO || x.t.estudado) }
            }
        }
    }
}

fun detalhe(t: TopicoUi): String = buildString {
    append(t.materia)
    append(" · incidência ${t.inc.replace("media", "média")}")
    if (t.pdfs > 0) append(" · ${t.pdfs} PDF${if (t.pdfs > 1) "s" else ""}")
    if (!t.temAula) append(" · aula ainda não sincronizada")
}

@Composable
fun Kpi(rotulo: String, valor: String, sub: String, modifier: Modifier = Modifier) {
    Cartao(modifier) {
        Column(Modifier.padding(Dimens.p3)) {
            Text(rotulo.uppercase(), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(valor, style = MaterialTheme.typography.headlineSmall)
            Text(sub, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
fun Vazio(texto: String) {
    Cartao { Text(texto, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(Dimens.p5)) }
    Spacer(Modifier.height(Dimens.p1))
}

fun fmtHoras(h: Double): String = (if (h % 1.0 == 0.0) h.toInt().toString() else h.toString().replace('.', ',')) + " h"
