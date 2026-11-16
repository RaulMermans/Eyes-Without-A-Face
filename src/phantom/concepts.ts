import type { FieldProfile, ProfiledFieldType } from "../domain/profile/profile.ts";

/**
 * Sprint 18A (ADR 0016) — business meaning ("concept") of a source field.
 *
 * The Phantom Twin's role vocabulary (roles.ts) says WHAT KIND of value a field
 * holds ("Calendar date"). Two fields of one kind then look identical to the
 * cloud planner: a date of birth and a signup date, a customer number and an
 * invoice number. A concept says what the value MEANS, from a fixed
 * vocabulary, so the disclosed descriptor can separate them without disclosing
 * a field name or a value.
 *
 * Every concept is a CLAIM with explicit provenance:
 *   value-shape     observed in the values (e.g. every value is an ISO currency code)
 *   field-name      a hypothesis read from the local field name; never trusted
 *   user            the data owner chose it (TwinFieldOverride.concept)
 *   on-device-model Gemini Nano suggested it and the user applied it
 *
 * Only the fixed phrases below can reach a descriptor. The local field name is
 * read here and never copied. A concept never becomes a trusted semantic
 * constraint (src/semantics): it informs a proposal, the verifier still judges.
 */

export const CONCEPTS = [
  "customer-id",
  "transaction-id",
  "product-id",
  "employee-id",
  "other-identifier",
  "given-name",
  "family-name",
  "person-name",
  "organization-name",
  "job-title",
  "email",
  "phone",
  "street-address",
  "city",
  "postal-code",
  "region",
  "country",
  "birth-date",
  "created-date",
  "start-date",
  "end-date",
  "modified-date",
  "transaction-date",
  "due-date",
  "amount",
  "currency-code",
  "quantity",
  "account-status",
  "payment-status",
  "order-status",
  "priority",
  "category",
  "consent-flag",
  "language-code",
  "note",
  "url",
] as const;

export type Concept = (typeof CONCEPTS)[number];

export function isConcept(value: unknown): value is Concept {
  return typeof value === "string" && (CONCEPTS as readonly string[]).includes(value);
}

/** Context words that separate two fields of one concept (billing vs shipping city, work vs personal email). */
export const QUALIFIERS = [
  "billing",
  "shipping",
  "work",
  "personal",
  "mobile",
  "fax",
  "contact",
  "sales-owner",
  "emergency",
  "net",
  "gross",
  "tax",
  "unit",
  "total",
] as const;

export type ConceptQualifier = (typeof QUALIFIERS)[number];

export type ConceptEvidence = "value-shape" | "field-name" | "user" | "on-device-model";

export interface ConceptClaim {
  concept: Concept;
  qualifier: ConceptQualifier | null;
  evidence: ConceptEvidence;
  /** `hypothesis` needs a person to confirm it before anyone may rely on it; `observed` and `confirmed` do not. */
  status: "hypothesis" | "observed" | "confirmed";
}

interface ConceptSpec {
  /** Disclosed phrases, preferred first. Fixed application text; never derived from a source. */
  phrases: readonly string[];
  types: readonly ProfiledFieldType[];
  /** Personal data about a person (shown locally as a caution before disclosure). */
  personal?: boolean;
  /** Identifier-like: a value with spaces contradicts it. */
  code?: boolean;
}

const TEXT = ["string", "enum"] as const;
const CODE = ["string", "enum", "integer", "number"] as const;
const DATES = ["date", "datetime"] as const;
const NUMERIC = ["number", "integer"] as const;

/**
 * Disclosed phrases per concept, in order of preference. Several wordings
 * exist so that a phrase which happens to contain a local field name (a field
 * called "email" or "city") can be replaced by one that does not, instead of
 * withholding the meaning (see `withConcept` in generate.ts).
 */
