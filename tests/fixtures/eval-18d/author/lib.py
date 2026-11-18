"""Author library for eval-18d: builds scenario files from hand-written specs.

Deterministic (seeded random.Random per scenario), standard library only, no network.
Ground truth comes from the hand-written specs; expected outputs apply that ground truth.
"""
import datetime as dt
import random
import re
import unicodedata

POOLS = {
    "en": (
        "Olivia Liam Emma Noah Ava Ethan Mia Lucas Grace Owen Chloe Henry Ruby Isaac Hannah Leo Zoe Caleb Nora Felix".split(),
        "Carter Brooks Hayes Morgan Bennett Foster Reed Sullivan Price Hughes Ward Fletcher Doyle Barnes Holt Pearce Quinn Marsh Lowe Sutton".split(),
    ),
    "de": (
        "Lukas Anna Jonas Lea Felix Marie Paul Sophie Maximilian Lena Tobias Clara Jan Johanna Niklas Katharina Moritz Greta Simon Theresa".split(),
        "Müller Schneider Fischer Weber Wagner Becker Hoffmann Schäfer Koch Richter Klein Wolf Schröder Neumann Braun Zimmermann Hartmann Krüger Lange Vogel".split(),
    ),
    "fr": (
        "Camille Louis Chloé Hugo Manon Arthur Léa Jules Inès Gabriel Sarah Théo Juliette Nathan Elise Raphaël Margaux Antoine Pauline Mathis".split(),
        "Martin Bernard Dubois Thomas Robert Richard Petit Durand Leroy Moreau Simon Laurent Lefèvre Michel Garcia Fournier Girard Bonnet Rousseau Faure".split(),
    ),
    "es": (
        "Lucía Mateo Sofía Hugo Martina Daniel Paula Alejandro Valeria Pablo Carmen Diego Elena Javier Irene Sergio Alba Andrés Marta Raúl".split(),
        "García Fernández González Rodríguez López Martínez Sánchez Pérez Gómez Martín Jiménez Ruiz Hernández Díaz Moreno Muñoz Álvarez Romero Navarro Torres".split(),
    ),
    "nl": (
        "Daan Emma Sem Julia Lucas Tess Milan Sophie Thijs Fleur Bram Lotte Jesse Sanne Ruben Noor Stijn Eva Lars Anouk".split(),
        ["de Vries", "Jansen", "van Dijk", "Bakker", "Visser", "Smit", "Meijer", "de Boer", "Mulder", "de Groot",
         "Bos", "Vos", "Peters", "Hendriks", "van Leeuwen", "Dekker", "Brouwer", "de Wit", "Dijkstra", "Kok"],
    ),
    "pt": (
        "João Beatriz Pedro Mariana Tiago Inês Rafael Carolina Diogo Ana Gonçalo Leonor Rodrigo Sofia Miguel Matilde André Camila Lucas Larissa".split(),
        "Silva Santos Ferreira Pereira Oliveira Costa Rodrigues Martins Sousa Fernandes Gonçalves Gomes Lopes Marques Alves Almeida Ribeiro Pinto Carvalho Teixeira".split(),
    ),
    "it": (
        "Giulia Lorenzo Sofia Matteo Aurora Leonardo Alice Francesco Ginevra Tommaso Chiara Riccardo Martina Edoardo Beatrice Davide Elena Federico Sara Pietro".split(),
        ["Rossi", "Russo", "Ferrari", "Esposito", "Bianchi", "Romano", "Colombo", "Ricci", "Marino", "Greco",
         "Bruno", "Gallo", "Conti", "De Luca", "Mancini", "Costa", "Giordano", "Rizzo", "Lombardi", "Moretti"],
    ),
}
POOLS["mixed"] = (POOLS["en"][0][:10] + POOLS["de"][0][:10], POOLS["en"][1][:10] + POOLS["de"][1][:10])


def slug(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "", s.lower())


class F:
    """Source field: dotted path, generator kind, 18A concept label, options."""

    def __init__(self, path, kind, concept, **o):
        self.path, self.kind, self.concept, self.o = path, kind, concept, o


class D:
    """Destination leaf: dotted path, JSON type, description (None = no description), concept, options."""

    def __init__(self, path, typ, desc, concept, req=False, **o):
        self.path, self.typ, self.desc, self.concept, self.req, self.o = path, typ, desc, concept, req, o


