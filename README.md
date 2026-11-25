# AirWise: Urban Air Quality Assistant

AirWise is a GenAI-powered assistant for families and communities living through winter smog and urban air pollution. You give it your location and a few details about your household. It looks up live air quality and the 24-hour forecast, then builds a personalised plan with three parts:

- **A low-emission daily routine.** It tells you when to go outside, how to commute and exercise, and how to protect children and other sensitive family members.
- **Indoor air quality hacks** that fit your home: your heating, your cooking fuel, and whether you have a purifier.
- **Sustainable alternatives** with quantified impact. Each one shows the kg of CO₂ and grams of PM2.5 it saves per month, plus a tree-equivalent.

Every recommendation explains **why** it matters. Google Gemini then turns the plan into a short, friendly briefing and answers follow-up questions.

---

## Chosen vertical

**Challenge 06: Urban Air Quality Assistant.** The challenge asks for help with severe winter smog: low-emission routines, indoor air hacks and sustainable alternatives, tailored to location and lifestyle, with a clear explanation of the direct impact of each choice.

## Approach and logic

The design rule is **"Rules decide, AI explains."** Health advice must be reliable, so every decision comes from a deterministic, tested engine. Gemini is grounded on that engine's output. It explains the decisions and answers questions about them, but it never makes up numbers.

```
Browser (accessible form)
   │  POST /api/plan  {city | lat/lon, household, commute, home}
   ▼
Node.js server ── validation ── rate limit ── security headers
   │
   ├─► Open-Meteo geocoding + Air Quality API (CAMS)   ← cached 10 min, in-flight de-duplicated
   │
   ├─► Decision engine (pure functions)
   │     1. assessRisk:        AQI category + sensitive-group bump + cigarette equivalent
   │     2. findCleanWindows:  cleanest/dirtiest 2-hour daytime windows in the next 24 h
   │     3. buildRoutine:      timing, exercise, commute, masks, children, medication
   │     4. buildIndoorHacks:  ventilation, purifier/DIY filter, cooking, heating, cleaning
   │     5. buildAlternatives: commute/heating/cooking switches with CO₂ & PM2.5 impact
   │
   └─► Gemini (REST) receives a compact JSON context and writes the briefing or answer
         └─ falls back to rule-based text if there is no key, a timeout or an error
```

### Key decision rules

| Context signal | Decision |
|---|---|
| AQI category (EPA 2024 breakpoints) | Base risk level, from Good to Hazardous |
| Household has children, elderly, asthma, heart condition or pregnancy | Personal risk raised **one level** once AQI is Moderate or worse (EPA sensitive-group guidance) |
| Hourly forecast | Recommends the **cleanest 2-hour daytime window** and warns about the peak window. Winter inversions make timing a strong lever |
| Outdoor exercise and personal risk | Move workouts indoors (High+), keep them light and short (Elevated), or exercise normally (Low) |
| AQI > 100 | N95/FFP2 guidance, with child-specific mask advice |
| No purifier and smog | Low-cost DIY box-fan + MERV-13 filter (Corsi–Rosenthal style) |
| Wood, coal or kerosene heating; biomass or kerosene cooking | High-priority safety hacks plus quantified switch to heat pump/electric or LPG/induction |
| Car or motorbike commute | Metro/bus/carpool switches with monthly savings. Cycling is suggested only for trips ≤ 8 km **when air is clean** |
| AQI > 150 and the household commutes | Work-from-home on the worst days, with savings for 4 days/month |

### Explaining direct impact

Each sustainable switch includes:
- **CO₂ saved per month** (kg) and **PM2.5 emissions avoided** (g)
- A **tree equivalent**: years of CO₂ uptake by mature trees, at about 21 kg/tree/year
- An honest note when a switch *increases* CO₂ but cuts PM2.5 a lot. Example: biomass to induction on a coal-heavy grid.

Exposure is also made concrete. AirWise converts PM2.5 into a **cigarette equivalent** using the Berkeley Earth rule of thumb, where 22 µg/m³ for 24 hours ≈ 1 cigarette.

## How the solution works

### Run locally

Requirements: **Node.js 22+**. There are **no npm dependencies** to install.

```bash
git clone <your-repo-url> && cd <repo>
cp .env.example .env          # optional: add GEMINI_API_KEY for AI briefings
npm start                     # http://localhost:8080
npm test                      # run the test suite
```

Without a `GEMINI_API_KEY` the app still works fully. Briefings and answers then come from the rule-based fallback.

### Deploy to Google Cloud Run

```bash
gcloud run deploy airwise --source . --region asia-south1 --allow-unauthenticated \
  --set-env-vars TRUST_PROXY=true,GEMINI_MODEL=gemini-2.5-flash \
  --set-secrets GEMINI_API_KEY=gemini-api-key:latest
```

