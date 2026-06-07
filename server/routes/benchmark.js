const express = require("express");
const axios = require("axios");
const Anthropic = require("@anthropic-ai/sdk");
const { db } = require("../db");

const router = express.Router();
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const OFGL_BASE = "https://data.ofgl.fr/api/explore/v2.1/catalog/datasets";
const INSEE_FLEURIEUX = "69082";

// Fetch données OFGL pour une commune
async function fetchCommune(inseecom) {
  const { data } = await axios.get(`${OFGL_BASE}/ofgl-base-communes-consolidee/records`, {
    params: {
      where: `inseecom="${inseecom}"`,
      limit: 5,
      order_by: "exer desc",
    },
    timeout: 15000,
  });
  return data.results || [];
}

// Fetch communes similaires (Rhône, 1500-3000 hab)
async function fetchSimilaires() {
  const { data } = await axios.get(`${OFGL_BASE}/ofgl-base-communes-consolidee/records`, {
    params: {
      where: `dep="69" and population>=1500 and population<=3500`,
      limit: 30,
      order_by: "exer desc, population asc",
    },
    timeout: 15000,
  });
  return data.results || [];
}

// GET /api/benchmark/compare
router.get("/compare", async (req, res) => {
  try {
    const [fleurieux, similaires] = await Promise.all([fetchCommune(INSEE_FLEURIEUX), fetchSimilaires()]);

    if (!fleurieux.length) {
      return res.json({ error: "Aucune donnée OFGL pour Fleurieux. Les données 2024 peuvent ne pas encore être disponibles.", fleurieux: [], similaires: [] });
    }

    // Regrouper similaires par commune, prendre l'année la plus récente
    const byCommune = {};
    for (const row of similaires) {
      const key = row.inseecom;
      if (!byCommune[key] || row.exer > byCommune[key].exer) {
        byCommune[key] = row;
      }
    }
    const similairesLatest = Object.values(byCommune).filter(r => r.inseecom !== INSEE_FLEURIEUX);

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
  try {
    const [fleurieux, similaires] = await Promise.all([fetchCommune(INSEE_FLEURIEUX), fetchSimilaires()]);
    if (!fleurieux.length) return res.status(404).json({ error: "Pas de données" });

    const msg = await client.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 1200,
      messages: [{
        role: "user",
        content: `Tu es analyste financier spécialisé en finances communales françaises. Analyse les données budgétaires de Fleurieux-sur-l'Arbresle (69082) en comparaison avec les communes similaires du Rhône (1500-3500 habitants).

Données Fleurieux :
${JSON.stringify(fleurieux[0], null, 2)}

Communes comparables (${similaires.length} communes, Rhône, population similaire) — moyenne estimée.

Points à analyser :
1. Niveau des dépenses de fonctionnement/habitant vs. moyenne
2. Effort d'investissement vs. moyennes
3. Niveau d'endettement
4. Points positifs et points d'alerte
5. Questions que l'opposition devrait poser en séance

Réponse en français, structurée, accessible aux citoyens non experts. 3-4 paragraphes maximum.`,
      }],
    });

    res.json({ analyse: msg.content[0].text, fleurieux: fleurieux[0], annee: fleurieux[0].exer });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
