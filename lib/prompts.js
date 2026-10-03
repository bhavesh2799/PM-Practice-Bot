// Question mix, rubrics and prompt text. Everything the interviewer "knows"
// lives here so it is easy to tune.

export const DEFAULT_PROFILE = `Product Manager, ~3.5 years experience, healthtech/healthcare-fintech background.
- Affordplan: patient engagement platform, SMB corporate health product, medicine order funnel.
- Earlier co-founded CallPrep, an AI sales-intelligence tool.
Preparing for PM interviews (2-5 yr band) at product companies in fintech, healthtech, logistics and SaaS in India (Delhi NCR, Bengaluru, Hyderabad).`;

export const CATEGORIES = {
  guesstimate: {
    label: "Guesstimate",
    targetMinutes: 12,
    dimensions: [
      { key: "clarifying", label: "Clarifying & scoping", weight: 20,
        guide: "Pins down the exact unit being estimated, geography, time period, inclusions/exclusions before diving in. Avoids pointless questions." },
      { key: "structure", label: "Approach & segmentation", weight: 25,
        guide: "Picks a sensible method (top-down / bottom-up / supply / demand) and says why; segments the population into MECE buckets that actually drive the number." },
      { key: "assumptions", label: "Assumptions & India context", weight: 20,
        guide: "Assumptions are explicit, justified and realistic for India (population ~1.45B, ~300M households, urban ~36%, tier-1/2/3 splits, income bands, smartphone penetration, etc.)." },
      { key: "math", label: "Math & sanity check", weight: 20,
        guide: "Arithmetic is right and easy to follow; rounds sensibly; triangulates or sanity-checks the final number against a known benchmark or a second method." },
      { key: "communication", label: "Communication", weight: 15,
        guide: "Thinks out loud, signposts steps, summarises the final answer with a range and the biggest sensitivities." },
    ],
  },
  rca: {
    label: "Root Cause Analysis",
    targetMinutes: 15,
    dimensions: [
      { key: "clarifying", label: "Clarifying the metric & scope", weight: 20,
        guide: "Confirms metric definition, how it is computed, exact timeframe, sudden vs gradual, and whether it is a tracking/data issue. Asks about platform, geography, user segments affected." },
      { key: "structure", label: "Hypothesis framework", weight: 20,
        guide: "Builds a structured issue tree (internal vs external; funnel steps; supply vs demand; product/tech/ops/marketing/competition/seasonality) rather than random guessing." },
      { key: "data", label: "Data-driven investigation", weight: 20,
        guide: "Asks for specific data cuts (by platform, app version, geo, cohort, channel, funnel step) and narrows hypotheses based on what the interviewer reveals. Prioritises likely causes first." },
      { key: "root_cause", label: "Root cause identification", weight: 20,
        guide: "Converges on the actual root cause(s) and can explain the mechanism end to end, distinguishing cause from symptom." },
      { key: "recommendations", label: "Fix & prevention", weight: 10,
        guide: "Proposes a short-term fix, a longer-term fix, and how to prevent/detect it earlier (alerts, guardrail metrics)." },
      { key: "communication", label: "Communication", weight: 10,
        guide: "Structured, concise, summarises findings; keeps the interviewer oriented." },
    ],
  },
  product_design: {
    label: "Product Design",
    targetMinutes: 20,
    dimensions: [
      { key: "clarifying", label: "Clarifying goal & constraints", weight: 15,
        guide: "Clarifies the company context, business goal, platform, geography, constraints and what 'success' means before designing." },
      { key: "users", label: "User segmentation & choice", weight: 20,
        guide: "Lists meaningful user segments, picks one to focus on with a clear rationale (size, pain, business fit)." },
      { key: "pain_points", label: "Pain-point depth", weight: 15,
        guide: "Walks the user journey; identifies specific, non-obvious pain points and prioritises them." },
      { key: "solutions", label: "Solutions & prioritisation", weight: 20,
        guide: "Generates several distinct solutions (incl. one bold idea), prioritises with an explicit framework (impact vs effort, RICE), and describes the chosen solution concretely (MVP)." },
      { key: "metrics", label: "Metrics & trade-offs", weight: 15,
        guide: "Defines a north-star plus supporting and guardrail metrics; discusses risks, trade-offs and how to validate (experiments, rollout)." },
      { key: "communication", label: "Structure & communication", weight: 15,
        guide: "Clear framework, signposting, time-aware, summarises; adds domain insight relevant to India." },
    ],
  },
};

