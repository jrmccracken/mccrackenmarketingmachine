# McCracken Marketing Machine

The internal marketing workspace for McCracken Marketing. One place to:

- **Monitor performance**: outbound email (Instantly), LinkedIn, Facebook, Instagram, website (GA4), Google Search Console, Google Ads and ChatGPT (OpenAI) Ads, each against the previous period.
- **Know what to do next**: a rules engine turns the numbers into ranked recommendations after every sync. Examples: campaigns spending without converting, queries one push from page one, bounce-rate warnings, overdue follow-ups. An optional **AI strategist** (Claude) reads everything and writes a weekly brief plus extra recommendations.
- **Watch the market**: the **Market radar** scans Google News for your PR keywords and outbound buying triggers (funding, new marketing leaders, rebrands, launches) every 2 hours. It also reads any RSS feed you add. Each hit is scored and classed as PR or outbound, and you can draft a pitch or turn it into a lead in one click.
- **Store and work leads**: a lightweight CRM with CSV import, scoring, a pipeline board, a per-lead timeline, follow-up reminders and notes.
- **Do the outreach**: AI-personalised emails, templates, multi-step sequences, an approval queue and sending through your own mailbox over SMTP, with a daily limit. Sequences stop automatically on reply.

Every channel shows **demo data** until it's connected, so you can explore straight away. Live data replaces demo data per channel on the first successful sync.

## Run it

Requires Node 22.13+ (uses the built-in `node:sqlite`, so there are no native modules).

```bash
npm install
cp .env.example .env      # optional, everything can be set in the UI
npm run dev               # API on :3001, app on http://localhost:5173
```

Production:

```bash
npm run build && npm start      # serves app + API on http://localhost:3001
# or
docker build -t marketing-machine . && docker run -p 3001:3001 -v mmm-data:/data -e MMM_PASSWORD=... marketing-machine
```

Set `MMM_PASSWORD` whenever it's reachable from the internet: credentials and leads live in the database.

Other scripts: `npm test`, `npm run sync` (pull every connector plus the radar from the CLI), `npm run seed` (reload demo data).

## Connecting channels

Open **Integrations**, click **Connect** on a channel, paste credentials, then **Sync now**. Credentials are stored in the local SQLite database (`data/mmm.db`). You can supply them as environment variables instead (see `.env.example`).

| Channel | What you need |
|---|---|
| Outbound email | Instantly API v2 key (Settings → Integrations → API keys in Instantly). |
| GA4 + Search Console | A Google Cloud service account with the *Google Analytics Data API* and *Search Console API* enabled. Add its email as a **Viewer** on the GA4 property and as a **user** on the Search Console property. Paste the JSON key once; both connectors share it. |
| Google Ads | Developer token, OAuth client ID/secret and a refresh token for a user with access to the account (generate with Google's OAuth playground or `google-ads` auth helpers). Add the MCC ID if you access the account through a manager. |
| ChatGPT Ads | OpenAI's ads reporting access is still limited. Either point the connector at any JSON endpoint that returns daily rows (`date, campaign, spend, impressions, clicks, conversions`), or export a CSV from the ads manager and use **Import CSV**. |
| LinkedIn | An access token from a LinkedIn app approved for the Community Management API (`r_organization_social`, `rw_organization_admin`) and your organization ID. |
| Facebook / Instagram | A long-lived Page access token with `read_insights` and `instagram_manage_insights`, plus the Page ID and Instagram business account ID. Meta renames insight metrics regularly, so the connector tries current names first and falls back to older ones. |
| Sending | SMTP for your mailbox. For Google Workspace: `smtp.gmail.com`, port 465, an app password. |
| AI strategist | An Anthropic API key (Settings → AI strategist). It uses `claude-opus-5-5`; override it with `MMM_MODEL`. |

Any channel can also be backfilled by CSV (**Integrations → Import CSV**).

## How it fits together

```
server/
  connectors/   one file per channel: fields it needs + sync({from, to}) -> metric rows
  services/
    sync.js             runs connectors, writes metrics, logs sync runs
    insights.js         period-over-period snapshot + derived KPIs (CTR, CPA, reply rate…)
    recommendations.js  rules engine + AI strategist brief
    monitor.js          market radar (RSS/Google News fetch, scoring, AI pitch drafts)
    outreach.js         templates, sequences, approval queue, sending, lead scoring
    scheduler.js        sync every 6h, radar every 2h, outreach every 15m
  routes/api.js  REST API used by the app
  db.js          SQLite schema
client/          React app (Vite)
```

All metrics live in one table (`source, metric, date, dimension → value`), so adding a channel is one connector file plus an entry in `connectors/index.js`.

### Safety rails on outreach
- Sequence emails land in the **approval queue** by default. Turn on auto-approve in Settings once you trust your templates.
- A daily send limit applies (default 40).
- Replies (logged on the lead, or moving the lead to replied/meeting/won/lost) stop sequences and cancel pending sequence emails.
- "Do not email" on a lead blocks all sends to it.
