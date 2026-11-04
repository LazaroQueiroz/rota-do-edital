#!/usr/bin/env python3
"""
Rota do Edital — servidor local.

Usa só a biblioteca padrão do Python (3.9 ou mais novo). Os dados ficam em
dados/rota.db (SQLite), na mesma pasta deste arquivo.

    python server.py                 # abre em http://localhost:8765
    python server.py --rede          # libera o acesso de outros aparelhos da sua rede
    python server.py --porta 9000    # outra porta
"""
import argparse
import json
import os
import re
import socket
import sqlite3
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, unquote

BASE = Path(__file__).resolve().parent
STATIC = BASE / "static"
DADOS = BASE / "dados"
DB_PATH = DADOS / "rota.db"
MAX_BODY = 60 * 1024 * 1024

MODELO_ANTHROPIC = "claude-sonnet-5-5"
MODELO_OLLAMA = "qwen2.5:14b"
OLLAMA_URL = "http://localhost:11434"

TIPOS = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
    ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png",
    ".ico": "image/x-icon", ".webmanifest": "application/manifest+json",
}

_db_lock = threading.Lock()


# ---------------------------------------------------------------- banco
def conectar():
    con = sqlite3.connect(DB_PATH, timeout=30)
    con.execute("PRAGMA journal_mode=WAL")
    return con


def iniciar_banco():
    DADOS.mkdir(exist_ok=True)
    with conectar() as c:
        c.executescript(
            """
            CREATE TABLE IF NOT EXISTS editais(
                id TEXT PRIMARY KEY, dados TEXT NOT NULL, atualizado REAL);
            CREATE TABLE IF NOT EXISTS conteudo(
                ed TEXT NOT NULL, tid TEXT NOT NULL, dados TEXT NOT NULL,
                PRIMARY KEY(ed, tid));
            CREATE TABLE IF NOT EXISTS config(k TEXT PRIMARY KEY, v TEXT);
            """
        )


def cfg(k, padrao=None):
    with conectar() as c:
        r = c.execute("SELECT v FROM config WHERE k=?", (k,)).fetchone()
    return r[0] if r and r[0] not in (None, "") else padrao


def cfg_set(k, v):
    with _db_lock, conectar() as c:
        c.execute("INSERT INTO config(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", (k, v))


# ---------------------------------------------------------------- IA
class ErroIA(Exception):
    def __init__(self, code, message, status=502):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


def config_ia():
    chave = cfg("anthropic_chave") or os.environ.get("ANTHROPIC_API_KEY", "")
    prov = cfg("provedor") or ("anthropic" if chave else "")
    return {
        "provedor": prov,
        "chave": chave,
        "modelo_anthropic": cfg("modelo_anthropic") or os.environ.get("ANTHROPIC_MODEL", MODELO_ANTHROPIC),
        "ollama_url": (cfg("ollama_url") or os.environ.get("OLLAMA_URL", OLLAMA_URL)).rstrip("/"),
        "modelo_ollama": cfg("modelo_ollama") or os.environ.get("OLLAMA_MODEL", MODELO_OLLAMA),
    }


