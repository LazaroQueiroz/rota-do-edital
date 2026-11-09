package br.rotadoedital.ui.telas

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import br.rotadoedital.dominio.Questao
import br.rotadoedital.ui.Dados
import br.rotadoedital.ui.ErroUi
import br.rotadoedital.ui.ItemTreino
import br.rotadoedital.ui.MateriaUi
import br.rotadoedital.ui.comp.Barra
import br.rotadoedital.ui.comp.Cartao
import br.rotadoedital.ui.comp.Dica
import br.rotadoedital.ui.comp.Etiqueta
import br.rotadoedital.ui.comp.Linha
import br.rotadoedital.ui.comp.QuestaoCard
import br.rotadoedital.ui.comp.Secao
import br.rotadoedital.ui.theme.Dimens
import br.rotadoedital.ui.theme.LocalSemantica
import kotlinx.coroutines.delay
import java.time.LocalDate

// ---------------------------------------------------------------- Edital verticalizado
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun TelaEdital(d: Dados, conteudo: PaddingValues, abrir: (String, Boolean) -> Unit) {
    val abertas = remember { mutableStateMapOf<String, Boolean>() }
    val s = LocalSemantica.current
    LazyColumn(contentPadding = PaddingValues(start = Dimens.p4, end = Dimens.p4, top = conteudo.calculateTopPadding() + Dimens.p2, bottom = conteudo.calculateBottomPadding() + Dimens.p4)) {
        item {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Dimens.p3), modifier = Modifier.padding(bottom = Dimens.p3)) {
                Legenda(null, "a estudar"); Legenda(MaterialTheme.colorScheme.primary, "estudado"); Legenda(s.ok, "3+ revisões"); Legenda(s.ruim, "acerto < 60%")
            }
        }
        d.materias.forEach { m ->
            item(key = m.id) { MateriaCab(m, abertas[m.id] == true) { abertas[m.id] = abertas[m.id] != true } }
            if (abertas[m.id] == true) item(key = m.id + "-l") {
                Cartao(Modifier.padding(bottom = Dimens.p3)) {
                    Column {
                        m.topicos.forEachIndexed { i, t ->
                            if (i > 0) HorizontalDivider()
                            Linha(t.nome, buildString {
                                append(if (t.feitas > 0) "${t.acertos}/${t.feitas} acertos" else "sem questões")
                                t.proxRev?.let { append(" · revisão ${br(it)}") }
                                if (t.pdfs > 0) append(" · ${t.pdfs} PDF${if (t.pdfs > 1) "s" else ""}")
                            }, etiqueta = {
                                if (t.estudado) Etiqueta("estudado", s.okFundo, s.okTexto)
                                else Etiqueta(t.inc.replace("media", "média"), if (t.inc == "alta") MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant,
                                    if (t.inc == "alta") MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurfaceVariant)
                            }) { abrir(t.id, t.estudado) }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Legenda(cor: androidx.compose.ui.graphics.Color?, txt: String) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Bolinha(cor); Text(txt, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun Bolinha(cor: androidx.compose.ui.graphics.Color?) {
    Box(Modifier.size(12.dp).then(if (cor != null) Modifier.background(cor, CircleShape) else Modifier.border(1.5.dp, MaterialTheme.colorScheme.outline, CircleShape)))
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun MateriaCab(m: MateriaUi, aberta: Boolean, alternar: () -> Unit) {
    val s = LocalSemantica.current
    Column(Modifier.fillMaxWidth().clickable(role = Role.Button, onClickLabel = if (aberta) "recolher" else "ver tópicos", onClick = alternar)
        .heightIn(min = Dimens.toque).padding(vertical = Dimens.p3), verticalArrangement = Arrangement.spacedBy(Dimens.p2)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text((if (aberta) "▾ " else "▸ ") + m.nome, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
            Text(buildString { if (m.questoes > 0) append("${m.questoes} q · "); append("${m.estudados}/${m.topicos.size}"); m.acc?.let { append(" · ${(it * 100).toInt()}%") } },
                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(5.dp), verticalArrangement = Arrangement.spacedBy(5.dp),
            modifier = Modifier.semantics { contentDescription = "${m.estudados} de ${m.topicos.size} tópicos estudados" }) {
            m.topicos.forEach { t -> Bolinha(when { !t.estudado -> null; t.fraco -> s.ruim; t.revsFeitas >= 3 -> s.ok; else -> MaterialTheme.colorScheme.primary }) }
        }
        HorizontalDivider(Modifier.padding(top = Dimens.p2))
    }
}

// ---------------------------------------------------------------- Caderno de erros
val TIPOS_ERRO = listOf("conteudo" to "Não sabia o conteúdo", "confusao" to "Confundi conceitos", "leitura" to "Li errado / pegadinha", "atencao" to "Desatenção")

@OptIn(ExperimentalLayoutApi::class, androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun TelaErros(d: Dados, conteudo: PaddingValues, refazer: (String, String) -> Unit, tipo: (String, String) -> Unit) {
    val hoje = LocalDate.now().toString()
    val devidos = d.erros.filter { !it.dom && it.due <= hoje }
    var aba by rememberSaveable { mutableStateOf(if (devidos.isNotEmpty()) 0 else 1) }
    val respostas = remember { mutableStateMapOf<String, String>() }   // respostas desta sessão
    val lista = when (aba) {
        0 -> d.erros.filter { (!it.dom && it.due <= hoje) || respostas.containsKey(it.id) }
        1 -> d.erros.filter { !it.dom }
        else -> d.erros.filter { it.dom }
    }.sortedByDescending { it.conf == "certeza" && !it.sorte }
    Column(Modifier.padding(top = conteudo.calculateTopPadding())) {
        PrimaryTabRow(selectedTabIndex = aba) {
            listOf("Hoje · ${devidos.size}", "Na fila · ${d.erros.count { !it.dom }}", "Dominados · ${d.erros.count { it.dom }}").forEachIndexed { i, t ->
                Tab(selected = aba == i, onClick = { aba = i }, text = { Text(t) })
            }
        }
        LazyColumn(contentPadding = PaddingValues(start = Dimens.p4, end = Dimens.p4, top = Dimens.p3, bottom = conteudo.calculateBottomPadding() + Dimens.p4),
            verticalArrangement = Arrangement.spacedBy(Dimens.p3)) {
            if (aba == 0) item { Dica("Responda antes de ver o gabarito.", "Acertou: volta em 3 e depois em 7 dias. Errou: volta amanhã. Três acertos em dias diferentes e ela está dominada.") }
            if (lista.isEmpty()) item { Vazio(when (aba) { 0 -> "Nada para refazer hoje."; 2 -> "Nenhuma questão dominada ainda."; else -> "Cada questão que você errar (ou acertar no chute) entra aqui." }) }
            items(lista, key = { it.id }) { x -> ErroCard(x, aba == 0, respostas[x.id], { op -> respostas[x.id] = op; refazer(x.id, op) }, { tipo(x.id, it) }) }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ErroCard(x: ErroUi, refazendo: Boolean, resposta: String?, responder: (String) -> Unit, classificar: (String) -> Unit) {
    val s = LocalSemantica.current
    val oculto = refazendo && resposta == null
    Column(verticalArrangement = Arrangement.spacedBy(Dimens.p2)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Dimens.p2)) {
            Text(x.materia.uppercase(), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
            if (x.sorte) Etiqueta("acertou no chute", s.alertaFundo, s.alertaTexto)
            else if (x.conf == "certeza") Etiqueta("errou com certeza", s.ruimFundo, s.ruimTexto)
            Text(if (x.dom) "dominada" else "${x.ok}/3", style = MaterialTheme.typography.labelMedium, color = s.okTexto)
        }
        QuestaoCard(Questao(x.enunciado, x.alternativas, x.gabarito, x.explicacao), x.topico.ifBlank { "Questão" },
            resposta ?: if (oculto) null else x.marcada ?: x.gabarito, null, pre = true, onConf = {}, onResponder = { if (oculto) responder(it) })
        if (!oculto) {
            Text("Por que errei?", style = MaterialTheme.typography.labelLarge)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Dimens.p2)) {
                TIPOS_ERRO.forEach { (k, t) -> FilterChip(selected = x.tipo == k, onClick = { classificar(k) }, label = { Text(t) }) }
            }
        }
    }
}

// ---------------------------------------------------------------- Treino misto
@Composable
fun TelaTreino(d: Dados, conteudo: PaddingValues, montar: suspend () -> List<ItemTreino>, responder: (String, Questao, String, String?) -> Unit, sair: () -> Unit) {
    var itens by remember { mutableStateOf<List<ItemTreino>?>(null) }
    var rodada by remember { mutableStateOf(0) }
    val resp = remember(rodada) { mutableStateMapOf<Int, String>() }
    val conf = remember(rodada) { mutableStateMapOf<Int, String>() }
    var inicio by remember(rodada) { mutableLongStateOf(System.currentTimeMillis()) }
    var agora by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(rodada) { itens = null; itens = montar(); inicio = System.currentTimeMillis() }
    val lista = itens
    val fim = lista != null && lista.isNotEmpty() && resp.size == lista.size
    LaunchedEffect(fim, rodada) { while (!fim) { agora = System.currentTimeMillis(); delay(1000) } }
    val seg = ((if (fim) agora else agora) - inicio) / 1000
    val ritmo = if (d.estiloCE) 90 else 180
    LazyColumn(contentPadding = PaddingValues(start = Dimens.p4, end = Dimens.p4, top = conteudo.calculateTopPadding() + Dimens.p2, bottom = conteudo.calculateBottomPadding() + Dimens.p4),
        verticalArrangement = Arrangement.spacedBy(Dimens.p3)) {
        item { Dica("Por que misturar?", "Sem saber de que assunto é a próxima questão, você treina reconhecer o que ela pede, como na prova. Tópicos com acerto baixo e revisões antigas aparecem mais.") }
        when {
            lista == null -> item { Box(Modifier.fillMaxWidth().padding(Dimens.p8), contentAlignment = Alignment.Center) { CircularProgressIndicator() } }
            lista.isEmpty() -> item { Vazio("Estude pelo menos dois tópicos com aula no celular para fazer um treino misto.") }
            else -> {
                item {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Dimens.p3)) {
                        Text("${resp.size}/${lista.size}", style = MaterialTheme.typography.titleSmall)
                        Barra(resp.size.toFloat() / lista.size, MaterialTheme.colorScheme.primary, Modifier.weight(1f))
                        Text(mmss(seg), style = MaterialTheme.typography.titleSmall)
                    }
                }
                if (fim) item {
                    val ac = lista.withIndex().count { (i, it) -> resp[i] == it.q.gabarito }
                    Cartao {
                        Column(Modifier.padding(Dimens.p4), verticalArrangement = Arrangement.spacedBy(Dimens.p2)) {
                            Text("Treino concluído", style = MaterialTheme.typography.titleLarge)
                            Row(horizontalArrangement = Arrangement.spacedBy(Dimens.p2)) {
                                Kpi("Acerto", "${ac * 100 / lista.size}%", "$ac de ${lista.size}", Modifier.weight(1f))
                                Kpi("Por questão", mmss(seg / lista.size), "ritmo: até ${mmss(ritmo.toLong())}", Modifier.weight(1f))
                            }
                            Text("Erros e acertos no chute já estão no caderno.", style = MaterialTheme.typography.bodyMedium)
                            Row(horizontalArrangement = Arrangement.spacedBy(Dimens.p2)) {
                                Button(onClick = { rodada++ }) { Text("Outro treino") }
                                androidx.compose.material3.OutlinedButton(onClick = sair) { Text("Voltar") }
                            }
                        }
                    }
                }
                items(lista.size, key = { "t$rodada-$it" }) { i ->
                    val it = lista[i]
                    QuestaoCard(it.q, "${i + 1} · ${it.materia}", resp[i], conf[i], false,
                        onConf = { c -> if (c == null) conf.remove(i) else conf[i] = c },
                        onResponder = { op -> resp[i] = op; responder(it.tid, it.q, op, conf[i]) })
                }
            }
        }
    }
}

fun mmss(s: Long) = "%d:%02d".format(s / 60, s % 60)
