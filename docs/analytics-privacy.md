# Analytics privacy policy and verification

The initial privacy update retained GA4 on the 43 pages that already used it. A subsequent owner-requested update removes it from all 18 tools labelled BAU or KT in tools-metadata.json. Pages without tags are not opted in. Tool documents are processed by their existing application code; this policy concerns analytics, not all third-party resources.

## Collection contract

- Page location is a fixed public repository URL for the tool, with no runtime query, fragment, alternate host or user-controlled filename.
- Page title is a fixed tool identity rather than the browser title or generated document title. Page referrer is empty and referral attribution is ignored.
- Google signals and ad personalization signals are disabled in the snippet; advertising consent defaults to denied. Google tag loading uses `referrerpolicy="no-referrer"`.
- `rmitTrackEvent` accepts only four fixed HVAC lifecycle names and ignores extra arguments. Individual answers/correctness and manually emitted session-end events are removed.
- This change does not declare that analytics consent has been granted. Institutional decisions about notices, consent and analytics storage remain with RMIT.
- The publisher replaces recognized legacy tags with the same policy. Custom Google tracking requires review; the publisher rejects it instead of silently adding another tag. `<!-- rmit-analytics: disabled -->` opts a tool out of automatic injection.

The policy is generated from `tools-admin-worker/src/analytics-policy.js`. Run `node scripts/update-analytics.mjs` to refresh existing tagged HTML. Keep the snippets inline so downloaded HTML tools remain standalone.

## Account configuration and observed changes

Maintain these in the correct GA4 stream (`G-1MDBG3TN2X`) and Google tag, separately from deploying this code:

1. Turn off Google tag user-provided data capabilities and automatic email, phone, name/address detection. Keep GA4 property user-provided data and Google signals off.
2. Turn off enhanced measurement for outbound links, file downloads, site search, forms, videos and history changes. Retain ordinary page views; scrolls are optional, but the minimal target is page views only.
3. Disable ads personalization for all regions. Keep optional data sharing off and advertising/export integrations unlinked unless separately approved.
4. Keep email redaction enabled. Query-key redaction is secondary protection, not a replacement for fixed URLs and disabling automatic URL-bearing events.
5. Review location/device granularity, retention and consent with the accountable owner. Do not infer compliance from GA's consent diagnostics.

On 19 October 2026, the live stream and Google tag were changed to page views only, user-provided data capabilities/detection were disabled, email redaction was retained and query-key redaction was enabled for 24 keys. Ads personalization was disallowed in all 307 regions. Published tag configuration confirmed the automatic event switches and disabled user-data capabilities. Google signals, property user-provided data and four optional sharing settings were already off. Retention remains event data 2 months/user data 14 months with reset on activity enabled; granular location/device collection remains on pending owner review. Consent diagnostics showed inactive signals; no institutional consent determination was made. Historical data was not deleted.

A local intercepted-collector test of the real Google script initially found a synthetic site-search value despite the fixed page identity. After the live automatic-event settings were changed, the fixture emitted only a sanitized page view and approved training-start event, neither containing the synthetic query/title/filename marker. This verifies those scenarios, not every third party or workflow.

## Account governance record

The current account was created by the team for RMIT work; the user confirmed that ITS did not provision it. It must not be described as an individually owned personal account or as ITS-managed without further evidence.

Accountable owner confirmed by the user on 19 October 2026: College of Vocational Education → Learning and Teaching Innovation team → Design team. Governance contact: vedt@rmit.edu.au. This records the intended business owner; it does not establish ITS approval or change Google access.

Outstanding decisions (do not invent these):

- Named operational owner/deputy and confirmation of the governance contact’s appropriate Google identity.
- ITS/security/privacy approval or decision record for this use and the external services involved.
- Named institutional administrator identities and least-privilege reporting access.
- Credential custody, MFA, recovery contacts, staff departure and access-review process.
- Data retention, notice/consent basis and incident/deletion process.

No credentials or recovery settings are changed by the repository patch. Adding administrative access requires the owner to approve the named recipients. Do not record passwords, recovery codes or tokens in this repository.

## Repeatable verification

Run `node --test tests/analytics-privacy.test.mjs` and `node --check tools-admin-worker/src/worker.js`.

These checks execute each tagged page's bootstrap with synthetic private values in the runtime URL, referrer and title, and check its queued commands and event allowlist. They test publisher replacement, opt-out, invalid paths, custom tag rejection and HVAC tracking. They do not emulate Google's full script or prove a negative for every third party.

For stronger assurance, use an isolated copy and an isolated test property or an intercepted analytics collector:

- Put unique non-sensitive canaries in document body, filename, name/email fields, title, URL query/fragment, referral URL and rendered links.
- Record request URLs and bodies for initial load, interaction, file selection, conversion, export, navigation and unload.
- Decode query strings and POST bodies, including batched events; inspect each canary and hashed user-provided fields.
- Test tools directly and in their actual SharePoint embeds. Verify the iframe source/version, referrer policy, third-party storage and consent behavior.
- Inventory requests beyond GA4, including previews, fonts, CDNs, YouTube, the SCORM service, and any embedded remote resources. A local Blob download is not a server upload.
- Verify a positive control that deliberately sends a synthetic marker, so an empty result is not mistaken for a working capture.
- Preserve code commit, live Google configuration, browser/test version, scenarios, requests, expected/observed results and unresolved cases.

A passing result supports “no sensitive test values were observed in the scenarios tested.” It does not support “sensitive information can never leave the browser.” The admin publisher intentionally uploads HTML to Cloudflare/GitHub, and remotely supplied preview URLs can leave the browser independently of GA4.

## BAU / KT analytics removal

The owner confirmed that BAU and KT are Kirsty's tools. All 18 matching metadata entries have `analytics: false`, and their HTML contains the existing explicit opt-out marker. Seventeen previously had GA4; canvas_convertor/index.html was already untagged and now carries the persistent opt-out too. The publisher strips recognized Google tracking for these owners, persisted exclusions and requests authenticated as the configured excluded uploader. This covers both uploads and restores, including replacing a tool with a changed/blank owner field. Metadata edits preserve exclusions. A fresh opt-out generated by an excluded uploader is saved to metadata so another uploader cannot inadvertently reinstate tracking on a later replacement.

`ANALYTICS_EXCLUDED_UPLOADERS` is set to Kirsty's existing allowlisted Cloudflare Access identity. Other owners continue using the reviewed analytics policy. Custom/unrecognised Google tracking is rejected for review rather than silently publishing it. The removal concerns GA4, not every external resource and not already-exported copies or historical analytics data. An owner-approved future opt-in requires an explicit policy change; there is no casual dashboard toggle to override this exclusion.
