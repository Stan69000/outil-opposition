const express = require("express");
const { db } = require("../db");
const { getAIClient, getAIModel, communeLabel } = require("../services/ai-client");
const { trackUsage } = require("../services/ai-tracker");

const router = express.Router();

const CATEGORIES = ["Question écrite", "Demande CADA", "Recours gracieux", "Motion", "Amendement", "Courrier Préfet", "Autre"];

const MODELES_DEFAUT = [
  {
    titre: "Question écrite — délai de convocation",
    categorie: "Question écrite",
    contenu: `Monsieur le Maire,

Au titre de mon droit à l'information de conseiller municipal (article L2121-13 du Code Général des Collectivités Territoriales), je me permets de vous adresser la présente question écrite.

Lors de la séance du {{date_seance}}, j'ai constaté que les convocations ont été reçues seulement {{jours}} jours avant la réunion, alors que l'article L2121-11 du CGCT impose un délai minimum de 3 jours francs pour les communes de moins de 3 500 habitants.

En conséquence, je vous demande :
1. De confirmer les dates et modalités d'envoi des convocations pour cette séance ;
2. De prendre les mesures nécessaires pour que ce délai légal soit respecté à l'avenir ;
3. De préciser la procédure interne mise en place pour garantir ce respect.

Dans l'attente de votre réponse, je vous adresse, Monsieur le Maire, l'expression de ma considération distinguée.

{{signataire}}
Conseiller(ère) municipal(e)
Commune de {{commune}}`,
    variables: ["date_seance", "jours", "signataire", "commune"],
  },
  {
    titre: "Demande CADA — accès documents administratifs",
    categorie: "Demande CADA",
    contenu: `Monsieur le Maire,

En application de la loi n° 78-753 du 17 juillet 1978 et du code des relations entre le public et l'administration (articles L300-1 et suivants), je sollicite la communication des documents administratifs suivants :

{{liste_documents}}

Ces documents sont nécessaires à l'exercice de mon mandat de conseiller(ère) municipal(e) et à l'information des citoyens de {{commune}}.

Je vous rappelle que l'administration dispose d'un délai d'un mois pour répondre à cette demande. En cas de refus ou de silence, je me réserve la possibilité de saisir la Commission d'Accès aux Documents Administratifs (CADA).

Veuillez agréer, Monsieur le Maire, l'expression de mes salutations distinguées.

{{signataire}}
Conseiller(ère) municipal(e)`,
    variables: ["liste_documents", "commune", "signataire"],
  },
  {
    titre: "Recours gracieux — délibération irrégulière",
    categorie: "Recours gracieux",
    contenu: `Monsieur le Maire,

Je me permets de vous adresser le présent recours gracieux à l'encontre de la délibération du Conseil municipal de {{commune}} en date du {{date_seance}} portant sur {{objet_deliberation}}.

Motifs d'illégalité :
{{motifs}}

En application de l'article R421-1 du Code de Justice Administrative, ce recours gracieux suspend le délai de recours contentieux de deux mois.

Je vous demande en conséquence de bien vouloir retirer ou modifier la délibération précitée dans un délai de deux mois.

À défaut, je me verrai contraint(e) de saisir le Tribunal Administratif compétent, ainsi que, le cas échéant, d'effectuer un déféré préfectoral conformément à l'article L2131-6 du CGCT.

Dans l'attente de votre réponse, je vous adresse, Monsieur le Maire, l'expression de mes salutations distinguées.

{{signataire}}
Conseiller(ère) municipal(e)`,
    variables: ["commune", "date_seance", "objet_deliberation", "motifs", "signataire"],
  },
  {
    titre: "Lettre au Préfet — signalement irrégularité",
    categorie: "Courrier Préfet",
    contenu: `Monsieur le Préfet,

En qualité de conseiller(ère) municipal(e) de la commune de {{commune}} ({{cp}}), je me permets de porter à votre connaissance des irrégularités constatées lors de séances du Conseil municipal.

Faits constatés :
{{faits}}

Bases légales applicables :
{{bases_legales}}

Ces irrégularités semblent de nature à justifier l'exercice par vos services du contrôle de légalité prévu aux articles L2131-1 et suivants du Code Général des Collectivités Territoriales.

Je reste à votre disposition pour vous fournir tout document complémentaire.

Dans l'attente de votre réponse, je vous adresse, Monsieur le Préfet, l'expression de ma haute considération.

{{signataire}}
Conseiller(ère) municipal(e) — Commune de {{commune}}`,
    variables: ["commune", "cp", "faits", "bases_legales", "signataire"],
  },
];

