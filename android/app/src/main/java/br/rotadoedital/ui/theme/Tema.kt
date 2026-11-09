package br.rotadoedital.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Cores semânticas (acerto, alerta, erro, informação) que o Material 3 não tem. */
@Immutable
data class Semantica(
    val ok: Color, val okFundo: Color, val okTexto: Color,
    val alerta: Color, val alertaFundo: Color, val alertaTexto: Color,
    val ruim: Color, val ruimFundo: Color, val ruimTexto: Color,
    val info: Color, val infoFundo: Color, val infoTexto: Color,
)

private val SemClaro = Semantica(light_success, light_successContainer, light_onSuccessContainer, light_warning, light_warningContainer, light_onWarningContainer,
    light_danger, light_dangerContainer, light_onDangerContainer, light_info, light_infoContainer, light_onInfoContainer)
private val SemEscuro = Semantica(dark_success, dark_successContainer, dark_onSuccessContainer, dark_warning, dark_warningContainer, dark_onWarningContainer,
    dark_danger, dark_dangerContainer, dark_onDangerContainer, dark_info, dark_infoContainer, dark_onInfoContainer)

val LocalSemantica = staticCompositionLocalOf { SemClaro }

/** Espaçamentos do contrato (grade de 4/8 dp) e alvo mínimo de toque. */
object Dimens {
    val p1 = 4.dp; val p2 = 8.dp; val p3 = 12.dp; val p4 = 16.dp; val p5 = 20.dp; val p6 = 24.dp; val p8 = 32.dp
    val toque = 48.dp
}

@Composable
fun RotaTema(tema: String, content: @Composable () -> Unit) {
    val escuro = when (tema) { "escuro" -> true; "claro" -> false; else -> isSystemInDarkTheme() }
    AppTheme(darkTheme = escuro) {
        // corpo secundário com 14 sp (mínimo legível); títulos com peso 700 como no web
        val t = MaterialTheme.typography
        MaterialTheme(typography = t.copy(
            bodyMedium = t.bodyMedium.copy(fontSize = 14.sp, lineHeight = 20.sp),
            titleLarge = t.titleLarge.copy(fontWeight = FontWeight.Bold),
            headlineSmall = t.headlineSmall.copy(fontWeight = FontWeight.Bold),
            titleMedium = t.titleMedium.copy(fontWeight = FontWeight.SemiBold),
        )) {
            CompositionLocalProvider(LocalSemantica provides if (escuro) SemEscuro else SemClaro, content = content)
        }
    }
}
