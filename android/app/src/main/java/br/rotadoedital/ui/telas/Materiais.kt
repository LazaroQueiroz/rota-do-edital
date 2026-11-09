package br.rotadoedital.ui.telas

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color as AColor
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import android.util.LruCache
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import br.rotadoedital.ui.Dados
import br.rotadoedital.ui.MaterialUi
import br.rotadoedital.ui.comp.Cartao
import br.rotadoedital.ui.comp.Etiqueta
import br.rotadoedital.ui.theme.Dimens
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun TelaMateriais(d: Dados, conteudo: PaddingValues, abrirPdf: (MaterialUi, String?) -> Unit, abrirTopico: (String) -> Unit, simulado: (MaterialUi, Int) -> Unit) {
    var filtro by rememberSaveable { mutableStateOf("todos") }
    val grupos = mapOf("prova" to listOf("prova"), "normas" to listOf("norma", "lei", "edital"), "estudo" to listOf("guia", "livro", "apostila", "outro"))
    val ordem = listOf("edital", "prova", "norma", "lei", "guia", "livro", "apostila", "outro")
    val vis = d.materiais.filter { it.tipo != "gabarito" && (filtro == "todos" || it.tipo in grupos[filtro].orEmpty()) }
        .sortedWith(compareBy({ ordem.indexOf(it.tipo) }, { it.titulo }))
    LazyColumn(contentPadding = PaddingValues(start = Dimens.p4, end = Dimens.p4, top = conteudo.calculateTopPadding() + Dimens.p2, bottom = conteudo.calculateBottomPadding() + Dimens.p4),
        verticalArrangement = Arrangement.spacedBy(Dimens.p3)) {
        item {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Dimens.p2)) {
                listOf("todos" to "Todos", "prova" to "Provas", "normas" to "Normas e leis", "estudo" to "Guias e livros").forEach { (k, t) ->
                    FilterChip(selected = filtro == k, onClick = { filtro = k }, label = { Text(t) })
                }
            }
        }
        if (vis.isEmpty()) item { Vazio(if (d.materiais.isEmpty()) "Nenhum material ainda. Os PDFs ligados aos tópicos vêm do PC na sincronização." else "Nenhum material neste filtro.") }
        items(vis, key = { it.id }) { m -> CartaoMaterial(d, m, abrirPdf, abrirTopico, simulado) }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CartaoMaterial(d: Dados, m: MaterialUi, abrirPdf: (MaterialUi, String?) -> Unit, abrirTopico: (String) -> Unit, simulado: (MaterialUi, Int) -> Unit) {
    var verTopicos by rememberSaveable(m.id) { mutableStateOf(false) }
    var acertos by rememberSaveable(m.id) { mutableStateOf("") }
    val tops = m.usos.mapNotNull { it.tid }.distinct()
    val geral = m.usos.firstOrNull { it.tid == null }
    Cartao {
        Column(Modifier.padding(Dimens.p4), verticalArrangement = Arrangement.spacedBy(Dimens.p2)) {
            Etiqueta(TIPO_MAT[m.tipo] ?: "PDF", if (m.tipo == "prova") MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant,
                if (m.tipo == "prova") MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurfaceVariant)
            Text(m.titulo, style = MaterialTheme.typography.titleSmall)
            Text(listOfNotNull(m.fonte.ifBlank { null }, m.paginas.takeIf { it > 0 }?.let { "$it páginas" }).joinToString(" · "),
                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            geral?.nota?.let { Text("Quando usar: $it", style = MaterialTheme.typography.bodyMedium) }
            Row(horizontalArrangement = Arrangement.spacedBy(Dimens.p2)) {
                OutlinedButton(onClick = { abrirPdf(m, geral?.pag) }) { Text("Abrir PDF") }
                d.materiais.firstOrNull { it.id == m.gabaritoDe }?.let { g -> TextButton(onClick = { abrirPdf(g, null) }) { Text("Gabarito oficial") } }
            }
            if (m.tipo == "prova" && m.respostas.isNotEmpty()) {
                val n = m.respostas.size
                Text("Simulado: faça a prova inteira de uma vez, cronometrando (cerca de ${"%.1f".format(n * 3 / 60.0).replace('.', ',')} h)." +
                    (m.simulados.lastOrNull()?.let { (dt, a, t) -> " Última: $a/$t em ${br(dt)}." } ?: ""), style = MaterialTheme.typography.bodyMedium)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Dimens.p2)) {
                    OutlinedTextField(acertos, { acertos = it.filter(Char::isDigit).take(3) }, label = { Text("Acertos (de $n)") }, singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.width(150.dp))
                    TextButton(onClick = { acertos.toIntOrNull()?.takeIf { it in 0..n }?.let { simulado(m, it); acertos = "" } }) { Text("Registrar") }
                }
            }
            if (tops.isNotEmpty()) {
                TextButton(onClick = { verTopicos = !verTopicos }) { Text(if (verTopicos) "Esconder tópicos" else "${tops.size} tópico${if (tops.size > 1) "s" else ""} do edital") }
                if (verTopicos) FlowRow(horizontalArrangement = Arrangement.spacedBy(Dimens.p2)) {
                    tops.mapNotNull { d.topico(it) }.forEach { t -> FilterChip(selected = false, onClick = { abrirTopico(t.id) }, label = { Text(t.nome, maxLines = 2) }) }
                }
            }
        }
    }
}

