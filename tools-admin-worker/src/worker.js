const TEXT_ENCODER = new TextEncoder();

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      if (url.pathname === "/health") {
        return json({ ok: true });
      }

      const authResponse = await requireBasicAuth(request, env);
      if (authResponse) return authResponse;

      if (request.method === "GET" && url.pathname === "/") {
        const tools = await listTools(env);
        return html(renderDashboard(tools, env));
      }

      if (request.method === "GET" && url.pathname === "/api/tools") {
        return json({ tools: await listTools(env) });
      }

      if (request.method === "POST" && url.pathname === "/api/upload") {
        const originResponse = requireSameOriginPost(request);
        if (originResponse) return originResponse;
        return handleUpload(request, env);
      }

      return html(renderNotFound(), { status: 404 });
    } catch (error) {
      return html(renderError(error), { status: 500 });
    }
  }
};

async function requireBasicAuth(request, env) {
  const username = env.ADMIN_USERNAME || "admin";
  const password = env.ADMIN_PASSWORD;

  if (!password) {
    return html(renderSetupRequired(), { status: 503 });
  }

  const header = request.headers.get("Authorization") || "";
  const [scheme, encoded] = header.split(" ");

  if (scheme !== "Basic" || !encoded) {
    return unauthorized();
  }

  let decoded = "";
  try {
    decoded = atob(encoded);
  } catch {
    return unauthorized();
  }

  const separator = decoded.indexOf(":");
  if (separator === -1) return unauthorized();

  const suppliedUsername = decoded.slice(0, separator);
  const suppliedPassword = decoded.slice(separator + 1);

  const usernameMatches = await timingSafeEqual(suppliedUsername, username);
  const passwordMatches = await timingSafeEqual(suppliedPassword, password);

  return usernameMatches && passwordMatches ? null : unauthorized();
}

async function timingSafeEqual(a, b) {
  const aBytes = TEXT_ENCODER.encode(a);
  const bBytes = TEXT_ENCODER.encode(b);
  const maxLength = Math.max(aBytes.length, bBytes.length);
  let mismatch = aBytes.length ^ bBytes.length;

  for (let i = 0; i < maxLength; i += 1) {
    mismatch |= (aBytes[i] || 0) ^ (bBytes[i] || 0);
  }

  return mismatch === 0;
}

function unauthorized() {
  return new Response("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Tools Admin", charset="UTF-8"',
      "Cache-Control": "no-store"
    }
  });
}

function requireSameOriginPost(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return null;

  const requestUrl = new URL(request.url);
  const originUrl = new URL(origin);

  if (originUrl.origin === requestUrl.origin) {
    return null;
  }

  return html(renderUploadResult("Cross-origin uploads are not allowed.", false), { status: 403 });
}

