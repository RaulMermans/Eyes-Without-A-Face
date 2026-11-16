// Sprint 16A QA — eight fictional business scenarios and the generic variant
// engine. Each record starts as a hidden CANONICAL entity; the source record is
// a rendering of it (names, labels, date conventions, case, nesting), and the
// expected destination record is a projection of the canonical entity. The
// oracle therefore never parses source text and never runs EYES code.
import { asciiSlug, canary, company, person, randomDate, randomInstant, renderDate, renderEmail, setPath } from "./lib.mjs";

const L = (en, es, de) => ({ en, es, de });

/** The eight scenarios. Field `names` are candidate SOURCE names; the destination name is `target`. */
export const SCENARIOS = [
  {
    id: "A",
    sector: "CRM → Helpdesk",
    title: "Helpdesk account (fictional customer migration)",
    requirement: "Migrate customer accounts into the helpdesk. Each account needs its id, the primary contact email (lower-case), the account status, the date the account was opened, the company name and the support phone.",
    fields: [
      { target: "customerId", kind: "id", prefix: ["CU", "ACC", "K"], names: ["customer_id", "acctNo", "kundennummer", "id_cliente", "account_ref"] },
      { target: "primaryEmail", kind: "email", names: ["contact_email", "emailPrincipal", "e_mail", "correo", "main_contact_mail"] },
      {
        target: "accountStatus",
        kind: "enum",
        values: ["active", "suspended", "churned", "trial"],
        lexicon: { active: L(["active", "Active", "live"], ["activo", "activa"], ["aktiv"]), suspended: L(["suspended", "on hold"], ["suspendido"], ["gesperrt"]), churned: L(["churned", "closed"], ["baja", "cerrado"], ["gekündigt", "geschlossen"]), trial: L(["trial", "evaluation"], ["prueba"], ["testphase"]) },
        names: ["account_state", "estado_cuenta", "kontostatus", "lifecycle", "acct_status"],
      },
      { target: "createdOn", kind: "date", names: ["opened_on", "fecha_alta", "angelegt_am", "since", "created"] },
      { target: "companyName", kind: "text", gen: company, nest: ["company"], names: ["company_name", "empresa", "firma", "org", "organisation"], leaf: ["name", "legal_name", "nombre"] },
      { target: "phone", kind: "text", gen: (r) => `+${r.pick(["34", "49", "31", "44"])} ${r.int(100, 999)} ${r.int(100000, 999999)}`, names: ["phone", "telefono", "telefon", "support_line"] },
    ],
    distractors: [
      { kind: "email", names: ["billing_email", "correo_facturacion", "rechnung_mail"], presence: 0.7 },
      { kind: "enum", values: ["paid", "overdue", "pending"], lexicon: { paid: L(["paid"], ["pagado"], ["bezahlt"]), overdue: L(["overdue"], ["vencido"], ["überfällig"]), pending: L(["pending"], ["pendiente"], ["offen"]) }, names: ["payment_status", "estado_pago", "zahlungsstatus"] },
      { kind: "datetime", names: ["last_login", "ultimo_acceso", "letzter_login"] },
      { kind: "id", prefix: ["LEG"], names: ["legacy_crm_id", "old_id"] },
      { kind: "notes", names: ["notes", "comentarios", "notizen"] },
    ],
  },
  {
    id: "B",
    sector: "E-commerce → Order management",
    title: "Order management line (fictional shop orders)",
    requirement: "Load orders into the order-management system: order id, the customer reference, when the order was placed, fulfilment status, currency, quantity and unit price. totalAmount (quantity × unit price minus discount) is wanted but optional; it needs arithmetic.",
    fields: [
      { target: "orderId", kind: "id", prefix: ["ORD", "SO", "PED"], names: ["order_id", "pedido", "bestellnr", "orderNumber"] },
      { target: "customerRef", kind: "ref", prefix: ["C"], pool: 9, names: ["customer_ref", "cliente", "kunde", "buyer_id"] },
      { target: "orderedAt", kind: "datetime", names: ["placed_at", "fecha_pedido", "bestellt_am", "created_ts"] },
      {
        target: "fulfillmentStatus",
        kind: "enum",
        values: ["pending", "packed", "shipped", "delivered", "returned"],
        lexicon: { pending: L(["pending", "awaiting_fulfillment"], ["pendiente"], ["offen"]), packed: L(["packed", "ready"], ["empaquetado"], ["verpackt"]), shipped: L(["shipped", "in progress"], ["enviado"], ["versandt"]), delivered: L(["delivered", "done"], ["entregado"], ["zugestellt"]), returned: L(["returned", "rma"], ["devuelto"], ["retoure"]) },
        names: ["fulfilment", "estado_envio", "versandstatus", "order_state"],
      },
      { target: "currency", kind: "enum", values: ["EUR", "USD", "GBP", "CHF"], lexicon: { EUR: L(["EUR", "eur", "€"], ["EUR", "euro"], ["EUR", "Euro"]), USD: L(["USD", "usd", "$"], ["USD"], ["USD"]), GBP: L(["GBP", "£"], ["GBP"], ["GBP"]), CHF: L(["CHF"], ["CHF"], ["CHF", "Fr."]) }, names: ["currency", "moneda", "waehrung", "ccy"] },
      { target: "quantity", kind: "integer", min: 1, max: 12, names: ["qty", "cantidad", "menge", "units"] },
      { target: "unitPrice", kind: "number", min: 2, max: 480, names: ["unit_price", "precio_unitario", "einzelpreis", "price_each"] },
      { target: "totalAmount", kind: "derived", type: "number", optional: true, note: "needs arithmetic (quantity × unitPrice − discount): no supported operation" },
    ],
    distractors: [
      { kind: "id", prefix: ["INV", "FAC"], names: ["invoice_number", "factura", "rechnungsnr"] },
      { kind: "ref", prefix: ["SKU"], pool: 6, names: ["sku", "articulo", "artikel"] },
      { kind: "number", min: 2, max: 600, names: ["list_price", "precio_lista", "listenpreis"] },
      { kind: "integer", min: 1, max: 5, names: ["line_count", "lineas", "positionen"] },
      { kind: "number", min: 0, max: 40, names: ["discount", "descuento", "rabatt"] },
      { kind: "enum", values: ["authorized", "captured", "refunded"], lexicon: { authorized: L(["authorized"], ["autorizado"], ["autorisiert"]), captured: L(["captured"], ["cobrado"], ["eingezogen"]), refunded: L(["refunded"], ["reembolsado"], ["erstattet"]) }, names: ["payment_state", "estado_cobro", "zahlung"] },
    ],
  },
  {
    id: "C",
    sector: "HR → Employee directory",
    title: "Employee directory entry (fictional staff)",
    requirement: "Publish the internal directory: employee id, work email, department, job level, employment status, start date and manager id (empty for the top of the hierarchy). Salary band, date of birth and personal email must never reach the directory.",
    fields: [
      { target: "employeeId", kind: "id", prefix: ["E", "EMP", "MA"], names: ["employee_id", "num_empleado", "personalnummer", "staffId"] },
      { target: "workEmail", kind: "email", work: true, names: ["work_email", "correo_trabajo", "dienst_mail", "corp_email"] },
      { target: "department", kind: "text", gen: (r) => r.pick(["Finanzas", "Customer Care", "Logística", "Forschung & Entwicklung", "People Ops", "Ventas Iberia", "Qualitätssicherung", "Platform Engineering"]), names: ["department", "departamento", "abteilung", "org_unit"] },
      {
        target: "jobLevel",
        kind: "enum",
        values: ["junior", "mid", "senior", "lead", "principal"],
        lexicon: { junior: L(["L1", "junior", "Associate"], ["Nivel 1", "junior"], ["Stufe 1", "Junior"]), mid: L(["L2", "intermediate"], ["Nivel 2"], ["Stufe 2"]), senior: L(["L3", "senior"], ["Nivel 3", "sénior"], ["Stufe 3", "Senior"]), lead: L(["L4", "lead"], ["Nivel 4", "responsable"], ["Stufe 4", "Leitung"]), principal: L(["L5", "principal"], ["Nivel 5"], ["Stufe 5"]) },
        names: ["grade", "nivel", "karrierestufe", "band"],
      },
      {
        target: "employmentStatus",
        kind: "enum",
        values: ["active", "on_leave", "terminated", "contractor"],
        lexicon: { active: L(["active", "employed"], ["activo", "alta"], ["aktiv", "beschäftigt"]), on_leave: L(["on leave", "leave"], ["excedencia", "baja temporal"], ["beurlaubt", "elternzeit"]), terminated: L(["terminated", "left"], ["baja"], ["ausgeschieden"]), contractor: L(["contractor", "external"], ["externo"], ["extern", "freelancer"]) },
        names: ["status", "situacion", "beschaeftigung", "emp_state"],
      },
      { target: "startDate", kind: "date", names: ["start_date", "fecha_incorporacion", "eintritt", "hired_on"] },
      { target: "managerId", kind: "ref", prefix: ["E"], pool: 6, optional: true, presence: 0.8, names: ["manager_id", "responsable_id", "vorgesetzter", "reports_to"] },
    ],
    distractors: [
      { kind: "email", names: ["personal_email", "correo_personal", "privat_mail"], sensitive: true },
      { kind: "date", names: ["date_of_birth", "fecha_nacimiento", "geburtsdatum"], sensitive: true },
      { kind: "enum", values: ["b1", "b2", "b3", "b4"], lexicon: { b1: L(["band_a"], ["banda_a"], ["gruppe_a"]), b2: L(["band_b"], ["banda_b"], ["gruppe_b"]), b3: L(["band_c"], ["banda_c"], ["gruppe_c"]), b4: L(["band_d"], ["banda_d"], ["gruppe_d"]) }, names: ["salary_band", "banda_salarial", "gehaltsband"], sensitive: true },
      { kind: "notes", names: ["hr_notes", "notas_rrhh", "personalnotiz"] },
    ],
  },
  {
    id: "D",
    sector: "Financial ledger → Reporting",
    title: "Reporting ledger line (fictional transactions)",
    requirement: "Report ledger entries: entry id, booking date, signed amount, currency, debit/credit direction, invoice reference and counterparty name. Amounts keep their sign and decimals exactly.",
    fields: [
      { target: "entryId", kind: "id", prefix: ["JE", "BU", "AS"], names: ["entry_id", "asiento", "buchungsnr", "journal_ref"] },
      { target: "bookingDate", kind: "date", names: ["booking_date", "fecha_contable", "buchungsdatum", "posted"] },
      { target: "amount", kind: "number", min: -9000, max: 9000, names: ["amount", "importe", "betrag", "amt"] },
      { target: "currency", kind: "enum", values: ["EUR", "USD", "GBP"], lexicon: { EUR: L(["EUR", "eur"], ["EUR"], ["EUR"]), USD: L(["USD"], ["USD", "dólar"], ["USD"]), GBP: L(["GBP"], ["GBP", "libra"], ["GBP"]) }, names: ["currency", "divisa", "waehrung"] },
      { target: "direction", kind: "enum", values: ["debit", "credit"], lexicon: { debit: L(["D", "Dr", "debit"], ["cargo", "debe"], ["Soll", "S"]), credit: L(["C", "Cr", "credit"], ["abono", "haber"], ["Haben", "H"]) }, names: ["dc_flag", "debe_haber", "soll_haben", "side"] },
      { target: "invoiceRef", kind: "id", prefix: ["INV", "FRA", "RE"], names: ["invoice_ref", "factura", "rechnung", "doc_no"] },
      { target: "counterpartyName", kind: "text", gen: company, names: ["counterparty", "contraparte", "geschaeftspartner", "vendor_customer"] },
    ],
    distractors: [
      { kind: "number", min: -50000, max: 50000, names: ["running_balance", "saldo", "kontostand"] },
      { kind: "date", names: ["value_date", "fecha_valor", "wertstellung"] },
      { kind: "ref", prefix: ["ACC"], pool: 5, names: ["ledger_account", "cuenta", "sachkonto"] },
      { kind: "notes", names: ["memo", "concepto", "verwendungszweck"] },
    ],
  },
  {
    id: "E",
    sector: "Logistics → Shipment tracking",
    title: "Shipment tracking record (fictional parcels)",
    requirement: "Track shipments: shipment id, carrier, delivery state, destination country (ISO code), warehouse code, shipped time and delivered time (empty while not delivered).",
    fields: [
      { target: "shipmentId", kind: "id", prefix: ["SHP", "ENV", "SDG"], names: ["shipment_id", "envio", "sendungsnr", "tracking_no"] },
      { target: "carrier", kind: "text", gen: (r) => r.pick(["Rápido Norte", "Paketblitz", "Coastline Freight", "Vía Láctea Cargo", "Nordkurier Express"]), names: ["carrier", "transportista", "spediteur", "shipper_name"] },
      {
        target: "deliveryState",
        kind: "enum",
        values: ["created", "in_transit", "out_for_delivery", "delivered", "exception"],
        lexicon: { created: L(["label created", "created"], ["creado"], ["angelegt"]), in_transit: L(["in transit", "in progress"], ["en tránsito"], ["unterwegs"]), out_for_delivery: L(["out for delivery"], ["en reparto"], ["in zustellung"]), delivered: L(["delivered"], ["entregado"], ["zugestellt"]), exception: L(["exception", "delayed"], ["incidencia"], ["störung"]) },
        names: ["status", "estado", "sendungsstatus", "scan_state"],
      },
      { target: "destinationCountry", kind: "enum", values: ["DE", "ES", "FR", "NL", "IT"], lexicon: { DE: L(["DE", "Germany"], ["Alemania"], ["Deutschland"]), ES: L(["ES", "Spain"], ["España"], ["Spanien"]), FR: L(["FR", "France"], ["Francia"], ["Frankreich"]), NL: L(["NL", "Netherlands"], ["Países Bajos"], ["Niederlande"]), IT: L(["IT", "Italy"], ["Italia"], ["Italien"]) }, nest: ["route", "destination"], leaf: ["country"], names: ["dest_country", "pais_destino", "zielland"] },
      { target: "warehouseCode", kind: "ref", prefix: ["WH"], pool: 4, names: ["warehouse", "almacen", "lager", "dc_code"] },
      { target: "shippedAt", kind: "datetime", names: ["shipped_at", "fecha_envio", "versandt_am", "dispatch_ts"] },
      { target: "deliveredAt", kind: "datetime", optional: true, presentWhen: { field: "deliveryState", equals: "delivered" }, names: ["delivered_at", "fecha_entrega", "zugestellt_am", "pod_ts"] },
    ],
    distractors: [
      { kind: "enum", values: ["DE", "ES", "PL"], lexicon: { DE: L(["DE"], ["DE"], ["DE"]), ES: L(["ES"], ["ES"], ["ES"]), PL: L(["PL"], ["PL"], ["PL"]) }, names: ["origin_country", "pais_origen", "herkunftsland"] },
      { kind: "datetime", names: ["last_scan_at", "ultimo_escaneo", "letzter_scan"] },
      { kind: "array", names: ["events", "eventos", "ereignisse"] },
      { kind: "notes", names: ["driver_note", "nota_conductor", "fahrerhinweis"] },
    ],
  },
  {
    id: "F",
    sector: "Healthcare administration → Scheduling",
    title: "Scheduling slot (entirely fictional administrative appointments; no clinical data)",
    requirement: "Move administrative appointment slots into the scheduling tool: appointment id, appointment date, scheduled start, scheduling status, department and the contact email for reminders. Internal admin notes stay out.",
    fields: [
      { target: "appointmentId", kind: "id", prefix: ["APT", "CITA", "TER"], names: ["appointment_id", "cita_id", "termin_nr", "booking_ref"] },
      { target: "appointmentDate", kind: "date", names: ["appt_date", "fecha_cita", "termin_datum", "slot_day"] },
      { target: "scheduledStart", kind: "datetime", names: ["start_time", "hora_inicio", "beginn", "slot_start"] },
      {
        target: "status",
        kind: "enum",
        values: ["booked", "confirmed", "cancelled", "no_show", "completed"],
        lexicon: { booked: L(["booked", "requested"], ["reservada", "pendiente"], ["gebucht"]), confirmed: L(["confirmed"], ["confirmada"], ["bestätigt"]), cancelled: L(["cancelled", "canceled"], ["anulada", "cancelada"], ["storniert", "abgesagt"]), no_show: L(["no-show", "no show"], ["no presentado"], ["nicht erschienen"]), completed: L(["completed", "attended"], ["realizada"], ["erledigt"]) },
        names: ["slot_status", "estado_cita", "terminstatus", "booking_state"],
      },
      { target: "department", kind: "text", gen: (r) => r.pick(["Radiología (admin)", "Front Desk North", "Physiotherapie Verwaltung", "Admisiones", "Outpatient Scheduling"]), names: ["department", "servicio", "abteilung", "unit"] },
      { target: "contactEmail", kind: "email", names: ["reminder_email", "correo_aviso", "erinnerung_mail", "contact"] },
    ],
    distractors: [
      { kind: "enum", values: ["sent", "failed", "pending"], lexicon: { sent: L(["sent"], ["enviado"], ["gesendet"]), failed: L(["failed"], ["fallido"], ["fehlgeschlagen"]), pending: L(["pending"], ["pendiente"], ["ausstehend"]) }, names: ["reminder_status", "estado_aviso", "erinnerungsstatus"] },
      { kind: "id", prefix: ["REF"], names: ["referral_code", "codigo_derivacion", "ueberweisung"] },
      { kind: "datetime", names: ["created_at", "creado", "angelegt"] },
      { kind: "notes", names: ["internal_admin_note", "nota_interna", "interne_notiz"] },
    ],
  },
  {
    id: "G",
    sector: "Event ticketing → Attendee management",
    title: "Attendee record (fictional event tickets)",
    requirement: "Import tickets into attendee management: ticket id, event code, admission category, attendance state, attendee email and purchase time. One attendee may hold several tickets; every ticket stays a separate record.",
    fields: [
      { target: "ticketId", kind: "id", prefix: ["TKT", "ENT", "KRT"], names: ["ticket_id", "entrada", "karten_nr", "barcode"] },
      { target: "eventCode", kind: "ref", prefix: ["EV"], pool: 3, names: ["event_code", "evento", "veranstaltung", "show_id"] },
      {
        target: "admission",
        kind: "enum",
        values: ["general", "vip", "reduced", "staff"],
        lexicon: { general: L(["General", "GA", "general admission"], ["General", "Entrada general"], ["Allgemein", "Normal"]), vip: L(["VIP", "vip", "Vip"], ["VIP"], ["VIP"]), reduced: L(["Concession", "reduced"], ["Reducida", "Estudiante"], ["Ermäßigt"]), staff: L(["Staff", "crew"], ["Personal"], ["Mitarbeiter"]) },
        names: ["ticket_type", "tipo_entrada", "kartenart", "tier"],
      },
      {
        target: "attendance",
        kind: "enum",
        values: ["registered", "checked_in", "no_show", "cancelled"],
        lexicon: { registered: L(["registered", "issued"], ["registrado"], ["registriert"]), checked_in: L(["checked in", "scanned"], ["presente", "acreditado"], ["eingecheckt"]), no_show: L(["no-show"], ["ausente"], ["nicht erschienen"]), cancelled: L(["cancelled", "void"], ["anulada"], ["storniert"]) },
        names: ["attendance", "asistencia", "einlass", "scan_status"],
      },
      { target: "attendeeEmail", kind: "email", poolEmails: 0.6, names: ["attendee_email", "correo_asistente", "teilnehmer_mail", "buyer"] },
      { target: "purchasedAt", kind: "datetime", names: ["purchased_at", "fecha_compra", "gekauft_am", "order_ts"] },
    ],
    distractors: [
      { kind: "email", names: ["buyer_email", "correo_comprador", "kaeufer_mail"], presence: 0.5 },
      { kind: "enum", values: ["web", "box_office", "partner"], lexicon: { web: L(["web"], ["web"], ["web"]), box_office: L(["box_office"], ["taquilla"], ["kasse"]), partner: L(["partner"], ["socio"], ["partner"]) }, names: ["channel", "canal", "kanal"] },
      { kind: "notes", names: ["notes", "observaciones", "anmerkung"] },
    ],
  },
  {
    id: "H",
    sector: "SaaS support → Issue tracker",
    title: "Issue tracker item (fictional support tickets)",
    requirement: "Escalate support tickets into the issue tracker: issue key, priority (how fast to respond), severity (how bad the impact is), customer tier, workflow state, opened time, reporter email and a short summary. Priority and severity are different things and must not be swapped.",
    fields: [
      { target: "issueKey", kind: "id", prefix: ["SUP", "TIC", "HD"], names: ["ticket_key", "clave", "vorgang", "case_number"] },
      { target: "priority", kind: "enum", values: ["urgent", "high", "normal", "low"], lexicon: { urgent: L(["P1", "urgent"], ["P1", "urgente"], ["P1", "dringend"]), high: L(["P2", "high"], ["P2", "alta"], ["P2", "hoch"]), normal: L(["P3", "normal"], ["P3", "media"], ["P3", "normal"]), low: L(["P4", "low"], ["P4", "baja"], ["P4", "niedrig"]) }, names: ["prio", "prioridad", "dringlichkeit", "response_class"] },
      { target: "severity", kind: "enum", values: ["critical", "major", "minor", "cosmetic"], lexicon: { critical: L(["S1", "sev1", "critical"], ["S1", "crítica"], ["S1", "kritisch"]), major: L(["S2", "sev2", "major"], ["S2", "grave"], ["S2", "schwer"]), minor: L(["S3", "sev3", "minor"], ["S3", "leve"], ["S3", "gering"]), cosmetic: L(["S4", "sev4", "cosmetic"], ["S4", "estética"], ["S4", "kosmetisch"]) }, names: ["sev", "severidad", "schweregrad", "impact_level"] },
      { target: "customerTier", kind: "enum", values: ["free", "pro", "enterprise"], lexicon: { free: L(["free", "community"], ["gratuito"], ["kostenlos"]), pro: L(["pro", "team"], ["profesional"], ["Pro"]), enterprise: L(["enterprise", "ent"], ["empresa"], ["Unternehmen"]) }, names: ["plan", "plan_cliente", "tarif", "tier"] },
      { target: "state", kind: "enum", values: ["open", "in_progress", "waiting", "resolved", "closed"], lexicon: { open: L(["open", "new"], ["abierto", "nuevo"], ["offen", "neu"]), in_progress: L(["in progress", "working"], ["en curso"], ["in bearbeitung"]), waiting: L(["waiting on customer", "pending"], ["pendiente"], ["wartend"]), resolved: L(["resolved", "solved"], ["resuelto"], ["gelöst"]), closed: L(["closed"], ["cerrado"], ["geschlossen"]) }, names: ["status", "estado", "zustand", "workflow"] },
      { target: "openedAt", kind: "datetime", names: ["opened_at", "abierto_el", "eroeffnet", "created"] },
      { target: "reporterEmail", kind: "email", names: ["requester", "correo_solicitante", "melder_mail", "reporter"] },
      { target: "summary", kind: "text", gen: (r) => r.pick(["Export to CSV times out", "Login loop after SSO change", "Facturas duplicadas en el panel", "Dashboard lädt nicht", "Webhook retries flood endpoint", "Zeitzone im Bericht falsch", "No se puede adjuntar PDF"]), names: ["subject", "asunto", "betreff", "title"] },
    ],
    distractors: [
      { kind: "enum", values: ["low", "medium", "high"], lexicon: { low: L(["low"], ["bajo"], ["gering"]), medium: L(["medium"], ["medio"], ["mittel"]), high: L(["high"], ["alto"], ["hoch"]) }, names: ["business_impact", "impacto", "auswirkung"] },
      { kind: "datetime", names: ["updated_at", "actualizado", "aktualisiert"] },
      { kind: "email", names: ["assignee_email", "correo_agente", "bearbeiter_mail"] },
      { kind: "notes", names: ["internal_comment", "comentario_interno", "interner_kommentar"] },
    ],
  },
];

