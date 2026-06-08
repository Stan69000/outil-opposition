const axios = require("axios");

// Observatoire des Finances et de la Gestion publique Locales — données officielles publiques.
const BASE = "https://data.ofgl.fr/api/explore/v2.1/catalog/datasets/ofgl-base-communes-consolidee";

// Échappe une valeur pour le langage de filtre ODSQL (anti-injection de filtre).
const q = (v) => `"${String(v).replace(/"/g, "")}"`;

// L'endpoint /records plafonne à 100 lignes : on utilise /exports/json (sans plafond),
// qui renvoie directement un tableau.
async function fetchRows(where, select = "insee,com_name,exer,agregat,montant,euros_par_habitant,ptot") {
  const { data } = await axios.get(`${BASE}/exports/json`, {
    params: { where, select, order_by: "exer desc" },
    timeout: 30000,
  });
  return Array.isArray(data) ? data : (data.results || []);
}

module.exports = { fetchRows, q, OFGL_BASE: BASE };
