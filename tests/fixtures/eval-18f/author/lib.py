"""Shared helpers for the eval-18f author scripts (deterministic, stdlib only)."""
import datetime
import unicodedata

MISSING = object()  # key is left out of the record


# ---------- dealing values with exact counts ----------
def deal(rng, n, counts, fill=None):
    """Shuffled list of length n with exact counts; the rest is `fill`."""
    out = []
    for v, c in counts:
        out += [v] * c
    assert len(out) <= n, (counts, n)
    out += [fill] * (n - len(out))
    rng.shuffle(out)
    return out


def opt(flag, value):
    """flag None -> null, MISSING -> missing, anything else -> value."""
    if flag is None or flag is MISSING:
        return flag
    return value


# ---------- names ----------
NAMES = {
    "en": (["Emily", "James", "Olivia", "Noah", "Grace", "Ethan", "Chloe", "Ryan", "Hannah", "Owen",
            "Megan", "Caleb", "Abigail", "Logan", "Natalie", "Dylan", "Lauren", "Tyler", "Brooke", "Aaron"],
           ["Carter", "Hughes", "Bennett", "Foster", "Griffin", "Hayes", "Morris", "Palmer", "Reed", "Sutton",
            "Walsh", "Barker", "Collins", "Doyle", "Ellis", "Fisher", "Gibson", "Harper", "Lowe", "Marsh"]),
    "de": (["Lena", "Jonas", "Mia", "Felix", "Hannah", "Lukas", "Sophie", "Paul", "Clara", "Moritz",
            "Johanna", "Tobias", "Emilia", "Simon", "Lea", "Florian", "Marie", "Jan", "Katrin", "Stefan"],
           ["Becker", "Hoffmann", "Schulz", "Koch", "Richter", "Wolf", "Neumann", "Schwarz", "Zimmermann", "Braun",
            "Krüger", "Hartmann", "Lange", "Werner", "Krause", "Meier", "Lehmann", "Huber", "Kaiser", "Fuchs"]),
    "fr": (["Camille", "Hugo", "Manon", "Lucas", "Chloé", "Théo", "Inès", "Julien", "Léa", "Antoine",
            "Sarah", "Mathis", "Pauline", "Nicolas", "Elise", "Baptiste", "Margaux", "Quentin", "Juliette", "Rémi"],
           ["Bernard", "Dubois", "Lefèvre", "Moreau", "Laurent", "Girard", "Roux", "Fournier", "Mercier", "Blanc",
            "Garnier", "Faure", "Chevalier", "Robin", "Masson", "Perrin", "Morel", "Gauthier", "Marchand", "Dupuis"]),
    "es": (["Lucía", "Mateo", "Carmen", "Diego", "Elena", "Álvaro", "Marta", "Sergio", "Paula", "Jorge",
            "Irene", "Rubén", "Nuria", "Adrián", "Sara", "Íñigo", "Clara", "Raúl", "Alba", "Hugo"],
           ["García", "Fernández", "Ruiz", "Navarro", "Moreno", "Jiménez", "Castro", "Ortiz", "Serrano", "Molina",
            "Delgado", "Vidal", "Ramos", "Gil", "Herrero", "Prieto", "Cabrera", "Soler", "Vega", "Iglesias"]),
    "it": (["Giulia", "Marco", "Chiara", "Luca", "Francesca", "Matteo", "Sara", "Davide", "Elisa", "Andrea",
            "Martina", "Simone", "Alessia", "Riccardo", "Federica", "Lorenzo", "Silvia", "Paolo", "Irene", "Tommaso"],
           ["Bianchi", "Colombo", "Ferrari", "Esposito", "Ricci", "Marino", "Greco", "Bruno", "Gallo", "Conti",
            "Costa", "Fontana", "Rizzo", "Lombardi", "Moretti", "Barbieri", "Galli", "Mancini", "Leone", "Longo"]),
    "nl": (["Sanne", "Daan", "Lotte", "Bram", "Femke", "Ruben", "Eva", "Thijs", "Iris", "Joris",
            "Anouk", "Sem", "Floor", "Niels", "Maartje", "Koen", "Lieke", "Wouter", "Esther", "Gijs"],
           ["de Vries", "Jansen", "Bakker", "Visser", "Smit", "Meijer", "Mulder", "de Boer", "Bos", "Vos",
            "Peters", "Hendriks", "van Dijk", "Dekker", "Brouwer", "de Graaf", "Kok", "Verhoeven", "Prins", "Willems"]),
    "pt": (["Inês", "João", "Beatriz", "Tiago", "Mariana", "Rui", "Catarina", "Pedro", "Joana", "Miguel",
            "Rita", "Diogo", "Sofia", "Nuno", "Leonor", "André", "Marta", "Gonçalo", "Ana", "Bruno"],
           ["Silva", "Santos", "Ferreira", "Pereira", "Oliveira", "Costa", "Rodrigues", "Martins", "Sousa", "Gomes",
            "Lopes", "Marques", "Almeida", "Ribeiro", "Pinto", "Carvalho", "Teixeira", "Moreira", "Correia", "Mendes"]),
    "pl": (["Anna", "Piotr", "Katarzyna", "Tomasz", "Magdalena", "Paweł", "Agnieszka", "Michał", "Joanna", "Krzysztof",
            "Monika", "Łukasz", "Ewa", "Marcin", "Zofia", "Jakub", "Natalia", "Adam", "Aleksandra", "Wojciech"],
           ["Nowak", "Kowalski", "Wiśniewski", "Wójcik", "Kamiński", "Lewandowski", "Zieliński", "Szymański", "Woźniak", "Dąbrowski",
            "Kozłowski", "Jankowski", "Mazur", "Kwiatkowski", "Krawczyk", "Piotrowski", "Grabowski", "Pawłowski", "Michalski", "Król"]),
    "sv": (["Elsa", "Oskar", "Maja", "Erik", "Ebba", "Axel", "Wilma", "Anton", "Frida", "Gustav",
            "Ida", "Viktor", "Linnea", "Johan", "Klara", "Nils", "Saga", "Henrik", "Tove", "Måns"],
           ["Andersson", "Johansson", "Karlsson", "Nilsson", "Eriksson", "Larsson", "Olsson", "Persson", "Svensson", "Gustafsson",
            "Lindberg", "Lindqvist", "Berg", "Holm", "Sandberg", "Ekström", "Åberg", "Lundgren", "Forsberg", "Hedlund"]),
    "da": (["Freja", "Mads", "Ida", "Rasmus", "Sofie", "Kasper", "Emma", "Mikkel", "Laura", "Søren",
            "Anne", "Jesper", "Cecilie", "Anders", "Mette", "Frederik", "Line", "Henrik", "Signe", "Jonas"],
           ["Nielsen", "Jensen", "Hansen", "Pedersen", "Andersen", "Christensen", "Larsen", "Sørensen", "Rasmussen", "Jørgensen",
            "Petersen", "Madsen", "Kristensen", "Olsen", "Thomsen", "Poulsen", "Johansen", "Møller", "Mortensen", "Knudsen"]),
}


