package br.rotadoedital.ui.comp

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowRight
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import br.rotadoedital.dominio.Questao
import br.rotadoedital.ui.theme.Dimens
import br.rotadoedital.ui.theme.LocalSemantica

@Composable
fun Secao(titulo: String, modifier: Modifier = Modifier, extra: String? = null) {
    Row(modifier.fillMaxWidth().padding(top = Dimens.p6, bottom = Dimens.p2), verticalAlignment = Alignment.CenterVertically) {
        Text(titulo, style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f).semantics { heading() })
        if (extra != null) Text(extra, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** Caixa de orientação (por que fazer assim), em azul informativo. */
@Composable
fun Dica(titulo: String, texto: String, modifier: Modifier = Modifier) {
    val s = LocalSemantica.current
    Row(modifier.fillMaxWidth().background(s.infoFundo, RoundedCornerShape(8.dp))) {
        Box(Modifier.width(3.dp).heightIn(min = 48.dp).background(s.info))
        Column(Modifier.padding(Dimens.p3)) {
            Text(titulo, style = MaterialTheme.typography.titleSmall, color = s.infoTexto)
            Text(texto, style = MaterialTheme.typography.bodyMedium, color = s.infoTexto)
        }
    }
}

@Composable
fun Etiqueta(texto: String, fundo: Color, cor: Color) {
    Text(texto, style = MaterialTheme.typography.labelMedium, color = cor,
        modifier = Modifier.background(fundo, RoundedCornerShape(4.dp)).padding(horizontal = 7.dp, vertical = 3.dp), maxLines = 1)
}

/** Linha de lista tocável (≥ 56 dp), com etiqueta, título e detalhe. */
@Composable
fun Linha(titulo: String, detalhe: String, etiqueta: (@Composable () -> Unit)? = null, onClick: (() -> Unit)? = null) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 56.dp)
            .then(if (onClick != null) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier)
            .padding(horizontal = Dimens.p4, vertical = Dimens.p3),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Dimens.p3),
    ) {
        // largura mínima fixa: os títulos começam todos na mesma coluna
        if (etiqueta != null) Box(Modifier.widthIn(min = 92.dp)) { etiqueta() }
        Column(Modifier.weight(1f)) {
            Text(titulo, style = MaterialTheme.typography.titleSmall, maxLines = 3, overflow = TextOverflow.Ellipsis)
            if (detalhe.isNotEmpty()) Text(detalhe, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (onClick != null) Icon(Icons.Filled.KeyboardArrowRight, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
fun Cartao(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    OutlinedCard(modifier.fillMaxWidth(), border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) { content() }
}

@Composable
fun Barra(fracao: Float, cor: Color, modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().height(8.dp).background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(4.dp))) {
        Box(Modifier.fillMaxWidth(fracao.coerceIn(0f, 1f)).height(8.dp).background(cor, RoundedCornerShape(4.dp)))
    }
}

/** Markdown simples das aulas: ### subtítulo, - lista, **negrito**. */
@Composable
fun Markdown(texto: String) {
    val blocos = remember(texto) { texto.lines().map { it.trimEnd() } }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        for (l in blocos) {
            when {
                l.isBlank() -> Unit
                l.trimStart().startsWith("#") -> Text(negrito(l.trimStart('#', ' ')), style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.padding(top = Dimens.p2).semantics { heading() })
                Regex("""^\s*([-*•]|\d+[.)])\s+""").containsMatchIn(l) -> Row {
                    Text("•  ", style = MaterialTheme.typography.bodyLarge)
                    Text(negrito(l.replace(Regex("""^\s*([-*•]|\d+[.)])\s+"""), "")), style = MaterialTheme.typography.bodyLarge)
                }
                else -> Text(negrito(l), style = MaterialTheme.typography.bodyLarge)
            }
        }
    }
}

private fun negrito(s: String): AnnotatedString = buildAnnotatedString {
    val partes = s.split("**")
    partes.forEachIndexed { i, p -> if (i % 2 == 1) withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append(p) } else append(p) }
}

val CONF = listOf("certeza" to "Certeza", "duvida" to "Dúvida", "chute" to "Chute")

