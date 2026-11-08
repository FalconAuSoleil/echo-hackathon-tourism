// Page vitrine d'Echo. L'histoire est scénarisée ; l'anonymisation, le découpage en idées, le récap kinyarwanda
// et le découpage en SMS passent par le vrai code de @echo/core. Ce que le modèle comprend de chaque message est
// le résultat attendu, préparé à l'avance (aucun modèle ne tourne ici).
import { buildMonthlyRecap, recapRwLines, scrubPii, segment, splitSms, validateCatalog, PII_TOKENS } from "@echo/core";
import rawCatalog from "../../catalog/catalog.json";
import samples from "../web/public/samples/manifest.json";

const catalog = validateCatalog(rawCatalog);
const $ = (sel, root = document) => root.querySelector(sel);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const transcriptOf = Object.fromEntries(samples.samples.map((s) => [s.id, s.transcript]));
const LANG_NAME = { en: "English", fr: "French", de: "German", es: "Spanish" };

// ---------- Barre de progression et apparitions ----------
const bar = $(".progress span");
function onScrollProgress() {
  const max = document.documentElement.scrollHeight - innerHeight;
  bar.style.width = `${(scrollY / Math.max(max, 1)) * 100}%`;
}
const io = new IntersectionObserver(
  (entries) => entries.forEach((e) => e.isIntersecting && e.target.classList.add("in")),
  { threshold: 0.2 },
);
document.querySelectorAll(".reveal, .paper").forEach((el) => io.observe(el));
const onceVisible = (el, threshold, fn) =>
  new IntersectionObserver(([e], obs) => {
    if (!e.isIntersecting) return;
    obs.disconnect();
    fn();
  }, { threshold }).observe(el);

// ---------- Carte visiteur (textes de apps/web/src/pages/Card.tsx) ----------
const CARD = {
  en: ["How was your visit?", "Tell us in 30 seconds what you liked and what was missing. Send a WhatsApp voice message to this number.", "The sound is deleted after analysis, and your name is not kept.", "By sending this message, you agree that it is analysed in this way."],
  fr: ["Comment s'est passée votre visite ?", "Dites-nous en 30 secondes ce que vous avez aimé et ce qui a manqué. Envoyez un message vocal WhatsApp à ce numéro.", "Le son est effacé après analyse, et votre nom n'est pas conservé.", "En envoyant ce message, vous acceptez qu'il soit analysé de cette façon."],
  de: ["Wie war Ihr Besuch?", "Sagen Sie uns in 30 Sekunden, was Ihnen gefallen hat und was gefehlt hat. Schicken Sie eine WhatsApp-Sprachnachricht an diese Nummer.", "Die Aufnahme wird nach der Auswertung gelöscht, und Ihr Name wird nicht gespeichert.", "Mit dem Senden dieser Nachricht stimmen Sie dieser Auswertung zu."],
  es: ["¿Qué tal su visita?", "Cuéntenos en 30 segundos qué le gustó y qué faltó. Envíe un mensaje de voz de WhatsApp a este número.", "El audio se borra después del análisis y su nombre no se guarda.", "Al enviar este mensaje, acepta que se analice de esta manera."],
};
const paper = $("#paper");
const langs = Object.keys(CARD);
let langIdx = 0;
let langTimer;
function setLang(lang) {
  paper.classList.add("swap");
  setTimeout(() => {
    const [t, b, p, c] = CARD[lang];
    $("#card-title").textContent = t;
    $("#card-body").textContent = b;
    $("#card-privacy").textContent = p;
    $("#card-coop").textContent = c;
    paper.querySelectorAll(".paper-langs button").forEach((btn) => btn.classList.toggle("on", btn.dataset.lang === lang));
    paper.classList.remove("swap");
  }, 300);
}
paper.querySelectorAll(".paper-langs button").forEach((btn) =>
  btn.addEventListener("click", () => {
    clearInterval(langTimer);
    langIdx = langs.indexOf(btn.dataset.lang);
    setLang(btn.dataset.lang);
  }),
);
new IntersectionObserver(([e]) => {
  clearInterval(langTimer);
  if (e.isIntersecting) langTimer = setInterval(() => setLang(langs[(langIdx = (langIdx + 1) % langs.length)]), 2600);
}, { threshold: 0.5 }).observe(paper);