def fmt_date(d, fmt, rng):
    if fmt == "DD/MM/YYYY":
        return f"{d.day:02d}/{d.month:02d}/{d.year}"
    if fmt == "MM/DD/YYYY":
        return f"{d.month:02d}/{d.day:02d}/{d.year}"
    if fmt == "YYYY-MM-DD":
        return d.isoformat()
    if fmt == "ISO-8601":
        return f"{d.isoformat()}T{rng.randint(7, 19):02d}:{rng.choice([0, 5, 12, 20, 34, 41, 55]):02d}:00Z"
    if fmt == "DD.MM.YYYY":
        return f"{d.day:02d}.{d.month:02d}.{d.year}"
    if fmt == "YYYYMMDD":
        return d.strftime("%Y%m%d")
    raise ValueError(fmt)


def cat_assign(labels, n, rng, weights=None):
    assert 2 * len(labels) <= n and len(labels) <= 10
    vals = [lab for lab in labels for _ in range(2)]
    w = weights or [max(1, len(labels) - i) for i in range(len(labels))]
    vals += rng.choices(labels, weights=w, k=n - len(vals))
    rng.shuffle(vals)
    return vals


def title_email(e):
    local, dom = e.split("@")
    return ".".join(p[:1].upper() + p[1:] for p in local.split(".")) + "@" + ".".join(p.capitalize() for p in dom.split("."))


def gen_column(f, n, personas, rng, spec):
    k, o = f.kind, f.o
    if k == "cat":
        return cat_assign(o["labels"], n, rng, o.get("weights"))
    out = []
    used = set()
    for i in range(n):
        p = personas[i]
        if k == "seq":
            v = o.get("start", 1) + i * o.get("step", 1) + (rng.randint(0, o["step"] - 1) if o.get("step", 1) > 1 and o.get("gaps", True) else 0)
            v = v if o.get("int") else o["fmt"].format(v)
        elif k == "rand":
            while True:
                v = rng.randint(o["lo"], o["hi"])
                if v not in used:
                    used.add(v)
                    break
            v = v if o.get("int") else o["fmt"].format(v)
        elif k == "given":
            v = p["given"]
        elif k == "family":
            v = p["family"]
        elif k == "family2":
            v = p["family2"]
        elif k == "full":
            v = f"{p['given']} {p['family']}"
        elif k == "full_upper_rev":
            v = f"{p['family'].upper()} {p['given'].upper()}"
        elif k == "email":
            style = o.get("style", "dot")
            if style == "dot":
                local = f"{slug(p['given'])}.{slug(p['family'])}"
            elif style == "init":
                local = f"{slug(p['given'])[0]}{slug(p['family'])}"
            elif style == "role":
                local = f"{o['role']}.{slug(p['family'])}{i % 7}"
            else:
                raise ValueError(style)
            v = f"{local}@{o['domain']}"
        elif k == "phone":
            v = "".join(str(rng.randint(0, 9)) if ch == "#" else ch for ch in o["tpl"])
        elif k in ("pick", "company"):
            v = rng.choice(o["vals"])
        elif k == "date":
            lo, hi = dt.date.fromisoformat(o["lo"]), dt.date.fromisoformat(o["hi"])
            d = lo + dt.timedelta(days=rng.randint(0, (hi - lo).days))
            if "/" in o["fmt"] and spec.get("ambiguous"):
                d = d.replace(day=rng.randint(1, 12))
            out.append(d)
            continue
        elif k == "int":
            v = rng.randint(o["lo"], o["hi"])
        elif k == "num":
            v = round(rng.uniform(o["lo"], o["hi"]), o.get("dec", 2))
        else:
            raise ValueError(k)
        out.append(v)
    if k == "date":
        if "/" in o["fmt"] and not spec.get("ambiguous"):
            # every non-ambiguous slash column carries day values above 12
            for j in (1, 4):
                out[j] = out[j].replace(day=rng.randint(13, 28))
        out = [fmt_date(d, o["fmt"], rng) for d in out]
    return out


def setpath(rec, path, val):
    parts = path.split(".")
    cur = rec
    for p in parts[:-1]:
        cur = cur.setdefault(p, {})
    cur[parts[-1]] = val


