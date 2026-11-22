#!/usr/bin/env python3
"""Monta os pacotes de distribuição: zip do Windows, tar.gz do Linux e APK do Android.

    python tools/empacotar.py [--sem-apk] [--versao 1.0.0] [--ed tjpb2026-ti-dev] [--python 3.12.8]

Gera em dist/: -windows.zip (com Python embutido), -linux.tar.gz e o .apk. Cada pacote leva
servidor + web, conteúdo com o progresso zerado e os PDFs oficiais de apoio.
Nunca leva o seu banco, a chave de IA, o progresso nem PDFs que você mesmo enviou.
"""
import argparse
import io
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tarfile
import time
import urllib.request
import zipfile
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
DIST = RAIZ / "dist"


def zerar_edital(d):
    """Edital limpo: mantém a estrutura e apaga todo o progresso de estudo."""
    for k in ("erros", "cal", "ativ", "hojeMin", "seEntao"):
        d.pop(k, None)
    d["erros"] = []
    for m in d.get("materias", []):
        for t in m.get("topicos", []):
            t["st"], t["em"], t["revs"], t["q"] = "novo", None, [], {"f": 0, "a": 0}
            for k in ("iv", "qc", "qcPulado"):
                t.pop(k, None)
    return d


def montar_pacote(ed_id):
    con = sqlite3.connect(RAIZ / "dados" / "rota.db")
    r = con.execute("SELECT dados FROM editais WHERE id=?", (ed_id,)).fetchone()
    if not r:
        sys.exit(f"Edital '{ed_id}' não existe em dados/rota.db.")
    edital = zerar_edital(json.loads(r[0]))
    conteudo = [{"ed": e, "tid": t, "dados": json.loads(d)}
                for e, t, d in con.execute("SELECT ed,tid,dados FROM conteudo WHERE ed=?", (ed_id,))]
    materiais, pdfs = [], []
    for e, i, d in con.execute("SELECT ed,id,dados FROM materiais WHERE ed=?", (ed_id,)):
        m = json.loads(d)
        if m.get("proprio"):
            continue  # PDF enviado pelo usuário: não distribuir
        m.pop("simulados", None)
        pdf = RAIZ / "dados" / "materiais" / ed_id / f"{i}.pdf"
        if not pdf.exists():
            print(f"  aviso: {i}.pdf ausente; material fica só com a descrição")
        else:
            pdfs.append(pdf)
        materiais.append({"ed": e, "id": i, "dados": m})
    pacote = {"versao": 1, "tipo": "pacote", "exportado": time.strftime("%Y-%m-%d %H:%M"),
              "ativo": ed_id, "editais": [{"id": ed_id, "dados": edital}],
              "conteudo": conteudo, "materiais": materiais}
    return pacote, pdfs


def baixar_python(versao):
    DIST.mkdir(exist_ok=True)
    zipf = DIST / f"python-{versao}-embed-amd64.zip"
    if not zipf.exists():
        url = f"https://www.python.org/ftp/python/{versao}/python-{versao}-embed-amd64.zip"
        print("Baixando", url)
        urllib.request.urlretrieve(url, zipf)
    return zipf


BAT = r"""@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Rota do Edital
if exist "python\python.exe" (set PY=python\python.exe) else (set PY=python)
if exist "pacote-tjpb.json" %PY% backend\importar_pacote.py pacote-tjpb.json
echo.
echo Abrindo o Rota do Edital. Deixe esta janela aberta enquanto estuda.
echo Para usar o celular, ele precisa estar na mesma rede Wi-Fi.
echo Se o Windows perguntar sobre o Firewall, clique em "Permitir" (rede privada).
echo.
%PY% backend\server.py --rede
pause
"""

SH = """#!/usr/bin/env sh
cd "$(dirname "$0")" || exit 1
PY=$(command -v python3 || command -v python) || { echo "Instale o Python 3.9 ou mais novo."; exit 1; }
[ -f pacote-tjpb.json ] && "$PY" backend/importar_pacote.py pacote-tjpb.json
echo "Abrindo o Rota do Edital em http://localhost:8765. Deixe este terminal aberto enquanto estuda."
exec "$PY" backend/server.py --rede "$@"
"""

LEIAME_LINUX = """ROTA DO EDITAL — como usar (Linux)

1. Extraia:  tar xzf RotaDoEdital-*-linux.tar.gz && cd RotaDoEdital-*
2. Rode:     ./iniciar.sh      (precisa do Python 3.9+, que já vem na maioria das distribuições)
3. O navegador abre em http://localhost:8765. Deixe o terminal aberto enquanto estuda.

Para usar o celular, instale o RotaDoEdital.apk (baixe junto na página da release) e pareie
com o código que aparece em Configurações > Pareamento, com os dois na mesma Wi-Fi.

Seus dados ficam na pasta "dados" (não apague). Para gerar novas aulas com IA é preciso a chave
da Anthropic (ou um Ollama local) em Configurações; o conteúdo do pacote funciona sem chave e sem internet.
"""

