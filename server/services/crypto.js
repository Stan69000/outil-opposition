const crypto = require("crypto");
const os     = require("os");

const ALGORITHM = "aes-256-gcm";
const PREFIX    = "enc:";

// Clés de config qui doivent être chiffrées au repos
const SENSITIVE_KEYS = new Set([
  "ai_api_key",
  "piste_client_secret",
  "vapid_private_key",
]);

function getMasterKey() {
  const raw = process.env.ENCRYPTION_KEY;
  if (raw) {
    return crypto.createHash("sha256").update(raw).digest();
  }
  // Fallback déterministe basé sur le hostname — mieux que rien,
  // mais ENCRYPTION_KEY doit être défini en production.
  const fallback = os.hostname() + ":opposition-fallback-v1";
  if (process.env.NODE_ENV === "production") {
    console.warn("[crypto] ENCRYPTION_KEY manquant — fallback hostname utilisé. Définir ENCRYPTION_KEY en production !");
  }
  return crypto.createHash("sha256").update(fallback).digest();
}

/**
 * Chiffre une valeur texte.
 * Format stocké : "enc:<base64(iv[12] + authTag[16] + ciphertext)>"
 */
function encrypt(plaintext) {
  if (!plaintext) return plaintext;
  // Déjà chiffré
  if (plaintext.startsWith(PREFIX)) return plaintext;

  const key = getMasterKey();
  const iv  = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return PREFIX + Buffer.concat([iv, tag, encrypted]).toString("base64");
}

/**
 * Déchiffre une valeur stockée.
 * Retourne la valeur telle quelle si elle n'est pas chiffrée (migration transparente).
 */
function decrypt(stored) {
  if (!stored || !stored.startsWith(PREFIX)) return stored;
  try {
    const key = getMasterKey();
    const buf  = Buffer.from(stored.slice(PREFIX.length), "base64");
    const iv         = buf.subarray(0, 12);
    const tag        = buf.subarray(12, 28);
    const ciphertext = buf.subarray(28);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(ciphertext, undefined, "utf8") + decipher.final("utf8");
  } catch {
    // Mauvaise clé ou données corrompues → retourne chaîne vide
    return "";
  }
}

function isSensitive(key) {
  return SENSITIVE_KEYS.has(key);
}

module.exports = { encrypt, decrypt, isSensitive, SENSITIVE_KEYS };
