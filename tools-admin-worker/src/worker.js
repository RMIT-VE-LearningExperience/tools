const TEXT_ENCODER = new TextEncoder();
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const METADATA_PATH = "tools-metadata.json";
const PUBLIC_INDEX_PATH = "tools-directory.html";
const ARCHIVE_PREFIX = "archive/";

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      if (url.pathname === "/health") {
        return json({ ok: true });
      }

      if (url.pathname === "/login") {
        return redirect(safeNextPath(url.searchParams.get("next") || "/"));
      }

      if (url.pathname === "/logout") {
        return redirect("/cdn-cgi/access/logout");
      }

      const authResponse = requireAccess(request, env);
      if (authResponse) return authResponse;

      if (request.method === "GET" && url.pathname === "/") {
        const tools = await listTools(env);
        return html(renderDashboard(tools, env, request));
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

      if (request.method === "GET" && url.pathname === "/metadata") {
        return await handleMetadata(url, env);
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

      if (request.method === "POST" && url.pathname === "/api/metadata") {
        const originResponse = requireSameOriginPost(request);
        if (originResponse) return originResponse;
        return await handleMetadataSave(request, env);
      }

      if (request.method === "POST" && url.pathname === "/api/archive") {
        const originResponse = requireSameOriginPost(request);
        if (originResponse) return originResponse;
        return await handleArchive(request, env);
      }

      if (request.method === "POST" && url.pathname === "/api/generate-index") {
        const originResponse = requireSameOriginPost(request);
        if (originResponse) return originResponse;
        await regeneratePublicIndex(env);
        return html(renderUploadResult("Public index regenerated.", true, {
          path: PUBLIC_INDEX_PATH,
          url: `${ensureTrailingSlash(env.PUBLIC_BASE_URL)}${PUBLIC_INDEX_PATH}`,
          embedCode: iframeEmbedCode(`${ensureTrailingSlash(env.PUBLIC_BASE_URL)}${PUBLIC_INDEX_PATH}`, "Tools Directory"),
          downloadUrl: downloadUrl(PUBLIC_INDEX_PATH),
          historyUrl: githubHistoryUrl(env, PUBLIC_INDEX_PATH),
          versionsUrl: versionsUrl(PUBLIC_INDEX_PATH),
          action: "Updated public tools directory"
        }));
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

function requireAccess(request, env) {
  const email = getAccessEmail(request);
  if (!email) {
    return html(renderAccessRequired(), { status: 403 });
  }

  if (!isAllowedAccessEmail(email, env)) {
    return html(renderAccessDenied(email), { status: 403 });
  }

  return null;
}

function getAccessEmail(request) {
  return (request.headers.get("Cf-Access-Authenticated-User-Email") || "").trim();
}

function isAllowedAccessEmail(email, env) {
  return getAllowedAccessEmails(env).includes(String(email || "").trim().toLowerCase());
}

function getAllowedAccessEmails(env) {
  return String(env.ACCESS_ALLOWED_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
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

async function listTools(env) {
  const tree = await githubJson(env, `/git/trees/${env.GITHUB_BRANCH}?recursive=1`);
  const baseUrl = ensureTrailingSlash(env.PUBLIC_BASE_URL);
  const metadata = await getMetadata(env);

  return tree.tree
    .filter((item) => item.type === "blob" && item.path.endsWith(".html"))
    .filter((item) => !item.path.startsWith("tools-admin-worker/"))
    .filter((item) => !item.path.startsWith(ARCHIVE_PREFIX))
    .filter((item) => item.path !== PUBLIC_INDEX_PATH)
    .map((item) => ({
      path: item.path,
      name: titleFromPath(item.path),
      description: metadata.tools?.[item.path]?.description || descriptionFromPath(item.path),
      tags: metadata.tools?.[item.path]?.tags || inferTags(item.path),
      owner: metadata.tools?.[item.path]?.owner || "",
      notes: metadata.tools?.[item.path]?.notes || "",
      url: `${baseUrl}${item.path}`,
      embedCode: iframeEmbedCode(`${baseUrl}${item.path}`, titleFromPath(item.path)),
      canvasEmbedCode: canvasEmbedCode(`${baseUrl}${item.path}`, titleFromPath(item.path)),
      downloadUrl: downloadUrl(item.path),
      historyUrl: githubHistoryUrl(env, item.path),
      versionsUrl: versionsUrl(item.path),
      metadataUrl: metadataUrl(item.path),
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
  const description = String(payload.description || "").trim();
  const tags = parseTags(String(payload.tags || ""));
  const owner = String(payload.owner || "").trim();
  const notes = String(payload.notes || "").trim();

  if (!rawHtml) {
    return html(renderUploadResult("No HTML file was uploaded.", false), { status: 400 });
  }

  if (!filename.toLowerCase().endsWith(".html") && !requestedPath.toLowerCase().endsWith(".html")) {
    return html(renderUploadResult("Only .html files can be uploaded.", false), { status: 400 });
  }

  if (TEXT_ENCODER.encode(rawHtml).byteLength > MAX_UPLOAD_BYTES) {
    return html(renderUploadResult(`Upload is too large. Keep HTML files under ${formatBytes(MAX_UPLOAD_BYTES)}.`, false), { status: 413 });
  }

  const validation = validateUploadHtml(rawHtml);
  if (validation.errors.length > 0) {
    return html(renderUploadResult(validation.errors.join(" "), false), { status: 400 });
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
  await updateMetadata(env, targetPath, { description, tags, owner, notes });
  await regeneratePublicIndex(env);

  return html(renderUploadResult("Upload complete.", true, {
    path: targetPath,
    url: `${ensureTrailingSlash(env.PUBLIC_BASE_URL)}${targetPath}`,
    embedCode: iframeEmbedCode(`${ensureTrailingSlash(env.PUBLIC_BASE_URL)}${targetPath}`, titleFromPath(targetPath)),
    canvasEmbedCode: canvasEmbedCode(`${ensureTrailingSlash(env.PUBLIC_BASE_URL)}${targetPath}`, titleFromPath(targetPath)),
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
  await regeneratePublicIndex(env);

  return html(renderUploadResult("Version restored.", true, {
    path,
    url: `${ensureTrailingSlash(env.PUBLIC_BASE_URL)}${path}`,
    embedCode: iframeEmbedCode(`${ensureTrailingSlash(env.PUBLIC_BASE_URL)}${path}`, titleFromPath(path)),
    canvasEmbedCode: canvasEmbedCode(`${ensureTrailingSlash(env.PUBLIC_BASE_URL)}${path}`, titleFromPath(path)),
    downloadUrl: downloadUrl(path),
    commitUrl: result.commit?.html_url,
    historyUrl: githubHistoryUrl(env, path),
    versionsUrl: versionsUrl(path),
    action: `Restored ${commitSha.slice(0, 7)}`
  }));
}

async function handleMetadata(url, env) {
  const path = validateDownloadPath(url.searchParams.get("path") || "");
  const metadata = await getMetadata(env);
  const details = metadata.tools?.[path] || {};

  return html(renderMetadata(path, {
    description: details.description || descriptionFromPath(path),
    tags: (details.tags || inferTags(path)).join(", "),
    owner: details.owner || "",
    notes: details.notes || ""
  }, env));
}

async function handleMetadataSave(request, env) {
  const formData = await request.formData();
  const path = validateDownloadPath(String(formData.get("path") || ""));
  await updateMetadata(env, path, {
    description: String(formData.get("description") || "").trim(),
    tags: parseTags(String(formData.get("tags") || "")),
    owner: String(formData.get("owner") || "").trim(),
    notes: String(formData.get("notes") || "").trim()
  });
  await regeneratePublicIndex(env);

  return redirect("/");
}

async function handleArchive(request, env) {
  const formData = await request.formData();
  const path = validateDownloadPath(String(formData.get("path") || ""));
  const existing = await getExistingFile(env, path);

  if (!existing) {
    return html(renderUploadResult(`"${path}" does not exist.`, false), { status: 404 });
  }

  const archivePath = `${ARCHIVE_PREFIX}${path}`;
  const archivedExisting = await getExistingFile(env, archivePath);

  if (archivedExisting) {
    return html(renderUploadResult(`"${archivePath}" already exists.`, false), { status: 409 });
  }

  const content = base64DecodeUtf8(existing.content || "");
  await putFile(env, {
    path: archivePath,
    content,
    message: `Archive ${path} from tools admin`
  });
  await deleteFile(env, path, existing.sha, `Remove archived ${path} from tools admin`);
  await moveMetadataToArchive(env, path, archivePath);
  await regeneratePublicIndex(env);

  return html(renderUploadResult("File archived.", true, {
    path: archivePath,
    url: `${ensureTrailingSlash(env.PUBLIC_BASE_URL)}${archivePath}`,
    embedCode: iframeEmbedCode(`${ensureTrailingSlash(env.PUBLIC_BASE_URL)}${archivePath}`, titleFromPath(path)),
    canvasEmbedCode: canvasEmbedCode(`${ensureTrailingSlash(env.PUBLIC_BASE_URL)}${archivePath}`, titleFromPath(path)),
    downloadUrl: downloadUrl(archivePath),
    historyUrl: githubHistoryUrl(env, archivePath),
    versionsUrl: versionsUrl(archivePath),
    action: `${path} moved to ${archivePath}`
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

async function getMetadata(env) {
  const existing = await getExistingFile(env, METADATA_PATH);
  if (!existing?.content) return { tools: {} };

  try {
    return JSON.parse(base64DecodeUtf8(existing.content));
  } catch {
    return { tools: {} };
  }
}

async function saveMetadata(env, metadata, message = "Update tools metadata from tools admin") {
  const existing = await getExistingFile(env, METADATA_PATH);
  return putFile(env, {
    path: METADATA_PATH,
    content: `${JSON.stringify(metadata, null, 2)}\n`,
    sha: existing?.sha,
    message
  });
}

async function updateMetadata(env, path, updates) {
  const metadata = await getMetadata(env);
  metadata.tools = metadata.tools || {};
  const current = metadata.tools[path] || {};
  const next = {
    ...current,
    description: updates.description || current.description || descriptionFromPath(path),
    tags: updates.tags?.length ? updates.tags : current.tags || inferTags(path),
    owner: updates.owner || current.owner || "",
    notes: updates.notes || current.notes || "",
    updatedAt: new Date().toISOString()
  };

  metadata.tools[path] = next;
  return saveMetadata(env, metadata);
}

async function moveMetadataToArchive(env, path, archivePath) {
  const metadata = await getMetadata(env);
  metadata.tools = metadata.tools || {};

  if (metadata.tools[path]) {
    metadata.tools[archivePath] = {
      ...metadata.tools[path],
      archivedFrom: path,
      archivedAt: new Date().toISOString()
    };
    delete metadata.tools[path];
    await saveMetadata(env, metadata, `Archive metadata for ${path}`);
  }
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

async function deleteFile(env, path, sha, message) {
  return githubJson(env, `/contents/${encodePath(path)}`, {
    method: "DELETE",
    body: JSON.stringify({
      message,
      sha,
      branch: env.GITHUB_BRANCH
    })
  });
}

async function regeneratePublicIndex(env) {
  const tools = await listTools(env);
  const existing = await getExistingFile(env, PUBLIC_INDEX_PATH);
  const content = renderPublicIndex(tools);

  return putFile(env, {
    path: PUBLIC_INDEX_PATH,
    content,
    sha: existing?.sha,
    message: "Update public tools directory from tools admin"
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

function inferTags(path) {
  const lower = path.toLowerCase();
  const tags = [];

  if (lower.includes("canvas")) tags.push("Canvas");
  if (lower.includes("converter") || lower.includes("convertor")) tags.push("Converter");
  if (lower.includes("generator")) tags.push("Generator");
  if (lower.includes("simulation")) tags.push("Simulation");
  if (lower.includes("template")) tags.push("Template");
  if (lower.includes("ai")) tags.push("AI");
  if (lower.includes("assessment")) tags.push("Assessment");
  if (lower.includes("matrix")) tags.push("Matrix");

  return [...new Set(tags)];
}

function parseTags(value) {
  return [...new Set(value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 12))];
}

function validateUploadHtml(source) {
  const warnings = [];
  const errors = [];

  if (!/<title>[^<]+<\/title>/i.test(source)) {
    warnings.push("No title element found.");
  }

  if (!/<html[\s>]/i.test(source) && !/<!doctype html>/i.test(source)) {
    warnings.push("No html or doctype marker found.");
  }

  if (/<script[^>]+src=["'][^"']*(http:\/\/)/i.test(source)) {
    warnings.push("Contains an insecure http script reference.");
  }

  return { warnings, errors };
}

function iframeEmbedCode(url, title) {
  return `<iframe src="${url}" title="${escapeHtml(title)}" width="100%" height="720" style="border:0;" loading="lazy"></iframe>`;
}

function canvasEmbedCode(url, title) {
  return `<p><iframe src="${url}" title="${escapeHtml(title)}" width="100%" height="720" loading="lazy" style="border: 1px solid #d8d9dd; max-width: 100%;"></iframe></p>`;
}

function downloadUrl(path) {
  return `/download?path=${encodeURIComponent(path)}`;
}

function versionsUrl(path) {
  return `/versions?path=${encodeURIComponent(path)}`;
}

function metadataUrl(path) {
  return `/metadata?path=${encodeURIComponent(path)}`;
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

function renderDashboard(tools, env, request) {
  const existingPaths = tools.map((tool) => tool.path);
  const accessEmail = getAccessEmail(request);
  const rows = tools.map((tool) => `
    <tr data-search="${escapeHtml(`${tool.name} ${tool.path}`.toLowerCase())}">
      <td>
        <a href="${escapeHtml(tool.url)}" target="_blank" rel="noopener">${escapeHtml(tool.name)}</a>
        <div class="muted">${escapeHtml(tool.description)}</div>
        ${tool.tags.length ? `<div class="tag-row">${tool.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
        ${tool.owner ? `<div class="muted">Owner: ${escapeHtml(tool.owner)}</div>` : ""}
      </td>
      <td><code>${escapeHtml(tool.path)}</code></td>
      <td class="actions-cell">
        <details class="action-menu">
          <summary aria-label="Actions for ${escapeHtml(tool.name)}">...</summary>
          <div class="menu-panel">
            <button type="button" data-copy="${escapeHtml(tool.url)}">Copy URL</button>
            <button type="button" data-copy="${escapeHtml(tool.embedCode)}">Copy embed</button>
            <button type="button" data-copy="${escapeHtml(tool.canvasEmbedCode)}">Copy Canvas embed</button>
            <a class="button-link" href="${escapeHtml(tool.downloadUrl)}" download>Download</a>
            <button type="button" data-replace-path="${escapeHtml(tool.path)}">Replace</button>
            <a class="button-link" href="${escapeHtml(tool.metadataUrl)}">Edit details</a>
            <a class="button-link" href="${escapeHtml(tool.versionsUrl)}">Manage versions</a>
            <a class="button-link" href="${escapeHtml(tool.historyUrl)}" target="_blank" rel="noopener">GitHub history</a>
            <form action="/api/archive" method="post" data-confirm-archive="${escapeHtml(tool.path)}">
              <input type="hidden" name="path" value="${escapeHtml(tool.path)}">
              <button type="submit">Archive</button>
            </form>
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
        <span class="signed-in">${escapeHtml(accessEmail)}</span>
        <a class="public" href="${escapeHtml(env.PUBLIC_BASE_URL)}" target="_blank" rel="noopener">Public site</a>
        <a class="logout" href="/logout">Log out</a>
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
        <label>
          Description
          <input id="description" type="text" placeholder="Short purpose of this activity">
        </label>
        <label>
          Tags
          <input id="tags" type="text" placeholder="Canvas, Assessment">
        </label>
        <label>
          Owner
          <input id="owner" type="text" placeholder="Name or team">
        </label>
        <label>
          Notes
          <input id="notes" type="text" placeholder="Course, project, or usage note">
        </label>
        <button type="submit">Upload and publish</button>
      </form>
      <p class="hint" id="upload-mode">Choose a file and path. Existing paths are replaced automatically.</p>
      <div class="upload-checks" id="upload-checks" hidden></div>
      <iframe class="preview-frame" id="preview-frame" title="Upload preview" hidden></iframe>
    </section>

    <section class="panel">
      <div class="section-head">
        <h2>Published HTML activities</h2>
        <label class="search">
          Search
          <input id="search" type="search" placeholder="Search name or path">
        </label>
        <span><span id="visible-count">${tools.length}</span> of ${tools.length} files</span>
        <form action="/api/generate-index" method="post">
          <button type="submit">Update public index</button>
        </form>
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

      document.addEventListener("submit", (event) => {
        const form = event.target.closest("[data-confirm-archive]");
        if (!form) return;
        if (!confirm("Archive " + form.dataset.confirmArchive + "?")) {
          event.preventDefault();
        }
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
      const uploadChecks = document.querySelector("#upload-checks");
      const previewFrame = document.querySelector("#preview-frame");

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
        updatePreviewAndValidation();
      });

      pathInput.addEventListener("input", updateUploadMode);

      async function updatePreviewAndValidation() {
        const file = fileInput.files[0];
        if (!file) {
          uploadChecks.hidden = true;
          previewFrame.hidden = true;
          return;
        }

        const content = await file.text();
        const checks = [];
        checks.push(file.name.toLowerCase().endsWith(".html") ? "HTML extension detected." : "Warning: file extension is not .html.");
        checks.push(/<title>[^<]+<\\/title>/i.test(content) ? "Title found." : "Warning: missing title element.");
        checks.push(content.includes("${escapeJsString(env.GA_MEASUREMENT_ID)}") ? "GA already present." : "GA will be added on upload.");
        checks.push(content.length < ${MAX_UPLOAD_BYTES} ? "File size is within limit." : "Warning: file may be too large.");

        uploadChecks.hidden = false;
        uploadChecks.innerHTML = checks.map((check) => "<div>" + check + "</div>").join("");
        previewFrame.hidden = false;
        previewFrame.srcdoc = content;
      }

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
            description: document.querySelector("#description").value,
            tags: document.querySelector("#tags").value,
            owner: document.querySelector("#owner").value,
            notes: document.querySelector("#notes").value,
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
          ${detail.canvasEmbedCode ? `<button type="button" data-copy="${escapeHtml(detail.canvasEmbedCode)}">Copy Canvas embed</button>` : ""}
          <a class="button-link" href="${escapeHtml(detail.downloadUrl)}" download>Download</a>
          ${detail.commitUrl ? `<a class="button-link" href="${escapeHtml(detail.commitUrl)}" target="_blank" rel="noopener">View commit</a>` : ""}
          ${detail.versionsUrl ? `<a class="button-link" href="${escapeHtml(detail.versionsUrl)}">Manage versions</a>` : ""}
          <a class="button-link" href="${escapeHtml(detail.historyUrl)}" target="_blank" rel="noopener">GitHub history</a>
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

function renderMetadata(path, details, env) {
  return page(`Edit ${titleFromPath(path)}`, `
    <header>
      <div>
        <p class="eyebrow">Tool details</p>
        <h1>${escapeHtml(titleFromPath(path))}</h1>
      </div>
      <div class="header-actions">
        <a class="public" href="/">Dashboard</a>
        <a class="public" href="${escapeHtml(`${ensureTrailingSlash(env.PUBLIC_BASE_URL)}${path}`)}" target="_blank" rel="noopener">Public page</a>
      </div>
    </header>
    <section class="panel">
      <form class="details-form" action="/api/metadata" method="post">
        <input type="hidden" name="path" value="${escapeHtml(path)}">
        <label>
          Description
          <textarea name="description" rows="3">${escapeHtml(details.description)}</textarea>
        </label>
        <label>
          Tags
          <input name="tags" type="text" value="${escapeHtml(details.tags)}" placeholder="Canvas, Converter, Assessment">
        </label>
        <label>
          Owner
          <input name="owner" type="text" value="${escapeHtml(details.owner)}" placeholder="Name or team">
        </label>
        <label>
          Notes
          <textarea name="notes" rows="5">${escapeHtml(details.notes)}</textarea>
        </label>
        <button type="submit">Save details</button>
      </form>
    </section>
  `);
}

function renderPublicIndex(tools) {
  const rows = tools.map((tool) => `
    <article class="tool">
      <h2><a href="${escapeHtml(tool.url)}">${escapeHtml(tool.name)}</a></h2>
      <p>${escapeHtml(tool.description)}</p>
      ${tool.tags.length ? `<p class="tags">${tool.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</p>` : ""}
    </article>
  `).join("");

  return `<!doctype html>
<html lang="en-AU">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Tools Directory</title>
  <style>
    body{margin:0;background:#f2f2f2;color:#17172f;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;line-height:1.45}
    header{background:#000054;color:#fff;border-bottom:4px solid #e61e2a;padding:28px clamp(18px,4vw,42px)}
    main{max-width:980px;margin:0 auto;padding:24px}
    h1,h2,p{margin:0}
    h1{font-size:1.6rem}
    .tool{background:#fff;border:1px solid #d8d9dd;border-radius:8px;padding:16px;margin-bottom:12px}
    .tool h2{font-size:1rem;margin-bottom:6px}
    a{color:#000054;font-weight:700}
    .tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
    .tags span{font-size:.78rem;border:1px solid #d8d9dd;border-radius:999px;padding:3px 8px;background:#fafafa}
  </style>
</head>
<body>
  <header>
    <h1>Tools Directory</h1>
    <p>${tools.length} published HTML activities</p>
  </header>
  <main>${rows}</main>
</body>
</html>`;
}

function renderAccessRequired() {
  return page("Access required", `
    <section class="panel result">
      <h1>Access required</h1>
      <p>This dashboard is protected by Cloudflare Access. Sign in through Cloudflare Access to continue.</p>
      <p><a href="/">Try again</a></p>
    </section>
  `);
}

function renderAccessDenied(email) {
  return page("Access denied", `
    <section class="panel result">
      <h1>Access denied</h1>
      <p><code>${escapeHtml(email)}</code> is not allowed to use this dashboard.</p>
      <p><a href="/logout">Log out of Cloudflare Access</a></p>
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
    .signed-in{font-size:.85rem;color:#dadae8}
    .logout{background:#fff;color:var(--navy);border:1px solid #fff;border-radius:6px;min-height:34px;padding:6px 10px;text-decoration:none;display:inline-flex;align-items:center;font-weight:700}
    .panel{max-width:1120px;margin:22px auto;background:#fff;border:1px solid var(--line);padding:20px;border-radius:8px;box-shadow:0 1px 2px rgba(0,0,20,.06)}
    .upload form{display:grid;grid-template-columns:minmax(220px,1fr) minmax(220px,1fr) auto auto;gap:14px;align-items:end;margin-top:16px}
    label{display:flex;flex-direction:column;gap:6px;font-size:.82rem;font-weight:700;color:var(--muted)}
    input[type=file],input[type=text],input[type=search],textarea{font:inherit;border:1px solid var(--line);border-radius:6px;padding:9px;background:#fff;color:var(--ink);min-height:40px}
    textarea{resize:vertical}
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
    .menu-panel{position:absolute;right:0;top:38px;z-index:10;min-width:180px;background:#fff;border:1px solid var(--line);border-radius:8px;box-shadow:0 10px 28px rgba(0,0,40,.14);padding:6px;display:grid;gap:2px}
    .menu-panel button,.menu-panel .button-link{width:100%;justify-content:flex-start;border-color:transparent;background:#fff;color:var(--ink);min-height:32px;padding:7px 10px;font-size:.9rem;font-weight:500;line-height:1.25;text-align:left}
    .menu-panel button:hover,.menu-panel .button-link:hover{background:#f4f5ff;color:var(--navy)}
    .result-actions{margin-top:16px}
    .muted{color:var(--muted);font-size:.82rem;margin-top:3px}
    .tag-row{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px}
    .tag-row span{font-size:.72rem;border:1px solid var(--line);border-radius:999px;padding:2px 7px;background:#fafafa;color:var(--muted)}
    .upload-checks{border:1px solid var(--line);border-radius:8px;background:#fbfbfb;padding:10px;margin-top:12px;color:var(--muted);font-size:.86rem}
    .preview-frame{width:100%;height:320px;border:1px solid var(--line);border-radius:8px;background:#fff;margin-top:12px}
    .details-form{display:grid;gap:14px}
    .result{margin-top:44px}
    .result h1{margin-bottom:12px}
    .result p{margin-top:10px}
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
