"""eval-18f holdout, track general: unfamiliar non-CRM domains. SEALED."""
from lib import (MISSING, deal, opt, people, mail, mixcase, upper, pad, rdate, fmt,
                 P, OBJ, schema)
from specs_holdout_wedge import em, companies

SC = []


# ---------------------------------------------------------------- G1 en, museum loans, 3-segment
def gen_g1(rng, n):
    st = deal(rng, n, [("Agreement sent", 6), ("In transit", 5), ("On display", 7), ("Returned", 4), ("Withdrawn", 3)], "Agreed")
    cov = deal(rng, n, [("Commercial policy", 10), ("Lender's own", 6)], "Government Indemnity")
    ins = deal(rng, n, [(None, 4), (MISSING, 3)], 1)
    hgt = deal(rng, n, [(None, 3)], 1)
    tp = deal(rng, n, [(1, 7)], 0)
    ec = deal(rng, n, [("mix", 9), ("up", 2)], "lo")
    lenders = [("Northgate City Art Gallery", "northgate-gallery.example.org"), ("Fenwick Hall Trust", "fenwickhall.example.org"),
               ("Museum of the Western Isles", "westernisles-museum.example.org"), ("Ashby Private Collection", "ashby-collection.example.net"),
               ("Royal Borough Archive", "rb-archive.example.org")]
    titles = companies(rng, n, ["Portrait of", "Study of", "View of", "Sketch of", "Still Life with"],
                       ["a Fisherman", "the Harbour at Dusk", "Two Pears", "a Young Woman", "the Old Mill", "Winter Fields", "a Merchant", "Lilies"])
    reg = ["Harriet Lomax", "Colin Ferris", "Priya Natarajan"]
    contacts = people(rng, "en", 5)
    recs = []
    for i in range(n):
        li = rng.randrange(len(lenders))
        cf, cl = contacts[li]
        start = rdate(rng, "2025-01-01", "2026-09-30")
        end = rdate(rng, "2026-10-01", "2027-12-31")
        price = round(rng.choice([1200, 4500, 9800, 15000, 22000, 60000]) * 1.0, 2)
        recs.append({
            "export_row": i + 1, "loan_ref": f"LN-{rng.choice([24, 25])}-{117 + i * 3:04d}",
            "object": {"accession_no": f"{rng.randint(1950, 2015)}.{rng.randint(1, 400)}.{rng.randint(1, 9)}",
                       "title": pad(rng, titles[i]) if tp[i] else titles[i],
                       "dimensions": {"height_cm": opt(hgt[i], round(rng.uniform(20, 180), 1)), "width_cm": round(rng.uniform(15, 220), 1)}},
            "lender": {"institution": lenders[li][0], "contact_name": f"{cf} {cl}",
                       "contact_email": em(rng, ec[i], mail([cf, cl], lenders[li][1]))},
            "registrar": rng.choice(reg), "loan_status": st[i],
            "insurance_value_gbp": opt(ins[i], float(rng.choice([25000, 40000, 85000, 120000, 250000, 600000]))),
            "acquisition_price_gbp": price, "indemnity_cover": cov[i], "courier_required": rng.choice(["Yes", "No"]),
            "loan_start": fmt(start, "DD/MM/YYYY"), "loan_end": fmt(end, "DD/MM/YYYY"),
            "condition_checked": fmt(rdate(rng, "2024-06-01", "2025-12-31"), "ISO-8601", rng),
        })
    return recs


SC.append(dict(
    id="museum-object-loans-to-exhibition-loan-tracker", track="general", lang="en", n=32,
    industry="museum inward object loans",
    desc="Inward loan export of a fictional regional museum registrar (UK snake_case, nested object with nested dimensions and lender) to be loaded into an exhibition loan tracker.",
    completable=True, gen=gen_g1,
    dest=schema({
        "loan_id": P("string", "Identifier of the loan agreement."),
        "object_number": P("string", "Lender's catalogue number of the borrowed object."),
        "object_title": P("string", "Title of the borrowed object."),
        "lender": P("string", "Institution or collection lending the object."),
        "status": P("string", "Stage the loan has reached.", enum=["requested", "confirmed", "on_site", "returned"]),
        "cover_type": P("string", "How the object is insured while on loan.", enum=["indemnity", "commercial", "lender"]),
        "insured_value": P("number", "Value."),
        "start_date": P("string", "First day of the loan period.", fmt_="date"),
        "end_date": P("string", "Last day of the loan period.", fmt_="date"),
        "height_cm": P("number", "Height of the object in centimetres."),
        "loan_days": P("integer", "Length of the loan period in days."),
        "gallery": P("string"),
    }, ["loan_id", "object_number", "object_title", "lender", "status", "cover_type", "start_date"]),
    gt={
        "loan_id": {"source": "loan_ref", "transform": "copy", "why": "loan reference; export_row is the row counter"},
        "object_number": {"source": "object.accession_no", "transform": "copy", "why": "lender's accession number"},
        "object_title": {"source": "object.title", "transform": "trim", "why": "object title, padded"},
        "lender": {"source": "lender.institution", "transform": "copy", "why": "lending institution; lender.contact_name is a person there and registrar is staff"},
        "status": {"source": "loan_status", "transform": "map_enum", "categoryMap": {"Agreement sent": "requested", "Agreed": "confirmed", "In transit": "confirmed", "On display": "on_site", "Returned": "returned", "Withdrawn": None}, "why": "loan stage; withdrawn loans need review"},
        "cover_type": {"source": "indemnity_cover", "transform": "map_enum", "categoryMap": {"Government Indemnity": "indemnity", "Commercial policy": "commercial", "Lender's own": "lender"}, "why": "insurance cover; courier_required is a different yes/no category"},
        "insured_value": {"source": "insurance_value_gbp", "transform": "copy", "why": "insurance value, null or missing for some; acquisition_price_gbp is what the lender paid"},
        "start_date": {"source": "loan_start", "transform": "parse_date", "dateFormat": "DD/MM/YYYY", "why": "loan start (UK day-first); condition_checked is the last condition report"},
        "end_date": {"source": "loan_end", "transform": "parse_date", "dateFormat": "DD/MM/YYYY", "why": "loan end (UK day-first)"},
        "height_cm": {"source": "object.dimensions.height_cm", "transform": "copy", "why": "height; width_cm is the width"},
        "loan_days": {"source": None, "transform": "none", "why": "not exported", "unsupportedReason": "would need the number of days between loan_start and loan_end"},
        "gallery": {"source": None, "transform": "none", "why": "no gallery is exported"},
    },
    pairs=[
        {"kind": "customer-id-vs-transaction-id", "fields": ["loan_ref", "export_row"], "correctFor": "loan_id"},
        {"kind": "customer-id-vs-transaction-id", "fields": ["loan_ref", "object.accession_no"], "correctFor": "loan_id"},
        {"kind": "nested-entity-relationship", "fields": ["lender.institution", "lender.contact_name"], "correctFor": "lender"},
        {"kind": "competing-category-fields", "fields": ["indemnity_cover", "courier_required"], "correctFor": "cover_type"},
        {"kind": "modified-date-vs-created-date", "fields": ["loan_start", "condition_checked"], "correctFor": "start_date"},
        {"kind": "nested-entity-relationship", "fields": ["object.dimensions.height_cm", "object.dimensions.width_cm"], "correctFor": "height_cm"},
    ],
    sc={"export_row": "other-identifier", "loan_ref": "transaction-id", "object.accession_no": "other-identifier",
        "object.title": "other", "object.dimensions.height_cm": "quantity", "object.dimensions.width_cm": "quantity",
        "lender.institution": "organization-name", "lender.contact_name": "person-name", "lender.contact_email": "email",
        "registrar": "person-name", "loan_status": "account-status", "insurance_value_gbp": "amount",
        "acquisition_price_gbp": "amount", "indemnity_cover": "category", "courier_required": "category",
        "loan_start": "start-date", "loan_end": "end-date", "condition_checked": "other"},
    dc={"loan_id": "transaction-id", "object_number": "other-identifier", "object_title": "other", "lender": "organization-name",
        "status": "account-status", "cover_type": "category", "insured_value": "amount", "start_date": "start-date",
        "end_date": "end-date", "height_cm": "quantity", "loan_days": "quantity", "gallery": "other"},
))


# ---------------------------------------------------------------- G2 en (US), student transport, flat
def gen_g2(rng, n):
    kids = people(rng, "en", n)
    guards = people(rng, "en", n)
    emerg = people(rng, "en", n)
    grade = deal(rng, n, [("KG", 4), ("01", 4), ("02", 4), ("03", 4), ("04", 4), ("05", 4), ("06", 4), ("07", 3)], "08")
    ts = deal(rng, n, [("Eligible - Special Ed Van", 5), ("Walker", 5), ("Parent Pickup", 4), ("Pending Verification", 3)], "Eligible - Bus")
    meal = deal(rng, n, [("Reduced", 8), ("Paid", 12)], "Free")
    gp = deal(rng, n, [(None, 4), (MISSING, 3)], 1)
    ec = deal(rng, n, [("mix", 10), ("up", 2), ("pad", 3)], "lo")
    drv = ["Earl Watkins", "Rhonda Pike", "Manny Delgado"]
    recs = []
    for i in range(n):
        f, l = kids[i]
        gf, _ = guards[i]
        ef, el = emerg[i]
        g = grade[i]
        sch = "Cedar Ridge Middle" if g in ("06", "07", "08") else ("Maple Grove Elementary" if i % 2 else "Riverview Elementary")
        recs.append({
            "studentId": f"S-{208800 + i * 11 + rng.randint(0, 9)}", "stateId": f"{rng.randint(1000000000, 9999999999)}", "rowNum": i + 1,
            "firstName": f, "lastName": l, "grade": g,
            "guardian1Name": f"{gf} {l}", "guardian1Phone": opt(gp[i], f"({rng.randint(201, 989)}) 555-{rng.randint(100, 199):04d}"),
            "guardian1Email": em(rng, ec[i], mail([gf, l], "family.example.com")),
            "emergencyContact": f"{ef} {el}", "emergencyPhone": f"({rng.randint(201, 989)}) 555-{rng.randint(100, 199):04d}",
            "school": sch, "transportStatus": ts[i], "mealStatus": meal[i],
            "enrollDate": fmt(rdate(rng, "2019-08-01", "2026-09-30"), "MM/DD/YYYY"),
            "dob": fmt(rdate(rng, "2011-09-01", "2021-08-31"), "MM/DD/YYYY"),
            "busDriver": rng.choice(drv), "iepFlag": rng.choice(["Y", "N", "N"]),
        })
    return recs


