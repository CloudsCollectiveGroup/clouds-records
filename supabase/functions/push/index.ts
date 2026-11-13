// Edge Function "push": verschickt Push-Mitteilungen an die Handys (Web-Push).
// Wird vom Datenbank-Trigger docs_push aufgerufen (siehe supabase/14_push.sql).
// Schlüssel liegen in public.push_config (nur Service-Rolle lesbar), nicht im Code.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "jsr:@supabase/supabase-js@2";

/* Checklisten-Punkt: mehrere Zuständige (os), sonst o */
const owners = (x: any): string[] => Array.isArray(x?.os) && x.os.length ? x.os : (x?.o ? [x.o] : []);

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const TEAM: Record<string, string> = { C: "cem", K: "kacper", N: "nikolina", TH: "torben" };
const fmt = (iso?: string) => iso ? iso.split("-").reverse().join(".") : "";

let cfg: Record<string, string> | null = null;
async function config() {
  if (cfg) return cfg;
  const { data } = await sb.from("push_config").select("k,v");
  cfg = Object.fromEntries((data || []).map((r: any) => [r.k, r.v]));
  if (!cfg.vapid_public || !cfg.vapid_private) {   // erster Aufruf: Schlüsselpaar einmalig erzeugen
    const k = webpush.generateVAPIDKeys();
    await sb.from("push_config").upsert([{ k: "vapid_public", v: k.publicKey }, { k: "vapid_private", v: k.privateKey }]);
    cfg.vapid_public = k.publicKey; cfg.vapid_private = k.privateKey;
  }
  webpush.setVapidDetails("mailto:management@cloudsgroup.de", cfg.vapid_public, cfg.vapid_private);
  return cfg;
}
async function personName(id: string) {
  const { data } = await sb.from("docs").select("data").eq("col", "people").eq("id", id).maybeSingle();
  return (data?.data as any)?.name || id;
}
// Empfänger-Schlüssel (C, K, N, TH, P oder Artist-ID) → Benutzer-IDs
async function usersFor(keys: string[]) {
  const names = keys.map(k => TEAM[k]).filter(Boolean);
  const persons = keys.filter(k => !TEAM[k] && k !== "P" && k !== "A");
  const ids = new Set<string>();
  if (names.length) (await sb.from("members").select("user_id").in("username", names)).data?.forEach((r: any) => ids.add(r.user_id));
  if (persons.length) (await sb.from("members").select("user_id").in("person", persons)).data?.forEach((r: any) => ids.add(r.user_id));
  if (keys.includes("P")) (await sb.from("members").select("user_id").eq("role", "producer")).data?.forEach((r: any) => ids.add(r.user_id));
  return [...ids];
}

