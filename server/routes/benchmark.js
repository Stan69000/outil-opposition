const express = require("express");
const axios = require("axios");
const { getConfig } = require("../db");
const { getAIClient, getAIModel, communeLabel } = require("../services/ai-client");
const { trackUsage } = require("../services/ai-tracker");

const router = express.Router();

const OFGL_BASE = "https://data.ofgl.fr/api/explore/v2.1/catalog/datasets";

// Fetch données OFGL pour une commune
async function fetchCommune(inseecom) {
  const { data } = await axios.get(`${OFGL_BASE}/ofgl-base-communes-consolidee/records`, {
    params: { where: `inseecom="${inseecom}"`, limit: 5, order_by: "exer desc" },
    timeout: 15000,
  });
  return data.results || [];
}

// Fetch communes similaires selon config
async function fetchSimilaires() {
  const dep    = getConfig("commune_departement");
  const popMin = getConfig("commune_pop_min");
  const popMax = getConfig("commune_pop_max");
  const { data } = await axios.get(`${OFGL_BASE}/ofgl-base-communes-consolidee/records`, {
    params: {
      where: `dep="${dep}" and population>=${popMin} and population<=${popMax}`,
      limit: 30,
      order_by: "exer desc, population asc",
    },
    timeout: 15000,
  });
  return data.results || [];
}

// GET /api/benchmark/compare
router.get("/compare", async (req, res) => {
  const insee = getConfig("commune_insee");
  try {
    const [fleurieux, similaires] = await Promise.all([fetchCommune(insee), fetchSimilaires()]);

    if (!fleurieux.length) {
      return res.json({ error: `Aucune donnée OFGL pour la commune (INSEE ${insee}). Les données peuvent ne pas encore être disponibles.`, fleurieux: [], similaires: [] });
    }

    // Regrouper similaires par commune, prendre l'année la plus récente
    const byCommune = {};
    for (const row of similaires) {
      const key = row.inseecom;
      if (!byCommune[key] || row.exer > byCommune[key].exer) {
        byCommune[key] = row;
      }
    }
    const similairesLatest = Object.values(byCommune).filter(r => r.inseecom !== insee);

    // Moyennes similaires
    const calcMoy = (rows, field) => {
      const vals = rows.map(r => r[field]).filter(v => v != null && !isNaN(v));
      return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    };

    const fleurieuxLast = fleurieux[0];
    const moyennes = {
      depenses_fonctionnement_hbt: calcMoy(similairesLatest, "depenses_fonctionnement_hbt"),
      recettes_fonctionnement_hbt: calcMoy(similairesLatest, "recettes_fonctionnement_hbt"),
      depenses_investissement_hbt: calcMoy(similairesLatest, "depenses_investissement_hbt"),
      encours_dette_hbt: calcMoy(similairesLatest, "encours_dette_hbt"),
    };

    res.json({
      fleurieux: fleurieux.slice(0, 3),
      fleurieux_last: fleurieuxLast,
      similaires_count: similairesLatest.length,
      moyennes,
      annee: fleurieuxLast.exer,
    });
  } catch (err) {
    console.error("Benchmark error:", err.message);
    res.status(502).json({ error: err.message });
  }
});

// GET /api/benchmark/analyse — IA commente le benchmark
router.get("/analyse", async (req, res) => {
  const insee = getConfig("commune_insee");
  try {
    const [fleurieux, similaires] = await Promise.all([fetchCommune(insee), fetchSimilaires()]);
    if (!fleurieux.length) return res.status(404).json({ error: "Pas de données" });

    const client = getAIClient();
    const msg = await client.messages.create({
      model: getAIModel(),
      max_tokens: 1200,
      messages: [{
        role: "user",
        content: `Tu es analyste financier spécialisé en finances communales françaises. Analyse les données budgétaires de ${communeLabel()} (INSEE ${insee}) en comparaison avec les communes similaires du département (population similaire).

Données commune :
${JSON.stringify(fleurieux[0], null, 2)}

Communes comparables (${similaires.length} communes, population similaire) — moyenne estimée.

Points à analyser :
1. Niveau des dépenses de fonctionnement/habitant vs. moyenne
2. Effort d'investissement vs. moyennes
3. Niveau d'endettement
4. Points positifs et points d'alerte
5. Questions que l'opposition devrait poser en séance

Réponse en français, structurée, accessible aux citoyens non experts. 3-4 paragraphes maximum.`,
      }],
    });

    trackUsage("benchmark/analyse", msg.model, msg.usage);
    res.json({ analyse: msg.content[0].text, fleurieux: fleurieux[0], annee: fleurieux[0].exer });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
