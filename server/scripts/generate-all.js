#!/usr/bin/env node
// Génération complète : failles, engagements, budget, tendances, rapport citoyen

process.chdir(__dirname + "/..");
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const { db, getConfig } = require("../db");
const { getAIClient, getAIModel, communeLabel } = require("../services/ai-client");
const { trackUsage } = require("../services/ai-tracker");

const client = getAIClient();
const model  = getAIModel();

function log(msg) { console.log(`\n${"─".repeat(60)}\n${msg}`); }
function ok(msg)  { console.log(`  ✓ ${msg}`); }
function info(msg){ process.stdout.write(`  → ${msg}\r`); }

async function ai(prompt, max_tokens = 2048) {
  const msg = await client.messages.create({
    model,
    max_tokens,
    messages: [{ role: "user", content: prompt }],
  });
  trackUsage("generate-all", msg.model, msg.usage);
  return msg.content[0].text.trim().replace(/```json\n?|```/g, "").trim();
}

// ── 1. FAILLES AUTO ───────────────────────────────────────────────────────────
async function genFailles() {
  log("1/5 — Failles auto depuis délibérations à risque Moyen");

  const delibs = db.prepare(`
    SELECT d.*, p.date as date_seance FROM deliberations d
    JOIN pvs p ON p.id = d.seance_id
    WHERE d.risque_juridique IN ('Moyen', 'Élevé')
    AND length(d.anomalies) > 2
    ORDER BY p.date DESC
  `).all();

  const existantes = db.prepare("SELECT titre FROM failles").all().map(f => f.titre.toLowerCase());
  const insert = db.prepare(`
    INSERT INTO failles (type, gravite, statut, date, cgct, titre, description, conseil)
    VALUES (?, ?, 'Ouvert', ?, ?, ?, ?, ?)
  `);

  let created = 0;
  for (const d of delibs) {
    let anomalies = [];
    try { anomalies = JSON.parse(d.anomalies); } catch { continue; }
    if (!anomalies.length) continue;

    for (const anomalie of anomalies) {
      const titre = `${anomalie.slice(0, 80)} — ${d.date_seance}`;
      if (existantes.includes(titre.toLowerCase())) continue;

      // Extraire référence CGCT si présente
      const cgctMatch = anomalie.match(/CGCT\s+[LRA][\d-]+(?:\s*[\d-]+)?|Code\s+\w+\.?\s+[LRA][\d-]+/i);
      const cgct = cgctMatch ? cgctMatch[0] : "";
      const gravite = d.risque_juridique === "Élevé" ? "Haute" : "Moyenne";
      const type = d.is_urba ? "Urbanisme" : "Légalité";

      insert.run(type, gravite, d.date_seance, cgct, titre, anomalie, d.action_opposition || "");
      existantes.push(titre.toLowerCase());
      created++;
      info(`Faille créée : ${titre.slice(0, 50)}…`);
    }
  }

  ok(`${created} faille(s) créée(s) (total : ${db.prepare("SELECT COUNT(*) as n FROM failles").get().n})`);

  // Passer les PVs en "Analysé" si leurs failles sont maintenant créées
  const updated = db.prepare(`
    UPDATE pvs SET statut = 'Analysé'
    WHERE statut = 'Alerte'
    AND date IN (SELECT DISTINCT date FROM failles)
  `).run();
  if (updated.changes > 0) ok(`${updated.changes} PV(s) passés en Analysé`);
}