// ---------- Formes d'onde (calculées depuis les fichiers son) ----------
const peaksCache = new Map();
function peaksOf(url) {
  if (!peaksCache.has(url)) {
    peaksCache.set(
      url,
      fetch(url)
        .then((r) => r.arrayBuffer())
        .then((buf) => new OfflineAudioContext(1, 1, 16000).decodeAudioData(buf))
        .then((audio) => {
          const data = audio.getChannelData(0);
          const bars = 46;
          const size = Math.floor(data.length / bars);
          const rms = Array.from({ length: bars }, (_, i) => {
            let s = 0;
            for (let j = i * size; j < (i + 1) * size; j++) s += data[j] * data[j];
            return Math.sqrt(s / size);
          });
          const top = Math.max(...rms);
          return rms.map((v) => Math.pow(v / top, 0.7));
        })
        .catch(() => Array.from({ length: 46 }, (_, i) => 0.3 + 0.5 * Math.abs(Math.sin(i * 1.7)))),
    );
  }
  return peaksCache.get(url);
}
function drawWave(canvas, peaks, progress = 0, color = "#8fcf7a", played = "#8fcf7a") {
  const ctx = canvas.getContext("2d");
  const { width: w, height: h } = canvas;
  ctx.clearRect(0, 0, w, h);
  const step = w / peaks.length;
  peaks.forEach((p, i) => {
    const bh = Math.max(0.06, p) * h * 0.9;
    ctx.fillStyle = i / peaks.length < progress ? played : color;
    ctx.beginPath();
    ctx.roundRect(i * step + step * 0.2, (h - bh) / 2, step * 0.6, bh, step * 0.3);
    ctx.fill();
  });
}

// ---------- Message vocal de Lena ----------
const VOICE = "samples/de-roasting-path.wav";
const voice = new Audio(VOICE);
const playBtn = $("#play-voice");
let lenaPeaks = null;
const redrawLena = () => {
  if (!lenaPeaks) return;
  drawWave($("#wave-wa"), lenaPeaks, voice.currentTime / (voice.duration || 1), "rgba(244,236,220,0.45)", "#f4ecdc");
};
peaksOf(VOICE).then((p) => {
  lenaPeaks = p;
  redrawLena();
});
playBtn.addEventListener("click", () => (voice.paused ? voice.play() : voice.pause()));
voice.addEventListener("play", () => (playBtn.textContent = "❚❚"));
voice.addEventListener("pause", () => (playBtn.textContent = "▶"));
voice.addEventListener("timeupdate", redrawLena);
voice.addEventListener("ended", () => {
  voice.currentTime = 0;
  redrawLena();
});
onceVisible($("#wa-phone"), 0.6, () =>
  setTimeout(() => {
    $("#signal").textContent = "3G";
    $("#signal").classList.add("ok");
    $("#ticks").textContent = "✓✓";
    $("#ticks").classList.add("sent");
    $("#wa-note").textContent = "Sent at 12:47, when the signal came back";
  }, 2600),
);
onceVisible($("#airplane"), 0.8, () => $("#airplane").classList.add("on"));

// ---------- SMS sur un téléphone basique ----------
function typeSms(nokia, parts) {
  const text = $(".lcd-text", nokia);
  const count = $(".lcd-count", nokia);
  const run = (nokia.run = {});
  nokia.classList.remove("buzz");
  void nokia.offsetWidth;
  nokia.classList.add("buzz");
  const typePart = (k) => {
    count.textContent = `SMS ${k + 1}/${parts.length}`;
    let i = 0;
    const tick = setInterval(() => {
      if (nokia.run !== run) return clearInterval(tick);
      i += 2;
      text.textContent = parts[k].slice(0, i);
      if (i < parts[k].length) return;
      clearInterval(tick);
      if (k + 1 < parts.length) setTimeout(() => nokia.run === run && typePart(k + 1), 2200);
    }, 26);
  };
  typePart(0);
}