// Mitteilungs-Einstellungen pro Person (user_metadata.push.<kategorie> = false → aus)
const prefCache: Record<string, any> = {};
async function allowed(uid: string, tag: string) {
  const cat = tag.startsWith("chat") ? "chat" : tag;
  if (!(uid in prefCache)) { const { data } = await sb.auth.admin.getUserById(uid); prefCache[uid] = data?.user?.user_metadata?.push || {}; }
  return prefCache[uid][cat] !== false;
}
// Morgen-Erinnerung: pro Person überfällige / heute fällige Aufgaben und Termine von heute und morgen
const PHASE_WEEKS: Record<string, number> = { "T-12": 12, "T-10": 10, "T-8": 8, "T-6": 6, "T-4": 4, "T-2": 2, "T-0": 0, "Nach Release": -2 };
const ymd = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
// Aufgaben & Termine ohne Release: Beteiligte (A = Artist der Karte)
const todoKeys = (x: any) => [x?.owner, ...((x?.helpers) || [])].filter((k: string) => k && k !== "T" && (k !== "A" || x?.artist)).map((k: string) => k === "A" ? x.artist : k);
async function all(colName: string) { const { data } = await sb.from("docs").select("id,data").eq("col", colName).limit(5000); return (data || []).map((r: any) => ({ id: r.id, ...r.data })); }
async function morning() {
  const today = ymd(new Date()), tomorrow = ymd(new Date(Date.now() + 864e5));
  const [tasks, rels, studio, people, content, todos, gigs] = await Promise.all([all("tasks"), all("releases"), all("studio"), all("people"), all("content"), all("todos"), all("gigs")]);
  const R = Object.fromEntries(rels.map((r: any) => [r.id, r]));
  const due = (t: any) => { if (t.due) return t.due; const r = R[t.release]; if (!r?.date) return ""; const d = new Date(r.date + "T12:00:00"); d.setDate(d.getDate() - 7 * (PHASE_WEEKS[t.phase] ?? 0)); return ymd(d); };
  const { data: members } = await sb.from("members").select("user_id,username,role,person");
  const KEY: Record<string, string> = { cem: "C", kacper: "K", nikolina: "N", torben: "TH" };
  let sent = 0;
  for (const m of members || []) {
    const key = m.role === "producer" ? "P" : m.role === "artist" ? m.person : KEY[m.username];
    if (!key) continue;
    const isArtist = m.role === "artist";
    const mine = (t: any) => !t.done && (isArtist ? (t.owner === "A" && R[t.release]?.artist === key) : (t.owner === key || (t.helpers || []).includes(key)));
    const myTodos = todos.filter((x: any) => x.kind !== "Termin" && !x.done && todoKeys(x).includes(key)).map((x: any) => ({ due: x.due }));
    const myTasks = [...tasks.filter(mine), ...myTodos], over = myTasks.filter(t => due(t) && due(t) < today).length, now = myTasks.filter(t => due(t) === today).length;
    const ev: string[] = [];
    for (const day of [today, tomorrow]) {
      const tag = day === today ? "Heute" : "Morgen";
      for (const s of studio) if (s.date === day && s.status === "Bestätigt" && (isArtist ? s.artist === key : key === "C")) ev.push(`${tag} Studio ${s.time || ""}`.trim());
      for (const p of people) for (const x of (p.shoots || [])) if (x.date === day && (isArtist ? p.id === key : true)) ev.push(`${tag} ${x.type === "photo" ? "Fotoshooting" : "Reel-Dreh"} ${x.time || ""}`.trim());
      for (const r of rels) for (const vd of (r.video?.days || [])) if (vd.date === day && (isArtist ? r.artist === key : true)) ev.push(`${tag} Musikvideo-Dreh ${vd.time || ""}`.trim());
      for (const x of todos) if (x.kind === "Termin" && x.date === day && todoKeys(x).includes(key)) ev.push(`${tag} ${x.title}${x.time ? " " + x.time : ""}`);
      for (const g of gigs) if (g.date === day && g.req !== "offen" && g.req !== "abgelehnt" && g.status !== "Abgesagt" && (isArtist ? (g.artist === key || (g.co || []).includes(key)) : true)) ev.push(`${tag} Live: ${g.title || "Auftritt"}${g.stage ? " · Stage " + g.stage : ""}`);
      if (day === today) for (const r of rels) if (r.date === day && (isArtist ? r.artist === key : true)) ev.push(`Heute Release: ${r.title || r.code}`);
    }
    if (!isArtist) { const posts = content.filter((c: any) => c.date === today && c.status !== "Live" && (c.owner === key || (c.helpers || []).includes(key))).length; if (posts) ev.push(`${posts} Post${posts > 1 ? "s" : ""} heute`); }
    const parts = [over ? `${over} überfällig` : "", now ? `${now} heute fällig` : "", ...[...new Set(ev)]].filter(Boolean);
    if (!parts.length || !(await allowed(m.user_id, "morning"))) continue;
    const { data: subs } = await sb.from("push_subs").select("endpoint,sub").eq("user_id", m.user_id);
    for (const s of subs || []) {
      try { await webpush.sendNotification(s.sub, JSON.stringify({ title: "Guten Morgen · CloudsRecords", body: parts.join(" · "), tag: "morning" })); sent++; }
      catch (e: any) { if ([404, 410].includes(e?.statusCode)) await sb.from("push_subs").delete().eq("endpoint", s.endpoint); }
    }
  }
  return `morgen: ${sent}`;
}