export const CONCEPT_SPECS: Readonly<Record<Concept, ConceptSpec>> = {
  "customer-id": { phrases: ["customer identifier", "identifier of the client or account holder"], types: CODE, code: true },
  "transaction-id": { phrases: ["transaction identifier (order, invoice, booking)", "identifier of a transaction"], types: CODE, code: true },
  "product-id": { phrases: ["product identifier", "identifier of an item sold"], types: CODE, code: true },
  "employee-id": { phrases: ["employee identifier", "identifier of a staff member"], types: CODE, code: true },
  "other-identifier": { phrases: ["other reference code, not a customer or transaction identifier", "secondary reference code"], types: CODE, code: true },
  "given-name": { phrases: ["given name of a person", "first name of a person"], types: TEXT, personal: true },
  "family-name": { phrases: ["family name of a person", "surname of a person"], types: TEXT, personal: true },
  "person-name": { phrases: ["full name of a person", "name of a human individual"], types: TEXT, personal: true },
  "organization-name": { phrases: ["organization name", "name of a company"], types: TEXT },
  "job-title": { phrases: ["job title", "position held at work"], types: TEXT },
  email: { phrases: ["email address", "e-mail address"], types: ["string"], personal: true },
  phone: { phrases: ["phone number", "telephone number"], types: ["string", "integer", "number"], personal: true },
  "street-address": { phrases: ["street address", "street and house number"], types: TEXT, personal: true },
  city: { phrases: ["city", "town or municipality"], types: TEXT },
  "postal-code": { phrases: ["postal code", "zip code", "postcode"], types: ["string", "enum", "integer"] },
  region: { phrases: ["region or province", "state or province"], types: TEXT },
  country: { phrases: ["country", "nation"], types: TEXT },
  "birth-date": { phrases: ["date of birth", "birthday"], types: DATES, personal: true },
  "created-date": { phrases: ["creation or signup date", "date the record was first registered"], types: DATES },
  "start-date": { phrases: ["start date of a contract, subscription or employment", "date something began"], types: DATES },
  "end-date": { phrases: ["end or expiry date", "date something ended or expires"], types: DATES },
  "modified-date": { phrases: ["last-modified date", "date of the latest change"], types: DATES },
  "transaction-date": { phrases: ["date of a transaction (order, payment, booking, visit)", "date of a purchase or visit"], types: DATES },
  "due-date": { phrases: ["due date", "payment deadline"], types: DATES },
  amount: { phrases: ["money amount", "monetary value"], types: NUMERIC },
  "currency-code": { phrases: ["currency code", "ISO currency"], types: TEXT },
  quantity: { phrases: ["quantity", "number of units"], types: NUMERIC },
  "account-status": { phrases: ["status of the customer or account", "customer lifecycle state"], types: TEXT },
  "payment-status": { phrases: ["payment status", "state of a payment or invoice"], types: TEXT },
  "order-status": { phrases: ["status of a transaction (order, booking, shipment, ticket)", "state of an order or booking"], types: TEXT },
  priority: { phrases: ["priority level", "urgency level"], types: TEXT },
  category: { phrases: ["classification", "grouping label"], types: [...TEXT, "integer"] },
  "consent-flag": { phrases: ["yes/no flag", "boolean flag"], types: ["boolean"] },
  "language-code": { phrases: ["language", "spoken tongue"], types: TEXT },
  note: { phrases: ["free-text note", "free-form remark"], types: ["string"] },
  url: { phrases: ["web address", "internet link"], types: ["string"] },
};

const QUALIFIER_PHRASES: Readonly<Record<ConceptQualifier, readonly string[]>> = {
  billing: ["billing", "invoicing"],
  shipping: ["shipping", "delivery"],
  work: ["work", "professional"],
  personal: ["personal", "private"],
  mobile: ["mobile", "cell"],
  fax: ["fax", "facsimile"],
  contact: ["contact", "liaison"],
  "sales-owner": ["sales representative", "account owner"],
  emergency: ["emergency", "urgent"],
  net: ["net", "before tax"],
  gross: ["gross", "including tax"],
  tax: ["tax", "levy"],
  unit: ["per unit", "each"],
  total: ["total", "overall"],
};

/** Whether a concept is consistent with observed, deterministic facts. The profile is authoritative. */
export function conceptCompatible(concept: Concept, field: FieldProfile): boolean {
  const spec = CONCEPT_SPECS[concept];
  if (!spec.types.includes(field.type)) return false;
  if (concept === "email") return field.format === "email";
  if (field.format === "email") return false;
  if (spec.code && field.containsSpaces) return false;
  return true;
}

export function isPersonalConcept(concept: Concept): boolean {
  return CONCEPT_SPECS[concept].personal === true;
}

const BASIS: Readonly<Record<ConceptEvidence, string>> = {
  "value-shape": "observed",
  "field-name": "inferred, unconfirmed",
  user: "confirmed",
  "on-device-model": "on-device suggestion, unconfirmed",
};

