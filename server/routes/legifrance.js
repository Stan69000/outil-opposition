const express = require("express");
const axios = require("axios");

const router = express.Router();

const OAUTH_URL = "https://sandbox-oauth.piste.gouv.fr/api/oauth/token";
const API_BASE = "https://sandbox-api.piste.gouv.fr/dila/legifrance/lf-engine-app";

// Cache token en mémoire (évite un appel OAuth à chaque requête)
let tokenCache = { token: null, expiresAt: 0 };

async function getToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt - 30_000) {
    return tokenCache.token;
  }

  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: process.env.PISTE_OAUTH_CLIENT_ID,
    client_secret: process.env.PISTE_OAUTH_CLIENT_SECRET,
    scope: "openid",
  });

  const res = await axios.post(OAUTH_URL, params.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  tokenCache = {
    token: res.data.access_token,
    expiresAt: Date.now() + res.data.expires_in * 1000,
  };
  return tokenCache.token;
}

async function pisteGet(path, params = {}) {
  const token = await getToken();
  const res = await axios.get(`${API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Api-Key": process.env.PISTE_API_KEY,
    },
    params,
  });
  return res.data;
}

async function pistePost(path, body) {
  const token = await getToken();
  const res = await axios.post(`${API_BASE}${path}`, body, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Api-Key": process.env.PISTE_API_KEY,
      "Content-Type": "application/json",
    },
  });
  return res.data;
}

// ── GET /api/legifrance/search?q=... ──────────────────────────────────────────
router.get("/search", async (req, res) => {
  const { q, fond = "CODE_ETAT", page = 1, pageSize = 10 } = req.query;
  if (!q) return res.status(400).json({ error: "paramètre q requis" });

  try {
    const data = await pistePost("/search", {
      recherche: {
        champs: [{
          typeChamp: "ALL",
          criteres: [{ typeRecherche: "TOUS_LES_MOTS_DANS_UN_CHAMP", valeur: q }],
          operateur: "ET",
        }],
        filtres: [],
        pageNumber: Number(page),
        pageSize: Number(pageSize),
        operateur: "ET",
        sort: "PERTINENCE",
        typePagination: "DEFAUT",
      },
      fond,
    });

    const results = (data.results || []).map((r) => ({
      id: r.id || r.cid,
      titre: r.title || r.titre,
      code: r.nature || fond,
      article: r.num || r.numero,
      date_vigueur: r.dateDebut?.slice(0, 10) || null,
      resume: r.titreTexte || r.resume || r.title || "",
      pertinence: "Moyenne",
      action_opposition: null,
      url: r.cid
        ? `https://www.legifrance.gouv.fr/codes/article_lc/${r.cid}`
        : "https://www.legifrance.gouv.fr",
    }));

    res.json({ results, total: data.totalResultNumber || results.length });
  } catch (err) {
    const status = err.response?.status;
    if (status === 403) {
      return res.status(403).json({
        error: "Produit Légifrance non souscrit",
        detail: "Allez sur beta.piste.gouv.fr → votre application → souscrire au produit 'DILA — Légifrance'.",
        subscriptionRequired: true,
      });
    }
    console.error("PISTE search error:", err.response?.data || err.message);
    res.status(502).json({ error: "Erreur API PISTE", detail: err.response?.data || err.message });
  }
});

// ── GET /api/legifrance/article/:cid ─────────────────────────────────────────
router.get("/article/:cid", async (req, res) => {
  try {
    const data = await pisteGet("/consult/legi/article", { id: req.params.cid });
    res.json(data);
  } catch (err) {
    console.error("PISTE article error:", err.response?.data || err.message);
    res.status(502).json({ error: "Erreur API PISTE", detail: err.response?.data || err.message });
  }
});

// ── GET /api/legifrance/code?code=CGCT&article=L2121-10 ──────────────────────
router.get("/code", async (req, res) => {
  const { code = "CGCT", article } = req.query;
  try {
    const data = await pistePost("/search", {
      recherche: {
        champs: [{
          typeChamp: "NUM_ARTICLE",
          criteres: [{ typeRecherche: "EXACTE", valeur: article || "" }],
          operateur: "ET",
        }],
        filtres: [{ facette: "NOM_CODE", valeurs: [codeLabel(code)] }],
        pageNumber: 1,
        pageSize: 5,
        operateur: "ET",
        sort: "PERTINENCE",
        typePagination: "DEFAUT",
      },
      fond: "CODE_ETAT",
    });
    res.json(data);
  } catch (err) {
    console.error("PISTE code error:", err.response?.data || err.message);
    res.status(502).json({ error: "Erreur API PISTE", detail: err.response?.data || err.message });
  }
});

// ── GET /api/legifrance/ping ──────────────────────────────────────────────────
// Vérifie uniquement l'OAuth (le /search sandbox retourne 500 côté PISTE — bug infra DILA)
router.get("/ping", async (req, res) => {
  try {
    await getToken();
    res.json({
      ok: true,
      subscribed: true,
      searchBroken: true,
      message: "OAuth PISTE OK — /search sandbox instable (bug DILA), fallback IA actif",
    });
  } catch (err) {
    res.status(502).json({ ok: false, subscribed: false, error: "OAuth échoué : " + err.message });
  }
});

function codeLabel(code) {
  const MAP = {
    CGCT: "Code général des collectivités territoriales",
    CODE_URBANISME: "Code de l'urbanisme",
    CODE_ENVIRONNEMENT: "Code de l'environnement",
    CJAА: "Code de justice administrative",
  };
  return MAP[code] || code;
}

module.exports = router;
