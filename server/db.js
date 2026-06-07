const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const { encrypt, decrypt, isSensitive } = require("./services/crypto");

const db = new DatabaseSync(path.join(__dirname, "fleurieux.db"));

db.prepare("PRAGMA journal_mode = WAL").run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS pvs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    objet TEXT NOT NULL,
    source TEXT DEFAULT 'manuel',
    statut TEXT DEFAULT 'Analysé',
    votes_pour INTEGER DEFAULT 0,
    votes_contre INTEGER DEFAULT 0,
    votes_abstention INTEGER DEFAULT 0,
    points TEXT DEFAULT '[]',
    anomalies TEXT DEFAULT '[]',
    notes TEXT DEFAULT '',
    url_source TEXT DEFAULT '',
    pdfs TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now'))
  )
`).run();

// Migrations colonnes pvs
for (const sql of [
  "ALTER TABLE pvs ADD COLUMN pdfs TEXT DEFAULT '[]'",
  "ALTER TABLE pvs ADD COLUMN pdf_text TEXT DEFAULT ''",
  "ALTER TABLE pvs ADD COLUMN recours_limite TEXT DEFAULT ''",
  "ALTER TABLE pvs ADD COLUMN ai_analysed INTEGER DEFAULT 0",
]) { try { db.prepare(sql).run(); } catch (_) {} }

// Table budget inter-années
db.prepare(`
  CREATE TABLE IF NOT EXISTS budgets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pv_id INTEGER,
    annee INTEGER NOT NULL,
    poste TEXT NOT NULL,
    montant REAL NOT NULL,
    nature TEXT DEFAULT 'fonctionnement',
    created_at TEXT DEFAULT (datetime('now'))
  )
`).run();

// ── NOUVELLES TABLES ───────────────────────────────────────────────────────────

// Séances live (mode conseiller pendant la réunion)
db.prepare(`
  CREATE TABLE IF NOT EXISTS seances_live (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    heure_debut TEXT DEFAULT '',
    heure_fin TEXT DEFAULT '',
    statut TEXT DEFAULT 'en_cours',
    quorum INTEGER DEFAULT 0,
    presents INTEGER DEFAULT 0,
    notes TEXT DEFAULT '',
    exported_pv_id INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS live_points (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seance_id INTEGER NOT NULL,
    ordre INTEGER NOT NULL DEFAULT 0,
    titre TEXT NOT NULL,
    vote_pour INTEGER DEFAULT 0,
    vote_contre INTEGER DEFAULT 0,
    vote_abstention INTEGER DEFAULT 0,
    resultat TEXT DEFAULT '',
    anomalie INTEGER DEFAULT 0,
    anomalie_desc TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    duree_min INTEGER DEFAULT 0,
    FOREIGN KEY (seance_id) REFERENCES seances_live(id)
  )
`).run();

// Questions écrites (CGCT L2121-26)
db.prepare(`
  CREATE TABLE IF NOT EXISTS questions_ecrites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date_envoi TEXT DEFAULT '',
    date_limite_reponse TEXT DEFAULT '',
    destinataire TEXT DEFAULT 'maire',
    objet TEXT NOT NULL,
    texte TEXT NOT NULL,
    statut TEXT DEFAULT 'brouillon',
    reponse TEXT DEFAULT '',
    date_reponse TEXT DEFAULT '',
    base_legale TEXT DEFAULT 'CGCT L2121-26',
    relances INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )
`).run();

// CADA requests (accès aux documents administratifs)
db.prepare(`
  CREATE TABLE IF NOT EXISTS cada_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date_demande TEXT NOT NULL,
    date_limite TEXT DEFAULT '',
    destinataire TEXT DEFAULT 'mairie',
    document_demande TEXT NOT NULL,
    motif TEXT DEFAULT '',
    statut TEXT DEFAULT 'envoyée',
    reponse TEXT DEFAULT '',
    date_reponse TEXT DEFAULT '',
    lien_document TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )
`).run();

// PWA push subscriptions
db.prepare(`
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    endpoint TEXT UNIQUE NOT NULL,
    keys TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )
