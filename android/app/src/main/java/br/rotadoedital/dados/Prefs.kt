package br.rotadoedital.dados

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.doublePreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import java.security.KeyStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

private val Context.ds by preferencesDataStore("prefs")

data class Conexao(val endereco: String?, val pareado: Boolean, val ultimo: Long, val erro: String?)

/** Preferências do app. O token do aparelho fica cifrado com uma chave do Android Keystore. */
class Prefs(private val ctx: Context) {
    private object K {
        val endereco = stringPreferencesKey("endereco")
        val token = stringPreferencesKey("token_cifrado")
        val ultimo = longPreferencesKey("ultimo_sync")
        val erro = stringPreferencesKey("erro_sync")
        val ativo = stringPreferencesKey("ativo")
        val tema = stringPreferencesKey("tema")
        fun desde(ed: String) = doublePreferencesKey("aulas_desde_$ed")
    }

    val conexao: Flow<Conexao> = ctx.ds.data.map { Conexao(it[K.endereco], it[K.token] != null, it[K.ultimo] ?: 0, it[K.erro]) }
    val ativo: Flow<String?> = ctx.ds.data.map { it[K.ativo] }
    val tema: Flow<String> = ctx.ds.data.map { it[K.tema] ?: "sistema" }

    suspend fun endereco(): String? = ctx.ds.data.first()[K.endereco]
    suspend fun token(): String? = ctx.ds.data.first()[K.token]?.let { c -> withContext(Dispatchers.IO) { runCatching { decifrar(c) }.getOrNull() } }
    suspend fun parear(endereco: String, token: String) {
        val cifrado = withContext(Dispatchers.IO) { cifrar(token) }   // Keystore fora da main thread
        ctx.ds.edit { it[K.endereco] = endereco; it[K.token] = cifrado; it.remove(K.erro) }
    }
    suspend fun esquecerToken() = ctx.ds.edit { it.remove(K.token) }
    suspend fun sincronizou(erro: String?) = ctx.ds.edit { if (erro == null) { it[K.ultimo] = System.currentTimeMillis(); it.remove(K.erro) } else it[K.erro] = erro }
    suspend fun definirAtivo(id: String) = ctx.ds.edit { it[K.ativo] = id }
    suspend fun ativoAgora(): String? = ctx.ds.data.first()[K.ativo]
    suspend fun definirTema(t: String) = ctx.ds.edit { it[K.tema] = t }
    suspend fun desde(ed: String): Double = ctx.ds.data.first()[K.desde(ed)] ?: -1.0   // -1: nunca baixou
    suspend fun definirDesde(ed: String, v: Double) = ctx.ds.edit { it[K.desde(ed)] = v }

    // ---- cifra AES-GCM com chave que nunca sai do Keystore
    private fun chave(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    private fun cifrar(txt: String): String {
        val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, chave()) }
        return Base64.encodeToString(c.iv + c.doFinal(txt.toByteArray()), Base64.NO_WRAP)
    }
    private fun decifrar(b64: String): String {
        val b = Base64.decode(b64, Base64.NO_WRAP)
        val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, chave(), GCMParameterSpec(128, b, 0, 12)) }
        return String(c.doFinal(b, 12, b.size - 12))
    }

    private companion object { const val ALIAS = "rota_token" }
}