async function listTools(env) {
  const tree = await githubJson(env, `/git/trees/${env.GITHUB_BRANCH}?recursive=1`);
  const baseUrl = ensureTrailingSlash(env.PUBLIC_BASE_URL);

  return tree.tree
    .filter((item) => item.type === "blob" && item.path.endsWith(".html"))
    .filter((item) => !item.path.startsWith("tools-admin-worker/"))
    .map((item) => ({
      path: item.path,
      name: titleFromPath(item.path),
      url: `${baseUrl}${item.path}`,
      embedCode: iframeEmbedCode(`${baseUrl}${item.path}`, titleFromPath(item.path)),
      downloadUrl: `${baseUrl}${item.path}`,
      historyUrl: githubHistoryUrl(env, item.path),
      size: item.size || 0
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

async function handleUpload(request, env) {
  const formData = await request.formData();
  const file = formData.get("file");
  const requestedPath = String(formData.get("path") || "").trim();

  if (!file || typeof file === "string") {
    return html(renderUploadResult("No HTML file was uploaded.", false), { status: 400 });
  }

  if (!file.name.toLowerCase().endsWith(".html")) {
    return html(renderUploadResult("Only .html files can be uploaded.", false), { status: 400 });
  }

  const targetPath = normaliseTargetPath(requestedPath || file.name);
  const rawHtml = await file.text();
  const finalHtml = injectGoogleAnalytics(rawHtml, env.GA_MEASUREMENT_ID);
  const existing = await getExistingFile(env, targetPath);

  if (existing && formData.get("overwrite") !== "on") {
    return html(renderUploadResult(`"${targetPath}" already exists. Tick overwrite to replace it.`, false), { status: 409 });
  }

  const result = await putFile(env, {
    path: targetPath,
    content: finalHtml,
    sha: existing?.sha,
    message: existing
      ? `Update ${targetPath} from tools admin`
      : `Add ${targetPath} from tools admin`
  });

  return html(renderUploadResult("Upload complete.", true, {
    path: targetPath,
    url: `${ensureTrailingSlash(env.PUBLIC_BASE_URL)}${targetPath}`,
    embedCode: iframeEmbedCode(`${ensureTrailingSlash(env.PUBLIC_BASE_URL)}${targetPath}`, titleFromPath(targetPath)),
    downloadUrl: `${ensureTrailingSlash(env.PUBLIC_BASE_URL)}${targetPath}`,
    commitUrl: result.commit?.html_url,
    historyUrl: githubHistoryUrl(env, targetPath)
  }));
}

function normaliseTargetPath(value) {
  const cleaned = value
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\s+/g, "-")
    .toLowerCase();

  if (!cleaned.endsWith(".html")) {
    throw new Error("The target path must end in .html.");
  }

  if (
    cleaned.includes("..") ||
    cleaned.startsWith(".") ||
    cleaned.startsWith("tools-admin-worker/") ||
    cleaned.startsWith(".github/")
  ) {
    throw new Error("That target path is not allowed.");
  }

  if (!/^[a-z0-9][a-z0-9/_-]*\.html$/.test(cleaned)) {
    throw new Error("Use only letters, numbers, hyphens, underscores, and folders in the target path.");
  }

  return cleaned;
}

function injectGoogleAnalytics(source, measurementId) {
  if (!measurementId || source.includes(measurementId)) {
    return source;
  }

  const snippet = `\n<!-- Google Analytics -->\n<script async src="https://www.googletagmanager.com/gtag/js?id=${escapeHtml(measurementId)}"></script>\n<script>\n  window.dataLayer = window.dataLayer || [];\n  function gtag(){dataLayer.push(arguments);}\n  gtag('js', new Date());\n  gtag('config', '${escapeJsString(measurementId)}');\n</script>\n`;

  if (/<\/head>/i.test(source)) {
    return source.replace(/<\/head>/i, `${snippet}</head>`);
  }

  if (/<html[^>]*>/i.test(source)) {
    return source.replace(/<html[^>]*>/i, (match) => `${match}\n<head>${snippet}</head>`);
  }

  return `${snippet}${source}`;
}

async function getExistingFile(env, path) {
  const response = await githubFetch(env, `/contents/${encodePath(path)}?ref=${env.GITHUB_BRANCH}`);
  if (response.status === 404) return null;
  if (!response.ok) throw await githubError(response);
  return response.json();
}

async function putFile(env, { path, content, sha, message }) {
  const body = {
    message,
    branch: env.GITHUB_BRANCH,
    content: base64EncodeUtf8(content)
  };

  if (sha) body.sha = sha;

  const response = await githubFetch(env, `/contents/${encodePath(path)}`, {
    method: "PUT",
    body: JSON.stringify(body)
  });

  if (!response.ok) throw await githubError(response);
  return response.json();
}

async function githubJson(env, path) {
  const response = await githubFetch(env, path);
  if (!response.ok) throw await githubError(response);
  return response.json();
}

async function githubFetch(env, path, init = {}) {
  if (!env.GITHUB_TOKEN) {
    throw new Error("GITHUB_TOKEN secret is not configured.");
  }

  return fetch(`https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}${path}`, {
    ...init,
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "tools-admin-worker",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers || {})
    }
  });
}

async function githubError(response) {
  let detail = "";
  try {
    const body = await response.json();
    detail = body.message ? `: ${body.message}` : "";
  } catch {
    detail = `: ${await response.text()}`;
  }

  return new Error(`GitHub API request failed (${response.status})${detail}`);
}

function base64EncodeUtf8(value) {
  const bytes = TEXT_ENCODER.encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function encodePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function ensureTrailingSlash(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function titleFromPath(path) {
  return path
    .replace(/\/index\.html$/, "")
    .replace(/\.html$/, "")
    .split("/")
    .pop()
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function iframeEmbedCode(url, title) {
  return `<iframe src="${url}" title="${escapeHtml(title)}" width="100%" height="720" style="border:0;" loading="lazy"></iframe>`;
}

function githubHistoryUrl(env, path) {
  return `https://github.com/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/commits/${env.GITHUB_BRANCH}/${encodePath(path)}`;
}

function html(body, init = {}) {
  return new Response(body, {
    ...init,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      ...(init.headers || {})
    }
  });
}

function json(body, init = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...(init.headers || {})
    }
  });
}