const GUESSTIMATE_STYLES = ["top-down", "bottom-up", "supply-side", "demand-side"];
const STYLE_PAIRS = [];
for (let i = 0; i < GUESSTIMATE_STYLES.length; i++)
  for (let j = i + 1; j < GUESSTIMATE_STYLES.length; j++)
    STYLE_PAIRS.push([GUESSTIMATE_STYLES[i], GUESSTIMATE_STYLES[j]]);

const GUESSTIMATE_SUBJECTS = [
  "count of something (users, outlets, vehicles, devices) in India or one Indian city",
  "annual revenue / market potential of a specific product or service in India",
  "daily or monthly transaction / order / trip volume of something in India or a city",
  "consumption volume of a physical good (litres, kg, units) in a city or India",
];

const RCA_CONSUMER = [
  "food delivery app", "quick-commerce (10-minute delivery) app", "OTT streaming app",
  "ride-hailing app", "e-commerce marketplace", "consumer social / short-video app",
  "online travel booking app", "edtech learning app", "consumer UPI payments app",
];
const RCA_BUSINESS = ["fintech", "healthtech", "logistics", "B2B SaaS"];

const DESIGN_FOCUS = ["fintech", "healthtech", "logistics", "SaaS"];
const DESIGN_TYPES = [
  "design a new product for a specific user",
  "improve an existing well-known product",
  "launch a product / enter a new market or segment",
  "build a specific feature for a specific user segment",
];
const DESIGN_OPEN = [
  "consumer (anything)", "consumer social / community", "consumer mobility / travel",
  "consumer commerce", "physical product or offline experience", "consumer content / media",
];

/** Days since 2024-01-01, used to rotate the mix deterministically per date. */
export function dayIndex(dateStr) {
  const d = Date.parse(`${dateStr}T00:00:00Z`);
  return Math.floor((d - Date.parse("2024-01-01T00:00:00Z")) / 86_400_000);
}

const pick = (arr, n) => arr[((n % arr.length) + arr.length) % arr.length];

/** The day's question "slots" — what each of the 6 questions should be. */
export function dailyPlan(dateStr) {
  const n = dayIndex(dateStr);
  const flip = n % 2 === 0; // which slot gets the harder question
  const [easy, hard] = flip ? ["easier", "harder"] : ["harder", "easier"];
  return {
    guesstimate: [
      { difficulty: easy, style: pick(STYLE_PAIRS, n)[0], subject: pick(GUESSTIMATE_SUBJECTS, n) },
      { difficulty: hard, style: pick(STYLE_PAIRS, n)[1], subject: pick(GUESSTIMATE_SUBJECTS, n + 2) },
    ],
    rca: [
      { difficulty: hard, domain: pick(RCA_CONSUMER, n), kind: "consumer" },
      { difficulty: easy, domain: pick(RCA_BUSINESS, n), kind: "B2B / domain" },
    ],
    product_design: [
      { difficulty: easy, domain: pick(DESIGN_FOCUS, n), type: pick(DESIGN_TYPES, n) },
      { difficulty: hard, domain: pick(DESIGN_OPEN, n), type: pick(DESIGN_TYPES, n + 1) },
    ],
  };
}

