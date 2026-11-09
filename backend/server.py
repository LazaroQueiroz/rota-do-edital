#!/usr/bin/env python3
"""
Rota do Edital — servidor local.

Usa só a biblioteca padrão do Python (3.9 ou mais novo). Os dados ficam em
dados/rota.db (SQLite), na raiz do projeto.

    python backend/server.py                 # abre em http://localhost:8765
    python backend/server.py --rede          # libera o acesso de outros aparelhos da sua rede
    python backend/server.py --porta 9000    # outra porta
"""
import argparse
import gzip
import hashlib
import json
import os
import re
import secrets
import shutil
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
from urllib.parse import urlparse, unquote, parse_qs

from mesclagem import mesclar_edital

RAIZ = Path(__file__).resolve().parent.parent   # backend/ fica dentro da raiz do projeto
STATIC = RAIZ / "web"
DADOS = RAIZ / "dados"
DB_PATH = DADOS / "rota.db"
MATERIAIS = DADOS / "materiais"   # PDFs de apoio, um diretório por edital
ID_OK = re.compile(r"[A-Za-z0-9_-]{1,80}")
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
REDE = {"ativa": False, "porta": 8765}
_falhas = {}  # ip -> [horários de tentativas com código errado]
_LETRAS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


_TITULOS = {400: "Pedido inválido", 401: "Não autorizado", 403: "Proibido", 404: "Não encontrado",
            409: "Conflito", 429: "Muitas tentativas", 500: "Erro interno", 502: "Falha na IA"}
_TEXTO = ("application/json", "application/problem+json", "text/", "image/svg+xml", "application/manifest+json")


def hash_token(t):
    return hashlib.sha256(t.encode()).hexdigest()


