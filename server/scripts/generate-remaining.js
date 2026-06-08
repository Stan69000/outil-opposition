#!/usr/bin/env node
// Steps 2-5 : engagements, budget, tendances, rapport

process.chdir(__dirname + "/..");
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const { db } = require("../db");
const { getAIClient, getAIModel, communeLabel } = require("../services/ai-client");
const { trackUsage } = require("../services/ai-tracker");

const client = getAIClient();
const model  = getAIModel();

function log(msg) { console.log(`\n${"─".repeat(60)}\n${msg}`); }
function ok(msg)  { console.log(`  ✓ ${msg}`); }

async function ai(prompt, max_tokens = 3000) {
  const msg = await client.messages.create({
    model, max_tokens,
    messages: [{ role: "user", content: prompt }],
  });
  trackUsage("generate-remaining", msg.model, msg.usage);
  const raw = msg.content[0].text.trim().replace(/```json\n?|```/g, "").trim();
  // Tronquer au dernier } valide si réponse coupée
  const lastBrace = raw.lastIndexOf("}");
  return lastBrace > 0 ? raw.slice(0, lastBrace + 1) : raw;
}

// ── 2. ENGAGEMENTS ────────────────────────────────────────────────────────────
async function genEngagements() {
  log("2/4 — Engagements extraits des délibérations votées");

  const delibs = db.prepare(`
    SELECT d.objet, d.votes_pour, d.votes_contre, p.date as date_seance
    FROM deliberations d
    JOIN pvs p ON p.id = d.seance_id
    WHERE d.votes_pour > 0
    ORDER BY p.date DESC
    LIMIT 50
  `).all();

  const prompt = `Tu es expert en droit des collectivités territoriales.
Analyse ces délibérations votées du conseil municipal de ${communeLabel()} et identifie les engagements politiques majeurs pris (projets votés, décisions structurantes pour les habitants).

DÉLIBÉRATIONS (50 les plus récentes) :
${delibs.map(d => `• ${d.date_seance} | ${d.objet} | ${d.votes_pour}p/${d.votes_contre}c`).join("\n")}

Retourne UNIQUEMENT ce JSON valide (max 15 engagements significatifs) :
{"engagements":[{"titre":"titre court max 80 chars","categorie":"Budget|Urbanisme|Services|Personnel|Partenariat|Autre","date_prise":"YYYY-MM-DD","echeance":null,"notes":"pourquoi l opposition doit suivre cet engagement"}]}`;

  const raw = await ai(prompt, 2000);
  const parsed = JSON.parse(raw);
  const engagements = parsed.engagements || [];

  const insert = db.prepare(
    "INSERT INTO engagements (titre, auteur, categorie, date_prise, echeance, statut, notes) VALUES (?,?,?,?,?,'Promis',?)"
  );
  const existants = db.prepare("SELECT titre FROM engagements").all().map(e => e.titre.toLowerCase());

  let created = 0;
  for (const e of engagements) {
    if (!e.titre || existants.includes(e.titre.toLowerCase())) continue;
    insert.run(e.titre, "Conseil municipal", e.categorie || "Autre", e.date_prise || "", e.echeance || null, e.notes || "");
    created++;
  }
  ok(`${created} engagement(s) créé(s) (total : ${db.prepare("SELECT COUNT(*) as n FROM engagements").get().n})`);
}

// ── 3. BUDGET ─────────────────────────────────────────────────────────────────
async function genBudget() {
  log("3/4 — Extraction budget");

  if (db.prepare("SELECT COUNT(*) as n FROM budgets").get().n > 0) {
    ok("Budget déjà rempli — skip"); return;
  }

  const delibs = db.prepare(`
    SELECT d.objet, d.pdf_text, p.date as date_seance
    FROM deliberations d JOIN pvs p ON p.id = d.seance_id
    WHERE (lower(d.objet) LIKE '%budget%' OR lower(d.objet) LIKE '%compte%'
        OR lower(d.objet) LIKE '%taux%taxe%' OR lower(d.objet) LIKE '%emprunt%')
    AND length(d.pdf_text) > 200
    ORDER BY p.date
    LIMIT 20
  `).all();

  if (!delibs.length) { ok("Aucune délibération budgétaire — skip"); return; }

  const prompt = `Extrais les données budgétaires de ces délibérations de ${communeLabel()}.

${delibs.map(d => `=== ${d.date_seance} — ${d.objet} ===\n${d.pdf_text?.slice(0,800)}`).join("\n\n")}

JSON valide uniquement (montants en euros entiers) :
{"lignes":[{"annee":2024,"poste":"Fonctionnement dépenses","montant":1250000,"nature":"fonctionnement"}]}
Nature : fonctionnement|investissement|fiscalite|subvention|emprunt`;

  const raw = await ai(prompt, 2000);
  const { lignes } = JSON.parse(raw);
  const insert = db.prepare("INSERT INTO budgets (pv_id,annee,poste,montant,nature) VALUES (?,?,?,?,?)");
  for (const l of lignes) insert.run(null, l.annee, l.poste, l.montant, l.nature || "fonctionnement");
  ok(`${lignes.length} ligne(s) budgétaires insérées`);
}

