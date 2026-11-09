package br.rotadoedital.ui

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationRail
import androidx.compose.material3.NavigationRailItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import br.rotadoedital.ui.comp.IconeLivro
import br.rotadoedital.ui.telas.TelaAjustes
import br.rotadoedital.ui.telas.TelaBoasVindas
import br.rotadoedital.ui.telas.TelaDesempenho
import br.rotadoedital.ui.telas.TelaEdital
import br.rotadoedital.ui.telas.TelaErros
import br.rotadoedital.ui.telas.TelaHoje
import br.rotadoedital.ui.telas.TelaMais
import br.rotadoedital.ui.telas.TelaMateriais
import br.rotadoedital.ui.telas.TelaPdf
import br.rotadoedital.ui.telas.TelaTopico
import br.rotadoedital.ui.telas.TelaTreino
import br.rotadoedital.ui.telas.proximoPasso
import br.rotadoedital.ui.telas.textoSync
import br.rotadoedital.sync.Sincronia
import java.net.URLEncoder

private data class Destino(val rota: String, val rotulo: String, val icone: ImageVector)

private val DESTINOS = listOf(
    Destino("hoje", "Hoje", Icons.Filled.Home),
    Destino("edital", "Edital", Icons.AutoMirrored.Filled.List),
    Destino("erros", "Erros", Icons.Filled.Refresh),
    Destino("materiais", "Materiais", IconeLivro),
    Destino("mais", "Mais", Icons.Filled.Menu),
)

