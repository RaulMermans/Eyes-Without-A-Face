"""eval-18f holdout, track wedge: CRM / customer-account exports into helpdesk schemas. SEALED."""
from lib import (MISSING, deal, opt, people, mail, mixcase, upper, pad, rdate, fmt,
                 P, OBJ, schema)


def em(rng, flag, email):
    if flag == "mix":
        return mixcase(email)
    if flag == "up":
        return upper(email)
    if flag == "pad":
        return pad(rng, email)
    return email


def companies(rng, n, a, b, f="{} {}"):
    combos = [f.format(x, y) for x in a for y in b]
    return rng.sample(combos, n)


SC = []

# ---------------------------------------------------------------- W1 en (US)
def gen_w1(rng, n):
    ppl = people(rng, "en", n)
    comp = companies(rng, n, ["Maple", "Harbor", "Ridgeview", "Copper", "Lakeside", "Summit", "Pioneer", "Oakmont"],
                     ["Dental Group", "Plaza LLC", "Bistro", "Storage Co", "Medical Suites", "Office Park"])
    st = deal(rng, n, [("Seasonal Hold", 4), ("Closed - Lost", 4), ("Do Not Service", 3), ("Duplicate", 3)], "Active")
    pay = deal(rng, n, [("30 Days", 6), ("60+ Days", 4), ("Collections", 3)], "Current")
    tier = deal(rng, n, [("Bronze PM", 8), ("Gold PM", 6), ("Time & Materials", 5)], "Silver PM")
    seg = deal(rng, n, [("Restaurant", 8), ("Healthcare", 7), ("Retail", 6)], "Property Mgmt")
    mob = deal(rng, n, [(None, 4), (MISSING, 3)], 1)
    since = deal(rng, n, [(None, 3), (MISSING, 2)], 1)
    ec = deal(rng, n, [("mix", 9), ("up", 2), ("pad", 2)], "lo")
    cp = deal(rng, n, [(1, 7)], 0)
    city = ["Tucson", "Mesa", "Chandler", "Tempe"]
    am = ["Brian Kessler", "Dana Whitcomb", "Luis Ortega"]
    recs = []
    for i in range(n):
        f, l = ppl[i]
        start = rdate(rng, "2015-01-01", "2024-12-31")
        recs.append({
            "row_num": i + 1,
            "account_no": f"HV-{20400 + i * 7 + rng.randint(0, 5)}",
            "crm_record_id": f"0017Q00000{rng.choice('ABCDEFGH')}{rng.randint(10000, 99999)}",
            "account": {
                "name": pad(rng, comp[i]) if cp[i] else comp[i],
                "c_segment": seg[i], "c_service_tier": tier[i], "city": rng.choice(city)},
            "primary_contact": {
                "first_name": f, "last_name": l,
                "email": em(rng, ec[i], mail([f, l], "mail.example.com")),
                "mobile": opt(mob[i], f"({rng.randint(201, 989)}) 555-{rng.randint(100, 199):04d}")},
            "billing_contact": {"email": f"ap{i}@{comp[i].split()[0].lower()}.example.net"},
            "account_manager": rng.choice(am),
            "c_account_status": st[i], "c_payment_status": pay[i],
            "contract_start": opt(since[i], fmt(start, "MM/DD/YYYY")),
            "contract_renewal": fmt(rdate(rng, "2026-01-01", "2027-12-31"), "MM/DD/YYYY"),
            "created_at": fmt(rdate(rng, "2013-01-01", start.isoformat()), "ISO-8601", rng),
            "c_email_optin": rng.choice(["Yes", "No"]),
        })
    return recs


SC.append(dict(
    id="hvac-contractor-accounts-to-helpdesk-requesters", track="wedge", lang="en", n=32,
    industry="commercial heating and cooling maintenance contractor customer accounts",
    desc="Customer-account export of a fictional commercial HVAC maintenance contractor (US CRM, snake_case with c_ custom fields, nested account and contacts) to be loaded as helpdesk requesters.",
    completable=True, gen=gen_w1,
    dest=schema({
        "external_id": P("string", "Identifier of the customer account in your own system, used to match future imports."),
        "name": P("string", "Full name of the requester, given name first."),
        "email": P("string", "Address the requester writes from; ticket replies go here.", fmt_="email"),
        "phone": P("string", "Mobile number used for urgent callbacks about a breakdown."),
        "organization": OBJ({
            "name": P("string", "Name of the business the requester works for."),
            "tier": P("string", "Maintenance plan the business pays for, which sets response targets.", enum=["basic", "standard", "priority"]),
        }, ["name"], "Company the requester belongs to."),
        "status": P("string", "Status.", enum=["active", "paused", "closed"]),
        "customer_since": P("string", "Date the customer's first service contract started.", fmt_="date"),
        "timezone": P("string"),
        "lifetime_months": P("integer", "Number of whole months the account has been a customer."),
    }, ["external_id", "name", "email", "organization", "status"]),
    gt={
        "external_id": {"source": "account_no", "transform": "copy", "why": "account number; crm_record_id is the CRM's internal key and row_num the export row"},
        "name": {"source": None, "sources": ["primary_contact.first_name", "primary_contact.last_name"], "transform": "concat", "separator": " ", "why": "primary contact given and family name; account_manager is the contractor's own rep"},
        "email": {"source": "primary_contact.email", "transform": "normalize_email", "why": "primary contact email, mixed case and padded; billing_contact.email is accounts payable"},
        "phone": {"source": "primary_contact.mobile", "transform": "copy", "why": "contact mobile, null or missing for some"},
        "organization.name": {"source": "account.name", "transform": "trim", "why": "business name, padded in some rows"},
        "organization.tier": {"source": "account.c_service_tier", "transform": "map_enum", "categoryMap": {"Bronze PM": "basic", "Time & Materials": "basic", "Silver PM": "standard", "Gold PM": "priority"}, "why": "maintenance plan; c_segment is the market segment"},
        "status": {"source": "c_account_status", "transform": "map_enum", "categoryMap": {"Active": "active", "Seasonal Hold": "paused", "Closed - Lost": "closed", "Do Not Service": "closed", "Duplicate": None}, "why": "account lifecycle; duplicates need review; c_payment_status is receivables"},
        "customer_since": {"source": "contract_start", "transform": "parse_date", "dateFormat": "MM/DD/YYYY", "why": "first contract start (US month-first); contract_renewal is the next renewal and created_at the lead creation"},
        "timezone": {"source": None, "transform": "none", "why": "no time zone is exported; the city alone is not a supported transformation"},
        "lifetime_months": {"source": None, "transform": "none", "why": "not exported", "unsupportedReason": "would need the difference in months between contract_start and the import date"},
    },
    pairs=[
        {"kind": "customer-id-vs-transaction-id", "fields": ["account_no", "crm_record_id"], "correctFor": "external_id"},
        {"kind": "customer-id-vs-transaction-id", "fields": ["account_no", "row_num"], "correctFor": "external_id"},
        {"kind": "nested-entity-relationship", "fields": ["primary_contact.email", "billing_contact.email"], "correctFor": "email"},
        {"kind": "nested-entity-relationship", "fields": ["primary_contact.first_name", "account_manager"], "correctFor": "name"},
        {"kind": "competing-category-fields", "fields": ["c_account_status", "c_payment_status"], "correctFor": "status"},
        {"kind": "competing-category-fields", "fields": ["account.c_service_tier", "account.c_segment"], "correctFor": "organization.tier"},
        {"kind": "modified-date-vs-created-date", "fields": ["contract_start", "contract_renewal"], "correctFor": "customer_since"},
    ],
    sc={"row_num": "other-identifier", "account_no": "customer-id", "crm_record_id": "other-identifier",
        "account.name": "organization-name", "account.c_segment": "category", "account.c_service_tier": "category", "account.city": "city",
        "primary_contact.first_name": "given-name", "primary_contact.last_name": "family-name", "primary_contact.email": "email",
        "primary_contact.mobile": "phone", "billing_contact.email": "email", "account_manager": "person-name",
        "c_account_status": "account-status", "c_payment_status": "payment-status", "contract_start": "start-date",
        "contract_renewal": "end-date", "created_at": "created-date", "c_email_optin": "consent-flag"},
    dc={"external_id": "customer-id", "name": "person-name", "email": "email", "phone": "phone", "organization.name": "organization-name",
        "organization.tier": "category", "status": "account-status", "customer_since": "start-date", "timezone": "other", "lifetime_months": "quantity"},
))


# ---------------------------------------------------------------- W2 en (UK), flat
def gen_w2(rng, n):
    ppl = people(rng, "en", n)
    st = deal(rng, n, [("Winter Lay-up", 5), ("Visitor - Seasonal", 5), ("Left Marina", 4), ("Waiting List", 3)], "Annual Berth")
    pay = deal(rng, n, [("Instalments", 7), ("Arrears", 4)], "Paid")
    vt = deal(rng, n, [("Motor Cruiser", 7), ("RIB", 4), ("Narrowboat", 4)], "Sailing Yacht")
    mob = deal(rng, n, [(None, 3), (MISSING, 3)], 1)
    emnull = deal(rng, n, [(None, 2)], 1)
    ec = deal(rng, n, [("mix", 8), ("up", 2)], "lo")
    sp = deal(rng, n, [(1, 6)], 0)
    leg = deal(rng, n, [(None, 9)], 1)
    hm = ["Gareth Pryce", "Fiona Lockhart", "Ian McBride"]
    boats = ["Kittiwake", "Sea Breeze", "Blue Heron", "Tern", "Moonraker", "Saltwind", "Curlew", "Halcyon", "Osprey", "Swallow",
             "Dawn Treader", "Merlin", "Puffin", "Shearwater", "Avocet", "Spindrift", "Wren", "Petrel", "Marlin", "Seraph",
             "Gannet", "Selkie", "Corrie", "Bluebell", "Kestrel", "Lapwing", "Dunlin", "Skua", "Plover", "Sandpiper"]
    recs = []
    for i in range(n):
        f, l = ppl[i]
        e = mail([f, l], "post.example.org")
        recs.append({
            "RowNo": i + 1, "MemberRef": f"BH-{410 + i * 3:04d}", "LegacyRef": opt(leg[i], f"M{rng.randint(1000, 9999)}"),
            "Title": rng.choice(["Mr", "Mrs", "Ms", "Dr"]), "Forename": f,
            "Surname": pad(rng, l) if sp[i] else l,
            "EmailAddress": opt(emnull[i], em(rng, ec[i], e)),
            "AltEmail": mail([f[0], l], "work.example.net"),
            "MobileTel": opt(mob[i], f"07700 9{rng.randint(10000, 99999)}"),
            "BerthStatus": st[i], "PaymentStatus": pay[i], "VesselName": boats[i % len(boats)], "VesselType": vt[i],
            "BerthStart": fmt(rdate(rng, "2012-01-01", "2025-06-30"), "DD/MM/YYYY"),
            "RenewalDue": fmt(rdate(rng, "2026-01-01", "2027-03-31"), "DD/MM/YYYY"),
            "HarbourMaster": rng.choice(hm), "Marketing": rng.choice(["Opted in", "Opted out"]),
        })
    return recs