/**
 * Disclosed wordings for a claim, preferred first: every concept phrase with
 * each qualifier wording, then without the qualifier. Fixed phrases only.
 */
export function conceptPhrases(claim: ConceptClaim): string[] {
  const basis = BASIS[claim.evidence];
  const out: string[] = [];
  const qualifiers = claim.qualifier ? QUALIFIER_PHRASES[claim.qualifier] : [];
  for (const phrase of CONCEPT_SPECS[claim.concept].phrases) {
    for (const qualifier of qualifiers) out.push(`meaning: ${phrase} (${qualifier}) [${basis}]`);
  }
  for (const phrase of CONCEPT_SPECS[claim.concept].phrases) out.push(`meaning: ${phrase} [${basis}]`);
  return out;
}

export function conceptPhrase(claim: ConceptClaim): string {
  return conceptPhrases(claim)[0] as string;
}

// ---------------------------------------------------------------------------
// Deterministic local inference (the reduced-capability path; no model).
// ---------------------------------------------------------------------------

/** Split a local key into lowercase tokens: snake_case, camelCase, digits. */
export function nameTokens(path: string): string[] {
  return path
    .split(".")
    .flatMap((segment) =>
      segment
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
        .split(/[^A-Za-z0-9]+/),
    )
    .flatMap((token) => token.split(/(?<=[a-zA-Z])(?=[0-9])|(?<=[0-9])(?=[a-zA-Z])/))
    .map((token) => token.toLowerCase())
    .filter((token) => token.length > 0);
}

type Lexicon = readonly string[];

/**
 * Word lists per meaning, in several languages. A token matches an entry when
 * it is equal to it, or, for entries of five or more letters, when it starts
 * with it (German and Dutch compounds: "geburtsdatum", "kundennummer").
 */
