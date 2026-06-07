const Anthropic = require("@anthropic-ai/sdk");
const { getConfig } = require("../db");

function getAIClient() {
  const key = getConfig("ai_api_key") || process.env.ANTHROPIC_API_KEY || "";
  return new Anthropic({ apiKey: key });
}

function getAIModel() {
  return getConfig("ai_model") || "claude-opus-4-5";
}

function getCommuneCtx() {
  return {
    nom:            getConfig("commune_nom"),
    cp:             getConfig("commune_cp"),
    population:     getConfig("commune_population"),
    departement:    getConfig("commune_departement"),
    insee:          getConfig("commune_insee"),
    nb_conseillers: getConfig("commune_nb_conseillers"),
    quorum:         getConfig("commune_quorum"),
    maire:          getConfig("commune_maire"),
  };
}

// "Fleurieux-sur-l'Arbresle (69210), ~2000 hab."
function communeLabel() {
  const c = getCommuneCtx();
  return `${c.nom} (${c.cp}), ~${c.population} hab.`;
}

module.exports = { getAIClient, getAIModel, getCommuneCtx, communeLabel };