SC.append(dict(
    id="marina-berth-holders-to-helpdesk-end-users", track="wedge", lang="en", n=30,
    industry="coastal marina berth holder accounts",
    desc="Flat berth-holder export of a fictional coastal marina (UK PascalCase CRM) to be loaded as helpdesk end users.",
    completable=True, gen=gen_w2,
    dest=schema({
        "externalId": P("string", "Identifier of the customer in the marina's own records."),
        "firstName": P("string", "Given name of the end user."),
        "lastName": P("string", "Family name of the end user."),
        "email": P("string", "Main email address of the end user; required to raise requests.", fmt_="email"),
        "phone": P("string", "Mobile number of the end user."),
        "status": P("string", "Whether the customer currently holds a berth, holds one seasonally, or has left.", enum=["active", "seasonal", "inactive"]),
        "boatType": P("string", "Type.", enum=["sail", "power"]),
        "customerSince": P("string", "Date the customer's first berth agreement began.", fmt_="date"),
        "preferredLanguage": P("string"),
        "membershipYears": P("integer", "Number of full years the customer has held a berth."),
    }, ["externalId", "firstName", "lastName", "email", "status"]),
    gt={
        "externalId": {"source": "MemberRef", "transform": "copy", "why": "berth-holder reference; LegacyRef is an old system key and RowNo the export row"},
        "firstName": {"source": "Forename", "transform": "copy", "why": "given name; HarbourMaster is staff"},
        "lastName": {"source": "Surname", "transform": "trim", "why": "family name, padded"},
        "email": {"source": "EmailAddress", "transform": "normalize_email", "why": "main email, mixed case; null in a few rows, which are held; AltEmail is a secondary work address"},
        "phone": {"source": "MobileTel", "transform": "copy", "why": "mobile, null or missing for some"},
        "status": {"source": "BerthStatus", "transform": "map_enum", "categoryMap": {"Annual Berth": "active", "Winter Lay-up": "seasonal", "Visitor - Seasonal": "seasonal", "Left Marina": "inactive", "Waiting List": None}, "why": "berth state; people on the waiting list are not customers yet and need review; PaymentStatus is the fee state"},
        "boatType": {"source": "VesselType", "transform": "map_enum", "categoryMap": {"Sailing Yacht": "sail", "Motor Cruiser": "power", "RIB": "power", "Narrowboat": "power"}, "why": "vessel type; VesselName is the boat's name"},
        "customerSince": {"source": "BerthStart", "transform": "parse_date", "dateFormat": "DD/MM/YYYY", "why": "first berth agreement (UK day-first); RenewalDue is the next renewal"},
        "preferredLanguage": {"source": None, "transform": "none", "why": "no language is exported"},
        "membershipYears": {"source": None, "transform": "none", "why": "not exported", "unsupportedReason": "would need the number of full years between BerthStart and the import date"},
    },
    pairs=[
        {"kind": "customer-id-vs-transaction-id", "fields": ["MemberRef", "LegacyRef"], "correctFor": "externalId"},
        {"kind": "customer-id-vs-transaction-id", "fields": ["MemberRef", "RowNo"], "correctFor": "externalId"},
        {"kind": "nested-entity-relationship", "fields": ["EmailAddress", "AltEmail"], "correctFor": "email"},
        {"kind": "nested-entity-relationship", "fields": ["Forename", "HarbourMaster"], "correctFor": "firstName"},
        {"kind": "competing-category-fields", "fields": ["BerthStatus", "PaymentStatus"], "correctFor": "status"},
        {"kind": "modified-date-vs-created-date", "fields": ["BerthStart", "RenewalDue"], "correctFor": "customerSince"},
    ],
    sc={"RowNo": "other-identifier", "MemberRef": "customer-id", "LegacyRef": "other-identifier", "Title": "category",
        "Forename": "given-name", "Surname": "family-name", "EmailAddress": "email", "AltEmail": "email", "MobileTel": "phone",
        "BerthStatus": "account-status", "PaymentStatus": "payment-status", "VesselName": "other", "VesselType": "category",
        "BerthStart": "start-date", "RenewalDue": "end-date", "HarbourMaster": "person-name", "Marketing": "consent-flag"},
    dc={"externalId": "customer-id", "firstName": "given-name", "lastName": "family-name", "email": "email", "phone": "phone",
        "status": "account-status", "boatType": "category", "customerSince": "start-date", "preferredLanguage": "language-code",
        "membershipYears": "quantity"},
))


# ---------------------------------------------------------------- W3 de, NOT completable (client email missing)
def gen_w3(rng, n):
    ppl = people(rng, "de", n)
    firm = companies(rng, n, ["Bäckerei", "Elektro", "Praxis", "Autohaus", "Gärtnerei", "Ingenieurbüro", "Tischlerei"],
                     ["Lindner", "Vogt", "Seidel", "Brandt", "Haas", "Roth", "Kuhn"])
    st = deal(rng, n, [("ruhend", 5), ("gekündigt", 4), ("Anfrage", 3)], "laufend")
    pay = deal(rng, n, [("Mahnstufe 1", 6), ("Mahnstufe 2", 3)], "ausgeglichen")
    lst = deal(rng, n, [("Jahresabschluss", 8), ("Steuererklärung privat", 7)], "Finanzbuchhaltung")
    tel = deal(rng, n, [(None, 3), (MISSING, 3)], 1)
    fp = deal(rng, n, [(1, 6)], 0)
    alt = deal(rng, n, [(None, 10)], 1)
    sb = [("Sabine Herold", "s.herold"), ("Markus Engel", "m.engel"), ("Petra Vogel", "p.vogel")]
    recs = []
    for i in range(n):
        f, l = ppl[i]
        s = rng.choice(sb)
        recs.append({
            "mandantenNr": f"M-{10200 + i * 5 + rng.randint(0, 3)}", "altNr": opt(alt[i], f"{rng.randint(10000, 69999)}"),
            "lfdNr": i + 1,
            "kontakt": {"vorname": f, "nachname": l, "telefon": opt(tel[i], f"0{rng.randint(151, 179)} {rng.randint(1000000, 9999999)}"),
                        "anrede": "Frau" if f in ("Lena", "Mia", "Hannah", "Sophie", "Clara", "Johanna", "Emilia", "Lea", "Marie", "Katrin") else "Herr"},
            "firma": {"name": pad(rng, firm[i]) if fp[i] else firm[i],
                      "rechtsform": rng.choice(["GmbH", "GbR", "Einzelunternehmen", "UG (haftungsbeschränkt)"])},
            "sachbearbeiter": {"name": s[0], "email": mixcase(f"{s[1]}@kanzlei-roth.example.net") if rng.random() < 0.4 else f"{s[1]}@kanzlei-roth.example.net"},
            "kanzleiPostfach": "mandanten@kanzlei-roth.example.net",
            "mandatsstatus": st[i], "zahlungsstatus": pay[i], "leistung": lst[i],
            "mandatBeginn": fmt(rdate(rng, "2010-01-01", "2025-06-30", amb=True), "DD/MM/YYYY"),
            "letzteBesprechung": fmt(rdate(rng, "2025-01-01", "2026-10-31", amb=True), "DD/MM/YYYY"),
            "newsletter": rng.choice(["ja", "nein"]),
        })
    return recs


SC.append(dict(
    id="tax-advisory-clients-to-helpdesk-contacts", track="wedge", lang="de", n=28,
    industry="tax advisory firm client mandates",
    desc="Client export of a fictional tax advisory office (German camelCase, nested contact, firm and case handler) to be loaded as helpdesk contacts; the clients' own email addresses are not exported.",
    completable=False, gen=gen_w3,
    dest=schema({
        "customer_id": P("string", "Identifier of the client at the advisory office."),
        "first_name": P("string", "Given name of the contact."),
        "last_name": P("string", "Family name of the contact."),
        "email": P("string", "Email address of the contact; every ticket is linked to it.", fmt_="email"),
        "phone": P("string", "Phone number of the contact."),
        "company": P("string", "Business the contact represents."),
        "status": P("string", "Whether the mandate is running, dormant or ended.", enum=["active", "dormant", "ended"]),
        "service_line": P("string", "Main service the office provides to the client.", enum=["bookkeeping", "annual_accounts", "private_tax"]),
        "customer_since": P("string", "Date.", fmt_="date"),
        "notes": P("string", "Internal remarks about the contact, shown to agents only."),
    }, ["customer_id", "first_name", "last_name", "email", "status"]),
    gt={
        "customer_id": {"source": "mandantenNr", "transform": "copy", "why": "client number; altNr is an old number and lfdNr the export row"},
        "first_name": {"source": "kontakt.vorname", "transform": "copy", "why": "client contact given name; sachbearbeiter.name is the case handler"},
        "last_name": {"source": "kontakt.nachname", "transform": "copy", "why": "client contact family name"},
        "email": {"source": None, "transform": "none", "why": "the client's own email is not exported; sachbearbeiter.email belongs to the case handler and kanzleiPostfach is the office's shared mailbox"},
        "phone": {"source": "kontakt.telefon", "transform": "copy", "why": "client phone, null or missing for some"},
        "company": {"source": "firma.name", "transform": "trim", "why": "business name, padded"},
        "status": {"source": "mandatsstatus", "transform": "map_enum", "categoryMap": {"laufend": "active", "ruhend": "dormant", "gekündigt": "ended", "Anfrage": None}, "why": "mandate state; an enquiry is not a client yet; zahlungsstatus is dunning"},
        "service_line": {"source": "leistung", "transform": "map_enum", "categoryMap": {"Finanzbuchhaltung": "bookkeeping", "Jahresabschluss": "annual_accounts", "Steuererklärung privat": "private_tax"}, "why": "main service"},
        "customer_since": {"source": "mandatBeginn", "transform": "parse_date", "dateFormat": "DD/MM/YYYY", "why": "mandate start (German day-first); letzteBesprechung is the last meeting"},
        "notes": {"source": None, "transform": "none", "why": "no notes are exported"},
    },
    pairs=[
        {"kind": "decoy-for-missing-field", "fields": ["sachbearbeiter.email", "kanzleiPostfach"], "correctFor": "email"},
        {"kind": "customer-id-vs-transaction-id", "fields": ["mandantenNr", "altNr"], "correctFor": "customer_id"},
        {"kind": "customer-id-vs-transaction-id", "fields": ["mandantenNr", "lfdNr"], "correctFor": "customer_id"},
        {"kind": "nested-entity-relationship", "fields": ["kontakt.vorname", "sachbearbeiter.name"], "correctFor": "first_name"},
        {"kind": "competing-category-fields", "fields": ["mandatsstatus", "zahlungsstatus"], "correctFor": "status"},
        {"kind": "modified-date-vs-created-date", "fields": ["mandatBeginn", "letzteBesprechung"], "correctFor": "customer_since"},
    ],
    sc={"mandantenNr": "customer-id", "altNr": "other-identifier", "lfdNr": "other-identifier",
        "kontakt.vorname": "given-name", "kontakt.nachname": "family-name", "kontakt.telefon": "phone", "kontakt.anrede": "category",
        "firma.name": "organization-name", "firma.rechtsform": "category", "sachbearbeiter.name": "person-name",
        "sachbearbeiter.email": "email", "kanzleiPostfach": "email", "mandatsstatus": "account-status",
        "zahlungsstatus": "payment-status", "leistung": "category", "mandatBeginn": "start-date",
        "letzteBesprechung": "other", "newsletter": "consent-flag"},
    dc={"customer_id": "customer-id", "first_name": "given-name", "last_name": "family-name", "email": "email", "phone": "phone",
        "company": "organization-name", "status": "account-status", "service_line": "category", "customer_since": "start-date", "notes": "other"},
))