LEIAME = """ROTA DO EDITAL — como usar

NO COMPUTADOR (Windows)
1. Extraia TODO o zip numa pasta (por exemplo C:\\RotaDoEdital). Não rode de dentro do zip.
2. Dê duplo clique em iniciar.bat. O navegador abre sozinho.
3. Se o Windows perguntar sobre o Firewall, clique em "Permitir" (rede privada).
   Deixe a janela preta aberta enquanto estuda.

NO CELULAR (Android)
1. Copie RotaDoEdital.apk para o celular (cabo, Drive ou WhatsApp) e abra o arquivo.
2. O Android vai pedir para permitir instalar de fontes desconhecidas: permita só para esse app.
3. Com o celular na mesma Wi-Fi do computador, abra o app e pareie usando o código que
   aparece no site do computador (Configurações > Pareamento).

Seus dados ficam na pasta "dados" (não apague). Para fazer backup, copie essa pasta.
Para gerar novas aulas com IA é preciso informar a chave da Anthropic em Configurações;
o conteúdo que já vem no pacote funciona sem chave e sem internet.
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sem-apk", action="store_true", help="reaproveita o APK já compilado")
    ap.add_argument("--ed", default="tjpb2026-ti-dev")
    ap.add_argument("--python", default="3.12.8")
    ap.add_argument("--versao", help="ex.: 1.0.0 (padrão: data de hoje)")
    a = ap.parse_args()

    apk = RAIZ / "android/app/build/outputs/apk/release/app-release.apk"
    if not a.sem_apk:
        env = dict(os.environ, JAVA_HOME=os.environ.get("JAVA_HOME", "/usr/lib/jvm/java-17-openjdk"))
        print("Compilando o APK...")
        subprocess.run(["./gradlew", "testDebugUnitTest", "assembleRelease"], cwd=RAIZ / "android", env=env, check=True)
    if not apk.exists():
        sys.exit("APK não encontrado. Rode sem --sem-apk.")

    print("Montando o pacote de conteúdo...")
    pacote, pdfs = montar_pacote(a.ed)
    pyzip = baixar_python(a.python)

    versao = a.versao or time.strftime("%Y%m%d")
    nome = f"RotaDoEdital-{versao}"
    pacote_json = json.dumps(pacote, ensure_ascii=False).encode("utf-8")

    def arquivos():
        """(origem, destino) do código e dos PDFs oficiais; comum aos dois pacotes."""
        for pasta in ("backend", "web", "contract"):
            for f in sorted((RAIZ / pasta).rglob("*")):
                if f.is_file() and "__pycache__" not in f.parts and "tests" not in f.parts and f.suffix != ".pyc":
                    yield f, f.relative_to(RAIZ).as_posix()
        for p in pdfs:
            yield p, f"dados/materiais/{a.ed}/{p.name}"

    # Windows: Python embutido, nada para instalar
    saida = DIST / f"{nome}-windows.zip"
    saida.unlink(missing_ok=True)
    with zipfile.ZipFile(saida, "w", zipfile.ZIP_DEFLATED) as z:
        for src, dst in arquivos():
            z.write(src, f"{nome}/{dst}")
        z.writestr(f"{nome}/pacote-tjpb.json", pacote_json)
        z.write(apk, f"{nome}/RotaDoEdital.apk")
        z.writestr(f"{nome}/iniciar.bat", BAT.replace("\n", "\r\n"))
        z.writestr(f"{nome}/LEIA-ME.txt", LEIAME.replace("\n", "\r\n"))
        # Python embutido; o ._pth restringe o sys.path, então inclui ..\backend
        with zipfile.ZipFile(pyzip) as pz:
            for item in pz.namelist():
                dados = pz.read(item)
                if item.endswith("._pth"):
                    dados = dados + b"\r\n..\\backend\r\n"
                z.writestr(f"{nome}/python/{item}", dados)
    print(f"Pronto: {saida} ({saida.stat().st_size / 1e6:.1f} MB)")

    # Linux: usa o Python 3 do sistema
    linux = DIST / f"{nome}-linux.tar.gz"
    linux.unlink(missing_ok=True)
    with tarfile.open(linux, "w:gz") as t:
        def add_bytes(dst, dados, modo=0o644):
            ti = tarfile.TarInfo(f"{nome}/{dst}")
            ti.size, ti.mode, ti.mtime = len(dados), modo, time.time()
            t.addfile(ti, io.BytesIO(dados))
        for src, dst in arquivos():
            t.add(src, f"{nome}/{dst}", recursive=False)
        add_bytes("pacote-tjpb.json", pacote_json)
        add_bytes("iniciar.sh", SH.encode(), 0o755)
        add_bytes("LEIA-ME.txt", LEIAME_LINUX.encode())
    print(f"Pronto: {linux} ({linux.stat().st_size / 1e6:.1f} MB)")

    # APK solto, para quem só quer o celular
    shutil.copy(apk, DIST / f"RotaDoEdital-{versao}.apk")
    saida = DIST / f"RotaDoEdital-{versao}.apk"
    print(f"\nPronto: {saida} ({saida.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
