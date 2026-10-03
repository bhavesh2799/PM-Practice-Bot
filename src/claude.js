import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { CATEGORIES, generationPrompt, interviewerSystem, scoringPrompt } from "./prompts.js";
import * as mock from "./mock.js";
import { getSettings, addUsage } from "./store.js";

export const isMock = () => !!getSettings().mock;

// Cost plans: which model does each job, and how hard it thinks.
// `monthly` is a rough estimate for doing all 6 interviews every day for 30 days.
export const PLANS = {
  quality: {
    label: "Best quality",
    detail: "Claude Opus 5.5 for everything",
    monthly: "~$55–65",
    generate: { model: "claude-opus-5-5", effort: "medium" },
    interview: { model: "claude-opus-5-5", effort: "low" },
    score: { model: "claude-opus-5-5", effort: "high" },
  },
  balanced: {
    label: "Balanced",
    detail: "Claude Sonnet 5.5 for everything, lighter scoring",
    monthly: "~$18–25",
    generate: { model: "claude-sonnet-5-5", effort: "medium" },
    interview: { model: "claude-sonnet-5-5", effort: "low" },
    score: { model: "claude-sonnet-5-5", effort: "medium" },
  },
  budget: {
    label: "Budget",
    detail: "Claude Haiku 4.5 for everything",
    monthly: "~$7–10",
    generate: { model: "claude-haiku-4-5" },
    interview: { model: "claude-haiku-4-5" },
    score: { model: "claude-haiku-4-5" },
  },
};
export const DEFAULT_PLAN = "balanced";
const plan = () => PLANS[getSettings().plan] || PLANS[DEFAULT_PLAN];

// USD per million tokens: [input, output]. Cache writes cost 1.25x input, reads 0.1x.
const PRICES = {
  "claude-opus-5-5": [4, 20],
  "claude-sonnet-5-5": [2, 10],
  "claude-sonnet-5": [2, 10],
  "claude-haiku-4-5": [1, 5],
};

function recordUsage(res, requestedModel) {
  const u = res.usage || {};
  const [inp, out] = PRICES[res.model] || PRICES[requestedModel] || [4, 20];
  const cost =
    ((u.input_tokens || 0) * inp +
      (u.cache_creation_input_tokens || 0) * inp * 1.25 +
      (u.cache_read_input_tokens || 0) * inp * 0.1 +
      (u.output_tokens || 0) * out) / 1e6;
  addUsage(cost);
}

/** Model-specific request options. Haiku 4.5 takes no effort setting and no server-side fallback. */
function modelParams({ model, effort }, extraOutputConfig = {}) {
  if (model.startsWith("claude-haiku")) {
    return { model, ...(Object.keys(extraOutputConfig).length ? { output_config: extraOutputConfig } : {}) };
  }
  return {
    model,
    // Server-side fallback: if a request is ever declined by a safety classifier,
    // the API retries it on a suitable fallback model inside the same call.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort, ...extraOutputConfig },
  };
}

// Calls go straight from the browser to the Anthropic API with the key the
// user saved in Settings (kept in this browser's localStorage only).
let client;
let clientFor;
function getClient() {
  const { apiKey, workspaceId } = getSettings();
  if (!apiKey) throw new AIError("Add your Anthropic API key in Settings first (or turn on demo mode).", 401);
  const fingerprint = `${apiKey}|${workspaceId || ""}`;
  if (!client || clientFor !== fingerprint) {
    client = new Anthropic({
      apiKey,
      dangerouslyAllowBrowser: true,
      // Keys that aren't scoped to a workspace must name one on every request.
      defaultHeaders: workspaceId ? { "anthropic-workspace-id": workspaceId } : undefined,
    });
    clientFor = fingerprint;
  }
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
    return new AIError("Your Anthropic API key was rejected. Check it in Settings.", 401);
  if (err instanceof Anthropic.RateLimitError)
    return new AIError("Rate limited by the Anthropic API — wait a minute and retry.", 429);
  if (err instanceof Anthropic.APIConnectionError)
    return new AIError("Could not reach the Anthropic API. Check your network.", 503);
  if (err instanceof Anthropic.BadRequestError && /anthropic-workspace-id/.test(err.message))
    return new AIError(
      /valid workspace ID/.test(err.message)
        ? "The Workspace ID in Settings isn't valid. Copy it from the Anthropic Console (it starts with wrkspc_)."
        : "This API key isn't tied to a workspace. In Settings, either paste a key created inside a workspace, or add the Workspace ID (starts with wrkspc_).",
      400,
    );
  if (err instanceof Anthropic.APIError)
    return new AIError(`Anthropic API error (${err.status}): ${err.message}`, 502);
  return new AIError(err?.message || "Unknown error", 500);
}

function checkStop(res) {
  if (res.stop_reason === "refusal") throw new AIError("The model declined this request. Try regenerating.");
  if (res.stop_reason === "max_tokens") throw new AIError("The model ran out of output space. Try again.");
}

async function structured(schema, { system, user, job, maxTokens = 16000 }) {
  try {
    const res = await getClient().beta.messages.parse({
      ...modelParams(job, { format: betaZodOutputFormat(schema) }),
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    });
    recordUsage(res, job.model);
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
  if (isMock()) return mock.questions(category, slots);
  const { system, user } = generationPrompt(category, slots, profile, recent);
  const out = await structured(QuestionBatch, { system, user, job: plan().generate });
  if (out.questions.length < slots.length)
    throw new AIError(`Expected ${slots.length} ${category} questions, got ${out.questions.length}.`);
  return out.questions.slice(0, slots.length);
}

// ---------- Interviewer chat ----------

export async function interviewerReply(question, profile, turns) {
  if (isMock()) return mock.reply(question, turns);
  const messages = turns.map((t) => ({
    role: t.role,
    content: t.role === "user" ? `[${t.stage === "answer" ? "ANSWER" : "CLARIFYING"}] ${t.text}` : t.text,
  }));
  try {
    const job = plan().interview;
    const res = await getClient().beta.messages.create({
      ...modelParams(job),
      max_tokens: 4000,
      // The system prompt and earlier turns repeat on every reply; caching them
      // makes each follow-up turn bill the repeated part at a tenth of the price.
      cache_control: { type: "ephemeral" },
      system: interviewerSystem(question, profile),
      messages,
    });
    recordUsage(res, job.model);
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
  if (isMock()) return mock.score(question);
  const { system, user } = scoringPrompt(question, transcript, elapsedSec, notes);
  return structured(scoreSchema(question.category), { system, user, job: plan().score });
}
