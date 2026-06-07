const express = require("express");
const axios = require("axios");
const { getConfig } = require("../db");

const router = express.Router();

const OAUTH_URL = "https://oauth.piste.gouv.fr/api/oauth/token";
const API_BASE  = "https://api.piste.gouv.fr/dila/legifrance/lf-engine-app";

// Cache token en mémoire (évite un appel OAuth à chaque requête)
// Invalidé dès que les credentials changent
let tokenCache = { token: null, expiresAt: 0, clientId: null };

async function getToken() {
  const clientId     = getConfig("piste_client_id")     || process.env.PISTE_OAUTH_CLIENT_ID     || "";
  const clientSecret = getConfig("piste_client_secret") || process.env.PISTE_OAUTH_CLIENT_SECRET || "";

  if (!clientId || !clientSecret) throw new Error("Credentials PISTE non configurés");

  if (tokenCache.token && tokenCache.clientId === clientId && Date.now() < tokenCache.expiresAt - 30_000) {
    return tokenCache.token;
  }

  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "openid",
  });

  const res = await axios.post(OAUTH_URL, params.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  tokenCache = {
    token: res.data.access_token,
    expiresAt: Date.now() + res.data.expires_in * 1000,
    clientId,
  };
  return tokenCache.token;
}

async function pisteGet(path, params = {}) {
  const token = await getToken();
  const res = await axios.get(`${API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      
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
    if (status === 500 || status === 403) {
      return res.status(403).json({
        error: "Produit Légifrance non souscrit sur PISTE",
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
        typePagination: "DEFAULT",
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
      message: "OAuth PISTE OK — API production active",
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