// Lecture des clips kinyarwanda d'un récap, ligne par ligne
let playing = null;
async function playLines(lines, onLine, button) {
  if (playing) return stopPlaying();
  const run = (playing = { button, onLine });
  button.classList.add("playing");
  for (let li = 0; li < lines.length; li++) {
    onLine(li);
    for (const clip of lines[li].audio) {
      if (playing !== run) return;
      await new Promise((resolve) => {
        const a = new Audio(`catalog/${clip}`);
        run.audio = a;
        a.onended = a.onerror = resolve;
        a.play().catch(resolve);
      });
    }
    await sleep(350);
  }
  stopPlaying();
}
function stopPlaying() {
  if (!playing) return;
  playing.audio?.pause();
  playing.button.classList.remove("playing");
  playing.onLine(-1);
  playing = null;
}

const MONTH = "2026-10";

// ---------- Simulation : à vous d'être le visiteur ----------
// results : ce que le modèle est censé comprendre de chaque idée, dans l'ordre des idées produites par segment().
const SIM = [
  { id: "w-sarah", lang: "en", written: "It's Sarah here, the coffee we roasted together was the best I have ever tasted. I would love to buy a bag, text me on +44 7700 900123.", results: ["P3", "P9"] },
  { id: "de-roasting-path", lang: "de", results: ["P3", "N1"] },
  { id: "w-julien", lang: "fr", written: "Je m'appelle Julien, merci pour cet accueil si chaleureux ! Par contre le chemin depuis le village était vraiment trop long.", results: ["P1", "N1"] },
  { id: "fr-welcome-meal", lang: "fr", results: ["P1", "P4"] },
  { id: "en-prices-buy", lang: "en", results: ["N2", "P9"] },
  { id: "es-visit-too-long", lang: "es", results: ["N3", "N3"] },
  { id: "en-negation", lang: "en", results: ["negation"] },
  { id: "fr-ambiguous", lang: "fr", results: ["unsure"] },
  { id: "en-picking", lang: "en", results: ["off"] },
  { id: "de-picking", lang: "de", results: ["off", "off"] },
  { id: "fr-picking", lang: "fr", results: ["off"] },
];
const labelOf = (id) => catalog.findings.find((f) => f.id === id)?.labels.en;
const polarityOf = (id) => catalog.findings.find((f) => f.id === id)?.polarity;
function describe(result) {
  if (result === "off") return { cls: "off", label: "Something Echo doesn't know yet: set aside for a person" };
  if (result === "unsure") return { cls: "unsure", label: "Not sure: never counted, ask a person" };
  if (result === "negation") return { cls: "none", label: "Not a complaint (“not too long”): nothing counted" };
  return { cls: polarityOf(result) === "positive" ? "pos" : "neg", label: labelOf(result) };
}
const TOKEN_LABEL = { [PII_TOKENS.name]: "name", [PII_TOKENS.phone]: "phone number", [PII_TOKENS.email]: "e-mail", [PII_TOKENS.handle]: "handle" };
const tokenRe = new RegExp(Object.keys(TOKEN_LABEL).map((t) => t.replace(/[[\]]/g, "\\$&")).join("|"), "g");
const withRedactions = (text) => esc(text).replace(tokenRe, (t) => `<span class="redact">${TOKEN_LABEL[t]}</span>`);

const simList = $("#sim-list");
simList.innerHTML = SIM.map((s) => {
  const text = s.written ?? transcriptOf[s.id];
  return `<li class="sim-item" data-id="${s.id}">
    <span class="lang">${s.lang.toUpperCase()}</span>
    <span class="txt"><small>${s.written ? "written" : "voice note"}</small>${esc(text.split(" ").slice(0, 9).join(" "))}…</span>
    <span class="acts">${s.written ? "" : `<button class="icon-btn" data-play aria-label="Play">▶</button>`}<button class="send-btn" data-send>Send</button></span>
  </li>`;
}).join("");

