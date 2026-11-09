package br.rotadoedital.ui.telas

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import br.rotadoedital.dados.Conexao
import br.rotadoedital.sync.EstadoSync
import br.rotadoedital.ui.Dados
import br.rotadoedital.ui.comp.Barra
import br.rotadoedital.ui.comp.Cartao
import br.rotadoedital.ui.comp.Dica
import br.rotadoedital.ui.comp.Linha
import br.rotadoedital.ui.comp.Secao
import br.rotadoedital.ui.theme.Dimens
import br.rotadoedital.ui.theme.LocalSemantica
import java.time.LocalDate

// ---------------------------------------------------------------- Mais
@Composable
fun TelaMais(conteudo: PaddingValues, desempenho: () -> Unit, ajustes: () -> Unit, sync: EstadoSync, con: Conexao?) {
    LazyColumn(contentPadding = PaddingValues(start = Dimens.p4, end = Dimens.p4, top = conteudo.calculateTopPadding() + Dimens.p2, bottom = conteudo.calculateBottomPadding())) {
        item {
            Cartao {
                Column {
                    Linha("Desempenho", "Acerto por matéria, confiança × acerto e constância", onClick = desempenho)
                    HorizontalDivider()
                    Linha("Ajustes e sincronização", textoSync(sync, con), onClick = ajustes)
                }
            }
        }
    }
}

fun textoSync(s: EstadoSync, c: Conexao?): String = when {
    c == null || !c.pareado -> "Não conectado ao PC"
    s.rodando -> if (s.fase == "pdfs" && s.total > 0) "Baixando PDFs: ${s.feitos} de ${s.total}" else "Sincronizando…"
    c.erro != null -> "Sem conexão com o PC na última tentativa"
    c.ultimo > 0 -> "Sincronizado ${haQuanto(c.ultimo)}"
    else -> "Ainda não sincronizado"
}

fun haQuanto(ms: Long): String {
    val m = (System.currentTimeMillis() - ms) / 60000
    return when { m < 1 -> "agora"; m < 60 -> "há $m min"; m < 1440 -> "há ${m / 60} h"; else -> "há ${m / 1440} d" }
}