// ── 4. TENDANCES ──────────────────────────────────────────────────────────────
async function genTendances() {
  log("4/4a — Tendances 2020-2026");

  const pvs = db.prepare("SELECT date, objet, votes_pour, votes_contre, votes_abstention, anomalies FROM pvs ORDER BY date").all();
  const failles = db.prepare("SELECT titre, gravite, date FROM failles ORDER BY gravite DESC LIMIT 20").all();

  const prompt = `Expert droit collectivités territoriales. Analyse l'historique du conseil municipal de ${communeLabel()} pour l'opposition.

${pvs.length} SÉANCES :
${pvs.map(p => {
  let a=[]; try{a=JSON.parse(p.anomalies||"[]");}catch{}
  return `${p.date} — ${p.objet} | ${p.votes_pour}p/${p.votes_contre}c${a.length?` | ⚠${a.length}`:""}`;
}).join("\n")}

FAILLES GRAVES :
${failles.map(f=>`${f.gravite} | ${f.titre}`).join("\n")}

JSON valide uniquement :
{"patterns":[{"titre":"titre","description":"avec dates","occurrences":3,"gravite":"Haute|Moyenne|Basse","action":"recommandation"}],"alerte_principale":"phrase clé"}`;

  const raw = await ai(prompt, 2000);
  const result = JSON.parse(raw);
  console.log(`\n  ALERTE : ${result.alerte_principale}`);
  (result.patterns||[]).forEach(p => console.log(`  [${p.gravite}] ${p.titre} (×${p.occurrences})`));
  ok(`${(result.patterns||[]).length} patterns détectés`);
}

// ── 5. RAPPORT CITOYEN ────────────────────────────────────────────────────────
async function genRapport() {
  log("4/4b — Rapport citoyen");

  const pvs    = db.prepare("SELECT COUNT(*) as n FROM pvs").get();
  const failles = db.prepare("SELECT * FROM failles ORDER BY gravite DESC").all();
  const hautes  = failles.filter(f => f.gravite === "Haute");

  const prompt = `Rédige un rapport d'opposition municipal pour les habitants de ${communeLabel()}.
Ton accessible, factuel, citoyen.

${pvs.n} séances analysées (2020-2026) | ${failles.length} irrégularités dont ${hautes.length} graves

IRRÉGULARITÉS GRAVES :
${hautes.slice(0,10).map(f=>`• ${f.titre} (${f.date})`).join("\n")}

JSON valide uniquement :
{"titre":"titre accrocheur","resume_executif":"2-3 phrases citoyen","bilan":{"seances":${pvs.n},"irregularites_graves":${hautes.length},"taux_conformite":"xx%"},"faits_marquants":[{"date":"...","fait":"description","impact":"pour les habitants"}],"priorites":["prio 1","prio 2","prio 3"],"appel_citoyen":"2-3 phrases mobilisation"}`;

  const raw = await ai(prompt, 2000);
  const r = JSON.parse(raw);
  console.log(`\n  TITRE : ${r.titre}`);
  console.log(`  ${r.resume_executif}`);
  console.log(`  Conformité : ${r.bilan?.taux_conformite}`);
  (r.faits_marquants||[]).slice(0,3).forEach(f => console.log(`  • ${f.date} — ${f.fait}`));
  ok("Rapport citoyen généré");
}

async function main() {
  console.log(`\n${"═".repeat(60)}\n  GÉNÉRATION STEPS 2-5\n${"═".repeat(60)}`);
  await genEngagements();
  await genBudget();
  await genTendances();
  await genRapport();
  console.log(`\n${"═".repeat(60)}\n  TERMINÉ\n${"═".repeat(60)}\n`);
  process.exit(0);
}

main().catch(e => { console.error("\nERREUR :", e.message); process.exit(1); });
