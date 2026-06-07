import { useState, useEffect, useCallback, useRef, createContext, useContext } from "react";
import { api } from "./api.js";

// Convertit une clé VAPID base64 en Uint8Array pour PushManager
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return new Uint8Array([...raw].map(c => c.charCodeAt(0)));
}

// ── DONNÉES FIXES ──────────────────────────────────────────────────────────────
const COMMUNE = {
  nom: "Fleurieux-sur-l'Arbresle", cp: "69210",
  deliberations_url: "https://fleurieuxsurlarbresle.fr/fr/rb/2187928/deliberations-prises",
};
const CONSEIL = {
  maire: "M. Aymeric GIRARDON",
  adjoints: [
    { nom: "M. Jean-Pierre BLANCHARD", role: "Bâtiments · cimetière · patrimoine · cadre de vie" },
    { nom: "Mme Isabelle BONNET",       role: "Éducation · enfance · jeunesse" },
    { nom: "M. Alain BENISTY",          role: "Finances · révision PLU · crématorium" },
    { nom: "Mme Caroline MIRANDA",      role: "CCAS · solidarités · social · agriculture · santé" },
    { nom: "M. Raphaël DELOIN",         role: "Associations · sport · équipements sportifs" },
  ],
  conseillers: [
    "Mme Delphine CHARVIEUX","Mme Evelyne GIRARDON","M. Léo MOLINIE",
    "Mme Magali PICARD","Mme Sophie VERCHERE","Mme Karine LORENZO",
    "M. Remi BROSSIER","M. Vincent PEYRE","M. Jérôme JEANPIERRE",
    "Mme Elvine LEON","M. Olivier CHAMBE","Mme Eva DRUT","M. Jean-Michel GOLFIER",
  ],
};
const CGCT_WATCH = [
  { id:"L2121-10", titre:"Convocation — délai légal 5 jours minimum", alerte:"Vérifier date d'envoi vs date de séance" },
  { id:"L2121-11", titre:"Urgence — délai réduit à 1 jour",           alerte:"Surveiller les abus de procédure d'urgence" },
  { id:"L2121-25", titre:"Publication des délibérations sous 8 jours", alerte:"Contrôler la mise en ligne sur le site mairie" },
  { id:"L2122-22", titre:"Délégations du conseil au maire",            alerte:"Liste des actes délégués à contrôler en séance" },
  { id:"L2313-1",  titre:"Transparence financière — comptes publics",  alerte:"Comptes obligatoirement publiés et accessibles" },
  { id:"L2141-1",  titre:"Droits de l'opposition",                     alerte:"Accès aux docs, temps de parole, questions écrites" },
  { id:"L2121-19", titre:"Séance extraordinaire à la demande",         alerte:"L'opposition peut demander convocation si majorité" },
];
const FONDS_LF = [
  { id:"CODE_ETAT", label:"Codes en vigueur" },
  { id:"LEGI",      label:"Légifrance général" },
  { id:"JORF",      label:"Journal officiel" },
  { id:"CNIL",      label:"CNIL" },
];
const QUICK_LF = [
  { label:"Convocation CM",    q:"convocation conseil municipal délai" },
  { label:"PLU révision",      q:"plan local urbanisme révision modification" },
  { label:"Budget communal",   q:"budget primitif commune vote" },
  { label:"Marchés publics",   q:"marché public procédure commune" },
  { label:"Droits opposition", q:"opposition minorité conseil municipal" },
  { label:"Loi ZAN",           q:"zéro artificialisation nette" },
];
const QUICK_IA = [
  { label:"Bilan légalité",   icon:"⚖",
    prompt:"Bilan complet des irrégularités légales. Classe par gravité, plan d'action priorisé.",
    ctx:(f,p)=>JSON.stringify({failles:f,pvs:p}) },
  { label:"Questions séance", icon:"?",
    prompt:"8 questions précises à poser au prochain conseil. Format : Question + Base légale + Objectif stratégique.",
    ctx:(f)=>JSON.stringify({failles:f}) },
  { label:"Rapport citoyens", icon:"≡",
    prompt:"Rapport synthétique de l'opposition pour les habitants de Fleurieux. Ton citoyen, accessible, factuel.",
    ctx:(f,p)=>JSON.stringify({pvs:p,failles:f}) },
  { label:"Analyse PLU & ZAN", icon:"#",
    prompt:"Analyse les décisions d'urbanisme sous l'angle ZAN et du PLU. Risques juridiques, opportunités de recours.",
    ctx:(_f,p)=>JSON.stringify(p.filter(x=>x.objet?.toLowerCase().includes("plu")||x.objet?.toLowerCase().includes("urban"))) },
  { label:"Audit budget",     icon:"$",
    prompt:"Analyse le budget communal et les dépenses dans les PV. Points contestables, propositions alternatives.",
    ctx:(_f,p)=>JSON.stringify(p.filter(x=>x.objet?.toLowerCase().includes("budget"))) },
  { label:"Lettre au Préfet", icon:"@",
    prompt:"Rédige une lettre formelle au Préfet du Rhône signalant les irrégularités les plus graves. Références légales précises.",
    ctx:(f)=>JSON.stringify(f.filter(x=>x.gravite==="Haute")) },
];

// ── THÈME ─────────────────────────────────────────────────────────────────────
const DARK = {
  bg:        "#0F1117", surface:   "#181D2B", surfaceAlt:"#1E2538",
  border:    "#252D3D", borderMid: "#2D3651",
  text:      "#E2E8F0", textSec:   "#94A3B8", textMuted: "#4B5A72",
  primary:   "#3B82F6", primaryBg: "#3B82F61A",
  success:   "#22C55E", successBg: "#22C55E1A",
  warning:   "#F59E0B", warningBg: "#F59E0B1A",
  danger:    "#EF4444", dangerBg:  "#EF44441A",
  purple:    "#A78BFA", purpleBg:  "#A78BFA1A",
  nav:       "#0D1017", navBorder: "#1E2538",
  inputBg:   "#0F1421", shadow:    "0 1px 8px rgba(0,0,0,0.5)",
  mode: "dark",
};
const LIGHT = {
  bg:        "#F1F5F9", surface:   "#FFFFFF", surfaceAlt:"#F8FAFC",
  border:    "#E2E8F0", borderMid: "#CBD5E1",
  text:      "#0F172A", textSec:   "#475569", textMuted: "#94A3B8",
  primary:   "#2563EB", primaryBg: "#DBEAFE",
  success:   "#16A34A", successBg: "#DCFCE7",
  warning:   "#D97706", warningBg: "#FEF3C7",
  danger:    "#DC2626", dangerBg:  "#FEE2E2",
  purple:    "#7C3AED", purpleBg:  "#EDE9FE",
  nav:       "#FFFFFF", navBorder: "#E2E8F0",
  inputBg:   "#F8FAFC", shadow:    "0 1px 4px rgba(0,0,0,0.08)",
  mode: "light",
};

const ThemeCtx = createContext(DARK);
const useT = () => useContext(ThemeCtx);

// ── STATUTS / GRAVITÉS ────────────────────────────────────────────────────────
function statutColor(t, s) {
  const m = { Alerte:t.danger, "En cours":t.warning, Conforme:t.success,
    Analysé:t.primary, Résolu:t.purple, Ouvert:t.danger, Importé:t.primary,
    "En vigueur":t.success, "À surveiller":t.warning };
  return m[s] || t.textMuted;
}
function graviteColor(t, g) {
  if (g==="Haute") return { bg:t.dangerBg, border:t.danger, text:t.danger };
  if (g==="Moyenne") return { bg:t.warningBg, border:t.warning, text:t.warning };
  return { bg:t.successBg, border:t.success, text:t.success };
}

// ── COMPOSANTS DE BASE ─────────────────────────────────────────────────────────
function Badge({ label, color }) {
  return (
    <span style={{ background:color+"22", border:`1px solid ${color}55`, color,
      padding:"2px 8px", borderRadius:"4px", fontSize:"11px", fontWeight:600,
      whiteSpace:"nowrap", display:"inline-flex", alignItems:"center" }}>
      {label}
    </span>
  );
}

function Card({ children, style={}, onClick, hover=true }) {
  const t = useT();
  const [hov, setHov] = useState(false);
  return (
    <div onClick={onClick}
      onMouseEnter={() => hover && onClick && setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{ background: t.surface, border:`1px solid ${hov ? t.borderMid : t.border}`,
        borderRadius:"10px", padding:"18px", cursor:onClick?"pointer":"default",
        boxShadow: hov ? `0 4px 16px rgba(0,0,0,${t.mode==="dark"?0.4:0.1})` : t.shadow,
        transition:"border-color 0.15s, box-shadow 0.15s",
        ...style }}>
      {children}
    </div>
  );
}

function Btn({ children, onClick, variant="primary", size="md", disabled=false, style={} }) {
  const t = useT();
  const [hov, setHov] = useState(false);
  const V = {
    primary:  { bg:t.primary,     text:"#fff",      border:t.primary },
    success:  { bg:t.success,     text:"#fff",      border:t.success },
    danger:   { bg:t.danger,      text:"#fff",      border:t.danger },
    ghost:    { bg:"transparent", text:t.textSec,   border:t.border },
    warning:  { bg:t.warning,     text:"#fff",      border:t.warning },
    outline:  { bg:"transparent", text:t.primary,   border:t.primary },
    purple:   { bg:t.purple,      text:"#fff",      border:t.purple },
  };
  const S = { sm:{padding:"4px 12px",fontSize:"11px"}, md:{padding:"8px 16px",fontSize:"12px"}, lg:{padding:"10px 22px",fontSize:"13px"} };
  const v = V[variant] || V.ghost;
  return (
    <button onClick={onClick} disabled={disabled}
      onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}
      style={{ background:v.bg, border:`1px solid ${v.border}`, color:v.text,
        borderRadius:"6px", cursor:disabled?"not-allowed":"pointer", fontWeight:600,
        opacity:disabled?0.5:hov?0.88:1, transition:"opacity 0.12s",
        fontFamily:"inherit", ...S[size], ...style }}>
      {children}
    </button>
  );
}

function Input({ value, onChange, onKeyDown, placeholder, type="text", style={} }) {
  const t = useT();
  return (
    <input type={type} value={value} onChange={onChange} onKeyDown={onKeyDown} placeholder={placeholder}
      style={{ width:"100%", background:t.inputBg, border:`1px solid ${t.border}`,
        color:t.text, padding:"9px 13px", borderRadius:"6px", fontSize:"13px",
        fontFamily:"inherit", boxSizing:"border-box",
        ...style }} />
  );
}

function Textarea({ value, onChange, placeholder, rows=3, style={} }) {
  const t = useT();
  return (
    <textarea value={value} onChange={onChange} placeholder={placeholder} rows={rows}
      style={{ width:"100%", background:t.inputBg, border:`1px solid ${t.border}`,
        color:t.text, padding:"9px 13px", borderRadius:"6px", fontSize:"13px",
        fontFamily:"inherit", boxSizing:"border-box", resize:"vertical",
        ...style }} />
  );
}

function Select({ value, onChange, children, style={} }) {
  const t = useT();
  return (
    <select value={value} onChange={onChange}
      style={{ background:t.inputBg, border:`1px solid ${t.border}`,
        color:t.text, padding:"9px 13px", borderRadius:"6px", fontSize:"13px",
        fontFamily:"inherit", cursor:"pointer", ...style }}>
      {children}
    </select>
  );
}

function Spinner({ label="" }) {
  const t = useT();
  return (
    <div style={{ textAlign:"center", padding:"40px 20px", color:t.textMuted }}>
      <div style={{ width:"28px", height:"28px", border:`2px solid ${t.border}`,
        borderTopColor:t.primary, borderRadius:"50%", margin:"0 auto 12px",
        animation:"spin 0.8s linear infinite" }} />
      {label && <p style={{ fontSize:"13px", color:t.textMuted, margin:0 }}>{label}</p>}
    </div>
  );
}

function SectionTitle({ children, sub }) {
  const t = useT();
  return (
    <div style={{ marginBottom:"20px" }}>
      <h2 style={{ color:t.text, fontSize:"20px", fontWeight:700, margin:"0 0 4px 0" }}>{children}</h2>
      {sub && <p style={{ color:t.textMuted, fontSize:"12px", margin:0 }}>{sub}</p>}
    </div>
  );
}

function EmptyState({ icon, text }) {
  const t = useT();
  return (
    <div style={{ textAlign:"center", padding:"48px 20px", color:t.textMuted }}>
      <div style={{ fontSize:"32px", marginBottom:"10px" }}>{icon}</div>
      <p style={{ fontSize:"14px", margin:0 }}>{text}</p>
    </div>
  );
}

function SubTabs({ tabs, active, onSelect }) {
  const t = useT();
  return (
    <div style={{ display:"flex", gap:"4px", marginBottom:"18px", borderBottom:`1px solid ${t.border}`, paddingBottom:"2px" }}>
      {tabs.map(([id, label]) => (
        <button key={id} onClick={() => onSelect(id)} style={{
          background:"none", border:"none", padding:"8px 14px",
          borderBottom:`2px solid ${active===id ? t.primary : "transparent"}`,
          color:active===id ? t.text : t.textMuted, cursor:"pointer",
          fontSize:"13px", fontWeight:active===id ? 600 : 400, fontFamily:"inherit",
          transition:"color 0.15s", marginBottom:"-2px",
        }}>{label}</button>
      ))}
    </div>
  );
}

// ── COUNTDOWN RECOURS ─────────────────────────────────────────────────────────
function RecoursCountdown({ jours, limite }) {
  const t = useT();
  if (!limite) return null;
  const color = jours < 0 ? t.textMuted : jours < 10 ? t.danger : jours < 30 ? t.warning : t.success;
  const label = jours < 0 ? "Recours expiré" : jours === 0 ? "Recours expire aujourd'hui" : `${jours}j recours`;
  return <Badge label={label} color={color} />;
}

