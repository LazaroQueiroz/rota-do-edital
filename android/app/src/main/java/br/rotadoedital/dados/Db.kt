package br.rotadoedital.dados

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

/** Edital como documento JSON; `base` é a última versão recebida do PC (para a mesclagem). */
@Entity(tableName = "editais", primaryKeys = ["id"])
data class EditalEnt(
    val id: String,
    val json: String,
    val base: String?,
    val rev: Int,           // versão do PC correspondente à base
    val sujo: Boolean,      // mudou no celular desde a última sincronização
    val versao: Long,       // contador local, para detectar edição durante a sincronização
)

@Entity(tableName = "aulas", primaryKeys = ["ed", "tid"])
data class AulaEnt(val ed: String, val tid: String, val json: String, val atualizadoPc: Double)

@Entity(tableName = "materiais", primaryKeys = ["ed", "id"])
data class MaterialEnt(val ed: String, val id: String, val json: String, val atualizadoPc: Double, val sujo: Boolean)

@Dao
interface EditalDao {
    @Query("SELECT * FROM editais WHERE id = :id") fun observar(id: String): Flow<EditalEnt?>
    @Query("SELECT * FROM editais WHERE id = :id") suspend fun ler(id: String): EditalEnt?
    @Query("SELECT * FROM editais") suspend fun todos(): List<EditalEnt>
    @Query("SELECT id FROM editais") fun ids(): Flow<List<String>>
    @Upsert suspend fun gravar(e: EditalEnt)
}

@Dao
interface AulaDao {
    @Query("SELECT * FROM aulas WHERE ed = :ed AND tid = :tid") suspend fun ler(ed: String, tid: String): AulaEnt?
    @Query("SELECT tid FROM aulas WHERE ed = :ed") fun tids(ed: String): Flow<List<String>>
    @Query("SELECT * FROM aulas WHERE ed = :ed AND tid IN (:tids)") suspend fun varias(ed: String, tids: List<String>): List<AulaEnt>
    @Query("SELECT MAX(atualizadoPc) FROM aulas WHERE ed = :ed") suspend fun ultima(ed: String): Double?
    @Upsert suspend fun gravar(a: List<AulaEnt>)
}

@Dao
interface MaterialDao {
    @Query("SELECT * FROM materiais WHERE ed = :ed") fun observar(ed: String): Flow<List<MaterialEnt>>
    @Query("SELECT * FROM materiais WHERE ed = :ed") suspend fun lista(ed: String): List<MaterialEnt>
    @Query("SELECT * FROM materiais WHERE sujo = 1") suspend fun sujos(): List<MaterialEnt>
    @Upsert suspend fun gravar(m: MaterialEnt)
}

@Database(entities = [EditalEnt::class, AulaEnt::class, MaterialEnt::class], version = 1, exportSchema = false)
abstract class Banco : RoomDatabase() {
    abstract fun editais(): EditalDao
    abstract fun aulas(): AulaDao
    abstract fun materiais(): MaterialDao

    companion object {
        fun abrir(ctx: Context) = Room.databaseBuilder(ctx, Banco::class.java, "rota.db").build()
    }
}