/** Destination JSON Schema for a scenario (independent of EYES). */
export function destinationSchema(scenario) {
  const properties = {};
  const required = [];
  for (const field of scenario.fields) {
    const kind = field.kind === "derived" ? field.type : field.kind;
    properties[field.target] =
      kind === "email"
        ? { type: "string", format: "email" }
        : kind === "enum"
          ? { enum: field.values }
          : kind === "date"
            ? { type: "string", format: "date" }
            : kind === "datetime"
              ? { type: "string", format: "date-time" }
              : kind === "integer"
                ? { type: "integer" }
                : kind === "number"
                  ? { type: "number" }
                  : kind === "boolean"
                    ? { type: "boolean" }
                    : { type: "string", minLength: 1 };
    if (!field.optional) required.push(field.target);
  }
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: `${scenario.title.replace(/ \(.*\)$/, "")} destination`,
    type: "object",
    additionalProperties: false,
    required,
    properties,
  };
}

const LANGS = { en: ["en"], es: ["es"], de: ["de"], mixed: ["en", "es", "de"] };

/** Pick the label(s) a variant uses for each canonical enum value. Labels must be unique across values. */
function chooseLabels(r, field, lang, { synonyms }) {
  const used = new Set();
  const labelsFor = {};
  for (const value of field.values) {
    const pool = LANGS[lang].flatMap((code) => field.lexicon[value][code] ?? []);
    const fresh = [...new Set(pool)].filter((label) => !used.has(label));
    const chosen = r.shuffle(fresh).slice(0, synonyms && fresh.length > 1 && r.chance(0.5) ? 2 : 1);
    if (chosen.length === 0) chosen.push(`${value}_${lang}`);
    chosen.forEach((label) => used.add(label));
    labelsFor[value] = chosen;
  }
  return labelsFor;
}