const L = {
  id: ["id", "ids", "nr", "no", "num", "number", "nummer", "numero", "nro", "code", "codigo", "cod", "ref", "reference", "referencia", "referenz", "key", "uuid", "ident", "identifier", "kennung", "nbr", "n"],
  customer: ["customer", "cust", "cus", "client", "cliente", "clienti", "kunde", "kunden", "kund", "kd", "klant", "member", "miembro", "socio", "mitglied", "lid", "patient", "paciente", "pat", "donor", "donante", "spender", "donateur", "account", "acct", "acc", "cuenta", "konto", "relatie", "relation", "subscriber", "abonado", "abonnent", "abonne", "guest", "huesped", "gast", "student", "alumno", "estudiante", "lead", "contact", "contacto", "kontakt", "user", "usuario", "buyer", "comprador", "tenant", "inquilino", "insured", "asegurado", "versicherter", "borrower", "prestatario", "attendee", "asistente", "contribuinte", "utente", "assure", "aderente", "afiliado"],
  transaction: ["order", "orders", "ord", "pedido", "bestellung", "bestell", "best", "commande", "cmd", "bestelling", "ordine", "encomenda", "invoice", "inv", "factura", "fact", "rechnung", "rechnungs", "re", "facture", "factuur", "fattura", "fatura", "booking", "reserva", "reservation", "reserv", "buchung", "boeking", "prenotazione", "ticket", "tkt", "shipment", "shp", "envio", "sendung", "zending", "spedizione", "expedition", "remessa", "payment", "pmt", "pago", "zahlung", "betaling", "paiement", "pagamento", "policy", "poliza", "polizza", "police", "apolice", "polis", "loan", "prestamo", "kredit", "darlehen", "lening", "pret", "prestito", "emprestimo", "transaction", "trans", "txn", "tx", "trx", "receipt", "recibo", "beleg", "contract", "contrato", "vertrag", "contrat", "contratto", "appointment", "cita", "termin", "afspraak", "visit", "visita", "besuch", "claim", "siniestro", "schaden", "case", "caso", "donation", "donacion", "spende", "gift", "enrollment", "enrolment", "matricula", "inscripcion", "einschreibung", "subscription", "suscripcion", "abo", "abonnement", "sale", "venta", "verkauf", "purchase", "compra", "kauf", "job", "repair", "reparacion", "service", "servicio", "werkorder", "auftrag", "auftrags", "rental", "alquiler", "miete", "lease", "registration"],
  product: ["product", "prod", "producto", "produkt", "produit", "prodotto", "produto", "sku", "item", "articulo", "artikel", "article", "art", "articolo", "artigo", "part", "material", "ean", "gtin", "upc", "vehicle", "vehiculo", "fahrzeug", "vin"],
  employee: ["employee", "emp", "empl", "empleado", "mitarbeiter", "ma", "staff", "personnel", "personal", "personeel", "medewerker", "worker", "trabajador", "dipendente", "funcionario", "salarie", "colaborador", "agent", "agente"],
  given: ["first", "firstname", "fname", "given", "givenname", "forename", "vorname", "voornaam", "prenom", "primer", "primeiro"],
  family: ["last", "lastname", "lname", "surname", "family", "familyname", "apellido", "apellidos", "nachname", "achternaam", "cognome", "sobrenome", "apelido", "familienname"],
  nameWord: ["name", "nombre", "naam", "nom", "nome", "bezeichnung", "nm", "nam"],
  fullName: ["full", "completo", "completa", "volledige", "volledig", "complet", "complete", "vollstaendig", "vollstandig", "voll", "intero"],
  /** A word that alone names a person (a text field with spaces). */
  personAlone: ["contactpersoon", "ansprechpartner", "ansprechperson", "contactperson", "manager", "supervisor", "leidinggevende", "vorgesetzter", "jefe", "responsable", "consignee", "cnee", "recipient", "destinatario", "empfaenger", "ontvanger", "destinataire", "titular", "holder"],
  person: ["contact", "contacto", "kontakt", "contactpersoon", "ansprechpartner", "ansprechperson", "persona", "person", "fullname", "contatto", "contato", "representative", "attendee", "guest", "patient", "paciente", "member", "socio", "student", "alumno", "donor", "holder", "titular", "inhaber", "borrower", "tenant", "insured", "asegurado", "customer", "cliente", "kunde", "klant", "client", "consignee", "cnee", "recipient", "destinatario", "empfaenger", "ontvanger", "destinataire", "sender", "remitente", "absender"],
  organization: ["company", "comp", "co", "empresa", "firma", "unternehmen", "bedrijf", "organisation", "organization", "organisatie", "organizacion", "org", "societe", "entreprise", "azienda", "societa", "business", "employer", "empleador", "arbeitgeber", "werkgever", "razon", "corp", "corporation", "supplier", "proveedor", "lieferant", "leverancier", "fornitore", "fournisseur", "fornecedor", "vendor", "brand", "marca", "institution", "school", "escuela", "schule", "dealer", "concesionario", "agency", "agencia", "insurer", "aseguradora", "bank", "banco", "carrier", "transportista", "spediteur", "vervoerder"],
  job: ["job", "jobtitle", "title", "position", "puesto", "cargo", "funcion", "beruf", "position", "functie", "poste", "fonction", "ruolo", "mansione", "funcao", "occupation", "ocupacion"],
  email: ["email", "mail", "correo", "courriel", "emailadres", "mailadres", "postaelettronica"],
  phone: ["phone", "tel", "telephone", "telefono", "telefon", "telefoon", "telefone", "mobile", "mobil", "movil", "cell", "celular", "handy", "gsm", "fax", "phonenumber", "tlf", "fon", "ph", "phn", "tfno", "telf"],
  street: ["street", "address", "addr", "direccion", "calle", "strasse", "str", "straat", "adres", "adresse", "rue", "indirizzo", "via", "endereco", "morada", "rua", "line1", "line", "domicilio", "anschrift"],
  city: ["city", "ciudad", "stadt", "ort", "plaats", "woonplaats", "ville", "citta", "cidade", "town", "localidad", "poblacion", "municipio", "comune", "gemeente", "localite", "concelho"],
  postal: ["zip", "zipcode", "postal", "postcode", "postalcode", "cp", "plz", "postleitzahl", "cap", "cep", "codpostal"],
  region: ["state", "province", "provincia", "region", "bundesland", "county", "provincie", "regione", "departement", "canton", "kanton", "distrito", "comunidad"],
  country: ["country", "pais", "land", "pays", "paese", "nation", "nacion", "staat", "countrycode"],
  date: ["date", "dt", "dte", "fecha", "fec", "datum", "dat", "data", "day", "dia", "tag", "dag", "jour", "giorno", "at", "on", "time", "timestamp", "ts", "when", "fch"],
  birth: ["birth", "birthday", "birthdate", "dob", "born", "nacimiento", "nac", "geburt", "geburts", "geburtsdatum", "geb", "geboorte", "geboortedatum", "naissance", "nascita", "nascimento", "cumple", "cumpleanos", "bday"],
  created: ["created", "crtd", "creation", "create", "creacion", "signup", "signed", "registered", "registration", "registro", "alta", "angelegt", "erstellt", "erstell", "erstellung", "anlage", "anmeldung", "aangemaakt", "inschrijving", "ingeschreven", "inscription", "iscrizione", "cadastro", "joined", "join", "since", "sinds", "desde", "seit", "onboarded", "onboard", "opened", "apertura", "aanmelding", "creato", "criado", "creee", "ingresso", "aangemeld", "eroeffnung", "eroffnung"],
  start: ["start", "starts", "started", "inicio", "beginn", "begin", "ingang", "ingangsdatum", "indienst", "debut", "inizio", "effective", "hire", "hired", "contratacion", "eintritt", "eintritts", "indienst", "entrada", "checkin", "arrival", "llegada", "anreise", "aankomst", "pickup", "commencement", "vigor", "from", "valid"],
  end: ["end", "ends", "ended", "fin", "final", "ende", "eind", "einde", "expiry", "expires", "expiration", "expira", "expiracion", "ablauf", "until", "hasta", "bis", "tot", "termination", "baja", "austritt", "uitdienst", "checkout", "departure", "salida", "abreise", "vertrek", "cancel", "cancelled", "canceled", "cancelacion", "kuendigung", "kundigung", "renewal", "renovacion", "verlaengerung", "scadenza", "termine"],
  modified: ["modified", "mod", "updated", "update", "upd", "changed", "change", "lastchange", "actualizado", "actualizacion", "modificado", "modificacion", "geaendert", "geandert", "aenderung", "anderung", "gewijzigd", "bijgewerkt", "wijziging", "modifie", "modification", "aggiornato", "aggiornamento", "atualizado", "atualizacao", "edited", "lastmod", "touched"],
  transactionDate: ["order", "ordered", "pedido", "bestell", "bestellung", "commande", "invoice", "invoiced", "factura", "facturacion", "rechnung", "rechnungs", "factuur", "fattura", "purchase", "purchased", "compra", "kauf", "sale", "sold", "venta", "verkauf", "booking", "booked", "reserva", "buchung", "boeking", "payment", "paid", "pago", "zahlung", "betaling", "betaald", "paiement", "pagamento", "pagado", "bezahlt", "transaction", "txn", "visit", "visita", "besuch", "appointment", "cita", "termin", "afspraak", "service", "servicio", "shipped", "ship", "envio", "versand", "verzonden", "delivered", "entrega", "lieferung", "levering", "donation", "donacion", "spende", "gift", "event", "evento", "veranstaltung", "issue", "issued", "emision", "emitido", "ausstellung", "repair", "reparacion", "claim", "siniestro", "consulta", "consultation"],
  due: ["due", "vence", "vencimiento", "faellig", "fallig", "faelligkeit", "falligkeit", "vervaldatum", "verval", "echeance", "deadline", "payby", "limite"],
  amount: ["amount", "amt", "total", "price", "prijs", "precio", "preis", "prix", "prezzo", "preco", "importe", "monto", "betrag", "bedrag", "montant", "importo", "valor", "cost", "costo", "kosten", "kost", "fee", "fees", "tarifa", "tarif", "sum", "summe", "subtotal", "net", "neto", "netto", "gross", "brutto", "bruto", "tax", "iva", "vat", "mwst", "btw", "tva", "balance", "saldo", "premium", "prima", "praemie", "cuota", "beitrag", "salary", "salario", "gehalt", "sueldo", "salaris", "revenue", "ingreso", "umsatz", "omzet", "discount", "descuento", "rabatt", "korting", "deposit", "deposito", "kaution", "rent", "renta", "alquiler", "miete", "huur", "paid", "pagado", "bezahlt", "charge", "cargo", "spend", "gasto", "budget", "presupuesto", "principal", "capital", "rate", "unitprice", "eur", "usd", "gbp"],
  currency: ["currency", "curr", "ccy", "cur", "moneda", "divisa", "waehrung", "wahrung", "valuta", "devise", "moeda", "munt"],
  quantity: ["qty", "quantity", "cantidad", "cant", "menge", "anzahl", "aantal", "quantite", "quantita", "quantidade", "units", "count", "pieces", "stueck", "stuck", "seats", "plazas", "nights", "noches", "naechte", "nachten", "guests", "pax", "personas", "tickets", "entradas"],
  status: ["status", "state", "stat", "estado", "estatus", "situacion", "zustand", "stand", "toestand", "statut", "stato", "situacao", "fase", "phase", "stage", "etapa", "stufe", "etat", "lifecycle", "standing"],
  priority: ["priority", "prio", "prioridad", "prioritaet", "prioritat", "prioriteit", "priorite", "priorita", "prioridade", "urgency", "urgencia", "dringlichkeit", "urgentie", "severity", "gravedad", "schwere", "ernst"],
  category: ["plan", "tier", "segment", "segmento", "type", "tipo", "typ", "soort", "category", "categoria", "kategorie", "categorie", "class", "clase", "klasse", "classe", "group", "grupo", "gruppe", "groep", "gruppo", "channel", "canal", "kanal", "kanaal", "canale", "source", "origen", "quelle", "bron", "origine", "department", "departamento", "abteilung", "afdeling", "dipartimento", "gender", "genero", "geschlecht", "geslacht", "sexo", "sexe", "sesso", "level", "nivel", "niveau", "livello", "kind", "clase", "rango", "rank", "membership", "package", "paquete", "paket", "pakket", "pacchetto", "product", "producto", "modalidad", "modality", "room", "habitacion", "zimmer", "kamer", "coverage", "cobertura", "deckung", "dekking", "course", "curso", "kurs", "cursus", "corso", "program", "programa", "programm", "programma", "industry", "sector", "branche", "rubro", "tarif", "tariff", "tarifa", "tariffa"],
  language: ["language", "lang", "idioma", "lengua", "sprache", "taal", "langue", "lingua", "locale", "idioma"],
  note: ["note", "notes", "comment", "comments", "comentario", "comentarios", "kommentar", "bemerkung", "bemerkungen", "notiz", "opmerking", "opmerkingen", "notitie", "remarque", "nota", "notas", "observaciones", "observacion", "obs", "memo", "remarks", "remark", "description", "descripcion", "beschreibung", "omschrijving", "osservazioni", "observacoes", "anmerkung", "hinweis", "detalle", "details"],
  url: ["url", "website", "web", "homepage", "link", "sitio", "webseite", "site", "www"],
} as const satisfies Record<string, Lexicon>;