`).run();

// Table logs synchro automatique
db.prepare(`
  CREATE TABLE IF NOT EXISTS sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ran_at TEXT DEFAULT (datetime('now')),
    seances_found INTEGER DEFAULT 0,
    seances_imported INTEGER DEFAULT 0,
    triggered_by TEXT DEFAULT 'manual',
    error TEXT DEFAULT ''
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS failles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT,
    gravite TEXT DEFAULT 'Moyenne',
    statut TEXT DEFAULT 'Ouvert',
    date TEXT,
    cgct TEXT DEFAULT '',
    titre TEXT NOT NULL,
    description TEXT DEFAULT '',
    conseil TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS lois (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    id_lf TEXT,
    titre TEXT NOT NULL,
    date TEXT,
    impact TEXT DEFAULT 'Moyenne',
    domaine TEXT DEFAULT '',
    statut TEXT DEFAULT 'À surveiller',
    resume TEXT DEFAULT '',
    action TEXT DEFAULT '',
    url TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )
`).run();

// ── BIBLIOTHÈQUE DE MODÈLES ───────────────────────────────────────────────────
db.prepare(`
  CREATE TABLE IF NOT EXISTS modeles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    titre TEXT NOT NULL,
    categorie TEXT DEFAULT 'Question écrite',
    contenu TEXT NOT NULL,
    variables TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now'))
  )
`).run();

// ── COURRIERS OFFICIELS ────────────────────────────────────────────────────────
db.prepare(`
  CREATE TABLE IF NOT EXISTS courriers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT DEFAULT 'Question écrite',
    destinataire TEXT DEFAULT 'Maire',
    objet TEXT NOT NULL,
    contenu TEXT NOT NULL,
    date_envoi TEXT DEFAULT '',
    date_reponse_limite TEXT DEFAULT '',
    statut TEXT DEFAULT 'brouillon',
    reponse TEXT DEFAULT '',
    date_reponse TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )
`).run();

// ── SUIVI DES ENGAGEMENTS ─────────────────────────────────────────────────────
db.prepare(`
  CREATE TABLE IF NOT EXISTS engagements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    titre TEXT NOT NULL,
    auteur TEXT DEFAULT '',
    categorie TEXT DEFAULT 'Autre',
    date_prise TEXT DEFAULT '',
    echeance TEXT DEFAULT '',
    statut TEXT DEFAULT 'Promis',
    preuve_pv_id INTEGER DEFAULT 0,
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )
`).run();

// ── JOURNAL DE TERRAIN ────────────────────────────────────────────────────────
db.prepare(`
  CREATE TABLE IF NOT EXISTS journal_terrain (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    lieu TEXT DEFAULT '',
    type TEXT DEFAULT 'Constat terrain',
    contenu TEXT NOT NULL,
    tags TEXT DEFAULT '[]',
    lien_pv_id INTEGER DEFAULT 0,
    lien_faille_id INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )
`).run();

// ── VEILLE RÉGLEMENTAIRE ─────────────────────────────────────────────────────
db.prepare(`
  CREATE TABLE IF NOT EXISTS veille_alertes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    titre TEXT NOT NULL,
    source TEXT DEFAULT 'JO',
    categorie TEXT DEFAULT 'Communes',
    resume TEXT DEFAULT '',
    impact TEXT DEFAULT 'Moyenne',
    url TEXT DEFAULT '',
    date_parution TEXT DEFAULT '',
    lu INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )
