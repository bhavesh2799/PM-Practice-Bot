import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { CATEGORIES, generationPrompt, interviewerSystem, scoringPrompt } from "./prompts.js";
import * as mock from "./mock.js";

const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";
export const MOCK = process.env.MOCK === "1";

// Server-side fallback: if a request is ever declined by a safety classifier,
// the API retries it on a suitable fallback model inside the same call.
const FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" };

let client;
function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

export class AIError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

function explain(err) {
  if (err instanceof AIError) return err;
  if (err instanceof Anthropic.AuthenticationError)
    return new AIError("Anthropic API key is missing or invalid. Set ANTHROPIC_API_KEY in .env and restart.", 500);
  if (err instanceof Anthropic.RateLimitError)
    return new AIError("Rate limited by the Anthropic API — wait a minute and retry.", 429);
  if (err instanceof Anthropic.APIConnectionError)
    return new AIError("Could not reach the Anthropic API. Check your network.", 503);
  if (err instanceof Anthropic.APIError)
    return new AIError(`Anthropic API error (${err.status}): ${err.message}`, 502);
  if (err?.message?.includes("Could not resolve authentication method"))
    return new AIError("ANTHROPIC_API_KEY is not set. Copy .env.example to .env, add your key and restart (or run `npm run mock` to preview the UI).", 500);
  return new AIError(err?.message || "Unknown error", 500);
}

function checkStop(res) {
  if (res.stop_reason === "refusal") throw new AIError("The model declined this request. Try regenerating.");
  if (res.stop_reason === "max_tokens") throw new AIError("The model ran out of output space. Try again.");
}

async function structured(schema, { system, user, effort, maxTokens = 16000 }) {
  try {
    const res = await getClient().beta.messages.parse({
      model: MODEL,
      max_tokens: maxTokens,
      ...FALLBACK,
      output_config: { effort, format: betaZodOutputFormat(schema) },
      system,
      messages: [{ role: "user", content: user }],
    });
    checkStop(res);
    if (!res.parsed_output) throw new AIError("Could not parse the model's response. Try again.");
    return res.parsed_output;
  } catch (err) {
    throw explain(err);
  }
}

// ---------- Question generation ----------

const Fact = z.object({ topic: z.string(), answer: z.string() });
const GeneratedQuestion = z.object({
  title: z.string().describe("3-8 word label for the question, e.g. 'EV chargers in Bengaluru'"),
  difficulty: z.enum(["easier", "harder"]),
  domain: z.string().describe("Domain / industry, e.g. fintech, healthtech, quick-commerce"),
  style: z.string().describe("Guesstimate approach style, RCA product type, or design question type"),
  prompt: z.string().describe("The question exactly as the interviewer says it"),
  brief: z.object({
    hidden_context: z.string(),
    clarification_facts: z.array(Fact),
    expected_approach: z.string(),
    reference_answer: z.string(),
  }),
});
const QuestionBatch = z.object({ questions: z.array(GeneratedQuestion) });

export async function generateCategory(category, slots, profile, recent) {
  if (MOCK) return mock.questions(category, slots);
  const { system, user } = generationPrompt(category, slots, profile, recent);
  const out = await structured(QuestionBatch, { system, user, effort: "medium" });
  if (out.questions.length < slots.length)
    throw new AIError(`Expected ${slots.length} ${category} questions, got ${out.questions.length}.`);
  return out.questions.slice(0, slots.length);
}

// ---------- Interviewer chat ----------

export async function interviewerReply(question, profile, turns) {
  if (MOCK) return mock.reply(question, turns);
  const messages = turns.map((t) => ({
    role: t.role,
    content: t.role === "user" ? `[${t.stage === "answer" ? "ANSWER" : "CLARIFYING"}] ${t.text}` : t.text,
  }));
  try {
    const res = await getClient().beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      ...FALLBACK,
      output_config: { effort: "low" },
      system: interviewerSystem(question, profile),
      messages,
    });
    checkStop(res);
    const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    if (!text) throw new AIError("Interviewer returned an empty reply. Try again.");
    return text;
  } catch (err) {
    throw explain(err);
  }
}

// ---------- Scoring ----------

function scoreSchema(category) {
  const keys = CATEGORIES[category].dimensions.map((d) => d.key);
  return z.object({
    dimensions: z.array(
      z.object({
        key: z.enum(keys),
        score: z.number().describe("Integer from 0 to 10"),
        evidence: z.string().describe("What the candidate actually did, quoting them where possible"),
        improve: z.string().describe("One concrete thing to do better next time"),
      }),
    ),
    clarifying_review: z.object({
      good: z.array(z.string()).describe("Sharp clarifying questions they asked"),
      wasted: z.array(z.string()).describe("Questions that added little"),
      missed: z.array(z.string()).describe("Important clarifying questions they should have asked"),
    }),
    strengths: z.array(z.string()),
    improvements: z.array(z.string()).describe("Top 3 most important improvements, most important first"),
    verdict: z.enum(["Strong hire", "Hire", "Lean hire", "Lean no hire", "No hire"]),
    summary: z.string().describe("2-3 sentence overall assessment"),
    model_answer: z.string(),
  });
}

export async function scoreSession(question, transcript, elapsedSec, notes) {
  if (MOCK) return mock.score(question);
  const { system, user } = scoringPrompt(question, transcript, elapsedSec, notes);
  return structured(scoreSchema(question.category), { system, user, effort: "high" });
}