SC.append(dict(
    id="student-transport-roster-to-bus-routing", track="general", lang="en", n=36,
    industry="school district student transportation",
    desc="Flat student transportation roster of a fictional US school district (camelCase) to be loaded into a bus routing system.",
    completable=True, gen=gen_g2,
    dest=schema({
        "student_id": P("string", "District identifier of the student."),
        "rider_name": P("string", "Student's name as printed on driver lists, family name first and separated from the given name by a comma."),
        "grade_band": P("string", "School level of the student, which decides the bus run.", enum=["elementary", "middle"]),
        "school_code": P("string", "School.", enum=["MGE", "RVE", "CRMS"]),
        "rider_status": P("string", "How the student travels to school.", enum=["bus", "van", "not_riding"]),
        "guardian_phone": P("string", "Phone number of the student's primary guardian."),
        "guardian_email": P("string", "Email address of the student's primary guardian.", fmt_="email"),
        "enrolled_on": P("string", "Date the student enrolled in the district.", fmt_="date"),
        "stop_id": P("string"),
        "age_years": P("integer", "Age of the student in whole years."),
    }, ["student_id", "rider_name", "grade_band", "school_code", "rider_status"]),
    gt={
        "student_id": {"source": "studentId", "transform": "copy", "why": "district student id; stateId is the state id and rowNum the row"},
        "rider_name": {"source": None, "sources": ["lastName", "firstName"], "transform": "concat", "separator": ", ", "why": "family name then given name; guardian1Name, emergencyContact and busDriver are other people"},
        "grade_band": {"source": "grade", "transform": "map_enum", "categoryMap": {"KG": "elementary", "01": "elementary", "02": "elementary", "03": "elementary", "04": "elementary", "05": "elementary", "06": "middle", "07": "middle", "08": "middle"}, "why": "grade level"},
        "school_code": {"source": "school", "transform": "map_enum", "categoryMap": {"Maple Grove Elementary": "MGE", "Riverview Elementary": "RVE", "Cedar Ridge Middle": "CRMS"}, "why": "school"},
        "rider_status": {"source": "transportStatus", "transform": "map_enum", "categoryMap": {"Eligible - Bus": "bus", "Eligible - Special Ed Van": "van", "Walker": "not_riding", "Parent Pickup": "not_riding", "Pending Verification": None}, "why": "transport eligibility; pending rows need review; mealStatus is meal eligibility"},
        "guardian_phone": {"source": "guardian1Phone", "transform": "copy", "why": "primary guardian phone, null or missing for some; emergencyPhone is the emergency contact"},
        "guardian_email": {"source": "guardian1Email", "transform": "normalize_email", "why": "guardian email, mixed case and padded"},
        "enrolled_on": {"source": "enrollDate", "transform": "parse_date", "dateFormat": "MM/DD/YYYY", "why": "enrollment (US month-first); dob is the birth date"},
        "stop_id": {"source": None, "transform": "none", "why": "no stop is exported"},
        "age_years": {"source": None, "transform": "none", "why": "not exported", "unsupportedReason": "would need the age computed from dob"},
    },
    pairs=[
        {"kind": "customer-id-vs-transaction-id", "fields": ["studentId", "stateId"], "correctFor": "student_id"},
        {"kind": "customer-id-vs-transaction-id", "fields": ["studentId", "rowNum"], "correctFor": "student_id"},
        {"kind": "nested-entity-relationship", "fields": ["guardian1Phone", "emergencyPhone"], "correctFor": "guardian_phone"},
        {"kind": "nested-entity-relationship", "fields": ["firstName", "busDriver"], "correctFor": "rider_name"},
        {"kind": "competing-category-fields", "fields": ["transportStatus", "mealStatus"], "correctFor": "rider_status"},
        {"kind": "birth-date-vs-start-date", "fields": ["enrollDate", "dob"], "correctFor": "enrolled_on"},
    ],
    sc={"studentId": "customer-id", "stateId": "other-identifier", "rowNum": "other-identifier", "firstName": "given-name",
        "lastName": "family-name", "grade": "category", "guardian1Name": "person-name", "guardian1Phone": "phone",
        "guardian1Email": "email", "emergencyContact": "person-name", "emergencyPhone": "phone", "school": "category",
        "transportStatus": "account-status", "mealStatus": "payment-status", "enrollDate": "start-date", "dob": "birth-date",
        "busDriver": "person-name", "iepFlag": "category"},
    dc={"student_id": "customer-id", "rider_name": "person-name", "grade_band": "category", "school_code": "category",
        "rider_status": "account-status", "guardian_phone": "phone", "guardian_email": "email", "enrolled_on": "start-date",
        "stop_id": "other-identifier", "age_years": "quantity"},
))


# ---------------------------------------------------------------- G3 de, beekeeping, ambiguous dates
def gen_g3(rng, n):
    keepers = people(rng, "de", 6)
    kmail = [em(rng, c, mail([f, l], "imkerei.example.net")) for (f, l), c in zip(keepers, ["mix", "lo", "up", "mix", "lo", "mix"])]
    rasse = deal(rng, n, [("Buckfast", 9), ("Dunkle Biene", 5), ("Mischling", 5)], "Carnica")
    stk = deal(rng, n, [("mittel", 10), ("schwach", 6), ("weisellos", 3)], "stark")
    beh = deal(rng, n, [("Oxalsäure", 9), ("keine", 8), (None, 3), (MISSING, 2)], "Ameisensäure")
    var = deal(rng, n, [(None, 4), (MISSING, 3)], 1)
    spd = deal(rng, n, [(1, 6)], 0)
    kon = ["Walter Brenner", "Gisela Hahn", "Uwe Stamm"]
    recs = []
    for i in range(n):
        k = rng.randrange(len(keepers))
        f, l = keepers[k]
        brutto = round(rng.uniform(4, 38), 1)
        recs.append({
            "volkNr": f"V-{400 + i * 2 + rng.randint(0, 1):04d}", "standNr": pad(rng, f"ST-{k + 2:02d}") if spd[i] else f"ST-{k + 2:02d}", "zeile": i + 1,
            "kontrollId": rng.randint(70000, 79999),
            "imker": {"vorname": f, "nachname": l, "email": kmail[k]},
            "kontrolleur": rng.choice(kon), "bienenrasse": rasse[i], "volksstaerke": stk[i],
            "sanftmut": rng.choice(["1", "2", "3", "4"]),
            "varroaBefall": opt(var[i], rng.choice([0.5, 1.0, 2.0, 3.5, 5.0, 8.0, 12.0])),
            "honigertrag": {"brutto_kg": brutto, "netto_kg": round(brutto * 0.82, 1)},
            "kontrolldatum": fmt(rdate(rng, "2026-04-01", "2026-09-30", amb=True), "DD/MM/YYYY"),
            "naechsteKontrolle": fmt(rdate(rng, "2026-10-01", "2027-05-31", amb=True), "DD/MM/YYYY"),
            "koenigin": {"jahrgang": rng.choice([2022, 2023, 2024, 2025, 2026]), "markierung": rng.choice(["weiß", "gelb", "rot", "grün", "blau"])},
            "behandlung": beh[i],
        })
    return recs


SC.append(dict(
    id="beekeeping-colony-inspections-to-hive-registry", track="general", lang="de", n=34,
    industry="beekeepers' association colony inspections",
    desc="Colony inspection export of a fictional regional beekeepers' association (German camelCase, nested keeper, honey yield and queen) to be loaded into a hive registry.",
    completable=True, gen=gen_g3,
    dest=schema({
        "colony_id": P("string", "Identifier of the bee colony."),
        "apiary_code": P("string", "Code of the apiary site where the colony stands."),
        "keeper_name": P("string", "Full name of the beekeeper who owns the colony, given name first."),
        "keeper_email": P("string", "Email address of the beekeeper.", fmt_="email"),
        "breed": P("string", "Honey bee breed of the colony.", enum=["carnica", "buckfast", "mellifera", "mixed"]),
        "strength": P("string", "Strength.", enum=["strong", "medium", "weak"]),
        "treatment": P("string", "Mite treatment applied at the inspection.", enum=["formic_acid", "oxalic_acid", "none"]),
        "varroa_mites_per_day": P("number", "Natural mite drop counted per day."),
        "honey_net_kg": P("number", "Honey harvested from the colony in kilograms, without frames and containers."),
        "inspected_on": P("string", "Date the colony was inspected.", fmt_="date"),
        "queen_age_years": P("integer", "Age of the queen in years at the inspection."),
        "hive_weight_kg": P("number"),
    }, ["colony_id", "apiary_code", "keeper_name", "breed", "strength", "inspected_on"]),
    gt={
        "colony_id": {"source": "volkNr", "transform": "copy", "why": "colony number; kontrollId is the inspection and zeile the row"},
        "apiary_code": {"source": "standNr", "transform": "trim", "why": "apiary site, padded in some rows"},
        "keeper_name": {"source": None, "sources": ["imker.vorname", "imker.nachname"], "transform": "concat", "separator": " ", "why": "owner; kontrolleur is the inspector"},
        "keeper_email": {"source": "imker.email", "transform": "normalize_email", "why": "keeper email, mixed case"},
        "breed": {"source": "bienenrasse", "transform": "map_enum", "categoryMap": {"Carnica": "carnica", "Buckfast": "buckfast", "Dunkle Biene": "mellifera", "Mischling": "mixed"}, "why": "breed"},
        "strength": {"source": "volksstaerke", "transform": "map_enum", "categoryMap": {"stark": "strong", "mittel": "medium", "schwach": "weak", "weisellos": None}, "why": "colony strength; queenless colonies need review; sanftmut is temper"},
        "treatment": {"source": "behandlung", "transform": "map_enum", "categoryMap": {"Ameisensäure": "formic_acid", "Oxalsäure": "oxalic_acid", "keine": "none"}, "why": "treatment, null or missing for some"},
        "varroa_mites_per_day": {"source": "varroaBefall", "transform": "copy", "why": "mite drop, null or missing for some"},
        "honey_net_kg": {"source": "honigertrag.netto_kg", "transform": "copy", "why": "net honey; brutto_kg includes frames"},
        "inspected_on": {"source": "kontrolldatum", "transform": "parse_date", "dateFormat": "DD/MM/YYYY", "why": "inspection date (German day-first); naechsteKontrolle is the next one"},
        "queen_age_years": {"source": None, "transform": "none", "why": "only the queen's year is exported", "unsupportedReason": "would need the inspection year minus koenigin.jahrgang"},
        "hive_weight_kg": {"source": None, "transform": "none", "why": "not exported"},
    },
    pairs=[
        {"kind": "customer-id-vs-transaction-id", "fields": ["volkNr", "kontrollId"], "correctFor": "colony_id"},
        {"kind": "customer-id-vs-transaction-id", "fields": ["volkNr", "zeile"], "correctFor": "colony_id"},
        {"kind": "nested-entity-relationship", "fields": ["imker.vorname", "kontrolleur"], "correctFor": "keeper_name"},
        {"kind": "competing-category-fields", "fields": ["volksstaerke", "sanftmut"], "correctFor": "strength"},
        {"kind": "nested-entity-relationship", "fields": ["honigertrag.netto_kg", "honigertrag.brutto_kg"], "correctFor": "honey_net_kg"},
        {"kind": "modified-date-vs-created-date", "fields": ["kontrolldatum", "naechsteKontrolle"], "correctFor": "inspected_on"},
    ],
    sc={"volkNr": "customer-id", "standNr": "other-identifier", "zeile": "other-identifier", "kontrollId": "transaction-id",
        "imker.vorname": "given-name", "imker.nachname": "family-name", "imker.email": "email", "kontrolleur": "person-name",
        "bienenrasse": "category", "volksstaerke": "account-status", "sanftmut": "category", "varroaBefall": "quantity",
        "honigertrag.brutto_kg": "quantity", "honigertrag.netto_kg": "quantity", "kontrolldatum": "start-date",
        "naechsteKontrolle": "other", "koenigin.jahrgang": "other", "koenigin.markierung": "category", "behandlung": "category"},
    dc={"colony_id": "customer-id", "apiary_code": "other-identifier", "keeper_name": "person-name", "keeper_email": "email",
        "breed": "category", "strength": "account-status", "treatment": "category", "varroa_mites_per_day": "quantity",
        "honey_net_kg": "quantity", "inspected_on": "start-date", "queen_age_years": "quantity", "hive_weight_kg": "quantity"},
))