# ---------------------------------------------------------------- W4 fr, 3-segment paths
def gen_w4(rng, n):
    ppl = people(rng, "fr", n)
    soc = companies(rng, n, ["Atelier", "Cabinet", "Groupe", "Laboratoires", "Studio", "Imprimerie", "Transports"],
                    ["Vernet", "Lacombe", "Delorme", "Rivière", "Aubert", "Collin", "Barre"])
    st = deal(rng, n, [("Actif - grand compte", 6), ("Suspendu (impayé)", 4), ("Résilié", 4), ("Prospect", 3)], "Actif")
    pay = deal(rng, n, [("Relance", 7), ("Contentieux", 3)], "À jour")
    form = deal(rng, n, [("Confort", 10), ("Premium 24/7", 6)], "Essentiel")
    lang = deal(rng, n, [("EN", 6), ("DE", 3), (None, 2), (MISSING, 2)], "FR")
    sec = deal(rng, n, [(None, 6), (MISSING, 5)], 1)
    port = deal(rng, n, [(None, 3), (MISSING, 2)], 1)
    ec = deal(rng, n, [("mix", 9), ("pad", 3)], "lo")
    sp = deal(rng, n, [(1, 7)], 0)
    cons = ["Nadia Perrot", "Olivier Gaillard", "Sylvie Brun"]
    asst = people(rng, "fr", n)
    recs = []
    for i in range(n):
        f, l = ppl[i]
        af, al = asst[i]
        recs.append({
            "num_client": f"CL-{3010 + i * 4 + rng.randint(0, 2)}", "id_fiche": rng.randint(400000, 499999), "ligne": i + 1,
            "societe": {"raison_sociale": pad(rng, soc[i]) if sp[i] else soc[i], "siret": f"{rng.randint(100, 999)} {rng.randint(100, 999)} {rng.randint(100, 999)} {rng.randint(10000, 99999)}"},
            "contact": {"prenom": f, "nom": l, "coordonnees": {
                "email": em(rng, ec[i], mail([f, l], "pro.example.com")),
                "email_secondaire": opt(sec[i], mail([f, l], "perso.example.org")),
                "portable": opt(port[i], f"06 {rng.randint(10, 99)} {rng.randint(10, 99)} {rng.randint(10, 99)} {rng.randint(10, 99)}")}},
            "assistante": {"nom": f"{af} {al}", "email": mixcase(mail([af, al], "pro.example.com")) if rng.random() < 0.3 else mail([af, al], "pro.example.com")},
            "conseiller": rng.choice(cons),
            "statut_compte": st[i], "statut_paiement": pay[i], "formule": form[i], "langue": lang[i],
            "date_ouverture": fmt(rdate(rng, "2014-01-01", "2025-08-31"), "DD/MM/YYYY"),
            "date_dernier_voyage": fmt(rdate(rng, "2025-01-01", "2026-10-31"), "DD/MM/YYYY"),
        })
    return recs


SC.append(dict(
    id="business-travel-agency-accounts-to-service-desk-requesters", track="wedge", lang="fr", n=34,
    industry="corporate travel agency client accounts",
    desc="Client-account export of a fictional business travel agency (French snake_case CRM, nested company and contact with a nested contact-details block) to be loaded as service-desk requesters.",
    completable=True, gen=gen_w4,
    dest=schema({
        "id": P("string", "Stable identifier of the requester's account in the source system."),
        "displayName": P("string", "Name shown on tickets: given name followed by family name."),
        "primaryEmail": P("string", "Work email the requester uses to contact the agency.", fmt_="email"),
        "secondaryEmail": P("string", "Alternative personal address of the requester, used only if the work address bounces.", fmt_="email"),
        "phone": P("string", "Mobile number of the requester for urgent travel changes."),
        "company": P("string", "Client company the requester travels for."),
        "status": P("string", "Account state of the client company.", enum=["active", "suspended", "closed"]),
        "supportPlan": P("string", "Assistance package the client has bought, which sets opening hours.", enum=["standard", "extended", "round_the_clock"]),
        "language": P("string", "Language.", enum=["fr", "en", "de"]),
        "customerSince": P("string", "Date the client account was opened.", fmt_="date"),
        "travelPolicy": P("string", "Travel policy that applies to the requester's bookings."),
    }, ["id", "displayName", "primaryEmail", "status", "supportPlan"]),
    gt={
        "id": {"source": "num_client", "transform": "copy", "why": "client number; id_fiche is the CRM record key and ligne the export row"},
        "displayName": {"source": None, "sources": ["contact.prenom", "contact.nom"], "transform": "concat", "separator": " ", "why": "client contact names; assistante.nom is the assistant who books and conseiller the agency's consultant"},
        "primaryEmail": {"source": "contact.coordonnees.email", "transform": "normalize_email", "why": "work email, mixed case and padded; assistante.email belongs to the assistant"},
        "secondaryEmail": {"source": "contact.coordonnees.email_secondaire", "transform": "normalize_email", "why": "personal address, null or missing for some"},
        "phone": {"source": "contact.coordonnees.portable", "transform": "copy", "why": "mobile, null or missing for some"},
        "company": {"source": "societe.raison_sociale", "transform": "trim", "why": "company name, padded"},
        "status": {"source": "statut_compte", "transform": "map_enum", "categoryMap": {"Actif": "active", "Actif - grand compte": "active", "Suspendu (impayé)": "suspended", "Résilié": "closed", "Prospect": None}, "why": "account state; prospects need review; statut_paiement is payment"},
        "supportPlan": {"source": "formule", "transform": "map_enum", "categoryMap": {"Essentiel": "standard", "Confort": "extended", "Premium 24/7": "round_the_clock"}, "why": "assistance package"},
        "language": {"source": "langue", "transform": "map_enum", "categoryMap": {"FR": "fr", "EN": "en", "DE": "de"}, "why": "language, null or missing for some"},
        "customerSince": {"source": "date_ouverture", "transform": "parse_date", "dateFormat": "DD/MM/YYYY", "why": "account opening (French day-first); date_dernier_voyage is the last trip"},
        "travelPolicy": {"source": None, "transform": "none", "why": "no travel policy is exported"},
    },
    pairs=[
        {"kind": "customer-id-vs-transaction-id", "fields": ["num_client", "id_fiche"], "correctFor": "id"},
        {"kind": "nested-entity-relationship", "fields": ["contact.coordonnees.email", "assistante.email"], "correctFor": "primaryEmail"},
        {"kind": "nested-entity-relationship", "fields": ["contact.coordonnees.email", "contact.coordonnees.email_secondaire"], "correctFor": "primaryEmail"},
        {"kind": "nested-entity-relationship", "fields": ["contact.prenom", "assistante.nom"], "correctFor": "displayName"},
        {"kind": "competing-category-fields", "fields": ["statut_compte", "statut_paiement"], "correctFor": "status"},
        {"kind": "modified-date-vs-created-date", "fields": ["date_ouverture", "date_dernier_voyage"], "correctFor": "customerSince"},
    ],
    sc={"num_client": "customer-id", "id_fiche": "other-identifier", "ligne": "other-identifier",
        "societe.raison_sociale": "organization-name", "societe.siret": "other-identifier",
        "contact.prenom": "given-name", "contact.nom": "family-name", "contact.coordonnees.email": "email",
        "contact.coordonnees.email_secondaire": "email", "contact.coordonnees.portable": "phone",
        "assistante.nom": "person-name", "assistante.email": "email", "conseiller": "person-name",
        "statut_compte": "account-status", "statut_paiement": "payment-status", "formule": "category", "langue": "language-code",
        "date_ouverture": "start-date", "date_dernier_voyage": "other"},
    dc={"id": "customer-id", "displayName": "person-name", "primaryEmail": "email", "secondaryEmail": "email", "phone": "phone",
        "company": "organization-name", "status": "account-status", "supportPlan": "category", "language": "language-code",
        "customerSince": "start-date", "travelPolicy": "other"},
))


# ---------------------------------------------------------------- W5 es, 3-segment, ambiguous dates
def gen_w5(rng, n):
    ppl = people(rng, "es", n)
    streets = ["Avenida del Puerto", "Calle Mayor", "Plaza de la Fuente", "Calle Olmos", "Paseo Marítimo", "Calle Sol",
               "Ronda Norte", "Calle Cerezo", "Avenida Castilla", "Calle Prado", "Calle Real", "Travesía Molino"]
    com = [rng.choice(["C.P.", "Comunidad de Propietarios"]) + " " + x
           for x in companies(rng, n, streets, [str(k) for k in (2, 5, 8, 12, 15, 21, 27, 33, 41, 58)])]
    st = deal(rng, n, [("Vigente - renovación pendiente", 5), ("Suspendido", 4), ("Rescindido", 4), ("Presupuesto enviado", 3)], "Vigente")
    cob = deal(rng, n, [("Pendiente", 7), ("Impagado", 4)], "Al corriente")
    tipo = deal(rng, n, [("Mantenimiento integral", 10), ("Todo riesgo", 6)], "Mantenimiento básico")
    mov = deal(rng, n, [(None, 4), (MISSING, 3)], 1)
    ec = deal(rng, n, [("mix", 8), ("up", 2), ("pad", 2)], "lo")
    cp = deal(rng, n, [(1, 6)], 0)
    adm = [("Rosa Calderón", "rcalderon@fincas-levante.example.org"), ("Tomás Aguirre", "taguirre@gestion-aguirre.example.net"),
           ("Beatriz Lozano", "blozano@fincas-levante.example.org")]
    mun = ["Alicante", "Elche", "San Vicente", "Torrevieja"]
    recs = []
    for i in range(n):
        f, l = ppl[i]
        a = rng.choice(adm)
        recs.append({
            "CodigoCliente": f"ASC-{5500 + i * 6 + rng.randint(0, 4)}", "IdContrato": f"CT-{rng.randint(2015, 2025)}-{rng.randint(100, 999)}",
            "NumFila": i + 1,
            "Comunidad": {"Nombre": pad(rng, com[i]) if cp[i] else com[i], "Direccion": {"Municipio": rng.choice(mun)}},
            "Presidente": {"Nombre": f, "Apellidos": l,
                           "Email": em(rng, ec[i], mail([f, l], "correo.example.com")),
                           "Movil": opt(mov[i], f"6{rng.randint(10, 99)} {rng.randint(100, 999)} {rng.randint(100, 999)}")},
            "Administrador": {"Nombre": a[0], "Email": a[1]},
            "EstadoContrato": st[i], "EstadoCobro": cob[i], "TipoContrato": tipo[i],
            "FechaInicio": fmt(rdate(rng, "2008-01-01", "2025-06-30", amb=True), "DD/MM/YYYY"),
            "FechaVencimiento": fmt(rdate(rng, "2026-01-01", "2028-12-31", amb=True), "DD/MM/YYYY"),
            "NumAscensores": rng.choice([1, 1, 2, 2, 3, 4]),
        })
    return recs


