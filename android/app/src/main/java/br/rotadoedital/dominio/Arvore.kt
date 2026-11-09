package br.rotadoedital.dominio

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull

/**
 * O edital é um documento JSON (mesmo formato do web, ver contract/openapi.yaml).
 * Para não perder campos que este app não conhece, ele é editado como árvore genérica
 * (Map/List) e convertido de volta inteiro. Leituras para a UI viram data classes imutáveis.
 */
typealias Obj = MutableMap<String, Any?>

fun JsonElement.mut(): Any? = when (this) {
    is JsonObject -> LinkedHashMap<String, Any?>(size).also { m -> forEach { (k, v) -> m[k] = v.mut() } }
    is JsonArray -> ArrayList<Any?>(size).also { l -> forEach { l.add(it.mut()) } }
    is JsonNull -> null
    is JsonPrimitive -> when {
        isString -> content
        booleanOrNull != null -> booleanOrNull
        longOrNull != null -> longOrNull
        else -> doubleOrNull
    }
}

fun Any?.paraJson(): JsonElement = when (this) {
    null -> JsonNull
    is JsonElement -> this
    is String -> JsonPrimitive(this)
    is Boolean -> JsonPrimitive(this)
    is Int -> JsonPrimitive(this.toLong())
    is Long -> JsonPrimitive(this)
    is Double -> if (this == Math.floor(this) && !isInfinite() && kotlin.math.abs(this) < 1e15) JsonPrimitive(this.toLong()) else JsonPrimitive(this)
    is Number -> JsonPrimitive(this)
    is Map<*, *> -> JsonObject(entries.associate { (k, v) -> k.toString() to v.paraJson() })
    is List<*> -> JsonArray(map { it.paraJson() })
    else -> error("tipo inesperado no documento: ${this::class}")
}

@Suppress("UNCHECKED_CAST")
fun Obj.obj(k: String): Obj? = this[k] as? Obj

@Suppress("UNCHECKED_CAST")
fun Obj.lista(k: String): MutableList<Any?> = (this[k] as? MutableList<Any?>) ?: ArrayList<Any?>().also { this[k] = it }

@Suppress("UNCHECKED_CAST")
fun Obj.objs(k: String): List<Obj> = (this[k] as? List<Any?>)?.filterIsInstance<MutableMap<String, Any?>>() ?: emptyList()

fun Obj.s(k: String): String? = this[k] as? String
fun Obj.n(k: String): Double = (this[k] as? Number)?.toDouble() ?: 0.0
fun Obj.i(k: String): Int = (this[k] as? Number)?.toInt() ?: 0
fun Obj.b(k: String): Boolean = this[k] as? Boolean ?: false
fun obj(vararg p: Pair<String, Any?>): Obj = linkedMapOf(*p)