# ---------------------------------------------------------------- G4 fr, festival volunteers, flat, ambiguous dates
def gen_g4(rng, n):
    vols = people(rng, "fr", 24)
    vol_id = [f"BEN-{100 + k * 3}" for k in range(24)]
    vmail = [mail([f, l], "benevoles.example.org") for f, l in vols]
    vtel = deal(rng, 24, [(None, 3), (MISSING, 3)], 1)
    vtel = [opt(t, f"06 {rng.randint(10, 99)} {rng.randint(10, 99)} {rng.randint(10, 99)} {rng.randint(10, 99)}") for t in vtel]
    urg = people(rng, "fr", 24)
    who = [k for k in range(24)] + [rng.randrange(24) for _ in range(n - 24)]
    rng.shuffle(who)
    poste = deal(rng, n, [("Accueil public", 8), ("Bar", 8), ("Montage scène", 6), ("Navettes", 5)], "Billetterie")
    st = deal(rng, n, [("À confirmer", 8), ("Annulé", 4), ("Doublon", 3)], "Confirmé")
    conv = deal(rng, n, [("Non signée", 9)], "Signée")
    ec = deal(rng, n, [("mix", 9), ("up", 2), ("pad", 3)], "lo")
    resp = ["Gaëlle Moulin", "Thibault Renard", "Agathe Lemoine"]
    starts = ["09:00", "10:00", "14:00", "17:30", "19:00", "22:00"]
    recs = []
    for i in range(n):
        v = who[i]
        f, l = vols[v]
        uf, ul = urg[v]
        h = rng.choice(starts)
        recs.append({
            "idCreneau": f"CR-2026-{300 + i * 2:04d}", "idBenevole": vol_id[v], "numLigne": i + 1,
            "prenom": f, "nom": l, "courriel": em(rng, ec[i], vmail[v]), "telPortable": vtel[v],
            "contactUrgenceNom": f"{uf} {ul}", "contactUrgenceTel": f"07 {rng.randint(10, 99)} {rng.randint(10, 99)} {rng.randint(10, 99)} {rng.randint(10, 99)}",
            "responsablePoste": rng.choice(resp), "poste": poste[i], "statutCreneau": st[i], "statutConvention": conv[i],
            "dateCreneau": fmt(rdate(rng, "2026-07-01", "2026-07-12", amb=True), "DD/MM/YYYY"),
            "heureDebut": h, "heureFin": f"{(int(h[:2]) + rng.choice([3, 4])) % 24:02d}:{h[3:]}",
            "dateInscription": fmt(rdate(rng, "2026-01-01", "2026-06-12", amb=True), "DD/MM/YYYY"),
            "tailleTshirt": rng.choice(["S", "M", "L", "XL"]), "repas": rng.choice(["Oui", "Non"]),
        })
    return recs


SC.append(dict(
    id="theatre-festival-volunteer-shifts-to-shift-scheduler", track="general", lang="fr", n=38,
    industry="summer theatre festival volunteer shifts",
    desc="Flat volunteer-shift export of a fictional summer theatre festival (French camelCase) to be loaded into a shift scheduling tool.",
    completable=True, gen=gen_g4,
    dest=schema({
        "shift_id": P("string", "Identifier of the shift."),
        "volunteer_id": P("string", "Identifier of the volunteer who works the shift."),
        "volunteer_name": P("string", "Full name of the volunteer, given name first."),
        "email": P("string", "Email address of the volunteer for shift reminders.", fmt_="email"),
        "phone": P("string", "Mobile number of the volunteer."),
        "role": P("string", "Post the volunteer staffs during the shift.", enum=["ticketing", "front_of_house", "bar", "stage_crew", "transport"]),
        "status": P("string", "Status.", enum=["confirmed", "tentative", "cancelled"]),
        "shift_date": P("string", "Day of the shift.", fmt_="date"),
        "start_time": P("string", "Time the shift begins, in local time."),
        "duration_hours": P("number", "Length of the shift in hours."),
        "venue": P("string"),
    }, ["shift_id", "volunteer_id", "volunteer_name", "role", "status", "shift_date", "start_time"]),
    gt={
        "shift_id": {"source": "idCreneau", "transform": "copy", "why": "shift id; numLigne is the row"},
        "volunteer_id": {"source": "idBenevole", "transform": "copy", "why": "volunteer id"},
        "volunteer_name": {"source": None, "sources": ["prenom", "nom"], "transform": "concat", "separator": " ", "why": "volunteer; contactUrgenceNom is the emergency contact and responsablePoste the shift lead"},
        "email": {"source": "courriel", "transform": "normalize_email", "why": "volunteer email, mixed case and padded"},
        "phone": {"source": "telPortable", "transform": "copy", "why": "volunteer mobile, null or missing for some; contactUrgenceTel is the emergency contact"},
        "role": {"source": "poste", "transform": "map_enum", "categoryMap": {"Billetterie": "ticketing", "Accueil public": "front_of_house", "Bar": "bar", "Montage scène": "stage_crew", "Navettes": "transport"}, "why": "post"},
        "status": {"source": "statutCreneau", "transform": "map_enum", "categoryMap": {"Confirmé": "confirmed", "À confirmer": "tentative", "Annulé": "cancelled", "Doublon": None}, "why": "shift state; duplicates need review; statutConvention is the volunteer agreement"},
        "shift_date": {"source": "dateCreneau", "transform": "parse_date", "dateFormat": "DD/MM/YYYY", "why": "shift day (French day-first); dateInscription is the sign-up day"},
        "start_time": {"source": "heureDebut", "transform": "copy", "why": "start time; heureFin is the end"},
        "duration_hours": {"source": None, "transform": "none", "why": "not exported", "unsupportedReason": "would need the difference between heureFin and heureDebut"},
        "venue": {"source": None, "transform": "none", "why": "no venue is exported"},
    },
    pairs=[
        {"kind": "customer-id-vs-transaction-id", "fields": ["idCreneau", "numLigne"], "correctFor": "shift_id"},
        {"kind": "customer-id-vs-transaction-id", "fields": ["idBenevole", "idCreneau"], "correctFor": "volunteer_id"},
        {"kind": "nested-entity-relationship", "fields": ["telPortable", "contactUrgenceTel"], "correctFor": "phone"},
        {"kind": "nested-entity-relationship", "fields": ["prenom", "responsablePoste"], "correctFor": "volunteer_name"},
        {"kind": "competing-category-fields", "fields": ["statutCreneau", "statutConvention"], "correctFor": "status"},
        {"kind": "modified-date-vs-created-date", "fields": ["dateCreneau", "dateInscription"], "correctFor": "shift_date"},
    ],
    sc={"idCreneau": "transaction-id", "idBenevole": "customer-id", "numLigne": "other-identifier", "prenom": "given-name",
        "nom": "family-name", "courriel": "email", "telPortable": "phone", "contactUrgenceNom": "person-name",
        "contactUrgenceTel": "phone", "responsablePoste": "person-name", "poste": "category", "statutCreneau": "account-status",
        "statutConvention": "consent-flag", "dateCreneau": "start-date", "heureDebut": "other", "heureFin": "other",
        "dateInscription": "created-date", "tailleTshirt": "category", "repas": "category"},
    dc={"shift_id": "transaction-id", "volunteer_id": "customer-id", "volunteer_name": "person-name", "email": "email",
        "phone": "phone", "role": "category", "status": "account-status", "shift_date": "start-date", "start_time": "other",
        "duration_hours": "quantity", "venue": "other"},
))


# ---------------------------------------------------------------- G5 es, calibration lab, NOT completable (next due date unsupported)
def gen_g5(rng, n):
    clients = [("Conservas del Cantábrico S.A.", "conservas.example.com"), ("Talleres Ibarra S.L.", "talleres-ibarra.example.com"),
               ("Hospital Veterinario Norte", "hvnorte.example.org"), ("Laboratorios Galena S.L.", "galena.example.com"),
               ("Plásticos Urdaneta S.A.", "urdaneta.example.net")]
    cc = people(rng, "es", len(clients))
    tipo = deal(rng, n, [("Balanza", 9), ("Termómetro", 8), ("Pie de rey", 6)], "Manómetro")
    res = deal(rng, n, [("Apto con ajuste", 7), ("No apto", 4), ("Pendiente de revisión", 3)], "Apto")
    fac = deal(rng, n, [("Pendiente", 10)], "Pagada")
    acr = deal(rng, n, [("No acreditada", 9)], "Acreditada")
    ser = deal(rng, n, [(None, 3), (MISSING, 3)], 1)
    cp = deal(rng, n, [(1, 6)], 0)
    ec = deal(rng, n, [("mix", 8), ("up", 2)], "lo")
    tec = ["Ignacio Beltrán", "Rocío Salas", "Óscar Mendizábal"]
    fab = ["Precisa Ibérica", "Metrolab Sur", "Termotec", "Balanzas Duero"]
    unc = {"Manómetro": "±0,05 bar", "Balanza": "±0,2 g", "Termómetro": "±0,1 °C", "Pie de rey": "±0,02 mm"}
    recs = []
    for i in range(n):
        c = rng.randrange(len(clients))
        f, l = cc[c]
        cal = rdate(rng, "2025-09-01", "2026-10-31")
        recs.append({
            "numCertificado": f"CC-{cal.year % 100}-{800 + i * 3:04d}", "fila": i + 1,
            "equipo": {"numSerie": opt(ser[i], f"SN{rng.randint(100000, 999999)}"), "codigoActivo": f"ACT-{3000 + rng.randint(0, 999)}",
                       "tipo": tipo[i], "fabricante": rng.choice(fab)},
            "cliente": {"razonSocial": pad(rng, clients[c][0]) if cp[i] else clients[c][0], "contacto": f"{f} {l}",
                        "email": em(rng, ec[i], mail([f, l], clients[c][1]))},
            "tecnico": rng.choice(tec), "resultado": res[i], "estadoFactura": fac[i],
            "fechaCalibracion": fmt(cal, "DD/MM/YYYY"),
            "fechaEmision": fmt(rdate(rng, cal.isoformat(), "2026-11-15"), "DD/MM/YYYY"),
            "intervaloMeses": rng.choice([6, 12, 12, 24]), "incertidumbre": unc[tipo[i]], "acreditacion": acr[i],
        })
    return recs