const Q: Readonly<Record<ConceptQualifier, Lexicon>> = {
  billing: ["billing", "bill", "facturacion", "fatturazione", "rechnungs", "rechnung", "factuur", "facturatie", "facturation", "cobranca", "invoice"],
  shipping: ["shipping", "ship", "delivery", "envio", "entrega", "lieferung", "liefer", "versand", "levering", "aflever", "livraison", "spedizione", "consegna"],
  work: ["work", "business", "office", "trabajo", "arbeit", "geschaeft", "geschaftlich", "werk", "zakelijk", "pro", "professional", "corporate", "lavoro", "trabalho", "dienst", "job", "company", "empresa", "firma"],
  personal: ["personal", "private", "privado", "privat", "prive", "home", "casa", "particular", "perso", "privee", "personale", "pessoal"],
  mobile: ["mobile", "mobil", "movil", "cell", "celular", "handy", "gsm", "cellulare", "telemovel"],
  fax: ["fax", "telefax"],
  contact: ["contact", "contacto", "kontakt", "contactpersoon", "ansprechpartner", "contatto", "contato"],
  "sales-owner": ["sales", "rep", "owner", "vendedor", "verkaeufer", "verkaufer", "verkoper", "agent", "agente", "manager", "comercial", "berater", "advisor", "asesor", "accountmanager", "seller", "salesperson", "assigned"],
  emergency: ["emergency", "emergencia", "notfall", "nood", "urgence", "emergenza"],
  net: ["net", "neto", "netto", "nett"],
  gross: ["gross", "brutto", "bruto", "brut", "lordo"],
  tax: ["tax", "iva", "vat", "mwst", "btw", "tva", "steuer", "impuesto", "belasting", "imposta", "imposto"],
  unit: ["unit", "unitario", "unitaria", "einzel", "einzelpreis", "stueckpreis", "stuk", "eenheid", "unitaire", "unitario", "each", "per"],
  total: ["total", "totale", "gesamt", "gesamtbetrag", "totaal", "sum", "summe", "suma"],
};

