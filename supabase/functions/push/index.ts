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

Deno.serve(async (req) => {
  const c = await config();
  if (new URL(req.url).searchParams.has("init")) return new Response("bereit");
  if (req.headers.get("x-push-secret") !== c.secret) return new Response("forbidden", { status: 403 });
  const { op, col, data: d, old, by } = await req.json();
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
  if (!out.length) return new Response("nichts");

  let sent = 0;
  for (const m of out) {
    const users = (await usersFor(m.keys)).filter(u => u !== by);
    if (!users.length) continue;
    const { data: subs } = await sb.from("push_subs").select("endpoint,sub").in("user_id", users);
    for (const s of subs || []) {
      try { await webpush.sendNotification(s.sub, JSON.stringify({ title: m.title, body: m.body, tag: m.tag })); sent++; }
      catch (e: any) { if ([404, 410].includes(e?.statusCode)) await sb.from("push_subs").delete().eq("endpoint", s.endpoint); }
    }
  }
  return new Response(`gesendet: ${sent}`);
});