`).run();

for (const sql of [
  "ALTER TABLE live_points ADD COLUMN interventions TEXT DEFAULT '[]'",
  "ALTER TABLE pvs ADD COLUMN geo TEXT DEFAULT ''",
]) { try { db.prepare(sql).run(); } catch (_) {} }

// Table délibérations individuelles (1 par PDF de séance)
db.prepare(`
  CREATE TABLE IF NOT EXISTS deliberations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seance_id INTEGER NOT NULL REFERENCES pvs(id),
    numero TEXT DEFAULT '',
    objet TEXT NOT NULL,
    pdf_url TEXT DEFAULT '',
    pdf_nom TEXT DEFAULT '',
    pdf_text TEXT DEFAULT '',
    statut TEXT DEFAULT 'Importé',
    votes_pour INTEGER DEFAULT 0,
    votes_contre INTEGER DEFAULT 0,
    votes_abstention INTEGER DEFAULT 0,
    anomalies TEXT DEFAULT '[]',
    points TEXT DEFAULT '[]',
    risque_juridique TEXT DEFAULT 'Aucun',
    action_opposition TEXT DEFAULT '',
    is_urba INTEGER DEFAULT 0,
    adresse TEXT DEFAULT '',
    geo TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )
`).run();

// ── AI USAGE LOG ──────────────────────────────────────────────────────────────
db.prepare(`
  CREATE TABLE IF NOT EXISTS ai_usage_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    called_at TEXT DEFAULT (datetime('now')),
    route TEXT NOT NULL,
    model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0
  )
`).run();

// ── CONFIG TABLE ──────────────────────────────────────────────────────────────
db.prepare(`
  CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '',
    updated_at TEXT DEFAULT (datetime('now'))
  )