const TOKEN_FREE = (r, field) => `${r.pick(field.prefix)}-${r.int(10000, 99999)}`;

/**
 * Generate one variant. `cfg`: { format, records, lang, dateStyle, datetimeStyle, nested, synonyms,
 * inject: { badEmail, setAside, missingRequired, invalidDate, duplicateId }, csvNumbers: "plain"|"fixed2",
 * xlsxDates: "text"|"cells", padText }
 */
export function generateVariant(scenario, cfg, r, canaries) {
  const nameUsed = new Set();
  const pickName = (names) => {
    const options = r.shuffle(names).filter((name) => !nameUsed.has(name));
    const name = options[0] ?? `${names[0]}_${r.int(2, 9)}`;
    nameUsed.add(name);
    return name;
  };
  // Source path per field (truth for the discovery metric).
  const layout = scenario.fields.map((field) => {
    if (field.kind === "derived") return { field, path: null };
    if (cfg.nested && field.nest && cfg.format === "json") {
      const leaf = field.leaf ? r.pick(field.leaf) : pickName(field.names);
      const parent = field.nest.map((part) => part).join(".");
      const path = `${parent}.${leaf}`;
      nameUsed.add(path);
      return { field, path };
    }
    return { field, path: pickName(field.names) };
  });
  const distractors = scenario.distractors
    .filter((d) => !(d.kind === "array" && cfg.format !== "json"))
    .map((d) => ({ field: d, path: pickName(d.names) }));
  const labels = Object.fromEntries(
    [...layout, ...distractors].filter(({ field }) => field.kind === "enum").map(({ field, path }) => [path, chooseLabels(r, field, cfg.lang, cfg)]),
  );
  const n = cfg.records;
  const refPools = {};
  const emailPool = Array.from({ length: Math.max(3, Math.round(n * 0.4)) }, (_, i) => `${asciiSlug(person(r))}.${i}@example.test`);
  const unknownLabel = cfg.lang === "de" ? "unbekannt_alt" : cfg.lang === "es" ? "desconocido_legacy" : "legacy_unknown";

  // Which records get which injection (disjoint).
  const order = r.shuffle([...Array(n).keys()]);
  const take = (count) => order.splice(0, Math.min(count ?? 0, Math.max(0, order.length - 2)));
  const inj = cfg.inject ?? {};
  const badEmail = new Set(take(inj.badEmail));
  const setAside = new Set(take(inj.setAside));
  const missingRequired = new Set(take(inj.missingRequired));
  const invalidDate = new Set(take(inj.invalidDate));
  const duplicateOf = new Map();
  if (inj.duplicateId && n > 4) {
    const [a, b] = take(2).sort((x, y) => x - y);
    if (a !== undefined && b !== undefined) duplicateOf.set(b, a);
  }
  const canaryValue = canary(scenario.id);
  canaries.push({ scenario: scenario.id, value: canaryValue });

  const enumField = layout.find(({ field }) => field.kind === "enum" && !field.optional);
  const emailField = layout.find(({ field }) => field.kind === "email");
  const dateField = layout.find(({ field }) => field.kind === "date");
  const requiredText = layout.find(({ field }) => (field.kind === "text" || field.kind === "ref") && !field.optional);

  const records = [];
  const expected = [];
  const canon = [];
  for (let i = 0; i < n; i += 1) {
    const entity = {};
    const source = {};
    const meta = { outcome: "TRANSFORMED", reasons: [], optionalMissing: [] };
    for (const { field, path } of layout) {
      if (!path) continue;
      let value;
      let rendered;
      switch (field.kind) {
        case "id": {
          const dup = duplicateOf.get(i);
          value = dup !== undefined ? canon[dup][field.target] : `${r.pick(field.prefix)}-${String(10000 + i * 7 + r.int(0, 6)).padStart(5, "0")}`;
          rendered = value;
          break;
        }
        case "ref": {
          refPools[path] ??= Array.from({ length: field.pool }, () => `${r.pick(field.prefix)}-${r.int(100, 999)}`);
          value = r.pick(refPools[path]);
          rendered = value;
          break;
        }
        case "email": {
          const base = field.poolEmails && r.chance(field.poolEmails) ? r.pick(emailPool) : `${asciiSlug(person(r))}.${i}@${field.work ? "corp.example.test" : r.pick(["example.test", "mail.example.org", "example.net"])}`;
          value = base;
          rendered = renderEmail(r, base);
          break;
        }
        case "enum": {
          value = r.pick(field.values);
          rendered = r.pick(labels[path][value]);
          break;
        }
        case "date": {
          const ambiguous = cfg.dateStyle === "mdy-ambiguous" || cfg.dateStyle === "dmy-ambiguous";
          value = randomDate(r, ambiguous ? { maxDay: 12 } : i === 0 ? { minDay: 13 } : {});
          const style = cfg.dateStyle === "mdy-ambiguous" ? "mdy" : cfg.dateStyle === "dmy-ambiguous" ? "dmy" : cfg.dateStyle;
          rendered = cfg.format === "xlsx" && cfg.xlsxDates === "cells" ? { xlsxDate: value } : renderDate(value, style);
          break;
        }
        case "datetime": {
          const inst = randomInstant(r, cfg.datetimeStyle ?? "z");
          value = inst.canonical;
          rendered = inst.rendered;
          break;
        }
        case "text": {
          value = field.gen(r);
          rendered = cfg.padText && r.chance(0.3) ? `  ${value} ` : value;
          break;
        }
        case "integer": {
          value = r.int(field.min, field.max);
          rendered = cfg.format === "csv" ? String(value) : value;
          break;
        }
        case "number": {
          value = Math.round((field.min + r.next() * (field.max - field.min)) * 100) / 100;
          rendered = cfg.format === "csv" ? (cfg.csvNumbers === "fixed2" ? value.toFixed(2) : cfg.csvNumbers === "comma" ? value.toFixed(2).replace(".", ",") : String(value)) : value;
          break;
        }
        default:
          throw new Error(`kind ${field.kind}`);
      }
      entity[field.target] = value;
      let present = (field.presence ?? 1) >= 1 || r.chance(field.presence);
      if (field.presentWhen) present = entity[field.presentWhen.field] === field.presentWhen.equals;
      if (!present) {
        delete entity[field.target];
        if (field.optional) meta.optionalMissing.push(field.target);
        continue;
      }
      setPath(source, path, rendered);
    }
    // Distractors.
    for (const { field, path } of distractors) {
      if ((field.presence ?? 1) < 1 && !r.chance(field.presence)) continue;
      let v;
      if (field.kind === "email") v = renderEmail(r, `${asciiSlug(person(r))}.${r.int(1, 999)}@example.org`);
      else if (field.kind === "enum") v = r.pick(labels[path][r.pick(field.values)]);
      else if (field.kind === "datetime") v = randomInstant(r, "z").rendered;
      else if (field.kind === "date") v = cfg.format === "xlsx" && cfg.xlsxDates === "cells" ? { xlsxDate: randomDate(r) } : renderDate(randomDate(r), cfg.dateStyle?.startsWith("mdy") ? "mdy" : cfg.dateStyle?.startsWith("dmy") ? "dmy" : cfg.dateStyle === "de" ? "de" : "iso");
      else if (field.kind === "id") v = TOKEN_FREE(r, field);
      else if (field.kind === "ref") {
        refPools[path] ??= Array.from({ length: field.pool }, () => `${r.pick(field.prefix)}-${r.int(100, 999)}`);
        v = r.pick(refPools[path]);
      } else if (field.kind === "integer") v = cfg.format === "csv" ? String(r.int(field.min, field.max)) : r.int(field.min, field.max);
      else if (field.kind === "number") {
        const num = Math.round((field.min + r.next() * (field.max - field.min)) * 100) / 100;
        v = cfg.format === "csv" ? String(num) : num;
      } else if (field.kind === "array") v = [{ at: randomInstant(r, "z").rendered, code: r.pick(["SCAN", "HUB", "POD"]) }];
      else if (field.kind === "notes") v = i % 3 === 0 ? `follow-up ${canaryValue}` : r.pick(["call back Tuesday", "prefers email", "llamar por la tarde", "Rückruf erbeten", ""]);
      if (v === "") continue;
      setPath(source, path, v);
    }
    // Canary inside a MAPPED value of record 0: it may appear in the local transformed download, never in the ZIP or any request.
    if (i === 0 && requiredText) {
      const leafValue = `${entity[requiredText.field.target]} ${canaryValue}`;
      entity[requiredText.field.target] = leafValue;
      setPath(source, requiredText.path, leafValue);
    }
    // Injections.
    if (badEmail.has(i) && emailField) {
      setPath(source, emailField.path, r.pick(["nobody at example.test", "missing-at-sign.example.test", "user@", "ana@@example.test"]));
      meta.outcome = "UNRESOLVED";
      meta.reasons.push("INVALID_EMAIL");
    }
    if (setAside.has(i) && enumField) {
      setPath(source, enumField.path, unknownLabel);
      meta.outcome = "QUARANTINED";
      meta.reasons.push("SET_ASIDE_LABEL");
    }
    if (missingRequired.has(i) && requiredText) {
      const parts = requiredText.path.split(".");
      let cur = source;
      for (const part of parts.slice(0, -1)) cur = cur?.[part];
      if (cur) delete cur[parts.at(-1)];
      meta.outcome = "UNRESOLVED";
      meta.reasons.push("MISSING_REQUIRED");
    }
    if (invalidDate.has(i) && dateField && typeof dateField.path === "string") {
      const bad = cfg.dateStyle === "iso" ? "2025-02-30" : cfg.dateStyle === "mdy" ? "02/30/2025" : "30/02/2025";
      setPath(source, dateField.path, bad);
      meta.outcome = "UNRESOLVED";
      meta.reasons.push("INVALID_CALENDAR_DATE");
    }
    canon.push(entity);
    records.push(source);
    const output = {};
    for (const { field, path } of layout) {
      if (!path || !(field.target in entity)) continue;
      output[field.target] = entity[field.target];
    }
    expected.push({ index: i, outcome: meta.outcome, reasons: meta.reasons, optionalMissing: meta.optionalMissing, output: meta.outcome === "TRANSFORMED" ? output : null });
  }
  return { layout, distractors, labels, unknownLabel, records, expected, canaryValue };
}