router.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM modeles ORDER BY categorie, titre ASC").all();
  res.json(rows.map(r => ({ ...r, variables: JSON.parse(r.variables || "[]") })));
});

router.post("/", (req, res) => {
  const { titre, categorie = "Autre", contenu, variables = [] } = req.body;
  if (!titre || !contenu) return res.status(400).json({ error: "titre et contenu requis" });

  const result = db.prepare(
    "INSERT INTO modeles (titre, categorie, contenu, variables) VALUES (?, ?, ?, ?)"
  ).run(titre, categorie, contenu, JSON.stringify(variables));

  const row = db.prepare("SELECT * FROM modeles WHERE id = ?").get(result.lastInsertRowid);
  res.json({ ...row, variables: JSON.parse(row.variables || "[]") });
});

router.put("/:id", (req, res) => {
  const { titre, categorie, contenu, variables } = req.body;
  const cur = db.prepare("SELECT * FROM modeles WHERE id = ?").get(req.params.id);
  if (!cur) return res.status(404).json({ error: "modèle introuvable" });

  db.prepare(`
    UPDATE modeles SET
      titre     = COALESCE(?, titre),
      categorie = COALESCE(?, categorie),
      contenu   = COALESCE(?, contenu),
      variables = COALESCE(?, variables)
    WHERE id = ?
  `).run(titre ?? null, categorie ?? null, contenu ?? null,
    variables ? JSON.stringify(variables) : null, req.params.id);

  const row = db.prepare("SELECT * FROM modeles WHERE id = ?").get(req.params.id);
  res.json({ ...row, variables: JSON.parse(row.variables || "[]") });
});

router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM modeles WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// Génération IA d'un modèle personnalisé
router.post("/generate", async (req, res) => {
  const { categorie, sujet, contexte = "" } = req.body;
  if (!categorie || !sujet) return res.status(400).json({ error: "categorie et sujet requis" });

  const client = getAIClient();
  const msg = await client.messages.create({
    model: getAIModel(),
    max_tokens: 1500,
    messages: [{
      role: "user",
      content: `Tu es conseiller municipal d'opposition à ${communeLabel()}.
Rédige un modèle de document de type "${categorie}" sur le sujet : "${sujet}"
${contexte ? `Contexte : ${contexte}` : ""}

Utilise des variables entre {{doubles accolades}} pour les éléments à personnaliser (date, nom, etc.).
Le document doit être formel, avec les bonnes bases légales (CGCT, code urb., etc.).

Retourne UNIQUEMENT ce JSON :
{"titre":"...","contenu":"...","variables":["var1","var2"]}`,
    }],
  });

  trackUsage("modeles/generate", msg.model, msg.usage);
  const raw = msg.content[0].text.trim().replace(/```json|```/g, "").trim();
  res.json({ ...JSON.parse(raw), categorie });
});

// Seed modèles par défaut si table vide
const modeleCount = db.prepare("SELECT COUNT(*) as n FROM modeles").get().n;
if (modeleCount === 0) {
  const ins = db.prepare("INSERT INTO modeles (titre, categorie, contenu, variables) VALUES (?, ?, ?, ?)");
  for (const m of MODELES_DEFAUT) ins.run(m.titre, m.categorie, m.contenu, JSON.stringify(m.variables));
}

module.exports = router;
