# getjobsbooked.co landing page

Static, one file (`index.html`), no build step, no external requests. Deploy by pointing a static host (e.g. a Netlify site with publish directory `site/`) at this folder. Deployment and the domain are Claude-A / Rod's call.

Before going live:
- **Buy buttons:** replace `#STRIPE_LINK_199`, `#STRIPE_LINK_399`, `#STRIPE_LINK_699` with the Stripe links, and drop `data-placeholder="true"` from each. `npm test` fails if a placeholder is left while the others are filled, so all three move together.
- **Demo lines:** when a Twilio line goes live, change its card to `data-live="true"` and its badge to `<span class="badge live">Live</span>`.
- **Footer:** add a contact email, the legal business name, and Terms / Privacy links (the Privacy page is also needed for SMS/10DLC registration).

Copy rules (checked by `test/site.test.js`): never claim it books appointments; plan prices and minutes must match the decided tiers; every demo number must match the server's lines.
