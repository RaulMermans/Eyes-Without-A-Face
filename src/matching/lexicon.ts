/**
 * Local Semantic Matcher — fixed multilingual normalization table (Sprint 18D).
 *
 * General business vocabulary in English (incl. common abbreviations), German,
 * French, Dutch, Spanish, Italian and Portuguese, mapped to English concept
 * tokens. Written from general language knowledge, NOT from fixture field
 * names or ground truth. Surface forms are lowercase and accent-free (the
 * matcher folds accents and ß before lookup). A surface form may expand to
 * several concept tokens ("dob" → "birth date").
 *
 * The table is a hint for ranking only: a translated name is never evidence of
 * meaning (AGENTS.md, Sprint 15: "Name similarity is a hint, never evidence").
 */

const GROUPS: Readonly<Record<string, readonly string[]>> = {
  customer: ["customer", "customers", "cust", "cus", "cst", "client", "clients", "kunde", "kunden", "kund", "kd", "klant", "klanten", "cliente", "clientes", "clienti"],
  account: ["account", "accounts", "acct", "acc", "konto", "konten", "compte", "rekening", "cuenta", "conto", "conta"],
  member: ["member", "members", "mbr", "mitglied", "mitglieds", "membre", "lid", "leden", "lidmaatschap", "miembro", "socio", "membro", "adherent", "membership", "mitgliedschaft"],
  user: ["user", "usr", "benutzer", "nutzer", "utilisateur", "gebruiker", "usuario", "utente", "utilizador"],
  contact: ["contact", "kontakt", "contacto", "contatto", "contato"],
  person: ["person", "personne", "persoon", "persona", "pessoa"],
  owner: ["owner", "eigentumer", "eigentuemer", "besitzer", "inhaber", "proprietaire", "eigenaar", "propietario", "proprietario", "dono", "titular", "holder"],
  status: ["status", "stat", "sts", "state", "zustand", "statut", "etat", "estado", "stato", "situacao", "situacion"],
  active: ["active", "aktiv", "actif", "actief", "activo", "attivo", "ativo"],
  inactive: ["inactive", "inaktiv", "inactif", "inactief", "inactivo", "inattivo", "inativo"],
  cancelled: ["cancelled", "canceled", "storniert", "gekuendigt", "gekundigt", "annule", "geannuleerd", "cancelado", "annullato", "cancellato"],
  pending: ["pending", "ausstehend", "attente", "wachtend", "pendiente", "pendente", "sospeso"],
  paid: ["paid", "bezahlt", "paye", "betaald", "pagado", "pagato", "pago"],
  unpaid: ["unpaid", "unbezahlt", "offen", "impaye", "onbetaald", "impagado", "insoluto"],
  closed: ["closed", "geschlossen", "ferme", "gesloten", "cerrado", "chiuso", "fechado"],
  payment: ["payment", "payments", "pmt", "pay", "zahlung", "zahlungs", "bezahlung", "paiement", "betaling", "betaal", "pagamento", "pagos"],
  email: ["email", "emails", "mail", "emailadresse", "emailadres", "mailadres", "courriel", "correo", "eml"],
  phone: ["phone", "tel", "tele", "telephone", "telefon", "telefoon", "telefono", "telefone", "fon", "ph", "phn", "tfno", "telf"],
  mobile: ["mobile", "mobil", "handy", "gsm", "movil", "cellulare", "celular", "portable", "cell", "cellphone", "mob", "telemovel", "telemovil", "celulare", "movel"],
  date: ["date", "dt", "dte", "datum", "fecha", "data", "dat", "ts", "timestamp", "datetime", "day", "dag", "jour", "dia", "giorno"],
  time: ["time", "zeit", "uhrzeit", "heure", "tijd", "hora", "ora", "tempo", "tiempo"],
  birth: ["birth", "born", "birthday", "geburt", "geburts", "geburtstag", "naissance", "geboorte", "verjaardag", "nacimiento", "cumpleanos", "nascita", "compleanno", "nascimento", "aniversario"],
  "birth date": ["dob", "bday", "birthdate", "geburtsdatum", "geboortedatum", "gebdat"],
  created: ["created", "create", "creation", "erstellt", "erstell", "erstellung", "angelegt", "cree", "aangemaakt", "aanmaak", "creado", "creacion", "creato", "creazione", "criado", "criacao", "registered", "registration", "signup", "joined", "anmeldung", "registrierung", "inscription", "inscrit", "inschrijving", "registro", "iscrizione", "cadastro", "since", "seit", "depuis", "sinds", "desde", "dal"],
  updated: ["updated", "update", "modified", "modify", "changed", "geaendert", "geandert", "aenderung", "anderung", "aktualisiert", "modifie", "gewijzigd", "bijgewerkt", "modificado", "actualizado", "modificato", "aggiornato", "atualizado", "alterado", "mod", "upd"],
  start: ["start", "starts", "begin", "beginn", "debut", "aanvang", "inicio", "inizio", "comienzo"],
  end: ["end", "ende", "fin", "einde", "eind", "fine", "fim", "expiry", "expires", "expiration", "expire", "ablauf", "termino", "scade"],
  due: ["due", "faellig", "fallig", "faelligkeit", "falligkeit", "echeance", "verval", "vervaldatum", "vencimiento", "scadenza", "vencimento", "deadline", "frist"],
  last: ["last", "lname", "surname", "family", "nachname", "familienname", "achternaam", "apellido", "apellidos", "cognome", "sobrenome", "apelido"],
  first: ["first", "fname", "given", "forename", "vorname", "prenom", "voornaam", "primeiro", "primer"],
  "first name": ["firstname", "givenname"],
  "last name": ["lastname", "familyname"],
  name: ["name", "names", "nm", "nam", "nom", "naam", "nombre", "nome", "bezeichnung", "benaming", "denominacion", "denominazione"],
  full: ["full", "voll", "vollstaendig", "complet", "complete", "volledig", "volledige", "completo", "completa"],
  company: ["company", "comp", "firma", "unternehmen", "societe", "entreprise", "bedrijf", "empresa", "azienda", "societa", "organisation", "organization", "org", "organisatie", "organizacion", "organizzazione", "business", "corp", "corporation", "firmenname", "razonsocial", "ragionesociale", "bedrijfsnaam", "nomeempresa"],
  id: ["id", "ids", "ident", "identifier", "identifiant", "number", "no", "nr", "num", "nro", "nbr", "nmbr", "nummer", "numero", "numer", "code", "ref", "reference", "referenz", "referentie", "referencia", "riferimento", "key", "kennung", "codigo", "codice", "cod", "uuid", "guid"],
  plan: ["plan", "plans", "tarif", "tariff", "abo", "abonnement", "subscription", "formule", "paket", "pakket", "package", "piano", "plano", "suscripcion", "abbonamento", "assinatura"],
  tier: ["tier", "level", "lvl", "stufe", "niveau", "nivel", "livello", "grade", "rang", "rank"],
  segment: ["segment", "segments", "segmento", "sector", "branche"],
  category: ["category", "categories", "cat", "kategorie", "categorie", "categoria", "rubrik", "rubriek", "class", "klasse", "classe", "clase"],
  type: ["type", "types", "typ", "tipo", "soort", "sorte", "kind"],
  language: ["language", "lang", "lng", "sprache", "langue", "taal", "idioma", "lingua", "locale"],
  country: ["country", "ctry", "cntry", "land", "pays", "pais", "paese", "nation", "nazione"],
  city: ["city", "stadt", "ort", "ville", "stad", "woonplaats", "ciudad", "citta", "cidade", "town", "gemeente", "localidad", "localita", "municipio"],
  street: ["street", "str", "strasse", "rue", "straat", "calle", "rua"],
  address: ["address", "addr", "adr", "adresse", "adres", "direccion", "indirizzo", "endereco", "morada", "anschrift"],
  postal: ["zip", "zipcode", "postal", "postcode", "plz", "postleitzahl", "cp", "cap", "postleit", "cep"],
  region: ["region", "provinz", "provincia", "province", "bundesland", "regio", "kanton", "canton", "departement"],
  priority: ["priority", "prio", "prioritaet", "prioritat", "priorite", "prioriteit", "prioridad", "priorita", "prioridade", "dringlichkeit", "urgency", "urgence", "urgentie", "urgencia", "urgenza"],
  amount: ["amount", "amt", "betrag", "montant", "bedrag", "importe", "importo", "valor", "total", "summe", "totaal", "somme", "sum"],
  price: ["price", "preis", "prix", "prijs", "precio", "prezzo", "preco", "cost", "kosten", "cout", "coste", "costo", "custo"],
  currency: ["currency", "curr", "ccy", "waehrung", "wahrung", "devise", "monnaie", "valuta", "moneda", "divisa", "moeda"],
  quantity: ["quantity", "qty", "menge", "anzahl", "quantite", "aantal", "hoeveelheid", "cantidad", "quantita", "quantidade", "count", "cnt", "stuck", "stueck"],
  order: ["order", "orders", "ord", "bestellung", "bestell", "auftrag", "commande", "bestelling", "pedido", "ordine", "encomenda"],
  invoice: ["invoice", "inv", "rechnung", "rechnungs", "facture", "factuur", "factura", "fattura", "fatura", "bill", "billing"],
  product: ["product", "products", "prod", "produkt", "produit", "producto", "prodotto", "produto", "artikel", "article", "articulo", "articolo", "artigo", "item", "sku"],
  employee: ["employee", "emp", "empl", "mitarbeiter", "employe", "medewerker", "werknemer", "empleado", "dipendente", "funcionario", "staff"],
  note: ["note", "notes", "notiz", "bemerkung", "anmerkung", "remarque", "opmerking", "notitie", "nota", "notas", "comment", "comments", "kommentar", "commentaire", "commentaar", "comentario", "commento", "remark"],
  gender: ["gender", "sex", "geschlecht", "sexe", "geslacht", "genero", "sesso", "sexo"],
  salutation: ["salutation", "anrede", "civilite", "aanhef", "saludo", "tratamiento"],
  description: ["description", "desc", "beschreibung", "omschrijving", "beschrijving", "descripcion", "descrizione", "descricao"],
  channel: ["channel", "kanal", "canal", "kanaal", "canale", "source", "quelle", "bron", "fuente", "fonte", "origin", "herkunft", "origine", "herkomst", "origen"],
  consent: ["consent", "einwilligung", "zustimmung", "consentement", "toestemming", "consentimiento", "consenso", "consentimento", "optin"],
  branch: ["branch", "filiale", "niederlassung", "agence", "vestiging", "filial", "sucursal", "sede", "standort", "location", "site"],
  booking: ["booking", "bookings", "buchung", "reservation", "reserva", "reservering", "boeking", "prenotazione", "reservierung"],
  appointment: ["appointment", "termin", "rendezvous", "afspraak", "cita", "appuntamento", "consulta"],
  group: ["group", "grp", "gruppe", "groupe", "groep", "grupo", "gruppo"],
  department: ["department", "dept", "abteilung", "afdeling", "departamento", "reparto", "service"],
  age: ["age", "alter", "leeftijd", "edad", "eta", "idade"],
  year: ["year", "yr", "jahr", "annee", "jaar", "ano", "anno"],
  month: ["month", "monat", "mois", "maand", "mes", "mese"],
  course: ["course", "kurs", "cours", "cursus", "curso", "corso", "lesson", "lektion", "lecon", "les", "leccion", "lezione", "aula"],
  student: ["student", "students", "schueler", "schuler", "etudiant", "eleve", "leerling", "estudiante", "alumno", "studente", "aluno", "pupil"],
  teacher: ["teacher", "lehrer", "enseignant", "professeur", "docent", "leraar", "profesor", "insegnante", "professore", "professor", "instructor", "trainer"],
  patient: ["patient", "patients", "patienten", "paciente", "paziente"],
  animal: ["animal", "pet", "haustier", "dier", "huisdier", "animale", "mascota", "bicho"],
  vehicle: ["vehicle", "fahrzeug", "vehicule", "voertuig", "vehiculo", "veicolo", "veiculo", "car", "auto"],
  license: ["license", "licence", "lizenz", "permis", "rijbewijs", "licencia", "patente", "fuhrerschein", "fuehrerschein"],
  exam: ["exam", "examination", "pruefung", "prufung", "examen", "esame", "exame", "test"],
  room: ["room", "raum", "zimmer", "salle", "chambre", "kamer", "ruimte", "sala", "habitacion", "stanza", "quarto"],
  desk: ["desk", "schreibtisch", "bureau", "scrivania", "werkplek", "arbeitsplatz", "workplace", "workstation"],
  message: ["message", "msg", "nachricht", "bericht", "mensaje", "messaggio", "mensagem"],
  url: ["url", "website", "web", "webseite", "homepage", "sitio", "link"],
  balance: ["balance", "saldo", "solde"],
  discount: ["discount", "rabatt", "remise", "korting", "descuento", "sconto", "desconto"],
  tax: ["tax", "vat", "steuer", "mwst", "ust", "taxe", "tva", "btw", "belasting", "impuesto", "iva", "imposta", "imposto"],
  weight: ["weight", "gewicht", "poids", "peso"],
  size: ["size", "groesse", "grosse", "taille", "maat", "grootte", "tamano", "taglia", "tamanho"],
  color: ["color", "colour", "farbe", "couleur", "kleur", "colore", "cor", "shade", "tint", "tonalita", "farbton"],
  previous: ["previous", "prev", "vorherig", "letzte", "letzter", "precedent", "dernier", "vorige", "laatste", "anterior", "ultimo", "precedente"],
  next: ["next", "naechste", "nachste", "prochain", "volgende", "proximo", "prossimo"],
  home: ["home", "privat", "domicile", "thuis", "casa", "prive", "personal"],
  work: ["work", "arbeit", "beruflich", "travail", "werk", "trabajo", "lavoro", "trabalho", "business", "office", "buro", "buero"],
  sales: ["sales", "vertrieb", "verkauf", "vente", "ventes", "verkoop", "ventas", "vendite", "vendas"],
  incl: ["incl", "inkl", "including", "inclusive", "inclusief", "incluso", "incluido", "incluida", "compris", "ttc", "brutto", "gross", "bruto", "lordo"],
  excl: ["excl", "exkl", "excluding", "exclusive", "exclusief", "escluso", "excluido", "excluida", "ht", "netto", "net", "neto", "netto", "zzgl"],
  primary: ["primary", "main", "principal", "haupt", "hoofd", "principale", "primario", "primaria"],
  secondary: ["secondary", "alt", "alternate", "alternative", "second", "zweit", "secondaire", "secundario", "secundaria", "secondario", "secondaria", "tweede", "other", "andere", "otro", "altro"],
  billing: ["billing", "bill", "invoice", "invoicing", "rechnung", "factuur", "facturation", "factura", "fatturazione", "faturamento", "fatura"],
  shipping: ["shipping", "delivery", "ship", "lieferung", "liefer", "versand", "livraison", "levering", "envio", "entrega", "spedizione", "consegna"],
  min: ["min", "minimum", "mindest", "minimo"],
  max: ["max", "maximum", "hochst", "hoechst", "massimo", "maximo"],
  broker: ["broker", "brokers", "makler", "courtier", "makelaar", "corredor", "mediatore", "intermediario", "agent", "agente", "vertreter"],
  employer: ["employer", "arbeitgeber", "employeur", "werkgever", "empleador", "datore", "empregador", "patronal"],
  guardian: ["guardian", "parent", "parents", "eltern", "vormund", "erziehungsberechtigter", "tuteur", "voogd", "ouder", "ouders", "tutor", "padre", "madre", "genitore", "genitori", "responsavel", "encarregado", "encargado"],
  emergency: ["emergency", "notfall", "urgence", "nood", "noodcontact", "emergencia", "emergenza", "ice"],
  manager: ["manager", "mgr", "leiter", "responsable", "beheerder", "gerente", "responsabile", "rep", "representative", "advisor", "berater", "conseiller", "adviseur", "asesor", "consulente", "verwalter", "verwaltung", "administrator", "admin", "gestionnaire", "administrador", "amministratore", "beheer"],
  line: ["line", "row", "zeile", "ligne", "regel", "rij", "linea", "fila", "riga", "linha", "idx", "index", "seq", "sequence", "lfd", "laufende"],
};

