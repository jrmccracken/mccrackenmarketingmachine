# Changes needed on mccrackenmarketing.co.uk

**Not yet applied.** The mccrackenmarketing.co.uk source code isn't in this repository (only a draft Fractional CMO page with a placeholder footer exists, on another branch). These changes are ready to apply once the website source is available. Apply them **after** the portal passes the go-live checklist in `portal/README.md`, so the link never points at an unfinished portal.

## 1. "Client login" link in the footer

Add one link to the **Company** column of the footer on every page, keeping the existing footer markup and classes. Only the `<li>` is new; copy whatever list-item and link classes the neighbouring Company links use:

```html
<li><a href="https://portal.mccrackenmarketing.co.uk/login" rel="nofollow">Client login</a></li>
```

- Don't add it to the main navigation or style it as a call to action.
- `rel="nofollow"` stops search engines following it; the portal also sends `noindex`.
- If the footer is a shared template or include, change it once. If every page has its own copy of the footer, change every page.
- Don't add the portal to `sitemap.xml`.

**Check nothing was missed** (from the website's root folder):

```bash
# every HTML page that has a footer…
grep -rl --include='*.html' '<footer' . | sort > /tmp/with-footer.txt
# …must contain the link
grep -rl --include='*.html' 'portal.mccrackenmarketing.co.uk/login' . | sort > /tmp/with-link.txt
comm -23 /tmp/with-footer.txt /tmp/with-link.txt   # should print nothing
```

## 2. Privacy policy: new section

Suggested wording for a new section, in plain English. **Have this reviewed by a qualified professional before publishing.** Items in [square brackets] are decisions only you can make; don't publish them as placeholders.

> ### Client portal (Marketing Control Centre)
>
> If you are a client, or work for a client, we may give you access to our client portal, the Marketing Control Centre. We use it to manage onboarding and our work together.
>
> **What we process.** Your name and business email address; the comments and answers you add; the business documents and links you upload; records of the access and onboarding tasks you complete; and a log of activity in the portal, including when you sign in.
>
> **Why.** To deliver the services we have agreed with your organisation, to keep a record of the work and of who changed what, to keep the portal secure, and to send you sign-in links, notifications and reminders about outstanding items. [Lawful basis to be confirmed: for example, performance of our contract with your organisation and our legitimate interests in running and securing the service.]
>
> **Who provides the services we use.** The portal is hosted by Netlify; its database, file storage and sign-in system are provided by Supabase [in the UK (London) region]; emails are sent by Resend. They process the data on our behalf and under our instructions. [Confirm whether any processing takes place outside the UK and the safeguards that apply, for example the UK International Data Transfer Addendum or adequacy regulations.]
>
> **Please don't upload unnecessary personal data.** The portal is for business documents. Please don't upload passwords, or personal details about customers or staff that we don't need, and never upload special-category data such as health information. Remove personal details from exports where you can.
>
> **How long we keep it.** We keep portal information for the length of our engagement and for [period, for example 12 months] afterwards, then delete it, unless we need to keep something longer for legal or accounting reasons. Backups are deleted on a rolling basis [period].
>
> **Your rights.** You can ask for a copy of the personal information we hold about you in the portal, or ask us to correct or delete it, by emailing james@mccrackenmarketing.co.uk. [Add or link to your existing section on rights and complaints, including the right to complain to the Information Commissioner's Office.]

Also check whether the existing policy's list of suppliers (processors) needs Netlify, Supabase and Resend adding.