/**
 * Questão: confiança antes de responder (opcional), alternativas com alvo ≥ 48 dp e
 * feedback com cor + texto (nunca só cor).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun QuestaoCard(
    q: Questao, rotulo: String, resposta: String?, conf: String?, pre: Boolean,
    onConf: (String?) -> Unit, onResponder: (String) -> Unit,
) {
    val s = LocalSemantica.current
    val ce = q.alternativas == null
    Cartao {
        Column(Modifier.padding(Dimens.p4), verticalArrangement = Arrangement.spacedBy(Dimens.p3)) {
            Text(rotulo.uppercase(), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(q.enunciado, style = MaterialTheme.typography.bodyLarge)
            if (resposta == null && !pre) FlowRow(horizontalArrangement = Arrangement.spacedBy(Dimens.p2), verticalArrangement = Arrangement.Center) {
                Text("Confiança:", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.align(Alignment.CenterVertically))
                CONF.forEach { (k, t) -> FilterChip(selected = conf == k, onClick = { onConf(if (conf == k) null else k) }, label = { Text(t) }) }
            }
            val opcoes = if (ce) listOf("C" to "Certo", "E" to "Errado") else q.alternativas!!.mapIndexed { i, a -> "ABCDE"[i].toString() to a }
            opcoes.forEach { (letra, texto) ->
                val estado = when { resposta == null -> 0; letra == q.gabarito -> 1; letra == resposta -> 2; else -> 3 }
                val (fundo, borda) = when (estado) {
                    1 -> s.okFundo to s.ok
                    2 -> s.ruimFundo to s.ruim
                    else -> Color.Transparent to MaterialTheme.colorScheme.outlineVariant
                }
                Surface(
                    onClick = { if (resposta == null) onResponder(letra) }, enabled = resposta == null,
                    shape = RoundedCornerShape(8.dp), color = fundo, border = BorderStroke(1.dp, borda),
                    modifier = Modifier.fillMaxWidth().heightIn(min = Dimens.toque),
                ) {
                    Row(Modifier.padding(horizontal = Dimens.p3, vertical = Dimens.p2), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(26.dp).background(if (estado == 1) s.ok else if (estado == 2) s.ruim else Color.Transparent, CircleShape)
                            .then(if (estado == 0 || estado == 3) Modifier.border(1.5.dp, MaterialTheme.colorScheme.primary, CircleShape) else Modifier), contentAlignment = Alignment.Center) {
                            Text(letra, style = MaterialTheme.typography.labelLarge,
                                color = if (estado == 1 || estado == 2) MaterialTheme.colorScheme.surface else MaterialTheme.colorScheme.primary)
                        }
                        Spacer(Modifier.width(Dimens.p3))
                        Text(texto, style = MaterialTheme.typography.bodyLarge, color = if (estado == 1) s.okTexto else if (estado == 2) s.ruimTexto else MaterialTheme.colorScheme.onSurface)
                    }
                }
            }
            if (resposta != null) {
                val certo = resposta == q.gabarito
                val gab = if (ce) (if (q.gabarito == "C") "Certo" else "Errado") else q.gabarito
                Column(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(8.dp)).padding(Dimens.p3)) {
                    Text(
                        when { certo && conf == "chute" -> "Acertou no chute: vai para o caderno para confirmar."; certo -> "Acertou."; else -> "Errou. Gabarito: $gab." },
                        style = MaterialTheme.typography.titleSmall, color = if (certo) s.okTexto else s.ruimTexto,
                    )
                    if (q.explicacao.isNotBlank()) Text(q.explicacao, style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
    }
}

/** Ícone de livro aberto (materiais), desenhado em vetor para não puxar a biblioteca de ícones estendida. */
val IconeLivro: ImageVector = ImageVector.Builder("livro", 24.dp, 24.dp, 24f, 24f).apply {
    path(fill = SolidColor(Color.Black)) {
        moveTo(21f, 5f); curveTo(19.9f, 4.65f, 18.7f, 4.5f, 17.5f, 4.5f); curveTo(15.55f, 4.5f, 13.45f, 4.9f, 12f, 6f)
        curveTo(10.55f, 4.9f, 8.45f, 4.5f, 6.5f, 4.5f); curveTo(4.55f, 4.5f, 2.45f, 4.9f, 1f, 6f); verticalLineTo(20.65f)
        curveTo(2.45f, 19.55f, 4.55f, 19.15f, 6.5f, 19.15f); curveTo(8.45f, 19.15f, 10.55f, 19.55f, 12f, 20.65f)
        curveTo(13.45f, 19.55f, 15.55f, 19.15f, 17.5f, 19.15f); curveTo(18.7f, 19.15f, 19.9f, 19.3f, 21f, 19.65f)
        curveTo(21.75f, 19.9f, 22.5f, 20.2f, 23f, 20.65f); verticalLineTo(6f); curveTo(22.4f, 5.55f, 21.75f, 5.25f, 21f, 5f); close()
        moveTo(21f, 18.5f); curveTo(19.9f, 18.15f, 18.7f, 18f, 17.5f, 18f); curveTo(15.8f, 18f, 13.35f, 18.65f, 12f, 19.5f)
        verticalLineTo(8f); curveTo(13.35f, 7.15f, 15.8f, 6.5f, 17.5f, 6.5f); curveTo(18.7f, 6.5f, 19.9f, 6.65f, 21f, 7f); close()
    }
}.build()

/** Ícone de gráfico (desempenho). */
val IconeGrafico: ImageVector = ImageVector.Builder("grafico", 24.dp, 24.dp, 24f, 24f).apply {
    path(fill = SolidColor(Color.Black)) {
        moveTo(5f, 9.2f); horizontalLineToRelative(3f); verticalLineTo(19f); horizontalLineTo(5f); close()
        moveTo(10.6f, 5f); horizontalLineToRelative(2.8f); verticalLineToRelative(14f); horizontalLineToRelative(-2.8f); close()
        moveTo(16.2f, 13f); horizontalLineTo(19f); verticalLineToRelative(6f); horizontalLineToRelative(-2.8f); close()
    }
}.build()
