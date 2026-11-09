package br.rotadoedital.ui.theme

// Gerado por ui-ux/tokens.py a partir de contract/tokens.json (preset clean, acento #4f46e5).
// Regenere em vez de editar à mão; ajustes do app ficam em Tema.kt.
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

val light_bg = Color(0xFFF9FAFD)
val light_surface = Color(0xFFFFFFFF)
val light_surface2 = Color(0xFFEEF0F6)
val light_surface3 = Color(0xFFE5E6EC)
val light_border = Color(0xFFD9DAE0)
val light_borderStrong = Color(0xFF85868B)
val light_text = Color(0xFF191A20)
val light_textMuted = Color(0xFF5C5D65)
val light_primary = Color(0xFF4F46E5)
val light_onPrimary = Color(0xFFFFFFFF)
val light_primaryHover = Color(0xFF422FD0)
val light_primaryContainer = Color(0xFFE2E6FF)
val light_onPrimaryContainer = Color(0xFF27276E)
val light_focusRing = Color(0xFF4F46E5)
val light_success = Color(0xFF00853C)
val light_successContainer = Color(0xFFDCF7E1)
val light_onSuccessContainer = Color(0xFF00481D)
val light_warning = Color(0xFFA16500)
val light_warningContainer = Color(0xFFFFEBD5)
val light_onWarningContainer = Color(0xFF533200)
val light_danger = Color(0xFFB9463F)
val light_dangerContainer = Color(0xFFFFE9E6)
val light_onDangerContainer = Color(0xFF65201C)
val light_info = Color(0xFF0077BC)
val light_infoContainer = Color(0xFFE1F1FF)
val light_onInfoContainer = Color(0xFF003E65)

val dark_bg = Color(0xFF131417)
val dark_surface = Color(0xFF1B1B20)
val dark_surface2 = Color(0xFF232428)
val dark_surface3 = Color(0xFF2B2C31)
val dark_border = Color(0xFF323337)
val dark_borderStrong = Color(0xFF707176)
val dark_text = Color(0xFFE6E7ED)
val dark_textMuted = Color(0xFFA9AAB0)
val dark_primary = Color(0xFFA5B1FF)
val dark_onPrimary = Color(0xFF111111)
val dark_primaryHover = Color(0xFFB9C3FF)
val dark_primaryContainer = Color(0xFF282C53)
val dark_onPrimaryContainer = Color(0xFFD5DCFF)
val dark_focusRing = Color(0xFF99A5FF)
val dark_success = Color(0xFF7CCD8E)
val dark_successContainer = Color(0xFF172C1C)
val dark_onSuccessContainer = Color(0xFFBEECC6)
val dark_warning = Color(0xFFE8A95C)
val dark_warningContainer = Color(0xFF33230F)
val dark_onWarningContainer = Color(0xFFFDD7AC)
val dark_danger = Color(0xFFFB988D)
val dark_dangerContainer = Color(0xFF381F1C)
val dark_onDangerContainer = Color(0xFFFFD2CC)
val dark_info = Color(0xFF71BFFF)
val dark_infoContainer = Color(0xFF152839)
val dark_onInfoContainer = Color(0xFFC2E2FF)

private val LightColors = lightColorScheme(
    primary = light_primary, onPrimary = light_onPrimary,
    primaryContainer = light_primaryContainer, onPrimaryContainer = light_onPrimaryContainer,
    background = light_bg, onBackground = light_text,
    surface = light_surface, onSurface = light_text,
    surfaceVariant = light_surface2, onSurfaceVariant = light_textMuted,
    surfaceContainerLow = light_surface, surfaceContainer = light_surface2, surfaceContainerHigh = light_surface3,
    outline = light_borderStrong, outlineVariant = light_border,
    error = light_danger, errorContainer = light_dangerContainer, onErrorContainer = light_onDangerContainer,
)

private val DarkColors = darkColorScheme(
    primary = dark_primary, onPrimary = dark_onPrimary,
    primaryContainer = dark_primaryContainer, onPrimaryContainer = dark_onPrimaryContainer,
    background = dark_bg, onBackground = dark_text,
    surface = dark_surface, onSurface = dark_text,
    surfaceVariant = dark_surface2, onSurfaceVariant = dark_textMuted,
    surfaceContainerLow = dark_surface, surfaceContainer = dark_surface2, surfaceContainerHigh = dark_surface3,
    outline = dark_borderStrong, outlineVariant = dark_border,
    error = dark_danger, errorContainer = dark_dangerContainer, onErrorContainer = dark_onDangerContainer,
)

val AppTypography = Typography(
    displaySmall = Typography().displaySmall.copy(fontSize = 40.sp, lineHeight = 44.sp),
    headlineMedium = Typography().headlineMedium.copy(fontSize = 33.sp, lineHeight = 40.sp),
    headlineSmall = Typography().headlineSmall.copy(fontSize = 28.sp, lineHeight = 34.sp),
    titleLarge = Typography().titleLarge.copy(fontSize = 23.sp, lineHeight = 31.sp),
    titleMedium = Typography().titleMedium.copy(fontSize = 19.sp, lineHeight = 26.sp),
    bodyLarge = Typography().bodyLarge.copy(fontSize = 16.sp, lineHeight = 24.sp),
    bodyMedium = Typography().bodyMedium.copy(fontSize = 13.sp, lineHeight = 20.sp),
    labelSmall = Typography().labelSmall.copy(fontSize = 12.sp, lineHeight = 18.sp),
)

val AppShapes = Shapes(
    small = RoundedCornerShape(4.dp),
    medium = RoundedCornerShape(8.dp),
    large = RoundedCornerShape(12.dp),
)

@Composable
fun AppTheme(darkTheme: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        typography = AppTypography,
        shapes = AppShapes,
        content = content,
    )
}
