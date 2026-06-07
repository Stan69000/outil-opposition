const BASE = "/api";

async function req(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

export const api = {
  pvs: {
    list:   ()          => req("GET",    "/pvs"),
    create: (data)      => req("POST",   "/pvs", data),
    update: (id, data)  => req("PUT",    `/pvs/${id}`, data),
    remove: (id)        => req("DELETE", `/pvs/${id}`),
  },
  failles: {
    list:   ()          => req("GET",    "/failles"),
    create: (data)      => req("POST",   "/failles", data),
    update: (id, data)  => req("PUT",    `/failles/${id}`, data),
    remove: (id)        => req("DELETE", `/failles/${id}`),
  },
  lois: {
    list:   ()          => req("GET",    "/lois"),
    create: (data)      => req("POST",   "/lois", data),
    update: (id, data)  => req("PUT",    `/lois/${id}`, data),
    remove: (id)        => req("DELETE", `/lois/${id}`),
  },
  ai:         (prompt, context, mode) => req("POST", "/ai", { prompt, context, mode }),
  syncMairie: ()                      => req("GET",  "/mairie/sync"),
  legifrance: {
    search: (q, fond, page, pageSize) =>
      req("GET", `/legifrance/search?q=${encodeURIComponent(q)}${fond?`&fond=${fond}`:""}${page?`&page=${page}`:""}${pageSize?`&pageSize=${pageSize}`:""}`),
    article: (cid)  => req("GET", `/legifrance/article/${cid}`),
    ping:    ()     => req("GET", "/legifrance/ping"),
  },
  pdf: {
    analyze:     (pvId, pdfUrl, pdfNom) => req("POST", "/pdf/analyze", { pvId, pdfUrl, pdfNom }),
    exportWord:  (titre, contenu, sous_titre) => fetch("/api/pdf/export-word", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ titre, contenu, sous_titre }),
    }).then(r => r.blob()),
  },
  analyses: {
    patterns:   ()      => req("GET", "/analyses/patterns"),
    budget:     ()      => req("GET", "/analyses/budget"),
    seancePrep: (date)  => req("GET", `/analyses/seance-prep${date ? `?date=${date}` : ""}`),
    rapport:    ()      => req("GET", "/analyses/rapport"),
    syncLog:    ()      => req("GET", "/analyses/sync-log"),
    elus:       ()      => req("GET", "/analyses/elus"),
  },
  jurisprudence: {
    search: (q, juridiction) =>
      req("GET", `/jurisprudence/search?q=${encodeURIComponent(q)}${juridiction?`&juridiction=${juridiction}`:""}`),
  },
  // ── NOUVELLES ROUTES ──────────────────────────────────────────────────────────
  live: {
    list:        ()              => req("GET",    "/live"),
    create:      (data)          => req("POST",   "/live", data),
    update:      (id, data)      => req("PUT",    `/live/${id}`, data),
    remove:      (id)            => req("DELETE", `/live/${id}`),
    addPoint:    (id, data)      => req("POST",   `/live/${id}/points`, data),
    updatePoint: (id, pid, data) => req("PUT",    `/live/${id}/points/${pid}`, data),
    deletePoint: (id, pid)       => req("DELETE", `/live/${id}/points/${pid}`),
    export:      (id)            => req("POST",   `/live/${id}/export`),
  },
  questions: {
    list:     ()         => req("GET",    "/questions"),
    create:   (data)     => req("POST",   "/questions", data),
    update:   (id, data) => req("PUT",    `/questions/${id}`, data),
    remove:   (id)       => req("DELETE", `/questions/${id}`),
    generate: (data)     => req("POST",   "/questions/generate", data),
    relance:  (id)       => req("POST",   `/questions/${id}/relance`),
  },
  cada: {
    list:     ()         => req("GET",    "/cada"),
    create:   (data)     => req("POST",   "/cada", data),
    update:   (id, data) => req("PUT",    `/cada/${id}`, data),
    remove:   (id)       => req("DELETE", `/cada/${id}`),
    generate: (data)     => req("POST",   "/cada/generate", data),
  },
  agenda: {
    current: () => req("GET", "/agenda/current"),
    predict: () => req("GET", "/agenda/predict"),
  },
  benchmark: {
    compare: ()  => req("GET", "/benchmark/compare"),
    analyse: ()  => req("GET", "/benchmark/analyse"),
  },
  push: {
    vapidKey:    ()     => req("GET",    "/push/vapid-key"),
    subscribe:   (sub)  => req("POST",   "/push/subscribe", sub),
    unsubscribe: (data) => req("DELETE", "/push/subscribe", data),
    test:        ()     => req("POST",   "/push/test"),
  },
  config: {
    get:         ()     => req("GET",  "/config"),
    save:        (data) => req("POST", "/config", data),
    testAI:      ()     => req("POST", "/config/test/ai"),
    testLF:      ()     => req("POST", "/config/test/legifrance"),
    testSMTP:    ()     => req("POST", "/config/test/smtp"),
  },
  // ── ROUTES v3 ────────────────────────────────────────────────────────────────
  modeles: {
    list:     ()         => req("GET",    "/modeles"),
    create:   (data)     => req("POST",   "/modeles", data),
    update:   (id, data) => req("PUT",    `/modeles/${id}`, data),
    remove:   (id)       => req("DELETE", `/modeles/${id}`),
    generate: (data)     => req("POST",   "/modeles/generate", data),
  },
  courriers: {
    list:     ()         => req("GET",    "/courriers"),
    create:   (data)     => req("POST",   "/courriers", data),
    update:   (id, data) => req("PUT",    `/courriers/${id}`, data),
    remove:   (id)       => req("DELETE", `/courriers/${id}`),
    generate: (data)     => req("POST",   "/courriers/generate", data),
    envoyer:  (id)       => req("POST",   `/courriers/${id}/envoyer`),
  },
  engagements: {
    list:     ()         => req("GET",    "/engagements"),
    create:   (data)     => req("POST",   "/engagements", data),
    update:   (id, data) => req("PUT",    `/engagements/${id}`, data),
    remove:   (id)       => req("DELETE", `/engagements/${id}`),
  },
  journal: {
    list:     ()         => req("GET",    "/journal"),
    create:   (data)     => req("POST",   "/journal", data),
    update:   (id, data) => req("PUT",    `/journal/${id}`, data),
    remove:   (id)       => req("DELETE", `/journal/${id}`),
  },
  veille: {
    list:        ()    => req("GET",  "/veille"),
    unreadCount: ()    => req("GET",  "/veille/unread-count"),
    scan:        ()    => req("POST", "/veille/scan"),
    markRead:    (id)  => req("PUT",  `/veille/${id}/lu`),
    markAllRead: ()    => req("POST", "/veille/mark-all-read"),
    remove:      (id)  => req("DELETE", `/veille/${id}`),
  },
};