// ── PANNEAU IA ─────────────────────────────────────────────────────────────────
function AIPanel({ prompt, context, onClose }) {
  const t = useT();
  const [response, setResponse] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.ai(prompt, context)
      .then(d => setResponse(d.text || "Aucune réponse."))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", zIndex:1000,
      display:"flex", alignItems:"center", justifyContent:"center", padding:"20px" }}>
      <div style={{ background:t.surface, border:`1px solid ${t.border}`, borderRadius:"14px",
        maxWidth:"700px", width:"100%", maxHeight:"85vh", overflow:"hidden",
        display:"flex", flexDirection:"column", boxShadow:"0 20px 60px rgba(0,0,0,0.4)" }}>
        <div style={{ padding:"16px 20px", borderBottom:`1px solid ${t.border}`,
          display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div style={{ display:"flex", alignItems:"center", gap:"8px" }}>
            <div style={{ width:"8px", height:"8px", borderRadius:"50%", background:t.primary }} />
            <span style={{ color:t.text, fontSize:"13px", fontWeight:600 }}>Analyse IA</span>
          </div>
          <button onClick={onClose} style={{ background:"none", border:`1px solid ${t.border}`,
            color:t.textMuted, cursor:"pointer", fontSize:"16px", width:"28px", height:"28px",
            borderRadius:"6px", display:"flex", alignItems:"center", justifyContent:"center" }}>x</button>
        </div>
        <div style={{ padding:"22px", overflowY:"auto", flex:1 }}>
          {loading && <Spinner label="Analyse en cours..." />}
          {error && <p style={{ color:t.danger, fontSize:"13px" }}>Erreur : {error}</p>}
          {!loading && !error && (
            <div style={{ color:t.textSec, fontSize:"14px", lineHeight:"1.8", whiteSpace:"pre-wrap" }}>
              {response}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── ANALYSE PDF SÉANCE (SSE) ──────────────────────────────────────────────────
function PdfSeanceAnalyzer({ pv, onDone }) {
  const t = useT();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState([]);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

  const start = async () => {
    setRunning(true); setProgress([]); setDone(false); setError(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch("/api/pdf/analyze-seance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pvId: pv.id }),
        signal: ctrl.signal,
      });
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { done: d, value } = await reader.read();
        if (d) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          try {
            const evt = JSON.parse(line.slice(5).trim());
            if (evt.type === "progress") setProgress(p => [...p, evt]);
            if (evt.type === "done") { setDone(true); onDone && onDone(); }
            if (evt.type === "error") setError(evt.message);
          } catch {}
        }
      }
    } catch (e) {
      if (e.name !== "AbortError") setError(e.message);
    }
    setRunning(false);
  };

  const stop = () => { abortRef.current?.abort(); setRunning(false); };

  if (!pv.pdfs?.length) return null;

  return (
    <div style={{ marginBottom:"12px" }}>
      <div style={{ display:"flex", gap:"8px", alignItems:"center", marginBottom: progress.length ? "8px" : 0 }}>
        <Btn onClick={running ? stop : start} variant={running ? "warning" : "purple"} size="sm"
          disabled={done}>
          {running ? "Arrêter" : done ? "Analysé" : `Analyser ${pv.pdfs.length} PDF(s) avec IA`}
        </Btn>
        {running && <span style={{ color:t.textMuted, fontSize:"11px" }}>Analyse en cours…</span>}
        {done && <span style={{ color:t.success, fontSize:"11px" }}>Analyse terminée</span>}
        {error && <span style={{ color:t.danger, fontSize:"11px" }}>Erreur : {error}</span>}
      </div>
      {progress.length > 0 && (
        <div style={{ background:t.surfaceAlt, border:`1px solid ${t.border}`, borderRadius:"6px",
          padding:"8px 12px", maxHeight:"120px", overflowY:"auto" }}>
          {progress.map((e, i) => (
            <div key={i} style={{ fontSize:"11px", color:e.error ? t.danger : t.textSec,
              marginBottom:"2px", display:"flex", gap:"8px" }}>
              <span style={{ color:t.textMuted, flexShrink:0 }}>[{e.index}/{e.total}]</span>
              <span style={{ fontWeight:600 }}>{e.nom}</span>
              <span style={{ color:e.error ? t.danger : e.anomalies > 0 ? t.warning : t.success }}>
                {e.error ? "erreur" : e.anomalies > 0 ? `${e.anomalies} anomalie(s)` : "OK"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── SYNC MAIRIE ────────────────────────────────────────────────────────────────
function SyncMairie({ onImport }) {
  const t = useT();
  const [status, setStatus] = useState("idle");
  const [logs, setLogs] = useState([]);
  const [lastSync, setLastSync] = useState(null);
  const [totalImported, setTotalImported] = useState(0);
  const [syncLog, setSyncLog] = useState([]);
  const [subTab, setSubTab] = useState("sync");

  useEffect(() => {
    if (subTab === "log") {
      api.analyses.syncLog().then(setSyncLog).catch(() => {});
    }
  }, [subTab]);

  const runSync = async () => {
    setStatus("loading"); setLogs([]);
    try {
      const data = await api.syncMairie();
      setLogs(data.logs || []);
      if (data.imported?.length > 0) {
        onImport(data.imported);
        setTotalImported(n => n + data.imported.length);
      }
      setLastSync(new Date().toLocaleString("fr-FR"));
      setStatus("done");
    } catch (err) {
      setLogs([{ msg:`Erreur : ${err.message}`, type:"error", ts:new Date().toLocaleTimeString("fr-FR") }]);
      setStatus("error");
    }
  };

  const LC = { info:t.textMuted, success:t.success, error:t.danger, warn:t.warning };

  return (
    <div>
      <SectionTitle sub="Scraping automatique des délibérations officielles de la mairie">
        Synchronisation Mairie
      </SectionTitle>

      <SubTabs
        tabs={[["sync","Synchroniser"],["cgct","Articles CGCT"],["conseil","Conseil municipal"],["log","Journal auto"]]}
        active={subTab} onSelect={setSubTab}
      />

      {subTab === "sync" && (
        <>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"12px", marginBottom:"16px" }}>
            <Card>
              <p style={{ color:t.textMuted, fontSize:"11px", fontWeight:600, margin:"0 0 6px 0", textTransform:"uppercase", letterSpacing:"0.06em" }}>Source officielle</p>
              <p style={{ color:t.text, fontSize:"14px", fontWeight:600, margin:"0 0 6px 0" }}>Site mairie Fleurieux</p>
              <a href={COMMUNE.deliberations_url} target="_blank" rel="noreferrer"
                style={{ color:t.primary, fontSize:"11px", wordBreak:"break-all" }}>
                {COMMUNE.deliberations_url}
              </a>
            </Card>
            <Card>
              <p style={{ color:t.textMuted, fontSize:"11px", fontWeight:600, margin:"0 0 6px 0", textTransform:"uppercase", letterSpacing:"0.06em" }}>Dernière synchro</p>
              <p style={{ color:lastSync ? t.success : t.textMuted, fontSize:"14px", fontWeight:600, margin:"0 0 4px 0" }}>
                {lastSync || "Jamais synchronisé"}
              </p>
              <p style={{ color:t.textMuted, fontSize:"11px", margin:0 }}>{totalImported} séance(s) importée(s) cette session</p>
            </Card>
          </div>

          <Card>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
              marginBottom: logs.length > 0 ? "16px" : 0 }}>
              <div>
                <p style={{ color:t.text, fontSize:"14px", fontWeight:600, margin:"0 0 3px 0" }}>Lancer la synchronisation</p>
                <p style={{ color:t.textMuted, fontSize:"12px", margin:0 }}>
                  Détecte les nouvelles séances et importe les délibérations avec leurs PDFs (2020-2026)
                </p>
              </div>
              <Btn onClick={runSync} disabled={status==="loading"} size="md">
                {status==="loading" ? "En cours…" : "Synchroniser"}
              </Btn>
            </div>
            {logs.length > 0 && (
              <div style={{ background:t.surfaceAlt, border:`1px solid ${t.border}`, borderRadius:"8px",
                padding:"14px", fontFamily:"'JetBrains Mono',monospace", fontSize:"11px",
                maxHeight:"200px", overflowY:"auto" }}>
                {logs.map((l, i) => (
                  <div key={i} style={{ color:LC[l.type]||t.textMuted, marginBottom:"3px", display:"flex", gap:"10px" }}>
                    <span style={{ color:t.textMuted, flexShrink:0 }}>{l.ts}</span>
                    <span>{l.msg}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}

      {subTab === "cgct" && (
        <Card>
          <p style={{ color:t.warning, fontSize:"11px", fontWeight:700, margin:"0 0 14px 0",
            textTransform:"uppercase", letterSpacing:"0.06em" }}>Articles CGCT surveillés</p>
          <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
            {CGCT_WATCH.map(a => (
              <div key={a.id} style={{ display:"flex", alignItems:"flex-start", gap:"14px",
                padding:"10px 14px", background:t.surfaceAlt, border:`1px solid ${t.border}`,
                borderRadius:"8px" }}>
                <span style={{ color:t.primary, fontSize:"11px", fontWeight:700,
                  whiteSpace:"nowrap", minWidth:"78px" }}>Art. {a.id}</span>
                <div style={{ flex:1 }}>
                  <p style={{ color:t.text, fontSize:"12px", fontWeight:500, margin:"0 0 2px 0" }}>{a.titre}</p>
                  <p style={{ color:t.warning, fontSize:"11px", margin:0 }}>! {a.alerte}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {subTab === "conseil" && (
        <Card>
          <p style={{ color:t.purple, fontSize:"11px", fontWeight:700, margin:"0 0 14px 0",
            textTransform:"uppercase", letterSpacing:"0.06em" }}>Composition du conseil (mars 2026)</p>
          <p style={{ color:t.warning, fontSize:"13px", fontWeight:700, margin:"0 0 10px 0" }}>
            Maire : {CONSEIL.maire}
          </p>
          {CONSEIL.adjoints.map(a => (
            <div key={a.nom} style={{ padding:"8px 0", borderBottom:`1px solid ${t.border}`,
              display:"flex", gap:"10px", flexWrap:"wrap", alignItems:"baseline" }}>
              <span style={{ color:t.text, fontSize:"12px", fontWeight:500 }}>{a.nom}</span>
              <span style={{ color:t.textMuted, fontSize:"11px" }}>— {a.role}</span>
            </div>
          ))}
          <div style={{ display:"flex", flexWrap:"wrap", gap:"5px", marginTop:"12px" }}>
            {CONSEIL.conseillers.map(c => (
              <span key={c} style={{ background:t.surfaceAlt, border:`1px solid ${t.border}`,
                color:t.textSec, padding:"3px 9px", borderRadius:"4px", fontSize:"11px" }}>{c}</span>
            ))}
          </div>
        </Card>
      )}

      {subTab === "log" && (
        <div>
          <p style={{ color:t.textMuted, fontSize:"12px", marginBottom:"12px" }}>
            Historique des synchronisations automatiques (cron lundi 8h)
          </p>
          {syncLog.length === 0
            ? <EmptyState icon="=" text="Aucune synchro automatique enregistrée." />
            : (
              <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
                {syncLog.map(e => (
                  <Card key={e.id} style={{ padding:"12px 16px" }} hover={false}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"4px" }}>
                      <span style={{ color:t.text, fontSize:"13px", fontWeight:600 }}>
                        {e.imported} nouvelle(s) séance(s)
                      </span>
                      <Badge label={e.status === "ok" ? "Succès" : "Erreur"} color={e.status === "ok" ? t.success : t.danger} />
                    </div>
                    <p style={{ color:t.textMuted, fontSize:"11px", margin:0 }}>{e.ran_at}</p>
                    {e.error_msg && <p style={{ color:t.danger, fontSize:"11px", margin:"4px 0 0" }}>{e.error_msg}</p>}
                  </Card>
                ))}
              </div>
            )
          }
        </div>
      )}
    </div>
  );
}

// ── LÉGIFRANCE ─────────────────────────────────────────────────────────────────
function VeilleLegifrance({ lois, setLois }) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [fond, setFond] = useState("CODE_ETAT");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState([]);
  const [total, setTotal] = useState(0);
  const [aiPanel, setAiPanel] = useState(null);
  const [subTab, setSubTab] = useState("search");
  const [error, setError] = useState(null);
  const [apiStatus, setApiStatus] = useState(null);
  const [useAiFallback, setUseAiFallback] = useState(false);

  useEffect(() => {
    api.legifrance.ping()
      .then(d => {
        if (d.subscribed && !d.searchBroken) { setApiStatus("ok"); }
        else if (d.subscribed) { setApiStatus("pending"); setUseAiFallback(true); }
        else { setApiStatus("pending"); setUseAiFallback(true); }
      })
      .catch(() => { setApiStatus("error"); setUseAiFallback(true); });
  }, []);

  const searchViaAI = async (q) => {
    const d = await api.ai(
      `Recherche Légifrance: "${q}" — commune rurale 2000 hab (Fleurieux-sur-l'Arbresle 69210). Retourne 3-4 textes pertinents pour l'opposition municipale, impact concret et leviers d'action.`,
      null, "legifrance"
    );
    const clean = d.text.replace(/```json|```/g,"").trim();
    return { results: JSON.parse(clean).results||[], total:0 };
  };

  const doSearch = async (q, f=fond) => {
    if (!q.trim()) return;
    setSearching(true); setResults([]); setError(null);
    try {
      const d = useAiFallback ? await searchViaAI(q) : await api.legifrance.search(q, f);
      setResults(d.results||[]); setTotal(d.total||0);
    } catch (err) { setError(err.message); }
    setSearching(false);
  };

  const addWatch = async (r) => {
    try {
      const created = await api.lois.create({
        id_lf:r.id, titre:r.titre,
        date:r.date_vigueur||new Date().toISOString().slice(0,10),
        impact:r.pertinence, domaine:r.code, statut:"À surveiller",
        resume:r.resume, action:r.action_opposition,
        url:r.url||"https://www.legifrance.gouv.fr",
      });
      setLois(prev=>[...prev,created]);
    } catch(err) { if (!err.message.includes("déjà")) alert(err.message); }
  };

  const statusDot = { ok:t.success, pending:t.warning, error:t.danger }[apiStatus] || t.textMuted;
  const statusLabel = { ok:"PISTE actif", pending:"Fallback IA actif", error:"PISTE hors ligne" }[apiStatus] || "Vérification…";
  const PC = { Haute:t.danger, Moyenne:t.warning, Basse:t.success };

  return (
    <div>
      {aiPanel && <AIPanel {...aiPanel} onClose={()=>setAiPanel(null)} />}

      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"20px" }}>
        <SectionTitle sub="Codes consolidés · Textes applicables aux communes">
          Veille Légifrance
        </SectionTitle>
        <div style={{ display:"flex", alignItems:"center", gap:"6px", marginTop:"4px" }}>
          <div style={{ width:"8px", height:"8px", borderRadius:"50%", background:statusDot, flexShrink:0 }} />
          <span style={{ color:t.textMuted, fontSize:"11px" }}>{statusLabel}</span>
        </div>
      </div>

      <SubTabs tabs={[["search","Rechercher"],["watched",`Surveillés (${lois.length})`]]} active={subTab} onSelect={setSubTab} />

      {subTab==="search" && (
        <>
          <Card style={{ marginBottom:"14px" }}>
            <div style={{ display:"flex", gap:"8px", marginBottom:"10px" }}>
              <Input value={query} onChange={e=>setQuery(e.target.value)}
                onKeyDown={e=>e.key==="Enter"&&doSearch(query)}
                placeholder="Texte de loi, article CGCT, décret… (Entrée pour chercher)"
                style={{ flex:1, padding:"10px 14px", fontSize:"13px" }} />
              <Select value={fond} onChange={e=>setFond(e.target.value)}>
                {FONDS_LF.map(f=><option key={f.id} value={f.id}>{f.label}</option>)}
              </Select>
              <Btn onClick={()=>doSearch(query)} disabled={searching} size="md">
                {searching?"…":"Chercher"}
              </Btn>
            </div>
            {total > 0 && <p style={{ color:t.textMuted, fontSize:"11px", margin:"0 0 10px 0" }}>{total} résultat(s)</p>}
            <div style={{ display:"flex", flexWrap:"wrap", gap:"6px" }}>
              {QUICK_LF.map(q=>(
                <button key={q.label} onClick={()=>{setQuery(q.q);doSearch(q.q);}} style={{
                  background:t.surfaceAlt, border:`1px solid ${t.border}`, color:t.textSec,
                  padding:"4px 11px", borderRadius:"6px", cursor:"pointer",
                  fontSize:"11px", fontFamily:"inherit",
                }}>{q.label}</button>
              ))}
            </div>
          </Card>

          {searching && <Spinner label={useAiFallback?"Recherche via IA…":"Interrogation PISTE…"} />}
          {error && (
            <div style={{ background:t.dangerBg, border:`1px solid ${t.danger}55`, borderRadius:"8px",
              padding:"12px 16px", marginBottom:"14px", color:t.danger, fontSize:"12px" }}>
              ! {error}
            </div>
          )}

          <div style={{ display:"flex", flexDirection:"column", gap:"10px" }}>
            {results.map(r=>(
              <Card key={r.id} style={{ borderLeft:`3px solid ${PC[r.pertinence]||t.border}` }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"8px" }}>
                  <div style={{ flex:1, paddingRight:"12px" }}>
                    <h3 style={{ color:t.text, fontSize:"14px", fontWeight:600, margin:"0 0 8px 0" }}>{r.titre}</h3>
                    <div style={{ display:"flex", gap:"5px", flexWrap:"wrap" }}>
                      <Badge label={r.code} color={t.textMuted} />
                      {r.article && <Badge label={`Art. ${r.article}`} color={t.primary} />}
                      <Badge label={`Impact ${r.pertinence}`} color={PC[r.pertinence]||t.textMuted} />
                    </div>
                  </div>
                  <span style={{ color:t.textMuted, fontSize:"11px", whiteSpace:"nowrap" }}>{r.date_vigueur}</span>
                </div>
                <p style={{ color:t.textSec, fontSize:"13px", lineHeight:"1.6", margin:"0 0 10px 0" }}>{r.resume}</p>
                {r.action_opposition && (
                  <div style={{ background:t.primaryBg, border:`1px solid ${t.primary}33`,
                    borderRadius:"6px", padding:"10px", marginBottom:"12px" }}>
                    <p style={{ color:t.textMuted, fontSize:"10px", fontWeight:600, margin:"0 0 4px 0", textTransform:"uppercase", letterSpacing:"0.05em" }}>Action opposition</p>
                    <p style={{ color:t.primary, fontSize:"12px", margin:0 }}>{r.action_opposition}</p>
                  </div>
                )}
                <div style={{ display:"flex", gap:"6px", flexWrap:"wrap" }}>
                  <Btn onClick={()=>addWatch(r)} variant="success" size="sm">+ Surveiller</Btn>
                  <Btn onClick={()=>setAiPanel({ prompt:"Analyse l'impact de ce texte sur Fleurieux-sur-l'Arbresle et les leviers d'action concrets pour l'opposition.", context:JSON.stringify(r) })} variant="outline" size="sm">Analyser</Btn>
                  {r.url && <a href={r.url} target="_blank" rel="noreferrer" style={{ padding:"4px 12px", border:`1px solid ${t.border}`, borderRadius:"6px", color:t.textSec, fontSize:"11px", textDecoration:"none", fontWeight:500 }}>Légifrance</a>}
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      {subTab==="watched" && (
        <div style={{ display:"flex", flexDirection:"column", gap:"10px" }}>
          {lois.length===0
            ? <EmptyState icon="§" text="Aucun texte surveillé. Utilisez la recherche pour en ajouter." />
            : lois.map(l=>(
              <Card key={l.id} style={{ borderLeft:`3px solid ${PC[l.impact]||t.border}` }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"6px" }}>
                  <h3 style={{ color:t.text, fontSize:"13px", fontWeight:600, margin:0, flex:1, paddingRight:"10px" }}>{l.titre}</h3>
                  <Badge label={l.statut} color={statutColor(t,l.statut)} />
                </div>
                <p style={{ color:t.textSec, fontSize:"12px", lineHeight:"1.6", margin:"0 0 8px 0" }}>{l.resume}</p>
                {l.action && <p style={{ color:t.primary, fontSize:"12px", margin:"0 0 8px 0" }}>→ {l.action}</p>}
                <div style={{ display:"flex", gap:"5px", alignItems:"center" }}>
                  <Badge label={l.domaine} color={t.textMuted} />
                  <span style={{ color:t.textMuted, fontSize:"11px" }}>{l.date}</span>
                </div>
              </Card>
            ))
          }
        </div>
      )}
    </div>
  );
}

// ── PROCÈS-VERBAUX ─────────────────────────────────────────────────────────────
function ProcessVerbaux({ pvs, setPvs }) {
  const t = useT();
  const [sel, setSel] = useState(null);
  const [aiPanel, setAiPanel] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("Tous");
  const [form, setForm] = useState({ date:"", objet:"", pour:0, contre:0, abstention:0, points:"", anomalies:"", notes:"" });

  const f = (k,v) => setForm(prev=>({...prev,[k]:v}));

  const addPv = async () => {
    if (!form.date||!form.objet.trim()) return;
    setSaving(true);
    try {
      const created = await api.pvs.create({
        date:form.date, objet:form.objet,
        votes:{ pour:+form.pour, contre:+form.contre, abstention:+form.abstention },
        points:form.points.split("\n").filter(Boolean),
        anomalies:form.anomalies.split("\n").filter(Boolean),
        notes:form.notes,
      });
      setPvs(prev=>[created,...prev]);
      setShowAdd(false);
      setForm({ date:"", objet:"", pour:0, contre:0, abstention:0, points:"", anomalies:"", notes:"" });
    } catch(err) { alert(err.message); }
    setSaving(false);
  };

  const sorted = [...pvs].sort((a,b)=>new Date(b.date)-new Date(a.date));
  const filtered = filter === "Tous" ? sorted
    : filter === "Alertes" ? sorted.filter(p => p.statut === "Alerte" || p.anomalies?.length > 0)
    : filter === "Analysés" ? sorted.filter(p => p.statut === "Analysé" || p.ai_analysed)
    : sorted.filter(p => p.source === "auto");

  // Recours urgents (< 30 jours)
  const urgentRecours = pvs.filter(p => p.jours_recours !== undefined && p.jours_recours >= 0 && p.jours_recours <= 30);

  return (
    <div>
      {aiPanel && <AIPanel {...aiPanel} onClose={()=>setAiPanel(null)} />}

      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"16px" }}>
        <SectionTitle sub={`${pvs.length} séance(s) enregistrée(s)`}>
          Procès-verbaux
        </SectionTitle>
        <Btn onClick={()=>setShowAdd(!showAdd)} variant={showAdd?"ghost":"success"} size="md">
          {showAdd ? "Annuler" : "+ Nouveau PV"}
        </Btn>
      </div>

      {urgentRecours.length > 0 && (
        <div style={{ background:t.dangerBg, border:`1px solid ${t.danger}44`, borderRadius:"10px",
          padding:"12px 16px", marginBottom:"14px" }}>
          <p style={{ color:t.danger, fontSize:"12px", fontWeight:700, margin:"0 0 6px 0" }}>
            Délais de recours urgents
          </p>
          <div style={{ display:"flex", flexWrap:"wrap", gap:"6px" }}>
            {urgentRecours.map(p => (
              <span key={p.id} style={{ background:t.dangerBg, border:`1px solid ${t.danger}`, color:t.danger,
                padding:"3px 10px", borderRadius:"6px", fontSize:"11px", fontWeight:600 }}>
                {p.jours_recours}j · {p.date}
              </span>
            ))}
          </div>
        </div>
      )}

      {showAdd && (
        <Card style={{ marginBottom:"16px", borderColor:t.success+"44" }}>
          <p style={{ color:t.success, fontSize:"12px", fontWeight:700, margin:"0 0 14px 0", textTransform:"uppercase", letterSpacing:"0.06em" }}>Nouveau PV</p>
          <div style={{ display:"grid", gridTemplateColumns:"160px 1fr", gap:"10px", marginBottom:"10px" }}>
            <Input type="date" value={form.date} onChange={e=>f("date",e.target.value)} />
            <Input value={form.objet} onChange={e=>f("objet",e.target.value)} placeholder="Objet de la séance" />
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:"10px", marginBottom:"10px" }}>
            <Input type="number" value={form.pour} onChange={e=>f("pour",e.target.value)} placeholder="Votes pour" />
            <Input type="number" value={form.contre} onChange={e=>f("contre",e.target.value)} placeholder="Votes contre" />
            <Input type="number" value={form.abstention} onChange={e=>f("abstention",e.target.value)} placeholder="Abstentions" />
          </div>
          <Textarea value={form.points} onChange={e=>f("points",e.target.value)} placeholder="Points clés (un par ligne)" rows={3} style={{ marginBottom:"10px" }} />
          <Textarea value={form.anomalies} onChange={e=>f("anomalies",e.target.value)} placeholder="Anomalies (laisser vide si aucune)" rows={2} style={{ marginBottom:"10px", borderColor:t.danger+"55" }} />
          <Textarea value={form.notes} onChange={e=>f("notes",e.target.value)} placeholder="Notes internes" rows={2} style={{ marginBottom:"14px" }} />
          <div style={{ display:"flex", gap:"8px" }}>
            <Btn onClick={addPv} disabled={saving} variant="success">{saving?"Enregistrement…":"Enregistrer"}</Btn>
            <Btn onClick={()=>setShowAdd(false)} variant="ghost">Annuler</Btn>
          </div>
        </Card>
      )}

      <div style={{ display:"flex", gap:"5px", marginBottom:"14px", flexWrap:"wrap" }}>
        {["Tous","Alertes","Analysés","Auto"].map(v=>(
          <Btn key={v} onClick={()=>setFilter(v)} variant={filter===v?"primary":"ghost"} size="sm">{v}</Btn>
        ))}
      </div>

      <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
        {filtered.map(pv=>{
          const isOpen = sel?.id===pv.id;
          return (
            <Card key={pv.id} style={{ borderLeft:`3px solid ${statutColor(t,pv.statut)}` }}
              onClick={()=>setSel(isOpen?null:pv)}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                <div style={{ flex:1, paddingRight:"12px" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:"8px", marginBottom:"6px", flexWrap:"wrap" }}>
                    <h3 style={{ color:t.text, fontSize:"14px", fontWeight:600, margin:0 }}>{pv.objet}</h3>
                    {pv.source==="auto" && <Badge label="Auto" color={t.purple} />}
                    {pv.pdfs?.length > 0 && <Badge label={`${pv.pdfs.length} PDF`} color={t.primary} />}
                    {pv.ai_analysed > 0 && <Badge label="IA" color={t.success} />}
                  </div>
                  <div style={{ display:"flex", gap:"5px", flexWrap:"wrap" }}>
                    <Badge label={pv.statut} color={statutColor(t,pv.statut)} />
                    {pv.anomalies?.length > 0 && <Badge label={`${pv.anomalies.length} anomalie(s)`} color={t.danger} />}
                    <RecoursCountdown jours={pv.jours_recours} limite={pv.recours_limite} />
                  </div>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:"8px", flexShrink:0 }}>
                  <span style={{ color:t.textMuted, fontSize:"12px" }}>{pv.date}</span>
                  <span style={{ color:t.textMuted, fontSize:"12px" }}>{isOpen?"▲":"▼"}</span>
                </div>
              </div>

              {isOpen && (
                <div style={{ marginTop:"16px", borderTop:`1px solid ${t.border}`, paddingTop:"16px" }}
                  onClick={e=>e.stopPropagation()}>

                  {(pv.votes?.pour > 0 || pv.votes?.contre > 0) && (
                    <div style={{ display:"flex", gap:"16px", marginBottom:"12px",
                      padding:"10px 14px", background:t.surfaceAlt, borderRadius:"8px" }}>
                      <span style={{ color:t.success, fontSize:"13px", fontWeight:600 }}>✓ {pv.votes?.pour??0} pour</span>
                      <span style={{ color:t.danger, fontSize:"13px", fontWeight:600 }}>✗ {pv.votes?.contre??0} contre</span>
                      <span style={{ color:t.warning, fontSize:"13px", fontWeight:600 }}>○ {pv.votes?.abstention??0} abst.</span>
                    </div>
                  )}

                  {pv.points?.length > 0 && (
                    <div style={{ marginBottom:"12px" }}>
                      <p style={{ color:t.textMuted, fontSize:"11px", fontWeight:600, margin:"0 0 6px 0", textTransform:"uppercase", letterSpacing:"0.05em" }}>Points de séance</p>
                      {pv.points.map((p,i)=>(
                        <div key={i} style={{ display:"flex", gap:"8px", marginBottom:"3px" }}>
                          <span style={{ color:t.textMuted }}>·</span>
                          <span style={{ color:t.textSec, fontSize:"13px" }}>{p}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {pv.anomalies?.length > 0 && (
                    <div style={{ background:t.dangerBg, border:`1px solid ${t.danger}44`,
                      borderRadius:"8px", padding:"12px", marginBottom:"12px" }}>
                      <p style={{ color:t.danger, fontSize:"11px", fontWeight:700, margin:"0 0 6px 0", textTransform:"uppercase", letterSpacing:"0.05em" }}>! Anomalies détectées</p>
                      {pv.anomalies.map((a,i)=>(
                        <p key={i} style={{ color:t.danger, fontSize:"13px", margin:"3px 0" }}>• {a}</p>
                      ))}
                    </div>
                  )}

                  {pv.recours_limite && (
                    <div style={{ background: pv.jours_recours < 10 ? t.dangerBg : pv.jours_recours < 30 ? t.warningBg : t.successBg,
                      border:`1px solid ${pv.jours_recours < 10 ? t.danger : pv.jours_recours < 30 ? t.warning : t.success}44`,
                      borderRadius:"8px", padding:"10px 14px", marginBottom:"12px" }}>
                      <p style={{ color:t.textMuted, fontSize:"10px", fontWeight:600, margin:"0 0 2px 0", textTransform:"uppercase", letterSpacing:"0.05em" }}>Délai recours gracieux (art. R421-1 CJA)</p>
                      <p style={{ color:t.text, fontSize:"13px", margin:0, fontWeight:500 }}>
                        Limite : {pv.recours_limite}
                        {pv.jours_recours >= 0
                          ? ` (${pv.jours_recours} jour(s) restant(s))`
                          : " (délai expiré)"}
                      </p>
                    </div>
                  )}

                  {pv.pdfs?.length > 0 && (
                    <div style={{ background:t.surfaceAlt, border:`1px solid ${t.border}`,
                      borderRadius:"8px", padding:"12px", marginBottom:"12px" }}>
                      <p style={{ color:t.textMuted, fontSize:"11px", fontWeight:600, margin:"0 0 8px 0", textTransform:"uppercase", letterSpacing:"0.05em" }}>
                        Délibérations ({pv.pdfs.length})
                      </p>
                      <div style={{ display:"flex", flexDirection:"column", gap:"4px" }}>
                        {pv.pdfs.map((pdf,i)=>(
                          <a key={i} href={pdf.url} target="_blank" rel="noreferrer" style={{
                            display:"flex", alignItems:"center", gap:"8px",
                            color:t.primary, fontSize:"12px", textDecoration:"none",
                            padding:"4px 6px", borderRadius:"4px",
                          }}>
                            <span style={{ flexShrink:0 }}>↓</span>
                            <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                              {pdf.nom || pdf.url.split("/").pop()}
                            </span>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  {pv.pdfs?.length > 0 && (
                    <PdfSeanceAnalyzer pv={pv} onDone={() => {
                      api.pvs.list().then(all => setPvs(all)).catch(()=>{});
                    }} />
                  )}

                  {pv.notes && (
                    <p style={{ color:t.textMuted, fontSize:"12px", fontStyle:"italic", margin:"0 0 12px 0" }}>
                      {pv.notes}
                    </p>
                  )}

                  <Btn onClick={()=>setAiPanel({
                    prompt:"Analyse ce PV de conseil municipal. Identifie les irrégularités légales, les points contestables, et propose 5 questions pour la prochaine séance.",
                    context:JSON.stringify(pv),
                  })} variant="outline" size="sm">
                    Analyser avec IA
                  </Btn>
                </div>
              )}
            </Card>
          );
        })}
        {filtered.length===0 && <EmptyState icon="≡" text="Aucun PV dans ce filtre." />}
      </div>
    </div>
  );
}

// ── FAILLES ────────────────────────────────────────────────────────────────────
function Failles({ failles, setFailles }) {
  const t = useT();
  const [aiPanel, setAiPanel] = useState(null);
  const [filter, setFilter] = useState("Tous");
  const [updating, setUpdating] = useState(null);

  const updateStatut = async (f, statut) => {
    setUpdating(f.id);
    try {
      const updated = await api.failles.update(f.id, { statut });
      setFailles(prev=>prev.map(x=>x.id===f.id?updated:x));
    } catch(err) { alert(err.message); }
    setUpdating(null);
  };

  const filtered = filter==="Tous" ? failles
    : filter==="Ouvertes" ? failles.filter(f=>["Ouvert","En cours"].includes(f.statut))
    : failles.filter(f=>f.statut==="Résolu");

  return (
    <div>
      {aiPanel && <AIPanel {...aiPanel} onClose={()=>setAiPanel(null)} />}

      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"20px" }}>
        <SectionTitle sub="Irrégularités et points de vigilance légaux">
          Failles & Irrégularités
        </SectionTitle>
        <div style={{ display:"flex", gap:"5px" }}>
          {["Tous","Ouvertes","Résolues"].map(v=>(
            <Btn key={v} onClick={()=>setFilter(v)} variant={filter===v?"primary":"ghost"} size="sm">{v}</Btn>
          ))}
        </div>
      </div>

      <div style={{ display:"flex", flexDirection:"column", gap:"10px" }}>
        {filtered.length===0 && <EmptyState icon="✓" text="Aucune faille dans ce filtre." />}
        {filtered.map(faille=>{
          const c = graviteColor(t, faille.gravite);
          return (
            <div key={faille.id} style={{ background:c.bg, border:`1px solid ${c.border}55`,
              borderRadius:"10px", padding:"16px", borderLeft:`4px solid ${c.border}` }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"10px" }}>
                <div style={{ flex:1, paddingRight:"12px" }}>
                  <h3 style={{ color:c.text, fontSize:"14px", fontWeight:600, margin:"0 0 8px 0" }}>{faille.titre}</h3>
                  <div style={{ display:"flex", gap:"5px", flexWrap:"wrap" }}>
                    <Badge label={faille.gravite} color={c.border} />
                    <Badge label={faille.type} color={t.textMuted} />
                    <Badge label={faille.statut} color={statutColor(t,faille.statut)} />
                    {faille.cgct && <Badge label={`CGCT ${faille.cgct}`} color={t.primary} />}
                  </div>
                </div>
                <span style={{ color:t.textMuted, fontSize:"12px", whiteSpace:"nowrap" }}>{faille.date}</span>
              </div>

              <p style={{ color:t.textSec, fontSize:"13px", lineHeight:"1.6", margin:"0 0 10px 0" }}>{faille.description}</p>

              <div style={{ background:t.surface, border:`1px solid ${t.border}`, borderRadius:"8px",
                padding:"10px 14px", marginBottom:"12px" }}>
                <p style={{ color:t.textMuted, fontSize:"10px", fontWeight:700, margin:"0 0 4px 0", textTransform:"uppercase", letterSpacing:"0.05em" }}>Conseil d'action</p>
                <p style={{ color:t.textSec, fontSize:"13px", margin:0 }}>{faille.conseil}</p>
              </div>

              <div style={{ display:"flex", gap:"6px", flexWrap:"wrap" }}>
                <Btn onClick={()=>setAiPanel({
                  prompt:"Détaille les recours juridiques et administratifs pour cette irrégularité : délais, instances (Préfet Rhône, TA Lyon, CADA…), procédure étape par étape.",
                  context:JSON.stringify(faille),
                })} variant="outline" size="sm">Stratégie juridique IA</Btn>

                {faille.statut==="Ouvert" && (
                  <Btn disabled={updating===faille.id} onClick={()=>updateStatut(faille,"En cours")} variant="warning" size="sm">
                    → En cours
                  </Btn>
                )}
                {faille.statut==="En cours" && (
                  <Btn disabled={updating===faille.id} onClick={()=>updateStatut(faille,"Résolu")} variant="success" size="sm">
                    ✓ Résolu
                  </Btn>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── JURISPRUDENCE ─────────────────────────────────────────────────────────────
function Jurisprudence() {
  const t = useT();
  const [query, setQuery] = useState("");
  const [juridiction, setJuridiction] = useState("ta-lyon");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState([]);
  const [error, setError] = useState(null);
  const [source, setSource] = useState(null);

  const QUICK = [
    "délibération illégale annulation",
    "marché public commune irrégularité",
    "convocation conseil municipal tardive",
    "droit opposition information documents",
    "urbanisme PLU illégalité recours",
    "crématorium déchets autorisation",
  ];

  const doSearch = async (q = query) => {
    if (!q.trim()) return;
    setSearching(true); setResults([]); setError(null); setSource(null);
    try {
      const d = await api.jurisprudence.search(q, juridiction);
      setResults(d.results || []);
      setSource(d.results?.[0]?.source === "ia-fallback" ? "ia" : "scrape");
    } catch (e) { setError(e.message); }
    setSearching(false);
  };

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"20px" }}>
        <SectionTitle sub="Décisions du TA Lyon et juridictions administratives — pertinentes pour Fleurieux">
          Jurisprudence
        </SectionTitle>
        {source && (
          <div style={{ display:"flex", alignItems:"center", gap:"6px", marginTop:"4px" }}>
            <div style={{ width:"8px", height:"8px", borderRadius:"50%",
              background: source === "ia" ? t.warning : t.success }} />
            <span style={{ color:t.textMuted, fontSize:"11px" }}>
              {source === "ia" ? "Résultats IA" : "Légifrance scraping"}
            </span>
          </div>
        )}
      </div>

      <Card style={{ marginBottom:"14px" }}>
        <div style={{ display:"flex", gap:"8px", marginBottom:"10px" }}>
          <Input value={query} onChange={e=>setQuery(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&doSearch()}
            placeholder="Ex: délibération illégale commune, droit opposition..."
            style={{ flex:1 }} />
          <Select value={juridiction} onChange={e=>setJuridiction(e.target.value)}>
            <option value="ta-lyon">TA Lyon</option>
            <option value="caa-lyon">CAA Lyon</option>
            <option value="ce">Conseil d'État</option>
            <option value="all">Toutes</option>
          </Select>
          <Btn onClick={()=>doSearch()} disabled={searching || !query.trim()}>
            {searching ? "…" : "Chercher"}
          </Btn>
        </div>
        <div style={{ display:"flex", flexWrap:"wrap", gap:"6px" }}>
          {QUICK.map(q => (
            <button key={q} onClick={() => { setQuery(q); doSearch(q); }} style={{
              background:t.surfaceAlt, border:`1px solid ${t.border}`, color:t.textSec,
              padding:"4px 11px", borderRadius:"6px", cursor:"pointer", fontSize:"11px", fontFamily:"inherit",
            }}>{q}</button>
          ))}
        </div>
      </Card>

      {searching && <Spinner label="Recherche jurisprudence…" />}
      {error && (
        <div style={{ background:t.dangerBg, border:`1px solid ${t.danger}44`, borderRadius:"8px",
          padding:"12px 16px", marginBottom:"14px", color:t.danger, fontSize:"12px" }}>
          ! {error}
        </div>
      )}
      {!searching && results.length === 0 && query && !error && (
        <EmptyState icon="=" text="Aucun résultat. Reformulez la recherche." />
      )}

      <div style={{ display:"flex", flexDirection:"column", gap:"10px" }}>
        {results.map((r, i) => (
          <Card key={i} style={{ borderLeft:`3px solid ${t.primary}` }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"8px" }}>
              <div style={{ flex:1, paddingRight:"12px" }}>
                <h3 style={{ color:t.text, fontSize:"14px", fontWeight:600, margin:"0 0 6px 0" }}>{r.titre}</h3>
                <div style={{ display:"flex", gap:"5px", flexWrap:"wrap" }}>
                  <Badge label={r.juridiction || "Admin."} color={t.primary} />
                  {r.date && <Badge label={r.date} color={t.textMuted} />}
                  {r.source === "ia-fallback" && <Badge label="IA" color={t.warning} />}
                </div>
              </div>
              {r.url && (
                <a href={r.url} target="_blank" rel="noreferrer"
                  style={{ color:t.primary, fontSize:"11px", textDecoration:"none",
                    whiteSpace:"nowrap", padding:"4px 10px", border:`1px solid ${t.primary}44`,
                    borderRadius:"6px", flexShrink:0 }}>
                  Lire →
                </a>
              )}
            </div>
            {r.extrait && (
              <p style={{ color:t.textSec, fontSize:"13px", lineHeight:"1.6", margin:"0 0 8px 0" }}>{r.extrait}</p>
            )}
            {r.pertinence && (
              <div style={{ background:t.primaryBg, border:`1px solid ${t.primary}33`,
                borderRadius:"6px", padding:"8px 12px" }}>
                <p style={{ color:t.textMuted, fontSize:"10px", fontWeight:600, margin:"0 0 3px 0", textTransform:"uppercase", letterSpacing:"0.05em" }}>Pertinence pour l'opposition</p>
                <p style={{ color:t.primary, fontSize:"12px", margin:0 }}>{r.pertinence}</p>
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

// ── ANALYSES IA ────────────────────────────────────────────────────────────────
function Analyses({ lois, pvs, failles }) {
  const t = useT();
  const [aiPanel, setAiPanel] = useState(null);
  const [custom, setCustom] = useState("");
  const [subTab, setSubTab] = useState("rapide");

  // Patterns
  const [patterns, setPatterns] = useState(null);
  const [loadingPatterns, setLoadingPatterns] = useState(false);

  // Budget
  const [budget, setBudget] = useState(null);
  const [loadingBudget, setLoadingBudget] = useState(false);

  // Fiche séance
  const [ficheDate, setFicheDate] = useState("");
  const [fiche, setFiche] = useState(null);
  const [loadingFiche, setLoadingFiche] = useState(false);

  // Rapport
  const [rapport, setRapport] = useState(null);
  const [loadingRapport, setLoadingRapport] = useState(false);

  const loadPatterns = async () => {
    setLoadingPatterns(true);
    try { setPatterns(await api.analyses.patterns()); }
    catch (e) { setPatterns({ error: e.message }); }
    setLoadingPatterns(false);
  };

  const loadBudget = async () => {
    setLoadingBudget(true);
    try { setBudget(await api.analyses.budget()); }
    catch (e) { setBudget({ error: e.message }); }
    setLoadingBudget(false);
  };

  const loadFiche = async () => {
    if (!ficheDate) return;
    setLoadingFiche(true);
    try { setFiche(await api.analyses.seancePrep(ficheDate)); }
    catch (e) { setFiche({ error: e.message }); }
    setLoadingFiche(false);
  };

  const loadRapport = async () => {
    setLoadingRapport(true);
    try { setRapport(await api.analyses.rapport()); }
    catch (e) { setRapport({ error: e.message }); }
    setLoadingRapport(false);
  };

  return (
    <div>
      {aiPanel && <AIPanel {...aiPanel} onClose={()=>setAiPanel(null)} />}
      <SectionTitle sub="Analyses juridiques et stratégiques assistées par IA">
        Analyses IA
      </SectionTitle>

      <SubTabs
        tabs={[["rapide","Analyses rapides"],["tendances","Tendances"],["budget","Budget"],["fiche","Fiche séance"],["rapport","Rapport citoyen"]]}
        active={subTab} onSelect={setSubTab}
      />

      {subTab === "rapide" && (
        <>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:"10px", marginBottom:"18px" }}>
            {QUICK_IA.map(a=>(
              <Card key={a.label} onClick={()=>setAiPanel({ prompt:a.prompt, context:a.ctx(failles,pvs) })}
                style={{ textAlign:"center", padding:"22px 16px" }}>
                <div style={{ fontSize:"20px", marginBottom:"8px", color:t.primary }}>{a.icon}</div>
                <p style={{ color:t.text, fontSize:"13px", fontWeight:600, margin:"0 0 4px 0" }}>{a.label}</p>
                <p style={{ color:t.textMuted, fontSize:"11px", margin:0 }}>Cliquer pour analyser</p>
              </Card>
            ))}
          </div>

          <Card>
            <p style={{ color:t.primary, fontSize:"12px", fontWeight:700, margin:"0 0 10px 0", textTransform:"uppercase", letterSpacing:"0.06em" }}>
              Analyse personnalisée
            </p>
            <Textarea value={custom} onChange={e=>setCustom(e.target.value)}
              placeholder="Ex: Comment contester la délibération PLU du 06/05 ? Quels délais de recours ?"
              rows={4} style={{ marginBottom:"12px", fontSize:"14px" }} />
            <Btn onClick={()=>custom.trim()&&setAiPanel({
              prompt:custom,
              context:`Commune: ${COMMUNE.nom} (${COMMUNE.cp}). Maire: ${CONSEIL.maire}. PV: ${pvs.length}. Failles: ${failles.length}. Textes surveillés: ${lois.length}.`,
            })} variant="primary" disabled={!custom.trim()}>
              Lancer l'analyse
            </Btn>
          </Card>
        </>
      )}

      {subTab === "tendances" && (
        <div>
          <p style={{ color:t.textSec, fontSize:"13px", lineHeight:"1.6", marginBottom:"16px" }}>
            Analyse les 62 séances (2020-2026) pour détecter les récurrences, thèmes dominants et comportements du conseil.
          </p>
          {!patterns && !loadingPatterns && (
            <Card style={{ textAlign:"center", padding:"40px" }}>
              <p style={{ color:t.textMuted, fontSize:"13px", marginBottom:"16px" }}>
                L'analyse complète prend ~30s (Claude lit tout l'historique)
              </p>
              <Btn onClick={loadPatterns} variant="primary" size="lg">
                Analyser les tendances 2020-2026
              </Btn>
            </Card>
          )}
          {loadingPatterns && <Spinner label="Claude analyse l'historique complet…" />}
          {patterns?.error && (
            <div style={{ background:t.dangerBg, border:`1px solid ${t.danger}44`, borderRadius:"8px", padding:"16px", color:t.danger }}>
              Erreur : {patterns.error}
            </div>
          )}
          {patterns && !patterns.error && (
            <Card>
              <p style={{ color:t.purple, fontSize:"12px", fontWeight:700, margin:"0 0 16px 0", textTransform:"uppercase", letterSpacing:"0.06em" }}>
                Tendances détectées · {patterns.periode || "2020-2026"}
              </p>
              {patterns.text && (
                <div style={{ color:t.textSec, fontSize:"13px", lineHeight:"1.8", whiteSpace:"pre-wrap" }}>
                  {patterns.text}
                </div>
              )}
              {patterns.themes && (
                <>
                  <p style={{ color:t.textMuted, fontSize:"11px", fontWeight:600, margin:"16px 0 8px", textTransform:"uppercase" }}>Thèmes récurrents</p>
                  <div style={{ display:"flex", flexWrap:"wrap", gap:"6px" }}>
                    {patterns.themes.map((th, i) => (
                      <Badge key={i} label={th} color={t.purple} />
                    ))}
                  </div>
                </>
              )}
              {patterns.alertes && patterns.alertes.length > 0 && (
                <>
                  <p style={{ color:t.danger, fontSize:"11px", fontWeight:600, margin:"16px 0 8px", textTransform:"uppercase" }}>Points d'alerte</p>
                  {patterns.alertes.map((a, i) => (
                    <p key={i} style={{ color:t.textSec, fontSize:"13px", margin:"4px 0" }}>• {a}</p>
                  ))}
                </>
              )}
            </Card>
          )}
        </div>
      )}

      {subTab === "budget" && (
        <div>
          <p style={{ color:t.textSec, fontSize:"13px", marginBottom:"16px" }}>
            Extrait les données budgétaires des délibérations analysées par IA et les compare inter-années.
          </p>
          {!budget && !loadingBudget && (
            <Card style={{ textAlign:"center", padding:"40px" }}>
              <p style={{ color:t.textMuted, fontSize:"13px", marginBottom:"16px" }}>
                Nécessite des délibérations budget préalablement analysées
              </p>
              <Btn onClick={loadBudget} variant="primary" size="lg">
                Analyser le budget
              </Btn>
            </Card>
          )}
          {loadingBudget && <Spinner label="Extraction des données budgétaires…" />}
          {budget?.error && (
            <div style={{ background:t.dangerBg, border:`1px solid ${t.danger}44`, borderRadius:"8px", padding:"16px", color:t.danger }}>
              Erreur : {budget.error}
            </div>
          )}
          {budget && !budget.error && (
            <>
              {budget.annees && budget.annees.length > 0 ? (
                <>
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))", gap:"10px", marginBottom:"16px" }}>
                    {budget.annees.map(a => (
                      <Card key={a.annee} style={{ textAlign:"center", padding:"16px" }} hover={false}>
                        <p style={{ color:t.textMuted, fontSize:"11px", margin:"0 0 4px 0" }}>{a.annee}</p>
                        {a.investissement && <p style={{ color:t.primary, fontSize:"13px", fontWeight:700, margin:"0 0 2px 0" }}>
                          Inv: {(a.investissement / 1000).toFixed(0)}k€
                        </p>}
                        {a.fonctionnement && <p style={{ color:t.success, fontSize:"12px", margin:0 }}>
                          Fonc: {(a.fonctionnement / 1000).toFixed(0)}k€
                        </p>}
                      </Card>
                    ))}
                  </div>
                  {budget.analyse && (
                    <Card>
                      <p style={{ color:t.textMuted, fontSize:"11px", fontWeight:600, margin:"0 0 10px 0", textTransform:"uppercase" }}>Analyse IA</p>
                      <div style={{ color:t.textSec, fontSize:"13px", lineHeight:"1.8", whiteSpace:"pre-wrap" }}>
                        {budget.analyse}
                      </div>
                    </Card>
                  )}
                </>
              ) : (
                <Card>
                  <EmptyState icon="$" text={budget.message || "Aucune donnée budgétaire extraite. Analysez d'abord les délibérations budget avec IA."} />
                </Card>
              )}
            </>
          )}
        </div>
      )}

      {subTab === "fiche" && (
        <div>
          <style>{`
            @media print {
              .no-print { display: none !important; }
              .print-area { background: white !important; color: black !important; padding: 20px; }
              .print-area * { color: black !important; border-color: #ccc !important; background: transparent !important; }
            }
          `}</style>
          <p style={{ color:t.textSec, fontSize:"13px", marginBottom:"16px" }}>
            Génère une fiche de préparation imprimable : questions à poser, documents à demander, points de vigilance.
          </p>
          <Card style={{ marginBottom:"16px" }} className="no-print">
            <div style={{ display:"flex", gap:"10px", alignItems:"center" }}>
              <Input type="date" value={ficheDate} onChange={e=>setFicheDate(e.target.value)}
                style={{ maxWidth:"200px" }} />
              <Btn onClick={loadFiche} disabled={!ficheDate || loadingFiche} variant="primary">
                {loadingFiche ? "Génération…" : "Générer la fiche"}
              </Btn>
              {fiche && !fiche.error && (
                <Btn onClick={()=>window.print()} variant="ghost">Imprimer</Btn>
              )}
            </div>
          </Card>
          {loadingFiche && <Spinner label="Claude prépare la fiche séance…" />}
          {fiche?.error && (
            <div style={{ background:t.dangerBg, border:`1px solid ${t.danger}44`, borderRadius:"8px", padding:"16px", color:t.danger }}>
              Erreur : {fiche.error}
            </div>
          )}
          {fiche && !fiche.error && (
            <div className="print-area">
              <Card hover={false}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"16px" }}>
                  <div>
                    <h3 style={{ color:t.text, fontSize:"16px", fontWeight:700, margin:"0 0 4px 0" }}>
                      Fiche séance — {ficheDate}
                    </h3>
                    <p style={{ color:t.textMuted, fontSize:"12px", margin:0 }}>{COMMUNE.nom}</p>
                  </div>
                  <Badge label="Opposition" color={t.primary} />
                </div>
                <div style={{ color:t.textSec, fontSize:"13px", lineHeight:"1.8", whiteSpace:"pre-wrap" }}>
                  {fiche.text || JSON.stringify(fiche, null, 2)}
                </div>
              </Card>
            </div>
          )}
        </div>
      )}

      {subTab === "rapport" && (
        <div>
          <style>{`
            @media print {
              .no-print { display: none !important; }
              .print-rapport { background: white !important; padding: 30px; }
              .print-rapport * { color: black !important; border-color: #ddd !important; background: transparent !important; }
            }
          `}</style>
          <p style={{ color:t.textSec, fontSize:"13px", marginBottom:"16px" }}>
            Génère un rapport citoyen synthétique à diffuser aux habitants — bilan de l'opposition, chiffres-clés, alertes.
          </p>
          <div className="no-print" style={{ display:"flex", gap:"10px", marginBottom:"16px" }}>
            <Btn onClick={loadRapport} disabled={loadingRapport} variant="primary">
              {loadingRapport ? "Génération…" : "Générer le rapport"}
            </Btn>
            {rapport && !rapport.error && (
              <Btn onClick={()=>window.print()} variant="ghost">Imprimer / PDF</Btn>
            )}
          </div>
          {loadingRapport && <Spinner label="Génération du rapport citoyen…" />}
          {rapport?.error && (
            <div style={{ background:t.dangerBg, border:`1px solid ${t.danger}44`, borderRadius:"8px", padding:"16px", color:t.danger }}>
              Erreur : {rapport.error}
            </div>
          )}
          {rapport && !rapport.error && (
            <div className="print-rapport">
              <Card hover={false}>
                <div style={{ borderBottom:`2px solid ${t.primary}`, paddingBottom:"16px", marginBottom:"20px" }}>
                  <h2 style={{ color:t.text, fontSize:"20px", fontWeight:700, margin:"0 0 4px 0" }}>
                    Rapport d'opposition — {COMMUNE.nom}
                  </h2>
                  <p style={{ color:t.textMuted, fontSize:"12px", margin:0 }}>
                    Généré le {new Date().toLocaleDateString("fr-FR")}
                  </p>
                </div>
                <div style={{ color:t.textSec, fontSize:"14px", lineHeight:"1.9", whiteSpace:"pre-wrap" }}>
                  {rapport.text || JSON.stringify(rapport, null, 2)}
                </div>
              </Card>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── HISTORIQUE ─────────────────────────────────────────────────────────────────
function Historique({ pvs, failles }) {
  const t = useT();
  const events = [
    ...pvs.map(p=>({ date:p.date, type:"PV", label:p.objet, statut:p.statut, color:t.purple, auto:p.source==="auto" })),
    ...failles.map(f=>({ date:f.date, type:"Faille", label:f.titre, statut:f.statut, color:graviteColor(t,f.gravite).border })),
  ].sort((a,b)=>new Date(b.date)-new Date(a.date));

  return (
    <div>
      <SectionTitle sub="Chronologie de toutes les séances et irrégularités">
        Historique
      </SectionTitle>
      <div style={{ position:"relative", paddingLeft:"24px" }}>
        <div style={{ position:"absolute", left:"9px", top:0, bottom:0, width:"2px", background:t.border }} />
        {events.map((e,i)=>(
          <div key={i} style={{ display:"flex", marginBottom:"8px", position:"relative" }}>
            <div style={{ position:"absolute", left:"-18px", width:"10px", height:"10px",
              borderRadius:"50%", background:e.color, border:`2px solid ${t.bg}`, marginTop:"14px" }} />
            <Card style={{ flex:1, padding:"10px 14px" }} hover={false}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:"6px" }}>
                <div style={{ display:"flex", gap:"6px", alignItems:"center", flexWrap:"wrap" }}>
                  <Badge label={e.type} color={e.color} />
                  {e.auto && <Badge label="Auto" color={t.purple} />}
                  <span style={{ color:t.text, fontSize:"13px" }}>{e.label}</span>
                </div>
                <div style={{ display:"flex", gap:"6px", alignItems:"center" }}>
                  <Badge label={e.statut} color={statutColor(t,e.statut)} />
                  <span style={{ color:t.textMuted, fontSize:"12px" }}>{e.date}</span>
                </div>
              </div>
            </Card>
          </div>
        ))}
        {events.length===0 && <EmptyState icon="=" text="Aucun événement à afficher." />}
      </div>
    </div>
  );
}

// ── DASHBOARD ──────────────────────────────────────────────────────────────────
function Dashboard({ lois, pvs, failles, setTab }) {
  const t = useT();
  const alertes = failles.filter(f=>["Ouvert","En cours"].includes(f.statut));
  const autoImported = pvs.filter(p=>p.source==="auto");
  const urgentRecours = pvs.filter(p => p.jours_recours !== undefined && p.jours_recours >= 0 && p.jours_recours <= 30);

  const STATS = [
    { label:"Textes surveillés", value:lois.length,          color:t.primary,  icon:"§", tab:"legifrance" },
    { label:"Séances",           value:pvs.length,           color:t.purple,   icon:"≡", tab:"pv" },
    { label:"Failles ouvertes",  value:alertes.length,       color:t.danger,   icon:"!", tab:"failles" },
    { label:"Auto-importées",    value:autoImported.length,  color:t.success,  icon:"↻", tab:"scraper" },
  ];

  return (
    <div>
      <div style={{ marginBottom:"22px" }}>
        <h2 style={{ color:t.text, fontSize:"22px", fontWeight:700, margin:"0 0 4px 0" }}>
          Tableau de bord
        </h2>
        <p style={{ color:t.textMuted, fontSize:"12px", margin:0 }}>
          {COMMUNE.nom} ({COMMUNE.cp}) · Opposition municipale · Maire : {CONSEIL.maire}
        </p>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:"10px", marginBottom:"18px" }}>
        {STATS.map(s=>(
          <Card key={s.label} onClick={()=>setTab(s.tab)}
            style={{ textAlign:"center", padding:"20px 14px", borderTop:`3px solid ${s.color}` }}>
            <div style={{ fontSize:"18px", marginBottom:"6px", color:s.color }}>{s.icon}</div>
            <div style={{ color:s.color, fontSize:"28px", fontWeight:700, lineHeight:1 }}>{s.value}</div>
            <div style={{ color:t.textMuted, fontSize:"11px", marginTop:"6px" }}>{s.label}</div>
          </Card>
        ))}
      </div>

      {urgentRecours.length > 0 && (
        <div style={{ background:t.dangerBg, border:`1px solid ${t.danger}44`, borderRadius:"10px",
          padding:"14px 18px", marginBottom:"14px", cursor:"pointer" }}
          onClick={() => setTab("pv")}>
          <p style={{ color:t.danger, fontSize:"12px", fontWeight:700, margin:"0 0 6px 0" }}>
            Délais de recours urgents ({urgentRecours.length})
          </p>
          <div style={{ display:"flex", flexWrap:"wrap", gap:"6px" }}>
            {urgentRecours.map(p => (
              <span key={p.id} style={{ background:t.dangerBg, border:`1px solid ${t.danger}`, color:t.danger,
                padding:"2px 8px", borderRadius:"4px", fontSize:"11px", fontWeight:600 }}>
                {p.jours_recours}j — {p.date}
              </span>
            ))}
          </div>
        </div>
      )}

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"12px" }}>
        <Card>
          <p style={{ color:t.danger, fontSize:"11px", fontWeight:700, margin:"0 0 12px 0",
            textTransform:"uppercase", letterSpacing:"0.06em" }}>! Alertes actives</p>
          {alertes.length===0
            ? <p style={{ color:t.textMuted, fontSize:"13px" }}>Aucune alerte active.</p>
            : alertes.map(f=>{
              const c = graviteColor(t,f.gravite);
              return (
                <div key={f.id} style={{ padding:"10px 12px", marginBottom:"6px",
                  background:c.bg, border:`1px solid ${c.border}44`, borderRadius:"8px",
                  borderLeft:`3px solid ${c.border}` }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                    <span style={{ color:c.text, fontSize:"13px", fontWeight:600, flex:1, paddingRight:"8px" }}>{f.titre}</span>
                    <Badge label={f.gravite} color={c.border} />
                  </div>
                  <p style={{ color:t.textMuted, fontSize:"11px", margin:"4px 0 0" }}>{f.type} · {f.date}</p>
                </div>
              );
            })
          }
        </Card>

        <Card>
          <p style={{ color:t.primary, fontSize:"11px", fontWeight:700, margin:"0 0 12px 0",
            textTransform:"uppercase", letterSpacing:"0.06em" }}>≡ Dernières séances</p>
          {[...pvs].sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,5).map(pv=>(
            <div key={pv.id} style={{ padding:"8px 12px", marginBottom:"5px", background:t.surfaceAlt,
              border:`1px solid ${t.border}`, borderRadius:"8px",
              borderLeft:`3px solid ${statutColor(t,pv.statut)}` }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                <span style={{ color:t.text, fontSize:"12px", fontWeight:500, flex:1, paddingRight:"8px" }}>
                  {pv.objet}
                </span>
                <Badge label={pv.statut} color={statutColor(t,pv.statut)} />
              </div>
              <div style={{ display:"flex", gap:"6px", alignItems:"center", marginTop:"3px" }}>
                <span style={{ color:t.textMuted, fontSize:"11px" }}>
                  {pv.date}{pv.source==="auto"?" · auto":""}
                  {pv.pdfs?.length > 0 ? ` · ${pv.pdfs.length} PDF` : ""}
                </span>
                <RecoursCountdown jours={pv.jours_recours} limite={pv.recours_limite} />
              </div>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}

// ── SÉANCE LIVE ────────────────────────────────────────────────────────────────
function SeanceLive({ setPvs }) {
  const t = useT();
  const [seances, setSeances] = useState([]);
  const [active, setActive] = useState(null);
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0,10), presents: 15, quorum: 8 });
  const [newPoint, setNewPoint] = useState("");
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [chrono, setChrono] = useState(0);
  const [chronoRunning, setChronoRunning] = useState(false);
  const chronoRef = useRef(null);
  const QUORUM = 8;

  useEffect(() => {
    api.live.list().then(data => {
      setSeances(data);
      const enc = data.find(s => s.statut === "en_cours");
      if (enc) setActive(enc);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (chronoRunning) {
      chronoRef.current = setInterval(() => setChrono(c => c + 1), 1000);
    } else {
      clearInterval(chronoRef.current);
    }
    return () => clearInterval(chronoRef.current);
  }, [chronoRunning]);

  const formatChrono = s => `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;

  const startSeance = async () => {
    setSaving(true);
    try {
      const s = await api.live.create({ date: form.date, presents: +form.presents, quorum: +form.quorum });
      setActive(s); setSeances(prev => [s, ...prev]);
      setChronoRunning(true); setChrono(0);
    } catch (e) { alert(e.message); }
    setSaving(false);
  };

  const updatePresents = async (n) => {
    if (!active) return;
    const updated = await api.live.update(active.id, { presents: n });
    setActive(updated);
  };

  const addPoint = async () => {
    if (!active || !newPoint.trim()) return;
    const pt = await api.live.addPoint(active.id, { titre: newPoint.trim() });
    setActive(prev => ({ ...prev, points: [...(prev.points || []), pt] }));
    setNewPoint("");
  };

  const updatePoint = async (pid, data) => {
    if (!active) return;
    const updated = await api.live.updatePoint(active.id, pid, data);
    setActive(prev => ({
      ...prev,
      points: prev.points.map(p => p.id === pid ? updated : p),
    }));
  };

  const removePoint = async (pid) => {
    if (!active) return;
    await api.live.deletePoint(active.id, pid);
    setActive(prev => ({ ...prev, points: prev.points.filter(p => p.id !== pid) }));
  };

  const exportPv = async () => {
    if (!active) return;
    setExporting(true);
    try {
      const pv = await api.live.export(active.id);
      setPvs(prev => {
        const exists = prev.find(p => p.id === pv.id);
        return exists ? prev.map(p => p.id === pv.id ? pv : p) : [pv, ...prev];
      });
      setActive(prev => ({ ...prev, statut: "terminée" }));
      setChronoRunning(false);
    } catch (e) { alert(e.message); }
    setExporting(false);
  };

  const quorumOk = (active?.presents || 0) >= QUORUM;
  const anomaliesCount = active?.points?.filter(p => p.anomalie).length || 0;

  const RESULTATS = ["adopté", "rejeté", "retiré", "reporté"];
  const RESULT_COLOR = { adopté: t.success, rejeté: t.danger, retiré: t.textMuted, reporté: t.warning };

  if (!active) {
    return (
      <div>
        <SectionTitle sub="Prenez des notes en séance — votes, anomalies, chronologie">
          Séance live
        </SectionTitle>

        <Card style={{ marginBottom:"16px", maxWidth:"480px" }}>
          <p style={{ color:t.primary, fontSize:"12px", fontWeight:700, margin:"0 0 14px 0", textTransform:"uppercase", letterSpacing:"0.06em" }}>
            Démarrer une séance
          </p>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 80px 80px", gap:"10px", marginBottom:"14px" }}>
            <Input type="date" value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))} />
            <Input type="number" value={form.presents} onChange={e=>setForm(f=>({...f,presents:e.target.value}))} placeholder="Présents" />
            <Input type="number" value={form.quorum} onChange={e=>setForm(f=>({...f,quorum:e.target.value}))} placeholder="Quorum" />
          </div>
          <Btn onClick={startSeance} disabled={saving} variant="primary" size="lg" style={{ width:"100%" }}>
            {saving ? "Démarrage…" : "Démarrer la séance"}
          </Btn>
        </Card>

        {seances.filter(s => s.statut === "terminée").length > 0 && (
          <div>
            <p style={{ color:t.textMuted, fontSize:"12px", marginBottom:"10px" }}>Séances archivées</p>
            <div style={{ display:"flex", flexDirection:"column", gap:"6px" }}>
              {seances.filter(s=>s.statut==="terminée").slice(0,5).map(s=>(
                <Card key={s.id} style={{ padding:"10px 14px" }} hover={false}>
                  <div style={{ display:"flex", justifyContent:"space-between" }}>
                    <span style={{ color:t.text, fontSize:"13px" }}>{s.date} — {s.points?.length || 0} point(s)</span>
                    <Badge label="Terminée" color={t.success} />
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      {/* HEADER LIVE */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"16px", flexWrap:"wrap", gap:"10px" }}>
        <div>
          <h2 style={{ color:t.text, fontSize:"20px", fontWeight:700, margin:"0 0 2px 0" }}>
            Séance du {active.date}
          </h2>
          <div style={{ display:"flex", gap:"8px", alignItems:"center", flexWrap:"wrap" }}>
            <Badge label={active.statut === "terminée" ? "Terminée" : "En cours"} color={active.statut === "terminée" ? t.success : t.danger} />
            {anomaliesCount > 0 && <Badge label={`${anomaliesCount} anomalie(s)`} color={t.danger} />}
          </div>
        </div>
        <div style={{ display:"flex", gap:"8px", alignItems:"center" }}>
          {/* CHRONO */}
          <div style={{ background:t.surfaceAlt, border:`1px solid ${t.border}`, borderRadius:"8px",
            padding:"6px 14px", fontFamily:"monospace", fontSize:"18px", fontWeight:700, color:t.text,
            minWidth:"80px", textAlign:"center" }}>
            {formatChrono(chrono)}
          </div>
          <Btn onClick={() => setChronoRunning(r => !r)} variant={chronoRunning ? "warning" : "ghost"} size="sm">
            {chronoRunning ? "Pause" : "Resume"}
          </Btn>
          {active.statut !== "terminée" && (
            <Btn onClick={exportPv} disabled={exporting} variant="success">
              {exporting ? "Export…" : "Terminer + exporter PV"}
            </Btn>
          )}
        </div>
      </div>

      {/* QUORUM */}
      <Card style={{ marginBottom:"14px", borderColor: quorumOk ? t.success+"44" : t.danger+"44",
        borderLeft: `4px solid ${quorumOk ? t.success : t.danger}` }}>
        <div style={{ display:"flex", alignItems:"center", gap:"16px", flexWrap:"wrap" }}>
          <div>
            <p style={{ color:t.textMuted, fontSize:"10px", fontWeight:600, margin:"0 0 2px 0", textTransform:"uppercase" }}>Présents</p>
            <div style={{ display:"flex", gap:"8px", alignItems:"center" }}>
              <Btn onClick={() => updatePresents(Math.max(0, (active.presents||0)-1))} variant="ghost" size="sm">−</Btn>
              <span style={{ color:t.text, fontSize:"22px", fontWeight:700, minWidth:"32px", textAlign:"center" }}>
                {active.presents || 0}
              </span>
              <Btn onClick={() => updatePresents((active.presents||0)+1)} variant="ghost" size="sm">+</Btn>
            </div>
          </div>
          <div style={{ height:"40px", width:"1px", background:t.border }} />
          <div>
            <p style={{ color:t.textMuted, fontSize:"10px", fontWeight:600, margin:"0 0 2px 0", textTransform:"uppercase" }}>Quorum</p>
            <span style={{ color: quorumOk ? t.success : t.danger, fontSize:"14px", fontWeight:700 }}>
              {quorumOk ? `OK (${QUORUM} requis)` : `NON ATTEINT (${QUORUM} requis)`}
            </span>
          </div>
          {!quorumOk && (
            <div style={{ background:t.dangerBg, border:`1px solid ${t.danger}44`, borderRadius:"6px", padding:"6px 12px" }}>
              <span style={{ color:t.danger, fontSize:"12px", fontWeight:600 }}>
                Délibérations invalides sans quorum (CGCT L2121-17)
              </span>
            </div>
          )}
        </div>
      </Card>

      {/* AJOUTER POINT */}
      {active.statut !== "terminée" && (
        <div style={{ display:"flex", gap:"8px", marginBottom:"14px" }}>
          <Input value={newPoint} onChange={e=>setNewPoint(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&addPoint()}
            placeholder="Ajouter un point à l'ordre du jour (Entrée)"
            style={{ flex:1 }} />
          <Btn onClick={addPoint} disabled={!newPoint.trim()} variant="primary">Ajouter</Btn>
        </div>
      )}

      {/* LISTE DES POINTS */}
      <div style={{ display:"flex", flexDirection:"column", gap:"10px" }}>
        {(active.points || []).map((pt, i) => (
          <Card key={pt.id} style={{
            borderLeft:`4px solid ${pt.anomalie ? t.danger : pt.resultat ? RESULT_COLOR[pt.resultat] || t.border : t.border}`
          }} hover={false}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"10px" }}>
              <div style={{ display:"flex", gap:"8px", alignItems:"center", flex:1 }}>
                <span style={{ color:t.textMuted, fontSize:"12px", fontWeight:600, minWidth:"20px" }}>{i+1}.</span>
                <h3 style={{ color:t.text, fontSize:"14px", fontWeight:600, margin:0 }}>{pt.titre}</h3>
                {pt.anomalie > 0 && <Badge label="Anomalie" color={t.danger} />}
                {pt.resultat && <Badge label={pt.resultat} color={RESULT_COLOR[pt.resultat] || t.textMuted} />}
              </div>
              {active.statut !== "terminée" && (
                <button onClick={() => removePoint(pt.id)} style={{ background:"none", border:"none",
                  color:t.textMuted, cursor:"pointer", fontSize:"16px", padding:"0 4px" }}>×</button>
              )}
            </div>

            {active.statut !== "terminée" && (
              <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
                {/* VOTES */}
                <div style={{ display:"flex", gap:"8px", flexWrap:"wrap", alignItems:"center" }}>
                  <span style={{ color:t.textMuted, fontSize:"11px", fontWeight:600, width:"50px" }}>Pour</span>
                  <Input type="number" value={pt.vote_pour || 0}
                    onChange={e => updatePoint(pt.id, { vote_pour: +e.target.value })}
                    style={{ width:"60px", padding:"4px 8px", textAlign:"center" }} />
                  <span style={{ color:t.textMuted, fontSize:"11px", fontWeight:600, width:"50px" }}>Contre</span>
                  <Input type="number" value={pt.vote_contre || 0}
                    onChange={e => updatePoint(pt.id, { vote_contre: +e.target.value })}
                    style={{ width:"60px", padding:"4px 8px", textAlign:"center" }} />
                  <span style={{ color:t.textMuted, fontSize:"11px", fontWeight:600, width:"60px" }}>Abst.</span>
                  <Input type="number" value={pt.vote_abstention || 0}
                    onChange={e => updatePoint(pt.id, { vote_abstention: +e.target.value })}
                    style={{ width:"60px", padding:"4px 8px", textAlign:"center" }} />
                </div>

                {/* RÉSULTAT */}
                <div style={{ display:"flex", gap:"6px", flexWrap:"wrap" }}>
                  {RESULTATS.map(r => (
                    <Btn key={r} size="sm"
                      variant={pt.resultat === r ? "primary" : "ghost"}
                      onClick={() => updatePoint(pt.id, { resultat: pt.resultat === r ? "" : r })}>
                      {r}
                    </Btn>
                  ))}
                  <Btn size="sm"
                    variant={pt.anomalie ? "danger" : "ghost"}
                    onClick={() => updatePoint(pt.id, { anomalie: pt.anomalie ? 0 : 1 })}>
                    {pt.anomalie ? "Anomalie signalée" : "Signaler anomalie"}
                  </Btn>
                </div>

                {/* DESC ANOMALIE */}
                {pt.anomalie > 0 && (
                  <Input value={pt.anomalie_desc || ""} placeholder="Description de l'anomalie…"
                    onChange={e => updatePoint(pt.id, { anomalie_desc: e.target.value })} />
                )}
              </div>
            )}

            {/* RÉSUMÉ si terminée */}
            {active.statut === "terminée" && (
              <div style={{ display:"flex", gap:"12px", fontSize:"12px", color:t.textSec }}>
                {(pt.vote_pour || pt.vote_contre) ? (
                  <span>{pt.vote_pour}p / {pt.vote_contre}c / {pt.vote_abstention}a</span>
                ) : null}
                {pt.anomalie_desc && <span style={{ color:t.danger }}>{pt.anomalie_desc}</span>}
              </div>
            )}
          </Card>
        ))}
        {(active.points || []).length === 0 && (
          <EmptyState icon="≡" text="Ajoutez les points de l'ordre du jour ci-dessus." />
        )}
      </div>
    </div>
  );
}

// ── QUESTIONS & CADA ──────────────────────────────────────────────────────────
function QuestionsCADA() {
  const t = useT();
  const [subTab, setSubTab] = useState("questions");

  // Questions écrites
  const [questions, setQuestions] = useState([]);
  const [qForm, setQForm] = useState({ objet:"", texte:"", sujet_gen:"" });
  const [qLoading, setQLoading] = useState(false);
  const [qGenerating, setQGenerating] = useState(false);
  const [qRelancing, setQRelancing] = useState(null);
  const [qRelanceText, setQRelanceText] = useState(null);
  const [showQForm, setShowQForm] = useState(false);

  // CADA
  const [cadas, setCadas] = useState([]);
  const [cForm, setCForm] = useState({ document_demande:"", motif:"" });
  const [cLoading, setCLoading] = useState(false);
  const [cGenerating, setCGenerating] = useState(false);
  const [generatedLettre, setGeneratedLettre] = useState(null);
  const [showCForm, setShowCForm] = useState(false);

  useEffect(() => {
    api.questions.list().then(setQuestions).catch(()=>{});
    api.cada.list().then(setCadas).catch(()=>{});
  }, []);

  const sendQuestion = async (envoi) => {
    if (!qForm.objet || !qForm.texte) return;
    setQLoading(true);
    try {
      const created = await api.questions.create({
        objet: qForm.objet, texte: qForm.texte,
        date_envoi: envoi ? new Date().toISOString().slice(0,10) : "",
      });
      setQuestions(prev => [created, ...prev]);
      setQForm({ objet:"", texte:"", sujet_gen:"" });
      setShowQForm(false);
    } catch (e) { alert(e.message); }
    setQLoading(false);
  };

  const generateQuestion = async () => {
    if (!qForm.sujet_gen.trim()) return;
    setQGenerating(true);
    try {
      const data = await api.questions.generate({ sujet: qForm.sujet_gen });
      setQForm(f => ({ ...f, objet: data.objet, texte: data.texte }));
    } catch (e) { alert(e.message); }
    setQGenerating(false);
  };

  const relancer = async (id) => {
    setQRelancing(id);
    try {
      const data = await api.questions.relance(id);
      setQRelanceText(data.texte);
      setQuestions(prev => prev.map(q => q.id===id ? {...q, statut:"relance", relances:(q.relances||0)+1} : q));
    } catch (e) { alert(e.message); }
    setQRelancing(null);
  };

  const createCada = async () => {
    if (!cForm.document_demande) return;
    setCLoading(true);
    try {
      const created = await api.cada.create({ ...cForm, date_demande: new Date().toISOString().slice(0,10) });
      setCadas(prev => [created, ...prev]);
      setCForm({ document_demande:"", motif:"" });
      setShowCForm(false);
    } catch (e) { alert(e.message); }
    setCLoading(false);
  };

  const generateCada = async () => {
    if (!cForm.document_demande) return;
    setCGenerating(true);
    try {
      const data = await api.cada.generate({ document_demande: cForm.document_demande, motif: cForm.motif });
      setGeneratedLettre(data.texte);
    } catch (e) { alert(e.message); }
    setCGenerating(false);
  };

  const updateCada = async (id, data) => {
    const updated = await api.cada.update(id, data);
    setCadas(prev => prev.map(c => c.id===id ? updated : c));
  };

  const Q_STATUS = { brouillon:t.textMuted, envoyée:t.primary, réponse_reçue:t.success, relance:t.warning, recours_silencieux:t.danger };
  const C_STATUS = { envoyée:t.primary, reçu:t.success, refusé:t.danger, recours_cada:t.warning, obtenu:t.success };

  return (
    <div>
      <SectionTitle sub="Questions écrites au maire (L2121-26) · Accès aux documents (CADA)">
        Questions & CADA
      </SectionTitle>

      <SubTabs tabs={[["questions",`Questions (${questions.length})`],["cada",`CADA (${cadas.length})`]]}
        active={subTab} onSelect={setSubTab} />

      {subTab === "questions" && (
        <div>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"14px" }}>
            <p style={{ color:t.textSec, fontSize:"12px" }}>
              Délai légal de réponse : 1 mois (CGCT L2121-26). Sans réponse = recours possible.
            </p>
            <Btn onClick={()=>setShowQForm(!showQForm)} variant={showQForm?"ghost":"success"} size="sm">
              {showQForm ? "Annuler" : "+ Nouvelle question"}
            </Btn>
          </div>

          {showQForm && (
            <Card style={{ marginBottom:"16px", borderColor:t.success+"44" }}>
              <p style={{ color:t.success, fontSize:"11px", fontWeight:700, margin:"0 0 12px 0", textTransform:"uppercase" }}>Nouvelle question écrite</p>
              <div style={{ display:"flex", gap:"8px", marginBottom:"10px" }}>
                <Input value={qForm.sujet_gen} onChange={e=>setQForm(f=>({...f,sujet_gen:e.target.value}))}
                  placeholder="Sujet pour génération IA (optionnel)" style={{ flex:1 }} />
                <Btn onClick={generateQuestion} disabled={!qForm.sujet_gen.trim() || qGenerating} variant="purple" size="sm">
                  {qGenerating ? "…" : "Générer avec IA"}
                </Btn>
              </div>
              <Input value={qForm.objet} onChange={e=>setQForm(f=>({...f,objet:e.target.value}))}
                placeholder="Objet de la question" style={{ marginBottom:"8px" }} />
              <Textarea value={qForm.texte} onChange={e=>setQForm(f=>({...f,texte:e.target.value}))}
                placeholder="Corps de la question…" rows={5} style={{ marginBottom:"12px" }} />
              <div style={{ display:"flex", gap:"8px" }}>
                <Btn onClick={()=>sendQuestion(false)} disabled={qLoading||!qForm.objet||!qForm.texte} variant="ghost" size="sm">
                  Sauvegarder brouillon
                </Btn>
                <Btn onClick={()=>sendQuestion(true)} disabled={qLoading||!qForm.objet||!qForm.texte} variant="success" size="sm">
                  Marquer comme envoyée
                </Btn>
              </div>
            </Card>
          )}

          {qRelanceText && (
            <Card style={{ marginBottom:"14px", borderColor:t.warning+"44" }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"8px" }}>
                <p style={{ color:t.warning, fontSize:"11px", fontWeight:700, textTransform:"uppercase" }}>Lettre de relance générée</p>
                <div style={{ display:"flex", gap:"6px" }}>
                  <Btn onClick={()=>{navigator.clipboard.writeText(qRelanceText)}} variant="ghost" size="sm">Copier</Btn>
                  <Btn onClick={()=>setQRelanceText(null)} variant="ghost" size="sm">Fermer</Btn>
                </div>
              </div>
              <div style={{ color:t.textSec, fontSize:"12px", lineHeight:"1.7", whiteSpace:"pre-wrap",
                background:t.surfaceAlt, padding:"12px", borderRadius:"6px" }}>
                {qRelanceText}
              </div>
            </Card>
          )}

          <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
            {questions.length === 0 && <EmptyState icon="?" text="Aucune question écrite. Créez-en une ci-dessus." />}
            {questions.map(q => (
              <Card key={q.id} style={{ borderLeft:`3px solid ${Q_STATUS[q.statut]||t.border}` }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"8px" }}>
                  <div style={{ flex:1, paddingRight:"12px" }}>
                    <h3 style={{ color:t.text, fontSize:"13px", fontWeight:600, margin:"0 0 6px 0" }}>{q.objet}</h3>
                    <div style={{ display:"flex", gap:"5px", flexWrap:"wrap" }}>
                      <Badge label={q.statut} color={Q_STATUS[q.statut]||t.textMuted} />
                      <Badge label={q.base_legale} color={t.textMuted} />
                      {q.relances > 0 && <Badge label={`${q.relances} relance(s)`} color={t.warning} />}
                    </div>
                  </div>
                  <div style={{ textAlign:"right", flexShrink:0 }}>
                    {q.date_envoi && <p style={{ color:t.textMuted, fontSize:"11px" }}>Envoyée : {q.date_envoi}</p>}
                    {q.date_limite_reponse && (
                      <p style={{ color: q.jours_limite < 0 ? t.danger : q.jours_limite < 7 ? t.warning : t.success, fontSize:"11px", fontWeight:600 }}>
                        Limite : {q.date_limite_reponse}
                        {q.jours_limite !== null && ` (${q.jours_limite < 0 ? "expiré" : q.jours_limite + "j"})`}
                      </p>
                    )}
                  </div>
                </div>
                <p style={{ color:t.textSec, fontSize:"12px", lineHeight:"1.6", margin:"0 0 10px 0",
                  maxHeight:"60px", overflow:"hidden" }}>
                  {q.texte.slice(0, 200)}{q.texte.length > 200 ? "…" : ""}
                </p>
                <div style={{ display:"flex", gap:"6px", flexWrap:"wrap" }}>
                  {q.statut !== "brouillon" && q.statut !== "réponse_reçue" && (
                    <Btn onClick={()=>relancer(q.id)} disabled={qRelancing===q.id} variant="warning" size="sm">
                      {qRelancing===q.id ? "…" : "Générer relance"}
                    </Btn>
                  )}
                  {q.statut !== "réponse_reçue" && (
                    <Btn onClick={()=>{
                      api.questions.update(q.id, { statut:"réponse_reçue", date_reponse:new Date().toISOString().slice(0,10) })
                        .then(u => setQuestions(prev => prev.map(x=>x.id===q.id?u:x)));
                    }} variant="success" size="sm">Réponse reçue</Btn>
                  )}
                  {q.statut === "brouillon" && (
                    <Btn onClick={()=>{
                      api.questions.update(q.id, { statut:"envoyée", date_envoi:new Date().toISOString().slice(0,10) })
                        .then(u => setQuestions(prev => prev.map(x=>x.id===q.id?u:x)));
                    }} variant="primary" size="sm">Marquer envoyée</Btn>
                  )}
                  <Btn onClick={()=>{navigator.clipboard.writeText(q.texte)}} variant="ghost" size="sm">Copier</Btn>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {subTab === "cada" && (
        <div>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"14px" }}>
            <p style={{ color:t.textSec, fontSize:"12px" }}>
              Délai légal : 1 mois. Silence = refus tacite → saisine CADA possible (CRPA L311-1).
            </p>
            <Btn onClick={()=>setShowCForm(!showCForm)} variant={showCForm?"ghost":"success"} size="sm">
              {showCForm ? "Annuler" : "+ Nouvelle demande"}
            </Btn>
          </div>

          {showCForm && (
            <Card style={{ marginBottom:"16px", borderColor:t.success+"44" }}>
              <p style={{ color:t.success, fontSize:"11px", fontWeight:700, margin:"0 0 12px 0", textTransform:"uppercase" }}>Nouvelle demande CADA</p>
              <Input value={cForm.document_demande} onChange={e=>setCForm(f=>({...f,document_demande:e.target.value}))}
                placeholder="Document demandé (ex: délibération du 15/03, contrat marché X…)" style={{ marginBottom:"8px" }} />
              <Textarea value={cForm.motif} onChange={e=>setCForm(f=>({...f,motif:e.target.value}))}
                placeholder="Motif / contexte (optionnel)" rows={2} style={{ marginBottom:"12px" }} />
              <div style={{ display:"flex", gap:"8px", flexWrap:"wrap" }}>
                <Btn onClick={createCada} disabled={cLoading||!cForm.document_demande} variant="success" size="sm">
                  Enregistrer la demande
                </Btn>
                <Btn onClick={generateCada} disabled={cGenerating||!cForm.document_demande} variant="purple" size="sm">
                  {cGenerating ? "…" : "Générer lettre CADA"}
                </Btn>
              </div>
              {generatedLettre && (
                <div style={{ marginTop:"12px", background:t.surfaceAlt, borderRadius:"8px", padding:"12px" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"6px" }}>
                    <span style={{ color:t.textMuted, fontSize:"11px" }}>Lettre générée</span>
                    <Btn onClick={()=>navigator.clipboard.writeText(generatedLettre)} variant="ghost" size="sm">Copier</Btn>
                  </div>
                  <div style={{ color:t.textSec, fontSize:"11px", lineHeight:"1.7", whiteSpace:"pre-wrap", maxHeight:"200px", overflowY:"auto" }}>
                    {generatedLettre}
                  </div>
                </div>
              )}
            </Card>
          )}

          <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
            {cadas.length === 0 && <EmptyState icon="=" text="Aucune demande CADA. Créez-en une ci-dessus." />}
            {cadas.map(c => (
              <Card key={c.id} style={{ borderLeft:`3px solid ${C_STATUS[c.statut]||t.border}` }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"6px" }}>
                  <div style={{ flex:1, paddingRight:"12px" }}>
                    <h3 style={{ color:t.text, fontSize:"13px", fontWeight:600, margin:"0 0 5px 0" }}>{c.document_demande}</h3>
                    <Badge label={c.statut} color={C_STATUS[c.statut]||t.textMuted} />
                  </div>
                  <div style={{ textAlign:"right", flexShrink:0 }}>
                    <p style={{ color:t.textMuted, fontSize:"11px" }}>Demande : {c.date_demande}</p>
                    {c.date_limite && (
                      <p style={{ color: c.jours_limite < 0 ? t.danger : c.jours_limite < 7 ? t.warning : t.success,
                        fontSize:"11px", fontWeight:600 }}>
                        Limite : {c.date_limite}
                        {c.jours_limite !== null && ` (${c.jours_limite < 0 ? "expiré" : c.jours_limite+"j"})`}
                      </p>
                    )}
                  </div>
                </div>
                {c.motif && <p style={{ color:t.textMuted, fontSize:"12px", marginBottom:"8px" }}>{c.motif}</p>}
                <div style={{ display:"flex", gap:"6px", flexWrap:"wrap" }}>
                  {["reçu","refusé","obtenu","recours_cada"].map(s => (
                    <Btn key={s} size="sm" variant={c.statut===s?"primary":"ghost"}
                      onClick={()=>updateCada(c.id, { statut:s, date_reponse:new Date().toISOString().slice(0,10) })}>
                      {s}
                    </Btn>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── AGENDA & PRÉPARATION ──────────────────────────────────────────────────────
function AgendaPrep() {
  const t = useT();
  const [subTab, setSubTab] = useState("predict");
  const [predicting, setPredicting] = useState(false);
  const [prediction, setPrediction] = useState(null);
  const [checking, setChecking] = useState(false);
  const [currentAgenda, setCurrentAgenda] = useState(null);
  const [benchLoading, setBenchLoading] = useState(false);
  const [bench, setBench] = useState(null);
  const [benchAnalyse, setBenchAnalyse] = useState(null);
  const [benchAnalyseLoading, setBenchAnalyseLoading] = useState(false);

  const predict = async () => {
    setPredicting(true);
    try { setPrediction(await api.agenda.predict()); }
    catch (e) { setPrediction({ error: e.message }); }
    setPredicting(false);
  };

  const checkCurrent = async () => {
    setChecking(true);
    try { setCurrentAgenda(await api.agenda.current()); }
    catch (e) { setCurrentAgenda({ items:[], found:false }); }
    setChecking(false);
  };

  const loadBench = async () => {
    setBenchLoading(true);
    try { setBench(await api.benchmark.compare()); }
    catch (e) { setBench({ error: e.message }); }
    setBenchLoading(false);
  };

  const loadBenchAnalyse = async () => {
    setBenchAnalyseLoading(true);
    try { setBenchAnalyse(await api.benchmark.analyse()); }
    catch (e) { setBenchAnalyse({ error: e.message }); }
    setBenchAnalyseLoading(false);
  };

  const PC = { haute: t.danger, moyenne: t.warning, faible: t.success };

  return (
    <div>
      <SectionTitle sub="Prédiction IA de l'agenda · Benchmark financier communes similaires">
        Agenda & Benchmark
      </SectionTitle>

      <SubTabs
        tabs={[["predict","Prédiction agenda"],["current","Ordre du jour actuel"],["benchmark","Benchmark financier"]]}
        active={subTab} onSelect={setSubTab}
      />

      {subTab === "predict" && (
        <div>
          <p style={{ color:t.textSec, fontSize:"13px", lineHeight:"1.6", marginBottom:"16px" }}>
            Claude analyse l'historique 2020-2026 et prédit les points probables de la prochaine séance avec les questions à poser.
          </p>
          {!prediction && !predicting && (
            <Card style={{ textAlign:"center", padding:"40px" }}>
              <Btn onClick={predict} variant="primary" size="lg">Prédire l'agenda de la prochaine séance</Btn>
            </Card>
          )}
          {predicting && <Spinner label="Claude analyse l'historique des séances…" />}
          {prediction?.error && (
            <div style={{ background:t.dangerBg, border:`1px solid ${t.danger}44`, borderRadius:"8px", padding:"16px", color:t.danger }}>
              Erreur : {prediction.error}
            </div>
          )}
          {prediction && !prediction.error && (
            <div>
              <Card style={{ marginBottom:"14px", borderLeft:`3px solid ${t.primary}` }}>
                <p style={{ color:t.textMuted, fontSize:"11px", margin:"0 0 4px 0", textTransform:"uppercase" }}>Date probable</p>
                <p style={{ color:t.text, fontSize:"16px", fontWeight:700, margin:"0 0 10px 0" }}>
                  {prediction.date_probable || "Indéterminée"}
                </p>
                {prediction.ouverture_recommandee && (
                  <div style={{ background:t.primaryBg, border:`1px solid ${t.primary}33`, borderRadius:"6px", padding:"10px" }}>
                    <p style={{ color:t.textMuted, fontSize:"10px", fontWeight:600, margin:"0 0 4px 0", textTransform:"uppercase" }}>Ouverture recommandée</p>
                    <p style={{ color:t.primary, fontSize:"12px", margin:0, fontStyle:"italic" }}>
                      "{prediction.ouverture_recommandee}"
                    </p>
                  </div>
                )}
              </Card>

              {prediction.vigilances?.length > 0 && (
                <div style={{ background:t.warningBg, border:`1px solid ${t.warning}44`, borderRadius:"8px",
                  padding:"12px 16px", marginBottom:"14px" }}>
                  <p style={{ color:t.warning, fontSize:"11px", fontWeight:700, margin:"0 0 8px 0", textTransform:"uppercase" }}>Points de vigilance</p>
                  {prediction.vigilances.map((v, i) => (
                    <p key={i} style={{ color:t.textSec, fontSize:"12px", margin:"3px 0" }}>• {v}</p>
                  ))}
                </div>
              )}

              <div style={{ display:"flex", flexDirection:"column", gap:"10px" }}>
                {(prediction.points_probables || []).map((pt, i) => (
                  <Card key={i} style={{ borderLeft:`3px solid ${PC[pt.probabilite]||t.border}` }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"8px" }}>
                      <h3 style={{ color:t.text, fontSize:"13px", fontWeight:600, margin:0, flex:1, paddingRight:"10px" }}>{pt.titre}</h3>
                      <Badge label={pt.probabilite} color={PC[pt.probabilite]||t.textMuted} />
                    </div>
                    <p style={{ color:t.textSec, fontSize:"12px", margin:"0 0 10px 0" }}>{pt.raison}</p>
                    {pt.questions_a_poser?.length > 0 && (
                      <div style={{ background:t.surfaceAlt, borderRadius:"6px", padding:"8px 12px", marginBottom:"6px" }}>
                        <p style={{ color:t.textMuted, fontSize:"10px", fontWeight:600, margin:"0 0 5px 0", textTransform:"uppercase" }}>Questions à poser</p>
                        {pt.questions_a_poser.map((q, j) => (
                          <p key={j} style={{ color:t.textSec, fontSize:"12px", margin:"2px 0" }}>• {q}</p>
                        ))}
                      </div>
                    )}
                    {pt.documents_a_demander?.length > 0 && (
                      <div>
                        <p style={{ color:t.textMuted, fontSize:"10px", fontWeight:600, margin:"0 0 4px 0", textTransform:"uppercase" }}>Documents à demander</p>
                        {pt.documents_a_demander.map((d, j) => (
                          <p key={j} style={{ color:t.primary, fontSize:"12px", margin:"2px 0" }}>→ {d}</p>
                        ))}
                      </div>
                    )}
                    {pt.base_legale && <Badge label={pt.base_legale} color={t.textMuted} />}
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {subTab === "current" && (
        <div>
          <p style={{ color:t.textSec, fontSize:"13px", marginBottom:"16px" }}>
            Scrape le site mairie pour trouver l'ordre du jour publié (obligatoire 5 jours avant — CGCT L2121-10).
          </p>
          {!currentAgenda && (
            <Card style={{ textAlign:"center", padding:"40px" }}>
              <Btn onClick={checkCurrent} disabled={checking} variant="primary">
                {checking ? "Recherche…" : "Chercher l'ordre du jour sur le site mairie"}
              </Btn>
            </Card>
          )}
          {checking && <Spinner label="Scraping du site mairie…" />}
          {currentAgenda && (
            <div>
              {currentAgenda.found ? (
                <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
                  {currentAgenda.items.map((item, i) => (
                    <Card key={i}>
                      <p style={{ color:t.text, fontSize:"13px", margin:"0 0 4px 0" }}>{item.titre}</p>
                      {item.url && (
                        <a href={item.url} target="_blank" rel="noreferrer"
                          style={{ color:t.primary, fontSize:"11px" }}>Voir sur le site →</a>
                      )}
                    </Card>
                  ))}
                </div>
              ) : (
                <Card>
                  <EmptyState icon="=" text="Aucun ordre du jour trouvé sur le site mairie. Il n'est peut-être pas encore publié." />
                  <div style={{ textAlign:"center", marginTop:"10px" }}>
                    <a href="https://fleurieuxsurlarbresle.fr" target="_blank" rel="noreferrer"
                      style={{ color:t.primary, fontSize:"12px" }}>Vérifier manuellement →</a>
                  </div>
                </Card>
              )}
            </div>
          )}
        </div>
      )}

      {subTab === "benchmark" && (
        <div>
          <p style={{ color:t.textSec, fontSize:"13px", marginBottom:"16px" }}>
            Données OFGL (Observatoire des Finances Locales) — Fleurieux vs communes similaires du Rhône (1500-3500 hab).
          </p>
          {!bench && (
            <Card style={{ textAlign:"center", padding:"40px" }}>
              <Btn onClick={loadBench} disabled={benchLoading} variant="primary">
                {benchLoading ? "Chargement OFGL…" : "Charger le benchmark financier"}
              </Btn>
            </Card>
          )}
          {benchLoading && <Spinner label="Fetch data.ofgl.fr…" />}
          {bench?.error && (
            <div style={{ background:t.dangerBg, border:`1px solid ${t.danger}44`, borderRadius:"8px", padding:"16px", color:t.danger }}>
              {bench.error}
            </div>
          )}
          {bench && !bench.error && (
            <div>
              <p style={{ color:t.textMuted, fontSize:"11px", marginBottom:"12px" }}>Données {bench.annee} · {bench.similaires_count} communes comparables</p>

              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"12px", marginBottom:"14px" }}>
                {[
                  { label:"Dépenses fonct./hab", key:"depenses_fonctionnement_hbt", unit:"€" },
                  { label:"Recettes fonct./hab", key:"recettes_fonctionnement_hbt", unit:"€" },
                  { label:"Investissement/hab", key:"depenses_investissement_hbt", unit:"€" },
                  { label:"Encours dette/hab", key:"encours_dette_hbt", unit:"€" },
                ].map(({ label, key, unit }) => {
                  const flVal = bench.fleurieux_last?.[key];
                  const moyVal = bench.moyennes?.[key];
                  const diff = flVal && moyVal ? Math.round(((flVal - moyVal) / moyVal) * 100) : null;
                  return (
                    <Card key={key} hover={false} style={{ padding:"14px" }}>
                      <p style={{ color:t.textMuted, fontSize:"11px", margin:"0 0 6px 0" }}>{label}</p>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end" }}>
                        <div>
                          <p style={{ color:t.text, fontSize:"20px", fontWeight:700, margin:0 }}>
                            {flVal != null ? Math.round(flVal) + unit : "—"}
                          </p>
                          <p style={{ color:t.textMuted, fontSize:"11px", margin:"2px 0 0" }}>
                            Moy : {moyVal != null ? Math.round(moyVal) + unit : "—"}
                          </p>
                        </div>
                        {diff !== null && (
                          <Badge label={`${diff > 0 ? "+" : ""}${diff}%`}
                            color={Math.abs(diff) > 20 ? t.danger : Math.abs(diff) > 10 ? t.warning : t.success} />
                        )}
                      </div>
                    </Card>
                  );
                })}
              </div>

              {!benchAnalyse && (
                <Btn onClick={loadBenchAnalyse} disabled={benchAnalyseLoading} variant="outline">
                  {benchAnalyseLoading ? "Analyse IA…" : "Analyser avec Claude"}
                </Btn>
              )}
              {benchAnalyseLoading && <Spinner label="Analyse IA du benchmark…" />}
              {benchAnalyse && !benchAnalyse.error && (
                <Card>
                  <p style={{ color:t.purple, fontSize:"11px", fontWeight:700, margin:"0 0 12px 0", textTransform:"uppercase" }}>Analyse IA</p>
                  <div style={{ color:t.textSec, fontSize:"13px", lineHeight:"1.8", whiteSpace:"pre-wrap" }}>
                    {benchAnalyse.analyse}
                  </div>
                </Card>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── ADMIN ──────────────────────────────────────────────────────────────────────
function AdminPanel() {
  const t = useContext(ThemeCtx);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  useEffect(() => {
    fetch("/api/admin/usage")
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setErr(e.message); setLoading(false); });
  }, []);

  if (loading) return <Spinner label="Chargement…" />;
  if (err) return <p style={{ color:t.danger, fontSize:"13px" }}>Erreur : {err}</p>;

  const fmt = n => (n ?? 0).toLocaleString("fr-FR");
  const fmtUsd = n => `$${((n ?? 0)).toFixed(4)}`;
  const fmtUsdLarge = n => `$${((n ?? 0)).toFixed(6)}`;

  const { total, byModel, byRoute, byDay, recent } = data;

  return (
    <div style={{ maxWidth:"900px", margin:"0 auto" }}>
      <SectionTitle>Coûts API Anthropic</SectionTitle>

      {/* Résumé global */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))", gap:"12px", marginBottom:"24px" }}>
        {[
          { label:"Appels total",      value: fmt(total.calls) },
          { label:"Tokens entrée",     value: fmt(total.input) },
          { label:"Tokens sortie",     value: fmt(total.output) },
          { label:"Coût total (USD)",  value: fmtUsd(total.cost), big:true },
        ].map(s => (
          <Card key={s.label} style={{ textAlign:"center" }}>
            <div style={{ fontSize: s.big ? "22px" : "20px", fontWeight:700,
              color: s.big ? t.danger : t.primary, fontVariantNumeric:"tabular-nums" }}>
              {s.value}
            </div>
            <div style={{ fontSize:"11px", color:t.textMuted, marginTop:"4px" }}>{s.label}</div>
          </Card>
        ))}
      </div>

      {/* Par modèle */}
      <Card style={{ marginBottom:"20px" }}>
        <h3 style={{ fontSize:"13px", fontWeight:600, color:t.text, marginBottom:"12px" }}>Par modèle</h3>
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:"12px" }}>
          <thead>
            <tr style={{ color:t.textMuted, textAlign:"left" }}>
              {["Modèle","Appels","Tokens in","Tokens out","Coût USD"].map(h => (
                <th key={h} style={{ padding:"4px 8px", borderBottom:`1px solid ${t.border}` }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {byModel.map(r => (
              <tr key={r.model} style={{ borderBottom:`1px solid ${t.borderMid}` }}>
                <td style={{ padding:"6px 8px", color:t.text, fontFamily:"monospace" }}>{r.model}</td>
                <td style={{ padding:"6px 8px", color:t.textMuted }}>{fmt(r.calls)}</td>
                <td style={{ padding:"6px 8px", color:t.textMuted }}>{fmt(r.input)}</td>
                <td style={{ padding:"6px 8px", color:t.textMuted }}>{fmt(r.output)}</td>
                <td style={{ padding:"6px 8px", color:t.danger, fontWeight:600 }}>{fmtUsd(r.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* Par route */}
      <Card style={{ marginBottom:"20px" }}>
        <h3 style={{ fontSize:"13px", fontWeight:600, color:t.text, marginBottom:"12px" }}>Par fonctionnalité</h3>
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:"12px" }}>
          <thead>
            <tr style={{ color:t.textMuted, textAlign:"left" }}>
              {["Route","Appels","Coût USD"].map(h => (
                <th key={h} style={{ padding:"4px 8px", borderBottom:`1px solid ${t.border}` }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {byRoute.map(r => (
              <tr key={r.route} style={{ borderBottom:`1px solid ${t.borderMid}` }}>
                <td style={{ padding:"6px 8px", color:t.text, fontFamily:"monospace" }}>{r.route}</td>
                <td style={{ padding:"6px 8px", color:t.textMuted }}>{fmt(r.calls)}</td>
                <td style={{ padding:"6px 8px", color:t.danger, fontWeight:600 }}>{fmtUsd(r.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* Historique 30 jours */}
      {byDay.length > 0 && (
        <Card style={{ marginBottom:"20px" }}>
          <h3 style={{ fontSize:"13px", fontWeight:600, color:t.text, marginBottom:"12px" }}>Historique (30 j.)</h3>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:"12px" }}>
            <thead>
              <tr style={{ color:t.textMuted, textAlign:"left" }}>
                {["Jour","Appels","Coût USD"].map(h => (
                  <th key={h} style={{ padding:"4px 8px", borderBottom:`1px solid ${t.border}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {byDay.map(r => (
                <tr key={r.day} style={{ borderBottom:`1px solid ${t.borderMid}` }}>
                  <td style={{ padding:"6px 8px", color:t.text }}>{r.day}</td>
                  <td style={{ padding:"6px 8px", color:t.textMuted }}>{fmt(r.calls)}</td>
                  <td style={{ padding:"6px 8px", color:t.danger, fontWeight:600 }}>{fmtUsd(r.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* Appels récents */}
      <Card>
        <h3 style={{ fontSize:"13px", fontWeight:600, color:t.text, marginBottom:"12px" }}>50 derniers appels</h3>
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:"11px" }}>
          <thead>
            <tr style={{ color:t.textMuted, textAlign:"left" }}>
              {["Date","Route","Modèle","In","Out","Coût"].map(h => (
                <th key={h} style={{ padding:"4px 6px", borderBottom:`1px solid ${t.border}` }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {recent.map(r => (
              <tr key={r.id} style={{ borderBottom:`1px solid ${t.borderMid}` }}>
                <td style={{ padding:"4px 6px", color:t.textMuted, whiteSpace:"nowrap" }}>{r.called_at?.slice(0,16)}</td>
                <td style={{ padding:"4px 6px", color:t.text, fontFamily:"monospace" }}>{r.route}</td>
                <td style={{ padding:"4px 6px", color:t.textMuted, fontFamily:"monospace" }}>{r.model?.replace("claude-","")}</td>
                <td style={{ padding:"4px 6px", color:t.textMuted }}>{fmt(r.input_tokens)}</td>
                <td style={{ padding:"4px 6px", color:t.textMuted }}>{fmt(r.output_tokens)}</td>
                <td style={{ padding:"4px 6px", color:t.danger }}>{fmtUsdLarge(r.cost_usd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {recent.length === 0 && (
          <p style={{ color:t.textMuted, fontSize:"12px", textAlign:"center", padding:"20px" }}>
            Aucun appel enregistré — le tracking démarre maintenant.
          </p>
        )}
      </Card>
    </div>
  );
}

// ── TABS ───────────────────────────────────────────────────────────────────────
const TABS = [
  { id:"dashboard",      label:"Tableau de bord", icon:"⬡" },
  { id:"seance-live",    label:"Séance live",      icon:"●" },
  { id:"pv",             label:"Procès-verbaux",   icon:"≡" },
  { id:"questions",      label:"Questions & CADA", icon:"?" },
  { id:"agenda",         label:"Agenda",           icon:"+" },
  { id:"failles",        label:"Failles",          icon:"!" },
  { id:"jurisprudence",  label:"Jurisprudence",    icon:"=" },
  { id:"legifrance",     label:"Légifrance",       icon:"§" },
  { id:"analyses",       label:"Analyses IA",      icon:"◈" },
  { id:"scraper",        label:"Sync Mairie",      icon:"↻" },
  { id:"historique",     label:"Historique",       icon:"⌛" },
  { id:"admin",          label:"Admin",            icon:"$" },
];

// ── APP ────────────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState("dashboard");
  const [lois, setLois] = useState([]);
  const [pvs, setPvs] = useState([]);
  const [failles, setFailles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [darkMode, setDarkMode] = useState(() => {
    try { return localStorage.getItem("theme") !== "light"; } catch { return true; }
  });

  const theme = darkMode ? DARK : LIGHT;

  const toggleTheme = () => {
    setDarkMode(d => {
      try { localStorage.setItem("theme", d ? "light" : "dark"); } catch {}
      return !d;
    });
  };

  const loadAll = useCallback(async () => {
    setLoading(true); setLoadError(null);
    try {
      const [p,f,l] = await Promise.all([api.pvs.list(), api.failles.list(), api.lois.list()]);
      setPvs(p); setFailles(f); setLois(l);
    } catch(err) { setLoadError(err.message); }
    setLoading(false);
  }, []);

  useEffect(()=>{ loadAll(); }, [loadAll]);

  // PWA — enregistrer push subscription si VAPID dispo
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    api.push.vapidKey().then(({ publicKey }) => {
      if (!publicKey) return;
      navigator.serviceWorker.ready.then(async sw => {
        try {
          const existing = await sw.pushManager.getSubscription();
          if (existing) return; // déjà abonné
          const sub = await sw.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey),
          });
          await api.push.subscribe({ endpoint: sub.endpoint, keys: { p256dh: btoa(String.fromCharCode(...new Uint8Array(sub.getKey("p256dh")))), auth: btoa(String.fromCharCode(...new Uint8Array(sub.getKey("auth")))) } });
        } catch (_) {}
      });
    }).catch(() => {});
  }, []);

  const alertCount = failles.filter(f=>f.statut==="Ouvert").length;
  const urgentCount = pvs.filter(p => p.jours_recours !== undefined && p.jours_recours >= 0 && p.jours_recours <= 10).length;

  const renderContent = () => {
    if (loading) return <Spinner label="Chargement des données…" />;
    if (loadError) return (
      <div style={{ background:theme.dangerBg, border:`1px solid ${theme.danger}55`, borderRadius:"10px",
        padding:"16px 20px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <span style={{ color:theme.danger, fontSize:"13px" }}>! Impossible de joindre le serveur : {loadError}</span>
        <Btn onClick={loadAll} variant="danger" size="sm">Réessayer</Btn>
      </div>
    );
    switch(tab) {
      case "dashboard":     return <Dashboard lois={lois} pvs={pvs} failles={failles} setTab={setTab} />;
      case "seance-live":   return <SeanceLive setPvs={setPvs} />;
      case "pv":            return <ProcessVerbaux pvs={pvs} setPvs={setPvs} />;
      case "questions":     return <QuestionsCADA />;
      case "agenda":        return <AgendaPrep />;
      case "failles":       return <Failles failles={failles} setFailles={setFailles} />;
      case "jurisprudence": return <Jurisprudence />;
      case "legifrance":    return <VeilleLegifrance lois={lois} setLois={setLois} />;
      case "analyses":      return <Analyses lois={lois} pvs={pvs} failles={failles} />;
      case "scraper":       return <SyncMairie onImport={imp=>setPvs(prev=>[...prev,...imp])} />;
      case "historique":    return <Historique pvs={pvs} failles={failles} />;
      case "admin":         return <AdminPanel />;
      default: return null;
    }
  };

  return (
    <ThemeCtx.Provider value={theme}>
      <div style={{ minHeight:"100vh", background:theme.bg, color:theme.text,
        fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif" }}>
        <style>{`
          * { box-sizing:border-box; margin:0; padding:0; }
          ::-webkit-scrollbar { width:4px; }
          ::-webkit-scrollbar-track { background:transparent; }
          ::-webkit-scrollbar-thumb { background:${theme.border}; border-radius:3px; }
          input::placeholder, textarea::placeholder { color:${theme.textMuted}; }
          input, textarea, button, select { outline:none; }
          @keyframes spin { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }
        `}</style>

        <div style={{ background:theme.nav, borderBottom:`1px solid ${theme.navBorder}`,
          padding:"0 24px", position:"sticky", top:0, zIndex:50,
          boxShadow:`0 1px 4px rgba(0,0,0,${theme.mode==="dark"?0.3:0.06})` }}>
          <div style={{ maxWidth:"1200px", margin:"0 auto",
            display:"flex", justifyContent:"space-between", alignItems:"center", height:"56px" }}>

            <div style={{ display:"flex", alignItems:"center", gap:"12px" }}>
              <div style={{ width:"32px", height:"32px", background:theme.primaryBg,
                border:`1.5px solid ${theme.primary}`, borderRadius:"8px",
                display:"flex", alignItems:"center", justifyContent:"center",
                color:theme.primary, fontSize:"16px", fontWeight:700 }}>⬡</div>
              <div>
                <div style={{ color:theme.text, fontSize:"14px", fontWeight:700, lineHeight:1.2 }}>
                  Opposition Municipale
                </div>
                <div style={{ color:theme.textMuted, fontSize:"10px", letterSpacing:"0.08em", textTransform:"uppercase" }}>
                  Fleurieux-sur-l'Arbresle · 69210
                </div>
              </div>
            </div>

            <div style={{ display:"flex", alignItems:"center", gap:"8px" }}>
              {urgentCount > 0 && (
                <div style={{ background:theme.dangerBg, border:`1px solid ${theme.danger}55`,
                  borderRadius:"6px", padding:"4px 10px", cursor:"pointer" }}
                  onClick={()=>setTab("pv")}>
                  <span style={{ color:theme.danger, fontSize:"12px", fontWeight:600 }}>
                    ! {urgentCount} recours urgent{urgentCount>1?"s":""}
                  </span>
                </div>
              )}
              {alertCount > 0 && (
                <div style={{ background:theme.warningBg, border:`1px solid ${theme.warning}55`,
                  borderRadius:"6px", padding:"4px 10px", cursor:"pointer" }}
                  onClick={()=>setTab("failles")}>
                  <span style={{ color:theme.warning, fontSize:"12px", fontWeight:600 }}>
                    ! {alertCount} faille{alertCount>1?"s":""}
                  </span>
                </div>
              )}
              <button onClick={toggleTheme} style={{
                background:theme.surfaceAlt, border:`1px solid ${theme.border}`,
                color:theme.textSec, width:"34px", height:"34px", borderRadius:"8px",
                cursor:"pointer", fontSize:"16px", display:"flex",
                alignItems:"center", justifyContent:"center",
              }}>
                {darkMode ? "☀" : "☾"}
              </button>
            </div>
          </div>
        </div>

        <div style={{ background:theme.nav, borderBottom:`1px solid ${theme.navBorder}`, padding:"0 24px" }}>
          <div style={{ maxWidth:"1200px", margin:"0 auto", display:"flex", overflowX:"auto",
            WebkitOverflowScrolling:"touch" }}>
            {TABS.map(t=>(
              <button key={t.id} onClick={()=>setTab(t.id)} style={{
                background:"none", border:"none",
                borderBottom:`2px solid ${tab===t.id?theme.primary:"transparent"}`,
                color:tab===t.id?theme.text:theme.textMuted,
                padding:"12px 14px", cursor:"pointer", fontSize:"13px",
                fontWeight:tab===t.id?600:400, fontFamily:"inherit",
                display:"flex", alignItems:"center", gap:"6px", whiteSpace:"nowrap",
                transition:"color 0.15s", marginBottom:"-1px",
              }}>
                {t.icon} {t.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ maxWidth:"1200px", margin:"0 auto", padding:"24px" }}>
          {renderContent()}
        </div>
      </div>
    </ThemeCtx.Provider>
  );
}
