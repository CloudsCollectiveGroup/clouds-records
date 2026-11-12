// Edge Function "push": verschickt Push-Mitteilungen an die Handys (Web-Push).
// Wird vom Datenbank-Trigger docs_push aufgerufen (siehe supabase/14_push.sql).
// Schlüssel liegen in public.push_config (nur Service-Rolle lesbar), nicht im Code.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "jsr:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const TEAM: Record<string, string> = { C: "cem", K: "kasper", N: "nikolina", TH: "torben" };
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
async function all(colName: string) { const { data } = await sb.from("docs").select("id,data").eq("col", colName).limit(5000); return (data || []).map((r: any) => ({ id: r.id, ...r.data })); }
async function morning() {
  const today = ymd(new Date()), tomorrow = ymd(new Date(Date.now() + 864e5));
  const [tasks, rels, studio, people, content] = await Promise.all([all("tasks"), all("releases"), all("studio"), all("people"), all("content")]);
  const R = Object.fromEntries(rels.map((r: any) => [r.id, r]));
  const due = (t: any) => { if (t.due) return t.due; const r = R[t.release]; if (!r?.date) return ""; const d = new Date(r.date + "T12:00:00"); d.setDate(d.getDate() - 7 * (PHASE_WEEKS[t.phase] ?? 0)); return ymd(d); };
  const { data: members } = await sb.from("members").select("user_id,username,role,person");
  const KEY: Record<string, string> = { cem: "C", kasper: "K", nikolina: "N", torben: "TH" };
  let sent = 0;
  for (const m of members || []) {
    const key = m.role === "producer" ? "P" : m.role === "artist" ? m.person : KEY[m.username];
    if (!key) continue;
    const isArtist = m.role === "artist";
    const mine = (t: any) => !t.done && (isArtist ? (t.owner === "A" && R[t.release]?.artist === key) : (t.owner === key || (t.helpers || []).includes(key)));
    const myTasks = tasks.filter(mine), over = myTasks.filter(t => due(t) && due(t) < today).length, now = myTasks.filter(t => due(t) === today).length;
    const ev: string[] = [];
    for (const day of [today, tomorrow]) {
      const tag = day === today ? "Heute" : "Morgen";
      for (const s of studio) if (s.date === day && s.status === "Bestätigt" && (isArtist ? s.artist === key : key === "C")) ev.push(`${tag} Studio ${s.time || ""}`.trim());
      for (const p of people) for (const x of (p.shoots || [])) if (x.date === day && (isArtist ? p.id === key : true)) ev.push(`${tag} Reel-Dreh ${x.time || ""}`.trim());
      for (const r of rels) for (const v of (r.video?.days || [])) if (v.date === day && (isArtist ? r.artist === key : true)) ev.push(`${tag} Musikvideo-Dreh ${v.time || ""}`.trim());
      if (day === today) for (const r of rels) if (r.date === day && (isArtist ? r.artist === key : true)) ev.push(`Heute Release: ${r.title || r.code}`);
    }
    if (!isArtist) { const posts = content.filter((c: any) => c.date === today && c.status !== "Live" && (c.owner === key || (c.helpers || []).includes(key))).length; if (posts) ev.push(`${posts} Post${posts > 1 ? "s" : ""} heute`); }
    const parts = [over ? `${over} überfällig` : "", now ? `${now} heute fällig` : "", ...[...new Set(ev)]].filter(Boolean);
    if (!parts.length || !(await allowed(m.user_id, "morning"))) continue;
    const { data: subs } = await sb.from("push_subs").select("endpoint,sub").eq("user_id", m.user_id);
    for (const s of subs || []) {
      try { await webpush.sendNotification(s.sub, JSON.stringify({ title: "Guten Morgen · Clouds Records", body: parts.join(" · "), tag: "morning" })); sent++; }
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
  const [rels, studio, people, content] = await Promise.all([all("releases"), all("studio"), all("people"), all("content")]);
  const R = Object.fromEntries(rels.map((r: any) => [r.id, r]));
  const due = (t: any) => { if (t.due) return t.due; const r = R[t.release]; if (!r?.date) return ""; const d = new Date(r.date + "T12:00:00"); d.setDate(d.getDate() - 7 * (PHASE_WEEKS[t.phase] ?? 0)); return ymd(d); };
  const { data: members } = await sb.from("members").select("user_id,username,role,person");
  const KEY: Record<string, string> = { cem: "C", kasper: "K", nikolina: "N", torben: "TH" };
  let sent = 0;
  for (const m of members || []) {
    const key = m.role === "producer" ? "P" : m.role === "artist" ? m.person : KEY[m.username];
    if (!key || !(await allowed(m.user_id, "weekly"))) continue;
    const isArtist = m.role === "artist";
    const scope = (t: any) => isArtist ? (t.owner === "A" && R[t.release]?.artist === key) : true;
    const mine = tasks.filter(scope);
    const done = mine.filter(t => t.done && t.at >= since).length, over = mine.filter(t => !t.done && due(t) && due(t) < today).length;
    let terms = 0;
    for (const r of rels) { if (isArtist && r.artist !== key) continue; if (r.date >= today && r.date <= in7) terms++; for (const v of (r.video?.days || [])) if (v.date >= today && v.date <= in7) terms++; }
    for (const s of studio) if ((!isArtist || s.artist === key) && s.status === "Bestätigt" && s.date >= today && s.date <= in7) terms++;
    for (const p of people) if (!isArtist || p.id === key) for (const x of (p.shoots || [])) if (x.date >= today && x.date <= in7) terms++;
    const posts = content.filter((c: any) => (!isArtist || c.artist === key) && c.date >= today && c.date <= in7).length;
    const body = [`${done} erledigt`, over ? `${over} überfällig` : "", terms ? `${terms} Termine nächste Woche` : "", posts ? `${posts} Posts geplant` : ""].filter(Boolean).join(" · ");
    const { data: subs } = await sb.from("push_subs").select("endpoint,sub").eq("user_id", m.user_id);
    for (const s of subs || []) {
      try { await webpush.sendNotification(s.sub, JSON.stringify({ title: isArtist ? "Deine Woche · Clouds Records" : "Wochenbericht · Clouds Records", body, tag: "weekly" })); sent++; }
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
  }
  if (col === "tasks") {
    const who = (k: string) => k === "A" ? d.artist : k;
    if (d.owner && !d.done && (op === "INSERT" || old?.owner !== d.owner) && (TEAM[d.owner] || d.owner === "A" || d.owner === "P"))
      out.push({ keys: [who(d.owner)], title: "Neue Aufgabe für dich", body: d.title || "", tag: "task" });
    const before = new Set(((old?.checks) || []).map((x: any) => `${x.t}|${x.o || ""}`));
    for (const x of (d.checks || [])) if (x.o && !x.d && !before.has(`${x.t}|${x.o}`))
      out.push({ keys: [who(x.o)], title: "Neuer Punkt für dich", body: `${x.t} · aus „${d.title}“`, tag: "task" });
  }
  // Chat: an alle, die in diesem Thread schon geschrieben haben, plus die Zuständigen der Karte
  const extraUsers: string[] = [];
  if (col === "chat" && op === "INSERT") {
    const [kind, rid] = String(d.ref || "").split(":");
    const keys = new Set<string>(); let title = "Karte";
    if (kind === "tasks" || kind === "content") {
      const { data: card } = await sb.from("docs").select("data").eq("col", kind).eq("id", rid).maybeSingle();
      const c: any = card?.data || {};
      title = c.title || c.kind || title;
      for (const k of [c.owner, ...(c.helpers || []), ...((c.checks || []).map((x: any) => x.o))]) if (k) keys.add(k === "A" ? (c.artist || d.artist) : k);
      if (kind === "content") { keys.add("C"); keys.add("N"); if (c.fromArtist) keys.add(c.artist || d.artist); }
    } else if (kind === "video") { title = "Musikvideo"; keys.add("C"); if (d.artist) keys.add(d.artist); }
    else if (kind === "studio") { title = "Studio-Anfrage"; keys.add("C"); if (d.artist) keys.add(d.artist); }
    else if (kind === "shoot") { title = "Reel-Drehtag"; keys.add("C"); keys.add("N"); if (d.artist) keys.add(d.artist); }
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