def novo_codigo():
    return "".join(secrets.choice(_LETRAS) for _ in range(6))


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
            CREATE TABLE IF NOT EXISTS materiais(
                ed TEXT NOT NULL, id TEXT NOT NULL, dados TEXT NOT NULL,
                PRIMARY KEY(ed, id));
            -- aparelhos pareados (app Android ou navegador de outro aparelho)
            CREATE TABLE IF NOT EXISTS dispositivos(
                id TEXT PRIMARY KEY, nome TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
                criado REAL NOT NULL, visto REAL);
            """
        )
        # migrações (bancos antigos): versão do edital e data de alteração
        for tabela, coluna, tipo in (("editais", "rev", "INTEGER NOT NULL DEFAULT 0"),
                                     ("conteudo", "atualizado", "REAL NOT NULL DEFAULT 0"),
                                     ("materiais", "atualizado", "REAL NOT NULL DEFAULT 0")):
            cols = [r[1] for r in c.execute(f"PRAGMA table_info({tabela})")]
            if coluna not in cols:
                c.execute(f"ALTER TABLE {tabela} ADD COLUMN {coluna} {tipo}")
        c.execute("CREATE INDEX IF NOT EXISTS conteudo_ed_atualizado ON conteudo(ed, atualizado)")
        # linhas anteriores à migração ficam com data 0; dá a elas uma data para a sincronização enxergá-las
        agora = time.time()
        c.execute("UPDATE conteudo SET atualizado=? WHERE atualizado=0", (agora,))
        c.execute("UPDATE materiais SET atualizado=? WHERE atualizado=0", (agora,))
    if not cfg("codigo"):
        cfg_set("codigo", novo_codigo())


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
        if "/api/ia" in (str(args[0]) if args else ""):
            sys.stderr.write("%s  %s\n" % (time.strftime("%H:%M:%S"), fmt % args))

    # utilidades
    def _enviar(self, status, tipo, dados, cache="no-store", extra=None):
        """Resposta com ETag (GETs) e gzip para texto."""
        h = dict(extra or {})
        if self.command == "GET" and status == 200:
            etag = '"' + hashlib.sha1(dados).hexdigest()[:20] + '"'
            h["etag"] = etag
            if cache == "no-store":
                cache = "no-cache"  # pode guardar, mas revalida com If-None-Match
            if self.headers.get("if-none-match") == etag:
                self.send_response(304)
                self.send_header("etag", etag)
                self.send_header("cache-control", cache)
                self.end_headers()
                return
        if len(dados) > 1024 and tipo.startswith(_TEXTO) and "gzip" in (self.headers.get("accept-encoding") or ""):
            dados = gzip.compress(dados, 6)
            h["content-encoding"] = "gzip"
        self.send_response(status)
        self.send_header("content-type", tipo)
        self.send_header("cache-control", cache)
        self.send_header("vary", "Accept-Encoding")
        for k, v in h.items():
            self.send_header(k, v)
        self.send_header("content-length", str(len(dados)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(dados)

    def _json(self, obj, status=200, extra=None):
        tipo = "application/json; charset=utf-8"
        if status >= 400 and urlparse(self.path).path.startswith("/v1/"):
            # erros no formato RFC 9457 (problem+json); "code" é a extensão usada pelos apps
            o = obj if isinstance(obj, dict) else {}
            obj = {"type": "about:blank", "title": _TITULOS.get(status, "Erro"), "status": status,
                   "detail": o.get("message") or o.get("erro") or _TITULOS.get(status, "Erro"),
                   "code": o.get("code") or ("nao_encontrado" if status == 404 else "pedido" if status == 400 else "erro")}
            tipo = "application/problem+json; charset=utf-8"
        self._enviar(status, tipo, json.dumps(obj, ensure_ascii=False).encode("utf-8"), extra=extra)

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
        imutavel = alvo.suffix == ".woff2" or "vendor" in alvo.parts
        self._enviar(200, TIPOS.get(alvo.suffix, "application/octet-stream"), alvo.read_bytes(),
                     cache="public, max-age=31536000, immutable" if imutavel else "no-cache")

    def _arquivo_material(self, caminho):
        partes = [unquote(x) for x in caminho.split("/")[2:] if x]
        if len(partes) != 2 or not ID_OK.fullmatch(partes[0]) or not re.fullmatch(r"[A-Za-z0-9_-]{1,80}\.pdf", partes[1]):
            return self._json({"erro": "não encontrado"}, 404)
        alvo = MATERIAIS / partes[0] / partes[1]
        if not alvo.is_file():
            return self._json({"erro": "Arquivo não encontrado neste computador."}, 404)
        self.send_response(200)
        self.send_header("content-type", "application/pdf")
        self.send_header("content-disposition", f'inline; filename="{partes[1]}"')
        self.send_header("cache-control", "no-cache")
        self.send_header("content-length", str(alvo.stat().st_size))
        self.end_headers()
        with open(alvo, "rb") as f:
            shutil.copyfileobj(f, self.wfile)
        return None

    def _corpo_bruto(self):
        n = int(self.headers.get("content-length") or 0)
        if n > MAX_BODY:
            raise ValueError("arquivo grande demais (limite de 60 MB)")
        return self.rfile.read(n) if n else b""

    def _local(self):
        ip = self.client_address[0]
        return ip.startswith("127.") or ip in ("::1", "::ffff:127.0.0.1")

    def _token(self):
        a = self.headers.get("authorization") or ""
        if a.lower().startswith("bearer "):
            return a[7:].strip()
        for parte in (self.headers.get("cookie") or "").split(";"):
            k, _, v = parte.strip().partition("=")
            if k == "rota_sessao":
                return v
        return ""

    def _autorizado(self):
        """Do próprio PC: livre. De outro aparelho: token do app (Bearer) ou cookie de sessão."""
        if self._local():
            return True
        t = self._token()
        if t:
            with _db_lock, conectar() as c:
                ok = c.execute("UPDATE dispositivos SET visto=? WHERE token_hash=?", (time.time(), hash_token(t))).rowcount
            if ok:
                return True
        self._json({"code": "codigo", "message": "Pareie este aparelho com o código mostrado no PC (Ajustes → Celular)."}, 401)
        return False

    def _confere_codigo(self, codigo):
        """Troca o código de pareamento por um token. Limita tentativas por IP."""
        ip, agora = self.client_address[0], time.time()
        tent = [t for t in _falhas.get(ip, []) if agora - t < 600]
        if len(tent) >= 10:
            self._json({"code": "bloqueado", "message": "Muitas tentativas com código errado. Espere 10 minutos."}, 429)
            return False
        if not secrets.compare_digest(str(codigo or "").strip().upper(), cfg("codigo", "")):
            _falhas[ip] = tent + [agora]
            self._json({"code": "codigo_invalido", "message": "Código incorreto. Confira em Ajustes → Celular, no PC."}, 401)
            return False
        return True

    def _novo_dispositivo(self, nome):
        token, did = secrets.token_urlsafe(32), secrets.token_hex(6)
        with _db_lock, conectar() as c:
            c.execute("INSERT INTO dispositivos(id,nome,token_hash,criado,visto) VALUES(?,?,?,?,?)",
                      (did, str(nome or "Aparelho")[:60], hash_token(token), time.time(), time.time()))
        return did, token

    def _rota(self):
        """/v1/... é a API do contrato; /api/... continua aceito (mesmas rotas)."""
        p = urlparse(self.path).path
        return p if p.startswith(("/v1/", "/api/")) else None

    def _publica(self, p, m):
        """Rotas sem autenticação: saúde e pareamento."""
        partes = [x for x in p.split("/")[2:] if x]
        if partes == ["health"] and m == "GET":
            return self._json({"ok": True, "versao": "1", "servidor": self.server_version}) or True
        if partes == ["dispositivos"] and m == "POST":
            b = self._corpo()
            if self._confere_codigo(b.get("codigo")):
                did, token = self._novo_dispositivo(b.get("nome") or "Celular")
                self._json({"id": did, "token": token}, 201)
            return True
        if partes == ["sessao"] and m == "POST":
            b = self._corpo()
            if self._confere_codigo(b.get("codigo")):
                did, token = self._novo_dispositivo("Navegador")
                self._json({"id": did}, 201, extra={"set-cookie": f"rota_sessao={token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000"})
            return True
        return False

    # roteamento
    def do_GET(self):
        p = urlparse(self.path).path
        if p.startswith("/materiais/"):
            return self._arquivo_material(p) if self._autorizado() else None
        if not self._rota():
            return self._estatico(p)
        if self._publica(p, "GET") or not self._autorizado():
            return None
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
            if self._publica(p, metodo) or not self._autorizado():
                return None
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

        # pareamento com o celular (só do próprio PC)
        if partes and partes[0] == "pareamento":
            if not self._local():
                return self._json({"erro": "proibido"}, 403)
            if partes == ["pareamento", "novo"] and m == "POST":
                cfg_set("codigo", novo_codigo())
            ip = ip_da_rede()
            with conectar() as c:
                disp = [{"id": i, "nome": n, "criado": cr, "visto": v}
                        for i, n, cr, v in c.execute("SELECT id, nome, criado, visto FROM dispositivos ORDER BY visto DESC")]
            return self._json({"rede": REDE["ativa"], "porta": REDE["porta"], "codigo": cfg("codigo"),
                               "enderecos": [f"{ip}:{REDE['porta']}"] if ip else [], "dispositivos": disp})

        if len(partes) == 2 and partes[0] == "dispositivos" and m == "DELETE":
            if not self._local():
                return self._json({"erro": "proibido"}, 403)
            with _db_lock, conectar() as c:
                c.execute("DELETE FROM dispositivos WHERE id=?", (partes[1],))
            return self._json({"ok": True})

        # aulas alteradas desde um instante, em lotes (sincronização do app)
        if len(partes) == 3 and partes[0] == "conteudo" and partes[2] == "alteracoes" and m == "GET":
            q = parse_qs(urlparse(self.path).query)
            desde = float((q.get("desde") or ["0"])[0] or 0)
            cursor = (q.get("cursor") or [""])[0]
            limite = max(1, min(100, int((q.get("limit") or ["50"])[0] or 50)))
            ca, ct = (cursor.split("|", 1) + [""])[:2] if cursor else ("", "")
            with conectar() as c:
                if cursor:
                    linhas = c.execute("SELECT tid, dados, atualizado FROM conteudo WHERE ed=? AND atualizado>? AND (atualizado>? OR (atualizado=? AND tid>?)) "
                                       "ORDER BY atualizado, tid LIMIT ?", (partes[1], desde, float(ca), float(ca), ct, limite + 1)).fetchall()
                else:
                    linhas = c.execute("SELECT tid, dados, atualizado FROM conteudo WHERE ed=? AND atualizado>? ORDER BY atualizado, tid LIMIT ?",
                                       (partes[1], desde, limite + 1)).fetchall()
            mais = len(linhas) > limite
            linhas = linhas[:limite]
            prox = f"{linhas[-1][2]!r}|{linhas[-1][0]}" if mais and linhas else None
            return self._json({"itens": [{"tid": t, "atualizado": a, "dados": json.loads(d)} for t, d, a in linhas], "proximo": prox})

        if partes == ["sync", "estado"] and m == "GET":
            with conectar() as c:
                ed = [{"id": i, "rev": r} for i, r in c.execute("SELECT id, rev FROM editais")]
                co = [{"ed": e, "tid": t, "atualizado": a} for e, t, a in c.execute("SELECT ed, tid, atualizado FROM conteudo")]
                ma = []
                for e, i, d, a in c.execute("SELECT ed, id, dados, atualizado FROM materiais"):
                    x = json.loads(d)
                    arq = x.get("arquivo") or ""
                    tem = bool(arq) and ID_OK.fullmatch(e) is not None and (MATERIAIS / e / arq).is_file()
                    ma.append({"ed": e, "id": i, "atualizado": a, "arquivo": arq, "tamanho": x.get("tamanho"), "temArquivo": tem})
            return self._json({"editais": ed, "conteudo": co, "materiais": ma, "ativo": cfg("ativo")})

        if partes == ["mesclar"] and m == "POST":
            b = self._corpo()
            return self._json({"doc": mesclar_edital(b.get("base"), b.get("local"), b.get("remoto"))})

        if len(partes) == 3 and partes[0] == "editais" and partes[2] == "rev" and m == "GET":
            with conectar() as c:
                r = c.execute("SELECT dados, rev FROM editais WHERE id=?", (partes[1],)).fetchone()
            return self._json({"doc": json.loads(r[0]), "rev": r[1]}) if r else self._json({"erro": "não encontrado"}, 404)

        if len(partes) == 3 and partes[0] == "editais" and partes[2] == "mesclar" and m == "POST":
            # grava a versão de um aparelho; se o PC mudou desde a base dele, mescla
            eid, b = partes[1], self._corpo()
            doc, base, base_rev = b.get("doc"), b.get("base"), int(b.get("base_rev") or 0)
            if not isinstance(doc, dict):
                return self._json({"erro": "Falta o edital."}, 400)
            with _db_lock, conectar() as c:
                r = c.execute("SELECT dados, rev FROM editais WHERE id=?", (eid,)).fetchone()
                mesclado = False
                if r and r[1] != base_rev:
                    atual = json.loads(r[0])
                    novo = mesclar_edital(base if isinstance(base, dict) else None, doc, atual)
                    mesclado = novo != doc
                    doc = novo
                rev = (r[1] if r else 0) + 1
                c.execute("INSERT INTO editais(id,dados,atualizado,rev) VALUES(?,?,?,?) "
                          "ON CONFLICT(id) DO UPDATE SET dados=excluded.dados, atualizado=excluded.atualizado, rev=excluded.rev",
                          (eid, json.dumps(doc, ensure_ascii=False), time.time(), rev))
            return self._json({"ok": True, "rev": rev, "mesclado": mesclado, "doc": doc if mesclado else None})

        if len(partes) == 2 and partes[0] == "editais":
            eid = partes[1]
            if m == "GET":
                with conectar() as c:
                    r = c.execute("SELECT dados FROM editais WHERE id=?", (eid,)).fetchone()
                return self._json(json.loads(r[0])) if r else self._json({"erro": "não encontrado"}, 404)
            if m == "PUT":
                corpo = self._corpo()
                with _db_lock, conectar() as c:
                    c.execute("INSERT INTO editais(id,dados,atualizado,rev) VALUES(?,?,?,1) "
                              "ON CONFLICT(id) DO UPDATE SET dados=excluded.dados, atualizado=excluded.atualizado, rev=editais.rev+1",
                              (eid, json.dumps(corpo, ensure_ascii=False), time.time()))
                return self._json({"ok": True})
            if m == "DELETE":
                with _db_lock, conectar() as c:
                    c.execute("DELETE FROM editais WHERE id=?", (eid,))
                    c.execute("DELETE FROM conteudo WHERE ed=?", (eid,))
                    c.execute("DELETE FROM materiais WHERE ed=?", (eid,))
                if ID_OK.fullmatch(eid):
                    shutil.rmtree(MATERIAIS / eid, ignore_errors=True)
                return self._json({"ok": True})

        # materiais de apoio (PDFs) ligados aos tópicos
        if len(partes) == 2 and partes[0] == "materiais" and m == "GET":
            ed = partes[1]
            with conectar() as c:
                linhas = [json.loads(d) for (d,) in c.execute("SELECT dados FROM materiais WHERE ed=?", (ed,))]
            for x in linhas:
                x["temArquivo"] = bool(x.get("arquivo")) and ID_OK.fullmatch(ed) is not None and (MATERIAIS / ed / x["arquivo"]).is_file()
            return self._json(linhas)

        if len(partes) == 3 and partes[0] == "materiais":
            ed, mid = partes[1], partes[2]
            if not ID_OK.fullmatch(ed) or not ID_OK.fullmatch(mid):
                return self._json({"erro": "Identificador inválido."}, 400)
            if m == "PUT":
                corpo = self._corpo()
                if not isinstance(corpo, dict) or not str(corpo.get("titulo", "")).strip():
                    return self._json({"erro": "O material precisa de um título."}, 400)
                corpo["id"] = mid
                corpo.pop("temArquivo", None)
                with _db_lock, conectar() as c:
                    c.execute("INSERT INTO materiais(ed,id,dados,atualizado) VALUES(?,?,?,?) "
                              "ON CONFLICT(ed,id) DO UPDATE SET dados=excluded.dados, atualizado=excluded.atualizado",
                              (ed, mid, json.dumps(corpo, ensure_ascii=False), time.time()))
                return self._json({"ok": True})
            if m == "DELETE":
                with _db_lock, conectar() as c:
                    c.execute("DELETE FROM materiais WHERE ed=? AND id=?", (ed, mid))
                (MATERIAIS / ed / f"{mid}.pdf").unlink(missing_ok=True)
                return self._json({"ok": True})

        if len(partes) == 4 and partes[0] == "materiais" and partes[3] == "arquivo" and m == "PUT":
            ed, mid = partes[1], partes[2]
            if not ID_OK.fullmatch(ed) or not ID_OK.fullmatch(mid):
                return self._json({"erro": "Identificador inválido."}, 400)
            dados = self._corpo_bruto()
            if not dados.startswith(b"%PDF-"):
                return self._json({"erro": "Envie um arquivo PDF."}, 400)
            pasta = MATERIAIS / ed
            pasta.mkdir(parents=True, exist_ok=True)
            tmp = pasta / f".{mid}.pdf.tmp"
            tmp.write_bytes(dados)
            tmp.replace(pasta / f"{mid}.pdf")
            return self._json({"ok": True, "arquivo": f"{mid}.pdf", "tamanho": len(dados)})

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
                    c.execute("INSERT INTO conteudo(ed,tid,dados,atualizado) VALUES(?,?,?,?) "
                              "ON CONFLICT(ed,tid) DO UPDATE SET dados=excluded.dados, atualizado=excluded.atualizado",
                              (ed, tid, json.dumps(corpo, ensure_ascii=False), time.time()))
                return self._json({"ok": True})

        if partes == ["backup"]:
            if m == "GET":
                with conectar() as c:
                    ed = [{"id": i, "dados": json.loads(d)} for i, d in c.execute("SELECT id, dados FROM editais")]
                    co = [{"ed": e, "tid": t, "dados": json.loads(d)} for e, t, d in c.execute("SELECT ed, tid, dados FROM conteudo")]
                    # só a descrição dos materiais; os PDFs ficam em dados/materiais/ (copie a pasta junto)
                    ma = [{"ed": e, "id": i, "dados": json.loads(d)} for e, i, d in c.execute("SELECT ed, id, dados FROM materiais")]
                dados = json.dumps({"versao": 1, "exportado": time.strftime("%Y-%m-%d %H:%M"),
                                    "ativo": cfg("ativo"), "editais": ed, "conteudo": co, "materiais": ma}, ensure_ascii=False).encode()
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
                sql_ed = ("INSERT OR IGNORE INTO editais(id,dados,atualizado,rev) VALUES(?,?,?,1)" if pacote
                          else "INSERT INTO editais(id,dados,atualizado,rev) VALUES(?,?,?,1) ON CONFLICT(id) DO UPDATE "
                               "SET dados=excluded.dados, atualizado=excluded.atualizado, rev=editais.rev+1")
                with _db_lock, conectar() as c:
                    for e in b.get("editais", []):
                        c.execute(sql_ed, (e["id"], json.dumps(e["dados"], ensure_ascii=False), time.time()))
                    for x in b.get("conteudo", []):
                        c.execute("INSERT OR REPLACE INTO conteudo(ed,tid,dados,atualizado) VALUES(?,?,?,?)",
                                  (x["ed"], x["tid"], json.dumps(x["dados"], ensure_ascii=False), time.time()))
                    for x in b.get("materiais", []) or []:
                        if ID_OK.fullmatch(str(x.get("ed", ""))) and ID_OK.fullmatch(str(x.get("id", ""))):
                            c.execute("INSERT OR REPLACE INTO materiais(ed,id,dados,atualizado) VALUES(?,?,?,?)",
                                      (x["ed"], x["id"], json.dumps(x["dados"], ensure_ascii=False), time.time()))
                ativo = b.get("ativo") or (b["editais"][0]["id"] if pacote and b.get("editais") else None)
                if ativo:
                    cfg_set("ativo", ativo)
                return self._json({"ok": True, "pacote": pacote, "editais": len(b.get("editais", [])),
                                   "aulas": len(b.get("conteudo", [])), "materiais": len(b.get("materiais", []) or [])})

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
    REDE.update(ativa=a.rede, porta=a.porta)
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
        print(f"  Código de pareamento: {cfg('codigo')}  (o celular pede este código para ver seus dados)")
        print("  Use só em redes de confiança (casa, não Wi-Fi público).")
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
