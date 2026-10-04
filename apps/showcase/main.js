// Page vitrine d'Echo : animations pilotées par le défilement, aucun calcul d'analyse ici.

const $ = (sel) => document.querySelector(sel);

// Barre de progression
const bar = $(".progress span");
function onScrollProgress() {
  const max = document.documentElement.scrollHeight - innerHeight;
  bar.style.width = `${(scrollY / Math.max(max, 1)) * 100}%`;
}

// Apparitions
const io = new IntersectionObserver(
  (entries) => entries.forEach((e) => e.isIntersecting && e.target.classList.add("in")),
  { threshold: 0.2 },
);
document.querySelectorAll(".reveal, .paper").forEach((el) => io.observe(el));

// Carte visiteur : textes réels de l'app (apps/web/src/pages/Card.tsx)
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

// Forme d'onde réelle du message vocal
const VOICE = "audio/de-roasting-path.wav";
let peaks = null;
let voiceProgress = 0;
function drawWave(canvas, progress, color, played) {
  if (!peaks) return;
  const ctx = canvas.getContext("2d");
  const { width: w, height: h } = canvas;
  ctx.clearRect(0, 0, w, h);
  const n = peaks.length;
  const step = w / n;
  for (let i = 0; i < n; i++) {
    const v = Math.max(0.06, peaks[i]);
    const bh = v * h * 0.9;
    ctx.fillStyle = i / n < progress ? played : color;
    ctx.beginPath();
    ctx.roundRect(i * step + step * 0.2, (h - bh) / 2, step * 0.6, bh, step * 0.3);
    ctx.fill();
  }
}
function redrawWaves() {
  drawWave($("#wave-wa"), voiceProgress, "rgba(244,236,220,0.45)", "#f4ecdc");
  drawWave($("#wave-stage"), 0, "#8fcf7a", "#8fcf7a");
}
fetch(VOICE)
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
    peaks = rms.map((v) => Math.pow(v / top, 0.7));
    redrawWaves();
  })
  .catch(() => {});

const voice = new Audio(VOICE);
const playBtn = $("#play-voice");
playBtn.addEventListener("click", () => {
  if (voice.paused) voice.play();
  else voice.pause();
});
voice.addEventListener("play", () => (playBtn.textContent = "❚❚"));
voice.addEventListener("pause", () => (playBtn.textContent = "▶"));
voice.addEventListener("ended", () => {
  playBtn.textContent = "▶";
  voiceProgress = 0;
  redrawWaves();
});
voice.addEventListener("timeupdate", () => {
  voiceProgress = voice.currentTime / (voice.duration || 1);
  redrawWaves();
});

// Envoi différé quand le réseau revient
new IntersectionObserver(([e]) => {
  if (!e.isIntersecting) return;
  setTimeout(() => {
    $("#signal").textContent = "3G";
    $("#signal").classList.add("ok");
    $("#ticks").textContent = "✓✓";
    $("#ticks").classList.add("sent");
    $("#wa-note").textContent = "Sent at 12:47, when the signal came back";
  }, 2600);
}, { threshold: 0.6 }).observe($("#wa-phone"));

// Mode avion
new IntersectionObserver(([e]) => e.isIntersecting && $("#airplane").classList.add("on"), { threshold: 0.8 }).observe($("#airplane"));

// Analyse en six étapes, pilotée par le défilement
const pipeline = $("#pipeline");
const stage = $("#stage");
const stepItems = [...document.querySelectorAll("#steps li")];
document.querySelectorAll("#transcript .clause").forEach((clause, ci) => {
  const words = clause.textContent.split(" ");
  clause.innerHTML = words.map((w, i) => `<span class="w" style="transition-delay:${(ci * 12 + i) * 70}ms">${w}</span>`).join(" ");
});
new IntersectionObserver(([e]) => e.isIntersecting && stage.classList.add("live"), { threshold: 0.4 }).observe(stage);