const SHARED_GEN_RULES = `You write interview questions for mid-level (2-5 years) Product Manager interviews at Indian product companies (fintech, healthtech, logistics, SaaS, consumer tech) in Delhi NCR, Bengaluru and Hyderabad.

Rules for every question:
- Self-contained and realistic. Phrase "prompt" exactly the way an interviewer says it out loud: one to three sentences, conversational, no headings, no hints about the framework to use.
- India context: use Indian cities, INR, Indian companies/products only when it is natural (a fictional or lightly-disguised company is fine).
- Do not repeat or closely paraphrase any recent question listed by the user.
- The hidden brief is for the interviewer only and is never shown to the candidate before scoring. Make it rich enough that the interviewer can answer 8-12 realistic clarifying questions consistently.
- "difficulty" must match the slot you were given. Easier = familiar subject, fewer moving parts. Harder = less familiar subject, more segments / interacting causes / ambiguous goal.
- Keep the candidate's background in mind so questions feel relevant, but do NOT make every question about their past companies; at most one question in this batch may touch their exact past domain.`;

export function generationPrompt(category, slots, profile, recent) {
  const recentList = recent.length
    ? recent.map((q) => `- ${q}`).join("\n")
    : "(none yet)";
  const slotText = slots
    .map((s, i) => `Question ${i + 1}: ${Object.entries(s).map(([k, v]) => `${k}=${v}`).join(", ")}`)
    .join("\n");

  const perCategory = {
    guesstimate: `Write 2 GUESSTIMATE questions (market sizing / estimation), India context.
Each must be solvable in ~12 minutes with a pen and paper. The "style" in each slot is the approach the question most naturally invites (top-down, bottom-up, supply-side, demand-side) — choose a subject where that approach is the natural fit, but do not tell the candidate which approach to use.
In the brief:
- clarification_facts: answers to likely scoping questions (unit, geography, time period, inclusions/exclusions, what to do if asked about data you would not know — "make a reasonable assumption").
- reference_answer: a worked solution in the intended style with explicit assumptions and arithmetic, the final ballpark, and an acceptable range (roughly ±50%). Mention one way to triangulate.
- expected_approach: 2-4 sentences on what a strong candidate does.`,
    rca: `Write 2 ROOT CAUSE ANALYSIS questions. Each states: the product (with one line of context), the metric, the size and direction of the change (drop or spike, with a number), the timeframe, and one or two context details. Do not state the cause.
Make the true root cause specific and discoverable through good questioning (e.g. an app release that broke a step on one Android version, a payment-gateway change for one bank, a competitor promotion in two cities, a pricing change, a tracking/definition change, seasonality + a policy change, an ops/supply issue). The harder question should have two interacting causes or a red herring.
In the brief:
- hidden_context: the full truth of what happened, with the mechanism.
- clarification_facts: 10-14 topic→answer pairs covering metric definition, timeframe, sudden vs gradual, platform/app-version split, geography split, user cohort split (new vs returning), channel/acquisition split, funnel step breakdown, recent releases, marketing changes, competitor activity, seasonality/external events, data/tracking changes. Answers should be specific numbers or facts consistent with the true cause; irrelevant cuts should show "flat / no change".
- reference_answer: the root cause chain plus a strong investigation path and recommended fixes.
- expected_approach: 2-4 sentences.`,
    product_design: `Write 2 PRODUCT DESIGN questions (design / improve / launch / feature-for-segment), using the given domain and type for each slot. Phrase like a real interviewer, e.g. "Design a ... for ...", "How would you improve ...?", "You're the PM at X; how would you launch ... for ...?".
In the brief:
- hidden_context: company context the interviewer can share if asked (company stage, business goal, constraints, platform, geography, timeline, team size).
- clarification_facts: 8-12 topic→answer pairs (goal, target user if asked, platform, geography, constraints, success definition, competition, budget/timeline, existing assets/data).
- reference_answer: an outline of a strong answer — segments and which to pick, top pain points, 3-4 solutions with the prioritised one described as an MVP, north-star + guardrail metrics, key risks.
- expected_approach: 2-4 sentences.`,
  }[category];

  return {
    system: SHARED_GEN_RULES,
    user: `Candidate profile:
${profile}

${perCategory}

Slots for today:
${slotText}

Recent questions to avoid repeating:
${recentList}`,
  };
}