### API

| Method & path | Purpose |
|---|---|
| `GET /api/health` | Liveness check |
| `GET /api/config` | Reports whether AI is enabled |
| `GET /api/air?city=Delhi` or `?latitude=..&longitude=..` | Normalised live air data |
| `POST /api/plan` | Full personalised plan plus AI briefing |
| `POST /api/ask` | Grounded answer to a follow-up `question` |

Example request body:

```json
{
  "city": "Delhi",
  "sensitivities": ["children", "respiratory"],
  "commuteMode": "car",
  "commuteKm": 12,
  "heating": "wood",
  "cooking": "gas",
  "hasPurifier": false,
  "exercisesOutdoors": true
}
```

### Project structure

```
server.js                 Composition root (wires dependencies, graceful shutdown)
src/config.js             Validated env configuration
src/errors.js             Typed HTTP errors
src/engine/               Pure decision logic (no I/O)
  aqi.js                  EPA categories, PM2.5→AQI, cigarette equivalent
  forecast.js             Clean/peak window detection
  impact.js               Emission factors and savings maths
  profile.js              Input validation and normalisation
  recommendations.js      Risk, routine, indoor hacks, alternatives
src/services/             I/O adapters
  airQuality.js           Open-Meteo client with caching and timeouts
  assistant.js            Gemini client with graceful fallback
  prompt.js               Grounded prompts and prompt-injection hardening
  fallback.js             Deterministic briefing/answers
  cache.js                TTL + LRU cache with request de-duplication
src/server/               HTTP layer (routing, security, static files, rate limiting)
public/                   Accessible, framework-free frontend
tests/                    node:test suites for every layer
```

## Evaluation focus areas

- **Code quality.** The code is split into layers (engine, services, server, UI). The engine is made of pure functions, and dependencies are injected so every layer can be tested. Exported functions have JSDoc, and constants are frozen.
- **Security.**
  - Strict CSP and other security headers. All input is validated against whitelists and bounds.
  - JSON bodies are capped at 10 KB and checked for content type.
  - Each IP is rate-limited. Static files are served from an in-memory whitelist, so path traversal is impossible.
  - The Gemini key is sent in a header, never in the URL, and is never logged.
  - User questions are wrapped in delimiters with injection-resistant system rules. Model output is rendered with `textContent` only, which prevents XSS.
  - Errors are generic, with no stack traces. Coordinates are rounded to about 1 km for privacy, and nothing is stored.
- **Efficiency.**
  - There are no runtime dependencies, and the Docker image is small and runs as a non-root user.
  - Air data is cached with a TTL and LRU eviction, and concurrent requests for the same place share one upstream call.
  - Static assets are pre-gzipped and served with ETags and 304 responses.
  - The Gemini context is compact, which saves tokens, and every outbound call has a timeout.
- **Testing.** 75 `node:test` tests cover AQI maths, impact maths, validation, forecast windows, decision rules, caching, the Open-Meteo client, the Gemini client and its fallbacks, prompt-injection hardening, and HTTP behaviour (status codes, headers, rate limiting, path traversal). GitHub Actions CI runs them on every push.
- **Accessibility.**
  - The page uses semantic landmarks, a skip link, and fieldsets with legends. Labels are linked to their hints and errors.
  - `aria-live` regions announce status changes, and focus moves to the results.
  - AQI colours meet WCAG AA contrast and are always paired with a text label.
  - The forecast chart has a text summary and a data-table alternative.
  - Touch targets are 44 px. The layout supports dark mode, reduced motion and forced colours.

## Assumptions

- **Air data** comes from Open-Meteo's CAMS-based model. It is global and needs no key, but it is a modelled estimate, not a reading from a local monitoring station.
- **AQI** uses the **US EPA scale** with the 2024 PM2.5 breakpoints, which gives one consistent scale for every city. National indices such as India's NAQI use different bands.
- **Emission factors** (see `src/engine/impact.js`) are **indicative averages**, rounded from DEFRA, EEA/EMEP and WHO sources. They are meant for comparing choices, not for carbon accounting.
  - Commutes are round trips, 22 workdays per month.
  - Heating and cooking use 30 days per month.
  - Wood CO₂ is counted as mostly biogenic.
- **"Sensitive groups"** raise personal risk by exactly one level. This simple, explainable rule follows EPA guidance.
- **Daytime windows** are 06:00–21:00 local time, using the location's own timezone.
- **Not medical advice.** AirWise gives general guidance and tells users to contact a healthcare professional if they have symptoms.
- **Rate limiting** and caching are in-memory, which suits a single instance. A multi-instance deployment would move them to a shared store such as Redis or Memorystore.
