const express = require("express");
const { getConfig } = require("../db");
const { getAIClient, getAIModel, communeLabel } = require("../services/ai-client");
const { trackUsage } = require("../services/ai-tracker");
const { fetchRows, q } = require("../services/ofgl");

const router = express.Router();

// Le dataset OFGL est en FORMAT LONG : une ligne par (commune, exercice, agrégat).
// La valeur par habitant est dans le champ `euros_par_habitant`.
// Correspondance clé front → libellé d'agrégat OFGL exact.
const AGREGATS = {
  depenses_fonctionnement_hbt: "Dépenses de fonctionnement",
  recettes_fonctionnement_hbt: "Recettes de fonctionnement",
  depenses_investissement_hbt: "Dépenses d'investissement",
  encours_dette_hbt:           "Encours de dette",
};
const AGREGAT_LIST = Object.values(AGREGATS);

// À partir des lignes (triées exer desc) d'UNE commune, prend la dernière année
// disponible et construit { annee, vals: { clé_front: €/hab } }.
function latestByAgregat(rows) {
  if (!rows.length) return { annee: null, vals: {} };
  const annee = rows[0].exer;
  const ofYear = rows.filter((r) => r.exer === annee);
  const vals = {};
  for (const [key, ag] of Object.entries(AGREGATS)) {
    const row = ofYear.find((r) => r.agregat === ag);
    vals[key] = row && row.euros_par_habitant != null ? Math.round(row.euros_par_habitant) : null;
  }
  return { annee, vals };
}

// Moyenne par agrégat sur les communes similaires (dernière année de chacune).
function moyennesSimilaires(rows, inseeExclu) {
  const byCom = {};
  for (const r of rows) {
    if (r.insee === inseeExclu) continue;
    const c = byCom[r.insee] || (byCom[r.insee] = { annee: r.exer, vals: {} });
    if (r.exer === c.annee && r.euros_par_habitant != null && c.vals[r.agregat] === undefined) {
      c.vals[r.agregat] = r.euros_par_habitant;
    }
  }
  const communes = Object.values(byCom);
  const moyennes = {};
  for (const [key, ag] of Object.entries(AGREGATS)) {
    const vals = communes.map((c) => c.vals[ag]).filter((v) => v != null && !isNaN(v));
    moyennes[key] = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  }
  return { moyennes, count: communes.length };
}

function readParams() {
  const insee  = getConfig("commune_insee");
  const dep    = getConfig("commune_departement");
  const popMin = parseInt(getConfig("commune_pop_min"), 10);
  const popMax = parseInt(getConfig("commune_pop_max"), 10);
  return {
    insee,
    dep,
    popMin: Number.isFinite(popMin) ? popMin : 0,
    popMax: Number.isFinite(popMax) ? popMax : 100000,
    valid: /^\d{4,5}$/.test(insee) && /^\d{1,3}[AB]?$/i.test(dep),
  };
}

// GET /api/benchmark/compare
router.get("/compare", async (req, res) => {
  const { insee, dep, popMin, popMax, valid } = readParams();
  if (!valid) {
    return res.json({ error: `Paramètres commune invalides (INSEE ${insee}, dép. ${dep})`, fleurieux_last: null, moyennes: {}, similaires_count: 0 });
  }

  try {
    const agFilter = `agregat in (${AGREGAT_LIST.map(q).join(",")})`;
    const flRows = await fetchRows(`insee=${q(insee)} and ${agFilter}`);
    if (!flRows.length) {
      return res.json({ error: `Aucune donnée OFGL pour la commune (INSEE ${insee}).`, fleurieux_last: null, moyennes: {}, similaires_count: 0 });
    }
    const fl = latestByAgregat(flRows);

    const simRows = await fetchRows(
      `dep_code=${q(dep)} and ptot>=${popMin} and ptot<=${popMax} and ${agFilter}`
    );
    const { moyennes, count } = moyennesSimilaires(simRows, insee);

    res.json({
      annee: fl.annee,
      commune: flRows[0].com_name,
      fleurieux_last: fl.vals,
      moyennes,
      similaires_count: count,
    });
  } catch (err) {
    console.error("Benchmark compare error:", err.message);
    res.status(502).json({ error: "Erreur lors de l'appel à l'API OFGL" });
  }
});

// GET /api/benchmark/analyse — IA commente le benchmark
router.get("/analyse", async (req, res) => {
  const { insee, dep, popMin, popMax, valid } = readParams();
  if (!valid) return res.status(400).json({ error: `Paramètres commune invalides (INSEE ${insee})` });

  try {
    const agFilter = `agregat in (${AGREGAT_LIST.map(q).join(",")})`;
    const flRows = await fetchRows(`insee=${q(insee)} and ${agFilter}`);
    if (!flRows.length) return res.status(404).json({ error: `Aucune donnée OFGL pour la commune (INSEE ${insee})` });

    const fl = latestByAgregat(flRows);
    const simRows = await fetchRows(
      `dep_code=${q(dep)} and ptot>=${popMin} and ptot<=${popMax} and ${agFilter}`
    );
    const { moyennes, count } = moyennesSimilaires(simRows, insee);

    const client = getAIClient();
    const msg = await client.messages.create({
      model: getAIModel(),
      max_tokens: 1200,
      messages: [{
        role: "user",
        content: `Tu es analyste financier spécialisé en finances communales françaises. Analyse les finances de ${communeLabel()} (INSEE ${insee}, exercice ${fl.annee}) par rapport à ${count} communes comparables du département ${dep} (population entre ${popMin} et ${popMax} hab.).

Toutes les valeurs sont en euros par habitant.

Commune (${fl.annee}) :
${JSON.stringify(fl.vals, null, 2)}

Moyenne des communes comparables :
${JSON.stringify(moyennes, null, 2)}

Points à analyser :
1. Dépenses de fonctionnement/habitant vs. moyenne
2. Effort d'investissement vs. moyenne
3. Niveau d'endettement (encours de dette/habitant)
4. Points positifs et points d'alerte
5. Questions que l'opposition devrait poser en séance

Réponse en français, structurée, accessible aux citoyens non experts. 3-4 paragraphes maximum.`,
      }],
    });

    trackUsage("benchmark/analyse", msg.model, msg.usage);
    res.json({ analyse: msg.content[0].text, annee: fl.annee, fleurieux_last: fl.vals, moyennes });
  } catch (err) {
    console.error("Benchmark analyse error:", err.message);
    res.status(502).json({ error: "Erreur lors de l'analyse du benchmark" });
  }
});

module.exports = router;
