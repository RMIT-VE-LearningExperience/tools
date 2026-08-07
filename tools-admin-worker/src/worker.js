const TEXT_ENCODER = new TextEncoder();
const SESSION_COOKIE = "tools_admin_session";
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      if (url.pathname === "/health") {
        return json({ ok: true });
      }

      if (request.method === "GET" && url.pathname === "/login") {
        const next = safeNextPath(url.searchParams.get("next") || "/");
        if (await isAuthenticated(request, env)) {
          return redirect(next);
        }

        return html(renderLogin("", next));
      }

      if (request.method === "POST" && url.pathname === "/login") {
        const originResponse = requireSameOriginPost(request);
        if (originResponse) return originResponse;
        return await handleLogin(request, env);
      }

      if (request.method === "POST" && url.pathname === "/logout") {
        const originResponse = requireSameOriginPost(request);
        if (originResponse) return originResponse;
        return redirect("/", {
          "Set-Cookie": `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`
        });
      }

      const authResponse = await requireSession(request, env);
      if (authResponse) return authResponse;

      if (request.method === "GET" && url.pathname === "/") {
        const tools = await listTools(env);
        return html(renderDashboard(tools, env));
      }

      if (request.method === "GET" && url.pathname === "/api/tools") {
        return json({ tools: await listTools(env) });
      }

      if (request.method === "GET" && url.pathname === "/download") {
        return await handleDownload(url, env);
      }

      if (request.method === "GET" && url.pathname === "/versions") {
        return await handleVersions(url, env);
      }

      if (request.method === "POST" && url.pathname === "/api/upload") {
        const originResponse = requireSameOriginPost(request);
        if (originResponse) return originResponse;
        return await handleUpload(request, env);
      }

      if (request.method === "POST" && url.pathname === "/api/restore") {
        const originResponse = requireSameOriginPost(request);
        if (originResponse) return originResponse;
        return await handleRestore(request, env);
      }

      return html(renderNotFound(), { status: 404 });
    } catch (error) {
      console.error("Worker request failed", {
        method: request.method,
        url: request.url,
        message: error?.message || String(error),
        stack: error?.stack || ""
      });
      return html(renderError(error), { status: 500 });
    }
  }
};

async function handleLogin(request, env) {
  const password = env.ADMIN_PASSWORD;

  if (!password) {
    return html(renderSetupRequired(), { status: 503 });
  }

  const formData = await request.formData();
  const suppliedUsername = String(formData.get("username") || "");
  const suppliedPassword = String(formData.get("password") || "");
  const next = safeNextPath(String(formData.get("next") || "/"));

  const authenticatedUsername = await validateCredentials(suppliedUsername, suppliedPassword, env);

  if (!authenticatedUsername) {
    return html(renderLogin("The username or password is incorrect.", next), { status: 401 });
  }

  return redirect(next, {
    "Set-Cookie": await createSessionCookie(authenticatedUsername, env)
  });
}

async function requireSession(request, env) {
  if (!env.ADMIN_PASSWORD) {
    return html(renderSetupRequired(), { status: 503 });
  }

  if (await isAuthenticated(request, env)) {
    return null;
  }

  const url = new URL(request.url);
  const next = encodeURIComponent(`${url.pathname}${url.search}`);
  return redirect(`/login?next=${next}`, {}, 303);
}

async function isAuthenticated(request, env) {
  if (!env.ADMIN_PASSWORD) return false;

  const cookie = getCookie(request, SESSION_COOKIE);
  if (!cookie) return false;

  const [payload, signature] = cookie.split(".");
  if (!payload || !signature) return false;

  const expectedSignature = await hmac(payload, env.ADMIN_PASSWORD);
  if (!await timingSafeEqual(signature, expectedSignature)) return false;

  let session;
  try {
    session = JSON.parse(base64UrlDecode(payload));
  } catch {
    return false;
  }

  return isAllowedSessionUser(session?.username, env) && Number(session.exp) > Math.floor(Date.now() / 1000);
}