/** Leitor de PDF nativo (PdfRenderer): abre na página indicada, renderiza só o que aparece. */
@Composable
fun TelaPdf(arquivo: File?, pagina: Int, conteudo: PaddingValues) {
    val ctx = LocalContext.current
    if (arquivo == null || !arquivo.exists()) {
        Box(Modifier.fillMaxSize().padding(conteudo).padding(Dimens.p4)) { Vazio("Este PDF ainda não foi baixado. Ele vem do PC na próxima sincronização em Wi-Fi.") }
        return
    }
    val doc = remember(arquivo) { Pdf(arquivo) }
    DisposableEffect(doc) { onDispose { doc.fechar() } }
    var zoom by rememberSaveable { mutableStateOf(1) }
    val lista = rememberLazyListState(initialFirstVisibleItemIndex = (pagina - 1).coerceIn(0, maxOf(0, doc.paginas - 1)))
    Column(Modifier.fillMaxSize().padding(top = conteudo.calculateTopPadding())) {
        Row(Modifier.fillMaxWidth().padding(horizontal = Dimens.p2), verticalAlignment = Alignment.CenterVertically) {
            Text("pág. ${lista.firstVisibleItemIndex + 1} de ${doc.paginas}", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f).padding(start = Dimens.p2))
            TextButton(onClick = { zoom = if (zoom == 1) 2 else 1 }) { Text(if (zoom == 1) "Ampliar" else "Ajustar à tela") }
            TextButton(onClick = { abrirFora(ctx, arquivo) }) { Text("Abrir em outro app") }
        }
        BoxWithConstraints(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surfaceVariant)) {
            val larguraPx = with(LocalDensity.current) { maxWidth.roundToPx() } * zoom
            val larguraDp = maxWidth * zoom
            LazyColumn(state = lista, contentPadding = PaddingValues(bottom = conteudo.calculateBottomPadding() + Dimens.p4),
                verticalArrangement = Arrangement.spacedBy(Dimens.p2), modifier = Modifier.fillMaxSize().then(if (zoom > 1) Modifier.horizontalScroll(rememberScrollState()) else Modifier)) {
                items(doc.paginas, key = { it }) { i ->
                    val bmp by produceState<Bitmap?>(null, i, larguraPx) { value = doc.render(i, larguraPx) }
                    Box(Modifier.width(larguraDp).aspectRatio(doc.proporcao(i)).background(androidx.compose.ui.graphics.Color.White), contentAlignment = Alignment.Center) {
                        val b = bmp
                        if (b == null) CircularProgressIndicator() else Image(b.asImageBitmap(), contentDescription = "Página ${i + 1}", modifier = Modifier.fillMaxSize())
                    }
                }
            }
        }
    }
}

private fun abrirFora(ctx: Context, f: File) {
    val uri = FileProvider.getUriForFile(ctx, ctx.packageName + ".arquivos", f)
    val i = Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/pdf").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    runCatching { ctx.startActivity(Intent.createChooser(i, "Abrir PDF com")) }
}

/** PdfRenderer não é thread-safe: uma página por vez, com cache pequeno (memória ≤ ~6 páginas). */
private class Pdf(f: File) {
    private val fd = ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY)
    private val r = PdfRenderer(fd)
    private val trava = Mutex()
    private val cache = object : LruCache<String, Bitmap>(6) {}
    private val prop = HashMap<Int, Float>()
    val paginas: Int = r.pageCount

    fun proporcao(i: Int): Float = prop[i] ?: synchronized(this) { r.openPage(i).use { p -> (p.width.toFloat() / p.height).also { prop[i] = it } } }

    suspend fun render(i: Int, largura: Int): Bitmap = withContext(Dispatchers.IO) {
        cache.get("$i@$largura") ?: trava.withLock {
            synchronized(this@Pdf) {
                r.openPage(i).use { p ->
                    val h = (largura * p.height.toFloat() / p.width).toInt().coerceAtLeast(1)
                    Bitmap.createBitmap(largura, h, Bitmap.Config.ARGB_8888).also { b ->
                        b.eraseColor(AColor.WHITE); p.render(b, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                    }
                }
            }.also { cache.put("$i@$largura", it) }
        }
    }

    fun fechar() { runCatching { r.close(); fd.close() } }
}
