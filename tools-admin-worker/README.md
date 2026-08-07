# Tools Admin Worker

Cloudflare Access-protected Worker dashboard for listing and uploading standalone HTML tools to the `RMIT-VE-LearningExperience/tools` GitHub Pages repository.

## What it does

- Requires Cloudflare Access and checks the authenticated Access email against an allowlist.
- Lists every `.html` file in the repo and shows its public GitHub Pages URL.
- Searches published tools by activity name or path.
- Stores editable descriptions, tags, owner, and notes in `tools-metadata.json`.
- Controls whether each activity appears in the generated public tools directory.
- Copies public URLs and Canvas-friendly iframe embeds for each activity.
- Downloads published HTML files from GitHub Pages.
- Previews and validates uploads before publishing.
- Uploads a new `.html` file through a browser form.
- Automatically replaces an existing `.html` file when the upload path already exists.
- Archives published files by moving them into `archive/`.
- Injects the shared Google Analytics snippet when it is missing.
- Commits the file to `main` through the GitHub API.
- Provides a Versions page for each file and can restore an older commit as a new commit.
- Links to each file's GitHub commit history for version review or rollback.
- Regenerates `tools-directory.html` as a public index of published tools.
- Lets GitHub Pages publish the public URL.

## Required secrets

Set these in Cloudflare before using the dashboard:

```sh
npx wrangler secret put GITHUB_TOKEN
```

`GITHUB_TOKEN` should be a fine-grained GitHub personal access token with contents read/write access to `RMIT-VE-LearningExperience/tools`.

## Cloudflare Access

The Worker trusts Cloudflare Access for these approved emails:

- `lawrence.makoona@rmit.edu.au`
- `kirsty.tod@rmit.edu.au`

When Cloudflare Access is enabled for `tools-admin-dashboard.lawrence-makoona.workers.dev`, either user can authenticate through Access and use the dashboard directly.

To configure the edge gate in Cloudflare, the API token needs `Access: Apps and Policies Write` or `Zero Trust Edit`. Without that permission, configure it in the Cloudflare dashboard:

1. Go to Workers & Pages > `tools-admin-dashboard` > Settings > Domains & Routes.
2. Enable Cloudflare Access for the `workers.dev` route.
3. Create an allow policy for `lawrence.makoona@rmit.edu.au` and `kirsty.tod@rmit.edu.au`.

## Local development

Create a local `tools-admin-worker/.dev.vars` file:

```sh
GITHUB_TOKEN="github_pat_..."
```

Then run:

```sh
npm install
npm run dev
```

## Deploy

```sh
npm install
npx wrangler whoami
npx wrangler secret put GITHUB_TOKEN
npm run deploy
```

The dashboard will be available at the Worker URL shown by Wrangler.