async function validateCredentials(username, password, env) {
  const adminUsername = env.ADMIN_USERNAME || "admin";
  const adminUsernameMatches = await timingSafeEqual(username, adminUsername);
  const adminPasswordMatches = await timingSafeEqual(password, env.ADMIN_PASSWORD || "");

  if (adminUsernameMatches && adminPasswordMatches) {
    return adminUsername;
  }

  if (env.TEST_USERNAME && env.TEST_PASSWORD) {
    const testUsernameMatches = await timingSafeEqual(username, env.TEST_USERNAME);
    const testPasswordMatches = await timingSafeEqual(password, env.TEST_PASSWORD);

    if (testUsernameMatches && testPasswordMatches) {
      return env.TEST_USERNAME;
    }
  }

  return "";
}

function isAllowedSessionUser(username, env) {
  if (!username) return false;
  if (username === (env.ADMIN_USERNAME || "admin")) return true;
  return Boolean(env.TEST_USERNAME && env.TEST_PASSWORD && username === env.TEST_USERNAME);
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

function requireSameOriginPost(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return null;

  const requestUrl = new URL(request.url);
  const originUrl = new URL(origin);

  if (originUrl.origin === requestUrl.origin) {
    return null;
  }

  return html(renderUploadResult("Cross-origin submissions are not allowed.", false), { status: 403 });
}

async function createSessionCookie(username, env) {
  const payload = base64UrlEncode(JSON.stringify({
    username,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
  }));
  const signature = await hmac(payload, env.ADMIN_PASSWORD);

  return `${SESSION_COOKIE}=${payload}.${signature}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
}

async function hmac(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    TEXT_ENCODER.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, TEXT_ENCODER.encode(value));
  return base64UrlEncodeBytes(new Uint8Array(signature));
}

function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  const prefix = `${name}=`;

  return cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length) || "";
}

function safeNextPath(value) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }

  return value;
}

function redirect(location, headers = {}, status = 303) {
  return new Response(null, {
    status,
    headers: {
      "Location": location,
      "Cache-Control": "no-store",
      ...headers
    }
  });
}

function base64UrlEncode(value) {
  return base64UrlEncodeBytes(TEXT_ENCODER.encode(value));
}

function base64UrlEncodeBytes(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function base64UrlDecode(value) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new TextDecoder().decode(bytes);
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
      description: descriptionFromPath(item.path),
      url: `${baseUrl}${item.path}`,
      embedCode: iframeEmbedCode(`${baseUrl}${item.path}`, titleFromPath(item.path)),
      downloadUrl: downloadUrl(item.path),
      historyUrl: githubHistoryUrl(env, item.path),
      versionsUrl: versionsUrl(item.path),
      size: item.size || 0
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

async function handleUpload(request, env) {
  const contentType = request.headers.get("Content-Type") || "";

  if (!contentType.includes("application/json")) {
    return html(renderUploadResult("Upload request must use the dashboard form. Refresh and try again.", false), { status: 415 });
  }

  const payload = JSON.parse(await request.text());
  const filename = String(payload.filename || "");
  const requestedPath = String(payload.path || "").trim();
  const rawHtml = String(payload.content || "");

  if (!rawHtml) {
    return html(renderUploadResult("No HTML file was uploaded.", false), { status: 400 });
  }

  if (!filename.toLowerCase().endsWith(".html") && !requestedPath.toLowerCase().endsWith(".html")) {
    return html(renderUploadResult("Only .html files can be uploaded.", false), { status: 400 });
  }

  if (TEXT_ENCODER.encode(rawHtml).byteLength > MAX_UPLOAD_BYTES) {
    return html(renderUploadResult(`Upload is too large. Keep HTML files under ${formatBytes(MAX_UPLOAD_BYTES)}.`, false), { status: 413 });
  }

  const targetPath = normaliseTargetPath(requestedPath || filename);
  const finalHtml = injectGoogleAnalytics(rawHtml, env.GA_MEASUREMENT_ID);
  const existing = await getExistingFile(env, targetPath);

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
    downloadUrl: downloadUrl(targetPath),
    commitUrl: result.commit?.html_url,
    historyUrl: githubHistoryUrl(env, targetPath),
    versionsUrl: versionsUrl(targetPath),
    action: existing ? "Replaced existing file" : "Added new file"
  }));
}

async function handleVersions(url, env) {
  const path = validateDownloadPath(url.searchParams.get("path") || "");
  const commits = await listFileCommits(env, path);

  return html(renderVersions(path, commits, env));
}

async function handleRestore(request, env) {
  const formData = await request.formData();
  const path = validateDownloadPath(String(formData.get("path") || ""));
  const commitSha = validateSha(String(formData.get("sha") || ""));
  const version = await getFileAtRef(env, path, commitSha);
  const existing = await getExistingFile(env, path);

  if (!existing) {
    return html(renderUploadResult(`"${path}" does not exist on ${env.GITHUB_BRANCH}.`, false), { status: 404 });
  }

  const result = await putFile(env, {
    path,
    content: version,
    sha: existing.sha,
    message: `Restore ${path} to ${commitSha.slice(0, 7)} from tools admin`
  });

  return html(renderUploadResult("Version restored.", true, {
    path,
    url: `${ensureTrailingSlash(env.PUBLIC_BASE_URL)}${path}`,
    embedCode: iframeEmbedCode(`${ensureTrailingSlash(env.PUBLIC_BASE_URL)}${path}`, titleFromPath(path)),
    downloadUrl: downloadUrl(path),
    commitUrl: result.commit?.html_url,
    historyUrl: githubHistoryUrl(env, path),
    versionsUrl: versionsUrl(path),
    action: `Restored ${commitSha.slice(0, 7)}`
  }));
}

async function handleDownload(url, env) {
  const path = validateDownloadPath(url.searchParams.get("path") || "");
  const sourceUrl = `${ensureTrailingSlash(env.PUBLIC_BASE_URL)}${path}`;
  const response = await fetch(sourceUrl, {
    headers: {
      "Accept": "text/html,*/*"
    }
  });

  if (!response.ok) {
    return html(renderUploadResult(`Could not download "${path}".`, false), { status: response.status });
  }

  const file = await response.arrayBuffer();

  return new Response(file, {
    status: 200,
    headers: {
      "Content-Type": response.headers.get("Content-Type") || "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="${downloadFileName(path)}"`,
      "Content-Length": String(file.byteLength),
      "Cache-Control": "no-store"
    }
  });
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