// ---------------------------------------------------------------- Desempenho
@Composable
fun TelaDesempenho(d: Dados, conteudo: PaddingValues, abrir: (String, Boolean) -> Unit) {
    val s = LocalSemantica.current
    val cor = { v: Double? -> when { v == null -> s.ruim.copy(alpha = 0f); v >= .75 -> s.ok; v >= .6 -> s.alerta; else -> s.ruim } }
    LazyColumn(contentPadding = PaddingValues(start = Dimens.p4, end = Dimens.p4, top = conteudo.calculateTopPadding(), bottom = conteudo.calculateBottomPadding() + Dimens.p4)) {
        item { Secao("Acerto por matéria") }
        item {
            Cartao {
                Column(Modifier.padding(Dimens.p4), verticalArrangement = Arrangement.spacedBy(Dimens.p4)) {
                    d.materias.forEach { m ->
                        val f = m.topicos.sumOf { it.feitas }
                        Column(verticalArrangement = Arrangement.spacedBy(Dimens.p1)) {
                            Row { Text(m.nome, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f)); Text(m.acc?.let { "${(it * 100).toInt()}%" } ?: "—", style = MaterialTheme.typography.titleSmall) }
                            Barra((m.acc ?: 0.0).toFloat(), cor(m.acc))
                            Text("$f questões · ${m.estudados} de ${m.topicos.size} tópicos", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
        }
        item { Secao("Confiança × acerto") }
        item {
            if (d.calib.isEmpty()) Vazio("Marque Certeza, Dúvida ou Chute antes de responder. Aqui aparece o quanto sua confiança acompanha o acerto.")
            else Column(verticalArrangement = Arrangement.spacedBy(Dimens.p2)) {
                Row(horizontalArrangement = Arrangement.spacedBy(Dimens.p2)) {
                    d.calib.forEach { c -> Kpi(mapOf("certeza" to "Certeza", "duvida" to "Dúvida", "chute" to "Chute")[c.nivel] ?: c.nivel, "${c.a * 100 / c.f}%", "${c.a} de ${c.f}", Modifier.weight(1f)) }
                }
                val duv = d.calib.firstOrNull { it.nivel == "duvida" && it.f >= 5 }
                if (d.estiloCE) Text(buildString {
                    val saldo = d.calib.sumOf { 2 * it.a - it.f }
                    append("Em prova em que uma errada anula uma certa, vale responder quando a chance de acerto passa de 50%. Saldo (certos − errados): $saldo.")
                    duv?.let { append(if (it.a * 2 > it.f) " Seus itens de dúvida acertam ${it.a * 100 / it.f}%: compensa responder." else " Seus itens de dúvida acertam ${it.a * 100 / it.f}%: na prova, deixe em branco.") }
                }, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                else Text("Muitos erros com certeza indicam conceitos confundidos (estão marcados no caderno).", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        item { Secao("Constância") }
        item {
            val hoje = LocalDate.now()
            val dias = (13 downTo 0).map { hoje.minusDays(it.toLong()).toString() }
            val max = maxOf(1, dias.maxOf { d.ativ[it] ?: 0 })
            val ativos = dias.count { (d.ativ[it] ?: 0) > 0 }
            Cartao {
                Column(Modifier.padding(Dimens.p4)) {
                    Row(Modifier.fillMaxWidth().height(64.dp).semantics { contentDescription = "Estudou em $ativos dos últimos 14 dias" },
                        horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.Bottom) {
                        dias.forEach { dia ->
                            val v = d.ativ[dia] ?: 0
                            Box(Modifier.weight(1f).fillMaxHeight(if (v > 0) maxOf(.18f, v.toFloat() / max) else .08f)
                                .background(if (v > 0) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(topStart = 3.dp, topEnd = 3.dp)))
                        }
                    }
                    Text("Estudou em $ativos dos últimos 14 dias. Pouco todo dia rende mais do que muito de vez em quando.",
                        style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = Dimens.p2))
                }
            }
        }
        val fracos = d.materias.flatMap { it.topicos }.filter { it.fraco }.sortedBy { it.acc }
        item { Secao("Tópicos para reforçar") }
        item {
            if (fracos.isEmpty()) Vazio("Tópicos com acerto abaixo de 60% (a partir de 3 questões) aparecem aqui.")
            else Cartao { Column { fracos.forEachIndexed { i, t -> if (i > 0) HorizontalDivider(); Linha(t.nome, "${t.materia} · ${t.acertos}/${t.feitas} acertos") { abrir(t.id, true) } } } }
        }
    }
}

// ---------------------------------------------------------------- Conectar ao PC (primeiro uso e Ajustes)
@Composable
fun PainelConectar(con: Conexao?, conectar: (String, String, () -> Unit) -> Unit) {
    var endereco by rememberSaveable { mutableStateOf(con?.endereco ?: "") }
    var codigo by rememberSaveable { mutableStateOf("") }
    var enviando by rememberSaveable { mutableStateOf(false) }
    val enviar = { if (!enviando && endereco.isNotBlank() && codigo.length == 6) { enviando = true; conectar(endereco, codigo) { enviando = false } } }
    Column(verticalArrangement = Arrangement.spacedBy(Dimens.p3)) {
        Text("No PC, abra o Rota do Edital pelo iniciar-na-rede e veja em Ajustes → Celular o endereço e o código. Os dois aparelhos precisam estar no mesmo Wi-Fi.",
            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        OutlinedTextField(endereco, { endereco = it.trim() }, label = { Text("Endereço do PC") }, placeholder = { Text("192.168.0.10:8765") }, singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Next), modifier = Modifier.fillMaxWidth())
        OutlinedTextField(codigo, { codigo = it.uppercase().filter(Char::isLetterOrDigit).take(6) }, label = { Text("Código de 6 letras") }, singleLine = true,
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, keyboardType = KeyboardType.Ascii, imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { enviar() }),
            supportingText = { Text("O código só serve para parear. Depois o celular usa uma chave própria, guardada cifrada.") }, modifier = Modifier.fillMaxWidth())
        Button(onClick = enviar, enabled = !enviando, modifier = Modifier.fillMaxWidth().heightIn(min = Dimens.toque)) {
            if (enviando) CircularProgressIndicator(Modifier.height(20.dp), strokeWidth = 2.dp) else Text("Conectar e sincronizar")
        }
        if (enviando) TextButton(onClick = { enviando = false }) { Text("Cancelar") }
        con?.erro?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error) }
    }
}

@Composable
fun TelaBoasVindas(conteudo: PaddingValues, con: Conexao?, sync: EstadoSync, conectar: (String, String, () -> Unit) -> Unit) {
    LazyColumn(Modifier.imePadding(), contentPadding = PaddingValues(start = Dimens.p4, end = Dimens.p4, top = conteudo.calculateTopPadding() + Dimens.p6, bottom = Dimens.p8)) {
        item { Text("ROTA DO EDITAL", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        item { Text("Seu plano de estudos, também no celular", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.padding(vertical = Dimens.p2)) }
        item { Text("Conecte ao Rota do Edital do seu PC para trazer o edital, o progresso, as aulas e os PDFs. Depois tudo funciona sem internet e volta para o PC na próxima sincronização.",
            style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(bottom = Dimens.p6)) }
        if (con?.pareado == true) item {
            Column(verticalArrangement = Arrangement.spacedBy(Dimens.p2)) {
                Text(textoSync(sync, con), style = MaterialTheme.typography.titleSmall)
                LinearProgressIndicator(Modifier.fillMaxWidth())
                Text("Na primeira vez, o PC envia o edital e as aulas. Os PDFs continuam baixando em segundo plano.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        } else item { PainelConectar(con, conectar) }
    }
}

// ---------------------------------------------------------------- Ajustes
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun TelaAjustes(
    d: Dados?, conteudo: PaddingValues, con: Conexao?, sync: EstadoSync, tema: String,
    conectar: (String, String, () -> Unit) -> Unit, sincronizar: () -> Unit, desconectar: () -> Unit,
    definirTema: (String) -> Unit, salvarPlano: (Double, String?, String) -> Unit,
) {
    var confirmar by rememberSaveable { mutableStateOf(false) }
    LazyColumn(Modifier.imePadding(), contentPadding = PaddingValues(start = Dimens.p4, end = Dimens.p4, top = conteudo.calculateTopPadding(), bottom = conteudo.calculateBottomPadding() + Dimens.p6)) {
        item { Secao("Sincronizar com o PC") }
        item {
            Cartao {
                Column(Modifier.padding(Dimens.p4), verticalArrangement = Arrangement.spacedBy(Dimens.p3)) {
                    if (con?.pareado != true) PainelConectar(con, conectar)
                    else {
                        Text("Conectado a ${con.endereco}. ${textoSync(sync, con)}.", style = MaterialTheme.typography.bodyLarge)
                        if (sync.rodando) {
                            if (sync.fase == "pdfs" && sync.total > 0) LinearProgressIndicator({ sync.feitos.toFloat() / sync.total }, Modifier.fillMaxWidth())
                            else LinearProgressIndicator(Modifier.fillMaxWidth())
                        }
                        con.erro?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error) }
                        Text("O app sincroniza sozinho ao abrir, pouco depois de cada estudo e a cada hora, quando está no Wi-Fi.",
                            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Row(horizontalArrangement = Arrangement.spacedBy(Dimens.p2), verticalAlignment = Alignment.CenterVertically) {
                            Button(onClick = sincronizar, enabled = !sync.rodando) { Text("Sincronizar agora") }
                            if (!confirmar) TextButton(onClick = { confirmar = true }) { Text("Desconectar") }
                        }
                        if (confirmar) Dica("Desconectar este celular?", "Os dados continuam aqui, mas param de ir para o PC até você parear de novo.")
                        if (confirmar) Row(horizontalArrangement = Arrangement.spacedBy(Dimens.p2)) {
                            OutlinedButton(onClick = { desconectar(); confirmar = false }) { Text("Desconectar") }
                            TextButton(onClick = { confirmar = false }) { Text("Cancelar") }
                        }
                    }
                }
            }
        }
        item { Secao("Aparência") }
        item {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Dimens.p2)) {
                listOf("sistema" to "Seguir o sistema", "claro" to "Claro", "escuro" to "Escuro").forEach { (k, t) -> FilterChip(selected = tema == k, onClick = { definirTema(k) }, label = { Text(t) }) }
            }
        }
        if (d != null) {
            item { Secao("Plano") }
            item { Plano(d, salvarPlano) }
        }
    }
}

@Composable
private fun Plano(d: Dados, salvar: (Double, String?, String) -> Unit) {
    var horas by rememberSaveable(d.id) { mutableStateOf(d.horas.toString().removeSuffix(".0").replace('.', ',')) }
    var data by rememberSaveable(d.id) { mutableStateOf(d.dataProva?.let { br(it) } ?: "") }
    var seEntao by rememberSaveable(d.id) { mutableStateOf(d.seEntao ?: "") }
    var erro by rememberSaveable { mutableStateOf<String?>(null) }
    Cartao {
        Column(Modifier.padding(Dimens.p4), verticalArrangement = Arrangement.spacedBy(Dimens.p3)) {
            OutlinedTextField(horas, { horas = it.filter { c -> c.isDigit() || c == ',' || c == '.' }.take(4) }, label = { Text("Horas de estudo por dia") }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal, imeAction = ImeAction.Next), modifier = Modifier.fillMaxWidth())
            OutlinedTextField(data, { data = it.filter { c -> c.isDigit() || c == '/' }.take(10) }, label = { Text("Data da prova (dd/mm/aaaa)") }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Next), modifier = Modifier.fillMaxWidth(),
                isError = erro != null, supportingText = erro?.let { e -> { Text(e) } })
            OutlinedTextField(seEntao, { seEntao = it.take(200) }, label = { Text("Meu compromisso: quando e onde vou estudar") },
                placeholder = { Text("Se eu pegar o ônibus às 7h, então faço as revisões no caminho.") }, modifier = Modifier.fillMaxWidth(), minLines = 2,
                supportingText = { Text("Planos se–então aumentam a chance de cumprir. Aparece na aba Hoje.") })
            Button(onClick = {
                val h = horas.replace(',', '.').toDoubleOrNull()
                val iso = data.takeIf { it.isNotBlank() }?.split("/")?.takeIf { it.size == 3 }?.let { (dd, mm, aa) -> runCatching { LocalDate.of(aa.toInt(), mm.toInt(), dd.toInt()).toString() }.getOrNull() }
                erro = if (data.isNotBlank() && iso == null) "Use o formato dd/mm/aaaa, por exemplo 24/01/2027." else null
                if (h != null && h > 0 && erro == null) salvar(h, iso, seEntao)
            }, modifier = Modifier.heightIn(min = Dimens.toque)) { Text("Salvar e recalcular") }
        }
    }
}