function renderDashboard(tools, env) {
  const rows = tools.map((tool) => `
    <tr>
      <td><a href="${escapeHtml(tool.url)}" target="_blank" rel="noopener">${escapeHtml(tool.name)}</a></td>
      <td><code>${escapeHtml(tool.path)}</code></td>
      <td class="actions-cell">
        <button type="button" data-copy="${escapeHtml(tool.url)}">Copy URL</button>
        <button type="button" data-copy="${escapeHtml(tool.embedCode)}">Copy embed</button>
        <a class="button-link" href="${escapeHtml(tool.downloadUrl)}" download>Download</a>
        <button type="button" data-replace-path="${escapeHtml(tool.path)}">Replace</button>
        <a class="button-link" href="${escapeHtml(tool.historyUrl)}" target="_blank" rel="noopener">History</a>
      </td>
    </tr>
  `).join("");

  return page("Tools Admin", `
    <header>
      <div>
        <p class="eyebrow">GitHub Pages publisher</p>
        <h1>Tools Admin</h1>
      </div>
      <a class="public" href="${escapeHtml(env.PUBLIC_BASE_URL)}" target="_blank" rel="noopener">Public site</a>
    </header>

    <section class="panel upload">
      <h2>Upload or replace activity</h2>
      <form action="/api/upload" method="post" enctype="multipart/form-data">
        <label>
          HTML file
          <input name="file" type="file" accept=".html,text/html" required>
        </label>
        <label>
          Public path
          <input id="path" name="path" type="text" placeholder="example-activity.html" pattern="[A-Za-z0-9/_\\-. ]+\\.html">
        </label>
        <label class="check">
          <input id="overwrite" name="overwrite" type="checkbox">
          Replace existing version
        </label>
        <button type="submit">Upload and publish</button>
      </form>
      <p class="hint">Replacing a file creates a new Git commit for that path, so previous versions remain available from the History link.</p>
    </section>

    <section class="panel">
      <div class="section-head">
        <h2>Published HTML activities</h2>
        <span>${tools.length} files</span>
      </div>
      <table>
        <thead>
          <tr><th>Name</th><th>Path</th><th>Actions</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>
    <script>
      document.addEventListener("click", async (event) => {
        const button = event.target.closest("[data-copy]");
        if (!button) return;
        await navigator.clipboard.writeText(button.dataset.copy);
        const previous = button.textContent;
        button.textContent = "Copied";
        setTimeout(() => button.textContent = previous, 1400);
      });

      document.addEventListener("click", (event) => {
        const button = event.target.closest("[data-replace-path]");
        if (!button) return;

        document.querySelector("#path").value = button.dataset.replacePath;
        document.querySelector("#overwrite").checked = true;
        document.querySelector(".upload").scrollIntoView({ behavior: "smooth", block: "start" });
      });
    </script>
  `);
}

function renderUploadResult(message, ok, detail = null) {
  return page(ok ? "Upload complete" : "Upload failed", `
    <section class="panel result">
      <h1>${escapeHtml(message)}</h1>
      ${detail ? `
        <p><a href="${escapeHtml(detail.url)}" target="_blank" rel="noopener">${escapeHtml(detail.url)}</a></p>
        <p><code>${escapeHtml(detail.path)}</code></p>
        <div class="result-actions">
          <button type="button" data-copy="${escapeHtml(detail.url)}">Copy URL</button>
          <button type="button" data-copy="${escapeHtml(detail.embedCode)}">Copy embed</button>
          <a class="button-link" href="${escapeHtml(detail.downloadUrl)}" download>Download</a>
          ${detail.commitUrl ? `<a class="button-link" href="${escapeHtml(detail.commitUrl)}" target="_blank" rel="noopener">View commit</a>` : ""}
          <a class="button-link" href="${escapeHtml(detail.historyUrl)}" target="_blank" rel="noopener">Version history</a>
        </div>
        <script>
          document.addEventListener("click", async (event) => {
            const button = event.target.closest("[data-copy]");
            if (!button) return;
            await navigator.clipboard.writeText(button.dataset.copy);
            const previous = button.textContent;
            button.textContent = "Copied";
            setTimeout(() => button.textContent = previous, 1400);
          });
        </script>
      ` : ""}
      <p class="actions"><a href="/">Back to dashboard</a></p>
    </section>
  `);
}