function hit(tokens: readonly string[], words: Lexicon): boolean {
  // Compounds: German and Dutch put the modifier first ("geburtsdatum") and the
  // head last ("vertragsbeginn"); so do joined abbreviations ("ustidnr").
  const joined = tokens.join("");
  for (const word of words) {
    if (word.length >= 5 && joined.length > word.length && joined.startsWith(word)) return true;
    for (const token of tokens) {
      if (token === word) return true;
      if (word.length >= 5 && token.length > word.length && (token.startsWith(word) || token.endsWith(word))) return true;
    }
  }
  return false;
}

/** Tokens of the leaf segment, plus any parent segments (nested context). */
function splitPath(path: string): { leaf: string[]; parents: string[] } {
  const segments = path.split(".");
  const leafSegment = segments.at(-1) ?? path;
  return { leaf: nameTokens(leafSegment), parents: segments.slice(0, -1).flatMap((segment) => nameTokens(segment)) };
}

const ISO_CURRENCIES = new Set([
  "EUR", "USD", "GBP", "CHF", "JPY", "CNY", "CAD", "AUD", "NZD", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "RON", "BGN",
  "MXN", "BRL", "ARS", "CLP", "COP", "PEN", "INR", "ZAR", "TRY", "SGD", "HKD", "KRW", "AED", "SAR", "ILS", "THB", "IDR", "MYR", "PHP",
]);

