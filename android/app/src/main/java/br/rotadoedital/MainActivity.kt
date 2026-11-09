package br.rotadoedital

import android.graphics.Color
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import br.rotadoedital.ui.App
import br.rotadoedital.ui.EstudoViewModel
import br.rotadoedital.ui.Tela
import br.rotadoedital.ui.theme.RotaTema

class MainActivity : ComponentActivity() {
    private val vm: EstudoViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        // Splash do sistema até o primeiro estado sair do Room (sem atraso artificial).
        installSplashScreen().setKeepOnScreenCondition { vm.tela.value == Tela.Carregando }
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
            val tema by vm.tema.collectAsStateWithLifecycle()
            val escuro = when (tema) { "escuro" -> true; "claro" -> false; else -> isSystemInDarkTheme() }
            // ícones das barras do sistema seguem o tema escolhido no app, não só o do celular
            LaunchedEffect(escuro) {
                val estilo = if (escuro) SystemBarStyle.dark(Color.TRANSPARENT) else SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT)
                enableEdgeToEdge(statusBarStyle = estilo, navigationBarStyle = estilo)
            }
            RotaTema(tema) { App(vm) }
        }
    }
}
