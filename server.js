import express from "express";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { CATEGORIES, DEFAULT_PROFILE, dailyPlan } from "./lib/prompts.js";
import { AIError, MOCK, generateCategory, interviewerReply, scoreSession } from "./lib/claude.js";
import * as store from "./lib/store.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(here, "public")));

const ORDER = ["guesstimate", "rca", "product_design"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Today's date in India, YYYY-MM-DD. */
const todayIST = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

const wrap = (fn) => (req, res) =>
  fn(req, res).catch((err) => {
    const status = err instanceof AIError || err.status ? err.status : 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: err.message || "Something went wrong" });
  });

const httpError = (status, message) => Object.assign(new Error(message), { status });

async function profile() {
  return (await store.getProfile())?.text || DEFAULT_PROFILE;
}

const publicQuestion = (q) => {
  const { brief, ...rest } = q;
  return rest;
};

function overallScore(category, result) {
  const dims = CATEGORIES[category].dimensions;
  let total = 0;
  let weight = 0;
  for (const d of dims) {
    const got = result.dimensions.find((x) => x.key === d.key);
    if (!got) continue;
    total += Math.max(0, Math.min(10, got.score)) * d.weight;
    weight += d.weight;
  }
  return weight ? Math.round((total / weight) * 10) / 10 : 0;
}

// ---------- Config & profile ----------

app.get("/api/config", (req, res) => {
  res.json({
    mock: MOCK,
    today: todayIST(),
    categories: Object.fromEntries(
      ORDER.map((k) => [k, { label: CATEGORIES[k].label, targetMinutes: CATEGORIES[k].targetMinutes, dimensions: CATEGORIES[k].dimensions.map(({ key, label, weight }) => ({ key, label, weight })) }]),
    ),
  });
});

app.get("/api/profile", wrap(async (req, res) => res.json({ text: await profile() })));

app.put("/api/profile", wrap(async (req, res) => {
  const text = String(req.body?.text || "").trim();
  if (!text) throw httpError(400, "Profile cannot be empty.");
  await store.saveProfile({ text, updatedAt: new Date().toISOString() });
  res.json({ text });
}));

// ---------- Daily questions ----------

const generating = new Map(); // date -> Promise, so double clicks don't double-generate

async function generateDay(date) {
  const plan = dailyPlan(date);
  const prof = await profile();
  const recent = (await store.listDays())
    .filter((d) => d && d.date !== date)
    .slice(-30)
    .flatMap((d) => d.questions.map((q) => `${CATEGORIES[q.category].label}: ${q.prompt}`));

  const batches = await Promise.all(ORDER.map((cat) => generateCategory(cat, plan[cat], prof, recent)));
  const questions = batches.flatMap((qs, i) =>
    qs.map((q, j) => ({ ...q, id: `${ORDER[i]}-${j + 1}`, category: ORDER[i] })),
  );
  const day = { date, createdAt: new Date().toISOString(), questions };
  await store.saveDay(day);
  return day;
}

async function dayView(day) {
  const sessions = (await store.listSessions()).filter((s) => s?.date === day.date);
  return {
    date: day.date,
    questions: day.questions.map((q) => {
      const mine = sessions.filter((s) => s.qid === q.id).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
      const scored = mine.filter((s) => s.result);
      const best = scored.length ? Math.max(...scored.map((s) => s.result.overall)) : null;
      const open = mine.findLast((s) => !s.result);
      return { ...publicQuestion(q), attempts: scored.length, best, openSession: open?.id || null, lastScored: scored.at(-1)?.id || null };
    }),
  };
}

app.get("/api/days", wrap(async (req, res) => {
  const sessions = await store.listSessions();
  const days = (await store.listDays()).filter(Boolean).map((d) => ({
    date: d.date,
    total: d.questions.length,
    done: new Set(sessions.filter((s) => s?.date === d.date && s.result).map((s) => s.qid)).size,
  }));
  res.json(days.reverse());
}));

app.get("/api/day/:date", wrap(async (req, res) => {
  const { date } = req.params;
  if (!DATE_RE.test(date)) throw httpError(400, "Bad date");
  const day = await store.getDay(date);
  if (!day) throw httpError(404, "No questions for this date yet");
  res.json(await dayView(day));
}));

app.post("/api/day/:date/generate", wrap(async (req, res) => {
  const { date } = req.params;
  if (!DATE_RE.test(date)) throw httpError(400, "Bad date");
  const existing = await store.getDay(date);
  if (existing && !req.query.force) return res.json(await dayView(existing));
  if (!generating.has(date)) {
    generating.set(date, generateDay(date).finally(() => generating.delete(date)));
  }
  res.json(await dayView(await generating.get(date)));
}));

// ---------- Practice sessions ----------

async function loadSession(id) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw httpError(400, "Bad session id");
  const s = await store.getSession(id);
  if (!s) throw httpError(404, "Session not found");
  return s;
}

function sessionView(s) {
  return {
    id: s.id,
    date: s.date,
    qid: s.qid,
    question: s.result ? s.question : publicQuestion(s.question),
    stage: s.stage,
    turns: s.turns,
    notes: s.notes,
    startedAt: s.startedAt,
    answerStartedAt: s.answerStartedAt,
    endedAt: s.endedAt,
    result: s.result,
  };
}

