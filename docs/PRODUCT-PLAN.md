# Marketing Machine: product plan

*Draft, November 2026. Turning McCracken Marketing's internal dashboard into a product other people pay for.*

## 1. Summary

Marketing Machine already works well as McCracken Marketing's own marketing workspace. It brings outbound email, social, website, search and paid-ads performance into one place, recommends what to do next, finds PR and sales opportunities, and stores and contacts leads.

To sell it, it has to change from **one business, set up by hand** to **many separate customers who set themselves up**. The plan:

1. **Prove demand first (weeks 1 to 6):** sell a set-up-for-you version to 5 to 10 fractional CMOs, consultants and small agencies, using the product largely as it is.
2. **Build the foundations (about months 2 to 4):** separate customer accounts, team logins, billing, encrypted credentials, and hosting that grows.
3. **Remove the manual setup (about months 3 to 6, overlapping):** one-click "Connect" buttons for Google, Microsoft, LinkedIn and Meta, which depend on those platforms approving the app.
4. **Launch publicly** once the legal, support and reliability basics are in place.

The decision to build steps 2 to 4 should depend on step 1: whether people pay.

## 2. Who it is for

**Primary customer:** fractional CMOs, independent marketing consultants and small B2B agencies (1 to 10 people) who run marketing for several client businesses.

**Their problem:** their client data is spread across GA4, Search Console, ad platforms, LinkedIn, email tools and spreadsheets. They spend hours each week pulling numbers together, deciding priorities and chasing access, and outbound and PR opportunities get missed.

**Secondary customer, later:** in-house marketing leads at small B2B companies who want the same view for one business.

## 3. Why it would win

Plenty of tools already show marketing numbers in one place, for example AgencyAnalytics, Databox, Whatagraph, Klipfolio and HubSpot's reporting. Marketing Machine should not compete as "another dashboard". Its difference is that it covers the whole loop in one product:

| | Typical reporting tool | Marketing Machine |
| --- | --- | --- |
| See performance across channels | Yes | Yes |
| Tells you what to do next, ranked by impact | Rarely | Yes (rules plus AI weekly brief) |
| Finds PR and outbound opportunities | No | Yes (market radar) |
| Identifies companies visiting your website | Separate tool | Built in |
| Stores leads and helps you contact them | Separate CRM and email tool | Built in |
| Client onboarding and access checklist | No | Yes (Marketing Control Centre portal) |

**Positioning line (draft):** *"The operating system for fractional CMOs: see every client's marketing, know what to do next, and win the next client, in one place."*

## 4. What exists today

Built and in use:

- **Dashboard:** overview, channel pages (email, social, website, search, paid), recommendations, market radar, company visitors, leads, outreach with templates and sequences, integrations, settings. Clean SaaS-style interface, works on phones.
- **Integrations:** GA4, Search Console, Google Ads, Netlify forms, Microsoft Clarity, Google Sheets visitor log, Instantly, the Claude lead-pipeline artifact, and CSV/Excel import for LinkedIn, Meta and ChatGPT Ads.
- **AI:** weekly strategy brief, email and pitch drafting (Anthropic).
- **Client portal (Marketing Control Centre):** a separate app with secure separate workspaces, magic-link sign-in, database-level security, file uploads and email alerts. Built and tested, but not yet deployed.

**Limits for selling:**

- one database and one password;
- connections need technical setup (service accounts, pasted API keys);
- secrets are stored unencrypted;
- it relies on McCracken Marketing's own accounts (the Claude artifact, the Anthropic key, Netlify forms);
- it runs on a single small server.

## 5. What has to change

### 5.1 Must-haves before charging anyone

