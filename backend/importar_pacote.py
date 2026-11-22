#!/usr/bin/env python3
"""Importa um pacote (pacote-*.json) no banco local, uma única vez.

    python backend/importar_pacote.py pacote-tjpb.json

Não sobrescreve um edital que já existe (preserva o progresso); só entram as aulas
e a descrição dos materiais. Uma marca em dados/ evita reimportar a cada início.
"""
import json
import sys
import time
from pathlib import Path

import server


def main(caminho):
    arq = Path(caminho)
    marca = server.DADOS / f".importado-{arq.stem}"
    if marca.exists():
        print("Pacote já importado antes.")
        return 0
    b = json.loads(arq.read_text(encoding="utf-8"))
    if b.get("versao") != 1 or b.get("tipo") != "pacote":
        print("Arquivo não é um pacote do Rota do Edital.", file=sys.stderr)
        return 1
    server.iniciar_banco()
    with server._db_lock, server.conectar() as c:
        for e in b.get("editais", []):
            c.execute("INSERT OR IGNORE INTO editais(id,dados,atualizado,rev) VALUES(?,?,?,1)",
                      (e["id"], json.dumps(e["dados"], ensure_ascii=False), time.time()))
        for x in b.get("conteudo", []):
            c.execute("INSERT OR REPLACE INTO conteudo(ed,tid,dados,atualizado) VALUES(?,?,?,?)",
                      (x["ed"], x["tid"], json.dumps(x["dados"], ensure_ascii=False), time.time()))
        for x in b.get("materiais", []):
            c.execute("INSERT OR REPLACE INTO materiais(ed,id,dados,atualizado) VALUES(?,?,?,?)",
                      (x["ed"], x["id"], json.dumps(x["dados"], ensure_ascii=False), time.time()))
    if b.get("ativo"):
        server.cfg_set("ativo", b["ativo"])
    marca.write_text(time.strftime("%Y-%m-%d %H:%M"))
    print(f"Importado: {len(b.get('editais', []))} edital(is), {len(b.get('conteudo', []))} aulas, "
          f"{len(b.get('materiais', []))} materiais.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]) if len(sys.argv) > 1 else 1)