// Wochenbericht freitags: erledigt in 7 Tagen, offen/überfällig, Termine nächste 7 Tage
async function weekly() {
  const today = ymd(new Date()), in7 = ymd(new Date(Date.now() + 7 * 864e5)), since = new Date(Date.now() - 7 * 864e5).toISOString();
  const { data: trows } = await sb.from("docs").select("id,data,updated_at").eq("col", "tasks").limit(5000);
  const tasks = (trows || []).map((r: any) => ({ id: r.id, at: r.updated_at, ...r.data }));
  const [rels, studio, people, content, todos] = await Promise.all([all("releases"), all("studio"), all("people"), all("content"), all("todos")]);
  const R = Object.fromEntries(rels.map((r: any) => [r.id, r]));
  const due = (t: any) => { if (t.due) return t.due; const r = R[t.release]; if (!r?.date) return ""; const d = new Date(r.date + "T12:00:00"); d.setDate(d.getDate() - 7 * (PHASE_WEEKS[t.phase] ?? 0)); return ymd(d); };
  const { data: members } = await sb.from("members").select("user_id,username,role,person");
  const KEY: Record<string, string> = { cem: "C", kacper: "K", nikolina: "N", torben: "TH" };
  let sent = 0;
  for (const m of members || []) {
    const key = m.role === "producer" ? "P" : m.role === "artist" ? m.person : KEY[m.username];
    if (!key || !(await allowed(m.user_id, "weekly"))) continue;
    const isArtist = m.role === "artist";
    const scope = (t: any) => isArtist ? (t.owner === "A" && R[t.release]?.artist === key) : true;
    const tds = todos.filter((x: any) => x.kind !== "Termin" && (isArtist ? todoKeys(x).includes(key) : true)).map((x: any) => ({ done: x.done, at: x.doneAt || "", due: x.due }));
    const mine = [...tasks.filter(scope), ...tds];
    const done = mine.filter(t => t.done && t.at >= since).length, over = mine.filter(t => !t.done && due(t) && due(t) < today).length;
    let terms = 0;
    for (const r of rels) { if (isArtist && r.artist !== key) continue; if (r.date >= today && r.date <= in7) terms++; for (const v of (r.video?.days || [])) if (v.date >= today && v.date <= in7) terms++; }
    for (const s of studio) if ((!isArtist || s.artist === key) && s.status === "Bestätigt" && s.date >= today && s.date <= in7) terms++;
    for (const p of people) if (!isArtist || p.id === key) for (const x of (p.shoots || [])) if (x.date >= today && x.date <= in7) terms++;
    for (const x of todos) if (x.kind === "Termin" && x.date >= today && x.date <= in7 && (!isArtist || todoKeys(x).includes(key))) terms++;
    const posts = content.filter((c: any) => (!isArtist || c.artist === key) && c.date >= today && c.date <= in7).length;
    const body = [`${done} erledigt`, over ? `${over} überfällig` : "", terms ? `${terms} Termine nächste Woche` : "", posts ? `${posts} Posts geplant` : ""].filter(Boolean).join(" · ");
    const { data: subs } = await sb.from("push_subs").select("endpoint,sub").eq("user_id", m.user_id);
    for (const s of subs || []) {
      try { await webpush.sendNotification(s.sub, JSON.stringify({ title: isArtist ? "Deine Woche · CloudsRecords" : "Wochenbericht · CloudsRecords", body, tag: "weekly" })); sent++; }
      catch (e: any) { if ([404, 410].includes(e?.statusCode)) await sb.from("push_subs").delete().eq("endpoint", s.endpoint); }
    }
  }
  return `woche: ${sent}`;
}

