const express = require("express");
const Anthropic = require("@anthropic-ai/sdk");
const { db } = require("../db");
const { trackUsage } = require("../services/ai-tracker");

const router = express.Router();
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// GET /api/analyses/patterns — détection de patterns temporels sur l'historique
router.get("/patterns", async (req, res) => {
  try {
    const pvs = db.prepare("SELECT * FROM pvs ORDER BY date").all().map(p => ({
      date: p.date,
      objet: p.objet,
      anomalies: JSON.parse(p.anomalies || "[]"),
      statut: p.statut,
      votes_pour: p.votes_pour,
      votes_contre: p.votes_contre,
      votes_abstention: p.votes_abstention,
      pdfs: JSON.parse(p.pdfs || "[]").map(x => x.nom),
    }));

    const failles = db.prepare("SELECT * FROM failles ORDER BY date").all();

    if (pvs.length < 3) {
      return res.json({ patterns: [], summary: "Pas assez de données (minimum 3 séances)." });
    }

    const prompt = `Tu es expert en droit des collectivités territoriales. Analyse l'historique 2020-2026 du conseil municipal de Fleurieux-sur-l'Arbresle (69210, ~2000 hab.) pour l'opposition municipale.

PROCÈS-VERBAUX (${pvs.length} séances) :
${JSON.stringify(pvs.slice(-40))}

FAILLES DÉTECTÉES (${failles.length}) :
${JSON.stringify(failles)}

Identifie les PATTERNS SIGNIFICATIFS pour l'opposition. Retourne un JSON valide uniquement :
{
  "patterns": [
    {
      "type": "Violation récurrente|Vote serré|Thème sensible|Anomalie systématique",
      "titre": "titre court du pattern",
      "description": "explication précise avec dates et données",
      "occurrences": 3,
      "gravite": "Haute|Moyenne|Basse",
      "cgct": "article CGCT concerné ou null",
      "action": "recommandation concrète pour l'opposition"
    }
  ],
  "tendances": {
    "conformite_2020": 85,
    "conformite_2024": 72,
    "commentaire": "phrase sur l'évolution"
  },
  "alerte_principale": "le point le plus préoccupant en une phrase"
}`;

    const msg = await client.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });

    trackUsage("analyses/patterns", "claude-opus-4-5", msg.usage);
    const raw = msg.content[0].text.trim().replace(/```json|```/g, "").trim();
    const result = JSON.parse(raw);
    res.json(result);
  } catch (err) {
    console.error("Patterns error:", err.message);
    res.status(502).json({ error: err.message });
  }
});

// GET /api/analyses/budget — synthèse budgétaire inter-années depuis les délibérations
router.get("/budget", async (req, res) => {
  try {
    // Récupérer délibérations liées au budget (nom PDF ou objet)
    const budgetPvs = db.prepare(`
      SELECT id, date, objet, pdf_text, pdfs FROM pvs
      WHERE (lower(objet) LIKE '%budget%' OR lower(objet) LIKE '%fiscal%' OR lower(pdfs) LIKE '%budget%')
      AND pdf_text != ''
      ORDER BY date
    `).all();

    const stored = db.prepare("SELECT * FROM budgets ORDER BY annee, poste").all();

    if (stored.length > 0) {
      return res.json({ budgets: stored, source: "cache" });
    }

    if (budgetPvs.length === 0) {
      return res.json({ budgets: [], message: "Aucun PDF budget analysé. Lancez l'analyse des PDFs budgétaires d'abord." });
    }

    const prompt = `Extrais les données budgétaires de ces délibérations de conseil municipal.
${budgetPvs.map(p => `Date: ${p.date}\n${p.pdf_text?.slice(0,2000)}`).join("\n\n---\n\n")}

Retourne UNIQUEMENT ce JSON :
{
  "lignes": [
    { "annee": 2024, "poste": "Fonctionnement dépenses", "montant": 1250000, "nature": "fonctionnement" },
    { "annee": 2024, "poste": "Investissement", "montant": 380000, "nature": "investissement" },
    { "annee": 2024, "poste": "Taxe foncière (taux %)", "montant": 18.5, "nature": "fiscalite" }
  ]
}`;

    const msg = await client.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    trackUsage("analyses/budget", "claude-opus-4-5", msg.usage);
    const raw = msg.content[0].text.trim().replace(/```json|```/g, "").trim();
    const { lignes } = JSON.parse(raw);

    const insert = db.prepare("INSERT INTO budgets (pv_id, annee, poste, montant, nature) VALUES (?,?,?,?,?)");
    for (const l of lignes) {
      insert.run(null, l.annee, l.poste, l.montant, l.nature || "fonctionnement");
    }

    res.json({ budgets: lignes, source: "ai" });
  } catch (err) {
    console.error("Budget error:", err.message);
    res.status(502).json({ error: err.message });
  }
});

