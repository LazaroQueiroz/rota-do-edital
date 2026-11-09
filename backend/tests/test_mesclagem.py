import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mesclagem import mesclar_edital  # noqa: E402


def topico(i, **kw):
    t = {"id": i, "nome": i, "inc": "alta", "st": "novo", "em": None, "revs": [], "q": {"f": 0, "a": 0}}
    t.update(kw)
    return t


def edital(topicos, erros=None, **kw):
    e = {"id": "e", "horas": 3, "materias": [{"id": "m0", "nome": "M", "topicos": topicos}], "erros": erros or []}
    e.update(kw)
    return e


class TestMesclagem(unittest.TestCase):
    def test_lado_unico(self):
        base = edital([topico("a")])
        local = edital([topico("a", st="estudado", em="2026-11-09")])
        self.assertEqual(mesclar_edital(base, local, base), local)
        self.assertEqual(mesclar_edital(base, base, local), local)

    def test_contadores_somam(self):
        base = edital([topico("a", q={"f": 2, "a": 1})], cal={"certeza": {"f": 1, "a": 1}})
        pc = edital([topico("a", q={"f": 5, "a": 3})], cal={"certeza": {"f": 3, "a": 2}})
        cel = edital([topico("a", q={"f": 4, "a": 4})], cal={"certeza": {"f": 2, "a": 2}})
        m = mesclar_edital(base, cel, pc)
        self.assertEqual(m["materias"][0]["topicos"][0]["q"], {"f": 7, "a": 6})
        self.assertEqual(m["cal"]["certeza"], {"f": 4, "a": 3})

    def test_estudado_e_revisoes(self):
        base = edital([topico("a", st="estudado", em="2026-11-01", revs=[{"due": "2026-11-02", "feita": False}])])
        pc = edital([topico("a", st="estudado", em="2026-11-01", revs=[{"due": "2026-11-02", "feita": True, "em": "2026-11-02"}])])
        cel = edital([topico("a", st="estudado", em="2026-11-01", revs=[{"due": "2026-11-02", "feita": False}, {"due": "2026-11-05", "feita": False}])])
        revs = mesclar_edital(base, cel, pc)["materias"][0]["topicos"][0]["revs"]
        self.assertEqual([(r["due"], r["feita"]) for r in revs], [("2026-11-02", True), ("2026-11-05", False)])

    def test_topicos_diferentes_nos_dois_lados(self):
        base = edital([topico("a"), topico("b")])
        pc = edital([topico("a", st="estudado", em="2026-11-09"), topico("b")])
        cel = edital([topico("a"), topico("b", st="estudado", em="2026-11-08")])
        ts = mesclar_edital(base, cel, pc)["materias"][0]["topicos"]
        self.assertEqual([t["st"] for t in ts], ["estudado", "estudado"])

    def test_erros_novos_e_apagados(self):
        e1, e2, e3 = {"id": "1", "x": 1}, {"id": "2", "x": 2}, {"id": "3", "x": 3}
        base = edital([topico("a")], erros=[e1, e2])
        pc = edital([topico("a")], erros=[e3, e1, e2])          # PC errou uma nova
        cel = edital([topico("a")], erros=[e1])                  # celular removeu a 2
        erros = mesclar_edital(base, cel, pc)["erros"]
        self.assertEqual([x["id"] for x in erros], ["3", "1"])

    def test_atividade_por_dia_soma(self):
        base = edital([topico("a")], ativ={"2026-11-09": 2})
        pc = edital([topico("a")], ativ={"2026-11-09": 5})
        cel = edital([topico("a")], ativ={"2026-11-09": 4, "2026-11-08": 1})
        self.assertEqual(mesclar_edital(base, cel, pc)["ativ"], {"2026-11-09": 7, "2026-11-08": 1})

    def test_sem_base(self):
        pc = edital([topico("a", st="estudado", em="2026-11-01")])
        cel = edital([topico("a")], seEntao="Se acordar, então estudo")
        m = mesclar_edital(None, cel, pc)
        self.assertEqual(m["materias"][0]["topicos"][0]["st"], "estudado")
        self.assertEqual(m["seEntao"], "Se acordar, então estudo")


if __name__ == "__main__":
    unittest.main()
