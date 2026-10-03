// Canned data for demo mode — lets you click through the UI without an API key.
import { CATEGORIES } from "./prompts.js";

const SAMPLES = {
  guesstimate: [
    {
      title: "Daily UPI transactions in Pune",
      domain: "fintech",
      prompt: "How many UPI transactions happen in Pune on a typical day?",
      reference_answer: "Pune ~7M people → ~4.5M UPI users → ~2.5 txns/day each → ~11M/day. Range 7-18M.",
    },
    {
      title: "Diagnostic lab revenue, Hyderabad",
      domain: "healthtech",
      prompt: "Estimate the annual revenue of the diagnostic lab-test market in Hyderabad.",
      reference_answer: "~10M people, ~25% tested per year at ~₹1,800 per year → ~₹4,500 Cr. Range ₹3,000-6,500 Cr.",
    },
  ],
  rca: [
    {
      title: "Quick-commerce orders drop",
      domain: "quick-commerce",
      prompt: "You're the PM for a 10-minute grocery app. Orders in Bengaluru fell 18% week-on-week last week while other cities were flat. What happened?",
      reference_answer: "A new app release broke address autocomplete on Android 12, so new-address checkouts failed.",
    },
    {
      title: "SaaS invoice payment spike",
      domain: "B2B SaaS",
      prompt: "Our invoicing SaaS saw a 40% spike in failed auto-debit payments over the last 3 days. Walk me through how you'd debug it.",
      reference_answer: "A partner bank changed its e-mandate API; mandates for that bank's customers fail.",
    },
  ],
  product_design: [
    {
      title: "Medicine refills for seniors",
      domain: "healthtech",
      prompt: "Design a product that helps elderly patients in tier-2 cities get their chronic-care medicines refilled on time.",
      reference_answer: "Focus on caregivers of seniors on 3+ chronic meds; auto-refill with WhatsApp confirmation; north-star: on-time refill rate.",
    },
    {
      title: "Improve Google Maps for bikers",
      domain: "consumer",
      prompt: "How would you improve Google Maps for two-wheeler riders in Indian cities?",
      reference_answer: "Segment delivery riders vs commuters; pick delivery riders; lane/route suitability, voice-first nav; metric: completed trips per rider.",
    },
  ],
};

export function questions(category, slots) {
  return slots.map((slot, i) => {
    const s = SAMPLES[category][i % 2];
    return {
      title: s.title,
      difficulty: slot.difficulty,
      domain: s.domain,
      style: slot.style || slot.type || slot.kind || "",
      prompt: s.prompt,
      brief: {
        hidden_context: s.reference_answer,
        clarification_facts: [
          { topic: "Timeframe", answer: "Last 7 days vs the previous 7 days." },
          { topic: "Geography", answer: "Only the city mentioned." },
        ],
        expected_approach: "Clarify scope, structure, quantify, sanity check.",
        reference_answer: s.reference_answer,
      },
    };
  });
}

export function reply(question, turns) {
  const last = turns[turns.length - 1];
  if (last?.stage === "answer")
    return "Okay, that's a reasonable structure. What's the single assumption your answer is most sensitive to, and how would you validate it?";
  return "Good question — for this exercise, consider the last full week and only the city I mentioned. Make a reasonable assumption for anything else and state it.";
}

export function score(question) {
  const dims = CATEGORIES[question.category].dimensions;
  return {
    dimensions: dims.map((d, i) => ({
      key: d.key,
      score: 5 + (i % 3),
      evidence: `(mock) Evidence for ${d.label}.`,
      improve: `(mock) One concrete improvement for ${d.label}.`,
    })),
    clarifying_review: {
      good: ["(mock) Asked about the timeframe"],
      wasted: ["(mock) Asked about something irrelevant"],
      missed: ["(mock) Did not confirm the metric definition"],
    },
    strengths: ["(mock) Clear structure"],
    improvements: ["(mock) Sanity-check the final number", "(mock) Prioritise hypotheses", "(mock) Summarise at the end"],
    verdict: "Lean hire",
    summary: "(mock) This is placeholder feedback. Add your API key in Settings to get real scoring.",
    model_answer: `(mock) ${question.brief.reference_answer}`,
  };
}