app.post("/api/sessions", wrap(async (req, res) => {
  const { date, qid, fresh } = req.body || {};
  const day = await store.getDay(date);
  const question = day?.questions.find((q) => q.id === qid);
  if (!question) throw httpError(404, "Question not found");
  if (!fresh) {
    const open = (await store.listSessions()).filter((s) => s?.date === date && s.qid === qid && !s.result).at(-1);
    if (open) return res.json(sessionView(open));
  }
  const s = {
    id: crypto.randomUUID(),
    date,
    qid,
    question,
    stage: "clarify",
    turns: [{ role: "assistant", stage: "clarify", text: question.prompt, at: new Date().toISOString() }],
    notes: "",
    startedAt: new Date().toISOString(),
  };
  await store.saveSession(s);
  res.json(sessionView(s));
}));

app.get("/api/sessions/:id", wrap(async (req, res) => res.json(sessionView(await loadSession(req.params.id)))));

app.post("/api/sessions/:id/messages", wrap(async (req, res) => {
  const s = await loadSession(req.params.id);
  if (s.result) throw httpError(409, "This session is already scored.");
  const text = String(req.body?.text || "").trim();
  if (!text) throw httpError(400, "Message is empty.");
  if (text.length > 8000) throw httpError(400, "Message is too long (8000 characters max).");

  const turns = [...s.turns, { role: "user", stage: s.stage, text, at: new Date().toISOString() }];
  // The API needs the conversation to start with a user turn; the opening
  // question is folded into the system prompt, so drop it here.
  const reply = await interviewerReply(s.question, await profile(), turns.slice(1));
  s.turns = [...turns, { role: "assistant", stage: s.stage, text: reply, at: new Date().toISOString() }];
  await store.saveSession(s);
  res.json(sessionView(s));
}));

app.post("/api/sessions/:id/stage", wrap(async (req, res) => {
  const s = await loadSession(req.params.id);
  if (s.result) throw httpError(409, "This session is already scored.");
  if (s.stage === "clarify") {
    s.stage = "answer";
    s.answerStartedAt = new Date().toISOString();
    await store.saveSession(s);
  }
  res.json(sessionView(s));
}));

app.put("/api/sessions/:id/notes", wrap(async (req, res) => {
  const s = await loadSession(req.params.id);
  s.notes = String(req.body?.notes || "").slice(0, 20000);
  await store.saveSession(s);
  res.json({ ok: true });
}));

app.post("/api/sessions/:id/score", wrap(async (req, res) => {
  const s = await loadSession(req.params.id);
  if (s.result) return res.json(sessionView(s));
  if (!s.turns.some((t) => t.role === "user")) throw httpError(400, "Say something first — there's nothing to score yet.");

  const endedAt = new Date();
  const elapsedSec = (endedAt - new Date(s.startedAt)) / 1000;
  const transcript = s.turns
    .map((t) => `${t.role === "user" ? `CANDIDATE [${t.stage === "answer" ? "answer phase" : "clarifying phase"}]` : "INTERVIEWER"}: ${t.text}`)
    .join("\n\n");
  const result = await scoreSession(s.question, transcript, elapsedSec, s.notes);
  for (const d of result.dimensions) d.score = Math.max(0, Math.min(10, Math.round(d.score)));
  result.overall = overallScore(s.question.category, result);
  result.elapsedSec = Math.round(elapsedSec);
  result.clarifyingCount = s.turns.filter((t) => t.role === "user" && t.stage === "clarify").length;
  s.result = result;
  s.endedAt = endedAt.toISOString();
  s.stage = "done";
  await store.saveSession(s);
  res.json(sessionView(s));
}));

// ---------- Progress ----------

app.get("/api/progress", wrap(async (req, res) => {
  const scored = (await store.listSessions())
    .filter((s) => s?.result)
    .sort((a, b) => a.endedAt.localeCompare(b.endedAt));

  const byCategory = {};
  for (const cat of ORDER) {
    const list = scored.filter((s) => s.question.category === cat);
    const dims = CATEGORIES[cat].dimensions.map((d) => {
      const scores = list.map((s) => s.result.dimensions.find((x) => x.key === d.key)?.score).filter((x) => x != null);
      return { key: d.key, label: d.label, avg: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null };
    });
    const overalls = list.map((s) => s.result.overall);
    byCategory[cat] = {
      label: CATEGORIES[cat].label,
      count: list.length,
      avg: overalls.length ? Math.round((overalls.reduce((a, b) => a + b, 0) / overalls.length) * 10) / 10 : null,
      recentAvg: overalls.length ? Math.round((overalls.slice(-4).reduce((a, b) => a + b, 0) / Math.min(4, overalls.length)) * 10) / 10 : null,
      dims,
    };
  }

  // Consecutive IST days with at least one scored attempt; today not yet practised doesn't break it.
  const istDay = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const practiceDays = new Set(scored.map((s) => istDay(s.endedAt)));
  const today = todayIST();
  let streak = 0;
  for (let d = new Date(`${today}T00:00:00Z`); ; d.setUTCDate(d.getUTCDate() - 1)) {
    const key = d.toISOString().slice(0, 10);
    if (practiceDays.has(key)) streak++;
    else if (key !== today) break;
  }

  res.json({
    total: scored.length,
    streak,
    byCategory,
    recent: scored.slice(-15).reverse().map((s) => ({
      id: s.id,
      date: s.date,
      category: s.question.category,
      title: s.question.title,
      overall: s.result.overall,
      verdict: s.result.verdict,
    })),
  });
}));

app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`PM Practice Bot running at http://localhost:${port}${MOCK ? "  (MOCK mode — canned questions and feedback)" : ""}`);
  if (!MOCK && !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN)
    console.warn("Warning: ANTHROPIC_API_KEY is not set. Add it to .env, or run `npm run mock` to preview the UI.");
});