/** Surface form → concept tokens. Built once; frozen. */
export const LEXICON: ReadonlyMap<string, readonly string[]> = (() => {
  const map = new Map<string, readonly string[]>();
  for (const [concept, words] of Object.entries(GROUPS)) {
    const tokens = concept.split(" ");
    for (const word of words) if (!map.has(word)) map.set(word, tokens);
  }
  return map;
})();

/**
 * Generic concept tokens: they carry little information alone ("customer id"
 * vs "order id" share only "id"). The matcher down-weights them.
 */
export const GENERIC_TOKENS: ReadonlySet<string> = new Set(["id", "name", "date", "status", "type", "time", "description", "category", "group", "line"]);

/** English filler words dropped from destination descriptions. */
export const STOPWORDS: ReadonlySet<string> = new Set([
  "a", "an", "and", "any", "are", "as", "at", "be", "been", "by", "can", "do", "does", "each", "else", "for", "from", "has", "have", "if", "in", "into", "is", "it", "its",
  "may", "must", "not", "of", "on", "one", "or", "otherwise", "should", "so", "such", "than", "that", "the", "their", "them", "then", "there", "these", "this", "those",
  "to", "use", "used", "was", "we", "were", "what", "which", "who", "will", "with", "without", "you", "your", "e", "g", "eg", "ie", "via", "per", "also", "only",
]);
