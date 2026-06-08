// Extraction deterministe des presences depuis le texte d'un PV/CR de conseil municipal.
// Aucune IA, aucune invention : on lit uniquement ce qui est ecrit dans le compte-rendu.
//
// Gere les deux formats rencontres a Fleurieux :
//  - Recent (2023+) : "En exercice : 19 / Presents : 17 / Pouvoirs : 2 / Votants : 19",
//    "Date de Convocation ... : 20 janvier 2026", "Etaient presents : ... Excusees : ...".
//  - Ancien (2020-2022) : "Nbre de Conseillers en exercice : 19 / Presents : 12 / Votants : 17",
//    "Convocation du 5 fevrier 2020.", listes "Mesdames ... Messieurs ...", "Absents excuses :",
//    "Absents :", noms composes ("BONNAT DEVAUX"), retours a la ligne au milieu des listes.
//
// NB : les PV scannes (sans couche texte) ne donnent rien a pdftotext -> parseAttendance renvoie null.

const num = (re, text) => {
  const m = text.match(re);
  return m ? parseInt(m[1], 10) : null;
};

// "Prenom NOM" : prenom capitalise (eventuellement compose) suivi d'un nom en MAJUSCULES
// (eventuellement compose : "BONNAT DEVAUX"). Robuste aux virgules/retours a la ligne manquants.
function extractNames(fragment) {
  if (!fragment) return [];
  const re = /([A-ZÀ-Ÿ][a-zà-ÿ’'\-]+(?:[- ][A-ZÀ-Ÿ][a-zà-ÿ’'\-]+)*)\s+([A-ZÀ-Ÿ]{2,}(?:[-' ]+[A-ZÀ-Ÿ]{2,})*)/g;
  const names = [];
  let m;
  while ((m = re.exec(fragment)) !== null) {
    names.push(`${m[1]} ${m[2]}`.replace(/\s+/g, " ").trim());
  }
  return names;
}

// Retire les civilites et les "(pouvoir donne a X)" avant extraction des noms.
function cleanNames(fragment) {
  if (!fragment) return [];
  const cleaned = fragment
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(Mesdames|Messieurs|Madame|Monsieur|Mmes?|MM?\.)\b/gi, " ");
  return extractNames(cleaned);
}

// Fragment entre un label de debut et le prochain marqueur d'arret (insensible aux lignes vides).
function section(text, startRe, stopRe) {
  const m = text.match(startRe);
  if (!m) return "";
  const rest = text.slice(m.index + m[0].length);
  const s = rest.search(stopRe);
  return (s === -1 ? rest : rest.slice(0, s)).trim();
}

// Debut de la 1re deliberation / fin de l'en-tete (ex: "2026-01", "2020-1/", "Rapporteur", "DELIBERE").
const DELIB_STOP = /Rapporteur|D[ÉE]LIB[ÈE]RE|Ordre du jour|\n\s*\d{4}\s*[-/]\s*\d/i;

function parseAttendance(text) {
  if (!text || typeof text !== "string") return null;

  const en_exercice = num(/en exercice\s*:?\s*(\d+)/i, text);
  const presents    = num(/Pr[ée]sents?\s*:?\s*(\d+)/i, text);
  const pouvoirs    = num(/Pouvoirs?\s*:?\s*(\d+)/i, text);
  const votants     = num(/Votants?\s*:?\s*(\d+)/i, text);

  const convocM =
    text.match(/Date de Convocation[^:]*:\s*([0-9][^\n]*?\d{4})/i) ||
    text.match(/Convocation\s+du\s+([0-9][^.\n]*?\d{4})/i);
  const convocation = convocM ? convocM[1].trim() : null;

  // Presents : liste nominative ("Etaient presents :"), bornee avant la section absents.
  const presentsStop = /Absent|Excus[ée]|Pouvoirs?\s*:|Votants?\s*:|Rapporteur|\n\s*\d{4}\s*[-/]\s*\d/i;
  let fragPresents = section(text, /Étai(?:en)?t\s+pr[ée]sents?\s*:/i, presentsStop);
  if (!fragPresents) fragPresents = section(text, /Pr[ée]sents?\s*:\s*(?=[A-Za-zÀ-ÿ])/i, presentsStop);
  const presents_noms = cleanNames(fragPresents);

  // Absents (excuses + non excuses) : tout ce qui suit jusqu'a la 1re deliberation.
  const fragAbsents = section(text, /(?:Absents?\s+excus[ée]e?s?|Excus[ée]e?s?|Absents?)\s*:/i, DELIB_STOP);
  const absents_noms = cleanNames(fragAbsents);

  if (en_exercice == null && presents == null && presents_noms.length === 0) return null;

  return { en_exercice, presents, pouvoirs, votants, convocation, presents_noms, absents_noms };
}

const MOIS = {
  janvier: 1, février: 2, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6,
  juillet: 7, août: 8, aout: 8, septembre: 9, octobre: 10, novembre: 11,
  décembre: 12, decembre: 12,
};

// "20 janvier 2026" / "1er février 2020" -> "2026-01-20" (ISO), ou null.
function parseFrenchDate(str) {
  if (!str) return null;
  const m = str.match(/(\d{1,2})\s*(?:er)?\s+([a-zà-ÿ]+)\s+(\d{4})/i);
  if (!m) return null;
  const mois = MOIS[m[2].toLowerCase()];
  if (!mois) return null;
  const pad = n => String(n).padStart(2, "0");
  return `${m[3]}-${pad(mois)}-${pad(parseInt(m[1], 10))}`;
}

// Délai de convocation en jours francs (convocation et séance exclues) + conformité.
// Seuil légal : 3 jours francs (commune < 3500 hab, CGCT L2121-11), 5 sinon (L2121-12).
function delaiConvocation(convocISO, seanceISO, seuil = 3) {
  if (!convocISO || !seanceISO) return null;
  const c = new Date(convocISO), s = new Date(seanceISO);
  if (isNaN(c) || isNaN(s)) return null;
  const cal = Math.round((s - c) / 86400000);
  const jours_francs = cal - 1; // on exclut le jour d'envoi ET le jour de séance
  return { convocation: convocISO, seance: seanceISO, jours_francs, seuil, conforme: jours_francs >= seuil };
}

module.exports = { parseAttendance, extractNames, parseFrenchDate, delaiConvocation };