function renderSetupRequired() {
  return page("Setup required", `
    <section class="panel result">
      <h1>Setup required</h1>
      <p>Set the <code>ADMIN_PASSWORD</code> and <code>GITHUB_TOKEN</code> Worker secrets before using the dashboard.</p>
    </section>
  `);
}

function renderNotFound() {
  return page("Not found", `
    <section class="panel result">
      <h1>Not found</h1>
      <p><a href="/">Back to dashboard</a></p>
    </section>
  `);
}

function renderError(error) {
  return page("Error", `
    <section class="panel result">
      <h1>Something went wrong</h1>
      <pre>${escapeHtml(error.stack || error.message || String(error))}</pre>
      <p><a href="/">Back to dashboard</a></p>
    </section>
  `);
}

function page(title, body) {
  return `<!doctype html>
<html lang="en-AU">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root{--navy:#000054;--red:#e61e2a;--yellow:#fac800;--bg:#f2f2f2;--line:#d8d9dd;--ink:#17172f;--muted:#606372}
    *{box-sizing:border-box}
    body{margin:0;background:var(--bg);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;line-height:1.45}
    header{background:var(--navy);color:#fff;border-bottom:4px solid var(--red);padding:22px clamp(16px,4vw,36px);display:flex;align-items:center;justify-content:space-between;gap:18px}
    h1,h2,p{margin:0}
    h1{font-size:1.45rem}
    h2{font-size:1rem}
    .eyebrow{font-size:.74rem;text-transform:uppercase;letter-spacing:.08em;opacity:.72;margin-bottom:4px}
    .public, header a{color:#fff}
    .panel{max-width:1120px;margin:22px auto;background:#fff;border:1px solid var(--line);padding:20px;border-radius:8px;box-shadow:0 1px 2px rgba(0,0,20,.06)}
    .upload form{display:grid;grid-template-columns:minmax(220px,1fr) minmax(220px,1fr) auto auto;gap:14px;align-items:end;margin-top:16px}
    label{display:flex;flex-direction:column;gap:6px;font-size:.82rem;font-weight:700;color:var(--muted)}
    input[type=file],input[type=text]{font:inherit;border:1px solid var(--line);border-radius:6px;padding:9px;background:#fff;color:var(--ink);min-height:40px}
    .check{flex-direction:row;align-items:center;color:var(--ink);padding-bottom:9px}
    button,.actions a,.button-link{font:inherit;font-weight:700;background:var(--navy);color:#fff;border:1px solid var(--navy);border-radius:6px;padding:9px 12px;text-decoration:none;cursor:pointer;min-height:40px;display:inline-flex;align-items:center}
    button:hover,.actions a:hover,.button-link:hover{background:#101076}
    .hint{color:var(--muted);font-size:.86rem;margin-top:12px}
    .section-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}
    .section-head span{color:var(--muted);font-size:.85rem}
    table{width:100%;border-collapse:collapse;background:#fff}
    th,td{text-align:left;border-top:1px solid var(--line);padding:10px;vertical-align:middle}
    th{font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
    td code{font-size:.82rem;word-break:break-all}
    td a{color:var(--navy);font-weight:700}
    td button,td .button-link{background:#fff;color:var(--navy);min-height:32px;padding:6px 9px}
    td button:hover,td .button-link:hover{background:#f4f5ff}
    .actions-cell,.result-actions{display:flex;flex-wrap:wrap;gap:7px}
    .result-actions{margin-top:16px}
    .result{margin-top:44px}
    .result h1{margin-bottom:12px}
    .result p{margin-top:10px}
    pre{white-space:pre-wrap;background:#f6f6f6;border:1px solid var(--line);padding:12px;border-radius:6px;overflow:auto}
    @media(max-width:760px){header{align-items:flex-start;flex-direction:column}.upload form{grid-template-columns:1fr}table,thead,tbody,tr,th,td{display:block}thead{display:none}td{padding:9px 0}.panel{margin:14px;padding:16px}.actions-cell{margin-top:6px}}
  </style>
</head>
<body>
  ${body}
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeJsString(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}