def _post_json(url, corpo, headers, timeout):
    req = urllib.request.Request(url, data=json.dumps(corpo).encode(), method="POST",
                                 headers={"content-type": "application/json", **headers})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def chamar_ia(prompt, max_tokens=8000):
    c = config_ia()
    if c["provedor"] == "anthropic":
        if not c["chave"]:
            raise ErroIA("sem_ia", "Falta a chave da API da Anthropic. Configure em Ajustes.", 400)
        try:
            r = _post_json(
                "https://api.anthropic.com/v1/messages",
                {"model": c["modelo_anthropic"], "max_tokens": max_tokens,
                 "messages": [{"role": "user", "content": prompt}]},
                {"x-api-key": c["chave"], "anthropic-version": "2023-06-01"},
                timeout=600,
            )
        except urllib.error.HTTPError as e:
            detalhe = ""
            try:
                detalhe = json.loads(e.read().decode()).get("error", {}).get("message", "")
            except Exception:
                pass
            if e.code == 401:
                raise ErroIA("chave_invalida", "A chave da API foi recusada. Confira em Ajustes.")
            if e.code == 429:
                raise ErroIA("limite", "Limite de uso da API atingido. Espere um pouco e tente de novo.")
            if e.code == 404:
                raise ErroIA("modelo", f"Modelo não encontrado ({c['modelo_anthropic']}). Ajuste o nome do modelo em Ajustes.")
            if e.code in (500, 502, 503, 529):
                raise ErroIA("indisponivel", "A API está sobrecarregada ou fora do ar. Tente de novo em instantes.")
            raise ErroIA("api", f"A API respondeu com erro {e.code}. {detalhe}".strip())
        except (urllib.error.URLError, socket.timeout, TimeoutError, ConnectionError):
            raise ErroIA("sem_internet", "Sem conexão com a API. Você parece estar offline; o conteúdo já gerado continua disponível.")
        texto = "".join(b.get("text", "") for b in r.get("content", []) if b.get("type") == "text")
        return texto, r.get("stop_reason") == "max_tokens"

    if c["provedor"] == "ollama":
        try:
            r = _post_json(
                c["ollama_url"] + "/api/chat",
                {"model": c["modelo_ollama"], "stream": False, "format": "json",
                 "messages": [{"role": "user", "content": prompt}],
                 "options": {"num_ctx": 32768, "num_predict": max_tokens}},
                {}, timeout=1800,
            )
        except urllib.error.HTTPError as e:
            if e.code == 404:
                raise ErroIA("modelo", f"O Ollama não tem o modelo {c['modelo_ollama']}. Rode: ollama pull {c['modelo_ollama']}")
            raise ErroIA("api", f"O Ollama respondeu com erro {e.code}.")
        except (urllib.error.URLError, socket.timeout, TimeoutError, ConnectionError):
            raise ErroIA("sem_ollama", f"Não encontrei o Ollama em {c['ollama_url']}. Abra o Ollama e tente de novo.")
        return r.get("message", {}).get("content", ""), r.get("done_reason") == "length"

    raise ErroIA("sem_ia", "Nenhuma IA configurada. Escolha Anthropic (online) ou Ollama (offline) em Ajustes.", 400)


def extrair_json(texto):
    texto = texto.strip()
    try:
        return json.loads(texto)
    except ValueError:
        pass
    m = re.search(r"```(?:json)?\s*(.*?)```", texto, re.S)
    if m:
        try:
            return json.loads(m.group(1))
        except ValueError:
            pass
    inicios = [i for i in (texto.find("{"), texto.find("[")) if i >= 0]
    fim = max(texto.rfind("}"), texto.rfind("]"))
    if inicios and fim > min(inicios):
        try:
            return json.loads(texto[min(inicios):fim + 1])
        except ValueError:
            pass
    return None


