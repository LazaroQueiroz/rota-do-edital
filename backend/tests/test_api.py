"""Testes da API do servidor local, com um Ollama falso no lugar da IA.

    python -m unittest discover -s tests -v
"""
import json
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent.parent


def porta_livre():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


class OllamaFalso(BaseHTTPRequestHandler):
    """Responde como o Ollama, com JSON dentro de um bloco de código (testa a extração)."""

    def log_message(self, *a):
        pass

    def do_POST(self):
        corpo = json.loads(self.rfile.read(int(self.headers["content-length"])))
        prompt = corpo["messages"][0]["content"]
        if "cargos" in prompt:
            out = {"orgao": "TRT-13", "banca": "FCC", "cargos": ["Técnico"], "data_prova": None, "estilo": "ME"}
        else:
            out = {"ok": True}
        texto = "Segue:\n```json\n" + json.dumps(out, ensure_ascii=False) + "\n```"
        dados = json.dumps({"message": {"content": texto}, "done_reason": "stop"}).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(dados)))
        self.end_headers()
        self.wfile.write(dados)


class TestAPI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # cópia isolada do app, para não tocar no banco real
        cls.tmp = Path(tempfile.mkdtemp())
        shutil.copytree(RAIZ / "backend", cls.tmp / "backend", ignore=shutil.ignore_patterns("tests", "__pycache__"))
        shutil.copytree(RAIZ / "web", cls.tmp / "web")
        cls.ollama = HTTPServer(("127.0.0.1", porta_livre()), OllamaFalso)
        threading.Thread(target=cls.ollama.serve_forever, daemon=True).start()
        cls.porta = porta_livre()
        cls.proc = subprocess.Popen([sys.executable, str(cls.tmp / "backend" / "server.py"), "--sem-navegador", "--porta", str(cls.porta)],
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        cls.base = f"http://127.0.0.1:{cls.porta}"
        for _ in range(50):
            try:
                urllib.request.urlopen(cls.base + "/api/status", timeout=1)
                break
            except OSError:
                time.sleep(0.1)

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        cls.proc.wait(timeout=5)
        cls.ollama.shutdown()
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def req(self, metodo, rota, corpo=None):
        dados = json.dumps(corpo).encode() if corpo is not None else None
        r = urllib.request.Request(self.base + rota, data=dados, method=metodo, headers={"content-type": "application/json"})
        try:
            with urllib.request.urlopen(r, timeout=10) as resp:
                return resp.status, json.loads(resp.read() or b"null")
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"null")

    def test_01_sem_ia(self):
        st, d = self.req("POST", "/api/ia", {"prompt": "oi"})
        self.assertEqual(st, 400)
        self.assertEqual(d["code"], "sem_ia")

    def test_02_ia_ollama_extrai_json(self):
        url = f"http://127.0.0.1:{self.ollama.server_address[1]}"
        self.req("POST", "/api/config", {"provedor": "ollama", "ollama_url": url, "modelo_ollama": "teste"})
        st, d = self.req("POST", "/api/ia", {"prompt": "extraia os cargos"})
        self.assertEqual(st, 200)
        self.assertEqual(d["dados"]["orgao"], "TRT-13")

    def test_03_edital_e_conteudo(self):
        ed = {"id": "e1", "orgao": "X", "cargo": "Y", "materias": [{"topicos": [{"st": "novo"}, {"st": "estudado"}]}], "erros": []}
        self.assertEqual(self.req("PUT", "/api/editais/e1", ed)[0], 200)
        self.assertEqual(self.req("GET", "/api/editais/e1")[1]["orgao"], "X")
        lista = self.req("GET", "/api/editais")[1]
        self.assertEqual(lista[0]["estudados"], 1)
        self.req("PUT", "/api/conteudo/e1/m0t0", {"resumo": "ação"})
        self.assertEqual(self.req("GET", "/api/conteudo/e1/m0t0")[1]["resumo"], "ação")
        self.assertEqual(self.req("GET", "/api/conteudo/e1")[1], ["m0t0"])
        self.assertEqual(self.req("GET", "/api/conteudo/e1/nada")[0], 404)

    def test_04_pacote_preserva_progresso(self):
        pacote = {"versao": 1, "tipo": "pacote",
                  "editais": [{"id": "p1", "dados": {"id": "p1", "orgao": "Original"}}],
                  "conteudo": [{"ed": "p1", "tid": "m0t0", "dados": {"resumo": "v1"}}]}
        self.assertTrue(self.req("POST", "/api/backup", pacote)[1]["pacote"])
        self.req("PUT", "/api/editais/p1", {"id": "p1", "orgao": "Com progresso"})
        pacote["conteudo"][0]["dados"]["resumo"] = "v2"
        self.req("POST", "/api/backup", pacote)
        self.assertEqual(self.req("GET", "/api/editais/p1")[1]["orgao"], "Com progresso")
        self.assertEqual(self.req("GET", "/api/conteudo/p1/m0t0")[1]["resumo"], "v2")
        self.assertEqual(self.req("GET", "/api/ativo")[1]["id"], "p1")

    def test_05_arquivo_invalido(self):
        self.assertEqual(self.req("POST", "/api/backup", {"x": 1})[0], 400)

    def bruto(self, metodo, rota, dados, tipo="application/pdf"):
        r = urllib.request.Request(self.base + rota, data=dados, method=metodo, headers={"content-type": tipo})
        try:
            with urllib.request.urlopen(r, timeout=10) as resp:
                return resp.status, resp.read(), resp.headers
        except urllib.error.HTTPError as e:
            return e.code, e.read(), e.headers

    def test_07_materiais(self):
        self.req("PUT", "/api/editais/m1", {"id": "m1", "orgao": "Z", "materias": [], "erros": []})
        mat = {"titulo": "Lei X", "tipo": "lei", "arquivo": "lei-x.pdf", "usos": [{"tid": "m0t0", "pag": "3-5", "quando": "consulta"}]}
        self.assertEqual(self.req("PUT", "/api/materiais/m1/lei-x", mat)[0], 200)
        self.assertEqual(self.req("PUT", "/api/materiais/m1/sem-titulo", {"tipo": "lei"})[0], 400)
        self.assertEqual(self.req("PUT", "/api/materiais/m1/..%2Fx", mat)[0], 400)
        lista = self.req("GET", "/api/materiais/m1")[1]
        self.assertEqual([(x["id"], x["temArquivo"]) for x in lista], [("lei-x", False)])
        # arquivo: só PDF
        self.assertEqual(self.bruto("PUT", "/api/materiais/m1/lei-x/arquivo", b"oi")[0], 400)
        pdf = b"%PDF-1.4\n% teste\n"
        st, corpo, _ = self.bruto("PUT", "/api/materiais/m1/lei-x/arquivo", pdf)
        self.assertEqual(st, 200)
        self.assertTrue(self.req("GET", "/api/materiais/m1")[1][0]["temArquivo"])
        st, corpo, h = self.bruto("GET", "/materiais/m1/lei-x.pdf", None)
        self.assertEqual((st, corpo), (200, pdf))
        self.assertIn("application/pdf", h["content-type"])
        self.assertEqual(self.bruto("GET", "/materiais/m1/..%2F..%2Fserver.py", None)[0], 404)
        # backup leva a descrição dos materiais e a restauração devolve
        _, bk, _ = self.bruto("GET", "/api/backup", None)
        bk = json.loads(bk)
        self.assertTrue(any(x["id"] == "lei-x" for x in bk["materiais"]))
        # apagar o material apaga o arquivo; apagar o edital limpa o resto
        self.assertEqual(self.req("DELETE", "/api/materiais/m1/lei-x")[0], 200)
        self.assertEqual(self.bruto("GET", "/materiais/m1/lei-x.pdf", None)[0], 404)
        self.req("POST", "/api/backup", bk)
        self.assertEqual(len(self.req("GET", "/api/materiais/m1")[1]), 1)
        self.req("DELETE", "/api/editais/m1")
        self.assertEqual(self.req("GET", "/api/materiais/m1")[1], [])

    def test_08_sincronia(self):
        top = lambda st, f: {"id": "m0t0", "st": st, "revs": [], "q": {"f": f, "a": f}}
        ed = lambda st, f: {"id": "s1", "materias": [{"id": "m0", "topicos": [top(st, f)]}], "erros": []}
        base = ed("novo", 0)
        self.req("PUT", "/api/editais/s1", base)
        st, d = self.req("GET", "/api/editais/s1/rev")
        rev = d["rev"]
        # o PC avança (2 questões) e o celular, ainda na base antiga, estuda o tópico com 3 questões
        st, d = self.req("POST", "/api/editais/s1/mesclar", {"base_rev": rev, "base": base, "doc": ed("novo", 2)})
        self.assertFalse(d["mesclado"])
        st, d = self.req("POST", "/api/editais/s1/mesclar", {"base_rev": rev, "base": base, "doc": ed("estudado", 3)})
        self.assertTrue(d["mesclado"])
        t = d["doc"]["materias"][0]["topicos"][0]
        self.assertEqual((t["st"], t["q"]["f"]), ("estudado", 5))
        self.assertEqual(self.req("GET", "/api/editais/s1/rev")[1]["rev"], rev + 2)
        estado = self.req("GET", "/api/sync/estado")[1]
        self.assertIn({"id": "s1", "rev": rev + 2}, estado["editais"])
        self.assertIn("doc", self.req("POST", "/api/mesclar", {"base": base, "local": base, "remoto": ed("novo", 1)})[1])
        par = self.req("GET", "/api/pareamento")[1]
        self.assertEqual(len(par["codigo"]), 6)
        novo = self.req("POST", "/api/pareamento/novo", {})[1]["codigo"]
        self.assertNotEqual(novo, par["codigo"])

    def test_09_contrato_v1(self):
        st, d = self.req("GET", "/v1/health")
        self.assertEqual((st, d["ok"]), (200, True))
        # erro no formato problem+json
        st, corpo, h = self.bruto("GET", "/v1/editais/nao-existe", None)
        self.assertEqual(st, 404)
        self.assertIn("application/problem+json", h["content-type"])
        self.assertEqual(json.loads(corpo)["status"], 404)
        # ETag: a segunda leitura igual devolve 304
        _, _, h = self.bruto("GET", "/v1/editais", None)
        r = urllib.request.Request(self.base + "/v1/editais", headers={"if-none-match": h["etag"]})
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(r, timeout=5)
        self.assertEqual(ctx.exception.code, 304)
        # gzip em texto grande
        r = urllib.request.Request(self.base + "/app.js", headers={"accept-encoding": "gzip"})
        with urllib.request.urlopen(r, timeout=5) as resp:
            self.assertEqual(resp.headers["content-encoding"], "gzip")

    def test_10_pareamento_e_aulas_em_lote(self):
        cod = self.req("GET", "/v1/pareamento")[1]["codigo"]
        self.assertEqual(self.req("POST", "/v1/dispositivos", {"codigo": "XXXXXX", "nome": "Teste"})[0], 401)
        st, d = self.req("POST", "/v1/dispositivos", {"codigo": cod.lower(), "nome": "Pixel"})
        self.assertEqual(st, 201)
        self.assertGreater(len(d["token"]), 30)
        disp = self.req("GET", "/v1/pareamento")[1]["dispositivos"]
        self.assertTrue(any(x["nome"] == "Pixel" for x in disp))
        self.assertEqual(self.req("DELETE", "/v1/dispositivos/" + d["id"])[0], 200)
        for i in range(5):
            self.req("PUT", f"/v1/conteudo/lote/t{i}", {"resumo": str(i)})
        vistos, cursor = [], ""
        while True:
            pg = self.req("GET", f"/v1/conteudo/lote/alteracoes?desde=0&limit=2&cursor={urllib.parse.quote(cursor)}")[1]
            vistos += [x["tid"] for x in pg["itens"]]
            if not pg["proximo"]:
                break
            cursor = pg["proximo"]
        self.assertEqual(sorted(vistos), [f"t{i}" for i in range(5)])

    def test_06_estaticos(self):
        for rota, tipo in [("/", "text/html"), ("/app.js", "text/javascript"), ("/vendor/pdf.worker.min.js", "text/javascript")]:
            with urllib.request.urlopen(self.base + rota, timeout=5) as r:
                self.assertIn(tipo, r.headers["content-type"])


if __name__ == "__main__":
    unittest.main()