// ── 2. ENGAGEMENTS ────────────────────────────────────────────────────────────
async function genEngagements() {
  log("2/5 — Engagements extraits des délibérations votées");

  // Prendre les délibérations avec votes et action_opposition non vide
  const delibs = db.prepare(`
    SELECT d.objet, d.votes_pour, d.votes_contre, d.votes_abstention,
           d.action_opposition, d.risque_juridique, p.date as date_seance, p.id as pv_id
    FROM deliberations d
    JOIN pvs p ON p.id = d.seance_id
    WHERE d.votes_pour > 0 AND length(d.action_opposition) > 10
    ORDER BY p.date DESC
    LIMIT 80
  `).all();

  if (!delibs.length) { ok("Aucune délibération avec action_opposition — skip"); return; }

  const prompt = `Tu es expert en droit des collectivités territoriales.
Analyse ces délibérations du conseil municipal de ${communeLabel()} et identifie les engagements politiques pris (promesses, projets votés, décisions structurantes).

DÉLIBÉRATIONS :
${delibs.map(d => `• ${d.date_seance} | ${d.objet} | Vote ${d.votes_pour}p/${d.votes_contre}c | Action: ${d.action_opposition}`).join("\n")}

Retourne UNIQUEMENT ce JSON valide :
{
  "engagements": [
    {
      "titre": "titre court de l'engagement (max 80 chars)",
      "auteur": "Conseil municipal",
      "categorie": "Budget|Urbanisme|Services|Personnel|Partenariat|Autre",
      "date_prise": "YYYY-MM-DD",
      "echeance": "YYYY-MM-DD ou null si inconnue",
      "notes": "détail de l'engagement et pourquoi l'opposition doit le suivre"
    }
  ]
}
Limite à 20 engagements les plus significatifs.`;

  const raw = await ai(prompt);
  const { engagements } = JSON.parse(raw);

  const insert = db.prepare(`
    INSERT INTO engagements (titre, auteur, categorie, date_prise, echeance, statut, notes)
    VALUES (?, ?, ?, ?, ?, 'Promis', ?)
  `);

  const existants = db.prepare("SELECT titre FROM engagements").all().map(e => e.titre.toLowerCase());
  let created = 0;
  for (const e of engagements) {
    if (existants.includes(e.titre.toLowerCase())) continue;
    insert.run(e.titre, e.auteur || "Conseil municipal", e.categorie || "Autre",
               e.date_prise || "", e.echeance || "", e.notes || "");
    created++;
  }

  ok(`${created} engagement(s) créé(s) (total : ${db.prepare("SELECT COUNT(*) as n FROM engagements").get().n})`);
}

// ── 3. BUDGET ─────────────────────────────────────────────────────────────────
async function genBudget() {
  log("3/5 — Extraction budget depuis délibérations financières");

  const existing = db.prepare("SELECT COUNT(*) as n FROM budgets").get();
  if (existing.n > 0) { ok(`Budget déjà rempli (${existing.n} lignes) — skip`); return; }

  const delibs = db.prepare(`
    SELECT d.objet, d.pdf_text, d.action_opposition, p.date as date_seance
    FROM deliberations d
    JOIN pvs p ON p.id = d.seance_id
    WHERE (lower(d.objet) LIKE '%budget%' OR lower(d.objet) LIKE '%compte%'
        OR lower(d.objet) LIKE '%taux%' OR lower(d.objet) LIKE '%taxe%'
        OR lower(d.objet) LIKE '%emprunt%' OR lower(d.objet) LIKE '%subvention%'
        OR lower(d.objet) LIKE '%dotation%')
    AND length(d.pdf_text) > 100
    ORDER BY p.date
  `).all();

  if (!delibs.length) { ok("Aucune délibération budgétaire avec texte — skip"); return; }

  const prompt = `Extrais les données budgétaires structurées de ces délibérations du conseil municipal de ${communeLabel()}.

DÉLIBÉRATIONS FINANCIÈRES :
${delibs.map(d => `=== ${d.date_seance} — ${d.objet} ===\n${d.pdf_text?.slice(0, 1500)}`).join("\n\n")}

Retourne UNIQUEMENT ce JSON valide (montants en euros) :
{
  "lignes": [
    { "annee": 2024, "poste": "Budget fonctionnement dépenses", "montant": 1250000, "nature": "fonctionnement" },
    { "annee": 2024, "poste": "Budget investissement", "montant": 380000, "nature": "investissement" },
    { "annee": 2024, "poste": "Taxe foncière bâti (taux %)", "montant": 18.5, "nature": "fiscalite" }
  ]
}
Extrais tous les chiffres trouvés. Nature : fonctionnement|investissement|fiscalite|subvention|emprunt.`;

  const raw = await ai(prompt, 2048);
  const { lignes } = JSON.parse(raw);

  const insert = db.prepare("INSERT INTO budgets (pv_id, annee, poste, montant, nature) VALUES (?,?,?,?,?)");
  for (const l of lignes) {
    insert.run(null, l.annee, l.poste, l.montant, l.nature || "fonctionnement");
  }

  ok(`${lignes.length} ligne(s) budgétaires insérées`);
}