def people(rng, lang, n):
    """n distinct (first, last) pairs."""
    firsts, lasts = NAMES[lang]
    combos = [(f, l) for f in firsts for l in lasts]
    return rng.sample(combos, n)


def ascii_slug(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return "".join(ch for ch in s.lower() if ch.isalnum())


def mail(local_parts, domain, sep="."):
    return sep.join(ascii_slug(p) for p in local_parts) + "@" + domain


def mixcase(email):
    local, dom = email.split("@")
    return ".".join(p[:1].upper() + p[1:] for p in local.split(".")) + "@" + ".".join(
        p[:1].upper() + p[1:] for p in dom.split("."))


def upper(email):
    return email.upper()


PADS = [" {}", "{} ", "  {} ", " {}  ", "{}   "]


def pad(rng, s):
    return rng.choice(PADS).format(s)


# ---------- dates ----------
def rdate(rng, start, end, amb=False):
    """Random date between ISO strings start and end. amb=True keeps day <= 12."""
    a = datetime.date.fromisoformat(start).toordinal()
    b = datetime.date.fromisoformat(end).toordinal()
    while True:
        d = datetime.date.fromordinal(rng.randint(a, b))
        if not amb or d.day <= 12:
            return d


def fmt(d, f, rng=None):
    if f == "DD/MM/YYYY":
        return d.strftime("%d/%m/%Y")
    if f == "MM/DD/YYYY":
        return d.strftime("%m/%d/%Y")
    if f == "DD.MM.YYYY":
        return d.strftime("%d.%m.%Y")
    if f == "DD-MM-YYYY":
        return d.strftime("%d-%m-%Y")
    if f == "YYYY-MM-DD":
        return d.isoformat()
    if f == "ISO-8601":
        h, m = (rng.randint(6, 20), rng.randint(0, 59)) if rng else (9, 0)
        return f"{d.isoformat()}T{h:02d}:{m:02d}:00Z"
    raise ValueError(f)


# ---------- destination schema helpers ----------
def P(typ, desc=None, enum=None, fmt_=None):
    p = {"type": typ}
    if fmt_:
        p["format"] = fmt_
    if enum:
        p["enum"] = enum
    if desc is not None:
        p["description"] = desc
    return p


def OBJ(props, required=None, desc=None):
    o = {"type": "object"}
    if desc is not None:
        o["description"] = desc
    o["properties"] = props
    if required:
        o["required"] = required
    return o


def schema(props, required):
    return {"$schema": "https://json-schema.org/draft/2020-12/schema", "type": "object",
            "properties": props, "required": required}


# ---------- ground-truth application (author side) ----------
def get(rec, path):
    cur = rec
    for k in path.split("."):
        if not isinstance(cur, dict) or k not in cur:
            return MISSING
        cur = cur[k]
    return cur


def parse_date(v, f):
    v = v.strip()
    if f == "ISO-8601" or f == "YYYY-MM-DD":
        return v[:10]
    if f in ("DD/MM/YYYY", "DD.MM.YYYY", "DD-MM-YYYY"):
        d, m, y = v[0:2], v[3:5], v[6:10]
    elif f == "MM/DD/YYYY":
        m, d, y = v[0:2], v[3:5], v[6:10]
    else:
        raise ValueError(f)
    return datetime.date(int(y), int(m), int(d)).isoformat()


def required_paths(dest):
    req = set()
    for k in dest.get("required", []):
        p = dest["properties"][k]
        if p.get("type") == "object":
            for c in p.get("required", []):
                req.add(f"{k}.{c}")
        else:
            req.add(k)
    return req


def apply(rec, dest, gt):
    """Returns ('held', None) or ('transformed', output)."""
    req = required_paths(dest)
    out = {}
    for path, g in gt.items():
        t = g["transform"]
        if t == "none":
            val = MISSING
        elif t == "concat":
            parts = [get(rec, s) for s in g["sources"]]
            val = MISSING if any(p is MISSING or p is None for p in parts) else g["separator"].join(parts)
        else:
            v = get(rec, g["source"])
            if v is MISSING or v is None:
                val = MISSING
            elif t == "copy":
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
                    return "held", None
            else:
                raise ValueError(t)
        if val is MISSING:
            if path in req:
                return "held", None
            continue
        parts = path.split(".")
        tgt = out
        for k in parts[:-1]:
            tgt = tgt.setdefault(k, {})
        tgt[parts[-1]] = val
    # destination property order
    ordered = {}
    for k, p in dest["properties"].items():
        if k in out:
            if p.get("type") == "object":
                ordered[k] = {c: out[k][c] for c in p["properties"] if c in out[k]}
            else:
                ordered[k] = out[k]
    return "transformed", ordered


def shuffle_keys(rng, obj):
    if not isinstance(obj, dict):
        return obj
    items = [(k, shuffle_keys(rng, v)) for k, v in obj.items() if v is not MISSING]
    rng.shuffle(items)
    return dict(items)