# ---------------------------------------------------------------- HTTP
class Handler(BaseHTTPRequestHandler):
    server_version = "RotaDoEdital/1.0"

    def log_message(self, fmt, *args):
        if "/api/ia" in (args[0] if args else ""):
            sys.stderr.write("%s  %s\n" % (time.strftime("%H:%M:%S"), fmt % args))

    # utilidades
    def _json(self, obj, status=200):
        dados = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("cache-control", "no-store")
        self.send_header("content-length", str(len(dados)))
        self.end_headers()
        self.wfile.write(dados)

    def _corpo(self):
        n = int(self.headers.get("content-length") or 0)
        if n > MAX_BODY:
            raise ValueError("corpo grande demais")
        raw = self.rfile.read(n) if n else b""
        return json.loads(raw.decode("utf-8")) if raw else {}

    def _estatico(self, caminho):
        rel = unquote(caminho).lstrip("/") or "index.html"
        alvo = (STATIC / rel).resolve()
        if STATIC.resolve() not in alvo.parents and alvo != STATIC.resolve():
            return self._json({"erro": "proibido"}, 403)
        if alvo.is_dir():
            alvo = alvo / "index.html"
        if not alvo.exists():
            alvo = STATIC / "index.html"  # app de página única
        dados = alvo.read_bytes()
        self.send_response(200)
        self.send_header("content-type", TIPOS.get(alvo.suffix, "application/octet-stream"))
        self.send_header("cache-control", "no-cache")
        self.send_header("content-length", str(len(dados)))
        self.end_headers()
        self.wfile.write(dados)

    # roteamento
    def do_GET(self):
        p = urlparse(self.path).path
        if not p.startswith("/api/"):
            return self._estatico(p)
        try:
            return self._api("GET", p)
        except Exception as e:  # noqa: BLE001
            return self._json({"erro": str(e)}, 500)

    def do_PUT(self):
        self._rota_com_corpo("PUT")

    def do_POST(self):
        self._rota_com_corpo("POST")

    def do_DELETE(self):
        self._rota_com_corpo("DELETE")

    def _rota_com_corpo(self, metodo):
        p = urlparse(self.path).path
        try:
            return self._api(metodo, p)
        except ValueError as e:
            return self._json({"erro": f"Pedido inválido: {e}"}, 400)
        except Exception as e:  # noqa: BLE001
            return self._json({"erro": str(e)}, 500)

    def _api(self, m, p):
        partes = [unquote(x) for x in p.split("/")[2:] if x]

        if partes == ["status"] and m == "GET":
            c = config_ia()
            ch = c["chave"]
            return self._json({
                "provedor": c["provedor"] or None,
                "modelo": c["modelo_anthropic"] if c["provedor"] == "anthropic" else c["modelo_ollama"] if c["provedor"] == "ollama" else None,
                "chave": (ch[:7] + "…" + ch[-4:]) if len(ch) > 12 else ("definida" if ch else ""),
                "modelo_anthropic": c["modelo_anthropic"], "modelo_ollama": c["modelo_ollama"],
                "ollama_url": c["ollama_url"],
            })

        if partes == ["config"] and m == "POST":
            b = self._corpo()
            for k in ("provedor", "modelo_anthropic", "modelo_ollama", "ollama_url"):
                if k in b:
                    cfg_set(k, str(b[k]).strip())
            if b.get("chave"):
                cfg_set("anthropic_chave", str(b["chave"]).strip())
            return self._json({"ok": True})

        if partes == ["ia"] and m == "POST":
            b = self._corpo()
            prompt = str(b.get("prompt", ""))
            if not prompt.strip():
                return self._json({"ok": False, "code": "pedido", "message": "Prompt vazio."}, 400)
            try:
                texto, cortado = chamar_ia(prompt, int(b.get("max_tokens") or 8000))
            except ErroIA as e:
                return self._json({"ok": False, "code": e.code, "message": e.message}, e.status)
            dados = extrair_json(texto)
            if dados is None:
                code = "truncado" if cortado else "json_invalido"
                msg = ("A resposta ficou longa demais e foi cortada." if cortado
                       else "A IA não devolveu dados no formato esperado.")
                return self._json({"ok": False, "code": code, "message": msg}, 502)
            return self._json({"ok": True, "dados": dados})

        if partes == ["ativo"]:
            if m == "GET":
                return self._json({"id": cfg("ativo")})
            if m == "PUT":
                cfg_set("ativo", str(self._corpo().get("id") or ""))
                return self._json({"ok": True})

        if partes == ["editais"] and m == "GET":
            with conectar() as c:
                linhas = c.execute("SELECT id, dados, atualizado FROM editais ORDER BY atualizado DESC").fetchall()
            out = []
            for i, d, at in linhas:
                e = json.loads(d)
                tot = sum(len(x.get("topicos", [])) for x in e.get("materias", []))
                est = sum(1 for x in e.get("materias", []) for t in x.get("topicos", []) if t.get("st") != "novo")
                out.append({"id": i, "orgao": e.get("orgao"), "cargo": e.get("cargo"), "banca": e.get("banca"),
                            "topicos": tot, "estudados": est, "atualizado": at})
            return self._json(out)

        if len(partes) == 2 and partes[0] == "editais":
            eid = partes[1]
            if m == "GET":
                with conectar() as c:
                    r = c.execute("SELECT dados FROM editais WHERE id=?", (eid,)).fetchone()
                return self._json(json.loads(r[0])) if r else self._json({"erro": "não encontrado"}, 404)
            if m == "PUT":
                corpo = self._corpo()
                with _db_lock, conectar() as c:
                    c.execute("INSERT INTO editais(id,dados,atualizado) VALUES(?,?,?) "
                              "ON CONFLICT(id) DO UPDATE SET dados=excluded.dados, atualizado=excluded.atualizado",
                              (eid, json.dumps(corpo, ensure_ascii=False), time.time()))
                return self._json({"ok": True})
            if m == "DELETE":
                with _db_lock, conectar() as c:
                    c.execute("DELETE FROM editais WHERE id=?", (eid,))
                    c.execute("DELETE FROM conteudo WHERE ed=?", (eid,))
                return self._json({"ok": True})

        if len(partes) == 2 and partes[0] == "conteudo" and m == "GET":
            with conectar() as c:
                ids = [r[0] for r in c.execute("SELECT tid FROM conteudo WHERE ed=?", (partes[1],))]
            return self._json(ids)

        if len(partes) == 3 and partes[0] == "conteudo":
            ed, tid = partes[1], partes[2]
            if m == "GET":
                with conectar() as c:
                    r = c.execute("SELECT dados FROM conteudo WHERE ed=? AND tid=?", (ed, tid)).fetchone()
                return self._json(json.loads(r[0])) if r else self._json(None, 404)
            if m == "PUT":
                corpo = self._corpo()
                with _db_lock, conectar() as c:
                    c.execute("INSERT INTO conteudo(ed,tid,dados) VALUES(?,?,?) "
                              "ON CONFLICT(ed,tid) DO UPDATE SET dados=excluded.dados",
                              (ed, tid, json.dumps(corpo, ensure_ascii=False)))
                return self._json({"ok": True})

        if partes == ["backup"]:
            if m == "GET":
                with conectar() as c:
                    ed = [{"id": i, "dados": json.loads(d)} for i, d in c.execute("SELECT id, dados FROM editais")]
                    co = [{"ed": e, "tid": t, "dados": json.loads(d)} for e, t, d in c.execute("SELECT ed, tid, dados FROM conteudo")]
                dados = json.dumps({"versao": 1, "exportado": time.strftime("%Y-%m-%d %H:%M"),
                                    "ativo": cfg("ativo"), "editais": ed, "conteudo": co}, ensure_ascii=False).encode()
                self.send_response(200)
                self.send_header("content-type", "application/json; charset=utf-8")
                self.send_header("content-disposition", f'attachment; filename="rota-do-edital-backup-{time.strftime("%Y%m%d")}.json"')
                self.send_header("content-length", str(len(dados)))
                self.end_headers()
                self.wfile.write(dados)
                return None
            if m == "POST":
                b = self._corpo()
                if b.get("versao") != 1 or not isinstance(b.get("editais", []), list):
                    return self._json({"erro": "Arquivo não reconhecido. Use um backup do app ou um pacote gerado pelo Claude."}, 400)
                # Um "pacote" traz o edital já processado e aulas prontas. Se o edital já
                # existe aqui, o progresso de estudo é mantido e só as aulas entram.
                pacote = b.get("tipo") == "pacote"
                sql_ed = ("INSERT OR IGNORE INTO editais(id,dados,atualizado) VALUES(?,?,?)" if pacote
                          else "INSERT OR REPLACE INTO editais(id,dados,atualizado) VALUES(?,?,?)")
                with _db_lock, conectar() as c:
                    for e in b.get("editais", []):
                        c.execute(sql_ed, (e["id"], json.dumps(e["dados"], ensure_ascii=False), time.time()))
                    for x in b.get("conteudo", []):
                        c.execute("INSERT OR REPLACE INTO conteudo(ed,tid,dados) VALUES(?,?,?)",
                                  (x["ed"], x["tid"], json.dumps(x["dados"], ensure_ascii=False)))
                ativo = b.get("ativo") or (b["editais"][0]["id"] if pacote and b.get("editais") else None)
                if ativo:
                    cfg_set("ativo", ativo)
                return self._json({"ok": True, "pacote": pacote, "editais": len(b.get("editais", [])),
                                   "aulas": len(b.get("conteudo", []))})

        return self._json({"erro": "rota não encontrada"}, 404)