SC.append(dict(
    id="calibration-lab-certificates-to-asset-register", track="general", lang="es", n=29,
    industry="instrument calibration laboratory certificates",
    desc="Calibration certificate export of a fictional instrument calibration laboratory (Spanish camelCase, nested instrument and client) to be loaded into a customer's asset register; the next due date is not exported.",
    completable=False, gen=gen_g5,
    dest=schema({
        "asset_tag": P("string", "Owner's asset tag on the instrument."),
        "certificate_number": P("string", "Number of the calibration certificate."),
        "serial_number": P("string", "Manufacturer's serial number of the instrument."),
        "instrument_type": P("string", "Kind of measuring instrument.", enum=["pressure_gauge", "scale", "thermometer", "caliper"]),
        "owner_company": P("string", "Company that owns the instrument."),
        "owner_email": P("string", "Email address of the owner's contact for calibration matters.", fmt_="email"),
        "result": P("string", "Result.", enum=["pass", "pass_adjusted", "fail"]),
        "calibrated_on": P("string", "Date the instrument was calibrated.", fmt_="date"),
        "next_due_date": P("string", "Date by which the instrument must be calibrated again.", fmt_="date"),
        "location": P("string"),
    }, ["asset_tag", "certificate_number", "instrument_type", "result", "calibrated_on", "next_due_date"]),
    gt={
        "asset_tag": {"source": "equipo.codigoActivo", "transform": "copy", "why": "asset tag; fila is the row"},
        "certificate_number": {"source": "numCertificado", "transform": "copy", "why": "certificate number"},
        "serial_number": {"source": "equipo.numSerie", "transform": "copy", "why": "serial, null or missing for some"},
        "instrument_type": {"source": "equipo.tipo", "transform": "map_enum", "categoryMap": {"Manómetro": "pressure_gauge", "Balanza": "scale", "Termómetro": "thermometer", "Pie de rey": "caliper"}, "why": "instrument type"},
        "owner_company": {"source": "cliente.razonSocial", "transform": "trim", "why": "client company, padded; equipo.fabricante is the manufacturer"},
        "owner_email": {"source": "cliente.email", "transform": "normalize_email", "why": "client contact email, mixed case"},
        "result": {"source": "resultado", "transform": "map_enum", "categoryMap": {"Apto": "pass", "Apto con ajuste": "pass_adjusted", "No apto": "fail", "Pendiente de revisión": None}, "why": "calibration result; pending rows need review; estadoFactura is invoicing"},
        "calibrated_on": {"source": "fechaCalibracion", "transform": "parse_date", "dateFormat": "DD/MM/YYYY", "why": "calibration date (Spanish day-first); fechaEmision is when the certificate was issued"},
        "next_due_date": {"source": None, "transform": "none", "why": "not exported; fechaEmision is the issue date and fechaCalibracion the last calibration", "unsupportedReason": "would need fechaCalibracion plus intervaloMeses months"},
        "location": {"source": None, "transform": "none", "why": "no location is exported"},
    },
    pairs=[
        {"kind": "decoy-for-missing-field", "fields": ["fechaEmision", "fechaCalibracion"], "correctFor": "next_due_date"},
        {"kind": "customer-id-vs-transaction-id", "fields": ["equipo.codigoActivo", "equipo.numSerie"], "correctFor": "asset_tag"},
        {"kind": "customer-id-vs-transaction-id", "fields": ["equipo.codigoActivo", "fila"], "correctFor": "asset_tag"},
        {"kind": "nested-entity-relationship", "fields": ["cliente.razonSocial", "equipo.fabricante"], "correctFor": "owner_company"},
        {"kind": "competing-category-fields", "fields": ["resultado", "estadoFactura"], "correctFor": "result"},
        {"kind": "modified-date-vs-created-date", "fields": ["fechaCalibracion", "fechaEmision"], "correctFor": "calibrated_on"},
    ],
    sc={"numCertificado": "transaction-id", "fila": "other-identifier", "equipo.numSerie": "other-identifier",
        "equipo.codigoActivo": "customer-id", "equipo.tipo": "category", "equipo.fabricante": "organization-name",
        "cliente.razonSocial": "organization-name", "cliente.contacto": "person-name", "cliente.email": "email",
        "tecnico": "person-name", "resultado": "account-status", "estadoFactura": "payment-status",
        "fechaCalibracion": "start-date", "fechaEmision": "other", "intervaloMeses": "quantity", "incertidumbre": "other",
        "acreditacion": "category"},
    dc={"asset_tag": "customer-id", "certificate_number": "transaction-id", "serial_number": "other-identifier",
        "instrument_type": "category", "owner_company": "organization-name", "owner_email": "email", "result": "account-status",
        "calibrated_on": "start-date", "next_due_date": "end-date", "location": "other"},
))


# ---------------------------------------------------------------- G6 it, translation jobs, required word count null in some rows
def gen_g6(rng, n):
    cl = [("Studio Legale Ferri", "ferri-legale.example.com"), ("Macchine Agricole Zanetti S.p.A.", "zanetti.example.com"),
          ("Cantine Moro", "cantinemoro.example.org"), ("Ortopedia Lazzari S.r.l.", "lazzari.example.com"),
          ("Edizioni Arcobaleno", "arcobaleno.example.net"), ("Hotel Miramonti Group", "miramonti.example.com")]
    refs = people(rng, "it", len(cl))
    cp_ = deal(rng, n, [("EN>IT", 8), ("IT>DE", 6), ("DE>IT", 5), ("FR>IT", 4)], "IT>EN")
    tt = deal(rng, n, [("Tecnico", 9), ("Marketing", 6), ("Medico", 4), (None, 3), (MISSING, 3)], "Legale")
    srv = deal(rng, n, [("Traduzione + revisione", 10), ("Asseverazione", 5), ("Test interno", 3)], "Traduzione")
    pay = deal(rng, n, [("Acconto", 8), ("Da fatturare", 10)], "Saldato")
    wnull = deal(rng, n, [(None, 2)], 1)
    rp = deal(rng, n, [(1, 7)], 0)
    ec = deal(rng, n, [("mix", 8), ("up", 2)], "lo")
    pm = ["Valentina Sala", "Fabio Testa", "Nicoletta Riva"]
    trad = ["Anna Weber", "Claire Dumas", "Marco Pini", "Helen Burke"]
    recs = []
    for i in range(n):
        c = rng.randrange(len(cl))
        rf, rl = refs[c]
        words = rng.choice([450, 820, 1200, 2300, 3150, 5400, 9800])
        net = round(words * rng.choice([0.09, 0.11, 0.12, 0.14]) + rng.choice([0, 25, 40]), 2)
        od = rdate(rng, "2026-03-01", "2026-10-20")
        recs.append({
            "n_commessa": f"COM-26-{410 + i * 3:04d}", "n_preventivo": f"PRV-{rng.randint(1000, 1999)}", "riga": i + 1,
            "cliente": {"ragione_sociale": pad(rng, cl[c][0]) if rp[i] else cl[c][0], "referente": f"{rf} {rl}",
                        "email_referente": em(rng, ec[i], mail([rf, rl], cl[c][1]))},
            "project_manager": rng.choice(pm), "traduttore": rng.choice(trad),
            "coppia_lingue": cp_[i], "tipo_testo": tt[i], "servizio": srv[i], "stato_pagamento": pay[i],
            "n_parole": opt(wnull[i], words),
            "importi": {"imponibile": net, "totale_ivato": round(net * 1.22, 2)},
            "data_ordine": fmt(od, "DD/MM/YYYY"),
            "data_consegna": fmt(rdate(rng, od.isoformat(), "2026-12-20"), "DD/MM/YYYY"),
        })
    return recs


SC.append(dict(
    id="translation-agency-jobs-to-translation-management", track="general", lang="it", n=33,
    industry="translation agency jobs",
    desc="Job export of a fictional translation agency (Italian snake_case, nested client and amounts) to be loaded into a translation management system.",
    completable=True, gen=gen_g6,
    dest=schema({
        "jobId": P("string", "Identifier of the translation job."),
        "client": P("string", "Company that ordered the translation."),
        "languagePair": P("string", "Source and target language of the job.", enum=["it-en", "en-it", "it-de", "de-it", "fr-it"]),
        "subjectDomain": P("string", "Subject area of the text, used to pick a specialised translator.", enum=["legal", "technical", "marketing", "medical"]),
        "serviceLevel": P("string", "Service.", enum=["translation", "translation_review", "sworn"]),
        "wordCount": P("integer", "Number of source words to translate."),
        "netAmountEur": P("number", "Price of the job in euros, excluding VAT."),
        "dueDate": P("string", "Date the translation must be delivered to the client.", fmt_="date"),
        "pricePerWord": P("number", "Net price charged per source word."),
        "rushJob": P("boolean"),
    }, ["jobId", "client", "languagePair", "serviceLevel", "wordCount", "dueDate"]),
    gt={
        "jobId": {"source": "n_commessa", "transform": "copy", "why": "job number; n_preventivo is the quote and riga the row"},
        "client": {"source": "cliente.ragione_sociale", "transform": "trim", "why": "client company, padded; cliente.referente is a person there"},
        "languagePair": {"source": "coppia_lingue", "transform": "map_enum", "categoryMap": {"IT>EN": "it-en", "EN>IT": "en-it", "IT>DE": "it-de", "DE>IT": "de-it", "FR>IT": "fr-it"}, "why": "language pair"},
        "subjectDomain": {"source": "tipo_testo", "transform": "map_enum", "categoryMap": {"Legale": "legal", "Tecnico": "technical", "Marketing": "marketing", "Medico": "medical"}, "why": "text type, null or missing for some"},
        "serviceLevel": {"source": "servizio", "transform": "map_enum", "categoryMap": {"Traduzione": "translation", "Traduzione + revisione": "translation_review", "Asseverazione": "sworn", "Test interno": None}, "why": "service; internal tests need review; stato_pagamento is payment"},
        "wordCount": {"source": "n_parole", "transform": "copy", "why": "word count; null in a few rows, which are held"},
        "netAmountEur": {"source": "importi.imponibile", "transform": "copy", "why": "net amount; totale_ivato includes VAT"},
        "dueDate": {"source": "data_consegna", "transform": "parse_date", "dateFormat": "DD/MM/YYYY", "why": "delivery date (Italian day-first); data_ordine is the order date"},
        "pricePerWord": {"source": None, "transform": "none", "why": "not exported", "unsupportedReason": "would need importi.imponibile divided by n_parole"},
        "rushJob": {"source": None, "transform": "none", "why": "not exported"},
    },
    pairs=[
        {"kind": "customer-id-vs-transaction-id", "fields": ["n_commessa", "n_preventivo"], "correctFor": "jobId"},
        {"kind": "customer-id-vs-transaction-id", "fields": ["n_commessa", "riga"], "correctFor": "jobId"},
        {"kind": "nested-entity-relationship", "fields": ["cliente.ragione_sociale", "cliente.referente"], "correctFor": "client"},
        {"kind": "competing-category-fields", "fields": ["servizio", "tipo_testo"], "correctFor": "serviceLevel"},
        {"kind": "competing-category-fields", "fields": ["servizio", "stato_pagamento"], "correctFor": "serviceLevel"},
        {"kind": "nested-entity-relationship", "fields": ["importi.imponibile", "importi.totale_ivato"], "correctFor": "netAmountEur"},
        {"kind": "modified-date-vs-created-date", "fields": ["data_consegna", "data_ordine"], "correctFor": "dueDate"},
    ],
    sc={"n_commessa": "transaction-id", "n_preventivo": "other-identifier", "riga": "other-identifier",
        "cliente.ragione_sociale": "organization-name", "cliente.referente": "person-name", "cliente.email_referente": "email",
        "project_manager": "person-name", "traduttore": "person-name", "coppia_lingue": "language-code", "tipo_testo": "category",
        "servizio": "category", "stato_pagamento": "payment-status", "n_parole": "quantity", "importi.imponibile": "amount",
        "importi.totale_ivato": "amount", "data_ordine": "created-date", "data_consegna": "end-date"},
    dc={"jobId": "transaction-id", "client": "organization-name", "languagePair": "language-code", "subjectDomain": "category",
        "serviceLevel": "category", "wordCount": "quantity", "netAmountEur": "amount", "dueDate": "end-date",
        "pricePerWord": "amount", "rushJob": "other"},
))


