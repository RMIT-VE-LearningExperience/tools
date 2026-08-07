# Tools Admin Worker

Password-protected Cloudflare Worker dashboard for listing and uploading standalone HTML tools to the `RMIT-VE-LearningExperience/tools` GitHub Pages repository.

## What it does

- Provides a form-based login page backed by an HTTP-only signed session cookie.
- Lists every `.html` file in the repo and shows its public GitHub Pages URL.
- Searches published tools by activity name or path.
- Copies public URLs and iframe embed codes for each activity.
- Downloads published HTML files from GitHub Pages.
- Uploads a new `.html` file through a browser form.
- Automatically replaces an existing `.html` file when the upload path already exists.
- Injects the shared Google Analytics snippet when it is missing.
- Commits the file to `main` through the GitHub API.
- Provides a Versions page for each file and can restore an older commit as a new commit.
- Links to each file's GitHub commit history for version review or rollback.
- Lets GitHub Pages publish the public URL.

## Required secrets

Set these in Cloudflare before using the dashboard:

```sh
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put GITHUB_TOKEN
```

`GITHUB_TOKEN` should be a fine-grained GitHub personal access token with contents read/write access to `RMIT-VE-LearningExperience/tools`.

## Local development

Create a local `tools-admin-worker/.dev.vars` file:

```sh
ADMIN_PASSWORD="local-password"
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
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put GITHUB_TOKEN
npm run deploy
```

The dashboard will be available at the Worker URL shown by Wrangler.