function progressIn(section) {
  const r = section.getBoundingClientRect();
  return Math.min(1, Math.max(0, -r.top / Math.max(r.height - innerHeight, 1)));
}
function onScrollPipeline() {
  const steps = stepItems.length;
  const step = Math.min(steps - 1, Math.floor(progressIn(pipeline) * steps));
  if (stage.dataset.step !== String(step)) stage.dataset.step = String(step);
  stepItems.forEach((li, i) => {
    li.classList.toggle("now", i === step);
    li.classList.toggle("done", i < step);
  });
}

// Le mois : sept messages
const MSGS = [
  { lang: "DE", kind: "voice", text: "Das Rösten der Bohnen über dem Feuer hat mir am meisten Spaß gemacht. Aber der Weg vom Dorf bis hierher war viel zu lang.", chips: [["pos", "Roasting enjoyed"], ["neg", "Path too long"]] },
  { lang: "EN", kind: "voice", text: "I wish we could have picked some of the ripe red coffee cherries ourselves during the harvest.", chips: [["off", "unknown topic"]], off: true },
  { lang: "FR", kind: "voice", text: "Bon, je dirais que c'était peut-être un peu long par moments.", chips: [["unsure", "not sure · ask a person"]], unsure: true },
  { lang: "DE", kind: "voice", text: "Wir hätten so gern selbst bei der Ernte geholfen und ein paar Kaffeekirschen vom Strauch gepflückt.", chips: [["off", "unknown topic"]], off: true },
  { lang: "ES", kind: "written", text: "Tostar el café con la familia fue lo mejor del viaje. Pero el camino desde el pueblo se nos hizo eterno.", chips: [["pos", "Roasting enjoyed"], ["neg", "Path too long"]] },
  { lang: "FR", kind: "voice", text: "On aurait aimé participer à la cueillette, ramasser nous-mêmes les grains de café mûrs sur les arbustes.", chips: [["off", "unknown topic"]], off: true },
  { lang: "EN", kind: "written", text: "Tasting the coffee we had just roasted was unforgettable. The rest was maybe a bit much at times?", chips: [["pos", "Roasting enjoyed"], ["unsure", "not sure · ask a person"]], unsure: true },
];
const month = $("#month");
const msgsEl = $("#msgs");
msgsEl.innerHTML = MSGS.map(
  (m, i) => `<article class="msg${m.off ? " off" : ""}${m.unsure && !m.off ? " unsure" : ""}">
    <div class="msg-top"><span><b>${m.lang}</b> · ${m.kind === "voice" ? "voice note" : "written"}</span><span>#${i + 1}</span></div>
    <p>${m.text}</p>
    <div class="chips">${m.chips.map(([c, l]) => `<span class="chip ${c}">${l}</span>`).join("")}</div>
  </article>`,
).join("");
const msgEls = [...msgsEl.children];
function onScrollMonth() {
  const p = progressIn(month);
  msgEls.forEach((el, i) => el.classList.toggle("shown", p > 0.02 + i * 0.045));
  month.classList.toggle("judged", p > 0.4);
  month.classList.toggle("cluster", p > 0.65);
}

