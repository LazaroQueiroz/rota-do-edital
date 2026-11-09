package br.rotadoedital

import android.app.Application
import br.rotadoedital.dados.Api
import br.rotadoedital.dados.Banco
import br.rotadoedital.dados.Prefs
import br.rotadoedital.dados.Repositorio

/** Injeção manual: tudo é criado sob demanda (nada pesado no onCreate). */
class RotaApp : Application() {
    override fun onCreate() {
        super.onCreate()
        // No debug, acusa I/O ou rede na main thread (o release fica sem custo).
        if (applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0) {
            android.os.StrictMode.setThreadPolicy(android.os.StrictMode.ThreadPolicy.Builder().detectAll().penaltyLog().build())
        }
    }

    val prefs by lazy { Prefs(this) }
    val repo by lazy { Repositorio(this, Banco.abrir(this), prefs, Api(this, prefs)) }
}
