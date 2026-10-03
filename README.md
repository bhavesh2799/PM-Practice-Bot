# PM Practice Bot

A personal web app for daily PM interview practice. Every day it generates **6 questions tailored to your profile** and runs each one as a mock interview with an AI interviewer, then scores you on a weighted rubric.

## The daily set

| Category | Count | Mix |
|---|---|---|
| Guesstimate | 2 | India context; rotates top-down / bottom-up / supply-side / demand-side styles and subjects (counts, revenue, daily volume, consumption) |
| Root Cause Analysis | 2 | One consumer product, one fintech / healthtech / logistics / B2B SaaS. Each states product, metric, size and timeframe of the change, and context |
| Product Design | 2 | One in fintech / healthtech / logistics / SaaS, one open; rotates design / improve / launch / feature-for-segment |

Each category has one easier and one harder question. The last 30 days of questions are passed to the generator so they are not repeated. The mix rotates deterministically by date (`dailyPlan()` in `lib/prompts.js`).

## How an interview works

1. **Clarify**: ask the interviewer questions. Each question comes with a hidden brief (facts, the real root cause, a reference answer), so the interviewer's answers stay consistent. You get specific data only when you ask for a specific cut.
2. **Answer**: present your structure and answer, in one message or several. The interviewer may push back or probe like a real one. A scratchpad (autosaved) is available for your math and your issue tree.
3. **Score**: you get a 0–10 score per rubric dimension with evidence quoted from what you said, plus a review of your clarifying questions (sharp / low value / missed), your strengths, your top 3 improvements, a hire verdict, a model answer, and the interviewer's hidden brief.

Rubrics (weights in `lib/prompts.js`):

- **Guesstimate**: Clarifying & scoping 20, Approach & segmentation 25, Assumptions & India context 20, Math & sanity check 20, Communication 15
- **RCA**: Clarifying the metric 20, Hypothesis framework 20, Data-driven investigation 20, Root cause 20, Fix & prevention 10, Communication 10
- **Product Design**: Clarifying goal 15, User segmentation 20, Pain points 15, Solutions & prioritisation 20, Metrics & trade-offs 15, Structure & communication 15

The **Progress** page shows your average per category and per rubric dimension, your day streak, and your recent interviews, so you can see which skill to work on.

## Run it

Requires Node 20.12+ and an [Anthropic API key](https://console.anthropic.com).

```bash
npm install
cp .env.example .env      # then put your key in ANTHROPIC_API_KEY
npm start                 # http://localhost:3000
```

The first visit each day generates the set, which takes about a minute. After that it is cached.

To try the UI without a key, run `npm run mock`. It serves canned questions and placeholder feedback.

Your profile is editable on the **Profile** page. Use **↻ New set** on Today to regenerate a day's questions after you change it. All data (questions, sessions, profile) is stored as JSON in `./data/`, which is gitignored.

## Notes

- Model: `claude-opus-5-5`. You can override it with `CLAUDE_MODEL`. Question generation uses medium effort, the interviewer's replies use low effort (fast), and scoring uses high effort.
- Requests enable server-side refusal fallback (`fallbacks: "default"`). If a request is ever declined, the API retries it on a fallback model.
- Rough cost: about $0.30–0.60 to generate a day's 6 questions, 1–2 cents per interviewer reply, and about $0.10–0.20 per scoring. A full day of 6 interviews comes to roughly $1.50–2.

## Files

```
server.js          Express API and static hosting
lib/prompts.js     Profile default, daily rotation, rubrics, all prompt text
lib/claude.js      Anthropic SDK calls (generation, interviewer, scoring)
lib/store.js       JSON file storage in ./data
lib/mock.js        Canned data for `npm run mock`
public/            Frontend (vanilla HTML/CSS/JS)
```
