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
  { id:"LODA_ETAT", label:"Légifrance général" },
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

function ConfirmModal({ title, message, onConfirm, onCancel, confirmLabel="Oui", cancelLabel="Non" }) {
  const t = useT();
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", zIndex:1000,
      display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div style={{ background:t.surface, border:`1px solid ${t.border}`, borderRadius:"12px",
        padding:"24px", maxWidth:"420px", width:"90%", boxShadow:"0 8px 32px rgba(0,0,0,0.3)" }}>
        <h3 style={{ color:t.text, fontSize:"16px", fontWeight:700, margin:"0 0 12px 0" }}>{title}</h3>
        <p style={{ color:t.textMuted, fontSize:"13px", margin:"0 0 20px 0", lineHeight:1.5 }}>{message}</p>
        <div style={{ display:"flex", gap:"10px", justifyContent:"flex-end" }}>
          <Btn variant="ghost" onClick={onCancel}>{cancelLabel}</Btn>
          <Btn onClick={onConfirm}>{confirmLabel}</Btn>
        </div>
      </div>
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

// ── DELIB EXTRACTOR ───────────────────────────────────────────────────────────
function DelibExtractor({ pv, onDone }) {
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
      const res = await fetch(`/api/deliberations/extract/${pv.id}`, {
        method: "POST",
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
            if (evt.type === "result") setProgress(p => [
              ...p.slice(0, -1),
              { ...p[p.length - 1], objet: evt.delib.objet, is_urba: evt.delib.is_urba, geo: evt.delib.geo },
            ]);
            if (evt.type === "done") { setDone(true); onDone && onDone(evt.created); }
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
    <div style={{ marginBottom: "12px" }}>
      <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: progress.length ? "8px" : 0 }}>
        <Btn onClick={running ? stop : start} variant={running ? "warning" : "outline"} size="sm" disabled={done}>
          {running ? "Arrêter" : done ? "Délibérations extraites" : `Extraire ${pv.pdfs.length} délibération(s)`}
        </Btn>
        {running && <span style={{ color: t.textMuted, fontSize: "11px" }}>Extraction en cours…</span>}
        {done && <span style={{ color: t.success, fontSize: "11px" }}>Terminé</span>}
        {error && <span style={{ color: t.danger, fontSize: "11px" }}>Erreur : {error}</span>}
      </div>
      {progress.length > 0 && (
        <div style={{ background: t.surfaceAlt, border: `1px solid ${t.border}`, borderRadius: "6px",
          padding: "8px 12px", maxHeight: "120px", overflowY: "auto" }}>
          {progress.map((e, i) => (
            <div key={i} style={{ fontSize: "11px", color: t.textSec, marginBottom: "2px",
              display: "flex", gap: "8px", alignItems: "center" }}>
              <span style={{ color: t.textMuted, flexShrink: 0 }}>[{e.current}/{e.total}]</span>
              <span style={{ fontWeight: 600, flex: 1 }}>{e.objet || e.nom}</span>
              {e.is_urba && <span style={{ color: t.primary, fontSize: "10px", flexShrink: 0 }}>Urba</span>}
              {e.geo && <span style={{ color: t.success, fontSize: "10px", flexShrink: 0 }}>Géo</span>}
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
  const [fallbackNotice, setFallbackNotice] = useState(null);
  const [pendingAiQuery, setPendingAiQuery] = useState(null);

  useEffect(() => {
    api.legifrance.ping()
      .then(d => {
        if (d.ok && d.subscribed) { setApiStatus("ok"); }
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
    setSearching(true); setResults([]); setError(null); setFallbackNotice(null);
    try {
      if (useAiFallback) {
        const d = await searchViaAI(q);
        setResults(d.results||[]); setTotal(d.total||0);
      } else {
        const resp = await fetch(`/api/legifrance/search?q=${encodeURIComponent(q)}&fond=${f}`);
        const d = await resp.json();
        if (!resp.ok) {
          if (d.subscriptionRequired) {
            setSearching(false);
            setPendingAiQuery(q);
            return;
          }
          throw new Error(d.error || `Erreur ${resp.status}`);
        } else {
          setResults(d.results||[]); setTotal(d.total||0);
        }
      }
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

  const statusDot = apiStatus === "ok" ? t.success : useAiFallback ? t.warning : apiStatus === "error" ? t.danger : t.textMuted;
  const statusLabel = apiStatus === "ok" ? "PISTE actif" : useAiFallback ? "IA Claude (PISTE non souscrit)" : apiStatus === "error" ? "PISTE hors ligne" : "Vérification…";
  const PC = { Haute:t.danger, Moyenne:t.warning, Basse:t.success };

  const confirmAiFallback = async () => {
    const q = pendingAiQuery;
    setPendingAiQuery(null);
    setUseAiFallback(true);
    setSearching(true); setResults([]); setError(null); setFallbackNotice(null);
    try {
      const d = await searchViaAI(q);
      setResults(d.results||[]); setTotal(d.total||0);
      setFallbackNotice("Résultats via IA Claude (PISTE non souscrit)");
    } catch(err) { setError(err.message); }
    setSearching(false);
  };

  return (
    <div>
      {aiPanel && <AIPanel {...aiPanel} onClose={()=>setAiPanel(null)} />}
      {pendingAiQuery && (
        <ConfirmModal
          title="API Légifrance indisponible"
          message="Le produit Légifrance n'est pas encore souscrit sur PISTE (beta.piste.gouv.fr). Voulez-vous utiliser Claude IA comme source de résultats à la place ?"
          confirmLabel="Utiliser l'IA"
          cancelLabel="Annuler"
          onConfirm={confirmAiFallback}
          onCancel={() => setPendingAiQuery(null)}
        />
      )}

      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"20px" }}>
        <SectionTitle sub="Codes consolidés · Textes applicables aux communes">
          Veille Légifrance
        </SectionTitle>
        <div style={{ display:"flex", alignItems:"center", gap:"8px", marginTop:"4px" }}>
          <div style={{ width:"8px", height:"8px", borderRadius:"50%", background:statusDot, flexShrink:0 }} />
          <span style={{ color:t.textMuted, fontSize:"11px" }}>{statusLabel}</span>
          {useAiFallback && (
            <button onClick={() => { setUseAiFallback(false); setFallbackNotice(null); setApiStatus(null);
              api.legifrance.ping().then(d => { if (d.ok && d.subscribed) setApiStatus("ok"); else { setApiStatus("pending"); setUseAiFallback(true); } }).catch(() => { setApiStatus("error"); setUseAiFallback(true); }); }}
              style={{ fontSize:"10px", padding:"2px 8px", background:"none", border:`1px solid ${t.border}`,
                borderRadius:"4px", color:t.textMuted, cursor:"pointer", fontFamily:"inherit" }}>
              Réessayer PISTE
            </button>
          )}
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
          {fallbackNotice && !error && (
            <div style={{ background:t.primaryBg||"#e8f0fe", border:`1px solid ${t.primary}44`, borderRadius:"8px",
              padding:"8px 14px", marginBottom:"10px", color:t.primary, fontSize:"11px" }}>
              {fallbackNotice}
            </div>
          )}
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
                  {pv.pdfs?.length > 0 && (
                    <DelibExtractor pv={pv} onDone={() => {}} />
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

// ── INTERVENTIONS (sous-composant SeanceLive) ─────────────────────────────────
const TYPES_INTERVENTION = ["Pour", "Contre", "Abstention", "Question", "Remarque", "Explication"];

function InterventionsList({ pt, onUpdate, t }) {
  const [elu, setElu] = useState("");
  const [type, setType] = useState("Remarque");
  const [note, setNote] = useState("");
  const [show, setShow] = useState(false);

  const interventions = pt.interventions || [];

  const add = () => {
    if (!elu.trim()) return;
    const updated = [...interventions, { elu: elu.trim(), type, note: note.trim() }];
    onUpdate(pt.id, { interventions: updated });
    setElu(""); setNote("");
  };

  const remove = (idx) => {
    const updated = interventions.filter((_, i) => i !== idx);
    onUpdate(pt.id, { interventions: updated });
  };

  return (
    <div style={{ marginTop:"4px" }}>
      <button onClick={() => setShow(s => !s)} style={{ background:"none", border:"none",
        color:t.primary, cursor:"pointer", fontSize:"11px", fontWeight:600, padding:"0" }}>
        {show ? "▼" : "▶"} Interventions ({interventions.length})
      </button>
      {show && (
        <div style={{ marginTop:"8px", padding:"10px 12px", background:t.surfaceAlt,
          borderRadius:"6px", border:`1px solid ${t.border}` }}>
          {interventions.length > 0 && (
            <div style={{ marginBottom:"8px", display:"flex", flexDirection:"column", gap:"4px" }}>
              {interventions.map((iv, idx) => (
                <div key={idx} style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
                  fontSize:"12px", color:t.text, padding:"3px 0" }}>
                  <span>
                    <span style={{ fontWeight:600 }}>{iv.elu}</span>
                    <span style={{ color:t.primary, marginLeft:"6px", fontSize:"10px" }}>[{iv.type}]</span>
                    {iv.note && <span style={{ color:t.textMuted, marginLeft:"6px" }}>{iv.note}</span>}
                  </span>
                  <button onClick={() => remove(idx)} style={{ background:"none", border:"none",
                    color:t.textMuted, cursor:"pointer", fontSize:"14px" }}>×</button>
                </div>
              ))}
            </div>
          )}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 120px", gap:"6px", marginBottom:"6px" }}>
            <Input value={elu} onChange={e=>setElu(e.target.value)}
              placeholder="Nom de l'élu" onKeyDown={e=>e.key==="Enter"&&add()} />
            <Select value={type} onChange={e=>setType(e.target.value)}>
              {TYPES_INTERVENTION.map(ty => <option key={ty} value={ty}>{ty}</option>)}
            </Select>
          </div>
          <div style={{ display:"flex", gap:"6px" }}>
            <Input value={note} onChange={e=>setNote(e.target.value)}
              placeholder="Note (optionnel)" style={{ flex:1 }}
              onKeyDown={e=>e.key==="Enter"&&add()} />
            <Btn onClick={add} disabled={!elu.trim()} size="sm" variant="primary">+</Btn>
          </div>
        </div>
      )}
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

                {/* INTERVENTIONS */}
                <InterventionsList pt={pt} onUpdate={updatePoint} t={t} />
              </div>
            )}

            {/* RÉSUMÉ si terminée */}
            {active.statut === "terminée" && (
              <div style={{ display:"flex", flexDirection:"column", gap:"4px" }}>
                <div style={{ display:"flex", gap:"12px", fontSize:"12px", color:t.textSec }}>
                  {(pt.vote_pour || pt.vote_contre) ? (
                    <span>{pt.vote_pour}p / {pt.vote_contre}c / {pt.vote_abstention}a</span>
                  ) : null}
                  {pt.anomalie_desc && <span style={{ color:t.danger }}>{pt.anomalie_desc}</span>}
                </div>
                {(pt.interventions || []).length > 0 && (
                  <div style={{ marginTop:"4px" }}>
                    {(pt.interventions || []).map((iv, idx) => (
                      <div key={idx} style={{ fontSize:"11px", color:t.textMuted, padding:"2px 0" }}>
                        <span style={{ fontWeight:600, color:t.textSec }}>{iv.elu}</span>
                        {iv.type && <span style={{ marginLeft:"4px", color:t.primary, fontSize:"10px" }}>[{iv.type}]</span>}
                        {iv.note && <span style={{ marginLeft:"6px" }}>{iv.note}</span>}
                      </div>
                    ))}
                  </div>
                )}
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

// ── TEST BTN ──────────────────────────────────────────────────────────────────
function TestBtn({ label, testFn }) {
  const t = useT();
  const [state, setState] = useState("idle"); // idle | loading | ok | error
  const [detail, setDetail] = useState("");

  const run = async () => {
    setState("loading"); setDetail("");
    try {
      const r = await testFn();
      if (r.ok) {
        setState("ok");
        setDetail(r.message || r.latency_ms ? `${r.latency_ms}ms` : "OK");
      } else {
        setState("error");
        setDetail(r.error || "Échec");
      }
    } catch (e) {
      setState("error");
      setDetail(e.message);
    }
    setTimeout(() => { setState("idle"); setDetail(""); }, 6000);
  };

  const colors = { ok: t.success, error: t.danger, loading: t.textMuted, idle: t.textSec };
  const color  = colors[state];

  return (
    <div style={{ display:"flex", alignItems:"center", gap:"10px", flexWrap:"wrap" }}>
      <Btn onClick={run} disabled={state === "loading"} variant="ghost" size="sm">
        {state === "loading" ? "Test…" : label}
      </Btn>
      {detail && (
        <span style={{ fontSize:"12px", color, fontWeight:500 }}>
          {state === "ok" ? "✓ " : state === "error" ? "✗ " : ""}{detail}
        </span>
      )}
    </div>
  );
}

// ── CONFIG ────────────────────────────────────────────────────────────────────
const AI_MODELS = {
  anthropic: [
    { value:"claude-opus-4-5",    label:"Claude Opus (meilleur)" },
    { value:"claude-sonnet-4-5",  label:"Claude Sonnet (rapide)" },
    { value:"claude-haiku-4-5",   label:"Claude Haiku (économique)" },
  ],
  openai: [
    { value:"gpt-4o",      label:"GPT-4o" },
    { value:"gpt-4o-mini", label:"GPT-4o mini" },
  ],
  mistral: [
    { value:"mistral-large-latest", label:"Mistral Large" },
    { value:"mistral-small-latest", label:"Mistral Small" },
  ],
};

function ConfigSection({ title, children }) {
  const t = useT();
  return (
    <div style={{ marginBottom:"28px" }}>
      <p style={{ color:t.textMuted, fontSize:"10px", fontWeight:700, textTransform:"uppercase",
        letterSpacing:"0.1em", marginBottom:"12px" }}>{title}</p>
      <Card hover={false} style={{ padding:"20px", display:"flex", flexDirection:"column", gap:"14px" }}>
        {children}
      </Card>
    </div>
  );
}

function ConfigField({ label, hint, children }) {
  const t = useT();
  return (
    <div>
      <label style={{ display:"block", color:t.textSec, fontSize:"12px", fontWeight:600, marginBottom:"5px" }}>
        {label}
      </label>
      {children}
      {hint && <p style={{ color:t.textMuted, fontSize:"11px", marginTop:"4px" }}>{hint}</p>}
    </div>
  );
}

function Configuration() {
  const t = useT();
  const [cfg, setCfg] = useState(null);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [newApiKey, setNewApiKey] = useState("");
  const [testResult, setTestResult] = useState(null);

  useEffect(() => {
    api.config.get().then(data => {
      setCfg(data);
      setForm(data);
    }).catch(() => {});
  }, []);

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const handleSave = async () => {
    setSaving(true);
    const payload = { ...form };
    if (newApiKey.trim()) payload.ai_api_key = newApiKey.trim();
    delete payload.ai_api_key_masked;
    try {
      await api.config.save(payload);
      setSaved(true);
      setNewApiKey("");
      const fresh = await api.config.get();
      setCfg(fresh); setForm(fresh);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      alert("Erreur sauvegarde : " + e.message);
    }
    setSaving(false);
  };

  const handleTestPush = async () => {
    try {
      await api.push.test();
      setTestResult("Notification envoyée !");
    } catch (e) {
      setTestResult("Erreur : " + e.message);
    }
    setTimeout(() => setTestResult(null), 4000);
  };

  if (!cfg) return <Spinner label="Chargement configuration…" />;

  const models = AI_MODELS[form.ai_provider] || AI_MODELS.anthropic;
  const otherProviders = Object.keys(AI_MODELS).filter(p => p !== "anthropic");

  return (
    <div style={{ maxWidth:"680px" }}>
      <SectionTitle title="Configuration" subtitle="Paramètres de l'outil — commune, IA, alertes" />

      {/* COMMUNE */}
      <ConfigSection title="Commune">
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"12px" }}>
          <ConfigField label="Nom de la commune">
            <Input value={form.commune_nom||""} onChange={e=>set("commune_nom",e.target.value)} placeholder="Fleurieux-sur-l'Arbresle" />
          </ConfigField>
          <ConfigField label="Code postal">
            <Input value={form.commune_cp||""} onChange={e=>set("commune_cp",e.target.value)} placeholder="69210" />
          </ConfigField>
          <ConfigField label="Code INSEE">
            <Input value={form.commune_insee||""} onChange={e=>set("commune_insee",e.target.value)} placeholder="69082" />
          </ConfigField>
          <ConfigField label="Population (habitants)">
            <Input value={form.commune_population||""} onChange={e=>set("commune_population",e.target.value)} placeholder="2000" type="number" />
          </ConfigField>
          <ConfigField label="Département">
            <Input value={form.commune_departement||""} onChange={e=>set("commune_departement",e.target.value)} placeholder="69" />
          </ConfigField>
          <ConfigField label="Nb. conseillers municipaux">
            <Input value={form.commune_nb_conseillers||""} onChange={e=>set("commune_nb_conseillers",e.target.value)} placeholder="15" type="number" />
          </ConfigField>
          <ConfigField label="Quorum (majorité absolue)" hint="Nombre minimum pour délibérer valablement">
            <Input value={form.commune_quorum||""} onChange={e=>set("commune_quorum",e.target.value)} placeholder="8" type="number" />
          </ConfigField>
          <ConfigField label="Maire">
            <Input value={form.commune_maire||""} onChange={e=>set("commune_maire",e.target.value)} placeholder="M. Prénom NOM" />
          </ConfigField>
        </div>
        <ConfigField label="URL site mairie" hint="Base pour le scraping des actualités">
          <Input value={form.commune_mairie_url||""} onChange={e=>set("commune_mairie_url",e.target.value)} placeholder="https://mairie.fr" />
        </ConfigField>
        <ConfigField label="URL page délibérations" hint="Page scraped pour l'import automatique des PVs">
          <Input value={form.commune_deliberations_url||""} onChange={e=>set("commune_deliberations_url",e.target.value)} placeholder="https://mairie.fr/deliberations" />
        </ConfigField>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"12px" }}>
          <ConfigField label="Pop. min. benchmark OFGL">
            <Input value={form.commune_pop_min||""} onChange={e=>set("commune_pop_min",e.target.value)} placeholder="1500" type="number" />
          </ConfigField>
          <ConfigField label="Pop. max. benchmark OFGL">
            <Input value={form.commune_pop_max||""} onChange={e=>set("commune_pop_max",e.target.value)} placeholder="3500" type="number" />
          </ConfigField>
        </div>
      </ConfigSection>

      {/* IA */}
      <ConfigSection title="Intelligence Artificielle">
        <ConfigField label="Provider IA">
          <Select value={form.ai_provider||"anthropic"} onChange={e=>{ set("ai_provider",e.target.value); set("ai_model", AI_MODELS[e.target.value]?.[0]?.value || ""); }}>
            <option value="anthropic">Anthropic (Claude) — recommandé</option>
            {otherProviders.map(p => (
              <option key={p} value={p}>{p.charAt(0).toUpperCase()+p.slice(1)} — bientôt disponible</option>
            ))}
          </Select>
        </ConfigField>
        <ConfigField label="Modèle" hint={form.ai_provider!=="anthropic" ? "Intégration en cours — utilise Claude pour l'instant" : undefined}>
          <Select value={form.ai_model||""} onChange={e=>set("ai_model",e.target.value)} disabled={form.ai_provider!=="anthropic"}>
            {models.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </Select>
        </ConfigField>
        <ConfigField label="Clé API" hint={cfg.ai_api_key_masked ? `Clé actuelle : ${cfg.ai_api_key_masked} — laisser vide pour conserver` : "Aucune clé enregistrée"}>
          <Input
            type="password"
            value={newApiKey}
            onChange={e=>setNewApiKey(e.target.value)}
            placeholder={cfg.ai_api_key_masked ? "Nouvelle clé (laisser vide = conserver)" : "sk-ant-api03-…"}
          />
        </ConfigField>
        <TestBtn label="Tester la clé IA" testFn={api.config.testAI} />
      </ConfigSection>

      {/* LÉGIFRANCE */}
      <ConfigSection title="API Légifrance (PISTE)">
        <ConfigField label="Client ID" hint="beta.piste.gouv.fr → votre application">
          <Input value={form.piste_client_id||""} onChange={e=>set("piste_client_id",e.target.value)} placeholder="f186dbc6-…" />
        </ConfigField>
        <ConfigField label="Client Secret">
          <Input type="password" value={form.piste_client_secret||""} onChange={e=>set("piste_client_secret",e.target.value)} placeholder="••••" />
        </ConfigField>
        <TestBtn label="Tester OAuth PISTE" testFn={api.config.testLF} />
      </ConfigSection>

      {/* ALERTES */}
      <ConfigSection title="Alertes & synchronisation">
        <ConfigField label="Email d'alerte" hint="Reçoit les notifications de nouvelles délibérations">
          <Input type="email" value={form.alert_email||""} onChange={e=>set("alert_email",e.target.value)} placeholder="conseiller@email.fr" />
        </ConfigField>
        <ConfigField label="Seuil alerte recours (jours)" hint="Badge rouge dans l'interface quand le délai de recours est inférieur à ce seuil">
          <Input type="number" value={form.alert_recours_seuil||"10"} onChange={e=>set("alert_recours_seuil",e.target.value)} placeholder="10" />
        </ConfigField>
        <TestBtn label="Tester l'envoi email" testFn={api.config.testSMTP} />
        <ConfigField label="Synchronisation automatique (cron lundi 8h)">
          <div style={{ display:"flex", gap:"8px" }}>
            {["1","0"].map(v => (
              <button key={v} onClick={()=>set("sync_enabled",v)} style={{
                flex:1, padding:"8px", borderRadius:"6px", cursor:"pointer",
                fontFamily:"inherit", fontSize:"13px", fontWeight:form.sync_enabled===v?600:400,
                background:form.sync_enabled===v?(v==="1"?t.successBg:t.dangerBg):t.surfaceAlt,
                border:`1px solid ${form.sync_enabled===v?(v==="1"?t.success:t.danger):t.border}`,
                color:form.sync_enabled===v?(v==="1"?t.success:t.danger):t.textSec,
              }}>
                {v==="1" ? "Activée" : "Désactivée"}
              </button>
            ))}
          </div>
        </ConfigField>
      </ConfigSection>

      {/* OUTILS */}
      <ConfigSection title="Outils">
        <div style={{ display:"flex", gap:"10px", flexWrap:"wrap" }}>
          <Btn variant="ghost" onClick={handleTestPush}>Test notification push</Btn>
          <a href="/api/config" target="_blank" style={{ textDecoration:"none" }}>
            <Btn variant="ghost">Voir config brute (JSON)</Btn>
          </a>
        </div>
        {testResult && (
          <p style={{ color:t.success, fontSize:"13px" }}>{testResult}</p>
        )}
      </ConfigSection>

      {/* SAVE */}
      <div style={{ display:"flex", gap:"10px", alignItems:"center" }}>
        <Btn onClick={handleSave} disabled={saving} variant="primary">
          {saving ? "Enregistrement…" : "Enregistrer la configuration"}
        </Btn>
        {saved && <span style={{ color:t.success, fontSize:"13px", fontWeight:600 }}>Sauvegardé</span>}
      </div>

      <p style={{ color:t.textMuted, fontSize:"11px", marginTop:"16px", lineHeight:"1.6" }}>
        Les modifications sont appliquées immédiatement côté serveur sans redémarrage.<br/>
        La clé API n'est jamais retournée par l'API — seuls les 4 derniers caractères sont affichés.
      </p>
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
  const fmtUsd = n => `$${(n ?? 0).toFixed(4)}`;
  const fmtUsdSmall = n => `$${(n ?? 0).toFixed(6)}`;
  const { total, byModel, byRoute, byDay, recent } = data;

  return (
    <div style={{ maxWidth:"900px", margin:"0 auto" }}>
      <SectionTitle title="Coûts API Anthropic" subtitle="Usage et dépenses des clés API — tracking en temps réel" />

      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))", gap:"12px", marginBottom:"24px" }}>
        {[
          { label:"Appels total",     value: fmt(total.calls) },
          { label:"Tokens entrée",    value: fmt(total.input) },
          { label:"Tokens sortie",    value: fmt(total.output) },
          { label:"Coût total (USD)", value: fmtUsd(total.cost), highlight:true },
        ].map(s => (
          <Card key={s.label} style={{ textAlign:"center" }}>
            <div style={{ fontSize: s.highlight ? "22px" : "20px", fontWeight:700,
              color: s.highlight ? t.danger : t.primary, fontVariantNumeric:"tabular-nums" }}>
              {s.value}
            </div>
            <div style={{ fontSize:"11px", color:t.textMuted, marginTop:"4px" }}>{s.label}</div>
          </Card>
        ))}
      </div>

      <Card style={{ marginBottom:"20px" }}>
        <h3 style={{ fontSize:"13px", fontWeight:600, color:t.text, marginBottom:"12px" }}>Par modèle</h3>
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:"12px" }}>
          <thead><tr style={{ color:t.textMuted, textAlign:"left" }}>
            {["Modèle","Appels","Tokens in","Tokens out","Coût USD"].map(h => (
              <th key={h} style={{ padding:"4px 8px", borderBottom:`1px solid ${t.border}` }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {byModel.map(r => (
              <tr key={r.model} style={{ borderBottom:`1px solid ${t.borderMid}` }}>
                <td style={{ padding:"6px 8px", color:t.text, fontFamily:"monospace", fontSize:"11px" }}>{r.model}</td>
                <td style={{ padding:"6px 8px", color:t.textMuted }}>{fmt(r.calls)}</td>
                <td style={{ padding:"6px 8px", color:t.textMuted }}>{fmt(r.input)}</td>
                <td style={{ padding:"6px 8px", color:t.textMuted }}>{fmt(r.output)}</td>
                <td style={{ padding:"6px 8px", color:t.danger, fontWeight:600 }}>{fmtUsd(r.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card style={{ marginBottom:"20px" }}>
        <h3 style={{ fontSize:"13px", fontWeight:600, color:t.text, marginBottom:"12px" }}>Par fonctionnalité</h3>
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:"12px" }}>
          <thead><tr style={{ color:t.textMuted, textAlign:"left" }}>
            {["Route","Appels","Coût USD"].map(h => (
              <th key={h} style={{ padding:"4px 8px", borderBottom:`1px solid ${t.border}` }}>{h}</th>
            ))}
          </tr></thead>
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

      {byDay.length > 0 && (
        <Card style={{ marginBottom:"20px" }}>
          <h3 style={{ fontSize:"13px", fontWeight:600, color:t.text, marginBottom:"12px" }}>Historique (30 j.)</h3>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:"12px" }}>
            <thead><tr style={{ color:t.textMuted, textAlign:"left" }}>
              {["Jour","Appels","Coût USD"].map(h => (
                <th key={h} style={{ padding:"4px 8px", borderBottom:`1px solid ${t.border}` }}>{h}</th>
              ))}
            </tr></thead>
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

      <Card>
        <h3 style={{ fontSize:"13px", fontWeight:600, color:t.text, marginBottom:"12px" }}>50 derniers appels</h3>
        {recent.length === 0 ? (
          <p style={{ color:t.textMuted, fontSize:"12px", textAlign:"center", padding:"20px" }}>
            Aucun appel enregistré — le tracking démarre maintenant.
          </p>
        ) : (
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:"11px" }}>
            <thead><tr style={{ color:t.textMuted, textAlign:"left" }}>
              {["Date","Route","Modèle","In","Out","Coût"].map(h => (
                <th key={h} style={{ padding:"4px 6px", borderBottom:`1px solid ${t.border}` }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {recent.map(r => (
                <tr key={r.id} style={{ borderBottom:`1px solid ${t.borderMid}` }}>
                  <td style={{ padding:"4px 6px", color:t.textMuted, whiteSpace:"nowrap" }}>{r.called_at?.slice(0,16)}</td>
                  <td style={{ padding:"4px 6px", color:t.text, fontFamily:"monospace" }}>{r.route}</td>
                  <td style={{ padding:"4px 6px", color:t.textMuted, fontFamily:"monospace" }}>{r.model?.replace("claude-","")}</td>
                  <td style={{ padding:"4px 6px", color:t.textMuted }}>{fmt(r.input_tokens)}</td>
                  <td style={{ padding:"4px 6px", color:t.textMuted }}>{fmt(r.output_tokens)}</td>
                  <td style={{ padding:"4px 6px", color:t.danger }}>{fmtUsdSmall(r.cost_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

// ── EXPORT WORD ───────────────────────────────────────────────────────────────
function ExportWordBtn({ titre, contenu, sous_titre = "" }) {
  const t = useT();
  const [loading, setLoading] = useState(false);
  const download = async () => {
    setLoading(true);
    try {
      const blob = await api.pdf.exportWord(titre, contenu, sous_titre);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${titre.slice(0, 40)}.docx`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { alert("Erreur export : " + e.message); }
    setLoading(false);
  };
  return (
    <Btn onClick={download} disabled={loading} variant="ghost" size="sm">
      {loading ? "Export…" : "↓ .docx"}
    </Btn>
  );
}

// ── BIBLIOTHÈQUE DE MODÈLES ───────────────────────────────────────────────────
function Modeles() {
  const t = useT();
  const [modeles, setModeles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [subTab, setSubTab] = useState("liste");
  const [genForm, setGenForm] = useState({ categorie: "Question écrite", sujet: "", contexte: "" });
  const [form, setForm] = useState({ titre: "", categorie: "Question écrite", contenu: "", variables: "" });
  const [varValues, setVarValues] = useState({});
  const [previewText, setPreviewText] = useState("");
  const [copied, setCopied] = useState(false);

  const CATS = ["Question écrite", "Demande CADA", "Recours gracieux", "Motion", "Amendement", "Courrier Préfet", "Autre"];
  const CAT_COLORS = { "Question écrite": t.primary, "Demande CADA": t.warning, "Recours gracieux": t.danger,
    "Motion": t.purple, "Amendement": t.success, "Courrier Préfet": t.textSec, "Autre": t.textMuted };

  useEffect(() => {
    api.modeles.list().then(setModeles).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const selectModele = (m) => {
    setSelected(m);
    const vars = {};
    (m.variables || []).forEach(v => { vars[v] = ""; });
    setVarValues(vars);
    setPreviewText(m.contenu);
    setSubTab("editer");
  };

  const updatePreview = (vals) => {
    let text = selected?.contenu || "";
    Object.entries(vals).forEach(([k, v]) => {
      text = text.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), v || `{{${k}}}`);
    });
    setPreviewText(text);
  };

  const handleVarChange = (k, v) => {
    const newVals = { ...varValues, [k]: v };
    setVarValues(newVals);
    updatePreview(newVals);
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(previewText).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  const saveNew = async () => {
    if (!form.titre || !form.contenu) return;
    const vars = form.variables.split(",").map(v => v.trim()).filter(Boolean);
    const created = await api.modeles.create({ ...form, variables: vars });
    setModeles(prev => [...prev, created]);
    setShowNew(false);
    setForm({ titre: "", categorie: "Question écrite", contenu: "", variables: "" });
  };

  const generate = async () => {
    if (!genForm.sujet) return;
    setGenerating(true);
    try {
      const m = await api.modeles.generate(genForm);
      const created = await api.modeles.create(m);
      setModeles(prev => [...prev, created]);
      selectModele(created);
    } catch (e) { alert(e.message); }
    setGenerating(false);
  };

  const removeModele = async (id) => {
    await api.modeles.remove(id);
    setModeles(prev => prev.filter(m => m.id !== id));
    if (selected?.id === id) { setSelected(null); setSubTab("liste"); }
  };

  const grouped = CATS.reduce((acc, c) => {
    acc[c] = modeles.filter(m => m.categorie === c);
    return acc;
  }, {});

  return (
    <div>
      <SectionTitle sub="Modèles réutilisables pour vos courriers et documents officiels">
        Bibliothèque de modèles
      </SectionTitle>
      <SubTabs tabs={[["liste","Modèles"],["editer","Éditeur"],["generer","Générer avec IA"],["nouveau","+ Nouveau"]]}
        active={subTab} onSelect={setSubTab} />

      {subTab === "liste" && (
        <div>
          {loading ? <Spinner label="Chargement des modèles…" /> : (
            CATS.map(cat => grouped[cat].length > 0 && (
              <div key={cat} style={{ marginBottom: "20px" }}>
                <p style={{ color: CAT_COLORS[cat], fontSize: "11px", fontWeight: 700,
                  textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "8px" }}>{cat}</p>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  {grouped[cat].map(m => (
                    <Card key={m.id} style={{ borderLeft: `3px solid ${CAT_COLORS[cat]}` }}
                      onClick={() => selectModele(m)}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ color: t.text, fontSize: "13px", fontWeight: 500 }}>{m.titre}</span>
                        <div style={{ display: "flex", gap: "6px" }} onClick={e => e.stopPropagation()}>
                          <Btn onClick={() => selectModele(m)} variant="outline" size="sm">Utiliser</Btn>
                          <Btn onClick={() => removeModele(m.id)} variant="ghost" size="sm">✕</Btn>
                        </div>
                      </div>
                      {m.variables?.length > 0 && (
                        <div style={{ display: "flex", gap: "4px", marginTop: "6px", flexWrap: "wrap" }}>
                          {m.variables.map(v => (
                            <span key={v} style={{ background: t.surfaceAlt, border: `1px solid ${t.border}`,
                              color: t.textMuted, fontSize: "10px", padding: "1px 6px", borderRadius: "4px" }}>
                              {`{{${v}}}`}
                            </span>
                          ))}
                        </div>
                      )}
                    </Card>
                  ))}
                </div>
              </div>
            ))
          )}
          {!loading && modeles.length === 0 && <EmptyState icon="≡" text="Aucun modèle. Générez-en avec l'IA ou créez-en un." />}
        </div>
      )}

      {subTab === "editer" && (
        <div>
          {!selected ? (
            <EmptyState icon="←" text="Sélectionnez un modèle dans la liste pour l'éditer." />
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
              <div>
                <p style={{ color: t.textMuted, fontSize: "11px", fontWeight: 700,
                  textTransform: "uppercase", marginBottom: "10px" }}>Variables à remplir</p>
                {Object.keys(varValues).length === 0
                  ? <p style={{ color: t.textMuted, fontSize: "12px" }}>Aucune variable dans ce modèle.</p>
                  : Object.entries(varValues).map(([k, v]) => (
                    <div key={k} style={{ marginBottom: "10px" }}>
                      <p style={{ color: t.textSec, fontSize: "11px", fontWeight: 600, marginBottom: "4px" }}>{`{{${k}}}`}</p>
                      <Input value={v} onChange={e => handleVarChange(k, e.target.value)}
                        placeholder={`Valeur pour ${k}…`} />
                    </div>
                  ))
                }
              </div>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                  <p style={{ color: t.textMuted, fontSize: "11px", fontWeight: 700, textTransform: "uppercase" }}>Aperçu</p>
                  <div style={{ display: "flex", gap: "6px" }}>
                    <Btn onClick={copyToClipboard} variant={copied ? "success" : "ghost"} size="sm">
                      {copied ? "Copié !" : "Copier"}
                    </Btn>
                    <ExportWordBtn titre={selected.titre} contenu={previewText} />
                  </div>
                </div>
                <div style={{ background: t.surfaceAlt, border: `1px solid ${t.border}`, borderRadius: "8px",
                  padding: "16px", fontSize: "13px", color: t.textSec, lineHeight: "1.7",
                  whiteSpace: "pre-wrap", maxHeight: "500px", overflowY: "auto" }}>
                  {previewText}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {subTab === "generer" && (
        <Card>
          <p style={{ color: t.purple, fontSize: "12px", fontWeight: 700, margin: "0 0 14px 0",
            textTransform: "uppercase", letterSpacing: "0.06em" }}>Générer un modèle avec IA</p>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <div>
              <p style={{ color: t.textMuted, fontSize: "11px", marginBottom: "4px" }}>Type de document</p>
              <Select value={genForm.categorie} onChange={e => setGenForm(f => ({ ...f, categorie: e.target.value }))}>
                {CATS.map(c => <option key={c} value={c}>{c}</option>)}
              </Select>
            </div>
            <div>
              <p style={{ color: t.textMuted, fontSize: "11px", marginBottom: "4px" }}>Sujet</p>
              <Input value={genForm.sujet} onChange={e => setGenForm(f => ({ ...f, sujet: e.target.value }))}
                placeholder="Ex: non-respect du délai de convocation du 15/03…" />
            </div>
            <div>
              <p style={{ color: t.textMuted, fontSize: "11px", marginBottom: "4px" }}>Contexte (optionnel)</p>
              <Textarea value={genForm.contexte} onChange={e => setGenForm(f => ({ ...f, contexte: e.target.value }))}
                placeholder="Détails supplémentaires…" rows={3} />
            </div>
            <Btn onClick={generate} disabled={generating || !genForm.sujet} variant="purple" size="lg">
              {generating ? "Génération en cours…" : "Générer le modèle"}
            </Btn>
          </div>
        </Card>
      )}

      {subTab === "nouveau" && (
        <Card>
          <p style={{ color: t.success, fontSize: "12px", fontWeight: 700, margin: "0 0 14px 0",
            textTransform: "uppercase" }}>Nouveau modèle</p>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <Input value={form.titre} onChange={e => setForm(f => ({ ...f, titre: e.target.value }))} placeholder="Titre du modèle" />
            <Select value={form.categorie} onChange={e => setForm(f => ({ ...f, categorie: e.target.value }))}>
              {CATS.map(c => <option key={c} value={c}>{c}</option>)}
            </Select>
            <Textarea value={form.contenu} onChange={e => setForm(f => ({ ...f, contenu: e.target.value }))}
              placeholder="Contenu du modèle. Utilisez {{variable}} pour les champs dynamiques." rows={10} />
            <Input value={form.variables} onChange={e => setForm(f => ({ ...f, variables: e.target.value }))}
              placeholder="Variables séparées par virgule : date_seance, signataire, commune" />
            <Btn onClick={saveNew} disabled={!form.titre || !form.contenu} variant="success">Enregistrer</Btn>
          </div>
        </Card>
      )}
    </div>
  );
}

// ── COURRIERS OFFICIELS ────────────────────────────────────────────────────────
function Courriers() {
  const t = useT();
  const [courriers, setCourriers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [subTab, setSubTab] = useState("liste");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ type: "Question écrite", destinataire: "Maire", objet: "", contenu: "", date_envoi: "", notes: "" });
  const f = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  const TYPES = ["Question écrite", "Demande CADA", "Recours gracieux", "Courrier Préfet", "Autre"];
  const STATUS_COLOR = {
    brouillon: t.textMuted, envoyé: t.primary, "en attente": t.warning,
    répondu: t.success, relance: t.danger, classé: t.purple,
  };

  useEffect(() => {
    api.courriers.list().then(setCourriers).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const generer = async () => {
    if (!form.type) return;
    setGenerating(true);
    try {
      const d = await api.courriers.generate({ type: form.type, destinataire: form.destinataire, sujet: form.objet, contexte: form.notes });
      f("objet", d.objet); f("contenu", d.contenu);
    } catch (e) { alert(e.message); }
    setGenerating(false);
  };

  const sauvegarder = async () => {
    if (!form.objet || !form.contenu) return;
    setSaving(true);
    try {
      const c = await api.courriers.create(form);
      setCourriers(prev => [c, ...prev]);
      setForm({ type: "Question écrite", destinataire: "Maire", objet: "", contenu: "", date_envoi: "", notes: "" });
      setSubTab("liste");
    } catch (e) { alert(e.message); }
    setSaving(false);
  };

  const marquerEnvoye = async (id) => {
    const updated = await api.courriers.envoyer(id);
    setCourriers(prev => prev.map(c => c.id === id ? updated : c));
  };

  const updateStatut = async (id, statut) => {
    const updated = await api.courriers.update(id, { statut });
    setCourriers(prev => prev.map(c => c.id === id ? updated : c));
  };

  const retard = courriers.filter(c => c.jours_limite !== null && c.jours_limite <= 0 && !["répondu", "classé"].includes(c.statut));

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <SectionTitle sub="Rédaction, envoi et suivi de vos courriers officiels">
          Courriers officiels
        </SectionTitle>
        <Btn onClick={() => setSubTab("nouveau")} variant="success" size="md">+ Nouveau</Btn>
      </div>

      {retard.length > 0 && (
        <div style={{ background: t.dangerBg, border: `1px solid ${t.danger}44`, borderRadius: "10px",
          padding: "12px 16px", marginBottom: "14px" }}>
          <p style={{ color: t.danger, fontSize: "12px", fontWeight: 700, margin: "0 0 6px 0" }}>
            Délais dépassés ({retard.length} courrier{retard.length > 1 ? "s" : ""})
          </p>
          {retard.map(c => (
            <p key={c.id} style={{ color: t.danger, fontSize: "11px", margin: "2px 0" }}>
              • {c.objet} — délai expiré depuis {Math.abs(c.jours_limite)}j
            </p>
          ))}
        </div>
      )}

      <SubTabs tabs={[["liste", `Tous (${courriers.length})`], ["envoyes", "Envoyés"], ["attente", "En attente"], ["nouveau", "Rédiger"]]}
        active={subTab} onSelect={setSubTab} />

      {(subTab === "liste" || subTab === "envoyes" || subTab === "attente") && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {loading ? <Spinner /> : (courriers
            .filter(c => subTab === "liste" ? true : subTab === "envoyes" ? ["envoyé", "répondu", "relance"].includes(c.statut) : c.statut === "brouillon")
            .map(c => (
              <Card key={c.id} style={{ borderLeft: `3px solid ${STATUS_COLOR[c.statut] || t.border}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
                  <div style={{ flex: 1, paddingRight: "12px" }}>
                    <h3 style={{ color: t.text, fontSize: "13px", fontWeight: 600, margin: "0 0 4px 0" }}>{c.objet}</h3>
                    <div style={{ display: "flex", gap: "5px", flexWrap: "wrap" }}>
                      <Badge label={c.type} color={t.textMuted} />
                      <Badge label={c.statut} color={STATUS_COLOR[c.statut] || t.textMuted} />
                      <Badge label={`→ ${c.destinataire}`} color={t.textSec} />
                      {c.jours_limite !== null && c.jours_limite >= 0 && !["répondu", "classé"].includes(c.statut) && (
                        <Badge label={`${c.jours_limite}j`} color={c.jours_limite < 7 ? t.danger : c.jours_limite < 15 ? t.warning : t.success} />
                      )}
                      {c.jours_limite !== null && c.jours_limite < 0 && !["répondu", "classé"].includes(c.statut) && (
                        <Badge label="Délai expiré" color={t.danger} />
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "6px" }}>
                    {c.statut === "brouillon" && (
                      <Btn onClick={() => marquerEnvoye(c.id)} variant="primary" size="sm">Marquer envoyé</Btn>
                    )}
                    {["envoyé", "relance"].includes(c.statut) && (
                      <Btn onClick={() => updateStatut(c.id, "répondu")} variant="success" size="sm">Répondu</Btn>
                    )}
                    <ExportWordBtn titre={c.objet} contenu={c.contenu} sous_titre={`À : ${c.destinataire}`} />
                  </div>
                </div>
                {c.date_envoi && (
                  <p style={{ color: t.textMuted, fontSize: "11px", margin: "0 0 4px 0" }}>
                    Envoyé le {c.date_envoi}
                    {c.date_reponse_limite ? ` · Délai réponse : ${c.date_reponse_limite}` : ""}
                  </p>
                )}
              </Card>
            ))
          )}
          {!loading && courriers.length === 0 && <EmptyState icon="@" text="Aucun courrier. Rédigez votre premier courrier." />}
        </div>
      )}

      {subTab === "nouveau" && (
        <Card>
          <p style={{ color: t.primary, fontSize: "12px", fontWeight: 700, margin: "0 0 16px 0",
            textTransform: "uppercase" }}>Rédiger un courrier</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "10px" }}>
            <div>
              <p style={{ color: t.textMuted, fontSize: "11px", marginBottom: "4px" }}>Type</p>
              <Select value={form.type} onChange={e => f("type", e.target.value)} style={{ width: "100%" }}>
                {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </Select>
            </div>
            <div>
              <p style={{ color: t.textMuted, fontSize: "11px", marginBottom: "4px" }}>Destinataire</p>
              <Input value={form.destinataire} onChange={e => f("destinataire", e.target.value)} placeholder="Maire, Préfet du Rhône…" />
            </div>
          </div>
          <div style={{ marginBottom: "10px" }}>
            <p style={{ color: t.textMuted, fontSize: "11px", marginBottom: "4px" }}>Objet</p>
            <Input value={form.objet} onChange={e => f("objet", e.target.value)} placeholder="Objet du courrier…" />
          </div>
          <div style={{ display: "flex", gap: "8px", marginBottom: "10px", alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <p style={{ color: t.textMuted, fontSize: "11px", marginBottom: "4px" }}>Contenu</p>
            </div>
            <Btn onClick={generer} disabled={generating || !form.objet} variant="purple" size="sm">
              {generating ? "Génération…" : "Générer avec IA"}
            </Btn>
          </div>
          <Textarea value={form.contenu} onChange={e => f("contenu", e.target.value)}
            placeholder="Rédigez ou générez le contenu…" rows={12} style={{ marginBottom: "10px" }} />
          <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: "10px", marginBottom: "14px" }}>
            <div>
              <p style={{ color: t.textMuted, fontSize: "11px", marginBottom: "4px" }}>Date d'envoi (optionnel)</p>
              <Input type="date" value={form.date_envoi} onChange={e => f("date_envoi", e.target.value)} />
            </div>
            <div>
              <p style={{ color: t.textMuted, fontSize: "11px", marginBottom: "4px" }}>Notes internes</p>
              <Input value={form.notes} onChange={e => f("notes", e.target.value)} placeholder="Notes…" />
            </div>
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <Btn onClick={sauvegarder} disabled={saving || !form.objet || !form.contenu} variant="success">
              {saving ? "Enregistrement…" : "Enregistrer"}
            </Btn>
            <ExportWordBtn titre={form.objet || "courrier"} contenu={form.contenu} />
            <Btn onClick={() => setSubTab("liste")} variant="ghost">Annuler</Btn>
          </div>
        </Card>
      )}
    </div>
  );
}

// ── SUIVI DES ENGAGEMENTS ─────────────────────────────────────────────────────
function Engagements({ pvs }) {
  const t = useT();
  const [engagements, setEngagements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("Tous");
  const [form, setForm] = useState({ titre: "", auteur: "", categorie: "Autre", date_prise: "", echeance: "", preuve_pv_id: 0, notes: "" });
  const f = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  const CATS = ["Budget", "Urbanisme", "Travaux", "Services publics", "Environnement", "Social", "Autre"];
  const STATUTS = ["Promis", "En cours", "En retard", "Tenu", "Abandonné"];
  const STATUT_COLOR = { Promis: t.primary, "En cours": t.warning, "En retard": t.danger, Tenu: t.success, Abandonné: t.textMuted };

  useEffect(() => {
    api.engagements.list().then(setEngagements).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const addEngagement = async () => {
    if (!form.titre) return;
    setSaving(true);
    try {
      const e = await api.engagements.create(form);
      setEngagements(prev => [e, ...prev]);
      setShowAdd(false);
      setForm({ titre: "", auteur: "", categorie: "Autre", date_prise: "", echeance: "", preuve_pv_id: 0, notes: "" });
    } catch (e) { alert(e.message); }
    setSaving(false);
  };

  const updateStatut = async (id, statut) => {
    const updated = await api.engagements.update(id, { statut });
    setEngagements(prev => prev.map(e => e.id === id ? updated : e));
  };

  const removeEng = async (id) => {
    await api.engagements.remove(id);
    setEngagements(prev => prev.filter(e => e.id !== id));
  };

  const filtered = filter === "Tous" ? engagements : engagements.filter(e => e.statut === filter);
  const retard = engagements.filter(e => e.statut === "En retard").length;
  const taux = engagements.length > 0
    ? Math.round((engagements.filter(e => e.statut === "Tenu").length / engagements.length) * 100) : 0;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <SectionTitle sub="Promesses de la majorité vs réalisations concrètes">
          Suivi des engagements
        </SectionTitle>
        <Btn onClick={() => setShowAdd(!showAdd)} variant={showAdd ? "ghost" : "success"} size="md">
          {showAdd ? "Annuler" : "+ Engagement"}
        </Btn>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px", marginBottom: "16px" }}>
        {[
          { label: "Total", value: engagements.length, color: t.primary },
          { label: "En retard", value: retard, color: t.danger },
          { label: "Tenus", value: engagements.filter(e => e.statut === "Tenu").length, color: t.success },
          { label: "Taux tenu", value: `${taux}%`, color: taux > 60 ? t.success : taux > 30 ? t.warning : t.danger },
        ].map(s => (
          <Card key={s.label} style={{ textAlign: "center", padding: "14px" }} hover={false}>
            <div style={{ color: s.color, fontSize: "22px", fontWeight: 700 }}>{s.value}</div>
            <div style={{ color: t.textMuted, fontSize: "11px", marginTop: "4px" }}>{s.label}</div>
          </Card>
        ))}
      </div>

      {showAdd && (
        <Card style={{ marginBottom: "16px", borderColor: t.success + "44" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "10px" }}>
            <Input value={form.titre} onChange={e => f("titre", e.target.value)} placeholder="Titre de l'engagement" />
            <Input value={form.auteur} onChange={e => f("auteur", e.target.value)} placeholder="Auteur (ex: Maire)" />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 160px 160px", gap: "10px", marginBottom: "10px" }}>
            <Select value={form.categorie} onChange={e => f("categorie", e.target.value)} style={{ width: "100%" }}>
              {CATS.map(c => <option key={c} value={c}>{c}</option>)}
            </Select>
            <Input type="date" value={form.date_prise} onChange={e => f("date_prise", e.target.value)} />
            <Input type="date" value={form.echeance} onChange={e => f("echeance", e.target.value)} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 200px", gap: "10px", marginBottom: "14px" }}>
            <Input value={form.notes} onChange={e => f("notes", e.target.value)} placeholder="Notes / source (PV, discours…)" />
            <Select value={form.preuve_pv_id} onChange={e => f("preuve_pv_id", +e.target.value)} style={{ width: "100%" }}>
              <option value={0}>PV de référence (optionnel)</option>
              {pvs.map(p => <option key={p.id} value={p.id}>{p.date} — {p.objet.slice(0, 40)}</option>)}
            </Select>
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <Btn onClick={addEngagement} disabled={saving || !form.titre} variant="success">
              {saving ? "Enregistrement…" : "Enregistrer"}
            </Btn>
            <Btn onClick={() => setShowAdd(false)} variant="ghost">Annuler</Btn>
          </div>
        </Card>
      )}

      <div style={{ display: "flex", gap: "5px", marginBottom: "14px", flexWrap: "wrap" }}>
        {["Tous", ...STATUTS].map(s => (
          <Btn key={s} onClick={() => setFilter(s)} variant={filter === s ? "primary" : "ghost"} size="sm">{s}</Btn>
        ))}
      </div>

      {loading ? <Spinner /> : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {filtered.map(eng => (
            <Card key={eng.id} style={{ borderLeft: `4px solid ${STATUT_COLOR[eng.statut] || t.border}` }} hover={false}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ flex: 1, paddingRight: "12px" }}>
                  <h3 style={{ color: t.text, fontSize: "13px", fontWeight: 600, margin: "0 0 6px 0" }}>{eng.titre}</h3>
                  <div style={{ display: "flex", gap: "5px", flexWrap: "wrap" }}>
                    <Badge label={eng.statut} color={STATUT_COLOR[eng.statut] || t.textMuted} />
                    <Badge label={eng.categorie} color={t.textMuted} />
                    {eng.auteur && <Badge label={eng.auteur} color={t.textSec} />}
                    {eng.echeance && <Badge label={`Échéance : ${eng.echeance}`}
                      color={eng.jours_echeance !== null && eng.jours_echeance < 0 ? t.danger : t.textMuted} />}
                    {eng.jours_echeance !== null && eng.jours_echeance >= 0 && eng.jours_echeance <= 30
                      && !["Tenu", "Abandonné"].includes(eng.statut) && (
                      <Badge label={`${eng.jours_echeance}j`} color={eng.jours_echeance < 7 ? t.danger : t.warning} />
                    )}
                  </div>
                  {eng.notes && <p style={{ color: t.textMuted, fontSize: "11px", margin: "6px 0 0", fontStyle: "italic" }}>{eng.notes}</p>}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                  {!["Tenu", "Abandonné"].includes(eng.statut) && (
                    <>
                      {eng.statut === "Promis" && (
                        <Btn onClick={() => updateStatut(eng.id, "En cours")} variant="warning" size="sm">→ En cours</Btn>
                      )}
                      {["Promis", "En cours", "En retard"].includes(eng.statut) && (
                        <Btn onClick={() => updateStatut(eng.id, "Tenu")} variant="success" size="sm">✓ Tenu</Btn>
                      )}
                      <Btn onClick={() => updateStatut(eng.id, "Abandonné")} variant="ghost" size="sm">Abandonné</Btn>
                    </>
                  )}
                  <Btn onClick={() => removeEng(eng.id)} variant="ghost" size="sm" style={{ color: t.danger }}>✕</Btn>
                </div>
              </div>
            </Card>
          ))}
          {filtered.length === 0 && <EmptyState icon="✓" text={filter === "Tous" ? "Aucun engagement enregistré." : `Aucun engagement avec le statut "${filter}".`} />}
        </div>
      )}
    </div>
  );
}

// ── JOURNAL DE TERRAIN ────────────────────────────────────────────────────────
function JournalTerrain({ pvs, failles }) {
  const t = useT();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("Tous");
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    lieu: "", type: "Constat terrain", contenu: "",
    tags: "", lien_pv_id: 0, lien_faille_id: 0,
  });
  const f = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  const TYPES = ["Constat terrain", "Réunion publique", "Contact citoyen", "Observation chantier", "Réunion interne", "Autre"];
  const TYPE_COLOR = {
    "Constat terrain": t.warning, "Réunion publique": t.primary, "Contact citoyen": t.success,
    "Observation chantier": t.danger, "Réunion interne": t.purple, "Autre": t.textMuted,
  };

  useEffect(() => {
    api.journal.list().then(setEntries).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const addEntry = async () => {
    if (!form.contenu) return;
    setSaving(true);
    try {
      const tags = form.tags.split(",").map(t => t.trim()).filter(Boolean);
      const e = await api.journal.create({ ...form, tags, lien_pv_id: +form.lien_pv_id, lien_faille_id: +form.lien_faille_id });
      setEntries(prev => [e, ...prev]);
      setShowAdd(false);
      setForm({ date: new Date().toISOString().slice(0, 10), lieu: "", type: "Constat terrain", contenu: "", tags: "", lien_pv_id: 0, lien_faille_id: 0 });
    } catch (e) { alert(e.message); }
    setSaving(false);
  };

  const removeEntry = async (id) => {
    await api.journal.remove(id);
    setEntries(prev => prev.filter(e => e.id !== id));
  };

  const filtered = filter === "Tous" ? entries : entries.filter(e => e.type === filter);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <SectionTitle sub="Notes de terrain, constats, réunions et contacts citoyens">
          Journal de terrain
        </SectionTitle>
        <Btn onClick={() => setShowAdd(!showAdd)} variant={showAdd ? "ghost" : "success"} size="md">
          {showAdd ? "Annuler" : "+ Note"}
        </Btn>
      </div>

      {showAdd && (
        <Card style={{ marginBottom: "16px", borderColor: t.success + "44" }}>
          <div style={{ display: "grid", gridTemplateColumns: "160px 1fr 1fr", gap: "10px", marginBottom: "10px" }}>
            <Input type="date" value={form.date} onChange={e => f("date", e.target.value)} />
            <Input value={form.lieu} onChange={e => f("lieu", e.target.value)} placeholder="Lieu (optionnel)" />
            <Select value={form.type} onChange={e => f("type", e.target.value)} style={{ width: "100%" }}>
              {TYPES.map(tp => <option key={tp} value={tp}>{tp}</option>)}
            </Select>
          </div>
          <Textarea value={form.contenu} onChange={e => f("contenu", e.target.value)}
            placeholder="Décrivez ce que vous avez observé, entendu ou décidé…" rows={5}
            style={{ marginBottom: "10px" }} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px", marginBottom: "14px" }}>
            <Input value={form.tags} onChange={e => f("tags", e.target.value)} placeholder="Tags : PLU, budget, voirie" />
            <Select value={form.lien_pv_id} onChange={e => f("lien_pv_id", e.target.value)} style={{ width: "100%" }}>
              <option value={0}>Lien PV (optionnel)</option>
              {pvs.map(p => <option key={p.id} value={p.id}>{p.date} — {p.objet.slice(0, 30)}</option>)}
            </Select>
            <Select value={form.lien_faille_id} onChange={e => f("lien_faille_id", e.target.value)} style={{ width: "100%" }}>
              <option value={0}>Lien faille (optionnel)</option>
              {failles.map(f => <option key={f.id} value={f.id}>{f.titre.slice(0, 35)}</option>)}
            </Select>
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <Btn onClick={addEntry} disabled={saving || !form.contenu} variant="success">
              {saving ? "Enregistrement…" : "Enregistrer"}
            </Btn>
            <Btn onClick={() => setShowAdd(false)} variant="ghost">Annuler</Btn>
          </div>
        </Card>
      )}

      <div style={{ display: "flex", gap: "5px", marginBottom: "14px", flexWrap: "wrap" }}>
        {["Tous", ...TYPES].map(tp => (
          <Btn key={tp} onClick={() => setFilter(tp)} variant={filter === tp ? "primary" : "ghost"} size="sm">{tp}</Btn>
        ))}
      </div>

      {loading ? <Spinner /> : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {filtered.map(entry => (
            <Card key={entry.id} style={{ borderLeft: `3px solid ${TYPE_COLOR[entry.type] || t.border}` }} hover={false}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ flex: 1, paddingRight: "12px" }}>
                  <div style={{ display: "flex", gap: "6px", alignItems: "center", marginBottom: "6px", flexWrap: "wrap" }}>
                    <Badge label={entry.type} color={TYPE_COLOR[entry.type] || t.textMuted} />
                    <span style={{ color: t.textMuted, fontSize: "11px" }}>{entry.date}</span>
                    {entry.lieu && <span style={{ color: t.textMuted, fontSize: "11px" }}>· {entry.lieu}</span>}
                  </div>
                  <p style={{ color: t.textSec, fontSize: "13px", lineHeight: "1.6", margin: "0 0 8px 0",
                    whiteSpace: "pre-wrap" }}>{entry.contenu}</p>
                  {entry.tags?.length > 0 && (
                    <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                      {entry.tags.map(tag => (
                        <span key={tag} style={{ background: t.surfaceAlt, border: `1px solid ${t.border}`,
                          color: t.textMuted, fontSize: "10px", padding: "1px 6px", borderRadius: "4px" }}>#{tag}</span>
                      ))}
                    </div>
                  )}
                  {entry.lien_pv_id > 0 && (
                    <p style={{ color: t.primary, fontSize: "11px", margin: "6px 0 0" }}>
                      → Lié au PV #{entry.lien_pv_id}
                    </p>
                  )}
                  {entry.lien_faille_id > 0 && (
                    <p style={{ color: t.danger, fontSize: "11px", margin: "4px 0 0" }}>
                      → Lié à la faille #{entry.lien_faille_id}
                    </p>
                  )}
                </div>
                <Btn onClick={() => removeEntry(entry.id)} variant="ghost" size="sm" style={{ color: t.danger }}>✕</Btn>
              </div>
            </Card>
          ))}
          {filtered.length === 0 && <EmptyState icon="+" text="Aucune note. Commencez par documenter votre première observation." />}
        </div>
      )}
    </div>
  );
}

// ── STATS ÉLUS ────────────────────────────────────────────────────────────────
function StatsElus() {
  const t = useT();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const loadStats = async () => {
    setLoading(true); setError(null);
    try { setData(await api.analyses.elus()); }
    catch (e) { setError(e.message); }
    setLoading(false);
  };

  const IMPACT_COLOR = { Haute: t.danger, Moyenne: t.warning, Basse: t.success };

  return (
    <div>
      <SectionTitle sub="Présences, votes et thèmes d'intervention par élu (2020-2026)">
        Statistiques élus
      </SectionTitle>

      {!data && !loading && (
        <Card style={{ textAlign: "center", padding: "48px" }}>
          <p style={{ color: t.textMuted, fontSize: "13px", marginBottom: "16px" }}>
            Analyse IA des comportements et présences sur l'ensemble des séances
          </p>
          <Btn onClick={loadStats} variant="primary" size="lg">Analyser les élus (IA)</Btn>
        </Card>
      )}

      {loading && <Spinner label="Claude analyse les données élus…" />}

      {error && (
        <div style={{ background: t.dangerBg, border: `1px solid ${t.danger}44`,
          borderRadius: "8px", padding: "16px", color: t.danger, fontSize: "13px" }}>
          Erreur : {error}
        </div>
      )}

      {data && !error && (
        <div>
          {data.analyse_globale && (
            <Card style={{ marginBottom: "16px", borderLeft: `3px solid ${t.primary}` }}>
              <p style={{ color: t.textMuted, fontSize: "11px", fontWeight: 700, margin: "0 0 8px 0",
                textTransform: "uppercase" }}>Analyse globale · {data.periode}</p>
              <p style={{ color: t.textSec, fontSize: "13px", lineHeight: "1.7", margin: 0 }}>
                {data.analyse_globale}
              </p>
            </Card>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {(data.elus || []).map((elu, i) => (
              <Card key={i} hover={false}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "10px" }}>
                  <div>
                    <h3 style={{ color: t.text, fontSize: "13px", fontWeight: 600, margin: "0 0 4px 0" }}>{elu.nom}</h3>
                    {elu.role && <span style={{ color: t.textMuted, fontSize: "11px" }}>{elu.role}</span>}
                  </div>
                  <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ color: elu.presence_pct > 80 ? t.success : elu.presence_pct > 60 ? t.warning : t.danger,
                        fontSize: "18px", fontWeight: 700 }}>{elu.presence_pct}%</div>
                      <div style={{ color: t.textMuted, fontSize: "10px" }}>présence</div>
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", gap: "12px", marginBottom: "8px",
                  padding: "8px 12px", background: t.surfaceAlt, borderRadius: "6px", flexWrap: "wrap" }}>
                  <span style={{ color: t.success, fontSize: "12px" }}>✓ {elu.votes_pour} pour</span>
                  <span style={{ color: t.danger, fontSize: "12px" }}>✗ {elu.votes_contre} contre</span>
                  {elu.themes?.length > 0 && (
                    <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                      {elu.themes.map(th => <Badge key={th} label={th} color={t.primary} />)}
                    </div>
                  )}
                </div>

                <div style={{ height: "6px", background: t.border, borderRadius: "3px", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${elu.presence_pct}%`,
                    background: elu.presence_pct > 80 ? t.success : elu.presence_pct > 60 ? t.warning : t.danger,
                    borderRadius: "3px", transition: "width 0.4s" }} />
                </div>
              </Card>
            ))}
          </div>

          <div style={{ marginTop: "14px", textAlign: "right" }}>
            <Btn onClick={loadStats} variant="ghost" size="sm">Rafraîchir</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

// ── VEILLE RÉGLEMENTAIRE ─────────────────────────────────────────────────────
function VeilleReglementaire() {
  const t = useT();
  const [alertes, setAlertes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState(null);
  const [filter, setFilter] = useState("Tous");

  const CATS = ["Finances", "Urbanisme", "Élus", "Marchés publics", "Environnement", "RH", "Autre"];
  const IMPACT_COLOR = { Haute: t.danger, Moyenne: t.warning, Basse: t.success };

  useEffect(() => {
    api.veille.list().then(setAlertes).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const scan = async () => {
    setScanning(true); setScanMsg(null);
    try {
      const { alertes: nouvelles } = await api.veille.scan();
      if (nouvelles.length > 0) {
        setAlertes(prev => [...nouvelles, ...prev]);
        setScanMsg({ ok: true, text: `${nouvelles.length} nouvelle(s) alerte(s) importée(s).` });
      } else {
        setScanMsg({ ok: true, text: "Aucune nouvelle alerte réglementaire détectée." });
      }
    } catch (e) {
      setScanMsg({ ok: false, text: e.message });
    }
    setScanning(false);
  };

  const markRead = async (id) => {
    await api.veille.markRead(id);
    setAlertes(prev => prev.map(a => a.id === id ? { ...a, lu: 1 } : a));
  };

  const markAllRead = async () => {
    await api.veille.markAllRead();
    setAlertes(prev => prev.map(a => ({ ...a, lu: 1 })));
  };

  const remove = async (id) => {
    await api.veille.remove(id);
    setAlertes(prev => prev.filter(a => a.id !== id));
  };

  const nonLues = alertes.filter(a => !a.lu).length;
  const filtered = filter === "Tous" ? alertes : alertes.filter(a => a.categorie === filter);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <SectionTitle sub="Nouvelles lois, décrets et circulaires DGCL impactant votre commune">
          Veille réglementaire
        </SectionTitle>
        <div style={{ display: "flex", gap: "8px" }}>
          {nonLues > 0 && (
            <Btn onClick={markAllRead} variant="ghost" size="sm">Tout marquer lu</Btn>
          )}
          <Btn onClick={scan} disabled={scanning} variant="primary" size="md">
            {scanning ? "Analyse en cours…" : "Scanner maintenant"}
          </Btn>
        </div>
      </div>

      {scanMsg && (
        <div style={{ background: scanMsg.ok ? t.successBg || t.surfaceAlt : t.dangerBg,
          border: `1px solid ${scanMsg.ok ? t.success : t.danger}55`,
          borderRadius: "8px", padding: "10px 16px", marginBottom: "14px",
          color: scanMsg.ok ? t.success : t.danger, fontSize: "13px" }}>
          {scanMsg.text}
        </div>
      )}

      {nonLues > 0 && (
        <div style={{ background: t.primaryBg, border: `1px solid ${t.primary}44`, borderRadius: "10px",
          padding: "10px 16px", marginBottom: "14px" }}>
          <span style={{ color: t.primary, fontSize: "12px", fontWeight: 600 }}>
            {nonLues} nouvelle{nonLues > 1 ? "s" : ""} alerte{nonLues > 1 ? "s" : ""} réglementaire{nonLues > 1 ? "s" : ""}
          </span>
        </div>
      )}

      <div style={{ display: "flex", gap: "5px", marginBottom: "14px", flexWrap: "wrap" }}>
        {["Tous", ...CATS].map(c => (
          <Btn key={c} onClick={() => setFilter(c)} variant={filter === c ? "primary" : "ghost"} size="sm">{c}</Btn>
        ))}
      </div>

      {loading ? <Spinner label="Chargement des alertes…" /> : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {filtered.map(alerte => (
            <Card key={alerte.id}
              style={{ borderLeft: `3px solid ${IMPACT_COLOR[alerte.impact] || t.border}`,
                opacity: alerte.lu ? 0.7 : 1 }}
              hover={false}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ flex: 1, paddingRight: "12px" }}>
                  <div style={{ display: "flex", gap: "6px", alignItems: "center", marginBottom: "6px", flexWrap: "wrap" }}>
                    {!alerte.lu && (
                      <div style={{ width: "7px", height: "7px", borderRadius: "50%",
                        background: t.primary, flexShrink: 0 }} />
                    )}
                    <h3 style={{ color: t.text, fontSize: "13px", fontWeight: alerte.lu ? 400 : 600, margin: 0 }}>
                      {alerte.titre}
                    </h3>
                  </div>
                  <div style={{ display: "flex", gap: "5px", flexWrap: "wrap", marginBottom: "8px" }}>
                    <Badge label={alerte.source} color={t.textMuted} />
                    <Badge label={alerte.categorie} color={t.primary} />
                    <Badge label={`Impact ${alerte.impact}`} color={IMPACT_COLOR[alerte.impact] || t.textMuted} />
                    {alerte.date_parution && <span style={{ color: t.textMuted, fontSize: "11px" }}>{alerte.date_parution}</span>}
                  </div>
                  {alerte.resume && (
                    <p style={{ color: t.textSec, fontSize: "13px", lineHeight: "1.6", margin: 0 }}>{alerte.resume}</p>
                  )}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                  {!alerte.lu && (
                    <Btn onClick={() => markRead(alerte.id)} variant="ghost" size="sm">Lu</Btn>
                  )}
                  {alerte.url && (
                    <a href={alerte.url} target="_blank" rel="noreferrer"
                      style={{ padding: "4px 10px", border: `1px solid ${t.border}`, borderRadius: "6px",
                        color: t.textSec, fontSize: "11px", textDecoration: "none", textAlign: "center" }}>
                      Lire →
                    </a>
                  )}
                  <Btn onClick={() => remove(alerte.id)} variant="ghost" size="sm" style={{ color: t.danger }}>✕</Btn>
                </div>
              </div>
            </Card>
          ))}
          {filtered.length === 0 && (
            <EmptyState icon="§" text={filter === "Tous"
              ? "Aucune alerte. Cliquez sur 'Scanner maintenant' pour lancer une veille."
              : `Aucune alerte dans la catégorie "${filter}".`} />
          )}
        </div>
      )}
    </div>
  );
}

// ── CARTE URBANISME ───────────────────────────────────────────────────────────
const IGN_LAYERS = {
  cadastre: {
    label: "Cadastre",
    layer: null,
    make: (L) => L.tileLayer.wms(
      "https://data.geopf.fr/wms-r/wms",
      {
        layers: "CADASTRALPARCELS.PARCELLAIRE_EXPRESS",
        format: "image/png",
        transparent: true,
        version: "1.3.0",
        opacity: 0.7,
        attribution: "© IGN Géoportail",
      }
    ),
  },
  plu: {
    label: "Zones PLU",
    layer: null,
    make: (L) => L.tileLayer.wms(
      "https://data.geopf.fr/wms-r/wms",
      {
        layers: "MS_ZONE_URBA",
        format: "image/png",
        transparent: true,
        version: "1.3.0",
        opacity: 0.6,
        attribution: "© Géoportail de l'Urbanisme",
      }
    ),
  },
};

function CarteUrbanisme({ pvs }) {
  const t = useT();
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const markersRef = useRef([]);
  const layerRefs = useRef({});
  const [leafletReady, setLeafletReady] = useState(false);
  const [selectedPv, setSelectedPv] = useState(null);
  const [geoForm, setGeoForm] = useState({ pvId: 0, lat: "", lng: "", adresse: "" });
  const [geocoding, setGeocoding] = useState(false);
  const [pvGeos, setPvGeos] = useState([]);
  const [activeLayers, setActiveLayers] = useState({ cadastre: false, plu: false });
  const [deliberations, setDeliberations] = useState([]);
  const delibMarkersRef = useRef([]);

  const pvUrba = pvs.filter(p =>
    p.objet?.toLowerCase().includes("plu") ||
    p.objet?.toLowerCase().includes("urban") ||
    p.objet?.toLowerCase().includes("lotissement") ||
    p.objet?.toLowerCase().includes("construction") ||
    p.objet?.toLowerCase().includes("permis") ||
    p.geo
  );

  useEffect(() => {
    api.deliberations.list().then(all => {
      setDeliberations(all.filter(d => d.is_urba && d.geo));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    import("leaflet").then(L => {
      if (!window._leafletCSSLoaded) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
        document.head.appendChild(link);
        window._leafletCSSLoaded = true;
      }
      window.L = L.default || L;
      setLeafletReady(true);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!leafletReady || !mapRef.current || mapInstance.current) return;
    const L = window.L;
    const map = L.map(mapRef.current).setView([45.856, 4.602], 14);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap",
      maxZoom: 19,
    }).addTo(map);
    mapInstance.current = map;

    const geoData = pvs.filter(p => p.geo).map(p => {
      try { return { pv: p, geo: JSON.parse(p.geo) }; } catch { return null; }
    }).filter(Boolean);

    geoData.forEach(({ pv, geo }) => {
      const color = pv.statut === "Alerte" ? "#EF4444" : pv.statut === "Analysé" ? "#3B82F6" : "#22C55E";
      const marker = L.circleMarker([geo.lat, geo.lng], { radius: 10, color, fillColor: color, fillOpacity: 0.7 })
        .addTo(map)
        .bindPopup(`<b>${pv.date}</b><br>${pv.objet}<br><small>${geo.adresse || ""}</small>`);
      markersRef.current.push(marker);
    });

    setPvGeos(geoData);
  }, [leafletReady, pvs]);

  // Marqueurs délibérations urbanisme extraites
  useEffect(() => {
    const map = mapInstance.current;
    const L = window.L;
    if (!map || !L || !leafletReady) return;

    delibMarkersRef.current.forEach(m => map.removeLayer(m));
    delibMarkersRef.current = [];

    deliberations.forEach(d => {
      try {
        const geo = JSON.parse(d.geo);
        const color = d.statut === "Alerte" ? "#EF4444" : "#8B5CF6";
        const marker = L.circleMarker([geo.lat, geo.lng], {
          radius: 8, color, fillColor: color, fillOpacity: 0.85,
          dashArray: d.statut === "Alerte" ? "4" : null,
        })
          .addTo(map)
          .bindPopup(`
            <b>${d.objet}</b><br>
            <small>${geo.adresse || d.adresse || ""}</small><br>
            ${d.statut === "Alerte" ? `<span style="color:#EF4444">⚠ ${d.anomalies?.[0] || "Anomalie"}</span>` : ""}
          `);
        delibMarkersRef.current.push(marker);
      } catch {}
    });
  }, [deliberations, leafletReady]);

  const toggleLayer = (key) => {
    const map = mapInstance.current;
    const L = window.L;
    if (!map || !L) return;

    if (activeLayers[key]) {
      if (layerRefs.current[key]) {
        map.removeLayer(layerRefs.current[key]);
        layerRefs.current[key] = null;
      }
      setActiveLayers(prev => ({ ...prev, [key]: false }));
    } else {
      const layer = IGN_LAYERS[key].make(L);
      layer.addTo(map);
      layerRefs.current[key] = layer;
      setActiveLayers(prev => ({ ...prev, [key]: true }));
    }
  };

  const geocodeAdresse = async () => {
    if (!geoForm.adresse) return;
    setGeocoding(true);
    try {
      const resp = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(geoForm.adresse)}&limit=1`);
      const data = await resp.json();
      if (data.features?.length > 0) {
        const [lng, lat] = data.features[0].geometry.coordinates;
        setGeoForm(f => ({ ...f, lat: lat.toFixed(6), lng: lng.toFixed(6) }));
      } else {
        alert("Adresse non trouvée. Essayez une adresse plus précise.");
      }
    } catch { alert("Erreur de géocodage."); }
    setGeocoding(false);
  };

  const saveGeo = async () => {
    if (!geoForm.pvId || !geoForm.lat || !geoForm.lng) return;
    const geoJson = JSON.stringify({ lat: +geoForm.lat, lng: +geoForm.lng, adresse: geoForm.adresse });
    const updated = await api.pvs.update(geoForm.pvId, { geo: geoJson });

    // Ajouter le marqueur sans recharger
    if (mapInstance.current && updated) {
      const L = window.L;
      const geo = JSON.parse(geoJson);
      const pv = pvUrba.find(p => p.id === geoForm.pvId);
      const color = pv?.statut === "Alerte" ? "#EF4444" : pv?.statut === "Analysé" ? "#3B82F6" : "#22C55E";
      const marker = L.circleMarker([geo.lat, geo.lng], { radius: 10, color, fillColor: color, fillOpacity: 0.7 })
        .addTo(mapInstance.current)
        .bindPopup(`<b>${pv?.date}</b><br>${pv?.objet}<br><small>${geo.adresse || ""}</small>`);
      markersRef.current.push(marker);
      mapInstance.current.setView([geo.lat, geo.lng], 16);
      setPvGeos(prev => [...prev, { pv: { ...pv, geo: geoJson }, geo }]);
    }

    setGeoForm({ pvId: 0, lat: "", lng: "", adresse: "" });
  };

  return (
    <div>
      <SectionTitle sub="Visualisation géographique des délibérations d'urbanisme">
        Carte urbanisme
      </SectionTitle>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: "16px", alignItems: "start" }}>
        <div>
          {leafletReady && (
            <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
              {Object.entries(IGN_LAYERS).map(([key, cfg]) => (
                <Btn key={key} size="sm"
                  variant={activeLayers[key] ? "primary" : "ghost"}
                  onClick={() => toggleLayer(key)}>
                  {cfg.label}
                </Btn>
              ))}
            </div>
          )}
          {!leafletReady && <Spinner label="Chargement de la carte…" />}
          <div ref={mapRef} style={{ height: "500px", borderRadius: "10px", border: `1px solid ${t.border}`,
            display: leafletReady ? "block" : "none" }} />
          <p style={{ color: t.textMuted, fontSize: "11px", marginTop: "6px" }}>
            Fond de carte : OpenStreetMap · Cadastre & PLU : IGN Géoportail · Géocodage : data.gouv.fr
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <Card>
            <p style={{ color: t.primary, fontSize: "11px", fontWeight: 700, margin: "0 0 12px 0",
              textTransform: "uppercase" }}>Géolocaliser un PV</p>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <Select value={geoForm.pvId} onChange={e => setGeoForm(f => ({ ...f, pvId: +e.target.value }))} style={{ width: "100%" }}>
                <option value={0}>Choisir un PV…</option>
                {pvUrba.map(p => <option key={p.id} value={p.id}>{p.date} — {p.objet.slice(0, 30)}</option>)}
              </Select>
              <div style={{ display: "flex", gap: "6px" }}>
                <Input value={geoForm.adresse} onChange={e => setGeoForm(f => ({ ...f, adresse: e.target.value }))}
                  placeholder="Adresse ou lieu…" style={{ flex: 1 }}
                  onKeyDown={e => e.key === "Enter" && geocodeAdresse()} />
                <Btn onClick={geocodeAdresse} disabled={geocoding || !geoForm.adresse} variant="ghost" size="sm">
                  {geocoding ? "…" : "Géo"}
                </Btn>
              </div>
              {geoForm.lat && geoForm.lng && (
                <p style={{ color: t.success, fontSize: "11px" }}>
                  Coordonnées : {geoForm.lat}, {geoForm.lng}
                </p>
              )}
              <Btn onClick={saveGeo} disabled={!geoForm.pvId || !geoForm.lat} variant="primary" size="sm">
                Enregistrer la position
              </Btn>
            </div>
          </Card>

          <Card>
            <p style={{ color: t.textMuted, fontSize: "11px", fontWeight: 700, margin: "0 0 10px 0",
              textTransform: "uppercase" }}>
              Délibérations urbanisme
              {deliberations.length > 0 && (
                <span style={{ marginLeft: "6px", color: t.primary, fontWeight: 700 }}>
                  {deliberations.length} géolocalisée(s)
                </span>
              )}
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "5px", maxHeight: "300px", overflowY: "auto" }}>
              {deliberations.map(d => (
                <div key={d.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "6px 8px", background: t.surfaceAlt, borderRadius: "6px" }}>
                  <span style={{ color: t.textSec, fontSize: "11px", flex: 1, paddingRight: "8px" }}>
                    {d.objet.slice(0, 35)}
                  </span>
                  <div style={{ width: "8px", height: "8px", borderRadius: "50%",
                    background: d.statut === "Alerte" ? t.danger : "#8B5CF6", flexShrink: 0 }} />
                </div>
              ))}
              {deliberations.length === 0 && (
                <p style={{ color: t.textMuted, fontSize: "12px" }}>
                  Aucune délibération urbanisme géolocalisée.<br />
                  Utilisez "Extraire les délibérations" dans les PVs.
                </p>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ── NAV GROUPS ────────────────────────────────────────────────────────────────
const NAV_GROUPS = [
  {
    label: "Séances",
    items: [
      { id:"dashboard",    label:"Tableau de bord", icon:"⬡" },
      { id:"seance-live",  label:"Séance live",     icon:"●" },
      { id:"pv",           label:"Procès-verbaux",  icon:"≡" },
      { id:"historique",   label:"Historique",      icon:"⌛" },
    ],
  },
  {
    label: "Action juridique",
    items: [
      { id:"failles",      label:"Failles",          icon:"!" },
      { id:"questions",    label:"Questions & CADA", icon:"?" },
      { id:"jurisprudence",label:"Jurisprudence",    icon:"=" },
      { id:"legifrance",   label:"Légifrance",       icon:"§" },
    ],
  },
  {
    label: "Rédaction",
    items: [
      { id:"modeles",      label:"Modèles",          icon:"□" },
      { id:"courriers",    label:"Courriers",        icon:"✉" },
    ],
  },
  {
    label: "Suivi",
    items: [
      { id:"engagements",  label:"Engagements",     icon:"◎" },
      { id:"journal",      label:"Journal terrain", icon:"✎" },
      { id:"veille",       label:"Veille régl.",    icon:"◉" },
    ],
  },
  {
    label: "Analyses",
    items: [
      { id:"analyses",     label:"Analyses IA",     icon:"◈" },
      { id:"stats-elus",   label:"Stats élus",      icon:"∑" },
      { id:"agenda",       label:"Agenda",          icon:"+" },
      { id:"carte",        label:"Carte urbanisme", icon:"⊕" },
    ],
  },
  {
    label: "Données",
    items: [
      { id:"scraper",      label:"Sync Mairie",     icon:"↻" },
      { id:"config",       label:"Configuration",   icon:"⚙" },
      { id:"admin",        label:"Admin",           icon:"$" },
    ],
  },
];

// Items visibles dans la barre bottom mobile (les plus utilisés)
const BOTTOM_NAV = ["dashboard","seance-live","pv","failles"];

// ── HOOK WINDOW SIZE ──────────────────────────────────────────────────────────
function useWindowWidth() {
  const [width, setWidth] = useState(() => typeof window !== "undefined" ? window.innerWidth : 1200);
  useEffect(() => {
    const handler = () => setWidth(window.innerWidth);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return width;
}

// ── APP ────────────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState("dashboard");
  const [lois, setLois] = useState([]);
  const [pvs, setPvs] = useState([]);
  const [failles, setFailles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(() => {
    try { return localStorage.getItem("theme") !== "light"; } catch { return true; }
  });

  const width = useWindowWidth();
  const isDesktop = width >= 960;

  const theme = darkMode ? DARK : LIGHT;

  const toggleTheme = () => {
    setDarkMode(d => {
      try { localStorage.setItem("theme", d ? "light" : "dark"); } catch {}
      return !d;
    });
  };

  const navigate = (id) => { setTab(id); setDrawerOpen(false); };

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
          if (existing) return;
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
      case "config":        return <Configuration />;
      case "admin":         return <AdminPanel />;
      case "modeles":       return <Modeles />;
      case "courriers":     return <Courriers />;
      case "engagements":   return <Engagements pvs={pvs} />;
      case "journal":       return <JournalTerrain pvs={pvs} failles={failles} />;
      case "veille":        return <VeilleReglementaire />;
      case "stats-elus":    return <StatsElus />;
      case "carte":         return <CarteUrbanisme pvs={pvs} />;
      default: return null;
    }
  };

  // Badge d'alerte compact
  const alertBadges = (
    <>
      {urgentCount > 0 && (
        <div onClick={()=>navigate("pv")} style={{ background:theme.dangerBg,
          border:`1px solid ${theme.danger}55`, borderRadius:"6px",
          padding:"3px 8px", cursor:"pointer", flexShrink:0 }}>
          <span style={{ color:theme.danger, fontSize:"11px", fontWeight:600 }}>
            ! {urgentCount} recours
          </span>
        </div>
      )}
      {alertCount > 0 && (
        <div onClick={()=>navigate("failles")} style={{ background:theme.warningBg,
          border:`1px solid ${theme.warning}55`, borderRadius:"6px",
          padding:"3px 8px", cursor:"pointer", flexShrink:0 }}>
          <span style={{ color:theme.warning, fontSize:"11px", fontWeight:600 }}>
            ! {alertCount} faille{alertCount>1?"s":""}
          </span>
        </div>
      )}
    </>
  );

  // Logo + titre
  const logo = (
    <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
      <div style={{ width:"30px", height:"30px", background:theme.primaryBg,
        border:`1.5px solid ${theme.primary}`, borderRadius:"7px",
        display:"flex", alignItems:"center", justifyContent:"center",
        color:theme.primary, fontSize:"15px", fontWeight:700, flexShrink:0 }}>⬡</div>
      <div>
        <div style={{ color:theme.text, fontSize:"13px", fontWeight:700, lineHeight:1.2, whiteSpace:"nowrap" }}>
          Opposition Municipale
        </div>
        <div style={{ color:theme.textMuted, fontSize:"10px", letterSpacing:"0.06em", textTransform:"uppercase" }}>
          Fleurieux · 69210
        </div>
      </div>
    </div>
  );

  // Bouton thème
  const themeBtn = (
    <button onClick={toggleTheme} style={{
      background:theme.surfaceAlt, border:`1px solid ${theme.border}`,
      color:theme.textSec, width:"32px", height:"32px", borderRadius:"7px",
      cursor:"pointer", fontSize:"15px", display:"flex",
      alignItems:"center", justifyContent:"center", flexShrink:0,
    }}>
      {darkMode ? "☀" : "☾"}
    </button>
  );

  // Sidebar nav item
  const SideNavItem = ({ item, indent }) => {
    const active = tab === item.id;
    const hasBadge = (item.id === "failles" && alertCount > 0) ||
                     (item.id === "pv" && urgentCount > 0);
    const badgeNum = item.id === "failles" ? alertCount : urgentCount;
    return (
      <button onClick={()=>navigate(item.id)} style={{
        width:"100%", background:active ? theme.primaryBg : "transparent",
        border:`1px solid ${active ? theme.primary+"44" : "transparent"}`,
        borderRadius:"7px", padding:"8px 10px",
        display:"flex", alignItems:"center", gap:"9px",
        cursor:"pointer", textAlign:"left", fontFamily:"inherit",
        transition:"background 0.12s",
      }}>
        <span style={{ fontSize:"14px", width:"18px", textAlign:"center",
          color:active ? theme.primary : theme.textMuted, flexShrink:0 }}>{item.icon}</span>
        <span style={{ fontSize:"13px", fontWeight:active?600:400,
          color:active ? theme.text : theme.textSec, flex:1 }}>{item.label}</span>
        {hasBadge && (
          <span style={{ background:item.id==="pv"?theme.danger:theme.warning,
            color:"#fff", fontSize:"10px", fontWeight:700,
            borderRadius:"10px", padding:"1px 6px", flexShrink:0 }}>{badgeNum}</span>
        )}
      </button>
    );
  };

  // Sidebar content (partagée desktop + drawer mobile)
  const sidebarContent = (
    <div style={{ display:"flex", flexDirection:"column", gap:"4px", padding:"8px 12px", flex:1, overflowY:"auto" }}>
      {NAV_GROUPS.map(group => (
        <div key={group.label} style={{ marginBottom:"6px" }}>
          <p style={{ color:theme.textMuted, fontSize:"10px", fontWeight:700,
            textTransform:"uppercase", letterSpacing:"0.08em",
            padding:"8px 10px 4px", margin:0 }}>{group.label}</p>
          {group.items.map(item => <SideNavItem key={item.id} item={item} />)}
        </div>
      ))}
    </div>
  );

  // ── DESKTOP LAYOUT ──────────────────────────────────────────────────────────
  if (isDesktop) {
    return (
      <ThemeCtx.Provider value={theme}>
        <div style={{ display:"flex", minHeight:"100vh", background:theme.bg, color:theme.text,
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

          {/* Sidebar */}
          <aside style={{ width:"220px", minWidth:"220px", height:"100vh", position:"sticky", top:0,
            background:theme.nav, borderRight:`1px solid ${theme.navBorder}`,
            display:"flex", flexDirection:"column", overflow:"hidden" }}>
            {/* Logo */}
            <div style={{ padding:"16px 14px 12px", borderBottom:`1px solid ${theme.navBorder}` }}>
              {logo}
            </div>
            {/* Nav groups */}
            {sidebarContent}
            {/* Footer */}
            <div style={{ padding:"10px 12px 14px", borderTop:`1px solid ${theme.navBorder}`,
              display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <span style={{ color:theme.textMuted, fontSize:"10px" }}>v2.0</span>
              {themeBtn}
            </div>
          </aside>

          {/* Main */}
          <div style={{ flex:1, display:"flex", flexDirection:"column", minWidth:0 }}>
            {/* Top bar */}
            {(alertCount > 0 || urgentCount > 0) && (
              <div style={{ background:theme.nav, borderBottom:`1px solid ${theme.navBorder}`,
                padding:"8px 24px", display:"flex", gap:"8px", alignItems:"center" }}>
                {alertBadges}
              </div>
            )}
            {/* Content */}
            <div style={{ flex:1, padding:"24px", maxWidth:"1100px", width:"100%" }}>
              {renderContent()}
            </div>
          </div>
        </div>
      </ThemeCtx.Provider>
    );
  }

  // ── MOBILE / TABLET LAYOUT ──────────────────────────────────────────────────
  // Items bottom nav
  const allItems = NAV_GROUPS.flatMap(g => g.items);
  const bottomItems = BOTTOM_NAV.map(id => allItems.find(i => i.id === id)).filter(Boolean);

  return (
    <ThemeCtx.Provider value={theme}>
      <div style={{ minHeight:"100vh", background:theme.bg, color:theme.text,
        fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
        paddingBottom:"60px" }}>
        <style>{`
          * { box-sizing:border-box; margin:0; padding:0; }
          ::-webkit-scrollbar { width:4px; }
          ::-webkit-scrollbar-track { background:transparent; }
          ::-webkit-scrollbar-thumb { background:${theme.border}; border-radius:3px; }
          input::placeholder, textarea::placeholder { color:${theme.textMuted}; }
          input, textarea, button, select { outline:none; }
          @keyframes spin { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }
          @keyframes slideIn { from { transform:translateX(-100%); } to { transform:translateX(0); } }
        `}</style>

        {/* Top header mobile */}
        <div style={{ position:"sticky", top:0, zIndex:100,
          background:theme.nav, borderBottom:`1px solid ${theme.navBorder}`,
          padding:"0 16px", height:"52px",
          display:"flex", alignItems:"center", justifyContent:"space-between",
          boxShadow:`0 1px 4px rgba(0,0,0,${theme.mode==="dark"?0.3:0.06})` }}>
          {logo}
          <div style={{ display:"flex", gap:"6px", alignItems:"center" }}>
            {alertBadges}
            {themeBtn}
            {/* Burger */}
            <button onClick={()=>setDrawerOpen(o=>!o)} style={{
              background:theme.surfaceAlt, border:`1px solid ${theme.border}`,
              color:theme.textSec, width:"32px", height:"32px", borderRadius:"7px",
              cursor:"pointer", fontSize:"18px", display:"flex",
              alignItems:"center", justifyContent:"center" }}>
              {drawerOpen ? "✕" : "☰"}
            </button>
          </div>
        </div>

        {/* Drawer overlay */}
        {drawerOpen && (
          <div style={{ position:"fixed", inset:0, zIndex:200 }}
               onClick={()=>setDrawerOpen(false)}>
            <div style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.5)" }} />
            <div onClick={e=>e.stopPropagation()} style={{
              position:"absolute", top:0, left:0, bottom:0, width:"260px",
              background:theme.nav, borderRight:`1px solid ${theme.navBorder}`,
              display:"flex", flexDirection:"column",
              animation:"slideIn 0.2s ease-out",
            }}>
              <div style={{ padding:"14px 14px 12px", borderBottom:`1px solid ${theme.navBorder}`,
                display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                {logo}
                <button onClick={()=>setDrawerOpen(false)} style={{
                  background:"transparent", border:"none", color:theme.textMuted,
                  fontSize:"20px", cursor:"pointer", padding:"4px", lineHeight:1 }}>✕</button>
              </div>
              {sidebarContent}
            </div>
          </div>
        )}

        {/* Content */}
        <div style={{ padding:"16px" }}>
          {renderContent()}
        </div>

        {/* Bottom nav */}
        <div style={{ position:"fixed", bottom:0, left:0, right:0, zIndex:90,
          background:theme.nav, borderTop:`1px solid ${theme.navBorder}`,
          display:"flex", height:"60px",
          boxShadow:`0 -1px 8px rgba(0,0,0,${theme.mode==="dark"?0.3:0.06})` }}>
          {bottomItems.map(item => {
            const active = tab === item.id;
            const hasBadge = (item.id === "failles" && alertCount > 0) ||
                             (item.id === "pv" && urgentCount > 0);
            const badgeNum = item.id === "failles" ? alertCount : urgentCount;
            return (
              <button key={item.id} onClick={()=>navigate(item.id)} style={{
                flex:1, background:"transparent", border:"none",
                display:"flex", flexDirection:"column", alignItems:"center",
                justifyContent:"center", gap:"3px", cursor:"pointer",
                fontFamily:"inherit", position:"relative",
                borderTop:`2px solid ${active ? theme.primary : "transparent"}`,
              }}>
                <span style={{ fontSize:"18px", lineHeight:1,
                  color:active ? theme.primary : theme.textMuted }}>{item.icon}</span>
                <span style={{ fontSize:"9px", fontWeight:active?600:400,
                  color:active ? theme.primary : theme.textMuted, letterSpacing:"0.02em" }}>
                  {item.label.split(" ")[0]}
                </span>
                {hasBadge && (
                  <span style={{ position:"absolute", top:"6px", right:"calc(50% - 14px)",
                    background:item.id==="pv"?theme.danger:theme.warning,
                    color:"#fff", fontSize:"9px", fontWeight:700,
                    borderRadius:"8px", padding:"1px 4px", minWidth:"14px", textAlign:"center" }}>
                    {badgeNum}
                  </span>
                )}
              </button>
            );
          })}
          {/* Menu button */}
          <button onClick={()=>setDrawerOpen(o=>!o)} style={{
            flex:1, background:"transparent", border:"none",
            display:"flex", flexDirection:"column", alignItems:"center",
            justifyContent:"center", gap:"3px", cursor:"pointer",
            fontFamily:"inherit",
            borderTop:`2px solid transparent`,
          }}>
            <span style={{ fontSize:"18px", lineHeight:1, color:theme.textMuted }}>☰</span>
            <span style={{ fontSize:"9px", color:theme.textMuted }}>Menu</span>
          </button>
        </div>
      </div>
    </ThemeCtx.Provider>
  );
}