def getpath(rec, path):
    cur = rec
    for p in path.split("."):
        if not isinstance(cur, dict) or p not in cur:
            return False, None
        cur = cur[p]
    return True, cur


def shuffled(obj, rng):
    if not isinstance(obj, dict):
        return obj
    keys = list(obj)
    rng.shuffle(keys)
    return {k: shuffled(obj[k], rng) for k in keys}


def build_records(spec, rng):
    n = spec["n"]
    given, family = POOLS[spec["names"]]
    combos = rng.sample([(g, f) for g in given for f in family], n)
    personas = [{"given": g, "family": f, "family2": rng.choice([x for x in family if x != f])} for g, f in combos]
    cols, absent = {}, {}
    for f in spec["src"]:
        vals = gen_column(f, n, personas, rng, spec)
        if f.o.get("pad"):
            for i in rng.sample(range(n), max(2, n // 6)):
                if isinstance(vals[i], str):
                    vals[i] = rng.choice(["  {}", "{} ", " {}  ", "{}   "]).format(vals[i])
        if f.o.get("mixed"):
            for i in rng.sample(range(n), max(2, n // 5)):
                vals[i] = title_email(vals[i])
        cols[f.path] = vals
        kn, km = f.o.get("null", 0), f.o.get("missing", 0)
        while True:
            idx = rng.sample(range(n), kn + km)
            # absent values must not push any category label below two occurrences
            left = [v for i, v in enumerate(vals) if i not in idx]
            if f.kind != "cat" or all(left.count(lab) >= 2 for lab in f.o["labels"]):
                break
        absent[f.path] = {i: "null" for i in idx[:kn]} | {i: "missing" for i in idx[kn:]}
    recs = []
    for i in range(n):
        r = {}
        for f in spec["src"]:
            a = absent[f.path].get(i)
            if a == "missing":
                continue
            setpath(r, f.path, None if a == "null" else cols[f.path][i])
        recs.append(shuffled(r, rng))
    return recs


def parse_date(v, fmt):
    if fmt == "DD/MM/YYYY":
        d, m, y = v.split("/")
    elif fmt == "MM/DD/YYYY":
        m, d, y = v.split("/")
    elif fmt in ("YYYY-MM-DD", "ISO-8601"):
        y, m, d = v[:10].split("-")
    else:
        raise ValueError(fmt)
    return dt.date(int(y), int(m), int(d)).isoformat()


def ground_truth(spec):
    srcmap = {f.path: f for f in spec["src"]}
    gt = {}
    for d in spec["dst"]:
        o = d.o
        if o.get("srcs"):
            for s in o["srcs"]:
                sf = srcmap[s]
                assert not sf.o.get("pad") and not sf.o.get("null") and not sf.o.get("missing"), s
            g = {"source": None, "sources": o["srcs"], "transform": "concat", "separator": o.get("sep", " ")}
        elif o.get("src") is None:
            g = {"source": None, "transform": "none"}
        else:
            sf = srcmap[o["src"]]
            g = {"source": o["src"]}
            if "cmap" in o:
                assert sf.kind == "cat" and set(o["cmap"]) == set(sf.o["labels"]), (d.path, o["src"])
                assert all(v is None or v in o["enum"] for v in o["cmap"].values()), d.path
                g |= {"transform": "map_enum", "categoryMap": o["cmap"]}
            elif o.get("fmt") == "date":
                g |= {"transform": "parse_date", "dateFormat": sf.o["fmt"]}
            elif sf.o.get("mixed"):
                g["transform"] = "normalize_email"
            elif sf.o.get("pad"):
                g["transform"] = "trim"
            else:
                g["transform"] = "copy"
        g["why"] = o["why"]
        if o.get("unsup"):
            g["unsupportedReason"] = o["unsup"]
        gt[d.path] = g
    return gt


def destination(spec):
    props, required = {}, []
    nest_desc = spec.get("nest_desc", {})
    for d in spec["dst"]:
        leaf = {"type": d.typ}
        if d.o.get("title"):
            leaf["title"] = d.o["title"]
        if d.o.get("fmt"):
            leaf["format"] = d.o["fmt"]
        if d.o.get("enum"):
            leaf["enum"] = d.o["enum"]
        if d.desc is not None:
            leaf["description"] = d.desc
        parts = d.path.split(".")
        if len(parts) == 1:
            props[parts[0]] = leaf
            if d.req:
                required.append(parts[0])
        else:
            obj = props.setdefault(parts[0], {"type": "object", **({"description": nest_desc[parts[0]]} if parts[0] in nest_desc else {}), "properties": {}, "required": []})
            obj["properties"][parts[1]] = leaf
            if d.req:
                obj["required"].append(parts[1])
                if parts[0] not in required:
                    required.append(parts[0])
    return {"$schema": "https://json-schema.org/draft/2020-12/schema", "type": "object", "properties": props, "required": required}


def expected(rec, spec, gt):
    held, out = False, {}
    for d in spec["dst"]:
        g = gt[d.path]
        t = g["transform"]
        if t == "none":
            continue
        if t == "concat":
            val = g["separator"].join(getpath(rec, s)[1] for s in g["sources"])
        else:
            present, v = getpath(rec, g["source"])
            if not present or v is None:
                held = held or d.req
                continue
            if t == "copy":
                val = v
            elif t == "trim":
                val = v.strip()
            elif t == "normalize_email":
                val = v.strip().lower()
            elif t == "parse_date":
                val = parse_date(v, g["dateFormat"])
            elif t == "map_enum":
                val = g["categoryMap"][v]
                if val is None:
                    held = True
                    continue
        setpath(out, d.path, val)
    return ("held", None) if held else ("transformed", out)


def choose_samples(recs, spec, gt):
    results = [expected(r, spec, gt) for r in recs]
    held = [i for i, (o, _) in enumerate(results) if o == "held"]
    trans = [i for i, (o, _) in enumerate(results) if o == "transformed"]
    # prefer one held record of each cause, then transformed records with absent optional values
    picks = []
    label_held = [i for i in held if any(
        gt[d.path]["transform"] == "map_enum" and getpath(recs[i], gt[d.path]["source"])[1] in gt[d.path]["categoryMap"]
        and gt[d.path]["categoryMap"][getpath(recs[i], gt[d.path]["source"])[1]] is None for d in spec["dst"])]
    other_held = [i for i in held if i not in label_held]
    for grp in (label_held, other_held):
        if grp:
            picks.append(grp[0])
    opt_paths = [gt[d.path]["source"] for d in spec["dst"] if not d.req and gt[d.path].get("source")]

    def absent_kind(i):
        kinds = set()
        for p in opt_paths:
            present, v = getpath(recs[i], p)
            kinds.add("missing" if not present else "null" if v is None else "present")
        return kinds
    for want in ("null", "missing"):
        for i in trans:
            if want in absent_kind(i) and i not in picks:
                picks.append(i)
                break
    for i in trans:
        if len(picks) >= 4:
            break
        if i not in picks:
            picks.append(i)
    picks = sorted(picks[:4])
    assert len(picks) == 4 and any(results[i][0] == "transformed" for i in picks)
    samples = []
    for i in picks:
        o, out = results[i]
        s = {"recordIndex": i, "outcome": o}
        if out is not None:
            s["output"] = out
        samples.append(s)
    return samples


def build(spec):
    rng = random.Random(spec["seed"])
    recs = build_records(spec, rng)
    gt = ground_truth(spec)
    dest = destination(spec)
    completable = all(gt[d.path]["transform"] != "none" for d in spec["dst"] if d.req)
    assert completable == spec.get("completable", True), spec["id"]
    pairs = [{"kind": k, "fields": list(fs), "correctFor": c} for k, fs, c in spec["pairs"]]
    if not completable:
        assert any(p["kind"] == "decoy-for-missing-field" for p in pairs), spec["id"]
    out = {
        "scenarioId": spec["id"], "split": spec["split"], "track": spec["track"], "industry": spec["industry"],
        "sourceLanguage": spec["lang"], "description": spec["desc"], "fictional": True, "completable": completable,
        "records": recs, "destination": dest, "groundTruth": gt, "confusablePairs": pairs,
        "sourceConcepts": {f.path: f.concept for f in spec["src"]},
        "destinationConcepts": {d.path: d.concept for d in spec["dst"]},
    }
    if completable:
        out["expectedSamples"] = choose_samples(recs, spec, gt)
    return out