| Gap | What is needed | Notes |
| --- | --- | --- |
| **Separate customer accounts** | Sign-up, an organisation for each customer, team members with roles, data isolated per customer | Reuse the portal's foundations: Supabase Auth, Postgres and row level security. |
| **Multiple client businesses per login** | An agency or consultant account holds several client "workspaces" and switches between them | Essential for the primary customer. Combines naturally with the client portal. |
| **One-click connections** | Proper sign-in ("OAuth") apps for Google (Analytics, Search Console, Ads), Microsoft (Clarity, Ads), LinkedIn and Meta | Each platform reviews the app. Google needs verification for these permissions; Google Ads also needs a developer token with Standard access; LinkedIn's marketing permissions are the hardest to get. **Apply early**: approvals can take weeks or months. |
| **Encrypted credentials** | Tokens encrypted at rest, never shown again, revocable; least-privilege access | Required for any security questionnaire from customers. |
| **Billing** | Plans, a free trial, card payments, VAT invoices, automatic lock when unpaid | Stripe Billing plus a customer portal. |
| **Self-serve onboarding** | Guided setup (connect website, Google, LinkedIn, email in about 10 minutes), sample data until connected | |
| **Legal** | Terms of service, privacy policy, data processing agreement, subprocessor list | **Have a solicitor review.** Company visitor tracking needs cookie consent on each customer's site. Cold email in the UK falls under PECR: B2B email to company addresses is generally allowed, but sole traders and some partnerships need consent. |

### 5.2 Needed to keep customers

| Gap | What is needed |
| --- | --- |
| **Scalable hosting** | Move from SQLite on one server to Postgres (Supabase); run background syncs as separate jobs or a queue; automatic backups; error tracking and uptime alerts. |
| **Remove McCracken-specific dependencies** | Lead pipeline: a built-in version or a generic import, not the personal Claude artifact. Website enquiries: support common form tools and a webhook, not only Netlify. AI: platform key with usage limits per plan, or let customers bring their own key. |
| **Email sending** | Each customer connects their own Google Workspace or Microsoft 365 mailbox; daily limits, unsubscribe handling, bounce detection, sending warnings. |
| **Branded client reports** | A monthly PDF or link with the agency's logo, to send to their own clients. A strong reason to buy for agencies. |
| **Support** | Help centre, in-app chat or email support, status page, onboarding call for early customers. |
| **Market radar data** | Google News feeds are fine internally, but fragile and in a grey area at scale. Move to a licensed news API before public launch. |
| **ChatGPT Ads** | No public API, so keep CSV upload and say so up front. Revisit if an API appears. |

### 5.3 Later

- In-house version for single businesses.
- More channels: Microsoft Ads, TikTok, HubSpot, Pipedrive.
- Benchmarks across customers (anonymised, opt-in).
- An API and Zapier/Make integration.
- White-label option for larger agencies.

## 6. Target architecture

| Layer | Today | Target |
| --- | --- | --- |
| Accounts and sign-in | One shared password | Supabase Auth: organisations, members, roles, magic link plus Google sign-in |
| Database | SQLite file on Render | Supabase Postgres with row level security per organisation and workspace |
| Background syncs | Timers inside the web server | Separate job runner or queue with retries, one job per connection |
| Credentials | Plain text in database | Encrypted at rest, server-side only |
| Integrations | Service accounts and pasted keys | OAuth apps per platform, plus CSV import for those without APIs |
| Billing | None | Stripe Billing, plan limits enforced in the app |
| Email | One SMTP mailbox | Per-user Google/Microsoft mailbox connection; Resend for system emails |
| Hosting | One Render instance | Web app plus workers; staging and production environments; backups and monitoring |

The client portal already follows this target design, so the cheapest route is to move the dashboard onto the same foundations rather than adding accounts to the current server.

## 7. Pricing options (to test, not decided)

Price on value, per client workspace, since that is how agencies and consultants think. Look at competitor pricing at the time of launch; these are starting points for discovery calls.

| Plan | For | Includes | Indicative price |
| --- | --- | --- | --- |
| **Solo** | Independent consultant | 1 user, up to 3 client workspaces, core integrations, recommendations, radar, leads | £79 to £129 a month |
| **Studio** | Fractional CMO or small agency | 3 users, up to 10 workspaces, client portal, branded reports, AI brief | £199 to £299 a month |
| **Agency** | Larger agency | More users and workspaces, white-label, priority support | £499+ a month or quote |
| **Done-for-you pilot** | Early customers | Set up and maintained by McCracken Marketing | £150 to £300 a month plus a set-up fee |

Offer a 14-day trial for self-serve plans, and annual billing at roughly two months free. Include a fair AI usage allowance in each plan.

## 8. Go-to-market