Deno.serve(async (req) => {
  const c = await config();
  if (new URL(req.url).searchParams.has("init")) return new Response("bereit");
  if (req.headers.get("x-push-secret") !== c.secret) return new Response("forbidden", { status: 403 });
  const { op, col, data: d, old, by } = await req.json();
  if (op === "CRON") return new Response(await morning());
  if (op === "WEEKLY") return new Response(await weekly());
  const out: { keys: string[]; title: string; body: string; tag: string }[] = [];

  if (col === "notes" && op === "INSERT") {
    out.push({ keys: d.to || [], title: `Nachricht von ${d.from || "Team"}`, body: String(d.text || "").slice(0, 160), tag: "note" });
  }
  if (col === "studio") {
    const a = await personName(d.artist);
    if (op === "INSERT") out.push({ keys: ["C"], title: `Studio-Anfrage · ${a}`, body: `${fmt(d.date)}${d.time ? " · " + d.time : ""} · ${d.hours || "?"} h · ${d.room || ""}`, tag: "studio" });
    if (op === "UPDATE" && old?.status !== d.status && ["Bestätigt", "Abgelehnt"].includes(d.status))
      out.push({ keys: [d.artist], title: `Studio ${d.status.toLowerCase()}`, body: `${fmt(d.date)}${d.time ? " · " + d.time : ""} · ${d.room || ""}`, tag: "studio" });
    if (op === "UPDATE" && old?.status !== d.status && d.status === "Bestätigt" && (d.guests || []).length)
      out.push({ keys: d.guests, title: `Studio mit ${await personName(d.artist)}`, body: `${fmt(d.date)}${d.time ? " · " + d.time : ""} · ${d.room || ""} · du bist dabei`, tag: "studio" });
  }
  if (col === "tasks") {
    const who = (k: string) => k === "A" ? d.artist : k;
    if (d.owner && !d.done && (op === "INSERT" || old?.owner !== d.owner) && (TEAM[d.owner] || d.owner === "A" || d.owner === "P"))
      out.push({ keys: [who(d.owner)], title: "Neue Aufgabe für dich", body: d.title || "", tag: "task" });
    const before = new Set(((old?.checks) || []).flatMap((x: any) => owners(x).map((o: string) => `${x.t}|${o}`)));
    for (const x of (d.checks || [])) if (!x.d) for (const o of owners(x)) if (!before.has(`${x.t}|${o}`))
      out.push({ keys: [who(o)], title: "Neuer Punkt für dich", body: `${x.t} · aus „${d.title}“`, tag: "task" });
  }
  if (col === "todos") {
    const term = d.kind === "Termin";
    const now = todoKeys(d), before = op === "UPDATE" ? todoKeys(old) : [];
    const added = now.filter((k: string) => !before.includes(k));
    const when = term ? `${fmt(d.date)}${d.time ? " · " + d.time : ""}${d.place ? " · " + d.place : ""}` : (d.due ? "bis " + fmt(d.due) : "");
    if (!d.done && added.length) out.push({ keys: added, title: term ? `Neuer Termin: ${d.title}` : "Neue Aufgabe für dich", body: term ? when : `${d.title}${when ? " · " + when : ""}`, tag: "task" });
    if (term && op === "UPDATE" && (old?.date !== d.date || old?.time !== d.time || old?.place !== d.place)) {
      const rest = now.filter((k: string) => before.includes(k)); if (rest.length) out.push({ keys: rest, title: `Termin geändert: ${d.title}`, body: when, tag: "task" });
    }
    const bc = new Set(((old?.checks) || []).flatMap((x: any) => owners(x).map((o: string) => `${x.t}|${o}`)));
    for (const x of (d.checks || [])) if (!x.d) for (const o of owners(x)) if (!bc.has(`${x.t}|${o}`) && (o !== "A" || d.artist))
      out.push({ keys: [o === "A" ? d.artist : o], title: "Neuer Punkt für dich", body: `${x.t} · aus „${d.title}“`, tag: "task" });
  }
  // Live: Auftritte & Shows
  if (col === "gigs") {
    const a = await personName(d.artist);
    const when = `${fmt(d.date)}${d.stage ? " · Stage " + d.stage : ""}${d.venue ? " · " + d.venue : ""}`;
    const ev = d.title || "Auftritt";
    if (op === "INSERT" && d.req === "offen") out.push({ keys: ["C", "TH"], title: `Auftritts-Anfrage · ${a}`, body: `${ev} · ${when}`, tag: "gig" });
    else if (op === "INSERT") out.push({ keys: [d.artist], title: `Neuer Auftritt: ${ev}`, body: when, tag: "gig" });
    if (op === "UPDATE" && old?.req === "offen" && d.req === "ok") out.push({ keys: [d.artist], title: `Auftritt angenommen: ${ev}`, body: when, tag: "gig" });
    if (op === "UPDATE" && old?.req === "offen" && d.req === "abgelehnt") out.push({ keys: [d.artist], title: `Auftritt abgelehnt: ${ev}`, body: d.reqNote || when, tag: "gig" });
    const co: string[] = (d.co || []), coOld: string[] = op === "UPDATE" ? (old?.co || []) : [];
    if (d.req !== "offen" && d.req !== "abgelehnt") for (const c of co) if (!coOld.includes(c) || (op === "UPDATE" && old?.req === "offen" && d.req === "ok"))
      out.push({ keys: [c], title: `Du bist dabei: ${a} · ${ev}`, body: `${(d.coRole || {})[c] || "Co-Artist"} · ${when}`, tag: "gig" });
    if (op === "UPDATE" && d.req !== "offen" && (old?.date !== d.date || old?.stage !== d.stage || old?.getin !== d.getin || old?.venue !== d.venue))
      out.push({ keys: [d.artist, ...co.filter((c: string) => coOld.includes(c)), "C", "TH"], title: `Auftritt geändert: ${ev}`, body: when, tag: "gig" });
    const ob = new Set(((old?.checks) || []).flatMap((x: any) => owners(x).map((o: string) => `${x.t}|${o}`)));
    for (const x of (d.checks || [])) if (!x.d) for (const o of owners(x)) if (!ob.has(`${x.t}|${o}`))
      out.push({ keys: [o === "A" ? d.artist : o], title: "Neuer Punkt für dich", body: `${x.t} · aus „${ev}“`, tag: "gig" });
  }
  // Kampagnen: Freigabe durch Cem + Thorben
  if (col === "releases" && op === "UPDATE") {
    const APPR: Record<string, string> = { C: "Cem", TH: "Thorben" };
    const oc: any[] = old?.camps || [], nc: any[] = d.camps || [];
    const a = await personName(d.artist), rt = d.title || d.code || "Release";
    const ok = (c: any, k: string) => { const x = c?.apv?.[k]; return x && String(x.amt ?? "") === String(c.budget ?? "") ? x : null; };
    for (const c of nc) {
      const o = oc.find((x: any) => x.id === c.id);
      const label = `${a} · ${rt} · ${c.platform || "Kampagne"}${c.budget ? " · " + c.budget + " €" : ""}`;
      if (!o) { out.push({ keys: ["C", "TH"], title: "Kampagne zur Freigabe", body: label, tag: "camp" }); continue; }
      if (String(o.budget ?? "") !== String(c.budget ?? "") && (ok(o, "C") || ok(o, "TH")))
        out.push({ keys: ["C", "TH"], title: "Budget geändert · neu freigeben", body: label, tag: "camp" });
      for (const k of Object.keys(APPR)) {
        const n = c.apv?.[k], p = o.apv?.[k];
        if (n && n.at !== p?.at) {
          const other = Object.keys(APPR).filter(x => x !== k);
          out.push({ keys: [...owners(c), ...other], title: `Kampagne ${n.v === "ok" ? "genehmigt" : "abgelehnt"} von ${APPR[k]}`, body: label, tag: "camp" });
        }
      }
      if (ok(c, "C")?.v === "ok" && ok(c, "TH")?.v === "ok" && !(ok(o, "C")?.v === "ok" && ok(o, "TH")?.v === "ok"))
        out.push({ keys: owners(c).length ? owners(c) : ["K"], title: "Kampagne freigegeben ✓", body: label + " · kann starten", tag: "camp" });
    }
  }
  // Kaufanfragen: bis 100 € reicht Cem oder Thorben, darüber beide (nie die eigene)
  if (col === "expenses" && d.kind === "req") {
    const APPR: Record<string, string> = { C: "Cem", TH: "Thorben" };
    const need = Object.keys(APPR).filter(k => k !== d.byKey);
    const okOf = (x: any, k: string) => { const a = x?.apv?.[k]; return a && String(a.amt ?? "") === String(x.amt ?? "") ? a : null; };
    const state = (x: any) => { if (x?.status === "gekauft") return "done"; const r = need.map(k => okOf(x, k)); if (r.some(a => a?.v === "no")) return "no"; const n = r.filter(a => a?.v === "ok").length; return n >= (Number(String(x?.amt ?? "0").replace(",", ".")) > 100 ? need.length : Math.min(1, need.length)) ? "ok" : "open"; };
    const label = `${d.title || "Kaufanfrage"} · ${d.amt || "?"} € · von ${d.by || "Team"}`;
    if (op === "INSERT") out.push({ keys: need, title: "Kaufanfrage zur Freigabe", body: label, tag: "camp" });
    if (op === "UPDATE") {
      for (const k of need) { const n = d.apv?.[k], p = old?.apv?.[k]; if (n && n.at !== p?.at) out.push({ keys: need.filter(x => x !== k), title: `Kaufanfrage ${n.v === "ok" ? "genehmigt" : "abgelehnt"} von ${APPR[k]}`, body: label, tag: "camp" }); }
      const s0 = state(old), s1 = state(d);
      if (s1 !== s0 && (s1 === "ok" || s1 === "no") && d.byKey) out.push({ keys: [d.byKey], title: s1 === "ok" ? "Genehmigt ✓ · du kannst kaufen" : "Kaufanfrage abgelehnt", body: label, tag: "camp" });
      if (String(old?.amt ?? "") !== String(d.amt ?? "") && d.status !== "gekauft" && need.some(k => old?.apv?.[k])) out.push({ keys: need, title: "Betrag geändert · neu freigeben", body: label, tag: "camp" });
    }
  }
  // Anfragen von Artists: Kategorie → zuständig → Freigabe Cem/Thorben (bis 100 € einer, darüber beide)
  if (col === "asks") {
    const a = await personName(d.artist), own = d.owner === "CT" ? ["C", "TH"] : [d.owner];
    const label = `${a} · ${d.title || "Anfrage"}${d.offer?.amt ? " · " + d.offer.amt + " €" : ""}`;
    if (op === "INSERT") out.push({ keys: own, title: `Neue Anfrage von ${a}`, body: d.title || "", tag: "camp" });
    if (op === "UPDATE" && old?.status !== d.status) {
      if (d.status === "freigabe") { out.push({ keys: ["C", "TH"], title: "Anfrage zur Freigabe", body: label, tag: "camp" }); out.push({ keys: [d.artist], title: "Kostenvoranschlag ist da", body: label, tag: "camp" }); }
      if (d.status === "genehmigt") out.push({ keys: [d.artist, ...own], title: "Anfrage genehmigt ✓", body: label, tag: "camp" });
      if (d.status === "abgelehnt") out.push({ keys: [d.artist, ...own], title: "Anfrage abgelehnt", body: label, tag: "camp" });
      if (d.status === "umgesetzt") out.push({ keys: [d.artist], title: "Anfrage umgesetzt", body: label, tag: "camp" });
    }
    if (op === "UPDATE" && d.status === "freigabe") for (const k of ["C", "TH"]) { const n = d.apv?.[k], p = old?.apv?.[k]; if (n && n.at !== p?.at) out.push({ keys: ["C", "TH"].filter(x => x !== k), title: `Anfrage ${n.v === "ok" ? "genehmigt" : "abgelehnt"} von ${k === "C" ? "Cem" : "Thorben"}`, body: label, tag: "camp" }); }
  }
  // Chat: an alle, die in diesem Thread schon geschrieben haben, plus die Zuständigen der Karte
  const extraUsers: string[] = [];
  if (col === "chat" && op === "INSERT") {
    const [kind, rid] = String(d.ref || "").split(":");
    const keys = new Set<string>(); let title = "Karte";
    if (kind === "tasks" || kind === "content" || kind === "todos") {
      const { data: card } = await sb.from("docs").select("data").eq("col", kind).eq("id", rid).maybeSingle();
      const c: any = card?.data || {};
      title = c.title || c.kind || title;
      for (const k of [c.owner, ...(c.helpers || []), ...((c.checks || []).flatMap((x: any) => owners(x)))]) if (k) keys.add(k === "A" ? (c.artist || d.artist) : k);
      if (kind === "content") { keys.add("C"); keys.add("N"); keys.add("TH"); if (c.fromArtist) keys.add(c.artist || d.artist); }
    } else if (kind === "video") { title = "Musikvideo"; keys.add("C"); if (d.artist) keys.add(d.artist); }
    else if (kind === "ask") {
      const { data: ad } = await sb.from("docs").select("data").eq("col", "asks").eq("id", rid).maybeSingle();
      const x: any = ad?.data || {};
      title = "Anfrage · " + (x.title || ""); if (x.artist) keys.add(x.artist);
      for (const k of (x.owner === "CT" ? ["C", "TH"] : [x.owner])) if (k) keys.add(k);
      if (["freigabe", "genehmigt", "abgelehnt"].includes(x.status)) { keys.add("C"); keys.add("TH"); }
    }
    else if (kind === "studio") { title = "Studio-Anfrage"; keys.add("C"); if (d.artist) keys.add(d.artist); }
    else if (kind === "gig") {
      const { data: gd } = await sb.from("docs").select("data").eq("col", "gigs").eq("id", rid).maybeSingle();
      const g: any = gd?.data || {};
      title = g.title || "Auftritt"; keys.add("C"); keys.add("TH"); if (d.artist) keys.add(d.artist); for (const c of (g.co || [])) keys.add(c);
      for (const x of (g.checks || [])) for (const o of owners(x)) keys.add(o === "A" ? d.artist : o);
    }
    else if (kind === "shoot") {
      const sid = String(d.ref || "").split(":")[2];
      const { data: pd } = await sb.from("docs").select("data").eq("col", "people").eq("id", rid).maybeSingle();
      const sh: any = ((pd?.data as any)?.shoots || []).find((x: any) => x.id === sid);
      title = sh?.type === "photo" ? "Fotoshooting" : "Reel-Drehtag"; keys.add("C"); keys.add("N"); if (d.artist) keys.add(d.artist);
    }
    keys.delete("T");
    const { data: prev } = await sb.from("docs").select("data").eq("col", "chat").eq("data->>ref", d.ref);
    (prev || []).forEach((m: any) => { if (m.data?.byId) extraUsers.push(m.data.byId); });
    out.push({ keys: [...keys], title: `${d.by || "Jemand"} · ${title}`, body: String(d.text || "").slice(0, 160), tag: "chat-" + d.ref });
  }
  if (!out.length) return new Response("nichts");

  let sent = 0;
  for (const m of out) {
    const cand = [...new Set([...(await usersFor(m.keys)), ...(m.tag.startsWith("chat-") ? extraUsers : [])])].filter(u => u !== by && u !== d.byId);
    const users: string[] = []; for (const u of cand) if (await allowed(u, m.tag)) users.push(u);
    if (!users.length) continue;
    const { data: subs } = await sb.from("push_subs").select("endpoint,sub").in("user_id", users);
    for (const s of subs || []) {
      try { await webpush.sendNotification(s.sub, JSON.stringify({ title: m.title, body: m.body, tag: m.tag })); sent++; }
      catch (e: any) { if ([404, 410].includes(e?.statusCode)) await sb.from("push_subs").delete().eq("endpoint", s.endpoint); }
    }
  }
  return new Response(`gesendet: ${sent}`);
});
