package br.rotadoedital.sync

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import br.rotadoedital.RotaApp
import br.rotadoedital.dados.ErroApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import java.util.concurrent.TimeUnit

/** Estado da sincronização mostrado na UI. */
data class EstadoSync(val rodando: Boolean, val fase: String?, val feitos: Int, val total: Int)

/**
 * Sincronização com o PC só pelo WorkManager (nada de polling): ao abrir o app, pouco depois
 * de cada mudança e a cada 1 h, sempre em rede sem medição (o PC está no Wi-Fi de casa).
 */
object Sincronia {
    private const val AGORA = "sync-agora"
    private const val BREVE = "sync-breve"
    private const val SEGUINTE = "sync-seguinte"
    private const val PERIODICO = "sync-periodico"
    private val wifi = Constraints.Builder().setRequiredNetworkType(NetworkType.UNMETERED).build()

    fun agora(ctx: Context) = WorkManager.getInstance(ctx).enqueueUniqueWork(
        AGORA, ExistingWorkPolicy.KEEP, OneTimeWorkRequestBuilder<SyncWorker>()
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build())

    fun agendarEmBreve(ctx: Context, nome: String = BREVE) = WorkManager.getInstance(ctx).enqueueUniqueWork(
        nome, ExistingWorkPolicy.KEEP, OneTimeWorkRequestBuilder<SyncWorker>()
            .setInitialDelay(30, TimeUnit.SECONDS).setConstraints(wifi).build())

    fun periodica(ctx: Context) = WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(
        PERIODICO, ExistingPeriodicWorkPolicy.KEEP, PeriodicWorkRequestBuilder<SyncWorker>(1, TimeUnit.HOURS).setConstraints(wifi).build())

    fun cancelarTudo(ctx: Context) = listOf(AGORA, BREVE, SEGUINTE, PERIODICO).forEach { WorkManager.getInstance(ctx).cancelUniqueWork(it) }

    fun estado(ctx: Context): Flow<EstadoSync> {
        val wm = WorkManager.getInstance(ctx)
        return combine(wm.getWorkInfosForUniqueWorkFlow(AGORA), wm.getWorkInfosForUniqueWorkFlow(BREVE), wm.getWorkInfosForUniqueWorkFlow(PERIODICO)) { a, b, c ->
            val rodando = (a + b + c).firstOrNull { it.state == WorkInfo.State.RUNNING }
            EstadoSync(rodando != null, rodando?.progress?.getString("fase"), rodando?.progress?.getInt("feitos", 0) ?: 0, rodando?.progress?.getInt("total", 0) ?: 0)
        }
    }

    internal fun seguinte(ctx: Context) = agendarEmBreve(ctx, SEGUINTE)
}

class SyncWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val repo = (applicationContext as RotaApp).repo
        if (repo.prefs.token() == null) return Result.success()
        return try {
            repo.sincronizar { fase, feitos, total -> setProgress(workDataOf("fase" to fase, "feitos" to feitos, "total" to total)) }
            repo.prefs.sincronizou(null)
            Result.success()
        } catch (e: ErroApi.NaoAutorizado) {
            repo.prefs.esquecerToken(); repo.prefs.sincronizou(e.message); Result.failure()
        } catch (e: ErroApi.SemConexao) {
            repo.prefs.sincronizou(e.message); Result.failure()       // PC desligado é normal: tenta na próxima janela
        } catch (e: Exception) {
            repo.prefs.sincronizou(e.message ?: "Falha ao sincronizar."); if (runAttemptCount < 2) Result.retry() else Result.failure()
        }
    }
}