let simAudio = null;
let simAudioId = null;
simList.addEventListener("click", (e) => {
  const item = e.target.closest(".sim-item");
  if (!item) return;
  const sim = SIM.find((s) => s.id === item.dataset.id);
  if (e.target.closest("[data-play]")) {
    const btn = e.target.closest("[data-play]");
    if (simAudio && !simAudio.paused && simAudioId === sim.id) return simAudio.pause();
    simAudio?.pause();
    document.querySelectorAll("[data-play]").forEach((b) => (b.textContent = "▶"));
    simAudio = new Audio(`samples/${sim.id}.wav`);
    simAudioId = sim.id;
    btn.textContent = "❚❚";
    simAudio.onended = simAudio.onpause = () => (btn.textContent = "▶");
    simAudio.play();
  }
  if (e.target.closest("[data-send]")) enqueue(sim, item);
});
$("#send-all").addEventListener("click", () =>
  SIM.forEach((s) => {
    const item = simList.querySelector(`[data-id="${s.id}"]`);
    if (!$("[data-send]", item).disabled) enqueue(s, item);
  }),
);

const queue = [];
let busy = false;
let monthMessages = [];
let generation = 0;
function enqueue(sim, item) {
  const btn = $("[data-send]", item);
  btn.disabled = true;
  btn.textContent = "Queued";
  queue.push({ sim, item });
  if (!busy) drain();
}
async function drain() {
  busy = true;
  const gen = generation;
  while (queue.length && gen === generation) {
    const { sim, item } = queue.shift();
    item.classList.add("sending");
    $("[data-send]", item).textContent = "Sending";
    await processOne(sim, gen);
    if (gen !== generation) break;
    item.classList.remove("sending");
    item.classList.add("sent");
    $("[data-send]", item).textContent = "Sent ✓";
  }
  busy = false;
}

const proc = $("#proc");
async function processOne(sim, gen) {
  const isVoice = !sim.written;
  const original = sim.written ?? transcriptOf[sim.id];
  const steps = isVoice
    ? ["Received", "Listening", "Voice deleted", "Names & numbers removed", "Ideas found"]
    : ["Received", "Reading", "Names & numbers removed", "Ideas found"];
  proc.innerHTML = `
    <div class="proc-head"><span>${LANG_NAME[sim.lang]} · ${isVoice ? "voice note" : "written message"}</span><span>${queue.length ? `${queue.length} waiting` : ""}</span></div>
    <ol class="proc-steps">${steps.map((s) => `<li>${s}</li>`).join("")}</ol>
    ${isVoice ? `<canvas class="wave proc-wave" width="600" height="60"></canvas>` : ""}
    <div class="proc-text"></div>
    <div class="proc-note"></div>
    <div class="ideas"></div>`;
  const stepEls = [...proc.querySelectorAll(".proc-steps li")];
  let s = 0;
  const next = () => {
    stepEls.forEach((li, i) => {
      li.classList.toggle("done", i < s);
      li.classList.toggle("now", i === s);
    });
    s++;
  };
  const alive = () => gen === generation;
  const textEl = $(".proc-text", proc);

  next(); // reçu
  if (isVoice) drawWave($(".proc-wave", proc), await peaksOf(`samples/${sim.id}.wav`));
  await sleep(700);
  if (!alive()) return;

  next(); // écoute ou lecture
  const words = original.split(" ");
  for (let i = 1; i <= words.length; i++) {
    textEl.textContent = words.slice(0, i).join(" ");
    await sleep(isVoice ? 70 : 35);
    if (!alive()) return;
  }
  await sleep(400);

  if (isVoice) {
    next(); // voix supprimée
    $(".proc-wave", proc).classList.add("gone");
    await sleep(900);
    if (!alive()) return;
  }

  next(); // anonymisation, par le vrai code
  const scrub = scrubPii(original, sim.lang);
  textEl.innerHTML = withRedactions(scrub.text);
  const r = scrub.removed;
  const found = [
    r.names && `${r.names} name${r.names > 1 ? "s" : ""}`,
    r.phones && `${r.phones} phone number${r.phones > 1 ? "s" : ""}`,
    r.emails && `${r.emails} e-mail${r.emails > 1 ? "s" : ""}`,
    r.handles && `${r.handles} handle${r.handles > 1 ? "s" : ""}`,
  ].filter(Boolean);
  $(".proc-note", proc).textContent = found.length ? `Removed before anything is stored: ${found.join(", ")}.` : "Nothing personal in this one.";
  await sleep(found.length ? 1800 : 900);
  if (!alive()) return;

  next(); // idées, découpées par le vrai code
  const ideas = segment(scrub.text, sim.lang);
  const ideasEl = $(".ideas", proc);
  textEl.style.display = "none";
  ideas.forEach((idea, i) => {
    const d = describe(sim.results[i] ?? sim.results.at(-1));
    ideasEl.insertAdjacentHTML("beforeend", `<div class="idea ${d.cls}" style="animation-delay:${i * 0.35}s"><q>${withRedactions(idea.text)}</q><b>${d.label}</b></div>`);
  });
  await sleep(900 + ideas.length * 350);
  if (!alive()) return;
  s = steps.length;
  next();

  const findings = [...new Set(sim.results.filter((x) => /^[PN]\d+$/.test(x)))];
  monthMessages.push({ id: sim.id, findings, notSure: sim.results.filter((x) => x === "unsure").length, off: sim.results.includes("off") });
  renderTally();
  await sleep(1200);
}

