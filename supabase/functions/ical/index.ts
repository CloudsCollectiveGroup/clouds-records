// Edge Function "ical": Kalender-Abo (webcal/iCal) pro Person.
// Aufruf: /functions/v1/ical?t=<geheimer Schlüssel>  (JWT-Prüfung AUS – Kalender-Apps senden keinen Login)
// Persönlich = genau das, was die Person in der App unter „Nur meine“ sieht (Studio nur bestätigt).
// Label (nur Cem & Thorben) = alle Artists.
import { createClient } from "jsr:@supabase/supabase-js@2";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const TEAM_BY_USER: Record<string, string> = { cem: "C", kacper: "K", nikolina: "N", niki: "N", torben: "TH", thorben: "TH", torbi: "TH" };
const TEAM_NAME: Record<string, string> = { C: "Cem", K: "Kacper", N: "Nikolina", TH: "Thorben", P: "Produzent" };
async function all(col: string) { const { data } = await sb.from("docs").select("id,data").eq("col", col).limit(5000); return (data || []).map((r: any) => ({ id: r.id, ...r.data })); }
const esc = (s: string) => String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const fold = (l: string) => { const out: string[] = []; let s = l; while (s.length > 74) { out.push(s.slice(0, 74)); s = " " + s.slice(74); } out.push(s); return out.join("\r\n"); };
const d8 = (iso: string) => iso.replace(/-/g, "");
const hm = (t: string) => /^\d{1,2}:\d{2}$/.test(t || "") ? t.padStart(5, "0").replace(":", "") + "00" : "";
function addMin(date: string, time: string, min: number) {
  const [h, m] = time.split(":").map(Number); const tot = h * 60 + m + min; const d = new Date(date + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + Math.floor(tot / 1440));
  const r = ((tot % 1440) + 1440) % 1440; return { date: d.toISOString().slice(0, 10), time: String(Math.floor(r / 60)).padStart(2, "0") + ":" + String(r % 60).padStart(2, "0") };
}
const VTZ = ["BEGIN:VTIMEZONE", "TZID:Europe/Berlin", "BEGIN:DAYLIGHT", "TZOFFSETFROM:+0100", "TZOFFSETTO:+0200", "TZNAME:CEST", "DTSTART:19700329T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU", "END:DAYLIGHT", "BEGIN:STANDARD", "TZOFFSETFROM:+0200", "TZOFFSETTO:+0100", "TZNAME:CET", "DTSTART:19701025T030000", "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU", "END:STANDARD", "END:VTIMEZONE"];
type Ev = { uid: string; date: string; time?: string; min?: number; end?: string; title: string; place?: string; note?: string };
function vevent(e: Ev, stamp: string) {
  const L = ["BEGIN:VEVENT", "UID:" + e.uid + "@cloudsrecords", "DTSTAMP:" + stamp];
  const t = hm(e.time || "");
  if (t) {
    let end = e.end && hm(e.end) ? { date: e.date, time: e.end } : addMin(e.date, e.time!, e.min || 120);
    if (e.end && hm(e.end) && e.end <= e.time!) end = addMin(e.date, e.end, 1440);
    L.push("DTSTART;TZID=Europe/Berlin:" + d8(e.date) + "T" + t, "DTEND;TZID=Europe/Berlin:" + d8(end.date) + "T" + hm(end.time));
  } else {
    const n = new Date(e.date + "T12:00:00Z"); n.setUTCDate(n.getUTCDate() + 1);
    L.push("DTSTART;VALUE=DATE:" + d8(e.date), "DTEND;VALUE=DATE:" + d8(n.toISOString().slice(0, 10)));
  }
  L.push("SUMMARY:" + esc(e.title));
  if (e.place) L.push("LOCATION:" + esc(e.place));
  L.push("DESCRIPTION:" + esc((e.note ? e.note + "\n\n" : "") + "Details in der CloudsRecords-App: https://cloudscollectivegroup.github.io/clouds-records/"));
  L.push("END:VEVENT");
  return L.map(fold).join("\r\n");
}
Deno.serve(async (req) => {
  const t = new URL(req.url).searchParams.get("t") || "";
  if (!/^[a-f0-9]{40,80}$/.test(t)) return new Response("Ungültiger Link", { status: 404 });
  const { data: feed } = await sb.from("cal_feeds").select("user_id,token,label_token").or(`token.eq.${t},label_token.eq.${t}`).maybeSingle();
  if (!feed) return new Response("Link ungültig oder zurückgesetzt", { status: 404 });
  const { data: mem } = await sb.from("members").select("username,role,person").eq("user_id", feed.user_id).maybeSingle();
  if (!mem) return new Response("Kein Zugang mehr", { status: 404 });
  const label = feed.label_token === t && mem.role === "team" && ["cem", "torben", "thorben", "torbi"].includes(String(mem.username).toLowerCase());
  const key = mem.role === "artist" ? mem.person : mem.role === "producer" ? "P" : TEAM_BY_USER[String(mem.username).toLowerCase()] || "";
  const isArtist = mem.role === "artist";
  if (!label && !key) return new Response("Kein Zugang", { status: 404 });
  const [rels, studio, people, gigs, todos] = await Promise.all([all("releases"), all("studio"), all("people"), all("gigs"), all("todos")]);
  const P = Object.fromEntries(people.map((p: any) => [p.id, p])), R = Object.fromEntries(rels.map((r: any) => [r.id, r]));
  const nm = (id: string) => P[id]?.name || TEAM_NAME[id] || "";
  const relT = (r: any) => r?.title || (r?.type || "Release") + " " + String(r?.code || "").replace(/\D/g, "");
  const crewHas = (v: any, k: string) => !!k && (v?.crew || []).some((c: any) => c.member === k && (c.status || "Angefragt") !== "Abgesagt");
  const rsvpYes = (x: any, k: string) => (x.guests || []).includes(k) && (x.rsvp || {})[k] === "ja";
  const assigned = (x: any, k: string) => !!k && (x.owner === k || (x.helpers || []).includes(k));
  const aIn = (x: any) => x.owner === "A" || (x.helpers || []).includes("A");
  const todoHas = (x: any, k: string) => x.artist === k || (x.artists || []).includes(k);
  const pre = (a: string) => label ? nm(a) + " · " : "";
  const ev: Ev[] = [];
  for (const r of rels) if (r.date && (label || (isArtist && r.artist === key))) ev.push({ uid: "rel-" + r.id, date: r.date, title: "Release · " + pre(r.artist) + relT(r) });
  for (const x of studio) if (x.date && x.status === "Bestätigt" && (label || x.artist === key || rsvpYes(x, key)))
    ev.push({ uid: "st-" + x.id, date: x.date, time: x.time, min: (+x.hours || 4) * 60, title: "Studio · " + (label ? nm(x.artist) : x.artist === key ? (x.room || "CloudStudios") : "Gast bei " + nm(x.artist)), place: "CloudStudios" + (x.room ? " · " + x.room : ""), note: x.note || x.what || "" });
  for (const r of rels) if (r.video && (label || (isArtist && r.artist === key) || crewHas(r.video, key))) (r.video.days || []).forEach((d: any, i: number) => d.date && ev.push({ uid: "mv-" + r.id + "-" + i, date: d.date, time: d.time, min: 480, title: "Musikvideo-Dreh · " + pre(r.artist) + relT(r), place: d.loc || "" }));
  for (const p of people) if (p.role === "artist" || p.shoots) (p.shoots || []).forEach((x: any) => { if (x.date && (label || (isArtist && p.id === key) || crewHas(x, key))) ev.push({ uid: "sh-" + p.id + "-" + x.id, date: x.date, time: x.time, min: 360, title: (x.type === "photo" ? "Fotoshooting · " : "Reel-Drehtag · ") + pre(p.id) + (x.title || ""), place: x.loc || "" }); });
  for (const g of gigs) if (g.date && g.req === "ok" && g.status !== "Abgesagt" && (label || g.artist === key || (g.co || []).includes(key) || crewHas(g, key)))
    ev.push({ uid: "gig-" + g.id, date: g.date, time: g.getin || g.stage, min: 240, title: "Live · " + (label || g.artist !== key ? nm(g.artist) + " · " : "") + (g.title || "Auftritt"), place: [g.venue, g.address].filter(Boolean).join(", ") });
  for (const x of todos) if (x.kind === "Termin" && x.date && !x.done && (label || (isArtist ? todoHas(x, key) && aIn(x) : assigned(x, key))))
    ev.push({ uid: "td-" + x.id, date: x.date, time: x.time, end: x.end, min: 60, title: x.title + (label && x.artist ? " · " + nm(x.artist) : ""), place: x.place || "", note: x.note || "" });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const name = label ? "CloudsRecords · Label" : "CloudsRecords · " + (isArtist ? nm(key) : TEAM_NAME[key] || "Team");
  const body = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//CloudsRecords//App//DE", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:" + esc(name), "X-WR-TIMEZONE:Europe/Berlin", "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H", ...VTZ, ...ev.map(e => vevent(e, stamp)), "END:VCALENDAR"].join("\r\n");
  return new Response(body, { headers: { "content-type": "text/calendar; charset=utf-8", "cache-control": "no-cache" } });
});