def ip_da_rede():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except OSError:
        return None
    finally:
        s.close()


def main():
    ap = argparse.ArgumentParser(description="Rota do Edital — servidor local")
    ap.add_argument("--porta", type=int, default=8765)
    ap.add_argument("--rede", action="store_true", help="aceitar conexões de outros aparelhos da rede")
    ap.add_argument("--sem-navegador", action="store_true", help="não abrir o navegador ao iniciar")
    a = ap.parse_args()

    iniciar_banco()
    host = "0.0.0.0" if a.rede else "127.0.0.1"
    try:
        srv = ThreadingHTTPServer((host, a.porta), Handler)
    except OSError:
        print(f"A porta {a.porta} já está em uso. Feche a outra janela do Rota do Edital ou use --porta 9000.")
        sys.exit(1)
    url = f"http://localhost:{a.porta}"
    print("\n  Rota do Edital rodando")
    print(f"  Neste computador:   {url}")
    if a.rede:
        ip = ip_da_rede()
        if ip:
            print(f"  Em outro aparelho:  http://{ip}:{a.porta}  (mesma rede Wi-Fi)")
        print("  Atenção: qualquer pessoa na sua rede pode abrir o app. Use só em redes de confiança.")
    print(f"  Dados salvos em:    {DB_PATH}")
    print("  Para encerrar, feche esta janela ou aperte Ctrl+C.\n")
    if not a.sem_navegador:
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nEncerrado.")


if __name__ == "__main__":
    main()
