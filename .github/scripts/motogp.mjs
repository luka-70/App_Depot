// Scarica calendario e orari MotoGP / Moto2 / Moto3 dal palinsesto ufficiale di motogp.com
// e li salva in orari-gare/motogp.json, letto dall'app "Orari gare".
// Gira su GitHub Actions: lato server il blocco CORS dei browser non esiste.
// Nota: si usa /motogp/v1/events (palinsesto) e non /results/sessions,
// perché quest'ultimo restituisce l'ora locale del circuito marcata come UTC.
import { writeFile, readFile } from "node:fs/promises";

const API = "https://api.motogp.pulselive.com/motogp/v1/events";
const OUT = "orari-gare/motogp.json";
const MAP = {
  MGP: { FP1: "FP1", FP2: "FP2", PR: "PR", Q1: "Q1", Q2: "Q2", SPR: "SPR", WUP: "WUP", RAC: "RACE" },
  MT2: { RAC: "M2RACE" },
  MT3: { RAC: "M3RACE" },
};
// "+0300" -> "+03:00", formato accettato da tutti i browser
const fixTz = (d) => (d || "").replace(/([+-]\d\d)(\d\d)$/, "$1:$2");

async function j(url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: { accept: "application/json", "user-agent": "orari-gare-app" } });
      if (r.status === 404) return [];
      if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
      return await r.json();
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise((res) => setTimeout(res, 2000 * i));
    }
  }
}

const year = new Date().getUTCFullYear();
const events = [];
for (const y of [year, year + 1]) {
  const list = await j(`${API}?seasonYear=${y}`);
  for (const e of list.filter((e) => e.kind === "GP")) {
    const seen = new Set();
    const sessions = [];
    for (const b of e.broadcasts || []) {
      if (b.type !== "SESSION" || !b.date_start) continue;
      const code = MAP[b.category?.acronym]?.[b.shortname];
      if (!code || seen.has(code)) continue;
      seen.add(code);
      sessions.push({ code, start: fixTz(b.date_start) });
    }
    sessions.sort((a, b) => new Date(a.start) - new Date(b.start));
    events.push({
      id: e.id,
      name: (e.name || "").trim(),
      country: e.circuit?.country || "",
      loc: e.circuit?.name || "",
      tz: e.time_zone || "",
      start: fixTz(e.date_start),
      end: fixTz(e.date_end),
      sessions,
    });
  }
}

if (!events.some((e) => e.sessions.length)) throw new Error("Nessun orario ricevuto: file non aggiornato");
events.sort((a, b) => new Date(a.start) - new Date(b.start));

// Riscrive il file solo se i dati sono cambiati, così non si crea un commit ogni 6 ore
let old = null;
try { old = JSON.parse(await readFile(OUT, "utf8")); } catch {}
if (old && JSON.stringify(old.events) === JSON.stringify(events)) {
  console.log("Nessuna variazione negli orari");
} else {
  await writeFile(OUT, JSON.stringify({ updated: new Date().toISOString(), source: API, events }, null, 1) + "\n");
  console.log(`Salvati ${events.length} GP, ${events.reduce((n, e) => n + e.sessions.length, 0)} sessioni`);
}