# ---------------------------------------------------------------- G7 nl, crane rental, flat, ambiguous dates
def gen_g7(rng, n):
    kl = [("Bouwbedrijf Van der Heijden", "vdheijden.example.net"), ("Staalbouw Oosterwijk", "oosterwijk.example.com"),
          ("Gemeente Rivierstad", "rivierstad.example.org"), ("Dakwerken Brinkman", "brinkman-dak.example.com"),
          ("Windpark Polderwind", "polderwind.example.net"), ("Montagebedrijf Koster", "koster-montage.example.com")]
    cps = people(rng, "nl", len(kl))
    kt = deal(rng, n, [("Mobiele kraan 100t", 9), ("Torenkraan", 5), ("Verreiker", 6)], "Mobiele kraan 50t")
    os_ = deal(rng, n, [("Optie", 7), ("Geannuleerd", 4), ("Uitgevoerd", 7), ("Interne reservering", 3)], "Bevestigd")
    fs = deal(rng, n, [("Te factureren", 12)], "Gefactureerd")
    pc = deal(rng, n, [(None, 3), (MISSING, 3)], 1)
    up = deal(rng, n, [(None, 2)], 1)
    kp = deal(rng, n, [(1, 7)], 0)
    ec = deal(rng, n, [("mix", 9), ("up", 2)], "lo")
    mach = ["Henk Schouten", "Erwin Kuipers", "Dennis Bosman"]
    rate = {"Mobiele kraan 50t": 145.0, "Mobiele kraan 100t": 210.0, "Torenkraan": 175.0, "Verreiker": 85.0}
    plaats = ["Utrecht", "Nieuwegein", "Houten", "Zeist"]
    recs = []
    for i in range(n):
        c = rng.randrange(len(kl))
        f, l = cps[c]
        r = rate[kt[i]]
        recs.append({
            "OrderNr": f"KV-26-{1040 + i * 3}", "OfferteNr": f"OF-{rng.randint(5000, 5999)}", "Regel": i + 1,
            "Klant": pad(rng, kl[c][0]) if kp[i] else kl[c][0], "KlantContactpersoon": f"{f} {l}",
            "KlantEmail": em(rng, ec[i], mail([f[0], l], kl[c][1])),
            "Kraanmachinist": rng.choice(mach), "Kraantype": kt[i], "OrderStatus": os_[i], "FactuurStatus": fs[i],
            "Werkdatum": fmt(rdate(rng, "2026-01-01", "2026-12-12", amb=True), "DD/MM/YYYY"),
            "Aanvraagdatum": fmt(rdate(rng, "2025-10-01", "2026-10-12", amb=True), "DD/MM/YYYY"),
            "Starttijd": rng.choice(["06:30", "07:00", "07:30", "08:00", "13:00"]),
            "Uren": opt(up[i], rng.choice([4, 6, 8, 8, 10, 16])),
            "Postcode": opt(pc[i], f"{rng.randint(3400, 3999)} {rng.choice('ABCDEFGHJKLMNPRSTVWXZ')}{rng.choice('ABCDEFGHJKLMNPRSTVWXZ')}"),
            "Plaats": rng.choice(plaats), "TariefExclBtw": r, "TariefInclBtw": round(r * 1.21, 2),
        })
    return recs


SC.append(dict(
    id="crane-rental-jobs-to-dispatch-planner", track="general", lang="nl", n=37,
    industry="crane rental job orders",
    desc="Flat job-order export of a fictional crane rental company (Dutch PascalCase) to be loaded into a dispatch planner.",
    completable=True, gen=gen_g7,
    dest=schema({
        "job_number": P("string", "Order number of the crane job."),
        "customer": P("string", "Company that hires the crane."),
        "customer_email": P("string", "Email address of the customer's contact for this job.", fmt_="email"),
        "crane_class": P("string", "Type of crane the job needs.", enum=["mobile_50", "mobile_100", "tower", "telehandler"]),
        "status": P("string", "Status.", enum=["confirmed", "tentative", "cancelled", "completed"]),
        "work_date": P("string", "Day the crane works on site.", fmt_="date"),
        "start_time": P("string", "Time the crane must be ready on site."),
        "booked_hours": P("number", "Number of hours the crane is booked for."),
        "site_postcode": P("string", "Postcode of the work site."),
        "hourly_rate": P("number", "Hourly rate charged for the crane, excluding VAT."),
        "job_value": P("number", "Expected value of the job excluding VAT."),
        "operator_licence": P("string", "Licence."),
    }, ["job_number", "customer", "crane_class", "status", "work_date", "start_time"]),
    gt={
        "job_number": {"source": "OrderNr", "transform": "copy", "why": "order number; OfferteNr is the quote and Regel the row"},
        "customer": {"source": "Klant", "transform": "trim", "why": "customer, padded; KlantContactpersoon is a person and Kraanmachinist the operator"},
        "customer_email": {"source": "KlantEmail", "transform": "normalize_email", "why": "customer contact email, mixed case"},
        "crane_class": {"source": "Kraantype", "transform": "map_enum", "categoryMap": {"Mobiele kraan 50t": "mobile_50", "Mobiele kraan 100t": "mobile_100", "Torenkraan": "tower", "Verreiker": "telehandler"}, "why": "crane type"},
        "status": {"source": "OrderStatus", "transform": "map_enum", "categoryMap": {"Bevestigd": "confirmed", "Optie": "tentative", "Geannuleerd": "cancelled", "Uitgevoerd": "completed", "Interne reservering": None}, "why": "order state; internal reservations need review; FactuurStatus is invoicing"},
        "work_date": {"source": "Werkdatum", "transform": "parse_date", "dateFormat": "DD/MM/YYYY", "why": "work day (Dutch day-first); Aanvraagdatum is the request date"},
        "start_time": {"source": "Starttijd", "transform": "copy", "why": "start time"},
        "booked_hours": {"source": "Uren", "transform": "copy", "why": "booked hours, null in some"},
        "site_postcode": {"source": "Postcode", "transform": "copy", "why": "postcode, null or missing for some; Plaats is the town"},
        "hourly_rate": {"source": "TariefExclBtw", "transform": "copy", "why": "net rate; TariefInclBtw includes VAT"},
        "job_value": {"source": None, "transform": "none", "why": "not exported", "unsupportedReason": "would need Uren multiplied by TariefExclBtw"},
        "operator_licence": {"source": None, "transform": "none", "why": "not exported"},
    },
    pairs=[
        {"kind": "customer-id-vs-transaction-id", "fields": ["OrderNr", "OfferteNr"], "correctFor": "job_number"},
        {"kind": "customer-id-vs-transaction-id", "fields": ["OrderNr", "Regel"], "correctFor": "job_number"},
        {"kind": "nested-entity-relationship", "fields": ["Klant", "KlantContactpersoon"], "correctFor": "customer"},
        {"kind": "competing-category-fields", "fields": ["OrderStatus", "FactuurStatus"], "correctFor": "status"},
        {"kind": "modified-date-vs-created-date", "fields": ["Werkdatum", "Aanvraagdatum"], "correctFor": "work_date"},
        {"kind": "nested-entity-relationship", "fields": ["TariefExclBtw", "TariefInclBtw"], "correctFor": "hourly_rate"},
    ],
    sc={"OrderNr": "transaction-id", "OfferteNr": "other-identifier", "Regel": "other-identifier", "Klant": "organization-name",
        "KlantContactpersoon": "person-name", "KlantEmail": "email", "Kraanmachinist": "person-name", "Kraantype": "category",
        "OrderStatus": "account-status", "FactuurStatus": "payment-status", "Werkdatum": "start-date",
        "Aanvraagdatum": "created-date", "Starttijd": "other", "Uren": "quantity", "Postcode": "other", "Plaats": "city",
        "TariefExclBtw": "amount", "TariefInclBtw": "amount"},
    dc={"job_number": "transaction-id", "customer": "organization-name", "customer_email": "email", "crane_class": "category",
        "status": "account-status", "work_date": "start-date", "start_time": "other", "booked_hours": "quantity",
        "site_postcode": "other", "hourly_rate": "amount", "job_value": "amount", "operator_licence": "other"},
))


# ---------------------------------------------------------------- G8 pt, extinguisher inspections, 3-segment
def gen_g8(rng, n):
    sites = [("Escola Básica da Ribeira", "4560-123", "Penafiel"), ("Lar Santa Clara", "4560-410", "Penafiel"),
             ("Supermercado Avenida", "4575-022", "Paredes"), ("Fábrica de Calçado Sá & Filhos", "4580-301", "Paredes"),
             ("Junta de Freguesia de Vilar", "4560-870", "Penafiel"), ("Pavilhão Municipal", "4575-190", "Paredes")]
    resp = people(rng, "pt", len(sites))
    ag = deal(rng, n, [("CO2", 9), ("Água aditivada", 6), ("Espuma", 5)], "Pó químico ABC")
    rs = deal(rng, n, [("Conforme c/ recarga", 8), ("Não conforme", 4), ("Abate", 3)], "Conforme")
    fat = deal(rng, n, [("Por faturar", 11)], "Faturado")
    nx = deal(rng, n, [(None, 4), (MISSING, 3)], 1)
    sp = deal(rng, n, [(1, 7)], 0)
    ec = deal(rng, n, [("mix", 8), ("up", 2)], "lo")
    insp = ["Armando Lima", "Sérgio Vaz", "Paulo Rocha"]
    cap = {"Pó químico ABC": [2.0, 6.0, 9.0], "CO2": [2.0, 5.0], "Água aditivada": [6.0, 9.0], "Espuma": [6.0, 9.0]}
    recs = []
    for i in range(n):
        s = rng.randrange(len(sites))
        rf, rl = resp[s]
        di = rdate(rng, "2026-01-05", "2026-10-30")
        recs.append({
            "numExtintor": f"EXT-{4410 + i * 3:05d}", "numSerie": f"{rng.choice(['PQ', 'CD', 'AA'])}{rng.randint(100000, 999999)}", "linha": i + 1,
            "local": {"cliente": pad(rng, sites[s][0]) if sp[i] else sites[s][0],
                      "morada": {"codigoPostal": sites[s][1], "localidade": sites[s][2]}},
            "tipoAgente": ag[i], "capacidade": rng.choice(cap[ag[i]]), "resultadoInspecao": rs[i], "estadoFaturacao": fat[i],
            "inspetor": rng.choice(insp), "responsavelSeguranca": f"{rf} {rl}",
            "emailResponsavel": em(rng, ec[i], mail([rf, rl], "seguranca.example.org")),
            "dataInspecao": fmt(di, "DD/MM/YYYY"),
            "dataFabrico": fmt(rdate(rng, "2012-01-01", "2024-12-31"), "DD/MM/YYYY"),
            "proximaInspecao": opt(nx[i], fmt(rdate(rng, "2027-01-05", "2027-10-30"), "DD/MM/YYYY")),
            "piso": rng.choice(["R/C", "1.º", "2.º", "Cave"]),
        })
    return recs