`).run();

const CONFIG_DEFAULTS = {
  commune_nom:              "Fleurieux-sur-l'Arbresle",
  commune_cp:               "69210",
  commune_insee:            "69082",
  commune_population:       "2000",
  commune_departement:      "69",
  commune_pop_min:          "1500",
  commune_pop_max:          "3500",
  commune_nb_conseillers:   "15",
  commune_quorum:           "8",
  commune_maire:            "M. Aymeric GIRARDON",
  commune_mairie_url:       "https://fleurieuxsurlarbresle.fr",
  commune_deliberations_url:"https://fleurieuxsurlarbresle.fr/fr/rb/2187928/deliberations-prises",
  ai_provider:              "anthropic",
  ai_model:                 "claude-opus-4-5",
  ai_api_key:               "",
  alert_email:              "",
  alert_recours_seuil:      "10",
  sync_enabled:             "1",
  piste_client_id:          "",
  piste_client_secret:      "",
};

const _insertDefault = db.prepare("INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)");
for (const [k, v] of Object.entries(CONFIG_DEFAULTS)) _insertDefault.run(k, v);

function getConfig(key) {
  const row = db.prepare("SELECT value FROM config WHERE key = ?").get(key);
  const raw = (row && row.value !== "") ? row.value : (CONFIG_DEFAULTS[key] ?? "");
  return isSensitive(key) ? decrypt(raw) : raw;
}

function getAllConfig() {
  const rows = db.prepare("SELECT key, value FROM config").all();
  const result = { ...CONFIG_DEFAULTS };
  for (const r of rows) {
    if (r.value !== "") {
      result[r.key] = isSensitive(r.key) ? decrypt(r.value) : r.value;
    }
  }
  return result;
}

function setConfig(key, value) {
  const stored = isSensitive(key) ? encrypt(value) : value;
  db.prepare(
    "INSERT OR REPLACE INTO config (key, value, updated_at) VALUES (?, ?, datetime('now'))"
  ).run(key, stored);
}

function runInTransaction(fn) {
  db.prepare("BEGIN").run();
  try {
    fn();
    db.prepare("COMMIT").run();
  } catch (err) {
    db.prepare("ROLLBACK").run();
    throw err;
  }
}

// Seed initial data if tables are empty
const pvCount = db.prepare("SELECT COUNT(*) as n FROM pvs").get().n;
if (pvCount === 0) {
  const insertPv = db.prepare(`
    INSERT INTO pvs (date, objet, source, statut, votes_pour, votes_contre, votes_abstention, points, anomalies, notes)
    VALUES (@date, @objet, @source, @statut, @pour, @contre, @abstention, @points, @anomalies, @notes)
  `);
  runInTransaction(() => {
    insertPv.run({
      date: "2024-03-18", objet: "Vote du budget primitif 2024",
      source: "manuel", statut: "Alerte", pour: 9, contre: 3, abstention: 1,
      points: JSON.stringify(["Budget total : 2,4M€", "Hausse taxe foncière de 3%", "Voirie : 180k€"]),
      anomalies: JSON.stringify(["Convocation reçue 4 jours avant séance (légal : 5j — CGCT L2121-10)"]),
      notes: "Conserver la preuve de réception.",
    });
    insertPv.run({
      date: "2024-05-06", objet: "Approbation révision du PLU",
      source: "manuel", statut: "Alerte", pour: 10, contre: 2, abstention: 1,
      points: JSON.stringify(["Classement 3 parcelles zone UA", "Suppression espace vert protégé"]),
      anomalies: JSON.stringify(["Suppression EBC sans enquête publique préalable (Code Urb. L151-23)"]),
      notes: "Potentielle illégalité — consulter dossier.",
    });
    insertPv.run({
      date: "2024-06-17", objet: "Marché entretien espaces verts",
      source: "manuel", statut: "Conforme", pour: 11, contre: 2, abstention: 0,
      points: JSON.stringify(["Marché Vertz'O : 85k€/an", "Durée 3 ans renouvelable"]),
      anomalies: JSON.stringify([]),
      notes: "",
    });
  });
}

const failleCount = db.prepare("SELECT COUNT(*) as n FROM failles").get().n;
if (failleCount === 0) {
  const insertFaille = db.prepare(`
    INSERT INTO failles (type, gravite, statut, date, cgct, titre, description, conseil)
    VALUES (@type, @gravite, @statut, @date, @cgct, @titre, @description, @conseil)
  `);
  runInTransaction(() => {
    insertFaille.run({
      type: "Légalité", gravite: "Haute", statut: "Ouvert", date: "2024-03-18", cgct: "L2121-10",
      titre: "Délai de convocation non respecté — 18/03/2024",
      description: "Convocation reçue 4 jours avant la séance. Délai légal : 5 jours minimum (CGCT L2121-10).",
      conseil: "Recours gracieux au maire par LRAR. Si récidive : déféré préfectoral. Conserver preuve de réception.",
    });
    insertFaille.run({
      type: "Urbanisme", gravite: "Haute", statut: "En cours", date: "2024-05-06", cgct: "L151-23",
      titre: "Suppression EBC sans enquête publique",
      description: "La suppression d'un Espace Boisé Classé au PLU nécessite une enquête publique préalable (Code Urb. L151-23).",
      conseil: "Recours gracieux dans les 2 mois. Saisine Tribunal Administratif de Lyon possible.",
    });
    insertFaille.run({
      type: "Transparence", gravite: "Moyenne", statut: "Résolu", date: "2024-06-26", cgct: "L2121-25",
      titre: "Compte-rendu non publié sous 8 jours",
      description: "CR du 17/06/2024 non disponible sur le site mairie au 26/06 (CGCT L2121-25 : délai 8 jours).",
      conseil: "Signaler par courrier au maire. Si persistance : saisine CADA.",
    });
  });
}

// Calcule la date limite de recours gracieux (2 mois après la séance)
function recoursLimite(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d)) return "";
  d.setMonth(d.getMonth() + 2);
  return d.toISOString().slice(0, 10);
}

function parsePv(row) {
  if (!row) return null;
  const recours = row.recours_limite || recoursLimite(row.date);
  const today = new Date().toISOString().slice(0, 10);
  const joursRestants = recours
    ? Math.ceil((new Date(recours) - new Date(today)) / 86400000)
    : null;
  return {
    ...row,
    votes: { pour: row.votes_pour, contre: row.votes_contre, abstention: row.votes_abstention },
    points: JSON.parse(row.points || "[]"),
    anomalies: JSON.parse(row.anomalies || "[]"),
    pdfs: JSON.parse(row.pdfs || "[]"),
    recours_limite: recours,
    jours_recours: joursRestants,
  };
}

module.exports = { db, parsePv, getConfig, getAllConfig, setConfig, CONFIG_DEFAULTS };