/**
 * Observed in every value: category labels that are all ISO currency codes.
 * The profiler only forms categories from lowercase tokens, so uppercase codes
 * ("EUR") stay plain strings and are left to the name lexicon (a hypothesis).
 * Values stay local; only the concept is used.
 */
function looksLikeCurrencyCodes(field: FieldProfile): boolean {
  const labels = field.categories?.map((item) => item.value.trim().toUpperCase()) ?? [];
  return labels.length > 0 && labels.every((label) => ISO_CURRENCIES.has(label));
}

function qualifierFor(concept: Concept, tokens: readonly string[], parents: readonly string[]): ConceptQualifier | null {
  const all = [...tokens, ...parents];
  const allowed: Partial<Record<Concept, readonly ConceptQualifier[]>> = {
    email: ["billing", "work", "personal", "contact", "sales-owner", "emergency"],
    phone: ["mobile", "fax", "work", "personal", "emergency", "contact", "billing"],
    "street-address": ["billing", "shipping", "work", "personal"],
    city: ["billing", "shipping", "work", "personal"],
    "postal-code": ["billing", "shipping", "work", "personal"],
    region: ["billing", "shipping"],
    country: ["billing", "shipping"],
    "person-name": ["contact", "sales-owner", "emergency"],
    "given-name": ["contact", "sales-owner", "emergency"],
    "family-name": ["contact", "sales-owner", "emergency"],
    amount: ["net", "gross", "tax", "unit", "total"],
  };
  for (const qualifier of allowed[concept] ?? []) {
    // A qualifier word that is itself the concept word (mobile for phone) still qualifies; "contact" alone does not qualify a contact name twice.
    if (hit(all, Q[qualifier])) return qualifier;
  }
  return null;
}

