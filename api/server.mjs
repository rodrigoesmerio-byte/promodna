import http from "node:http";
import crypto from "node:crypto";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";

const PORT = Number(process.env.PORT || 8080);
const MELI_API = "https://api.mercadolibre.com";
const DEFAULT_ORIGINS = [
  "https://rodrigoesmerio-byte.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000"
];
const allowedOrigins = new Set(
  (process.env.ALLOWED_ORIGINS || DEFAULT_ORIGINS.join(","))
    .split(",")
    .map(value => value.trim())
    .filter(Boolean)
);

const secrets = new SecretManagerServiceClient();
const cache = new Map();
const rateBuckets = new Map();
let memoryToken = null;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const base64url = value => Buffer.from(value).toString("base64url");
const safeEqual = (left, right) => {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

function json(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...headers
  });
  res.end(body);
}

function html(res, status, body, headers = {}) {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    ...headers
  });
  res.end(body);
}

function redirect(res, location, headers = {}) {
  res.writeHead(302, { location, "cache-control": "no-store", ...headers });
  res.end();
}

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .map(part => part.trim())
      .filter(Boolean)
      .map(part => {
        const index = part.indexOf("=");
        return index < 0 ? [part, ""] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function sign(value) {
  const key = process.env.OAUTH_SIGNING_KEY;
  if (!key) throw new Error("OAUTH_SIGNING_KEY não configurada");
  return crypto.createHmac("sha256", key).update(value).digest("base64url");
}

function signedValue(payload) {
  const encoded = base64url(JSON.stringify(payload));
  return `${encoded}.${sign(encoded)}`;
}

function verifySignedValue(value) {
  const [encoded, signature] = String(value || "").split(".");
  if (!encoded || !signature || !safeEqual(signature, sign(encoded))) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    return payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

function isAdmin(req) {
  return Boolean(verifySignedValue(parseCookies(req).promodna_admin));
}

function corsHeaders(req) {
  const origin = req.headers.origin;
  if (!origin || !allowedOrigins.has(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type",
    vary: "Origin"
  };
}

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown")
    .split(",")[0]
    .trim();
}

function withinRateLimit(req) {
  const key = clientIp(req);
  const now = Date.now();
  const current = rateBuckets.get(key);
  if (!current || now - current.startedAt >= 60_000) {
    rateBuckets.set(key, { startedAt: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= 30;
}

async function readBody(req, limit = 16_384) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("Corpo da requisição excede o limite");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readTokenSecret() {
  if (memoryToken?.access_token) return memoryToken;
  const parent = process.env.MELI_TOKEN_SECRET;
  if (!parent) {
    if (!process.env.MELI_ACCESS_TOKEN) return null;
    memoryToken = {
      access_token: process.env.MELI_ACCESS_TOKEN,
      refresh_token: process.env.MELI_REFRESH_TOKEN || null,
      expires_at: Number(process.env.MELI_TOKEN_EXPIRES_AT || Date.now() + 300_000)
    };
    return memoryToken;
  }
  try {
    const [version] = await secrets.accessSecretVersion({ name: `${parent}/versions/latest` });
    memoryToken = JSON.parse(Buffer.from(version.payload.data).toString("utf8"));
    return memoryToken;
  } catch (error) {
    if (Number(error.code) === 5) return null;
    throw error;
  }
}

async function saveTokenSecret(token) {
  const normalized = {
    access_token: token.access_token,
    refresh_token: token.refresh_token || null,
    token_type: token.token_type || "bearer",
    scope: token.scope || "read offline_access",
    user_id: token.user_id || null,
    expires_at: Date.now() + Number(token.expires_in || 21_600) * 1000
  };
  memoryToken = normalized;
  const parent = process.env.MELI_TOKEN_SECRET;
  if (parent) {
    await secrets.addSecretVersion({
      parent,
      payload: { data: Buffer.from(JSON.stringify(normalized), "utf8") }
    });
  }
  return normalized;
}

async function refreshMeliToken(token) {
  if (!token?.refresh_token) throw new Error("Mercado Livre precisa ser autorizado novamente");
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: process.env.MELI_CLIENT_ID || "",
    client_secret: process.env.MELI_CLIENT_SECRET || "",
    refresh_token: token.refresh_token
  });
  const response = await fetch(`${MELI_API}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: params
  });
  if (!response.ok) throw new Error(`Falha ao renovar autorização do Mercado Livre (${response.status})`);
  return saveTokenSecret(await response.json());
}

async function getMeliToken() {
  let token = await readTokenSecret();
  if (!token) return null;
  if (Number(token.expires_at || 0) - Date.now() < 120_000) token = await refreshMeliToken(token);
  return token.access_token;
}

export function normalizeMeliItem(item) {
  const attributes = Array.isArray(item.attributes) ? item.attributes : [];
  const attribute = (...ids) => attributes.find(entry => ids.includes(entry.id))?.value_name || "";
  const originalPrice = Number(item.original_price || item.list_price || 0);
  const price = Number(item.price || 0);
  const discount = originalPrice > price && price > 0
    ? Math.round((1 - price / originalPrice) * 100)
    : 0;
  const freeShipping = Boolean(item.shipping?.free_shipping);
  const official = Boolean(item.official_store_id || item.official_store_name);
  const score = clamp(Math.round(55 + discount * 1.1 + (freeShipping ? 6 : 0) + (official ? 8 : 0)), 0, 91);
  const details = attributes
    .filter(entry => entry.value_name)
    .slice(0, 4)
    .map(entry => entry.value_name)
    .join(" • ");

  return {
    id: `meli:${item.id}`,
    source: "mercado_livre",
    sourceLabel: "Mercado Livre",
    sourceItemId: item.id,
    code: attribute("MODEL") || String(item.id || "MLB").replace(/^MLB/, "MLB "),
    name: item.title || "Produto sem título",
    brand: attribute("BRAND") || item.official_store_name || "Marca não informada",
    category: item.category_id || "Mercado Livre",
    seller: item.official_store_name || item.seller?.nickname || "Vendedor no Mercado Livre",
    status: "provavel",
    score,
    price,
    referencePrice: originalPrice || null,
    median30: null,
    median90: null,
    historicalMinimum: null,
    discount,
    shipping: freeShipping ? 0 : null,
    delivery: "consulte o prazo na oferta",
    trust: official ? 92 : 72,
    ean: attribute("GTIN", "EAN") || "não informado",
    spec: details || "Consulte as especificações na oferta",
    url: item.permalink,
    image: item.secure_thumbnail || item.thumbnail || null,
    history: [],
    historyReady: false,
    verifiedAt: new Date().toISOString()
  };
}

async function searchMeli(query) {
  const cacheKey = query.toLocaleLowerCase("pt-BR");
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const token = await getMeliToken();
  if (!token) {
    const error = new Error("Fonte Mercado Livre ainda não autorizada");
    error.code = "SOURCE_NOT_AUTHORIZED";
    throw error;
  }
  const endpoint = new URL(`${MELI_API}/sites/MLB/search`);
  endpoint.searchParams.set("q", query);
  endpoint.searchParams.set("limit", "20");
  const response = await fetch(endpoint, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    signal: AbortSignal.timeout(12_000)
  });
  if (!response.ok) throw new Error(`Mercado Livre respondeu ${response.status}`);
  const payload = await response.json();
  const value = {
    source: "mercado_livre",
    sourceLabel: "Mercado Livre",
    query,
    fetchedAt: new Date().toISOString(),
    historyStatus: "collecting",
    notice: "Preços atuais da API oficial. O histórico de 30/90 dias começará a ser calculado após a coleta de observações.",
    offers: (payload.results || []).map(normalizeMeliItem).filter(item => item.price > 0 && item.url)
  };
  cache.set(cacheKey, { expiresAt: Date.now() + 5 * 60_000, value });
  return value;
}

function sourceStatus() {
  const configured = Boolean(process.env.MELI_CLIENT_ID && process.env.MELI_CLIENT_SECRET);
  return [
    {
      id: "mercado_livre",
      name: "Mercado Livre",
      status: configured ? "configured" : "credentials_required",
      mode: "OAuth 2.0 + API oficial"
    },
    {
      id: "amazon",
      name: "Amazon Creators API",
      status: "partner_approval_required",
      mode: "Associates + credenciais"
    },
    {
      id: "shopee",
      name: "Shopee Open Platform",
      status: "partner_approval_required",
      mode: "Parceiro homologado"
    },
    {
      id: "magalu",
      name: "Magalu APIs",
      status: "seller_oauth_required",
      mode: "OAuth 2.0 do seller"
    }
  ];
}

function adminPage(message = "") {
  const note = message ? `<p class="note">${message}</p>` : "";
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PromoDNA • Conectar fontes</title><style>body{margin:0;background:#10251f;color:#edf7f0;font:16px system-ui;min-height:100vh;display:grid;place-items:center}.card{width:min(520px,calc(100% - 40px));background:#17372d;border:1px solid #31584b;border-radius:22px;padding:30px;box-shadow:0 30px 80px #07120e80}h1{margin:0 0 8px}.muted{color:#b7ccc3;line-height:1.55}.note{padding:12px;border-radius:12px;background:#2b493f;color:#e7f7ed}label{display:grid;gap:7px;margin:22px 0 12px;font-weight:700}input{font:inherit;padding:13px;border:0;border-radius:11px}button,a{display:inline-block;border:0;border-radius:11px;padding:13px 17px;background:#d8ff55;color:#10251f;font-weight:800;text-decoration:none;cursor:pointer}</style></head><body><main class="card"><h1>Conectar fontes reais</h1><p class="muted">A administração é protegida. A senha nunca é enviada ao GitHub e permanece no Secret Manager.</p>${note}<form method="post" action="/admin/login"><label>Senha de configuração<input type="password" name="password" autocomplete="current-password" required></label><button type="submit">Continuar com segurança</button></form></main></body></html>`;
}

async function handleAdminLogin(req, res) {
  const body = new URLSearchParams(await readBody(req));
  if (!process.env.ADMIN_PASSWORD || !safeEqual(body.get("password") || "", process.env.ADMIN_PASSWORD)) {
    return html(res, 401, adminPage("Senha de configuração incorreta."));
  }
  const session = signedValue({ purpose: "admin", exp: Date.now() + 30 * 60_000 });
  return redirect(res, "/oauth/mercadolivre/start", {
    "set-cookie": `promodna_admin=${encodeURIComponent(session)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=1800`
  });
}

async function startMeliOAuth(req, res) {
  if (!isAdmin(req)) return redirect(res, "/admin");
  const clientId = process.env.MELI_CLIENT_ID;
  const redirectUri = process.env.MELI_REDIRECT_URI;
  if (!clientId || !redirectUri) return html(res, 503, adminPage("Credenciais do Mercado Livre ainda não configuradas no Cloud Run."));
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const state = signedValue({ purpose: "meli", exp: Date.now() + 10 * 60_000, nonce: crypto.randomUUID() });
  const authorization = new URL("https://auth.mercadolivre.com.br/authorization");
  authorization.searchParams.set("response_type", "code");
  authorization.searchParams.set("client_id", clientId);
  authorization.searchParams.set("redirect_uri", redirectUri);
  authorization.searchParams.set("state", state);
  authorization.searchParams.set("code_challenge", challenge);
  authorization.searchParams.set("code_challenge_method", "S256");
  return redirect(res, authorization.toString(), {
    "set-cookie": `promodna_pkce=${verifier}; HttpOnly; Secure; SameSite=Lax; Path=/oauth/mercadolivre; Max-Age=600`
  });
}

async function finishMeliOAuth(req, res, url) {
  const state = verifySignedValue(url.searchParams.get("state"));
  const verifier = parseCookies(req).promodna_pkce;
  const code = url.searchParams.get("code");
  if (!state || state.purpose !== "meli" || !verifier || !code) {
    return html(res, 400, adminPage("A autorização expirou ou não pôde ser validada. Tente novamente."));
  }
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: process.env.MELI_CLIENT_ID || "",
    client_secret: process.env.MELI_CLIENT_SECRET || "",
    code,
    redirect_uri: process.env.MELI_REDIRECT_URI || "",
    code_verifier: verifier
  });
  const response = await fetch(`${MELI_API}/oauth/token`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: params
  });
  if (!response.ok) return html(res, 502, adminPage(`Mercado Livre recusou a autorização (${response.status}).`));
  await saveTokenSecret(await response.json());
  return html(res, 200, `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fonte conectada</title><style>body{margin:0;background:#10251f;color:white;font:18px system-ui;min-height:100vh;display:grid;place-items:center}.card{max-width:560px;margin:20px;padding:34px;background:#17372d;border-radius:22px}b{color:#d8ff55}</style></head><body><main class="card"><h1>Mercado Livre conectado</h1><p>O token foi armazenado no Secret Manager e será renovado automaticamente. Você já pode voltar ao <b>PromoDNA</b>.</p></main></body></html>`, {
    "set-cookie": "promodna_pkce=; HttpOnly; Secure; SameSite=Lax; Path=/oauth/mercadolivre; Max-Age=0"
  });
}

export async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    return res.end();
  }
  if (url.pathname === "/health" && req.method === "GET") {
    return json(res, 200, { ok: true, service: "promodna-api", version: "0.1.0", time: new Date().toISOString() });
  }
  if (url.pathname === "/v1/sources" && req.method === "GET") {
    return json(res, 200, { sources: sourceStatus() }, cors);
  }
  if (url.pathname === "/v1/search" && req.method === "GET") {
    if (!withinRateLimit(req)) return json(res, 429, { error: "RATE_LIMITED", message: "Aguarde um minuto e tente novamente." }, cors);
    const query = String(url.searchParams.get("q") || "").trim();
    if (query.length < 2 || query.length > 100) return json(res, 400, { error: "INVALID_QUERY", message: "Use uma busca entre 2 e 100 caracteres." }, cors);
    try {
      return json(res, 200, await searchMeli(query), cors);
    } catch (error) {
      const status = error.code === "SOURCE_NOT_AUTHORIZED" ? 503 : 502;
      return json(res, status, { error: error.code || "SOURCE_ERROR", message: error.message }, cors);
    }
  }
  if (url.pathname === "/admin" && req.method === "GET") return html(res, 200, adminPage());
  if (url.pathname === "/admin/login" && req.method === "POST") return handleAdminLogin(req, res);
  if (url.pathname === "/oauth/mercadolivre/start" && req.method === "GET") return startMeliOAuth(req, res);
  if (url.pathname === "/oauth/mercadolivre/callback" && req.method === "GET") return finishMeliOAuth(req, res, url);
  return json(res, 404, { error: "NOT_FOUND", message: "Rota inexistente." }, cors);
}

if (process.env.NODE_ENV !== "test") {
  http.createServer((req, res) => {
    handleRequest(req, res).catch(error => {
      console.error("request_failed", { message: error.message });
      if (!res.headersSent) json(res, 500, { error: "INTERNAL_ERROR", message: "Falha interna temporária." });
      else res.end();
    });
  }).listen(PORT, "0.0.0.0", () => console.log(`promodna-api listening on ${PORT}`));
}