1. **Founder-led sales.** Start with James's network of fractional CMOs, consultants and agency owners, the Frances & Kevin audience, and LinkedIn content showing real outputs (a weekly brief, a radar opportunity, a client onboarding checklist).
2. **Design partners.** 5 to 10 paying pilot customers at a discount, in exchange for weekly feedback and a case study.
3. **Content.** "How I run marketing for 6 clients in 4 hours a week" style posts, short demo videos, templates such as the onboarding checklist.
4. **Partnerships.** Fractional CMO networks, CIM communities, agency groups.
5. **Self-serve launch** once onboarding and billing work, with a free trial and a clear demo.

## 9. Roadmap

Timings are rough and assume one developer with Claude doing most of the build. Platform approvals are the main uncertainty.

| Phase | When (approx.) | Outcome | Main work |
| --- | --- | --- | --- |
| **0. Validate** | Weeks 1 to 6 | 5 to 10 paying pilots, or a clear "no" | Discovery calls; demo; set up pilots by hand; collect feedback. **Start Google, Microsoft and LinkedIn app applications now.** |
| **1. Foundations** | Months 2 to 3 | Separate accounts, workspaces, teams, billing | Move data to Supabase; organisations and roles; Stripe; encrypted credentials; staging environment |
| **2. Connections** | Months 3 to 5 | Customers connect tools themselves | OAuth for Google (GA4, Search Console, Ads), Microsoft, Meta, LinkedIn; generic form webhook; built-in lead import |
| **3. Product for agencies** | Months 4 to 6 | Reasons to buy and stay | Client switcher, branded monthly report, portal included in plans, per-mailbox email sending |
| **4. Launch readiness** | Months 5 to 6 | Safe to sell publicly | Terms, privacy policy and DPA reviewed by a solicitor; help centre; status page; monitoring; backups; security review; licensed news source |
| **5. Public launch** | About month 6 | Self-serve sign-ups | Website, pricing page, trial, onboarding emails |

## 10. Running costs (indicative, check current pricing)

| Item | Early stage (pilots) | At around 50 customers |
| --- | --- | --- |
| Hosting (Render or similar, web plus worker) | £10 to £30 a month | £50 to £150 a month |
| Supabase (Pro plan, backups) | about £20 a month | £20 to £100 a month |
| Email (Resend) | free to £20 a month | £20 to £80 a month |
| AI (Anthropic) | £10 to £50 a month | Depends on allowance; budget a small amount per customer each month |
| News API, error tracking, help centre | £0 to £50 a month | £100 to £300 a month |
| Legal (one-off) | £1,000 to £3,000 for terms, privacy and DPA | Annual review |

These figures are estimates, not quotes.

## 11. Risks

| Risk | Impact | How to reduce it |
| --- | --- | --- |
| Platform approvals are slow or refused (especially LinkedIn) | Customers can't self-connect | Apply early; keep CSV import as a fallback; launch with Google first |
| Crowded reporting market | Hard to stand out | Lead with recommendations, radar and outreach, not charts; niche on fractional CMOs |
| Data protection or cold email complaints | Legal and reputational | Solicitor review; consent tools; sending limits; clear acceptable-use policy |
| AI costs grow with usage | Margin squeeze | Usage limits per plan; cheaper models for routine drafts; bring-your-own-key option |
| Time taken away from consulting income | Cash flow | Validate with paid pilots before building; phase the work |
| Security incident | Trust lost | Database-level isolation, encrypted credentials, backups, security review before launch |

## 12. Measures of success

- **Validation:** 5 or more paying pilots within 6 weeks; at least 3 using it weekly after a month.
- **Activation:** a new customer connects at least 2 data sources and sees a recommendation within the first day.
- **Retention:** monthly churn under 5% after the first 3 months.
- **Revenue:** first £1,000 a month of recurring revenue, then £5,000 a month within 12 months of launch (targets to set after the pilots).
- **Usage:** weekly active accounts; recommendations marked done; leads contacted through the product.

## 13. Decisions needed from James

1. Who is the first customer: fractional CMOs and consultants, agencies, or in-house marketers?
2. Brand: keep "Marketing Machine" under McCracken Marketing, or a separate product brand?
3. Pilot offer and price for the first 5 to 10 customers.
4. Whether to start the Google, Microsoft and LinkedIn app applications now (recommended).
5. Budget and time available for the build over the next 6 months.
6. Whether the client portal is sold as part of the product or kept for McCracken Marketing clients only.