SC.append(dict(
    id="lift-maintenance-communities-to-helpdesk-customers", track="wedge", lang="es", n=36,
    industry="lift maintenance company residential community accounts",
    desc="Customer-account export of a fictional lift maintenance company (Spanish PascalCase, nested community, president and property administrator) to be loaded as helpdesk customers.",
    completable=True, gen=gen_w5,
    dest=schema({
        "external_id": P("string", "Identifier of the customer at the maintenance company."),
        "name": P("string", "Full name of the person who reports issues for the customer."),
        "email": P("string", "Email address of that person.", fmt_="email"),
        "phone": P("string", "Mobile number for breakdown callbacks."),
        "organization": P("string", "Name of the residential community or building the customer represents."),
        "status": P("string", "Whether the maintenance contract is in force, on hold or terminated.", enum=["active", "on_hold", "terminated"]),
        "custom_fields": OBJ({
            "plan": P("string", "Maintenance contract type, which sets what repairs are covered.", enum=["basic", "full", "all_risk"]),
            "lift_count": P("integer", "Number of lifts covered by the contract."),
            "contract_start": P("string", "Date.", fmt_="date"),
            "contract_years": P("integer", "Full years the customer has held a contract."),
        }, None, "Account-specific fields."),
        "time_zone": P("string"),
    }, ["external_id", "name", "email", "status"]),
    gt={
        "external_id": {"source": "CodigoCliente", "transform": "copy", "why": "customer code; IdContrato is the contract and NumFila the export row"},
        "name": {"source": None, "sources": ["Presidente.Nombre", "Presidente.Apellidos"], "transform": "concat", "separator": " ", "why": "community president; Administrador.Nombre is the external property administrator"},
        "email": {"source": "Presidente.Email", "transform": "normalize_email", "why": "president email, mixed case and padded; Administrador.Email belongs to the administrator"},
        "phone": {"source": "Presidente.Movil", "transform": "copy", "why": "mobile, null or missing for some"},
        "organization": {"source": "Comunidad.Nombre", "transform": "trim", "why": "community name, padded"},
        "status": {"source": "EstadoContrato", "transform": "map_enum", "categoryMap": {"Vigente": "active", "Vigente - renovación pendiente": "active", "Suspendido": "on_hold", "Rescindido": "terminated", "Presupuesto enviado": None}, "why": "contract state; a sent quote is not a customer and needs review; EstadoCobro is collection"},
        "custom_fields.plan": {"source": "TipoContrato", "transform": "map_enum", "categoryMap": {"Mantenimiento básico": "basic", "Mantenimiento integral": "full", "Todo riesgo": "all_risk"}, "why": "contract type"},
        "custom_fields.lift_count": {"source": "NumAscensores", "transform": "copy", "why": "number of lifts"},
        "custom_fields.contract_start": {"source": "FechaInicio", "transform": "parse_date", "dateFormat": "DD/MM/YYYY", "why": "contract start (Spanish day-first); FechaVencimiento is the expiry"},
        "custom_fields.contract_years": {"source": None, "transform": "none", "why": "not exported", "unsupportedReason": "would need the number of full years between FechaInicio and the import date"},
        "time_zone": {"source": None, "transform": "none", "why": "no time zone is exported"},
    },
    pairs=[
        {"kind": "customer-id-vs-transaction-id", "fields": ["CodigoCliente", "IdContrato"], "correctFor": "external_id"},
        {"kind": "nested-entity-relationship", "fields": ["Presidente.Email", "Administrador.Email"], "correctFor": "email"},
        {"kind": "nested-entity-relationship", "fields": ["Presidente.Nombre", "Administrador.Nombre"], "correctFor": "name"},
        {"kind": "competing-category-fields", "fields": ["EstadoContrato", "EstadoCobro"], "correctFor": "status"},
        {"kind": "modified-date-vs-created-date", "fields": ["FechaInicio", "FechaVencimiento"], "correctFor": "custom_fields.contract_start"},
    ],
    sc={"CodigoCliente": "customer-id", "IdContrato": "transaction-id", "NumFila": "other-identifier",
        "Comunidad.Nombre": "organization-name", "Comunidad.Direccion.Municipio": "city",
        "Presidente.Nombre": "given-name", "Presidente.Apellidos": "family-name", "Presidente.Email": "email", "Presidente.Movil": "phone",
        "Administrador.Nombre": "person-name", "Administrador.Email": "email", "EstadoContrato": "account-status",
        "EstadoCobro": "payment-status", "TipoContrato": "category", "FechaInicio": "start-date", "FechaVencimiento": "end-date",
        "NumAscensores": "quantity"},
    dc={"external_id": "customer-id", "name": "person-name", "email": "email", "phone": "phone", "organization": "organization-name",
        "status": "account-status", "custom_fields.plan": "category", "custom_fields.lift_count": "quantity",
        "custom_fields.contract_start": "start-date", "custom_fields.contract_years": "quantity", "time_zone": "other"},
))


# ---------------------------------------------------------------- W6 it, flat, required email null in some rows
def gen_w6(rng, n):
    ppl = people(rng, "it", n)
    rs = companies(rng, n, ["Officine", "Logistica", "Tessitura", "Studio", "Meccanica", "Farmaceutica", "Cartiera"],
                   ["Bassi S.r.l.", "Valli S.p.A.", "Orsini S.r.l.", "Fabbri S.n.c.", "Ruggeri S.r.l.", "Pellegrini S.p.A."])
    st = deal(rng, n, [("Sospeso", 4), ("Cessato", 4), ("Prova gratuita", 4), ("Da verificare", 3)], "Attivo")
    pag = deal(rng, n, [("Insoluto", 5), ("RID respinto", 3)], "Regolare")
    srv = deal(rng, n, [("Buoni pasto", 8), ("Coffee break & eventi", 5)], "Mensa aziendale")
    tel = deal(rng, n, [(None, 4), (MISSING, 3)], 1)
    enull = deal(rng, n, [(None, 2)], 1)
    ec = deal(rng, n, [("mix", 8), ("up", 2)], "lo")
    rp = deal(rng, n, [(1, 7)], 0)
    com = ["Gianni Ferraro", "Laura Benedetti", "Stefano Cattaneo"]
    recs = []
    for i in range(n):
        f, l = ppl[i]
        dom = rs[i].split()[1].lower()
        recs.append({
            "cf_codice_cliente": f"CAT-{870 + i * 3:04d}", "id_riga": i + 1, "partita_iva": f"IT0{rng.randint(1000000000, 9999999999)}",
            "ragione_sociale": pad(rng, rs[i]) if rp[i] else rs[i],
            "referente_nome": f, "referente_cognome": l,
            "referente_email": opt(enull[i], em(rng, ec[i], mail([f, l], f"{dom}.example.com"))),
            "email_pec": f"amministrazione@pec.{dom}.example.net",
            "referente_tel": opt(tel[i], f"3{rng.randint(20, 49)} {rng.randint(1000000, 9999999)}"),
            "commerciale": rng.choice(com), "stato_cliente": st[i], "stato_pagamenti": pag[i], "tipo_servizio": srv[i],
            "n_coperti": rng.randint(15, 400),
            "data_attivazione": fmt(rdate(rng, "2016-01-01", "2025-09-30"), "DD/MM/YYYY"),
            "data_ultimo_ordine": fmt(rdate(rng, "2026-06-01", "2026-11-10"), "DD/MM/YYYY"),
            "consenso_marketing": rng.choice(["Sì", "No"]),
        })
    return recs


SC.append(dict(
    id="corporate-catering-clients-to-helpdesk-requesters", track="wedge", lang="it", n=31,
    industry="corporate catering company business clients",
    desc="Flat client export of a fictional corporate catering company (Italian snake_case with a cf_ custom-field prefix) to be loaded as helpdesk requesters with their organization.",
    completable=True, gen=gen_w6,
    dest=schema({
        "external_ref": P("string", "Reference of the client in the caterer's own records."),
        "name": P("string", "Full name of the client's contact person."),
        "email": P("string", "Personal work email of the contact person.", fmt_="email"),
        "phone": P("string", "Phone number of the contact person."),
        "organization": OBJ({
            "name": P("string", "Registered name of the client company."),
            "service": P("string", "Catering service the client buys.", enum=["canteen", "vouchers", "events"]),
        }, ["name"], "Client company."),
        "status": P("string", "Status.", enum=["active", "suspended", "churned"]),
        "customer_since": P("string", "Date the client's first service was activated.", fmt_="date"),
        "annual_value_eur": P("number", "Expected yearly revenue from the client in euros."),
    }, ["external_ref", "name", "email", "organization", "status"]),
    gt={
        "external_ref": {"source": "cf_codice_cliente", "transform": "copy", "why": "client code; partita_iva is the VAT number and id_riga the export row"},
        "name": {"source": None, "sources": ["referente_nome", "referente_cognome"], "transform": "concat", "separator": " ", "why": "contact person; commerciale is the caterer's sales rep"},
        "email": {"source": "referente_email", "transform": "normalize_email", "why": "contact email, mixed case; null in a few rows, which are held; email_pec is the company's certified mailbox"},
        "phone": {"source": "referente_tel", "transform": "copy", "why": "phone, null or missing for some"},
        "organization.name": {"source": "ragione_sociale", "transform": "trim", "why": "company name, padded"},
        "organization.service": {"source": "tipo_servizio", "transform": "map_enum", "categoryMap": {"Mensa aziendale": "canteen", "Buoni pasto": "vouchers", "Coffee break & eventi": "events"}, "why": "service type"},
        "status": {"source": "stato_cliente", "transform": "map_enum", "categoryMap": {"Attivo": "active", "Prova gratuita": "active", "Sospeso": "suspended", "Cessato": "churned", "Da verificare": None}, "why": "client state; rows to verify need review; stato_pagamenti is payment"},
        "customer_since": {"source": "data_attivazione", "transform": "parse_date", "dateFormat": "DD/MM/YYYY", "why": "activation date (Italian day-first); data_ultimo_ordine is the last order"},
        "annual_value_eur": {"source": None, "transform": "none", "why": "not exported", "unsupportedReason": "would need covers per day multiplied by a price per cover and the number of working days"},
    },
    pairs=[
        {"kind": "customer-id-vs-transaction-id", "fields": ["cf_codice_cliente", "partita_iva"], "correctFor": "external_ref"},
        {"kind": "customer-id-vs-transaction-id", "fields": ["cf_codice_cliente", "id_riga"], "correctFor": "external_ref"},
        {"kind": "nested-entity-relationship", "fields": ["referente_email", "email_pec"], "correctFor": "email"},
        {"kind": "nested-entity-relationship", "fields": ["referente_nome", "commerciale"], "correctFor": "name"},
        {"kind": "competing-category-fields", "fields": ["stato_cliente", "stato_pagamenti"], "correctFor": "status"},
        {"kind": "modified-date-vs-created-date", "fields": ["data_attivazione", "data_ultimo_ordine"], "correctFor": "customer_since"},
    ],
    sc={"cf_codice_cliente": "customer-id", "id_riga": "other-identifier", "partita_iva": "other-identifier",
        "ragione_sociale": "organization-name", "referente_nome": "given-name", "referente_cognome": "family-name",
        "referente_email": "email", "email_pec": "email", "referente_tel": "phone", "commerciale": "person-name",
        "stato_cliente": "account-status", "stato_pagamenti": "payment-status", "tipo_servizio": "category",
        "n_coperti": "quantity", "data_attivazione": "start-date", "data_ultimo_ordine": "other", "consenso_marketing": "consent-flag"},
    dc={"external_ref": "customer-id", "name": "person-name", "email": "email", "phone": "phone", "organization.name": "organization-name",
        "organization.service": "category", "status": "account-status", "customer_since": "start-date", "annual_value_eur": "amount"},
))