SC.append(dict(
    id="fire-extinguisher-inspections-to-maintenance-system", track="general", lang="pt", n=30,
    industry="volunteer fire brigade extinguisher inspection service",
    desc="Extinguisher inspection export of a fictional volunteer fire brigade's inspection service (Portuguese camelCase, nested site with nested address) to be loaded into a maintenance system.",
    completable=True, gen=gen_g8,
    dest=schema({
        "extinguisher_id": P("string", "Identifier of the extinguisher on its inspection label."),
        "site_owner": P("string", "Organisation responsible for the site where the extinguisher hangs."),
        "postal_code": P("string", "Postal code of the site."),
        "agent": P("string", "Extinguishing agent in the unit.", enum=["abc_powder", "co2", "water_additive", "foam"]),
        "capacity_kg": P("number", "Capacity."),
        "result": P("string", "Outcome of the inspection.", enum=["pass", "pass_recharged", "fail"]),
        "inspected_on": P("string", "Date of the inspection.", fmt_="date"),
        "next_inspection_on": P("string", "Date the next inspection is scheduled.", fmt_="date"),
        "age_years": P("integer", "Age of the extinguisher in years."),
        "floor_plan_ref": P("string"),
    }, ["extinguisher_id", "site_owner", "agent", "result", "inspected_on"]),
    gt={
        "extinguisher_id": {"source": "numExtintor", "transform": "copy", "why": "label number; numSerie is the manufacturer serial and linha the row"},
        "site_owner": {"source": "local.cliente", "transform": "trim", "why": "site organisation, padded; responsavelSeguranca is its safety officer and inspetor the inspector"},
        "postal_code": {"source": "local.morada.codigoPostal", "transform": "copy", "why": "postal code; localidade is the town"},
        "agent": {"source": "tipoAgente", "transform": "map_enum", "categoryMap": {"Pó químico ABC": "abc_powder", "CO2": "co2", "Água aditivada": "water_additive", "Espuma": "foam"}, "why": "agent"},
        "capacity_kg": {"source": "capacidade", "transform": "copy", "why": "capacity in kg"},
        "result": {"source": "resultadoInspecao", "transform": "map_enum", "categoryMap": {"Conforme": "pass", "Conforme c/ recarga": "pass_recharged", "Não conforme": "fail", "Abate": None}, "why": "result; scrapped units need review; estadoFaturacao is invoicing"},
        "inspected_on": {"source": "dataInspecao", "transform": "parse_date", "dateFormat": "DD/MM/YYYY", "why": "inspection date (Portuguese day-first); dataFabrico is the manufacture date"},
        "next_inspection_on": {"source": "proximaInspecao", "transform": "parse_date", "dateFormat": "DD/MM/YYYY", "why": "next inspection, null or missing for some"},
        "age_years": {"source": None, "transform": "none", "why": "not exported", "unsupportedReason": "would need the years between dataFabrico and the inspection date"},
        "floor_plan_ref": {"source": None, "transform": "none", "why": "not exported; piso is only the floor"},
    },
    pairs=[
        {"kind": "customer-id-vs-transaction-id", "fields": ["numExtintor", "numSerie"], "correctFor": "extinguisher_id"},
        {"kind": "customer-id-vs-transaction-id", "fields": ["numExtintor", "linha"], "correctFor": "extinguisher_id"},
        {"kind": "nested-entity-relationship", "fields": ["local.cliente", "responsavelSeguranca"], "correctFor": "site_owner"},
        {"kind": "competing-category-fields", "fields": ["resultadoInspecao", "estadoFaturacao"], "correctFor": "result"},
        {"kind": "modified-date-vs-created-date", "fields": ["dataInspecao", "dataFabrico"], "correctFor": "inspected_on"},
        {"kind": "modified-date-vs-created-date", "fields": ["proximaInspecao", "dataInspecao"], "correctFor": "next_inspection_on"},
    ],
    sc={"numExtintor": "customer-id", "numSerie": "other-identifier", "linha": "other-identifier",
        "local.cliente": "organization-name", "local.morada.codigoPostal": "other", "local.morada.localidade": "city",
        "tipoAgente": "category", "capacidade": "quantity", "resultadoInspecao": "account-status",
        "estadoFaturacao": "payment-status", "inspetor": "person-name", "responsavelSeguranca": "person-name",
        "emailResponsavel": "email", "dataInspecao": "start-date", "dataFabrico": "created-date", "proximaInspecao": "end-date",
        "piso": "category"},
    dc={"extinguisher_id": "customer-id", "site_owner": "organization-name", "postal_code": "other", "agent": "category",
        "capacity_kg": "quantity", "result": "account-status", "inspected_on": "start-date", "next_inspection_on": "end-date",
        "age_years": "quantity", "floor_plan_ref": "other"},
))


# ---------------------------------------------------------------- G9 sv, timber deliveries, flat, ambiguous, NOT completable (species missing)
def gen_g9(rng, n):
    owners = people(rng, "sv", 9)
    so = deal(rng, n, [("Massaved", 9), ("Klentimmer", 6), ("Energived", 4)], "Sågtimmer")
    kv = deal(rng, n, [("Klass 2", 9), ("Klass 3", 5), ("Vrak", 3)], "Klass 1")
    bs = deal(rng, n, [("Avräknad", 9), ("Ej avräknad", 8)], "Betald")
    ce = deal(rng, n, [("Ej certifierad", 9), (None, 3), (MISSING, 2)], "Certifierad")
    sp = deal(rng, n, [(1, 6)], 0)
    ec = deal(rng, n, [("mix", 8), ("up", 2)], "lo")
    chauf = ["Roger Ek", "Stina Dahl", "Kent Wikström"]
    akare = ["Norrlands Åkeri AB", "Skogstransport i Mellanbygden", "Bröderna Falks Åkeri"]
    recs = []
    for i in range(n):
        o = rng.randrange(len(owners))
        f, l = owners[o]
        nm = f"{f} {l}"
        sub = round(rng.uniform(18, 42), 2)
        recs.append({
            "leveransnr": f"LV-26-{3300 + i * 2}", "vagsedel_nr": f"{rng.randint(800000, 899999)}", "rad": i + 1,
            "skogsagare": pad(rng, nm) if sp[i] else nm, "skogsagare_nr": f"SO-{1100 + o * 7}",
            "skogsagare_epost": em(rng, ec[i], mail([f, l], "skog.example.net")),
            "akare": rng.choice(akare), "chauffor": rng.choice(chauf), "sortiment": so[i], "kvalitet": kv[i],
            "volym_m3fub": sub, "volym_m3to": round(sub * 1.12, 2),
            "leveransdatum": fmt(rdate(rng, "2026-01-01", "2026-10-12", amb=True), "DD/MM/YYYY"),
            "avverkningsdatum": fmt(rdate(rng, "2025-10-01", "2026-09-12", amb=True), "DD/MM/YYYY"),
            "betalstatus": bs[i], "certifiering": ce[i],
        })
    return recs


SC.append(dict(
    id="timber-deliveries-to-sawmill-intake", track="general", lang="sv", n=28,
    industry="forest owners' timber deliveries to a sawmill",
    desc="Flat timber delivery export of a fictional forest owners' association (Swedish snake_case) to be loaded into a sawmill intake system; the tree species is not exported.",
    completable=False, gen=gen_g9,
    dest=schema({
        "delivery_id": P("string", "Identifier of the timber delivery."),
        "supplier_id": P("string", "Identifier of the forest owner who supplies the timber."),
        "supplier_name": P("string", "Name of the forest owner."),
        "supplier_email": P("string", "Email address of the forest owner.", fmt_="email"),
        "species": P("string", "Tree species of the delivered logs.", enum=["pine", "spruce", "birch"]),
        "assortment": P("string", "Assortment.", enum=["sawlog", "pulpwood", "small_sawlog"]),
        "quality": P("string", "Quality class assigned at measurement.", enum=["grade_1", "grade_2", "grade_3"]),
        "volume_m3sub": P("number", "Solid volume under bark in cubic metres."),
        "delivered_on": P("string", "Date the load arrived at the mill.", fmt_="date"),
        "certification": P("string", "Whether the timber comes from a certified forest.", enum=["certified", "uncertified"]),
        "moisture_pct": P("number"),
    }, ["delivery_id", "supplier_id", "species", "assortment", "volume_m3sub", "delivered_on"]),
    gt={
        "delivery_id": {"source": "leveransnr", "transform": "copy", "why": "delivery number; vagsedel_nr is the waybill and rad the row"},
        "supplier_id": {"source": "skogsagare_nr", "transform": "copy", "why": "owner number"},
        "supplier_name": {"source": "skogsagare", "transform": "trim", "why": "owner name, padded; chauffor is the driver and akare the haulier"},
        "supplier_email": {"source": "skogsagare_epost", "transform": "normalize_email", "why": "owner email, mixed case"},
        "species": {"source": None, "transform": "none", "why": "the species is not exported; sortiment is the assortment and kvalitet the grade"},
        "assortment": {"source": "sortiment", "transform": "map_enum", "categoryMap": {"Sågtimmer": "sawlog", "Massaved": "pulpwood", "Klentimmer": "small_sawlog", "Energived": None}, "why": "assortment; energy wood needs review"},
        "quality": {"source": "kvalitet", "transform": "map_enum", "categoryMap": {"Klass 1": "grade_1", "Klass 2": "grade_2", "Klass 3": "grade_3", "Vrak": None}, "why": "quality class; rejects need review"},
        "volume_m3sub": {"source": "volym_m3fub", "transform": "copy", "why": "solid volume under bark; volym_m3to is the gross volume with bark"},
        "delivered_on": {"source": "leveransdatum", "transform": "parse_date", "dateFormat": "DD/MM/YYYY", "why": "delivery date (day-first); avverkningsdatum is the felling date"},
        "certification": {"source": "certifiering", "transform": "map_enum", "categoryMap": {"Certifierad": "certified", "Ej certifierad": "uncertified"}, "why": "certification, null or missing for some"},
        "moisture_pct": {"source": None, "transform": "none", "why": "not exported"},
    },
    pairs=[
        {"kind": "decoy-for-missing-field", "fields": ["sortiment", "kvalitet"], "correctFor": "species"},
        {"kind": "customer-id-vs-transaction-id", "fields": ["leveransnr", "vagsedel_nr"], "correctFor": "delivery_id"},
        {"kind": "customer-id-vs-transaction-id", "fields": ["leveransnr", "rad"], "correctFor": "delivery_id"},
        {"kind": "nested-entity-relationship", "fields": ["skogsagare", "chauffor"], "correctFor": "supplier_name"},
        {"kind": "competing-category-fields", "fields": ["kvalitet", "betalstatus"], "correctFor": "quality"},
        {"kind": "modified-date-vs-created-date", "fields": ["leveransdatum", "avverkningsdatum"], "correctFor": "delivered_on"},
    ],
    sc={"leveransnr": "transaction-id", "vagsedel_nr": "other-identifier", "rad": "other-identifier", "skogsagare": "person-name",
        "skogsagare_nr": "customer-id", "skogsagare_epost": "email", "akare": "organization-name", "chauffor": "person-name",
        "sortiment": "category", "kvalitet": "category", "volym_m3fub": "quantity", "volym_m3to": "quantity",
        "leveransdatum": "start-date", "avverkningsdatum": "other", "betalstatus": "payment-status", "certifiering": "category"},
    dc={"delivery_id": "transaction-id", "supplier_id": "customer-id", "supplier_name": "person-name", "supplier_email": "email",
        "species": "category", "assortment": "category", "quality": "category", "volume_m3sub": "quantity",
        "delivered_on": "start-date", "certification": "category", "moisture_pct": "quantity"},
))


