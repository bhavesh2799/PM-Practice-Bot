# PM Practice Bot

A personal web app for daily PM interview practice, hosted on GitHub Pages. Every day it generates **6 questions tailored to your profile** and runs each one as a mock interview with an AI interviewer, then scores you on a weighted rubric.

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

## Use it

It's a static site hosted on GitHub Pages: **https://bhavesh2799.github.io/PM-Practice-Bot/**

1. Open the site and go to **Settings**.
2. Paste an [Anthropic API key](https://console.anthropic.com/settings/keys). The first visit to Today each day generates the set, which takes about a minute. After that it is cached.

Everything runs in your browser:
- The app calls the Anthropic API directly from the page with your key. The key is stored only in this browser's localStorage and is sent only to `api.anthropic.com`.
- Questions, interviews, scores and your profile are also in localStorage. Use **Settings → Export backup / Import backup** to move them to another browser or device.
- **Demo mode** (Settings, or "Try demo mode" on first visit) serves canned questions and placeholder feedback with no API calls.

## Notes

- **Cost plans** (Settings). Monthly estimates assume all 6 interviews every day; doing 3 a day roughly halves them:
  - *Best quality*: Claude Opus 5.5 for everything, ~$55–65/month.
  - *Balanced* (default): Claude Sonnet 5.5 for everything with lighter scoring effort, ~$18–25/month.
  - *Budget*: Claude Haiku 4.5 for everything, ~$7–10/month.
- Settings shows this month's estimated spend and where it is heading by month end, computed from the token counts of each call. The Anthropic Console has the exact bill.
- Interviewer replies use prompt caching, so the repeated system prompt and earlier turns cost a tenth of the normal input price on follow-up turns.
- Opus and Sonnet requests enable server-side refusal fallback (`fallbacks: "default"`). If a request is ever declined, the API retries it on a fallback model.
- Anyone can open the public URL, but each visitor needs their own API key. Nobody can see your key or your data.

## Develop

```bash
npm install
npm run dev     # http://localhost:3000, rebuilds on change
npm run build   # static site in dist/
```

Every push to `main` or `claude/tender-lovelace-u30s1e` deploys to Pages through `.github/workflows/pages.yml`. One-time setup: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

## Files

```
src/app.js         UI (vanilla JS, hash routing)
src/backend.js     In-browser "API": days, sessions, scoring, progress
src/prompts.js     Profile default, daily rotation, rubrics, all prompt text
src/claude.js      Anthropic SDK calls (generation, interviewer, scoring)
src/store.js       localStorage persistence, export / import
src/mock.js        Canned data for demo mode
build.mjs          esbuild bundling into dist/
```