# ---------------------------------------------------------------- W7 nl, NOT completable (parent mobile missing)
def gen_w7(rng, n):
    ppl = people(rng, "nl", n)
    kids = ["Noor", "Finn", "Julia", "Levi", "Tess", "Luuk", "Saar", "Mees", "Fenna", "Jesse", "Roos", "Siem", "Lotte", "Bas", "Isa"]
    nood = people(rng, "nl", n)
    st = deal(rng, n, [("Wachtlijst", 6), ("Opgezegd", 4), ("Intake gepland", 3)], "Geplaatst")
    bet = deal(rng, n, [("Achterstand", 5), ("Incasso gestorneerd", 3)], "Betaald")
    loc = deal(rng, n, [("BSO Het Kompas", 9), ("KDV Kleine Reus", 8)], "KDV De Speelboom")
    sec = deal(rng, n, [(None, 8), (MISSING, 4)], 1)
    ec = deal(rng, n, [("mix", 8), ("up", 2)], "lo")
    ap = deal(rng, n, [(1, 6)], 0)
    pm = ["Yvonne Kramer", "Hanneke Post", "Marloes Timmer"]
    recs = []
    for i in range(n):
        f, l = ppl[i]
        nf, nl_ = nood[i]
        recs.append({
            "relatieNummer": f"R-{40010 + i * 4 + rng.randint(0, 2)}", "contractNummer": f"PC-{rng.randint(2020, 2026)}-{rng.randint(1000, 9999)}",
            "regel": i + 1,
            "ouder": {"voornaam": f, "achternaam": pad(rng, l) if ap[i] else l,
                      "email": em(rng, ec[i], mail([f, l], "thuis.example.net")),
                      "tweedeEmail": opt(sec[i], mail([rng.choice(NL_F2), l], "thuis.example.net"))},
            "kind": {"voornaam": rng.choice(kids), "geboortedatum": fmt(rdate(rng, "2019-01-01", "2025-06-30", amb=True), "DD/MM/YYYY")},
            "noodcontact": {"naam": f"{nf} {nl_}", "telefoon": f"06-{rng.randint(10000000, 99999999)}"},
            "locatie": loc[i], "locatieTelefoon": LOC_TEL[loc[i]], "pedagogischMedewerker": rng.choice(pm),
            "plaatsingsstatus": st[i], "betaalstatus": bet[i],
            "startdatum": fmt(rdate(rng, "2020-01-01", "2026-09-30", amb=True), "DD/MM/YYYY"),
        })
    return recs


NL_F2 = ["Mark", "Tim", "Linda", "Kim", "Rob", "Petra"]
LOC_TEL = {"KDV De Speelboom": "030-2961144", "BSO Het Kompas": "030-2967081", "KDV Kleine Reus": "030-2965530"}

SC.append(dict(
    id="childcare-parent-accounts-to-helpdesk-contacts", track="wedge", lang="nl", n=27,
    industry="childcare centre parent accounts",
    desc="Parent-account export of a fictional childcare organisation (Dutch camelCase, nested parent, child and emergency contact) to be loaded as helpdesk contacts; the parents' mobile numbers are not exported.",
    completable=False, gen=gen_w7,
    dest=schema({
        "external_id": P("string", "Identifier of the parent's account at the childcare organisation."),
        "contact": OBJ({
            "first_name": P("string", "Given name of the parent."),
            "last_name": P("string", "Family name of the parent."),
        }, ["first_name", "last_name"], "Name of the contact."),
        "email": P("string", "Email address of the parent who holds the account.", fmt_="email"),
        "mobile_phone": P("string", "Mobile number of the parent; used for text messages about the child's day."),
        "site": P("string", "Childcare location the family uses.", enum=["speelboom", "kompas", "kleine_reus"]),
        "status": P("string", "Placement state of the family's childcare contract.", enum=["active", "waitlist", "ended"]),
        "customer_since": P("string", "Date the childcare placement started.", fmt_="date"),
        "language": P("string", "Language."),
    }, ["external_id", "contact", "email", "mobile_phone", "status"]),
    gt={
        "external_id": {"source": "relatieNummer", "transform": "copy", "why": "relation number; contractNummer is the placement contract and regel the export row"},
        "contact.first_name": {"source": "ouder.voornaam", "transform": "copy", "why": "parent given name; kind.voornaam is the child and pedagogischMedewerker the mentor"},
        "contact.last_name": {"source": "ouder.achternaam", "transform": "trim", "why": "parent family name, padded"},
        "email": {"source": "ouder.email", "transform": "normalize_email", "why": "parent email, mixed case; tweedeEmail is the other parent's"},
        "mobile_phone": {"source": None, "transform": "none", "why": "the parent's mobile is not exported; noodcontact.telefoon belongs to the emergency contact and locatieTelefoon is the site's landline"},
        "site": {"source": "locatie", "transform": "map_enum", "categoryMap": {"KDV De Speelboom": "speelboom", "BSO Het Kompas": "kompas", "KDV Kleine Reus": "kleine_reus"}, "why": "location"},
        "status": {"source": "plaatsingsstatus", "transform": "map_enum", "categoryMap": {"Geplaatst": "active", "Wachtlijst": "waitlist", "Opgezegd": "ended", "Intake gepland": None}, "why": "placement state; a planned intake needs review; betaalstatus is payment"},
        "customer_since": {"source": "startdatum", "transform": "parse_date", "dateFormat": "DD/MM/YYYY", "why": "placement start (Dutch day-first); kind.geboortedatum is the child's birth date"},
        "language": {"source": None, "transform": "none", "why": "no language is exported"},
    },
    pairs=[
        {"kind": "decoy-for-missing-field", "fields": ["noodcontact.telefoon", "locatieTelefoon"], "correctFor": "mobile_phone"},
        {"kind": "customer-id-vs-transaction-id", "fields": ["relatieNummer", "contractNummer"], "correctFor": "external_id"},
        {"kind": "nested-entity-relationship", "fields": ["ouder.voornaam", "kind.voornaam"], "correctFor": "contact.first_name"},
        {"kind": "nested-entity-relationship", "fields": ["ouder.email", "ouder.tweedeEmail"], "correctFor": "email"},
        {"kind": "competing-category-fields", "fields": ["plaatsingsstatus", "betaalstatus"], "correctFor": "status"},
        {"kind": "birth-date-vs-start-date", "fields": ["startdatum", "kind.geboortedatum"], "correctFor": "customer_since"},
    ],
    sc={"relatieNummer": "customer-id", "contractNummer": "transaction-id", "regel": "other-identifier",
        "ouder.voornaam": "given-name", "ouder.achternaam": "family-name", "ouder.email": "email", "ouder.tweedeEmail": "email",
        "kind.voornaam": "person-name", "kind.geboortedatum": "birth-date", "noodcontact.naam": "person-name",
        "noodcontact.telefoon": "phone", "locatie": "category", "locatieTelefoon": "phone", "pedagogischMedewerker": "person-name",
        "plaatsingsstatus": "account-status", "betaalstatus": "payment-status", "startdatum": "start-date"},
    dc={"external_id": "customer-id", "contact.first_name": "given-name", "contact.last_name": "family-name", "email": "email",
        "mobile_phone": "phone", "site": "category", "status": "account-status", "customer_since": "start-date", "language": "language-code"},
))


# ---------------------------------------------------------------- W8 pt
def gen_w8(rng, n):
    ppl = people(rng, "pt", n)
    st = deal(rng, n, [("Ativo - época alta", 6), ("Suspenso", 4), ("Cancelado", 4), ("Orçamento", 3)], "Ativo")
    pag = deal(rng, n, [("Em atraso", 6), ("Débito direto falhado", 3)], "Pago")
    tp = deal(rng, n, [("Interior aquecida", 7), ("Condomínio", 6), (None, 2), (MISSING, 2)], "Exterior")
    pl = deal(rng, n, [("Visita semanal", 10), ("Só inverno", 5)], "Visita quinzenal")
    tm = deal(rng, n, [(None, 3), (MISSING, 3)], 1)
    ec = deal(rng, n, [("mix", 9), ("pad", 2)], "lo")
    np_ = deal(rng, n, [(1, 7)], 0)
    tec = ["Hugo Fonseca", "Vasco Nunes", "Filipe Araújo"]
    recs = []
    for i in range(n):
        f, l = ppl[i]
        full = f"{f} {l}"
        recs.append({
            "codigoCliente": f"PSC-{2200 + i * 5 + rng.randint(0, 3)}", "nifCliente": f"{rng.randint(100000000, 299999999)}", "linha": i + 1,
            "cliente": {"nomeCompleto": pad(rng, full) if np_[i] else full,
                        "email": em(rng, ec[i], mail([f, l], "casa.example.org")),
                        "emailFaturacao": mail(["faturas", l], "contas.example.net"),
                        "telemovel": opt(tm[i], f"9{rng.randint(10, 69)} {rng.randint(100, 999)} {rng.randint(100, 999)}")},
            "tecnico": rng.choice(tec), "estadoConta": st[i], "estadoPagamento": pag[i], "tipoPiscina": tp[i], "plano": pl[i],
            "dataAdesao": fmt(rdate(rng, "2014-01-01", "2025-08-31"), "DD/MM/YYYY"),
            "dataProximaVisita": fmt(rdate(rng, "2026-11-19", "2026-12-31"), "DD/MM/YYYY"),
            "volumeM3": rng.choice([24.0, 32.5, 40.0, 48.0, 60.0, 75.5]),
            "consentimentoRGPD": rng.choice(["Sim", "Não"]),
        })
    return recs