// ── 4. TENDANCES 2020-2026 ────────────────────────────────────────────────────
async function genTendances() {
  log("4/5 — Analyse des tendances 2020-2026");

  const pvs = db.prepare("SELECT date, objet, votes_pour, votes_contre, votes_abstention, anomalies FROM pvs ORDER BY date").all();
  const failles = db.prepare("SELECT titre, gravite, date, type FROM failles ORDER BY date").all();

  const prompt = `Tu es expert en droit des collectivités territoriales. Analyse l'historique du conseil municipal de ${communeLabel()} (2020-2026) pour l'opposition municipale.

${pvs.length} SÉANCES :
${pvs.map(p => {
  let anom = []; try { anom = JSON.parse(p.anomalies||"[]"); } catch{}
  return `${p.date} — ${p.objet} | ${p.votes_pour}p/${p.votes_contre}c/${p.votes_abstention}abs${anom.length?` | ⚠ ${anom.length} anomalie(s)`:""}`;
}).join("\n")}

${failles.length} FAILLES DÉTECTÉES :
${failles.map(f => `${f.date} | ${f.gravite} | ${f.titre}`).join("\n")}

Identifie les patterns significatifs pour l'opposition. Retourne un JSON valide uniquement :
{
  "patterns": [
    { "type": "Violation récurrente|Vote serré|Thème sensible|Anomalie systématique",
      "titre": "titre court",
      "description": "explication avec dates et données",
      "occurrences": 3,
      "gravite": "Haute|Moyenne|Basse",
      "action": "recommandation pour l'opposition" }
  ],
  "tendances": { "commentaire": "évolution de la gouvernance sur la période" },
  "alerte_principale": "point le plus préoccupant en une phrase"
}`;

  const raw = await ai(prompt);
  const result = JSON.parse(raw);

  console.log("\n  TENDANCES :");
  console.log(`  ${result.alerte_principale}`);
  result.patterns.forEach(p => console.log(`  [${p.gravite}] ${p.titre} (×${p.occurrences})`));
  ok(`${result.patterns.length} patterns détectés`);
}

// ── 5. RAPPORT CITOYEN ────────────────────────────────────────────────────────
async function genRapport() {
  log("5/5 — Rapport citoyen");

  const pvs    = db.prepare("SELECT * FROM pvs ORDER BY date").all();
  const failles = db.prepare("SELECT * FROM failles ORDER BY gravite DESC, date DESC").all();
  const hautes  = failles.filter(f => f.gravite === "Haute");

  const prompt = `Rédige un rapport d'opposition municipal pour les habitants de ${communeLabel()}.
Ton : accessible, factuel, citoyen. Pas de jargon inutile.

DONNÉES :
- ${pvs.length} séances analysées (2020-2026)
- ${failles.length} irrégularités dont ${hautes.length} graves

IRRÉGULARITÉS GRAVES :
${hautes.map(f => `• ${f.titre} (${f.date}) : ${f.description}`).join("\n")}

Retourne ce JSON valide uniquement :
{
  "titre": "titre accrocheur",
  "resume_executif": "2-3 phrases pour un citoyen",
  "bilan_mandat": {
    "seances_analysees": ${pvs.length},
    "irregularites_graves": ${hautes.length},
    "taux_conformite": "xx%"
  },
  "faits_marquants": [
    { "date": "...", "fait": "description accessible", "impact": "impact pour les habitants" }
  ],
  "ce_qui_reste_a_faire": ["priorité 1", "priorité 2", "priorité 3"],
  "appel_citoyen": "paragraphe d'appel (2-3 phrases)"
}`;

  const raw = await ai(prompt);
  const rapport = JSON.parse(raw);

  console.log(`\n  TITRE : ${rapport.titre}`);
  console.log(`  RÉSUMÉ : ${rapport.resume_executif}`);
  console.log(`  Conformité estimée : ${rapport.bilan_mandat.taux_conformite}`);
  rapport.faits_marquants?.forEach(f => console.log(`  • ${f.date} — ${f.fait}`));
  ok("Rapport citoyen généré");
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${"═".repeat(60)}`);
  console.log("  GÉNÉRATION COMPLÈTE — " + communeLabel());
  console.log(`${"═".repeat(60)}`);

  await genFailles();
  await genEngagements();
  await genBudget();
  await genTendances();
  await genRapport();

  console.log(`\n${"═".repeat(60)}`);
  console.log("  TERMINÉ");
  console.log(`${"═".repeat(60)}\n`);
  process.exit(0);
}

main().catch(e => { console.error("\nERREUR :", e.message); process.exit(1); });