function renderTally() {
  const counts = new Map();
  monthMessages.forEach((m) => m.findings.forEach((f) => counts.set(f, (counts.get(f) ?? 0) + 1)));
  const offN = monthMessages.filter((m) => m.off).length;
  const unsureN = monthMessages.reduce((n, m) => n + m.notSure, 0);
  $("#tally").innerHTML = monthMessages.length
    ? `This month, ${monthMessages.length} message${monthMessages.length > 1 ? "s" : ""}: ` +
      [...counts]
        .map(([f, n]) => `<span class="t ${polarityOf(f) === "positive" ? "pos" : "neg"}">${labelOf(f)} · ${n}</span>`)
        .join("") +
      (offN ? `<span class="t off">Something new · ${offN}</span>` : "") +
      (unsureN ? `<span class="t unsure">Not sure · ${unsureN}</span>` : "")
    : "";
  $("#end-month").disabled = monthMessages.length === 0;
}

let simRecap = null;
const simNokia = $("#sim-nokia");
$("#end-month").addEventListener("click", () => {
  const offN = monthMessages.filter((m) => m.off).length;
  simRecap = buildMonthlyRecap(
    {
      month: MONTH,
      messages: monthMessages.map((m) => ({ id: m.id, month: MONTH, status: "analyzed", findings: m.findings, notSureCount: m.notSure })),
      // Un sujet inconnu n'est signalé qu'à partir de 3 visiteurs différents.
      recurringUnknownVisitors: offN >= 3 ? offN : 0,
    },
    catalog,
  );
  typeSms(simNokia, splitSms(recapRwLines(simRecap), 160, { numbered: true }));
  $("#sim-recap").innerHTML = simRecap.lines.map((l) => `<li>${esc(l.en)}</li>`).join("");
  $("#sim-listen").hidden = false;
});
$("#sim-listen").addEventListener("click", (e) =>
  playLines(simRecap.lines, (li) => document.querySelectorAll("#sim-recap li").forEach((el, j) => el.classList.toggle("speaking", j === li)), e.currentTarget),
);
$("#reset").addEventListener("click", () => {
  generation++;
  queue.length = 0;
  busy = false;
  monthMessages = [];
  simRecap = null;
  stopPlaying();
  simNokia.run = null;
  $(".lcd-text", simNokia).textContent = "No new message.";
  $(".lcd-count", simNokia).textContent = "Noor";
  $("#sim-recap").innerHTML = "";
  $("#sim-listen").hidden = true;
  proc.innerHTML = `<p class="proc-empty">Waiting for a message…</p>`;
  simList.querySelectorAll(".sim-item").forEach((item) => {
    item.classList.remove("sent", "sending");
    const btn = $("[data-send]", item);
    btn.disabled = false;
    btn.textContent = "Send";
  });
  renderTally();
});

// ---------- Crédits photo ----------
fetch("photos/CREDITS.json")
  .then((r) => r.json())
  .then((list) => {
    $("#credits").innerHTML =
      "Photos (Wikimedia Commons): " +
      list
        .map((c) => `<a href="${c.sourceUrl}" target="_blank" rel="noopener">${esc(c.title)}</a>, ${esc(c.author)} (<a href="${c.licenseUrl}" target="_blank" rel="noopener">${c.license}</a>)`)
        .join(" · ");
  })
  .catch(() => {});

function onScroll() {
  onScrollProgress();
}
addEventListener("scroll", onScroll, { passive: true });
addEventListener("resize", onScroll);
onScroll();