SC.append(dict(
    id="pool-maintenance-clients-to-helpdesk-customers", track="wedge", lang="pt", n=33,
    industry="swimming pool maintenance service clients",
    desc="Client export of a fictional pool maintenance company (Portuguese camelCase, nested client block) to be loaded as helpdesk customers.",
    completable=True, gen=gen_w8,
    dest=schema({
        "externalId": P("string", "Identifier of the customer in the company's own records."),
        "name": P("string", "Full name of the customer."),
        "contact": OBJ({
            "email": P("string", "Personal email address of the customer.", fmt_="email"),
            "phone": P("string", "Mobile number of the customer."),
        }, ["email"], "How to reach the customer."),
        "status": P("string", "Account state of the customer.", enum=["active", "paused", "cancelled"]),
        "plan": P("string", "Visit plan the customer subscribes to.", enum=["biweekly", "weekly", "winter_only"]),
        "poolType": P("string", "Kind of pool that is maintained.", enum=["outdoor", "indoor", "shared"]),
        "customerSince": P("string", "Date the customer joined.", fmt_="date"),
        "preferredVisitDay": P("string"),
        "poolVolumeLitres": P("number", "Volume."),
    }, ["externalId", "name", "contact", "status", "plan"]),
    gt={
        "externalId": {"source": "codigoCliente", "transform": "copy", "why": "client code; nifCliente is the tax number and linha the export row"},
        "name": {"source": "cliente.nomeCompleto", "transform": "trim", "why": "full name, padded; tecnico is the technician"},
        "contact.email": {"source": "cliente.email", "transform": "normalize_email", "why": "personal email, mixed case and padded; emailFaturacao is for invoices"},
        "contact.phone": {"source": "cliente.telemovel", "transform": "copy", "why": "mobile, null or missing for some"},
        "status": {"source": "estadoConta", "transform": "map_enum", "categoryMap": {"Ativo": "active", "Ativo - época alta": "active", "Suspenso": "paused", "Cancelado": "cancelled", "Orçamento": None}, "why": "account state; a quote is not a customer yet; estadoPagamento is payment"},
        "plan": {"source": "plano", "transform": "map_enum", "categoryMap": {"Visita quinzenal": "biweekly", "Visita semanal": "weekly", "Só inverno": "winter_only"}, "why": "visit plan"},
        "poolType": {"source": "tipoPiscina", "transform": "map_enum", "categoryMap": {"Exterior": "outdoor", "Interior aquecida": "indoor", "Condomínio": "shared"}, "why": "pool type, null or missing for some"},
        "customerSince": {"source": "dataAdesao", "transform": "parse_date", "dateFormat": "DD/MM/YYYY", "why": "join date (Portuguese day-first); dataProximaVisita is the next visit"},
        "preferredVisitDay": {"source": None, "transform": "none", "why": "not exported"},
        "poolVolumeLitres": {"source": None, "transform": "none", "why": "only cubic metres are exported", "unsupportedReason": "would need volumeM3 multiplied by 1000"},
    },
    pairs=[
        {"kind": "customer-id-vs-transaction-id", "fields": ["codigoCliente", "nifCliente"], "correctFor": "externalId"},
        {"kind": "customer-id-vs-transaction-id", "fields": ["codigoCliente", "linha"], "correctFor": "externalId"},
        {"kind": "nested-entity-relationship", "fields": ["cliente.email", "cliente.emailFaturacao"], "correctFor": "contact.email"},
        {"kind": "nested-entity-relationship", "fields": ["cliente.nomeCompleto", "tecnico"], "correctFor": "name"},
        {"kind": "competing-category-fields", "fields": ["estadoConta", "estadoPagamento"], "correctFor": "status"},
        {"kind": "modified-date-vs-created-date", "fields": ["dataAdesao", "dataProximaVisita"], "correctFor": "customerSince"},
    ],
    sc={"codigoCliente": "customer-id", "nifCliente": "other-identifier", "linha": "other-identifier",
        "cliente.nomeCompleto": "person-name", "cliente.email": "email", "cliente.emailFaturacao": "email", "cliente.telemovel": "phone",
        "tecnico": "person-name", "estadoConta": "account-status", "estadoPagamento": "payment-status", "tipoPiscina": "category",
        "plano": "category", "dataAdesao": "start-date", "dataProximaVisita": "other", "volumeM3": "quantity",
        "consentimentoRGPD": "consent-flag"},
    dc={"externalId": "customer-id", "name": "person-name", "contact.email": "email", "contact.phone": "phone",
        "status": "account-status", "plan": "category", "poolType": "category", "customerSince": "start-date",
        "preferredVisitDay": "other", "poolVolumeLitres": "quantity"},
))


# ---------------------------------------------------------------- W9 pl, flat, ambiguous dates, net vs gross
def gen_w9(rng, n):
    ppl = people(rng, "pl", n)
    naz = companies(rng, n, ["Bud-", "Dach-", "Termo-", "Instal-", "Mur-", "Eko-"], ["Pol Sp. z o.o.", "Max s.c.", "Bis Sp.j.", "Tech Sp. z o.o.", "Serwis", "Dom S.A."], "{}{}")
    st = deal(rng, n, [("Zablokowany – limit kredytowy", 5), ("Nieaktywny", 4), ("Do weryfikacji", 3)], "Aktywny")
    pay = deal(rng, n, [("Przeterminowane", 6), ("Windykacja", 3)], "Terminowo")
    grp = deal(rng, n, [("Hurt A", 8), ("Hurt B", 7), ("Kluczowy", 4)], "Detal")
    br = deal(rng, n, [("Deweloper", 9), ("Sklep", 6)], "Wykonawca")
    tel = deal(rng, n, [(None, 4), (MISSING, 3)], 1)
    ec = deal(rng, n, [("mix", 8), ("up", 3)], "lo")
    kp = deal(rng, n, [(1, 7)], 0)
    han = ["Grzegorz Sowa", "Iwona Majewska", "Robert Cieślak"]
    recs = []
    for i in range(n):
        f, l = ppl[i]
        net = round(rng.choice([5, 10, 15, 20, 25, 40, 50, 75, 100]) * 1000.0, 2)
        dom = naz[i].split("-")[0].lower()
        recs.append({
            "kh_id_kontrahenta": f"K-{2300 + i * 7 + rng.randint(0, 5):06d}", "kh_nip": f"{rng.randint(100, 999)}-{rng.randint(100, 999)}-{rng.randint(10, 99)}-{rng.randint(10, 99)}",
            "lp": i + 1, "kh_nazwa": pad(rng, naz[i]) if kp[i] else naz[i],
            "os_imie": f, "os_nazwisko": l,
            "os_email": em(rng, ec[i], mail([f, l], f"{dom}.example.com")),
            "kh_email_faktury": f"faktury@{dom}.example.com",
            "os_telefon": opt(tel[i], f"+48 {rng.randint(500, 799)} {rng.randint(100, 999)} {rng.randint(100, 999)}"),
            "handlowiec": rng.choice(han), "status_kontrahenta": st[i], "status_platnosci": pay[i],
            "grupa_rabatowa": grp[i], "branza": br[i],
            "data_rejestracji": fmt(rdate(rng, "2012-01-01", "2025-09-30", amb=True), "DD/MM/YYYY"),
            "data_ostatniej_faktury": fmt(rdate(rng, "2026-01-01", "2026-11-12", amb=True), "DD/MM/YYYY"),
            "limit_kredytowy_netto": net, "limit_kredytowy_brutto": round(net * 1.23, 2),
        })
    return recs


SC.append(dict(
    id="building-materials-trade-accounts-to-helpdesk-contacts", track="wedge", lang="pl", n=35,
    industry="building materials wholesaler trade accounts",
    desc="Flat trade-account export of a fictional building materials wholesaler (Polish snake_case with kh_ and os_ prefixes) to be loaded as helpdesk contacts.",
    completable=True, gen=gen_w9,
    dest=schema({
        "external_id": P("string", "Identifier of the trade account in the wholesaler's system."),
        "company_name": P("string", "Name of the trading company."),
        "first_name": P("string", "Given name of the contact person at the company."),
        "last_name": P("string", "Family name of the contact person at the company."),
        "email": P("string", "Email address of the contact person.", fmt_="email"),
        "phone": P("string", "Phone number of the contact person."),
        "status": P("string", "Whether the account may place orders.", enum=["active", "blocked", "inactive"]),
        "tier": P("string", "Group.", enum=["standard", "wholesale", "key_account"]),
        "customer_since": P("string", "Date the trade account was registered.", fmt_="date"),
        "credit_limit_net": P("number", "Credit limit granted to the account, excluding VAT."),
        "preferred_language": P("string"),
    }, ["external_id", "company_name", "first_name", "last_name", "email", "status", "tier"]),
    gt={
        "external_id": {"source": "kh_id_kontrahenta", "transform": "copy", "why": "account id; kh_nip is the tax number and lp the export row"},
        "company_name": {"source": "kh_nazwa", "transform": "trim", "why": "company name, padded"},
        "first_name": {"source": "os_imie", "transform": "copy", "why": "contact given name; handlowiec is the sales rep"},
        "last_name": {"source": "os_nazwisko", "transform": "copy", "why": "contact family name"},
        "email": {"source": "os_email", "transform": "normalize_email", "why": "contact email, mixed case; kh_email_faktury is the invoicing mailbox"},
        "phone": {"source": "os_telefon", "transform": "copy", "why": "phone, null or missing for some"},
        "status": {"source": "status_kontrahenta", "transform": "map_enum", "categoryMap": {"Aktywny": "active", "Zablokowany – limit kredytowy": "blocked", "Nieaktywny": "inactive", "Do weryfikacji": None}, "why": "account state; accounts to verify need review; status_platnosci is payment"},
        "tier": {"source": "grupa_rabatowa", "transform": "map_enum", "categoryMap": {"Detal": "standard", "Hurt A": "wholesale", "Hurt B": "wholesale", "Kluczowy": "key_account"}, "why": "discount group; branza is the trade sector"},
        "customer_since": {"source": "data_rejestracji", "transform": "parse_date", "dateFormat": "DD/MM/YYYY", "why": "registration date (Polish day-first); data_ostatniej_faktury is the last invoice"},
        "credit_limit_net": {"source": "limit_kredytowy_netto", "transform": "copy", "why": "net credit limit; limit_kredytowy_brutto includes VAT"},
        "preferred_language": {"source": None, "transform": "none", "why": "no language is exported"},
    },
    pairs=[
        {"kind": "customer-id-vs-transaction-id", "fields": ["kh_id_kontrahenta", "kh_nip"], "correctFor": "external_id"},
        {"kind": "customer-id-vs-transaction-id", "fields": ["kh_id_kontrahenta", "lp"], "correctFor": "external_id"},
        {"kind": "nested-entity-relationship", "fields": ["os_email", "kh_email_faktury"], "correctFor": "email"},
        {"kind": "nested-entity-relationship", "fields": ["os_imie", "handlowiec"], "correctFor": "first_name"},
        {"kind": "competing-category-fields", "fields": ["status_kontrahenta", "status_platnosci"], "correctFor": "status"},
        {"kind": "competing-category-fields", "fields": ["grupa_rabatowa", "branza"], "correctFor": "tier"},
        {"kind": "modified-date-vs-created-date", "fields": ["data_rejestracji", "data_ostatniej_faktury"], "correctFor": "customer_since"},
    ],
    sc={"kh_id_kontrahenta": "customer-id", "kh_nip": "other-identifier", "lp": "other-identifier", "kh_nazwa": "organization-name",
        "os_imie": "given-name", "os_nazwisko": "family-name", "os_email": "email", "kh_email_faktury": "email", "os_telefon": "phone",
        "handlowiec": "person-name", "status_kontrahenta": "account-status", "status_platnosci": "payment-status",
        "grupa_rabatowa": "category", "branza": "category", "data_rejestracji": "start-date", "data_ostatniej_faktury": "other",
        "limit_kredytowy_netto": "amount", "limit_kredytowy_brutto": "amount"},
    dc={"external_id": "customer-id", "company_name": "organization-name", "first_name": "given-name", "last_name": "family-name",
        "email": "email", "phone": "phone", "status": "account-status", "tier": "category", "customer_since": "start-date",
        "credit_limit_net": "amount", "preferred_language": "language-code"},
))