function inferFromName(field: FieldProfile, siblings: readonly string[]): Concept | null {
  const { leaf, parents } = splitPath(field.path);
  const context = [...parents, ...leaf];
  const has = (words: Lexicon) => hit(leaf, words);
  const hasAny = (words: Lexicon) => hit(context, words);

  // Booleans: every yes/no field is a flag.
  if (field.type === "boolean") return "consent-flag";

  // Dates: the qualifier word decides, the date word is optional (dob, alta, created_at).
  if (field.type === "date" || field.type === "datetime") {
    if (has(L.birth)) return "birth-date";
    if (has(L.modified)) return "modified-date";
    if (has(L.due)) return "due-date";
    if (has(L.end)) return "end-date";
    if (has(L.created)) return "created-date";
    if (has(L.start)) return "start-date";
    if (has(L.transactionDate)) return "transaction-date";
    return null;
  }

  if (field.type === "number" || field.type === "integer") {
    if (has(L.quantity)) return "quantity";
    if (has(L.amount) && !has(L.id)) return "amount";
    if (has(L.postal)) return "postal-code";
    if (has(L.phone)) return "phone";
  }

  if (has(L.email)) return null; // email is decided by the observed format only

  if (has(L.currency)) return "currency-code";
  if (has(L.url)) return "url";
  if (has(L.language)) return "language-code";
  if (has(L.priority)) return "priority";

  if (has(L.status)) {
    if (hasAny(L.transaction) && !hasAny(["account", "cuenta", "konto", "acct"])) {
      // A payment or invoice status is a payment status; other transactions are orders.
      if (hasAny(["payment", "pago", "zahlung", "betaling", "paiement", "pagamento", "invoice", "factura", "rechnung", "factuur", "fattura", "fatura", "pmt", "inv", "billing", "cobro", "cobranca"])) return "payment-status";
      return "order-status";
    }
    if (hasAny(["payment", "pago", "zahlung", "betaling", "paiement", "pagamento", "pmt", "billing", "cobro"])) return "payment-status";
    if (hasAny(L.customer)) return "account-status";
    return null;
  }

  // Identifiers: an id word with an entity word.
  const codeLike = !field.containsSpaces;
  if (codeLike && (has(L.id) || (leaf.length === 1 && field.allValuesUnique))) {
    if (has(L.postal)) return "postal-code";
    if (has(L.phone)) return "phone";
    if (has(L.employee) && !has(L.customer)) return "employee-id";
    if (has(L.product)) return "product-id";
    if (has(L.transaction)) return "transaction-id";
    if (has(L.customer)) return "customer-id";
    if (has(L.id) && leaf.length > 1) {
      // "tax_id", "vat_number": a reference code of another kind.
      if (has(["tax", "vat", "nif", "cif", "ustid", "steuer", "btw", "iban", "license", "licencia", "passport", "pasaporte", "dni", "nie", "ssn", "insurance", "seguro", "plate", "matricula", "kenteken"])) return "other-identifier";
    }
  }

  if (has(L.nameWord) && has(L.fullName)) return "person-name";
  if (has(L.given)) return "given-name";
  if (has(L.family)) return "family-name";
  if (has(L.job) && !has(L.id)) return "job-title";
  if (has(L.street)) return "street-address";
  if (has(L.postal)) return "postal-code";
  if (has(L.city)) return "city";
  if (has(L.country)) return "country";
  if (has(L.region) && !has(L.status)) return "region";
  if (has(L.phone)) return "phone";
  if (has(L.note)) return "note";

  if (has(L.organization)) return "organization-name";
  if (has(L.personAlone) && field.containsSpaces) return "person-name";
  if (has(L.nameWord)) {
    if (hasAny(L.organization)) return "organization-name";
    if (hasAny(L.person)) return "person-name";
    // A lone "name" next to a family-name field is the given name.
    const siblingFamily = siblings.some((sibling) => hit(splitPath(sibling).leaf, L.family));
    if (siblingFamily && leaf.length === 1) return "given-name";
    return null;
  }

  if (has(L.category)) return "category";
  return null;
}

/**
 * Deterministic concept for one field. Value-shape evidence first (observed),
 * then a field-name hypothesis. Returns null when nothing specific is known:
 * no concept is better than a guessed one.
 */
export function inferConcept(field: FieldProfile, siblings: readonly string[] = []): ConceptClaim | null {
  if (field.type === "unsupported") return null;
  const { leaf, parents } = splitPath(field.path);
  if (field.type === "enum" && looksLikeCurrencyCodes(field)) {
    return { concept: "currency-code", qualifier: null, evidence: "value-shape", status: "observed" };
  }
  if (field.format === "email") {
    return { concept: "email", qualifier: qualifierFor("email", leaf, parents), evidence: "value-shape", status: "observed" };
  }
  const concept = inferFromName(field, siblings);
  if (!concept || !conceptCompatible(concept, field)) return null;
  return { concept, qualifier: qualifierFor(concept, leaf, parents), evidence: "field-name", status: "hypothesis" };
}

/** A user- or Nano-applied concept, validated against the profile. Null when it contradicts observed facts. */
export function reviewedConcept(concept: Concept, field: FieldProfile, evidence: "user" | "on-device-model"): ConceptClaim | null {
  if (!conceptCompatible(concept, field)) return null;
  const { leaf, parents } = splitPath(field.path);
  return { concept, qualifier: qualifierFor(concept, leaf, parents), evidence, status: evidence === "user" ? "confirmed" : "hypothesis" };
}