function validateDownloadPath(value) {
  const cleaned = value
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");

  if (
    !cleaned.endsWith(".html") ||
    cleaned.includes("..") ||
    cleaned.startsWith(".") ||
    cleaned.startsWith("tools-admin-worker/") ||
    cleaned.startsWith(".github/") ||
    !/^[A-Za-z0-9][A-Za-z0-9/_-]*\.html$/.test(cleaned)
  ) {
    throw new Error("That download path is not allowed.");
  }

  return cleaned;
}

function validateSha(value) {
  const cleaned = value.trim();

  if (!/^[a-f0-9]{40}$/i.test(cleaned)) {
    throw new Error("That version identifier is not valid.");
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

async function listFileCommits(env, path) {
  const commits = await githubJson(env, `/commits?path=${encodeURIComponent(path)}&sha=${encodeURIComponent(env.GITHUB_BRANCH)}&per_page=30`);

  return commits.map((commit) => ({
    sha: commit.sha,
    shortSha: commit.sha.slice(0, 7),
    message: commit.commit?.message?.split("\n")[0] || "No commit message",
    date: commit.commit?.committer?.date || commit.commit?.author?.date || "",
    author: commit.commit?.author?.name || commit.author?.login || "Unknown",
    url: commit.html_url
  }));
}

async function getFileAtRef(env, path, ref) {
  const file = await githubJson(env, `/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`);

  if (file.encoding !== "base64" || !file.content) {
    throw new Error(`Could not read ${path} at ${ref}.`);
  }

  return base64DecodeUtf8(file.content);
}

async function putFile(env, { path, content, sha, message }) {
  const body = {
    message,
    branch: env.GITHUB_BRANCH,
    content: base64EncodeUtf8(content)
  };

  if (sha) body.sha = sha;

  return githubJson(env, `/contents/${encodePath(path)}`, {
    method: "PUT",
    body: JSON.stringify(body)
  });
}

async function githubJson(env, path, init = {}) {
  const response = await githubFetch(env, path, init);
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

function formatBytes(bytes) {
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}

function base64EncodeUtf8(value) {
  const bytes = TEXT_ENCODER.encode(value);
  const chunkSize = 24 * 1024;
  let encoded = "";

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    let binary = "";

    for (const byte of chunk) {
      binary += String.fromCharCode(byte);
    }

    encoded += btoa(binary);
  }

  return encoded;
}

function base64DecodeUtf8(value) {
  const binary = atob(value.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new TextDecoder().decode(bytes);
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

function descriptionFromPath(path) {
  const title = titleFromPath(path);
  const lower = `${path} ${title}`.toLowerCase();

  if (lower.includes("converter") || lower.includes("convertor")) {
    return `Converts source content into ${title.replace(/\bConverter\b|\bConvertor\b/g, "").trim() || "a ready-to-use format"}.`;
  }

  if (lower.includes("generator")) {
    return `Generates ${title.replace(/\bGenerator\b/g, "").trim() || "structured activity content"}.`;
  }

  if (lower.includes("simulation")) {
    return `Interactive simulation for ${title.replace(/\bSimulation\b/g, "").trim() || "practice and decision-making"}.`;
  }

  if (lower.includes("matrix")) {
    return `Decision-support matrix for ${title.replace(/\bMatrix\b/g, "").trim() || "comparing options"}.`;
  }

  if (lower.includes("extractor")) {
    return `Extracts ${title.replace(/\bExtractor\b/g, "").trim() || "content"} from uploaded material.`;
  }

  if (lower.includes("recommendation") || lower.includes("table")) {
    return `Reference page for ${title.replace(/\bTable\b/g, "").trim() || "tool guidance"}.`;
  }

  if (lower.includes("template")) {
    return `Reusable template for ${title.replace(/\bTemplate\b/g, "").trim() || "structured work"}.`;
  }

  return `Standalone HTML activity for ${title}.`;
}

function iframeEmbedCode(url, title) {
  return `<iframe src="${url}" title="${escapeHtml(title)}" width="100%" height="720" style="border:0;" loading="lazy"></iframe>`;
}

function downloadUrl(path) {
  return `/download?path=${encodeURIComponent(path)}`;
}

function versionsUrl(path) {
  return `/versions?path=${encodeURIComponent(path)}`;
}

function downloadFileName(path) {
  return path.split("/").pop().replace(/[^A-Za-z0-9._-]/g, "-") || "activity.html";
}

function rawFileUrl(env, path, ref) {
  return `https://raw.githubusercontent.com/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/${encodeURIComponent(ref)}/${encodePath(path)}`;
}

function githubHistoryUrl(env, path) {
  return `https://github.com/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/commits/${env.GITHUB_BRANCH}/${encodePath(path)}`;
}

function formatDate(value) {
  if (!value) return "Unknown date";

  return new Date(value).toLocaleString("en-AU", {
    dateStyle: "medium",
    timeStyle: "short"
  });
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
  const existingPaths = tools.map((tool) => tool.path);
  const rows = tools.map((tool) => `
    <tr data-search="${escapeHtml(`${tool.name} ${tool.path}`.toLowerCase())}">
      <td>
        <a href="${escapeHtml(tool.url)}" target="_blank" rel="noopener">${escapeHtml(tool.name)}</a>
        <div class="muted">${escapeHtml(tool.description)}</div>
      </td>
      <td><code>${escapeHtml(tool.path)}</code></td>
      <td class="actions-cell">
        <details class="action-menu">
          <summary aria-label="Actions for ${escapeHtml(tool.name)}">...</summary>
          <div class="menu-panel">
            <button type="button" data-copy="${escapeHtml(tool.url)}">Copy URL</button>
            <button type="button" data-copy="${escapeHtml(tool.embedCode)}">Copy embed</button>
            <a class="button-link" href="${escapeHtml(tool.downloadUrl)}" download>Download</a>
            <button type="button" data-replace-path="${escapeHtml(tool.path)}">Replace</button>
            <a class="button-link" href="${escapeHtml(tool.versionsUrl)}">Versions</a>
            <a class="button-link" href="${escapeHtml(tool.historyUrl)}" target="_blank" rel="noopener">History</a>
          </div>
        </details>
      </td>
    </tr>
  `).join("");

  return page("Tools Admin", `
    <header>
      <div>
        <p class="eyebrow">GitHub Pages publisher</p>
        <h1>Tools Admin</h1>
      </div>
      <div class="header-actions">
        <a class="public" href="${escapeHtml(env.PUBLIC_BASE_URL)}" target="_blank" rel="noopener">Public site</a>
        <form action="/logout" method="post">
          <button type="submit">Log out</button>
        </form>
      </div>
    </header>

    <section class="panel upload">
      <h2>Upload or replace activity</h2>
      <form action="/api/upload" method="post" enctype="multipart/form-data">
        <label>
          HTML file
          <input id="file" name="file" type="file" accept=".html,text/html" required>
        </label>
        <label>
          Public path
          <input id="path" name="path" type="text" placeholder="example-activity.html" pattern="[A-Za-z0-9/_\\-. ]+\\.html">
        </label>
        <button type="submit">Upload and publish</button>
      </form>
      <p class="hint" id="upload-mode">Choose a file and path. Existing paths are replaced automatically.</p>
    </section>

    <section class="panel">
      <div class="section-head">
        <h2>Published HTML activities</h2>
        <label class="search">
          Search
          <input id="search" type="search" placeholder="Search name or path">
        </label>
        <span><span id="visible-count">${tools.length}</span> of ${tools.length} files</span>
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

      document.addEventListener("toggle", (event) => {
        const menu = event.target.closest(".action-menu");
        if (!menu || !menu.open) return;

        document.querySelectorAll(".action-menu[open]").forEach((openMenu) => {
          if (openMenu !== menu) openMenu.open = false;
        });
      }, true);

      document.addEventListener("click", (event) => {
        const button = event.target.closest("[data-replace-path]");
        if (!button) return;

        document.querySelector("#path").value = button.dataset.replacePath;
        updateUploadMode();
        document.querySelector(".upload").scrollIntoView({ behavior: "smooth", block: "start" });
      });

      document.querySelector("#search").addEventListener("input", (event) => {
        const query = event.target.value.trim().toLowerCase();
        const rows = [...document.querySelectorAll("tbody tr")];
        let visible = 0;

        for (const row of rows) {
          const match = row.dataset.search.includes(query);
          row.hidden = !match;
          if (match) visible += 1;
        }

        document.querySelector("#visible-count").textContent = String(visible);
      });

      const existingPaths = new Set(${JSON.stringify(existingPaths)});
      const pathInput = document.querySelector("#path");
      const fileInput = document.querySelector("#file");
      const uploadMode = document.querySelector("#upload-mode");

      function normalisePath(value) {
        return value.replace(/\\\\/g, "/").replace(/^\\/+/, "").trim().replace(/\\s+/g, "-").toLowerCase();
      }

      function updateUploadMode() {
        const candidate = normalisePath(pathInput.value || (fileInput.files[0]?.name || ""));
        if (!candidate) {
          uploadMode.textContent = "Choose a file and path. Existing paths are replaced automatically.";
          return;
        }

        uploadMode.textContent = existingPaths.has(candidate)
          ? "This upload will replace the existing file at " + candidate + "."
          : "This upload will create a new file at " + candidate + ".";
      }

      fileInput.addEventListener("change", () => {
        if (!pathInput.value && fileInput.files[0]) {
          pathInput.value = fileInput.files[0].name;
        }
        updateUploadMode();
      });

      pathInput.addEventListener("input", updateUploadMode);

      document.querySelector(".upload form").addEventListener("submit", async (event) => {
        event.preventDefault();

        const form = event.currentTarget;
        const file = document.querySelector("#file").files[0];
        const button = form.querySelector("button[type=submit]");

        if (!file) return;

        button.disabled = true;
        button.textContent = "Uploading...";

        const response = await fetch(form.action, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            filename: file.name,
            path: document.querySelector("#path").value,
            content: await file.text()
          })
        });
        const nextPage = await response.text();

        document.open();
        document.write(nextPage);
        document.close();
      });
    </script>
  `);
}

function renderUploadResult(message, ok, detail = null) {
  return page(ok ? "Upload complete" : "Upload failed", `
    <section class="panel result">
      <h1>${escapeHtml(message)}</h1>
      ${detail ? `
        ${detail.action ? `<p><strong>${escapeHtml(detail.action)}</strong></p>` : ""}
        <p><a href="${escapeHtml(detail.url)}" target="_blank" rel="noopener">${escapeHtml(detail.url)}</a></p>
        <p><code>${escapeHtml(detail.path)}</code></p>
        <div class="result-actions">
          <button type="button" data-copy="${escapeHtml(detail.url)}">Copy URL</button>
          <button type="button" data-copy="${escapeHtml(detail.embedCode)}">Copy embed</button>
          <a class="button-link" href="${escapeHtml(detail.downloadUrl)}" download>Download</a>
          ${detail.commitUrl ? `<a class="button-link" href="${escapeHtml(detail.commitUrl)}" target="_blank" rel="noopener">View commit</a>` : ""}
          ${detail.versionsUrl ? `<a class="button-link" href="${escapeHtml(detail.versionsUrl)}">Versions</a>` : ""}
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

function renderVersions(path, commits, env) {
  const rows = commits.map((commit, index) => `
    <tr>
      <td>
        <strong>${index === 0 ? "Current" : escapeHtml(commit.shortSha)}</strong>
        <div class="muted">${escapeHtml(formatDate(commit.date))}</div>
      </td>
      <td>
        ${escapeHtml(commit.message)}
        <div class="muted">${escapeHtml(commit.author)}</div>
      </td>
      <td class="actions-cell">
        <a class="button-link" href="${escapeHtml(rawFileUrl(env, path, commit.sha))}" target="_blank" rel="noopener">View</a>
        <a class="button-link" href="${escapeHtml(commit.url)}" target="_blank" rel="noopener">Commit</a>
        ${index === 0 ? "" : `
          <form action="/api/restore" method="post" data-confirm-restore="${escapeHtml(commit.shortSha)}">
            <input type="hidden" name="path" value="${escapeHtml(path)}">
            <input type="hidden" name="sha" value="${escapeHtml(commit.sha)}">
            <button type="submit">Restore</button>
          </form>
        `}
      </td>
    </tr>
  `).join("");

  return page(`${titleFromPath(path)} Versions`, `
    <header>
      <div>
        <p class="eyebrow">Version history</p>
        <h1>${escapeHtml(titleFromPath(path))}</h1>
      </div>
      <div class="header-actions">
        <a class="public" href="/">Dashboard</a>
        <a class="public" href="${escapeHtml(`${ensureTrailingSlash(env.PUBLIC_BASE_URL)}${path}`)}" target="_blank" rel="noopener">Public page</a>
      </div>
    </header>
    <section class="panel">
      <div class="section-head">
        <h2><code>${escapeHtml(path)}</code></h2>
        <span>${commits.length} versions</span>
      </div>
      <table>
        <thead>
          <tr><th>Version</th><th>Change</th><th>Actions</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="hint">Restoring a version creates a new commit on <code>${escapeHtml(env.GITHUB_BRANCH)}</code>; it does not delete newer history.</p>
    </section>
    <script>
      document.addEventListener("submit", (event) => {
        const form = event.target.closest("[data-confirm-restore]");
        if (!form) return;
        const version = form.dataset.confirmRestore;
        if (!confirm("Restore version " + version + " for ${escapeJsString(path)}?")) {
          event.preventDefault();
        }
      });
    </script>
  `);
}

function renderLogin(error = "", next = "/") {
  return page("Tools Admin Login", `
    <main class="login-wrap">
      <section class="login-panel">
        <p class="eyebrow">GitHub Pages publisher</p>
        <h1>Tools Admin</h1>
        ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
        <form action="/login" method="post">
          <input type="hidden" name="next" value="${escapeHtml(next)}">
          <label>
            Username
            <input name="username" type="text" autocomplete="username" required autofocus>
          </label>
          <label>
            Password
            <input name="password" type="password" autocomplete="current-password" required>
          </label>
          <button type="submit">Log in</button>
        </form>
      </section>
    </main>
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
    .header-actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
    .header-actions form{margin:0}
    .header-actions button{background:#fff;color:var(--navy);border-color:#fff;min-height:34px;padding:6px 10px}
    .panel{max-width:1120px;margin:22px auto;background:#fff;border:1px solid var(--line);padding:20px;border-radius:8px;box-shadow:0 1px 2px rgba(0,0,20,.06)}
    .upload form{display:grid;grid-template-columns:minmax(220px,1fr) minmax(220px,1fr) auto auto;gap:14px;align-items:end;margin-top:16px}
    label{display:flex;flex-direction:column;gap:6px;font-size:.82rem;font-weight:700;color:var(--muted)}
    input[type=file],input[type=text],input[type=password],input[type=search]{font:inherit;border:1px solid var(--line);border-radius:6px;padding:9px;background:#fff;color:var(--ink);min-height:40px}
    .check{flex-direction:row;align-items:center;color:var(--ink);padding-bottom:9px}
    button,.actions a,.button-link{font:inherit;font-weight:700;background:var(--navy);color:#fff;border:1px solid var(--navy);border-radius:6px;padding:9px 12px;text-decoration:none;cursor:pointer;min-height:40px;display:inline-flex;align-items:center}
    button:hover,.actions a:hover,.button-link:hover{background:#101076}
    .hint{color:var(--muted);font-size:.86rem;margin-top:12px}
    .section-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}
    .section-head span{color:var(--muted);font-size:.85rem}
    .search{min-width:260px;max-width:360px;flex:1}
    table{width:100%;border-collapse:collapse;background:#fff}
    th,td{text-align:left;border-top:1px solid var(--line);padding:10px;vertical-align:middle}
    th{font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
    td code{font-size:.82rem;word-break:break-all}
    td a{color:var(--navy);font-weight:700}
    td button,td .button-link{background:#fff;color:var(--navy);min-height:32px;padding:6px 9px}
    td button:hover,td .button-link:hover{background:#f4f5ff}
    .actions-cell,.result-actions{display:flex;flex-wrap:wrap;gap:7px}
    .actions-cell{position:relative;justify-content:flex-end}
    .actions-cell form{margin:0}
    .action-menu{position:relative}
    .action-menu summary{list-style:none;width:36px;height:32px;border:1px solid var(--line);border-radius:6px;display:grid;place-items:center;color:var(--navy);font-weight:800;cursor:pointer;background:#fff}
    .action-menu summary::-webkit-details-marker{display:none}
    .action-menu summary:hover{background:#f4f5ff}
    .menu-panel{position:absolute;right:0;top:38px;z-index:10;min-width:160px;background:#fff;border:1px solid var(--line);border-radius:8px;box-shadow:0 10px 28px rgba(0,0,40,.14);padding:6px;display:grid;gap:4px}
    .menu-panel button,.menu-panel .button-link{width:100%;justify-content:flex-start;border-color:transparent;background:#fff;color:var(--ink);min-height:34px}
    .menu-panel button:hover,.menu-panel .button-link:hover{background:#f4f5ff;color:var(--navy)}
    .result-actions{margin-top:16px}
    .muted{color:var(--muted);font-size:.82rem;margin-top:3px}
    .result{margin-top:44px}
    .result h1{margin-bottom:12px}
    .result p{margin-top:10px}
    .login-wrap{min-height:100vh;display:grid;place-items:center;padding:20px}
    .login-panel{width:min(100%,390px);background:#fff;border:1px solid var(--line);border-radius:8px;padding:24px;box-shadow:0 1px 2px rgba(0,0,20,.06),0 12px 34px rgba(0,0,40,.12)}
    .login-panel h1{margin-bottom:18px}
    .login-panel form{display:grid;gap:14px}
    .login-panel button{justify-content:center}
    .error{background:#fff1f1;border:1px solid #f0b7bd;color:#8c121b;border-radius:6px;padding:9px 10px;margin-bottom:14px}
    pre{white-space:pre-wrap;background:#f6f6f6;border:1px solid var(--line);padding:12px;border-radius:6px;overflow:auto}
    @media(max-width:760px){header{align-items:flex-start;flex-direction:column}.upload form{grid-template-columns:1fr}.section-head{align-items:stretch;flex-direction:column}.search{min-width:0;max-width:none}table,thead,tbody,tr,th,td{display:block}thead{display:none}td{padding:9px 0}.panel{margin:14px;padding:16px}.actions-cell{margin-top:6px}}
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