# ---------------------------------------------------------------- W10 sv
def gen_w10(rng, n):
    ppl = people(rng, "sv", n)
    org = companies(rng, n, ["Ekholms", "Bergviks", "Norrby", "Strands", "Lövsta", "Hagby"], ["Bygg AB", "Taxi AB", "El & VVS", "Trädgård AB", "Måleri HB"])
    kt = deal(rng, n, [("Företag", 9), ("Leasingbil", 6), ("Intern", 3)], "Privat")
    ks = deal(rng, n, [("Vilande", 6), ("Spärrad", 4)], "Aktiv")
    bs = deal(rng, n, [("Faktura obetald", 6), ("Inkasso", 3)], "Betald")
    mob = deal(rng, n, [(None, 4), (MISSING, 2)], 1)
    ec = deal(rng, n, [("mix", 8), ("up", 2), ("pad", 2)], "lo")
    ksn = deal(rng, n, [(None, 2), (MISSING, 2)], 1)
    adv = ["Patrik Sjöberg", "Lena Wallin", "Mattias Öberg"]
    cars = ["Kombi 2.0 TDI", "Kompakt 1.5", "SUV Hybrid", "Skåpbil 2.2", "Sedan Elektrisk"]
    recs = []
    for i in range(n):
        f, l = ppl[i]
        biz = kt[i] in ("Företag", "Leasingbil")
        fn = (org[i] if biz and rng.random() < 0.85 else None) if biz else (None if rng.random() < 0.5 else MISSING)
        recs.append({
            "kundnummer": f"BV-{11800 + i * 9 + rng.randint(0, 7)}",
            "registreringsnummer": f"{rng.choice('ABCDEFGHJKLMNOPRSTUWXYZ')}{rng.choice('ABCDEFGHJKLMNOPRSTUWXYZ')}{rng.choice('ABCDEFGHJKLMNOPRSTUWXYZ')} {rng.randint(10, 99)}{rng.choice('0123456789ABC')}",
            "radnr": i + 1,
            "kund": {"fornamn": f, "efternamn": l, "epost": em(rng, ec[i], mail([f, l], "post.example.net")),
                     "mobil": opt(mob[i], f"07{rng.randint(0, 9)}-{rng.randint(100, 999)} {rng.randint(10, 99)} {rng.randint(10, 99)}")},
            "foretag": MISSING if fn is MISSING else {"namn": fn},
            "kundtyp": kt[i], "kundstatus": ks[i], "betalstatus": bs[i], "verkstadsradgivare": rng.choice(adv),
            "senasteBesok": fmt(rdate(rng, "2025-06-01", "2026-11-15"), "YYYY-MM-DD"),
            "kundSedan": opt(ksn[i], fmt(rdate(rng, "2009-01-01", "2025-06-30"), "DD/MM/YYYY")),
            "nyhetsbrev": rng.choice(["Ja", "Nej"]), "bilmodell": rng.choice(cars),
        })
    return recs


SC.append(dict(
    id="car-repair-workshop-customers-to-helpdesk-users", track="wedge", lang="sv", n=30,
    industry="independent car repair workshop customer register",
    desc="Customer register export of a fictional car repair workshop (Swedish camelCase, nested customer and company) to be loaded as helpdesk users.",
    completable=True, gen=gen_w10,
    dest=schema({
        "user_external_id": P("string", "Identifier of the customer at the workshop."),
        "user_name": P("string", "Full name of the customer, given name first."),
        "user_email": P("string", "Email address the customer uses for bookings.", fmt_="email"),
        "user_phone": P("string", "Mobile number for when the car is ready."),
        "user_organization": P("string", "Company the customer drives for, if any."),
        "user_segment": P("string", "Whether the customer is a private person or a business.", enum=["private", "business"]),
        "user_status": P("string", "Account state of the customer.", enum=["active", "dormant", "blocked"]),
        "user_since": P("string", "Date the person became a customer of the workshop.", fmt_="date"),
        "user_locale": P("string", "Locale."),
        "user_next_service_due": P("string", "Date the customer's car is next due for service.", fmt_="date"),
    }, ["user_external_id", "user_name", "user_email", "user_status"]),
    gt={
        "user_external_id": {"source": "kundnummer", "transform": "copy", "why": "customer number; registreringsnummer is a car plate and radnr the export row"},
        "user_name": {"source": None, "sources": ["kund.fornamn", "kund.efternamn"], "transform": "concat", "separator": " ", "why": "customer names; verkstadsradgivare is the service advisor"},
        "user_email": {"source": "kund.epost", "transform": "normalize_email", "why": "customer email, mixed case and padded"},
        "user_phone": {"source": "kund.mobil", "transform": "copy", "why": "mobile, null or missing for some"},
        "user_organization": {"source": "foretag.namn", "transform": "copy", "why": "company, null or missing for private customers"},
        "user_segment": {"source": "kundtyp", "transform": "map_enum", "categoryMap": {"Privat": "private", "Företag": "business", "Leasingbil": "business", "Intern": None}, "why": "customer type; internal workshop cars are not customers and need review"},
        "user_status": {"source": "kundstatus", "transform": "map_enum", "categoryMap": {"Aktiv": "active", "Vilande": "dormant", "Spärrad": "blocked"}, "why": "account state; betalstatus is payment"},
        "user_since": {"source": "kundSedan", "transform": "parse_date", "dateFormat": "DD/MM/YYYY", "why": "customer-since date (day-first), null or missing for some; senasteBesok is the last visit"},
        "user_locale": {"source": None, "transform": "none", "why": "not exported"},
        "user_next_service_due": {"source": None, "transform": "none", "why": "not exported", "unsupportedReason": "would need the last visit date plus a service interval"},
    },
    pairs=[
        {"kind": "customer-id-vs-transaction-id", "fields": ["kundnummer", "registreringsnummer"], "correctFor": "user_external_id"},
        {"kind": "customer-id-vs-transaction-id", "fields": ["kundnummer", "radnr"], "correctFor": "user_external_id"},
        {"kind": "nested-entity-relationship", "fields": ["kund.fornamn", "verkstadsradgivare"], "correctFor": "user_name"},
        {"kind": "competing-category-fields", "fields": ["kundstatus", "betalstatus"], "correctFor": "user_status"},
        {"kind": "modified-date-vs-created-date", "fields": ["kundSedan", "senasteBesok"], "correctFor": "user_since"},
    ],
    sc={"kundnummer": "customer-id", "registreringsnummer": "other-identifier", "radnr": "other-identifier",
        "kund.fornamn": "given-name", "kund.efternamn": "family-name", "kund.epost": "email", "kund.mobil": "phone",
        "foretag.namn": "organization-name", "kundtyp": "category", "kundstatus": "account-status", "betalstatus": "payment-status",
        "verkstadsradgivare": "person-name", "senasteBesok": "other", "kundSedan": "start-date", "nyhetsbrev": "consent-flag",
        "bilmodell": "other"},
    dc={"user_external_id": "customer-id", "user_name": "person-name", "user_email": "email", "user_phone": "phone",
        "user_organization": "organization-name", "user_segment": "category", "user_status": "account-status",
        "user_since": "start-date", "user_locale": "language-code", "user_next_service_due": "other"},
))


# ---------------------------------------------------------------- W11 da, flat, NOT completable (contract end needs unsupported computation)
def gen_w11(rng, n):
    ppl = people(rng, "da", n)
    virk = companies(rng, n, ["Advokatfirma", "Tandklinik", "Revisionshuset", "Arkitekterne", "Boligforeningen", "Kontorfællesskabet"],
                     ["Holm", "Vestergaard", "Bech", "Lund", "Dahl", "Krogh"])
    st = deal(rng, n, [("Pause", 5), ("Opsagt", 4), ("Tilbud sendt", 3)], "Aktiv")
    bet = deal(rng, n, [("Rykker 1", 6), ("Inkasso", 3)], "Betalt")
    yd = deal(rng, n, [("Trappevask", 9), ("Vinduespolering", 6)], "Kontorrengøring")
    fr = deal(rng, n, [("Hver 14. dag", 9), ("Månedlig", 6)], "Ugentlig")
    tlf = deal(rng, n, [(None, 3), (MISSING, 3)], 1)
    ec = deal(rng, n, [("mix", 8), ("up", 2)], "lo")
    vp = deal(rng, n, [(1, 6)], 0)
    form = ["Birgitte Kjær", "Ole Bundgaard", "Hanne Riis"]
    recs = []
    for i in range(n):
        f, l = ppl[i]
        recs.append({
            "crm_kundenr": f"RG-{3100 + i * 4 + rng.randint(0, 2)}", "crm_cvr": f"{rng.randint(10000000, 99999999)}", "crm_raekke": i + 1,
            "virksomhed": pad(rng, virk[i]) if vp[i] else virk[i],
            "kontakt_fornavn": f, "kontakt_efternavn": l,
            "kontakt_email": em(rng, ec[i], mail([f, l], "firma.example.com")),
            "kontakt_tlf": opt(tlf[i], f"{rng.randint(20, 99)} {rng.randint(10, 99)} {rng.randint(10, 99)} {rng.randint(10, 99)}"),
            "formand": rng.choice(form), "kundestatus": st[i], "betalingsstatus": bet[i], "ydelse": yd[i], "frekvens": fr[i],
            "aftale_start": fmt(rdate(rng, "2018-01-01", "2026-06-30", amb=True), "DD/MM/YYYY"),
            "bindingsperiode_mdr": rng.choice([6, 12, 12, 24, 36]),
            "naeste_besoeg": fmt(rdate(rng, "2026-11-01", "2026-12-12", amb=True), "DD/MM/YYYY"),
        })
    return recs


