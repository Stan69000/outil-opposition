const dns = require("dns").promises;
const net = require("net");

// Détermine si une IP appartient à une plage privée / interne (anti-SSRF).
function ipIsPrivate(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 10) return true;                       // 10.0.0.0/8
    if (a === 127) return true;                      // loopback
    if (a === 0) return true;                        // 0.0.0.0/8
    if (a === 169 && b === 254) return true;         // link-local / métadonnées cloud
    if (a === 172 && b >= 16 && b <= 31) return true;// 172.16.0.0/12
    if (a === 192 && b === 168) return true;         // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true;// CGNAT 100.64.0.0/10
    return false;
  }
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fe80")) return true;         // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA fc00::/7
  const mapped = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)/);
  if (mapped) return ipIsPrivate(mapped[1]);
  return false;
}

// Vérifie qu'une URL est publique en HTTP(S) et ne pointe pas vers une IP interne.
// À appeler avant tout axios.get/fetch côté serveur sur une URL d'origine externe.
async function assertPublicHttpUrl(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch { throw new Error("URL invalide"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("Protocole non autorisé (http/https uniquement)");
  }
  const host = u.hostname;
  if (!host || host === "localhost") throw new Error("Hôte interdit");

  if (net.isIP(host)) {
    if (ipIsPrivate(host)) throw new Error("Adresse IP privée interdite");
    return rawUrl;
  }

  const addrs = await dns.lookup(host, { all: true });
  if (!addrs.length) throw new Error("Hôte introuvable");
  for (const a of addrs) {
    if (ipIsPrivate(a.address)) throw new Error("Hôte résolu vers une IP interne interdite");
  }
  return rawUrl;
}

module.exports = { assertPublicHttpUrl, ipIsPrivate };
