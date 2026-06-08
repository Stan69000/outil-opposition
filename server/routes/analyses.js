const express = require("express");
const { db, getConfig } = require("../db");
const { getAIClient, getAIModel, communeLabel } = require("../services/ai-client");
const { trackUsage } = require("../services/ai-tracker");
const { fetchRows, q } = require("../services/ofgl");
const { parseAttendance, parseFrenchDate, delaiConvocation } = require("../services/cr-parser");

const router = express.Router();

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

    const client = getAIClient();
    const prompt = `Tu es expert en droit des collectivités territoriales. Analyse l'historique du conseil municipal de ${communeLabel()} pour l'opposition municipale.

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
      model: getAIModel(),
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });

    trackUsage("analyses/patterns", msg.model, msg.usage);
    const raw = msg.content[0].text.trim().replace(/```json|```/g, "").trim();
    const result = JSON.parse(raw);
    res.json(result);
  } catch (err) {
    console.error("Patterns error:", err.message);
    res.status(502).json({ error: err.message });
  }
});

// GET /api/analyses/budget — historique budgétaire + indicateurs + comparaison strate (OFGL officiel)
const A = {
  fonctionnement: "Dépenses de fonctionnement",
  investissement: "Dépenses d'investissement",
  recettes:       "Recettes de fonctionnement",
  dette:          "Encours de dette",
  epargne:        "Epargne brute",
  personnel:      "Frais de personnel",
  annuite:        "Annuité de la dette",
  equipement:     "Dépenses d'équipement",
  impots:         "Impôts locaux",
};

// Agrégats comparés à la strate (en euros/habitant).
const CMP = {
  depenses_fonctionnement_hbt: A.fonctionnement,
  recettes_fonctionnement_hbt: A.recettes,
  depenses_investissement_hbt: A.investissement,
  encours_dette_hbt:           A.dette,
};

const pct = (num, den) => (den ? +((num / den) * 100).toFixed(1) : null);

router.get("/budget", async (req, res) => {
  const insee  = getConfig("commune_insee");
  const dep    = getConfig("commune_departement");
  const popMin = parseInt(getConfig("commune_pop_min"), 10) || 0;
  const popMax = parseInt(getConfig("commune_pop_max"), 10) || 100000;
  if (!/^\d{4,5}$/.test(insee)) {
    return res.json({ budgets: [], annees: [], message: `Code INSEE invalide (${insee})` });
  }

  try {
    const rows = await fetchRows(`insee=${q(insee)} and agregat in (${Object.values(A).map(q).join(",")})`);
    if (!rows.length) {
      return res.json({ budgets: [], annees: [], message: `Aucune donnée OFGL pour la commune (INSEE ${insee}).` });
    }

    // Indexe { montant, hbt } par année / agrégat.
    const byYear = {};
    let commune = rows[0].com_name;
    for (const r of rows) {
      const y = Number(r.exer);
      const o = (byYear[y] = byYear[y] || { ptot: r.ptot });
      o[r.agregat] = { montant: r.montant, hbt: r.euros_par_habitant };
    }
    const years = Object.keys(byYear).map(Number).sort((a, b) => a - b);
    const m = (y, key) => Math.round(byYear[y]?.[A[key]]?.montant || 0);
    const h = (y, key) => Math.round(byYear[y]?.[A[key]]?.hbt || 0);

    const annees = years.map(y => ({
      annee: y,
      ptot: byYear[y].ptot || null,
      fonctionnement: m(y, "fonctionnement"),
      investissement: m(y, "investissement"),
      recettes:       m(y, "recettes"),
      dette:          m(y, "dette"),
      epargne_brute:  m(y, "epargne"),
      frais_personnel: m(y, "personnel"),
      equipement:     m(y, "equipement"),
      annuite_dette:  m(y, "annuite"),
      impots_locaux:  m(y, "impots"),
    }));

    // Lignes pour la vue détaillée (2 postes non chevauchants par an → pas de double comptage).
    const budgets = [];
    for (const a of annees) {
      if (a.fonctionnement) budgets.push({ annee: a.annee, poste: "Dépenses de fonctionnement", montant: a.fonctionnement, nature: "fonctionnement" });
      if (a.investissement) budgets.push({ annee: a.annee, poste: "Dépenses d'investissement", montant: a.investissement, nature: "investissement" });
    }

    // Indicateurs (dernière année).
    const ly = years[years.length - 1];
    const py = years[years.length - 2];
    const epB = m(ly, "epargne"), rec = m(ly, "recettes"), det = m(ly, "dette"), fonc = m(ly, "fonctionnement");
    const indicateurs = {
      annee: ly,
      epargne_brute: epB,
      taux_epargne: pct(epB, rec),
      encours_dette: det,
      taux_endettement: pct(det, rec),
      capacite_desendettement: epB > 0 ? +(det / epB).toFixed(1) : null,
      evolution_fonctionnement_pct: py && m(py, "fonctionnement") ? pct(fonc - m(py, "fonctionnement"), m(py, "fonctionnement")) : null,
      evolution_dette_pct: py && m(py, "dette") ? pct(det - m(py, "dette"), m(py, "dette")) : null,
      fonctionnement_par_hab: h(ly, "fonctionnement"),
      dette_par_hab: h(ly, "dette"),
      ptot: byYear[ly]?.ptot || null,
    };

    // Comparaison à la strate (communes similaires du département), dernière année, en €/hab.
    let comparaison = null;
    if (/^\d{1,3}[AB]?$/i.test(dep)) {
      const simRows = await fetchRows(
        `dep_code=${q(dep)} and ptot>=${popMin} and ptot<=${popMax} and agregat in (${Object.values(CMP).map(q).join(",")})`
      );
      const byCom = {};
      for (const r of simRows) {
        if (r.insee === insee) continue;
        const c = byCom[r.insee] || (byCom[r.insee] = { annee: r.exer, vals: {} });
        if (r.exer === c.annee && r.euros_par_habitant != null && c.vals[r.agregat] === undefined) {
          c.vals[r.agregat] = r.euros_par_habitant;
        }
      }
      const communes = Object.values(byCom);
      const moyennes = {}, fleurieux = {};
      for (const [key, ag] of Object.entries(CMP)) {
        const vals = communes.map(c => c.vals[ag]).filter(v => v != null && !isNaN(v));
        moyennes[key] = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
      }
      fleurieux.depenses_fonctionnement_hbt = h(ly, "fonctionnement");
      fleurieux.recettes_fonctionnement_hbt = h(ly, "recettes");
      fleurieux.depenses_investissement_hbt = h(ly, "investissement");
      fleurieux.encours_dette_hbt = h(ly, "dette");
      comparaison = { annee: ly, similaires_count: communes.length, fleurieux, moyennes };
    }

    res.json({
      source: "OFGL — comptes individuels des communes (officiel)",
      commune, insee,
      annees, budgets, indicateurs, comparaison,
    });
  } catch (err) {
    console.error("Budget error:", err.message);
    res.status(502).json({ error: "Erreur lors de l'appel à l'API OFGL" });
  }
});

// GET /api/analyses/seance-prep?date=YYYY-MM-DD — fiche préparation séance
router.get("/seance-prep", async (req, res) => {
  try {
    const { date } = req.query;
    const pvs = db.prepare("SELECT * FROM pvs ORDER BY date DESC LIMIT 5").all();
    const failles = db.prepare("SELECT * FROM failles WHERE statut != 'Résolu'").all();
    const lois = db.prepare("SELECT * FROM lois").all();

    const client = getAIClient();
    const prompt = `Tu es conseiller juridique de l'opposition municipale de ${communeLabel()}.
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
      model: getAIModel(),
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });

    trackUsage("analyses/seance-prep", msg.model, msg.usage);
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

    const client = getAIClient();
    const prompt = `Rédige un rapport d'opposition municipal pour les habitants de ${communeLabel()}.
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
      model: getAIModel(),
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });

    trackUsage("analyses/rapport", msg.model, msg.usage);
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

// GET /api/analyses/elus — statistiques RÉELLES agrégées du conseil (pas de données inventées).
// Les PV ne publient que les totaux de votes (pour/contre/abstention), jamais les votes
// nominatifs : impossible de produire des stats fiables PAR élu. On agrège au niveau du conseil.
router.get("/elus", (req, res) => {
  try {
    const pvs  = db.prepare("SELECT id, date, votes_pour, votes_contre, votes_abstention, anomalies, pdf_text FROM pvs ORDER BY date").all();
    const live = db.prepare("SELECT presents FROM seances_live WHERE statut = 'terminée'").all();
    const failles = db.prepare("SELECT COUNT(*) AS n FROM failles").get().n;

    const dates = pvs.map(p => p.date).filter(Boolean).sort();
    const total_votes = { pour: 0, contre: 0, abstention: 0 };
    let seances_votees = 0, unanimes = 0, contestees = 0, anomalies_total = 0;

    for (const p of pvs) {
      total_votes.pour       += p.votes_pour || 0;
      total_votes.contre     += p.votes_contre || 0;
      total_votes.abstention += p.votes_abstention || 0;
      const nbVotes = (p.votes_pour || 0) + (p.votes_contre || 0) + (p.votes_abstention || 0);
      if (nbVotes > 0) {
        seances_votees++;
        if ((p.votes_contre || 0) > 0 || (p.votes_abstention || 0) > 0) contestees++;
        else unanimes++;
      }
      try { anomalies_total += JSON.parse(p.anomalies || "[]").length; } catch (_) {}
    }

    const nbConseillers   = parseInt(getConfig("commune_nb_conseillers"), 10) || null;
    const presenceMoyenne = live.length
      ? Math.round(live.reduce((a, b) => a + (b.presents || 0), 0) / live.length)
      : null;
    const presencePct = (presenceMoyenne != null && nbConseillers)
      ? Math.round((presenceMoyenne / nbConseillers) * 100)
      : null;

    // ── PRÉSENCES depuis la liste nominative du CR (texte des PV) ──────────────────
    // Un texte de délibération par séance suffit (l'en-tête présence y est répété).
    const delibText = {};
    for (const d of db.prepare("SELECT seance_id, pdf_text FROM deliberations WHERE pdf_text != ''").all()) {
      if (!delibText[d.seance_id]) delibText[d.seance_id] = d.pdf_text;
    }

    const elusMap = {}; // "Prénom NOM" -> { present, absent }
    let crSeances = 0, sommeTaux = 0, derniereCR = null;
    for (const p of pvs) {
      const text = p.pdf_text || delibText[p.id];
      if (!text) continue;
      const att = parseAttendance(text);
      if (!att || (!att.presents_noms.length && att.presents == null)) continue;
      crSeances++;
      if (att.en_exercice && att.presents != null) sommeTaux += att.presents / att.en_exercice;
      derniereCR = { date: p.date, presents: att.presents, en_exercice: att.en_exercice, pouvoirs: att.pouvoirs, votants: att.votants };
      for (const n of att.presents_noms) (elusMap[n] = elusMap[n] || { present: 0, absent: 0 }).present++;
      for (const n of att.absents_noms)  (elusMap[n] = elusMap[n] || { present: 0, absent: 0 }).absent++;
    }

    const elus = Object.entries(elusMap).map(([nom, v]) => ({
      nom, present: v.present, absent: v.absent, total: v.present + v.absent,
      presence_pct: (v.present + v.absent) ? Math.round((v.present / (v.present + v.absent)) * 100) : null,
    })).sort((a, b) => b.total - a.total || (b.presence_pct || 0) - (a.presence_pct || 0));

    const presence_cr = crSeances ? {
      seances_analysees: crSeances,
      taux_present_moyen: Math.round((sommeTaux / crSeances) * 100),
      derniere: derniereCR,
    } : null;

    res.json({
      periode: { debut: dates[0] || null, fin: dates[dates.length - 1] || null },
      total_seances: pvs.length,
      seances_votees,
      total_votes,
      unanimes,
      contestees,
      unanimite_pct: seances_votees ? Math.round((unanimes / seances_votees) * 100) : null,
      anomalies_total,
      failles_total: failles,
      presence: { seances_live: live.length, moyenne: presenceMoyenne, pct: presencePct },
      presence_cr,
      elus,
      conseil: {
        maire: getConfig("commune_maire"),
        nb_conseillers: nbConseillers,
        quorum: parseInt(getConfig("commune_quorum"), 10) || null,
      },
      note: elus.length
        ? "Présences extraites de la liste nominative des comptes-rendus. Les votes restent agrégés (les PV ne publient pas les votes nominatifs)."
        : "Aucun texte de CR analysé : lancez l'extraction des délibérations pour obtenir les présences. Les votes des PV ne sont pas nominatifs.",
    });
  } catch (err) {
    console.error("Stats conseil error:", err.message);
    res.status(500).json({ error: "Erreur lors du calcul des statistiques" });
  }
});

// GET /api/analyses/convocations — contrôle automatique du délai légal de convocation.
// Lit la date de convocation dans le CR (texte des délibérations) et la compare à la date
// de séance. Seuil : 3 jours francs si commune < 3500 hab (L2121-11), sinon 5 (L2121-12).
router.get("/convocations", (req, res) => {
  try {
    const population = parseInt(getConfig("commune_population"), 10) || 0;
    const seuil = population >= 3500 ? 5 : 3;
    const article = population >= 3500 ? "CGCT L2121-12" : "CGCT L2121-11";

    const pvs = db.prepare("SELECT id, date, objet, pdf_text FROM pvs ORDER BY date DESC").all();
    const delibText = {};
    for (const d of db.prepare("SELECT seance_id, pdf_text FROM deliberations WHERE pdf_text != ''").all()) {
      if (!delibText[d.seance_id]) delibText[d.seance_id] = d.pdf_text;
    }

    const seances = [];
    for (const p of pvs) {
      const text = p.pdf_text || delibText[p.id];
      if (!text) continue;
      const att = parseAttendance(text);
      if (!att || !att.convocation) continue;
      const convocISO = parseFrenchDate(att.convocation);
      const check = delaiConvocation(convocISO, p.date, seuil);
      if (!check) continue;
      // Garde-fou : une date de convocation aberrante (coquille/OCR du PV) ne doit pas
      // produire une fausse "non-conformité". On l'isole comme "à vérifier".
      const douteux = check.jours_francs < 0 || check.jours_francs > 31;
      seances.push({
        pv_id: p.id,
        date_seance: p.date,
        objet: p.objet,
        convocation: convocISO,
        convocation_texte: att.convocation,
        jours_francs: check.jours_francs,
        conforme: douteux ? null : check.conforme,
        douteux,
      });
    }

    const evaluables   = seances.filter(s => !s.douteux);
    const non_conformes = evaluables.filter(s => !s.conforme);
    res.json({
      seuil, article,
      methode: "Jours francs : jour d'envoi de la convocation et jour de séance exclus.",
      total_controlees: evaluables.length,
      conformes: evaluables.length - non_conformes.length,
      non_conformes: non_conformes.length,
      douteux: seances.length - evaluables.length,
      seances,
    });
  } catch (err) {
    console.error("Convocations error:", err.message);
    res.status(500).json({ error: "Erreur lors du contrôle des délais de convocation" });
  }
});

module.exports = router;