# ---------------------------------------------------------------- G10 pl, research grants
def gen_g10(rng, n):
    pis = people(rng, "pl", n)
    inst = companies(rng, n, ["Uniwersytet", "Politechnika", "Instytut Badawczy"], ["Nadwiślański", "Morski", "Śląski", "Podlaski", "Mazowiecki", "Karpacki", "Warmiński", "Pomorski", "Lubuski", "Opolski", "Kujawski", "Sudecki"])
    pan = deal(rng, n, [("Nauki ścisłe", 12), ("Nauki o życiu", 10)], "Nauki humanistyczne")
    st = deal(rng, n, [("W ocenie", 8), ("Przyznany", 8), ("Odrzucony", 6), ("Wycofany", 3)], "Złożony")
    um = deal(rng, n, [("Podpisana", 8)], "Niepodpisana")
    ip = deal(rng, n, [(1, 7)], 0)
    ec = deal(rng, n, [("mix", 9), ("up", 2), ("pad", 2)], "lo")
    rec_ = ["prof. Halina Wróbel", "dr hab. Marek Sikora", "dr Barbara Jasińska"]
    wyd = ["Wydział Chemii", "Wydział Biologii", "Wydział Historii", "Wydział Fizyki"]
    recs = []
    for i in range(n):
        f, l = pis[i]
        req = float(rng.choice([150000, 320000, 480000, 750000, 1200000]))
        aw = round(req * rng.choice([0.8, 0.9, 1.0]), 2) if st[i] == "Przyznany" and rng.random() < 0.75 else (
            None if st[i] == "Przyznany" else (MISSING if rng.random() < 0.6 else None))
        sub = rdate(rng, "2025-09-01", "2026-06-30")
        recs.append({
            "nr_wniosku": f"WN/2026/{410 + i * 3:04d}", "id_systemowe": rng.randint(900000, 999999), "lp": i + 1,
            "kierownik": {"imie": f, "nazwisko": l, "email": em(rng, ec[i], mail([f, l], "uczelnia.example.org"))},
            "recenzent": rng.choice(rec_),
            "jednostka": {"nazwa": pad(rng, inst[i]) if ip[i] else inst[i], "wydzial": rng.choice(wyd)},
            "panel": pan[i], "status_wniosku": st[i], "status_umowy": um[i],
            "kwota_wnioskowana": req, "kwota_przyznana": aw,
            "data_zlozenia": fmt(sub, "DD/MM/YYYY"),
            "data_rozpoczecia": fmt(rdate(rng, "2026-10-01", "2027-03-31"), "DD/MM/YYYY"),
            "czas_trwania_mies": rng.choice([12, 24, 36, 48]),
        })
    return recs


SC.append(dict(
    id="research-grant-applications-to-grant-management", track="general", lang="pl", n=35,
    industry="research funding agency grant applications",
    desc="Grant application export of a fictional research funding programme (Polish snake_case, nested principal investigator and institution) to be loaded into a grant management system.",
    completable=True, gen=gen_g10,
    dest=schema({
        "application_id": P("string", "Reference number of the grant application."),
        "principal_investigator": P("string", "Full name of the project leader, given name first."),
        "pi_email": P("string", "Email address of the project leader.", fmt_="email"),
        "institution": P("string", "Research institution that hosts the project."),
        "panel": P("string", "Review panel that assesses the application.", enum=["hs", "st", "ls"]),
        "status": P("string", "Stage of the application in the funding decision.", enum=["submitted", "under_review", "awarded", "rejected"]),
        "requested_amount_pln": P("number", "Budget the applicant asked for, in zloty."),
        "awarded_amount_pln": P("number", "Budget granted by the funder, in zloty."),
        "submitted_on": P("string", "Date the application was submitted.", fmt_="date"),
        "duration_months": P("integer", "Duration."),
        "project_end_date": P("string", "Planned end date of the funded project.", fmt_="date"),
        "keywords": P("string"),
    }, ["application_id", "principal_investigator", "institution", "panel", "status", "requested_amount_pln", "submitted_on"]),
    gt={
        "application_id": {"source": "nr_wniosku", "transform": "copy", "why": "application number; id_systemowe is a system key and lp the row"},
        "principal_investigator": {"source": None, "sources": ["kierownik.imie", "kierownik.nazwisko"], "transform": "concat", "separator": " ", "why": "project leader; recenzent is the reviewer"},
        "pi_email": {"source": "kierownik.email", "transform": "normalize_email", "why": "leader email, mixed case and padded"},
        "institution": {"source": "jednostka.nazwa", "transform": "trim", "why": "institution, padded; wydzial is the faculty"},
        "panel": {"source": "panel", "transform": "map_enum", "categoryMap": {"Nauki humanistyczne": "hs", "Nauki ścisłe": "st", "Nauki o życiu": "ls"}, "why": "panel"},
        "status": {"source": "status_wniosku", "transform": "map_enum", "categoryMap": {"Złożony": "submitted", "W ocenie": "under_review", "Przyznany": "awarded", "Odrzucony": "rejected", "Wycofany": None}, "why": "application state; withdrawn applications need review; status_umowy is the contract"},
        "requested_amount_pln": {"source": "kwota_wnioskowana", "transform": "copy", "why": "requested amount"},
        "awarded_amount_pln": {"source": "kwota_przyznana", "transform": "copy", "why": "awarded amount, null or missing when not (yet) awarded"},
        "submitted_on": {"source": "data_zlozenia", "transform": "parse_date", "dateFormat": "DD/MM/YYYY", "why": "submission date (Polish day-first); data_rozpoczecia is the planned start"},
        "duration_months": {"source": "czas_trwania_mies", "transform": "copy", "why": "duration in months"},
        "project_end_date": {"source": None, "transform": "none", "why": "not exported", "unsupportedReason": "would need data_rozpoczecia plus czas_trwania_mies months"},
        "keywords": {"source": None, "transform": "none", "why": "not exported"},
    },
    pairs=[
        {"kind": "customer-id-vs-transaction-id", "fields": ["nr_wniosku", "id_systemowe"], "correctFor": "application_id"},
        {"kind": "customer-id-vs-transaction-id", "fields": ["nr_wniosku", "lp"], "correctFor": "application_id"},
        {"kind": "nested-entity-relationship", "fields": ["kierownik.imie", "recenzent"], "correctFor": "principal_investigator"},
        {"kind": "competing-category-fields", "fields": ["status_wniosku", "status_umowy"], "correctFor": "status"},
        {"kind": "nested-entity-relationship", "fields": ["kwota_wnioskowana", "kwota_przyznana"], "correctFor": "requested_amount_pln"},
        {"kind": "modified-date-vs-created-date", "fields": ["data_zlozenia", "data_rozpoczecia"], "correctFor": "submitted_on"},
    ],
    sc={"nr_wniosku": "transaction-id", "id_systemowe": "other-identifier", "lp": "other-identifier",
        "kierownik.imie": "given-name", "kierownik.nazwisko": "family-name", "kierownik.email": "email",
        "recenzent": "person-name", "jednostka.nazwa": "organization-name", "jednostka.wydzial": "organization-name",
        "panel": "category", "status_wniosku": "account-status", "status_umowy": "category",
        "kwota_wnioskowana": "amount", "kwota_przyznana": "amount", "data_zlozenia": "created-date",
        "data_rozpoczecia": "start-date", "czas_trwania_mies": "quantity"},
    dc={"application_id": "transaction-id", "principal_investigator": "person-name", "pi_email": "email",
        "institution": "organization-name", "panel": "category", "status": "account-status", "requested_amount_pln": "amount",
        "awarded_amount_pln": "amount", "submitted_on": "created-date", "duration_months": "quantity",
        "project_end_date": "end-date", "keywords": "other"},
))


# ---------------------------------------------------------------- G11 da, wind turbine service visits, ambiguous dates
def gen_g11(rng, n):
    owners = [("Vestkyst Energi A/S", "vestkyst-energi.example.com"), ("Fjordvind I/S", "fjordvind.example.net"),
              ("Hedens Vindmøllelaug", "hedenslaug.example.org"), ("Nordlys Kapital ApS", "nordlys.example.com")]
    kp = people(rng, "da", len(owners))
    park = deal(rng, n, [("Fjordvind", 11), ("Hedeparken", 9)], "Vestkyst Nord")
    typ = deal(rng, n, [("Fejlretning", 10), ("Inspektion", 6), ("Oplæring", 3)], "Planlagt service")
    st = deal(rng, n, [("Igangværende", 5), ("Afventer reservedel", 5), ("Annulleret", 3)], "Afsluttet")
    pri = deal(rng, n, [("Høj", 8), ("Lav", 7), (None, 2)], "Normal")
    tb = deal(rng, n, [(None, 4), (MISSING, 3)], 1)
    op = deal(rng, n, [(1, 6)], 0)
    ec = deal(rng, n, [("mix", 8), ("up", 2)], "lo")
    tek = ["Lasse Bak", "Pernille Holst", "Kim Skov"]
    recs = []
    for i in range(n):
        o = rng.randrange(len(owners))
        f, l = kp[o]
        recs.append({
            "serviceordre": f"SO-26-{7700 + i * 4}", "raekke": i + 1,
            "moelle": {"id": f"WTG-{rng.randint(1, 48):03d}", "park": park[i], "model": rng.choice(["V-3.6 MW", "S-4.2 MW", "N-2.5 MW"])},
            "tekniker": rng.choice(tek),
            "ejer": {"navn": pad(rng, owners[o][0]) if op[i] else owners[o][0], "kontaktperson": f"{f} {l}",
                     "email": em(rng, ec[i], mail([f, l], owners[o][1]))},
            "type": typ[i], "status": st[i], "prioritet": pri[i],
            "besoegsdato": fmt(rdate(rng, "2026-01-01", "2026-11-12", amb=True), "DD/MM/YYYY"),
            "registreret": fmt(rdate(rng, "2025-11-01", "2026-10-12", amb=True), "DD/MM/YYYY"),
            "timer_brugt": opt(tb[i], rng.choice([1.5, 3.0, 4.5, 6.0, 7.5, 12.0])),
            "stilstand_timer": rng.choice([0.0, 2.0, 5.5, 14.0, 26.0, 48.0]),
        })
    return recs