SC.append(dict(
    id="commercial-cleaning-customers-to-helpdesk-contacts", track="wedge", lang="da", n=26,
    industry="commercial cleaning company business customers",
    desc="Flat customer export of a fictional commercial cleaning company (Danish snake_case with a crm_ prefix) to be loaded as helpdesk contacts; the agreement end date is not exported.",
    completable=False, gen=gen_w11,
    dest=schema({
        "customer_id": P("string", "Identifier of the customer at the cleaning company."),
        "organization": P("string", "Business that buys the cleaning service."),
        "first_name": P("string", "Given name of the customer's contact person."),
        "last_name": P("string", "Family name of the customer's contact person."),
        "email": P("string", "Email address of the contact person.", fmt_="email"),
        "phone": P("string", "Phone number of the contact person."),
        "status": P("string", "Whether the cleaning agreement is running, paused or terminated.", enum=["active", "paused", "terminated"]),
        "service": P("string", "Main cleaning service delivered.", enum=["office", "stairwell", "windows"]),
        "customer_since": P("string", "Date the first cleaning agreement started.", fmt_="date"),
        "contract_end_date": P("string", "Date the current binding agreement period ends; needed to plan renewals.", fmt_="date"),
        "cleaning_notes": P("string", "Notes."),
    }, ["customer_id", "organization", "email", "status", "contract_end_date"]),
    gt={
        "customer_id": {"source": "crm_kundenr", "transform": "copy", "why": "customer number; crm_cvr is the company registration number and crm_raekke the export row"},
        "organization": {"source": "virksomhed", "transform": "trim", "why": "business name, padded"},
        "first_name": {"source": "kontakt_fornavn", "transform": "copy", "why": "contact given name; formand is the cleaning team lead"},
        "last_name": {"source": "kontakt_efternavn", "transform": "copy", "why": "contact family name"},
        "email": {"source": "kontakt_email", "transform": "normalize_email", "why": "contact email, mixed case"},
        "phone": {"source": "kontakt_tlf", "transform": "copy", "why": "phone, null or missing for some"},
        "status": {"source": "kundestatus", "transform": "map_enum", "categoryMap": {"Aktiv": "active", "Pause": "paused", "Opsagt": "terminated", "Tilbud sendt": None}, "why": "agreement state; a sent offer is not a customer; betalingsstatus is payment"},
        "service": {"source": "ydelse", "transform": "map_enum", "categoryMap": {"Kontorrengøring": "office", "Trappevask": "stairwell", "Vinduespolering": "windows"}, "why": "service; frekvens is the visit frequency"},
        "customer_since": {"source": "aftale_start", "transform": "parse_date", "dateFormat": "DD/MM/YYYY", "why": "agreement start (Danish day-first)"},
        "contract_end_date": {"source": None, "transform": "none", "why": "the end date is not exported; naeste_besoeg is the next visit and aftale_start the start", "unsupportedReason": "would need aftale_start plus bindingsperiode_mdr months"},
        "cleaning_notes": {"source": None, "transform": "none", "why": "no notes are exported"},
    },
    pairs=[
        {"kind": "decoy-for-missing-field", "fields": ["naeste_besoeg", "aftale_start"], "correctFor": "contract_end_date"},
        {"kind": "customer-id-vs-transaction-id", "fields": ["crm_kundenr", "crm_cvr"], "correctFor": "customer_id"},
        {"kind": "customer-id-vs-transaction-id", "fields": ["crm_kundenr", "crm_raekke"], "correctFor": "customer_id"},
        {"kind": "nested-entity-relationship", "fields": ["kontakt_fornavn", "formand"], "correctFor": "first_name"},
        {"kind": "competing-category-fields", "fields": ["kundestatus", "betalingsstatus"], "correctFor": "status"},
        {"kind": "competing-category-fields", "fields": ["ydelse", "frekvens"], "correctFor": "service"},
    ],
    sc={"crm_kundenr": "customer-id", "crm_cvr": "other-identifier", "crm_raekke": "other-identifier", "virksomhed": "organization-name",
        "kontakt_fornavn": "given-name", "kontakt_efternavn": "family-name", "kontakt_email": "email", "kontakt_tlf": "phone",
        "formand": "person-name", "kundestatus": "account-status", "betalingsstatus": "payment-status", "ydelse": "category",
        "frekvens": "category", "aftale_start": "start-date", "bindingsperiode_mdr": "quantity", "naeste_besoeg": "other"},
    dc={"customer_id": "customer-id", "organization": "organization-name", "first_name": "given-name", "last_name": "family-name",
        "email": "email", "phone": "phone", "status": "account-status", "service": "category", "customer_since": "start-date",
        "contract_end_date": "end-date", "cleaning_notes": "other"},
))


# ---------------------------------------------------------------- W12 mixed (en + nl)
def gen_w12(rng, n):
    ppl = people(rng, "nl", n)
    org = companies(rng, n, ["Van Loon", "Hofstede", "De Linde", "Zuidas", "Kempen", "Waterland", "Eemland"],
                    ["Accountants", "Makelaardij", "Logistics B.V.", "Tandartsen", "Architecten", "Installatietechniek"])
    cs = deal(rng, n, [("Actief", 9), ("Opgezegd", 4), ("On hold - wanbetaling", 4), ("Lead", 3)], "Active")
    inv = deal(rng, n, [("Openstaand", 7), ("Herinnering", 4)], "Paid")
    sla = deal(rng, n, [("Silver 12x5", 10), ("Gold 24x7", 6)], "Bronze 8x5")
    rol = deal(rng, n, [("Technisch contact", 8), ("Billing contact", 5), ("Beslisser", 5), (None, 2), (MISSING, 2)], "Primary Contact")
    mob = deal(rng, n, [(None, 4), (MISSING, 3)], 1)
    ec = deal(rng, n, [("mix", 9), ("up", 2), ("pad", 2)], "lo")
    cp = deal(rng, n, [(1, 7)], 0)
    am = ["Rick Haverkamp", "Sandra Oosterhuis", "Jeroen Blom"]
    recs = []
    for i in range(n):
        f, l = ppl[i]
        dom = "".join(org[i].split()[:2]).lower()
        recs.append({
            "AccountID": f"MSP-{290 + i * 3:04d}", "crm_guid": "".join(rng.choice("0123456789abcdef") for _ in range(12)), "volgnr": i + 1,
            "Company": {"Naam": pad(rng, org[i]) if cp[i] else org[i], "KvK": f"{rng.randint(10000000, 99999999)}"},
            "Contact": {"FirstName": f, "Achternaam": l,
                        "Email": em(rng, ec[i], mail([f, l], f"{dom}.example.com")),
                        "EmailPrive": mail([f, l], "prive.example.net"),
                        "Mobiel": opt(mob[i], f"+31 6 {rng.randint(10000000, 99999999)}"),
                        "Rol": rol[i]},
            "AccountManager": rng.choice(am), "ContractStatus": cs[i], "InvoiceStatus": inv[i], "SLA": sla[i],
            "StartDatum": fmt(rdate(rng, "2016-01-01", "2025-10-31"), "DD/MM/YYYY"),
            "ContractEnd": fmt(rdate(rng, "2026-12-01", "2028-12-31"), "DD/MM/YYYY"),
            "Seats": rng.randint(4, 120),
        })
    return recs


SC.append(dict(
    id="managed-it-provider-contacts-to-helpdesk-requesters", track="wedge", lang="mixed", n=38,
    industry="managed IT services provider customer contacts",
    desc="Customer-contact export of a fictional managed IT services provider (mixed English and Dutch field names and labels, nested company and contact) to be loaded as helpdesk requesters with their organization.",
    completable=True, gen=gen_w12,
    dest=schema({
        "requester_name": P("string", "Full name of the requester, given name first."),
        "email": P("string", "Business email address of the requester.", fmt_="email"),
        "phone": P("string", "Mobile number of the requester."),
        "role": P("string", "Role.", enum=["primary", "technical", "billing"]),
        "status": P("string", "State of the customer's support contract.", enum=["active", "suspended", "cancelled"]),
        "customer_since": P("string", "Date the support contract started.", fmt_="date"),
        "organization": OBJ({
            "external_id": P("string", "Identifier of the customer organization in the provider's system."),
            "name": P("string", "Name of the customer organization."),
            "support_level": P("string", "Support level the organization has bought, which sets response hours.", enum=["bronze", "silver", "gold"]),
            "seats": P("integer", "Number of workplaces covered by the contract."),
        }, ["external_id", "name", "support_level"], "Organization the requester belongs to."),
        "time_zone": P("string"),
    }, ["requester_name", "email", "status", "organization"]),
    gt={
        "requester_name": {"source": None, "sources": ["Contact.FirstName", "Contact.Achternaam"], "transform": "concat", "separator": " ", "why": "contact names; AccountManager is the provider's own staff"},
        "email": {"source": "Contact.Email", "transform": "normalize_email", "why": "business email, mixed case and padded; EmailPrive is private"},
        "phone": {"source": "Contact.Mobiel", "transform": "copy", "why": "mobile, null or missing for some"},
        "role": {"source": "Contact.Rol", "transform": "map_enum", "categoryMap": {"Primary Contact": "primary", "Beslisser": "primary", "Technisch contact": "technical", "Billing contact": "billing"}, "why": "contact role, null or missing for some"},
        "status": {"source": "ContractStatus", "transform": "map_enum", "categoryMap": {"Active": "active", "Actief": "active", "On hold - wanbetaling": "suspended", "Opgezegd": "cancelled", "Lead": None}, "why": "contract state in two languages; leads need review; InvoiceStatus is billing"},
        "customer_since": {"source": "StartDatum", "transform": "parse_date", "dateFormat": "DD/MM/YYYY", "why": "contract start (Dutch day-first); ContractEnd is the end"},
        "organization.external_id": {"source": "AccountID", "transform": "copy", "why": "account id; crm_guid is the CRM key and volgnr the export row"},
        "organization.name": {"source": "Company.Naam", "transform": "trim", "why": "company name, padded"},
        "organization.support_level": {"source": "SLA", "transform": "map_enum", "categoryMap": {"Bronze 8x5": "bronze", "Silver 12x5": "silver", "Gold 24x7": "gold"}, "why": "SLA level"},
        "organization.seats": {"source": "Seats", "transform": "copy", "why": "seat count"},
        "time_zone": {"source": None, "transform": "none", "why": "no time zone is exported"},
    },
    pairs=[
        {"kind": "customer-id-vs-transaction-id", "fields": ["AccountID", "crm_guid"], "correctFor": "organization.external_id"},
        {"kind": "customer-id-vs-transaction-id", "fields": ["AccountID", "Company.KvK"], "correctFor": "organization.external_id"},
        {"kind": "nested-entity-relationship", "fields": ["Contact.Email", "Contact.EmailPrive"], "correctFor": "email"},
        {"kind": "nested-entity-relationship", "fields": ["Contact.FirstName", "AccountManager"], "correctFor": "requester_name"},
        {"kind": "competing-category-fields", "fields": ["ContractStatus", "InvoiceStatus"], "correctFor": "status"},
        {"kind": "modified-date-vs-created-date", "fields": ["StartDatum", "ContractEnd"], "correctFor": "customer_since"},
    ],
    sc={"AccountID": "customer-id", "crm_guid": "other-identifier", "volgnr": "other-identifier", "Company.Naam": "organization-name",
        "Company.KvK": "other-identifier", "Contact.FirstName": "given-name", "Contact.Achternaam": "family-name",
        "Contact.Email": "email", "Contact.EmailPrive": "email", "Contact.Mobiel": "phone", "Contact.Rol": "category",
        "AccountManager": "person-name", "ContractStatus": "account-status", "InvoiceStatus": "payment-status", "SLA": "category",
        "StartDatum": "start-date", "ContractEnd": "end-date", "Seats": "quantity"},
    dc={"requester_name": "person-name", "email": "email", "phone": "phone", "role": "category", "status": "account-status",
        "customer_since": "start-date", "organization.external_id": "customer-id", "organization.name": "organization-name",
        "organization.support_level": "category", "organization.seats": "quantity", "time_zone": "other"},
))