private fun titulo(rota: String?) = when {
    rota == null -> ""
    rota.startsWith("topico") -> "Aula"
    rota.startsWith("pdf") -> "PDF"
    else -> mapOf("edital" to "Edital verticalizado", "erros" to "Caderno de erros", "materiais" to "Materiais",
        "mais" to "Mais", "desempenho" to "Desempenho", "ajustes" to "Ajustes", "treino" to "Treino misto")[rota] ?: ""
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun App(vm: EstudoViewModel) {
    val tela by vm.tela.collectAsStateWithLifecycle()
    val con by vm.conexao.collectAsStateWithLifecycle()
    val sync by vm.sync.collectAsStateWithLifecycle()
    val tema by vm.tema.collectAsStateWithLifecycle()
    val nav = rememberNavController()
    val entrada by nav.currentBackStackEntryAsState()
    val rota = entrada?.destination?.route
    val snack = remember { SnackbarHostState() }
    LaunchedEffect(Unit) { vm.avisos.collect { snack.showSnackbar(it) } }
    // ao voltar para o app, sincroniza (se pareado)
    LifecycleResumeEffect(con?.pareado) { if (con?.pareado == true) vm.sincronizarAgora(); onPauseOrDispose { } }

    val d = (tela as? Tela.Pronto)?.d
    val topo = rota in DESTINOS.map { it.rota } || rota == null
    val largo = LocalConfiguration.current.screenWidthDp >= 600
    val abrir = { tid: String, rev: Boolean -> nav.navigate("topico/$tid?rev=$rev") }

    Row(Modifier.fillMaxSize()) {
        if (largo && d != null) NavigationRail { DESTINOS.forEach { x ->
            NavigationRailItem(selected = rota == x.rota, onClick = { irPara(nav, x.rota) }, icon = { Icon(x.icone, null) }, label = { Text(x.rotulo) })
        } }
        Scaffold(
            modifier = Modifier.weight(1f),
            topBar = {
                TopAppBar(
                    title = {
                        if (rota == "hoje" && d != null) androidx.compose.foundation.layout.Column {
                            Text(d.orgao, style = MaterialTheme.typography.titleLarge, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                            Text(d.cargo, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                        } else Text(titulo(rota), maxLines = 1)
                    },
                    navigationIcon = { if (!topo) IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Voltar") } },
                    actions = {
                        if (con?.pareado == true) IconButton(onClick = { vm.sincronizarAgora() }, enabled = !sync.rodando) {
                            if (sync.rodando) CircularProgressIndicator(Modifier.padding(12.dp), strokeWidth = 2.dp)
                            else Icon(Icons.Filled.Refresh, contentDescription = "Sincronizar com o PC. ${textoSync(sync, con)}")
                        }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
                )
            },
            bottomBar = {
                if (!largo && d != null && topo) NavigationBar { DESTINOS.forEach { x ->
                    NavigationBarItem(selected = rota == x.rota, onClick = { irPara(nav, x.rota) }, icon = { Icon(x.icone, null) }, label = { Text(x.rotulo) })
                } }
            },
            floatingActionButton = {
                if (rota == "hoje" && d != null) proximoPasso(d, abrir) { irPara(nav, "erros") }?.let { p ->
                    ExtendedFloatingActionButton(onClick = p.acao, icon = { Icon(Icons.Filled.PlayArrow, null) }, text = { Text("Começar") },
                        modifier = Modifier.semantics(mergeDescendants = true) { contentDescription = "Começar: ${p.titulo}" })
                }
            },
            snackbarHost = { SnackbarHost(snack) },
            containerColor = MaterialTheme.colorScheme.background,
        ) { pad ->
            when (tela) {
                Tela.Carregando -> Unit
                Tela.SemDados -> TelaBoasVindas(pad, con, sync, vm::conectar)
                is Tela.Pronto -> NavHost(nav, startDestination = "hoje", modifier = Modifier.consumeWindowInsets(pad)) {
                    composable("hoje") { TelaHoje(d!!, pad, abrir, { irPara(nav, "erros") }, { nav.navigate("treino") }, vm::tempoHoje) }
                    composable("edital") { TelaEdital(d!!, pad, abrir) }
                    composable("erros") { TelaErros(d!!, pad, vm::refazerErro, vm::tipoErro) }
                    composable("materiais") { TelaMateriais(d!!, pad, { m, pag -> abrirPdf(nav, m, pag) }, { abrir(it, true) }, vm::registrarSimulado) }
                    composable("mais") { TelaMais(pad, { nav.navigate("desempenho") }, { nav.navigate("ajustes") }, sync, con) }
                    composable("desempenho") { TelaDesempenho(d!!, pad, abrir) }
                    composable("ajustes") {
                        TelaAjustes(d, pad, con, sync, tema, vm::conectar, vm::sincronizarAgora, vm::desconectar, vm::definirTema, vm::ajustes)
                    }
                    composable("treino") { TelaTreino(d!!, pad, vm::montarTreino, { tid, q, op, c -> vm.responder(tid, q, op, c, false) }) { nav.popBackStack() } }
                    composable("topico/{tid}?rev={rev}", listOf(navArgument("tid") { type = NavType.StringType }, navArgument("rev") { type = NavType.BoolType; defaultValue = false })) { e ->
                        val tid = e.arguments!!.getString("tid")!!; val rev = e.arguments!!.getBoolean("rev")
                        TelaTopico(d!!, tid, rev, pad, vm::aula, { q, op, c, pre -> vm.responder(tid, q, op, c, pre) },
                            { n, acc -> if (rev) vm.concluirRevisao(tid, n, acc) else vm.concluirEstudo(tid); nav.popBackStack() }) { m, pag -> abrirPdf(nav, m, pag) }
                    }
                    composable("pdf/{mat}?pag={pag}", listOf(navArgument("mat") { type = NavType.StringType }, navArgument("pag") { type = NavType.IntType; defaultValue = 1 })) { e ->
                        val m = d!!.materiais.firstOrNull { it.id == e.arguments!!.getString("mat") }
                        TelaPdf(m?.let { vm.arquivoPdf(it) }, e.arguments!!.getInt("pag"), pad)
                    }
                }
            }
        }
    }
}

private fun irPara(nav: NavHostController, rota: String) = nav.navigate(rota) {
    popUpTo("hoje") { saveState = true }; launchSingleTop = true; restoreState = true
}

private fun abrirPdf(nav: NavHostController, m: MaterialUi, pag: String?) {
    val p = pag?.substringBefore('-')?.substringBefore(',')?.trim()?.toIntOrNull() ?: 1
    nav.navigate("pdf/${URLEncoder.encode(m.id, "UTF-8")}?pag=$p")
}

@Suppress("unused") private val usaSincronia = Sincronia