SC.append(dict(
    id="wind-turbine-service-visits-to-maintenance-system", track="general", lang="da", n=31,
    industry="wind turbine service visits",
    desc="Service-visit export of a fictional wind turbine service company (Danish snake_case, nested turbine and owner) to be loaded into a maintenance management system.",
    completable=True, gen=gen_g11,
    dest=schema({
        "work_order": P("string", "Number of the service work order."),
        "turbine_id": P("string", "Identifier of the turbine that was visited."),
        "wind_farm": P("string", "Wind farm the turbine belongs to.", enum=["north_coast", "fjord", "heath"]),
        "owner": P("string", "Company or cooperative that owns the turbine."),
        "visit_type": P("string", "Reason for the visit.", enum=["scheduled", "corrective", "inspection"]),
        "status": P("string", "Progress of the work order.", enum=["done", "in_progress", "waiting_parts", "cancelled"]),
        "priority": P("string", "Urgency of the work order.", enum=["high", "normal", "low"]),
        "visit_date": P("string", "Date the technicians visited the turbine.", fmt_="date"),
        "hours_spent": P("number", "Technician hours spent on the visit."),
        "energy_lost_mwh": P("number", "Energy production lost during the stop, in megawatt hours."),
        "weather_notes": P("string", "Notes."),
    }, ["work_order", "turbine_id", "wind_farm", "visit_type", "status", "visit_date"]),
    gt={
        "work_order": {"source": "serviceordre", "transform": "copy", "why": "work order; raekke is the row"},
        "turbine_id": {"source": "moelle.id", "transform": "copy", "why": "turbine id"},
        "wind_farm": {"source": "moelle.park", "transform": "map_enum", "categoryMap": {"Vestkyst Nord": "north_coast", "Fjordvind": "fjord", "Hedeparken": "heath"}, "why": "wind farm; moelle.model is the turbine model"},
        "owner": {"source": "ejer.navn", "transform": "trim", "why": "owner, padded; ejer.kontaktperson is a person and tekniker the technician"},
        "visit_type": {"source": "type", "transform": "map_enum", "categoryMap": {"Planlagt service": "scheduled", "Fejlretning": "corrective", "Inspektion": "inspection", "Oplæring": None}, "why": "visit type; training visits need review"},
        "status": {"source": "status", "transform": "map_enum", "categoryMap": {"Afsluttet": "done", "Igangværende": "in_progress", "Afventer reservedel": "waiting_parts", "Annulleret": "cancelled"}, "why": "work order state"},
        "priority": {"source": "prioritet", "transform": "map_enum", "categoryMap": {"Høj": "high", "Normal": "normal", "Lav": "low"}, "why": "priority, null for some"},
        "visit_date": {"source": "besoegsdato", "transform": "parse_date", "dateFormat": "DD/MM/YYYY", "why": "visit date (Danish day-first); registreret is when the order was logged"},
        "hours_spent": {"source": "timer_brugt", "transform": "copy", "why": "technician hours, null or missing for some; stilstand_timer is downtime"},
        "energy_lost_mwh": {"source": None, "transform": "none", "why": "not exported", "unsupportedReason": "would need stilstand_timer multiplied by the turbine's rated power"},
        "weather_notes": {"source": None, "transform": "none", "why": "not exported"},
    },
    pairs=[
        {"kind": "customer-id-vs-transaction-id", "fields": ["serviceordre", "raekke"], "correctFor": "work_order"},
        {"kind": "customer-id-vs-transaction-id", "fields": ["moelle.id", "serviceordre"], "correctFor": "turbine_id"},
        {"kind": "nested-entity-relationship", "fields": ["ejer.navn", "ejer.kontaktperson"], "correctFor": "owner"},
        {"kind": "competing-category-fields", "fields": ["type", "prioritet"], "correctFor": "visit_type"},
        {"kind": "competing-category-fields", "fields": ["status", "type"], "correctFor": "status"},
        {"kind": "modified-date-vs-created-date", "fields": ["besoegsdato", "registreret"], "correctFor": "visit_date"},
        {"kind": "nested-entity-relationship", "fields": ["timer_brugt", "stilstand_timer"], "correctFor": "hours_spent"},
    ],
    sc={"serviceordre": "transaction-id", "raekke": "other-identifier", "moelle.id": "customer-id", "moelle.park": "category",
        "moelle.model": "category", "tekniker": "person-name", "ejer.navn": "organization-name", "ejer.kontaktperson": "person-name",
        "ejer.email": "email", "type": "category", "status": "account-status", "prioritet": "category",
        "besoegsdato": "start-date", "registreret": "created-date", "timer_brugt": "quantity", "stilstand_timer": "quantity"},
    dc={"work_order": "transaction-id", "turbine_id": "customer-id", "wind_farm": "category", "owner": "organization-name",
        "visit_type": "category", "status": "account-status", "priority": "category", "visit_date": "start-date",
        "hours_spent": "quantity", "energy_lost_mwh": "quantity", "weather_notes": "other"},
))


# ---------------------------------------------------------------- G12 mixed (fr + en), conference talks, NOT completable (session language missing)
def gen_g12(rng, n):
    sp = people(rng, "fr", n // 2) + people(rng, "en", n - n // 2)
    rng.shuffle(sp)
    tr = deal(rng, n, [("Sécurité", 8), ("Cloud native", 8), ("Design produit", 5)], "Data & IA")
    fo = deal(rng, n, [("Atelier 90 min", 6), ("Lightning 5 min", 6), ("Keynote", 2)], "Talk 30 min")
    rs = deal(rng, n, [("Waitlist", 6), ("Rejected", 7), ("Withdrawn", 2)], "Accepted")
    pay = deal(rng, n, [("Exonéré", 8), ("En attente", 6)], "Payé")
    tp = deal(rng, n, [(1, 7)], 0)
    ec = deal(rng, n, [("mix", 9), ("up", 2)], "lo")
    chairs = ["Mathilde Coste", "Kevin Ashworth", "Sophie Tremblay"]
    titles = companies(rng, n, ["Scaling", "Securing", "Testing", "Observing", "Designing", "Migrating"],
                       ["event pipelines", "legacy APIs", "edge clusters", "onboarding flows", "data contracts", "feature flags", "batch jobs"])
    recs = []
    for i in range(n):
        f, l = sp[i]
        t = titles[i][0].upper() + titles[i][1:]
        recs.append({
            "submission_id": f"SUB-{412 + i * 5}", "ticket_no": f"TK-{rng.randint(20000, 29999)}", "ligne": i + 1,
            "speaker": {"prenom": f, "nom": l, "email": em(rng, ec[i], mail([f, l], "speakers.example.org")),
                        "pays": rng.choice(["France", "Belgique", "Canada", "Suisse", "United Kingdom"])},
            "chair_name": rng.choice(chairs), "titre": pad(rng, t) if tp[i] else t,
            "track": tr[i], "format": fo[i], "review_status": rs[i], "statut_paiement": pay[i],
            "langue_interface": rng.choice(["fr", "en"]),
            "date_soumission": fmt(rdate(rng, "2026-02-01", "2026-05-31"), "DD/MM/YYYY"),
            "date_session": fmt(rdate(rng, "2026-11-23", "2026-11-25"), "DD/MM/YYYY"),
        })
    return recs


SC.append(dict(
    id="conference-talk-submissions-to-event-program", track="general", lang="mixed", n=30,
    industry="developer conference talk submissions",
    desc="Talk submission export of a fictional bilingual developer conference (mixed French and English field names and labels, nested speaker) to be loaded into an event programme tool; the language the talk will be given in is not exported.",
    completable=False, gen=gen_g12,
    dest=schema({
        "submission_id": P("string", "Identifier of the talk submission."),
        "title": P("string", "Title of the talk."),
        "speaker_name": P("string", "Full name of the speaker, given name first."),
        "speaker_email": P("string", "Email address of the speaker.", fmt_="email"),
        "track": P("string", "Programme track the talk belongs to.", enum=["data_ai", "security", "cloud", "product_design"]),
        "format": P("string", "Format.", enum=["talk", "workshop", "lightning"]),
        "status": P("string", "Programme committee decision on the submission.", enum=["accepted", "waitlisted", "rejected"]),
        "session_language": P("string", "Language in which the talk will be delivered, used for interpretation planning.", enum=["fr", "en"]),
        "submitted_on": P("string", "Date the talk was submitted.", fmt_="date"),
        "abstract": P("string"),
    }, ["submission_id", "title", "speaker_name", "track", "format", "status", "session_language"]),
    gt={
        "submission_id": {"source": "submission_id", "transform": "copy", "why": "submission id; ticket_no is the speaker ticket and ligne the row"},
        "title": {"source": "titre", "transform": "trim", "why": "talk title, padded"},
        "speaker_name": {"source": None, "sources": ["speaker.prenom", "speaker.nom"], "transform": "concat", "separator": " ", "why": "speaker; chair_name is the session chair"},
        "speaker_email": {"source": "speaker.email", "transform": "normalize_email", "why": "speaker email, mixed case"},
        "track": {"source": "track", "transform": "map_enum", "categoryMap": {"Data & IA": "data_ai", "Sécurité": "security", "Cloud native": "cloud", "Design produit": "product_design"}, "why": "track"},
        "format": {"source": "format", "transform": "map_enum", "categoryMap": {"Talk 30 min": "talk", "Atelier 90 min": "workshop", "Lightning 5 min": "lightning", "Keynote": None}, "why": "format; keynotes are invited and need review"},
        "status": {"source": "review_status", "transform": "map_enum", "categoryMap": {"Accepted": "accepted", "Waitlist": "waitlisted", "Rejected": "rejected", "Withdrawn": None}, "why": "review decision; withdrawn talks need review; statut_paiement is the ticket payment"},
        "session_language": {"source": None, "transform": "none", "why": "not exported; langue_interface is the submission portal's interface language and speaker.pays the speaker's country"},
        "submitted_on": {"source": "date_soumission", "transform": "parse_date", "dateFormat": "DD/MM/YYYY", "why": "submission date (day-first); date_session is the session day"},
        "abstract": {"source": None, "transform": "none", "why": "not exported"},
    },
    pairs=[
        {"kind": "decoy-for-missing-field", "fields": ["langue_interface", "speaker.pays"], "correctFor": "session_language"},
        {"kind": "customer-id-vs-transaction-id", "fields": ["submission_id", "ticket_no"], "correctFor": "submission_id"},
        {"kind": "customer-id-vs-transaction-id", "fields": ["submission_id", "ligne"], "correctFor": "submission_id"},
        {"kind": "nested-entity-relationship", "fields": ["speaker.prenom", "chair_name"], "correctFor": "speaker_name"},
        {"kind": "competing-category-fields", "fields": ["review_status", "statut_paiement"], "correctFor": "status"},
        {"kind": "modified-date-vs-created-date", "fields": ["date_soumission", "date_session"], "correctFor": "submitted_on"},
    ],
    sc={"submission_id": "transaction-id", "ticket_no": "other-identifier", "ligne": "other-identifier",
        "speaker.prenom": "given-name", "speaker.nom": "family-name", "speaker.email": "email", "speaker.pays": "other",
        "chair_name": "person-name", "titre": "other", "track": "category", "format": "category",
        "review_status": "account-status", "statut_paiement": "payment-status", "langue_interface": "language-code",
        "date_soumission": "created-date", "date_session": "start-date"},
    dc={"submission_id": "transaction-id", "title": "other", "speaker_name": "person-name", "speaker_email": "email",
        "track": "category", "format": "category", "status": "account-status", "session_language": "language-code",
        "submitted_on": "created-date", "abstract": "other"},
))