// GET /api/analyses/seance-prep?date=YYYY-MM-DD — fiche préparation séance
router.get("/seance-prep", async (req, res) => {
  try {
    const { date } = req.query;
    const pvs = db.prepare("SELECT * FROM pvs ORDER BY date DESC LIMIT 5").all();
    const failles = db.prepare("SELECT * FROM failles WHERE statut != 'Résolu'").all();
    const lois = db.prepare("SELECT * FROM lois").all();

    const prompt = `Tu es conseiller juridique de l'opposition municipale de Fleurieux-sur-l'Arbresle (69210).
Prépare la fiche de préparation pour la prochaine séance du conseil municipal${date ? ` du ${date}` : ""}.

DERNIÈRES SÉANCES :
${pvs.map(p => `${p.date} — ${p.objet}\nAnomalies: ${p.anomalies}`).join("\n\n")}

FAILLES OUVERTES :
${failles.map(f => `${f.titre} (${f.gravite}) — ${f.cgct}`).join("\n")}

TEXTES SURVEILLÉS :
${lois.map(l => l.titre).join(", ")}

Retourne ce JSON valide uniquement :
{
  "questions": [
    { "question": "texte de la question", "base_legale": "CGCT L2121-10", "objectif": "obtenir quoi" }
  ],
  "documents_a_demander": ["liste des documents à réclamer formellement"],
  "delais_a_verifier": [
    { "element": "description", "echeance": "date ou délai", "urgence": "haute|normale" }
  ],
  "points_vigilance": ["points à surveiller pendant la séance"],
  "discours_ouverture": "suggestion de déclaration liminaire de l'opposition (3-4 phrases)"
}`;

    const msg = await client.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });

    trackUsage("analyses/seance-prep", "claude-opus-4-5", msg.usage);
    const raw = msg.content[0].text.trim().replace(/```json|```/g, "").trim();
    res.json(JSON.parse(raw));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// GET /api/analyses/rapport — données pour export rapport citoyen
router.get("/rapport", async (req, res) => {
  try {
    const pvs = db.prepare("SELECT * FROM pvs ORDER BY date").all();
    const failles = db.prepare("SELECT * FROM failles ORDER BY gravite DESC, date DESC").all();
    const lois = db.prepare("SELECT * FROM lois").all();

    const hautes = failles.filter(f => f.gravite === "Haute");
    const anomaliesPvs = pvs.filter(p => {
      try { return JSON.parse(p.anomalies || "[]").length > 0; } catch { return false; }
    });

    const prompt = `Rédige un rapport d'opposition municipal pour les habitants de Fleurieux-sur-l'Arbresle.
Ton : accessible, factuel, citoyen. Pas de jargon juridique inutile.

DONNÉES :
- ${pvs.length} séances analysées (2020-2026)
- ${failles.length} irrégularités dont ${hautes.length} graves
- ${anomaliesPvs.length} séances avec anomalies

IRRÉGULARITÉS GRAVES :
${hautes.map(f => `• ${f.titre} (${f.date}) : ${f.description}`).join("\n")}

TOUTES LES FAILLES :
${failles.map(f => `${f.gravite} | ${f.titre} | ${f.statut}`).join("\n")}

Retourne ce JSON valide uniquement :
{
  "titre": "titre accrocheur pour le rapport",
  "periode": "2020-2026",
  "resume_executif": "2-3 phrases résumant la situation pour un citoyen",
  "bilan_mandat": {
    "seances_analysees": ${pvs.length},
    "irregularites_graves": ${hautes.length},
    "taux_conformite": "pourcentage estimé",
    "points_positifs": ["1-2 choses qui se sont bien passées si applicable"]
  },
  "faits_marquants": [
    { "date": "...", "fait": "description accessible", "impact": "impact pour les habitants" }
  ],
  "ce_que_nous_avons_obtenu": ["actions concrètes de l'opposition qui ont porté leurs fruits"],
  "ce_qui_reste_a_faire": ["3-4 priorités pour la suite"],
  "appel_citoyen": "paragraphe d'appel à la mobilisation citoyenne (2-3 phrases)"
}`;

    const msg = await client.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });

    trackUsage("analyses/rapport", "claude-opus-4-5", msg.usage);
    const raw = msg.content[0].text.trim().replace(/```json|```/g, "").trim();
    const rapport = JSON.parse(raw);
    rapport._meta = {
      pvs: pvs.length, failles: failles.length,
      lois: lois.length,
      generated_at: new Date().toISOString(),
    };
    res.json(rapport);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// GET /api/analyses/sync-log — historique des synchros automatiques
router.get("/sync-log", (req, res) => {
  const logs = db.prepare("SELECT * FROM sync_log ORDER BY ran_at DESC LIMIT 20").all();
  // Normaliser les noms de colonnes pour le frontend
  res.json(logs.map(l => ({
    id:        l.id,
    ran_at:    l.ran_at,
    imported:  l.seances_imported,
    found:     l.seances_found,
    triggered: l.triggered_by,
    status:    l.error ? "error" : "ok",
    error_msg: l.error || null,
  })));
});

module.exports = router;