export function interviewerSystem(question, profile) {
  const cat = CATEGORIES[question.category];
  const brief = question.brief;
  const facts = brief.clarification_facts.map((f) => `- ${f.topic}: ${f.answer}`).join("\n");
  return `You are a senior Product Manager interviewing a candidate for a PM role (2-5 years experience band) at an Indian product company. This is a ${cat.label} round, about ${cat.targetMinutes} minutes.

Candidate background (for your awareness only; do not mention it unless relevant):
${profile}

The question you asked:
"${question.prompt}"

CONFIDENTIAL INTERVIEWER BRIEF — never reveal this wholesale, never paste it, never hint at the answer unprompted:
Context / truth: ${brief.hidden_context}
Facts you can share when the candidate asks for them:
${facts}
What a strong candidate does: ${brief.expected_approach}

How to behave:
- Stay in character as the interviewer. Speak naturally, like a real person in a video interview: short, direct, plain text, no markdown headings, no bullet lists unless sharing data.
- Answer clarifying questions concisely using the facts above. If asked something not covered, give a plausible answer consistent with the brief, or say "Good question — make a reasonable assumption and state it."
- Only share data the candidate specifically asks for. Vague questions ("is there any data?") get a nudge to be specific ("Which cut would you like to see?").
- ${question.category === "rca" ? "Do not reveal the root cause. Confirm or rule out a hypothesis only when the candidate asks for the data that tests it." : question.category === "guesstimate" ? "Do not give numbers the candidate is supposed to estimate. You may confirm or reject the scope (what's included) and tell them to assume where needed." : "Do not design the product for them. Share company context and constraints when asked."}
- When the candidate presents their approach or answer, react like a real interviewer: acknowledge briefly, and ask at most one probing follow-up (e.g. challenge an assumption, ask how they'd prioritise, ask for a metric, ask what they'd do if X). Do not teach, do not give scores, do not praise excessively.
- Messages tagged [CLARIFYING] are from the clarification phase; [ANSWER] are from the answer phase. If the candidate jumps into the answer without clarifying anything, just go along with it (it will be reflected in scoring).
- Keep each reply under ~100 words unless sharing a small data table.`;
}

export function scoringPrompt(question, transcript, elapsedSec, notes) {
  const cat = CATEGORIES[question.category];
  const dims = cat.dimensions
    .map((d) => `- ${d.key} — ${d.label} (weight ${d.weight}%): ${d.guide}`)
    .join("\n");
  const brief = question.brief;
  return {
    system: `You are a demanding but fair PM interview coach who has run hundreds of PM interview loops at Indian product companies (fintech, healthtech, logistics, SaaS). You score mock interviews for a candidate targeting 2-5 year PM roles.

Scoring scale per dimension (integer 0-10):
0-2 missing or wrong; 3-4 weak, major gaps; 5-6 average, would not stand out; 7-8 strong, hire-level for 2-5 yrs; 9-10 exceptional, rarely given.
Be calibrated: most real candidates land 4-7. Score only what is in the transcript — do not give credit for things the candidate did not say. Quote or paraphrase the candidate's own words as evidence. Feedback must be specific and actionable ("next time, ask X before Y"), not generic.`,
    user: `Round: ${cat.label} (target ${cat.targetMinutes} min; candidate took ${Math.round(elapsedSec / 60)} min)
Question asked: "${question.prompt}"

Interviewer's confidential brief:
Context / truth: ${brief.hidden_context}
Expected approach: ${brief.expected_approach}
Reference answer: ${brief.reference_answer}

Rubric dimensions:
${dims}

Transcript (tags show which phase the candidate was in):
${transcript}

Candidate's private scratchpad (written during the interview; counts as their working only if it is consistent with what they said):
${notes?.trim() ? notes.trim() : "(empty)"}

Return a score and evidence for EVERY rubric dimension above (use the exact keys). Also review their clarifying questions specifically: which were sharp, which were wasted, and which important ones they missed. In "model_answer" give a concise, well-structured strong answer for this exact question (use short paragraphs or "- " lists; it is shown to the candidate as a study aid).`,
  };
}