// Récap : phrases figées du catalogue (catalog/catalog.json) et clips MMS-TTS correspondants
const A = (f) => `audio/${f}.mp3`;
const RECAP = [
  { rw: "Muri uku kwezi: Ubutumwa <b>7</b> bwatanzwe n'abashyitsi.", en: "This month: 7 messages from visitors.",
    clips: ["template-volume-0", "num-7", "template-volume-1"] },
  { rw: "Ibyo abashyitsi bakunda (<b>3</b> ku <b>7</b>): Abashyitsi bishimiye kureba uko ikawa yateguwe no kuyirya.", en: "What visitors like (3 out of 7): Visitors liked seeing the coffee prepared and tasting it.",
    clips: ["template-keep-0", "num-3", "template-keep-1", "num-7", "finding-P3"] },
  { rw: "Ikibazo gikomeye kurusha ibindi (<b>2</b> kuri <b>7</b>), mu gihe cy'amezi <b>2</b>: Inzira igana ku isambu irareshya cyane cyangwa ikaba igoye cyane.", en: "The biggest problem (2 out of 7), for 2 months: The road to the farm is too long or difficult.",
    clips: ["template-fix_streak-0", "num-2", "template-fix_streak-1", "num-7", "template-fix_streak-2", "num-2", "finding-N1"] },
  { rw: "Abashyitsi <b>3</b> baganira ku ngingo nshya: usabe umuntu gusoma amagambo yabo.", en: "3 visitors talk about a new topic: ask a person to read their words.",
    clips: ["template-unknown_topic-0", "num-3", "template-unknown_topic-1"] },
  { rw: "<b>2</b> Amagambo adasobanutse neza: jya usaba umuntu.", en: "2 unclear remarks: ask someone.",
    clips: ["num-2", "template-not_understood-1"] },
];
const linesEl = $("#recap-lines");
linesEl.innerHTML = RECAP.map((l) => `<li class="reveal"><div class="rw">${l.rw}</div><div class="en">${l.en}</div></li>`).join("");
linesEl.querySelectorAll("li").forEach((li) => io.observe(li));
const lineEls = [...linesEl.children];
$("#gloss").addEventListener("change", (e) => $("#recap").classList.toggle("nogloss", !e.target.checked));

// SMS sur l'écran du téléphone basique, ligne par ligne
// Découpage produit par splitSms(recapRwLines(...), 160, { numbered: true }) de @echo/core pour ce récap
const lcd = $("#lcd-text");
const lines = RECAP.map((l) => l.rw.replace(/<\/?b>/g, ""));
const SMS = [`${lines[0]}\n${lines[1]} (1/3)`, `${lines[2]} (2/3)`, `${lines[3]}\n${lines[4]} (3/3)`];
let typed = false;
function typeSms(k) {
  $(".lcd-top span:nth-child(2)").textContent = `SMS ${k + 1}/${SMS.length}`;
  let i = 0;
  const tick = setInterval(() => {
    i += 2;
    lcd.textContent = SMS[k].slice(0, i);
    if (i < SMS[k].length) return;
    clearInterval(tick);
    if (k + 1 < SMS.length) setTimeout(() => typeSms(k + 1), 2200);
  }, 28);
}
new IntersectionObserver(([e]) => {
  if (!e.isIntersecting || typed) return;
  typed = true;
  typeSms(0);
}, { threshold: 0.6 }).observe($("#nokia"));

const listenBtn = $("#listen");
let playing = null;
async function playRecap() {
  const run = (playing = {});
  listenBtn.classList.add("playing");
  for (let li = 0; li < RECAP.length; li++) {
    lineEls.forEach((el, j) => el.classList.toggle("speaking", j === li));
    for (const clip of RECAP[li].clips) {
      if (playing !== run) return;
      await new Promise((resolve) => {
        const a = new Audio(A(clip));
        run.audio = a;
        a.onended = a.onerror = resolve;
        a.play().catch(resolve);
      });
    }
    await new Promise((r) => setTimeout(r, 350));
  }
  stopRecap();
}
function stopRecap() {
  playing?.audio?.pause();
  playing = null;
  listenBtn.classList.remove("playing");
  lineEls.forEach((el) => el.classList.remove("speaking"));
}
listenBtn.addEventListener("click", () => (playing ? stopRecap() : playRecap()));

// Lien vers la vraie app (servie sur le port 4173 de la même machine)
$("#try-app").href = `${location.protocol}//${location.hostname}:4173/`;

// Crédits photo
fetch("photos/CREDITS.json")
  .then((r) => r.json())
  .then((list) => {
    $("#credits").innerHTML =
      "Photos: " +
      list
        .map((c) => `<a href="${c.sourceUrl}" target="_blank" rel="noopener">${c.title}</a>, ${c.author} (<a href="${c.licenseUrl}" target="_blank" rel="noopener">${c.license}</a>)`)
        .join(" · ");
  })
  .catch(() => {});

function onScroll() {
  onScrollProgress();
  onScrollPipeline();
  onScrollMonth();
}
addEventListener("scroll", onScroll, { passive: true });
addEventListener("resize", onScroll);
onScroll();
