"""
Mesclagem a três vias do edital (S.ed) entre aparelhos.

Cada aparelho guarda a última versão que recebeu do PC (a "base"). Ao enviar
sua versão ("local"), o servidor compara com a versão atual do PC ("remoto"):
o que só um lado mudou é mantido; o que os dois mudaram é combinado conforme o
significado do campo (contadores somam, listas com id se unem, um tópico
estudado continua estudado, revisões feitas continuam feitas).

Só biblioteca padrão.
"""
import copy

_AUSENTE = object()
# Campos que são contadores: os dois lados podem ter somado questões.
_CONTADORES_PAI = {"q", "qc", "certeza", "duvida", "chute"}
# Listas cujos itens têm "id" estável.
_LISTAS_COM_ID = {"materias", "topicos", "erros"}


def _soma(base, local, remoto):
    def n(x):
        return x if isinstance(x, (int, float)) and not isinstance(x, bool) else 0
    return n(remoto) + n(local) - n(base)


def _escalar(chave, base, local, remoto):
    """Os dois lados mudaram o mesmo valor simples."""
    if chave == "st":  # status do tópico: estudado vence
        return "estudado" if "estudado" in (local, remoto) else local
    if chave in ("feita", "dom", "qcPulado"):
        return bool(local) or bool(remoto)
    if chave in ("em", "domEm", "ult"):  # datas AAAA-MM-DD: a mais recente
        datas = [x for x in (local, remoto) if isinstance(x, str)]
        return max(datas) if datas else local
    return local  # quem está salvando agora fez a ação mais recente


def _por_id(caminho, base, local, remoto):
    b = {x.get("id"): x for x in base if isinstance(x, dict)}
    l_ = {x.get("id"): x for x in local if isinstance(x, dict)}
    out, vistos = [], set()
    for r in remoto:
        i = r.get("id") if isinstance(r, dict) else None
        vistos.add(i)
        if i in l_:
            out.append(mesclar(b.get(i, _AUSENTE), l_[i], r, caminho + (i,)))
        elif i in b and b[i] == r:
            continue  # apagado aqui, intocado lá
        else:
            out.append(r)
    novos = []
    for x in local:
        i = x.get("id") if isinstance(x, dict) else None
        if i in vistos:
            continue
        if i in b:
            if x == b[i]:
                continue  # apagado lá, intocado aqui
        novos.append(x)
    # erros novos entram no topo (o app usa unshift); o resto vai ao fim
    return novos + out if caminho and caminho[-1] == "erros" else out + novos


def _revisoes(base, local, remoto):
    """Revisões agendadas: união por data; feita em qualquer lado conta."""
    chave = lambda r: (r.get("due"), bool(r.get("reforco")))
    b = {chave(r) for r in base if isinstance(r, dict)}
    l_ = {chave(r): r for r in local if isinstance(r, dict)}
    r_ = {chave(r): r for r in remoto if isinstance(r, dict)}
    out = []
    for k in sorted(set(l_) | set(r_), key=lambda k: (k[0] or "", k[1])):
        if k in l_ and k in r_:
            x = dict(r_[k])
            x["feita"] = bool(l_[k].get("feita")) or bool(r_[k].get("feita"))
            ems = [e for e in (l_[k].get("em"), r_[k].get("em")) if e]
            if ems:
                x["em"] = max(ems)
            out.append(x)
        elif k in b:
            continue  # existia na base e um lado removeu (reagendamento)
        else:
            out.append(l_.get(k) or r_.get(k))
    return out


def _sessoes(base, local, remoto):
    """Sessões do QConcursos: as que cada lado acrescentou."""
    resto = list(base)
    novas = []
    for x in local:
        if x in resto:
            resto.remove(x)
        else:
            novas.append(x)
    return list(remoto) + novas


def mesclar(base, local, remoto, caminho=()):
    if local == remoto:
        return copy.deepcopy(local)
    if base is not _AUSENTE and local == base:
        return copy.deepcopy(remoto)
    if base is not _AUSENTE and remoto == base:
        return copy.deepcopy(local)
    if base is _AUSENTE or base is None:
        base = {} if isinstance(local, dict) and isinstance(remoto, dict) else [] if isinstance(local, list) and isinstance(remoto, list) else None

    chave = caminho[-1] if caminho else None
    pai = caminho[-2] if len(caminho) > 1 else None

    if isinstance(local, dict) and isinstance(remoto, dict):
        base = base if isinstance(base, dict) else {}
        out = {}
        for k in list(remoto.keys()) + [k for k in local if k not in remoto]:
            b, l_, r = base.get(k, _AUSENTE), local.get(k, _AUSENTE), remoto.get(k, _AUSENTE)
            if l_ is _AUSENTE:
                if b is not _AUSENTE and b == r:
                    continue  # apagado aqui
                out[k] = copy.deepcopy(r)
            elif r is _AUSENTE:
                if b is not _AUSENTE and b == l_:
                    continue  # apagado lá
                out[k] = copy.deepcopy(l_)
            elif chave == "ativ":  # questões por dia: contador
                out[k] = _soma(None if b is _AUSENTE else b, l_, r)
            elif k in ("f", "a") and chave in _CONTADORES_PAI:
                out[k] = _soma(None if b is _AUSENTE else b, l_, r)
            else:
                out[k] = mesclar(b, l_, r, caminho + (k,))
        return out

    if isinstance(local, list) and isinstance(remoto, list):
        base = base if isinstance(base, list) else []
        if chave in _LISTAS_COM_ID:
            res = _por_id(caminho, base, local, remoto)
            return res[:400] if chave == "erros" else res
        if chave == "revs":
            return _revisoes(base, local, remoto)
        if chave == "s" and pai == "qc":
            return _sessoes(base, local, remoto)[-60:]
        return copy.deepcopy(local)

    return _escalar(chave, base, local, remoto)


def mesclar_edital(base, local, remoto):
    """Ponto de entrada: base pode ser None (aparelho nunca sincronizou)."""
    return mesclar(_AUSENTE if base is None else base, local, remoto)
