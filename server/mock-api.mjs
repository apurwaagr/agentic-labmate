import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { URL } from "node:url";

loadEnvFile(".env");
loadEnvFile(".env.local");

const port = Number(process.env.PORT || 8787);
const geminiApiKey = process.env.GEMINI_API_KEY || "";
const geminiModel = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const protocolsIoApiKey = process.env.PROTOCOLS_IO_API_KEY || "";
const openAlexApiUrl = process.env.OPENALEX_API_URL || "https://api.openalex.org";
const crossrefApiUrl = process.env.CROSSREF_API_URL || "https://api.crossref.org";
const pubchemApiUrl = process.env.PUBCHEM_API_URL || "https://pubchem.ncbi.nlm.nih.gov/rest/pug";
const crossrefMailto = process.env.CROSSREF_MAILTO || "";
const openAlexMailto = process.env.OPENALEX_MAILTO || crossrefMailto || "";
const reviewStorePath = join(process.cwd(), "server", ".data", "reviews.json");

const reviewStore = loadReviewStore();

// ─── In-memory SDF cache (avoids repeated PubChem hits for the same CID) ─────────
/** @type {Map<string, { sdf: string; ts: number }>} */
const sdfCache = new Map();
const SDF_CACHE_TTL_MS = 30 * 60 * 1000; // 30 min

function normalizeCompoundName(name = "") {
  const cleaned = String(name)
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/[,;].*$/, "")
    .replace(/\b(cell culture|analytical|anhydrous|reagent|grade|technical|ultrapure|hplc|sterile|pure)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned === "dmso") return "dimethyl sulfoxide";
  return cleaned;
}

async function fetchSdfByCid(cid, type = "3d", name = "") {
  const key = `${cid}:${type}`;
  const cached = sdfCache.get(key);
  if (cached && Date.now() - cached.ts < SDF_CACHE_TTL_MS) return cached.sdf;

  // 1. Try PubChem
  const pubchemUrl = type === "3d"
    ? `${pubchemApiUrl}/compound/cid/${cid}/SDF?record_type=3d`
    : `${pubchemApiUrl}/compound/cid/${cid}/SDF`;

  try {
    const res = await fetch(pubchemUrl);
    if (res.ok) {
      const sdf = await res.text();
      if (sdf && !sdf.trim().startsWith("{") && sdf.includes("\n")) {
        sdfCache.set(key, { sdf, ts: Date.now() });
        return sdf;
      }
    }
  } catch { /* fall through */ }

  // 2. Try NCI Cactus by compound name as fallback.
  // Use both raw and normalized names to handle labels like "DMSO, cell culture grade".
  const nameCandidates = Array.from(new Set([
    String(name || "").trim(),
    normalizeCompoundName(name),
  ].filter(Boolean)));

  for (const candidate of (nameCandidates.length ? nameCandidates : [String(cid)])) {
    const cactusQuery = encodeURIComponent(candidate);
    try {
      const cactusUrl = `https://cactus.nci.nih.gov/chemical/structure/${cactusQuery}/sdf`;
      const res = await fetch(cactusUrl, { headers: { Accept: "text/plain" } });
      if (!res.ok) continue;
      const sdf = await res.text();
      if (sdf && !sdf.trim().startsWith("<") && !sdf.trim().startsWith("{") && sdf.includes("\n")) {
        sdfCache.set(key, { sdf, ts: Date.now() });
        return sdf;
      }
    } catch {
      continue;
    }
  }

  return null;
}

const apiContracts = [
  {
    name: "Health",
    method: "GET",
    path: "/api/health",
    purpose: "Service availability check for frontend and teammate integrations.",
  },
  {
    name: "Hypothesis Parse",
    method: "POST",
    path: "/api/experiments/parse",
    purpose: "Extract intervention, control, mechanism, outcome, and target threshold from free text.",
  },
  {
    name: "Literature QC",
    method: "POST",
    path: "/api/literature/qc",
    purpose: "Return novelty signal plus top references before plan generation.",
  },
  {
    name: "Experiment Plan",
    method: "POST",
    path: "/api/experiments/plan",
    purpose: "Return a domain-aware runnable plan with protocol, materials, budget, timeline, and validation gates.",
  },
  {
    name: "Scientist Chat",
    method: "POST",
    path: "/api/chat",
    purpose: "Answer grounded scientist questions using plan context, sources, and review memory.",
  },
  {
    name: "Compound Resolve",
    method: "GET",
    path: "/api/compound/resolve",
    purpose: "Resolve compound names into PubChem CIDs and image URLs, with Gemini-assisted canonicalization fallback.",
  },
  {
    name: "Review Store",
    method: "GET/POST",
    path: "/api/reviews",
    purpose: "Read or submit structured scientist corrections for continuous improvement.",
  },
  {
    name: "Knowledge Graph Context",
    method: "GET",
    path: "/api/knowledge-graph/context",
    purpose: "Expose graph-ready entities, relationships, tags, materials, and learned corrections for downstream enrichment.",
  },
];

function loadReviewStore() {
  try {
    if (!existsSync(reviewStorePath)) {
      return [];
    }

    const parsed = JSON.parse(readFileSync(reviewStorePath, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistReviewStore() {
  mkdirSync(dirname(reviewStorePath), { recursive: true });
  writeFileSync(reviewStorePath, JSON.stringify(reviewStore, null, 2));
}

function loadEnvFile(filename) {
  const filePath = join(process.cwd(), filename);
  if (!existsSync(filePath)) {
    return;
  }

  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, "");

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function slugify(input) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function detectDomain(hypothesis) {
  const text = hypothesis.toLowerCase();

  if (/(mouse|mice|c57bl|intestinal|fitc-dextran|in vivo|animal)/.test(text)) {
    return {
      name: "In Vivo Gut Health",
      id: "in-vivo-gut-health",
      project: "Gut Barrier Study",
      plainEnglish: "Test whether a probiotic strengthens the gut lining in mice.",
      tags: ["in-vivo", "microbiome", "intestinal-permeability"],
    };
  }

  if (/(hela|cryoprotectant|post-thaw|freezing medium|dmso|trehalose|cell viability)/.test(text)) {
    return {
      name: "Cell Biology",
      id: "cell-biology-trehalose",
      project: "Cryopreservation Optimization",
      plainEnglish: "Test whether trehalose improves post-thaw HeLa cell survival.",
      tags: ["cell-biology", "cryopreservation", "hela"],
    };
  }

  if (/(electrochemical|biosensor|crp|whole blood|elisa|diagnostic|antibody)/.test(text)) {
    return {
      name: "Diagnostics",
      id: "diagnostics-paper-crp",
      project: "Rapid CRP Diagnostic",
      plainEnglish: "Build a fast inflammation test that works on whole blood without lab preprocessing.",
      tags: ["diagnostics", "biosensor", "point-of-care"],
    };
  }

  if (/(co2|acetate|sporomusa|cathode|bioelectrochemical|she|carbon capture)/.test(text)) {
    return {
      name: "Electrochemistry Climate",
      id: "electrochemistry-climate",
      project: "Bioelectrochemical Carbon Capture",
      plainEnglish: "Test whether a microbe can convert CO2 into acetate more efficiently than current systems.",
      tags: ["climate", "electrochemistry", "co2-fixation"],
    };
  }

  return {
    name: "Molecular Biology",
    id: `custom-${slugify(hypothesis) || "experiment"}`,
    project: "Custom Experimental Plan",
    plainEnglish: "Translate a research hypothesis into a runnable lab experiment.",
    tags: ["experimental-design"],
  };
}

function extractText(responseJson) {
  const parts = responseJson?.candidates?.[0]?.content?.parts || [];
  return parts
    .map((part) => part.text || "")
    .join("")
    .trim();
}

function parseJsonFromText(text) {
  const trimmed = text.trim();
  if (!trimmed) {
    return {};
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!match) {
      throw new Error("Model did not return valid JSON");
    }
    return JSON.parse(match[0]);
  }
}

function groundingReferences(responseJson) {
  const metadata = responseJson?.candidates?.[0]?.groundingMetadata;
  const chunks = metadata?.groundingChunks || [];

  return chunks
    .map((chunk) => {
      const web = chunk.web;
      if (!web?.title) {
        return null;
      }

      return {
        title: web.title,
        uri: web.uri,
        source: hostLabel(web.uri),
      };
    })
    .filter(Boolean)
    .slice(0, 8);
}

function hostLabel(uri = "") {
  try {
    const parsed = new URL(uri);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return "web";
  }
}

function directResourceUri(source = "", title = "", hypothesis = "") {
  const label = source.toLowerCase();
  const query = encodeURIComponent((title || hypothesis || "scientific protocol").trim());

  if (label.includes("protocols.io")) {
    return `https://www.protocols.io/search?query=${query}`;
  }

  if (label.includes("bio-protocol")) {
    return `https://bio-protocol.org/search.aspx?search=${query}`;
  }

  if (label.includes("thermofisher")) {
    return `https://www.thermofisher.com/search/results?query=${query}`;
  }

  if (label.includes("sigma") || label.includes("sigmaaldrich")) {
    return `https://www.sigmaaldrich.com/US/en/search/${query}`;
  }

  if (label.includes("promega")) {
    return `https://www.promega.com/search/?query=${query}`;
  }

  if (label.includes("qiagen")) {
    return `https://www.qiagen.com/us/search?query=${query}`;
  }

  if (label.includes("atcc")) {
    return `https://www.atcc.org/search#q=${query}`;
  }

  if (label.includes("addgene")) {
    return `https://www.addgene.org/search/catalog/plasmids/?q=${query}`;
  }

  if (label.includes("jove")) {
    return `https://www.jove.com/search?q=${query}`;
  }

  if (label.includes("nature")) {
    return `https://www.nature.com/search?q=${query}`;
  }

  return `https://${source || "pubmed.ncbi.nlm.nih.gov"}`;
}

function buildBudget(materials, budget, timeline, domainName) {
  const reagentSubtotal = budget.reagentsUsd ?? materials.reduce((sum, item) => sum + item.unitCostUsd, 0);
  const equipmentSubtotal = budget.equipmentUsd ?? 0;
  const shippingUsd = budget.shippingUsd ?? Math.max(45, Math.round(materials.length * 18));
  const totalDays = timeline.reduce((sum, phase) => sum + phase.durationDays, 0);
  const laborUsd = budget.laborUsd ?? Math.round(totalDays * 85);
  const contingencyUsd = budget.contingencyUsd ?? Math.round((reagentSubtotal + equipmentSubtotal + shippingUsd) * 0.12);
  const computedOperationalTotal = reagentSubtotal + equipmentSubtotal + shippingUsd + laborUsd + contingencyUsd;
  const totalUsd = Math.max(budget.totalUsd ?? 0, computedOperationalTotal);
  const budgetCapUsd = Math.max(budget.budgetCapUsd ?? 0, Math.round(totalUsd * 1.65));

  return {
    reagentsUsd: reagentSubtotal,
    equipmentUsd: equipmentSubtotal,
    shippingUsd,
    laborUsd,
    contingencyUsd,
    totalUsd,
    budgetCapUsd,
    savedUsd: Math.max(0, budgetCapUsd - totalUsd),
    reliability:
      budget.reliability ||
      `Moderate confidence. ${domainName} pricing includes procurement, setup, and staffing assumptions rather than reagent-only estimates.`,
    assumptions:
      budget.assumptions || [
        "Catalog prices are estimated in USD for planning and may vary by institution or geography.",
        "Labor assumes one scientist plus shared technician support during active execution windows.",
        "Shipping reflects cold-chain and rush risk on critical-path items, not standard institutional freight contracts.",
      ],
    lineItems:
      budget.lineItems || [
        { label: "Reagents and consumables", amountUsd: reagentSubtotal, category: "reagents" },
        { label: "Equipment access and assay hardware", amountUsd: equipmentSubtotal, category: "equipment" },
        { label: "Procurement and cold-chain shipping", amountUsd: shippingUsd, category: "shipping" },
        { label: "Hands-on scientist time", amountUsd: laborUsd, category: "labor" },
        { label: "Operational contingency", amountUsd: contingencyUsd, category: "contingency" },
      ],
  };
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  });
  response.end(JSON.stringify(payload));
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(options.headers || {}),
      },
    });

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let data = "";
    request.on("data", (chunk) => {
      data += chunk;
    });
    request.on("end", () => {
      if (!data) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(data));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

async function callGemini({
  prompt,
  schema,
  grounded = false,
}) {
  if (!geminiApiKey) {
    throw new Error("Missing GEMINI_API_KEY");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), grounded ? 20000 : 12000);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiApiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: prompt }],
            },
          ],
          tools: grounded ? [{ google_search: {} }] : undefined,
          generationConfig: {
            temperature: 0.3,
            ...(grounded
              ? {}
              : {
                  responseMimeType: "application/json",
                  responseSchema: schema,
                }),
          },
        }),
      },
    );

    const json = await response.json();
    if (!response.ok) {
      const message = json?.error?.message || `Gemini request failed with status ${response.status}`;
      throw new Error(message);
    }

    return {
      data: grounded ? parseJsonFromText(extractText(json)) : JSON.parse(extractText(json) || "{}"),
      references: groundingReferences(json),
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Gemini request timed out");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function resolvePubChemCidByName(name) {
  const trimmed = (name || "").trim();
  if (!trimmed) {
    return null;
  }

  const requestUrl = `${pubchemApiUrl}/compound/name/${encodeURIComponent(trimmed)}/cids/JSON`;

  try {
    const response = await fetch(requestUrl, {
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      return null;
    }

    const json = await response.json();
    const cid = json?.IdentifierList?.CID?.[0];
    return Number.isFinite(cid) ? Number(cid) : null;
  } catch {
    return null;
  }
}

function normalizeCompoundQuery(name) {
  return (name || "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b\d+(?:\.\d+)?\s*(?:mM|uM|nM|M|mg\/?mL|g\/?L|%|w\/?v|v\/?v)\b/gi, " ")
    .replace(/\b(?:solution|buffer|media|medium|reagent grade|catalog|cat\.?\s*no\.?|lot\s*no\.?|feed|target|substrate|assembly|grade|cell culture)\b/gi, " ")
    .replace(/[,:;]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isGenericNonCompoundLabel(name = "") {
  const label = (name || "").toLowerCase().trim();
  return /custom experimental plan|primary measured outcome|matched control arm|hypothesis threshold|life science/.test(label)
    || /translate a research hypothesis|runnable lab experiment/.test(label);
}

function pubchemNameCandidates(name = "") {
  const raw = (name || "").trim();
  const normalized = normalizeCompoundQuery(raw);

  const aliases = {
    "carbon dioxide feed": "carbon dioxide",
    "co2 feed": "carbon dioxide",
    "acetate assay": "acetate",
    "acetate assay kit": "acetate",
  };

  const alias = aliases[raw.toLowerCase()] || aliases[normalized.toLowerCase()] || "";
  const dequalified = normalized
    .replace(/\b(feed|target|substrate|assembly|kit|culture|cells?)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return [...new Set([raw, normalized, alias, dequalified].filter(Boolean))].filter((candidate) => !isGenericNonCompoundLabel(candidate));
}

function likelyNotSingleCompound(name) {
  const label = (name || "").toLowerCase();
  return /(buffer|medium|media|serum|cells|cell line|broth|agar|antibody cocktail|mix|mixture|kit)/.test(label);
}

function tokenSimilarity(a, b) {
  const aTokens = new Set((a || "").toLowerCase().match(/[a-z0-9]{3,}/g) || []);
  const bTokens = new Set((b || "").toLowerCase().match(/[a-z0-9]{3,}/g) || []);

  if (aTokens.size === 0 || bTokens.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap / Math.max(aTokens.size, bTokens.size);
}

function resolutionCandidates(query) {
  const normalized = normalizeCompoundQuery(query);
  const firstSegment = normalized.split(/[\/+]/)[0].trim();
  const beforeComma = normalized.split(",")[0].trim();

  return [...new Set([query.trim(), normalized, firstSegment, beforeComma].filter(Boolean))];
}

async function resolvePubChemImageByName(name) {
  const trimmed = (name || "").trim();
  if (!trimmed) {
    return null;
  }

  const imageUrl = `${pubchemApiUrl}/compound/name/${encodeURIComponent(trimmed)}/PNG?image_size=large`;

  try {
    const response = await fetch(imageUrl);
    return response.ok ? imageUrl : null;
  } catch {
    return null;
  }
}

async function aiCompoundCandidates(name) {
  if (!geminiApiKey) {
    return [];
  }

  const schema = {
    type: "OBJECT",
    properties: {
      canonicalName: { type: "STRING" },
      aliases: {
        type: "ARRAY",
        items: { type: "STRING" },
      },
    },
    required: ["canonicalName", "aliases"],
  };

  const prompt = `
Given a possibly messy lab reagent name, return:
1) the most likely canonical chemical compound name
2) up to 4 search aliases that may resolve in PubChem

Input name:
${name}

Return JSON only.
`;

  try {
    const { data } = await callGemini({ prompt, schema, grounded: false });
    const candidates = [data.canonicalName, ...(Array.isArray(data.aliases) ? data.aliases : [])]
      .map((entry) => (entry || "").trim())
      .filter(Boolean);

    return [...new Set(candidates)].slice(0, 5);
  } catch {
    return [];
  }
}

async function resolveCompoundVisual(name) {
  const query = (name || "").trim();
  if (!query) {
    return {
      query,
      resolvedName: null,
      pubchemCid: null,
      imageUrl: null,
      usedAi: false,
    };
  }

  if (likelyNotSingleCompound(query)) {
    return {
      query,
      resolvedName: null,
      pubchemCid: null,
      imageUrl: null,
      usedAi: false,
    };
  }

  const directCandidates = resolutionCandidates(query);
  for (const candidate of directCandidates) {
    const directCid = await resolvePubChemCidByName(candidate);
    if (directCid) {
      return {
        query,
        resolvedName: candidate,
        pubchemCid: directCid,
        imageUrl: `${pubchemApiUrl}/compound/cid/${directCid}/PNG?image_size=large`,
        usedAi: false,
      };
    }
  }

  const candidates = await aiCompoundCandidates(query);
  for (const candidate of candidates) {
    if (tokenSimilarity(query, candidate) < 0.45) {
      continue;
    }

    const candidateCid = await resolvePubChemCidByName(candidate);
    if (candidateCid) {
      return {
        query,
        resolvedName: candidate,
        pubchemCid: candidateCid,
        imageUrl: `${pubchemApiUrl}/compound/cid/${candidateCid}/PNG?image_size=large`,
        usedAi: true,
      };
    }
  }

  for (const candidate of [...directCandidates, ...candidates]) {
    const imageUrl = await resolvePubChemImageByName(candidate);
    if (imageUrl) {
      return {
        query,
        resolvedName: candidate,
        pubchemCid: null,
        imageUrl,
        usedAi: candidates.includes(candidate),
      };
    }
  }

  return {
    query,
    resolvedName: candidates[0] || null,
    pubchemCid: null,
    imageUrl: null,
    usedAi: candidates.length > 0,
  };
}

function hypothesisParseFallback(hypothesis) {
  const domain = detectDomain(hypothesis);
  const lower = hypothesis.toLowerCase();

  if (/(gold nanoparticle|nanoparticle|aunp|turkevich|trisodium citrate|chloroauric|haucl4|citrate-to-gold)/.test(lower)) {
    return {
      hypothesis,
      intervention: "Turkevich synthesis using trisodium citrate as reducing/capping agent",
      subject: "Aqueous HAuCl4 solution under reflux",
      outcome: "Gold nanoparticle size distribution and colloidal stability",
      threshold: "Mean particle diameter 15-20 nm with PDI <= 0.20",
      mechanism: "Citrate-to-gold ratio controls nucleation burst and subsequent growth kinetics",
      control: "Fixed citrate-to-gold baseline ratio (e.g., 3:1 molar) with identical temperature and mixing",
      domain: "Nanomaterials Synthesis",
    };
  }

  const inferredIntervention =
    /(crispr|cas9|grna|sgRNA)/.test(lower)
      ? "CRISPR-Cas9 perturbation with target-specific guide RNA"
      : /(inhibitor|agonist|compound|drug|treatment)/.test(lower)
        ? "Primary treatment condition extracted from hypothesis"
        : "Primary intervention extracted from hypothesis";

  const inferredOutcome =
    /(viability|survival)/.test(lower)
      ? "Cell viability change vs matched control"
      : /(expression|rna|transcript|protein)/.test(lower)
        ? "Target molecular readout change vs matched control"
        : /(size|diameter|nanometer|nm)/.test(lower)
          ? "Particle size and distribution vs target threshold"
          : "Primary measured outcome";

  return {
    hypothesis,
    intervention: inferredIntervention,
    subject: domain.project,
    outcome: inferredOutcome,
    threshold: "See hypothesis threshold",
    mechanism: "Mechanistic explanation stated or implied by the hypothesis",
    control: "Matched control arm without the intervention",
    domain: domain.name,
  };
}

function stripTags(text = "") {
  return text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function parseRichText(value = "") {
  if (!value) {
    return "";
  }

  try {
    const parsed = JSON.parse(value);
    const blocks = Array.isArray(parsed?.blocks) ? parsed.blocks : [];
    return blocks
      .map((block) => block?.text || "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  } catch {
    return stripTags(value);
  }
}

function abstractFromInvertedIndex(index) {
  if (!index || typeof index !== "object") {
    return "";
  }

  const positioned = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const position of positions) {
      positioned[position] = word;
    }
  }

  return positioned.filter(Boolean).join(" ");
}

function slugCatalog(label = "") {
  return label
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 16) || "CUSTOM";
}

function keywordSupplier(label = "") {
  const lower = label.toLowerCase();

  if (/(hela|cell|atcc)/.test(lower)) return "ATCC";
  if (/(sporomusa|dsmz|microbe|culture)/.test(lower)) return "DSMZ";
  if (/(antibody|crp|viability|thermo|elisa)/.test(lower)) return "Thermo Fisher";
  if (/(trehalose|dmso|fitc|dextran|sigma)/.test(lower)) return "Sigma-Aldrich";
  if (/(primer|probe|oligo|qpcr)/.test(lower)) return "IDT";
  if (/(kit|assay|enzyme)/.test(lower)) return "Thermo Fisher";
  if (/(buffer|pbs|tris|hepes|salt|chloride|sulfate)/.test(lower)) return "VWR / Fisher Scientific";
  return "Primary scientific supplier";
}

function keywordCost(label = "") {
  const lower = label.toLowerCase();

  if (/(cell|culture|animal|mice|reactor)/.test(lower)) return 420;
  if (/(antibody|assay|kit|viability|electrode)/.test(lower)) return 220;
  if (/(trehalose|dmso|buffer|dextran|reagent)/.test(lower)) return 85;
  return 160;
}

function inferCatalogNumber(label = "", supplier = "", compound = null) {
  const lower = label.toLowerCase();
  if (/trehalose/.test(lower)) return supplier.includes("Sigma") ? "T0167" : "TREHALOSE-25G";
  if (/\bdmso\b|dimethyl sulfoxide/.test(lower)) return supplier.includes("Sigma") ? "D2650" : "DMSO-100ML";
  if (/fitc-dextran/.test(lower)) return supplier.includes("Sigma") ? "FD4" : "FITC-DEXTRAN-4K";
  if (/antibody/.test(lower)) return supplier.includes("Thermo") ? "MA1-82376" : "ANTIBODY-100UG";
  if (/hela|cell/.test(lower)) return supplier.includes("ATCC") ? "CCL-2" : "CELL-LINE-1";
  if (/sporomusa/.test(lower)) return supplier.includes("DSMZ") ? "DSM-2662" : "MICROBE-1";
  if (compound?.cid) return `CID-${compound.cid}`;
  return `${slugCatalog(label)}-${Math.floor(100 + Math.random() * 900)}`;
}

function inferQuantity(label = "", index = 0, compound = null) {
  const lower = label.toLowerCase();

  if (/(hela|cell|culture|mice|mouse|sporomusa|bacteria|microbe)/.test(lower)) return "1 lot";
  if (/(antibody|kit|assay)/.test(lower)) return "1 kit";
  if (/fitc-dextran/.test(lower)) return "1 g";
  if (/(trehalose|sucrose|glucose|salt|buffer|reagent)/.test(lower)) return "500 g";
  if (/(dmso|ethanol|methanol|solvent)/.test(lower)) return "500 mL";
  if (/(co2|carbon dioxide)/.test(lower)) return "1 cylinder";
  if (/(electrode|reactor|substrate)/.test(lower)) return index === 0 ? "1 setup" : "1 unit";

  if (compound?.molecularWeight && compound.molecularWeight < 300) return "100 g";
  return index === 0 ? "1 lot" : "1 unit";
}

function inferLeadTime(label = "", supplier = "") {
  const lower = label.toLowerCase();
  const s = supplier.toLowerCase();

  if (/(owned|in lab)/.test(lower)) return "in lab";
  if (/(atcc|dsmz)/.test(s) || /(cell|culture|mice|mouse|sporomusa)/.test(lower)) return "5-9 d";
  if (/(antibody|kit|assay|electrode)/.test(lower)) return "3-6 d";
  if (/(trehalose|dmso|dextran|buffer|reagent|co2)/.test(lower)) return "2-5 d";
  return "3-7 d";
}

function inferStatus(label = "", index = 0, supplier = "") {
  const lower = label.toLowerCase();
  if (/(buffer|pbs|water|dmso|trehalose|salt)/.test(lower)) return "in-stock";
  if (/(owned|in lab)/.test(lower)) return "owned";
  if (/atcc|dsmz/i.test(supplier)) return "order";
  return index === 0 ? "order" : index === 1 ? "in-stock" : "order";
}

function inferUnitCost(label = "", compound = null, supplier = "") {
  const base = keywordCost(label);
  const lower = label.toLowerCase();

  // Small molecules with known molecular data are often lower-cost commodity reagents.
  if (compound?.molecularWeight && compound.molecularWeight < 250 && /(sigma|vwr|fisher|primary scientific)/i.test(supplier)) {
    return Math.max(35, Math.round(base * 0.7));
  }
  if (/(cell|culture|mice|mouse|sporomusa)/.test(lower)) return Math.max(base, 380);
  if (/(antibody|kit|assay|electrode)/.test(lower)) return Math.max(base, 190);
  return base;
}

function inferPriceRange(label = "", unitCostUsd = 0, supplier = "") {
  const lower = label.toLowerCase();
  const s = supplier.toLowerCase();

  let spread = 0.25;
  if (/(atcc|dsmz)/.test(s) || /(cell|culture|mice|mouse|sporomusa)/.test(lower)) spread = 0.35;
  if (/(buffer|salt|dmso|trehalose|ethanol|methanol|water)/.test(lower)) spread = 0.18;
  if (/(antibody|kit|assay|electrode)/.test(lower)) spread = 0.3;

  const minUsd = Math.max(10, Math.round(unitCostUsd * (1 - spread)));
  const maxUsd = Math.max(minUsd + 5, Math.round(unitCostUsd * (1 + spread)));
  return { minUsd, maxUsd };
}

function inferConfidence(label = "", compound = null, supplier = "") {
  const lower = label.toLowerCase();
  const hasPubChem = Boolean(compound?.cid);
  const specialized = /(atcc|dsmz)/i.test(supplier) || /(cell|culture|mice|mouse|sporomusa|antibody|kit|assay)/.test(lower);

  const sourcingConfidence = hasPubChem || /(sigma|thermo|fisher|idt|vwr|atcc|dsmz)/i.test(supplier) ? "medium" : "low";
  const priceConfidence = specialized ? "low" : hasPubChem ? "medium" : "low";
  return { sourcingConfidence, priceConfidence };
}

function inferMaterialCandidates(parsed, hypothesis, evidencePack) {
  const protocolMaterialTerms = evidencePack.items
    .filter((item) => item.source === "protocols.io" && item.protocolMaterials)
    .flatMap((item) =>
      item.protocolMaterials
        .split(/[.;\n]/)
        .map((line) => line.trim())
        .filter((line) => line.length > 4 && line.length < 80),
    );

  const text = `${hypothesis} ${parsed.intervention || ""} ${parsed.control || ""} ${parsed.outcome || ""} ${evidencePack.items
    .map((item) => item.title)
    .join(" ")}`.toLowerCase();
  const candidates = [];
  const seen = new Set();

  function pushCandidate(name) {
    const normalized = name.trim();
    if (!normalized) {
      return;
    }
    if (isGenericNonCompoundLabel(normalized)) {
      return;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    candidates.push(normalized);
  }

  const knownPatterns = [
    { pattern: /trehalose/, label: "Trehalose" },
    { pattern: /\bdmso\b/, label: "DMSO, cell culture grade" },
    { pattern: /\bhela\b/, label: "HeLa cells" },
    { pattern: /c-reactive protein|\bcrp\b/, label: "C-reactive protein target" },
    { pattern: /anti-?crp antibody|crp antibod/, label: "Anti-CRP antibody" },
    { pattern: /electrochemical biosensor|paper-based electrochemical biosensor/, label: "Paper-based electrochemical biosensor substrate" },
    { pattern: /lactobacillus rhamnosus gg/, label: "Lactobacillus rhamnosus GG" },
    { pattern: /fitc-dextran/, label: "FITC-dextran" },
    { pattern: /claudin-1/, label: "Claudin-1 antibody" },
    { pattern: /occludin/, label: "Occludin antibody" },
    { pattern: /sporomusa ovata/, label: "Sporomusa ovata culture" },
    { pattern: /carbon dioxide|\bco2\b/, label: "Carbon dioxide" },
    { pattern: /acetate/, label: "Acetate assay kit" },
    { pattern: /cathode/, label: "Cathode electrode assembly" },
  ];

  for (const entry of knownPatterns) {
    if (entry.pattern.test(text)) {
      pushCandidate(entry.label);
    }
  }

  protocolMaterialTerms.forEach((term) => pushCandidate(term));

  [parsed.intervention, parsed.subject, parsed.outcome, parsed.control]
    .map((item) => (item || "").trim())
    .filter(Boolean)
    .forEach((item) => {
      item
        .split(/,|;|\band\b|\bwith\b|\busing\b|\bversus\b|\bvs\b/i)
        .map((part) => part.trim())
        .filter((part) => part.length > 3 && !/^primary |^matched |^standard /i.test(part))
        .forEach(pushCandidate);
    });

  return candidates.slice(0, 6);
}

function evidenceUrl(item) {
  if (item.url) {
    return item.url;
  }

  if (item.doi) {
    return `https://doi.org/${item.doi}`;
  }

  return "";
}

function tokenize(text = "") {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, " ")
        .split(/\s+/)
        .filter((token) => token.length > 3),
    ),
  );
}

function relevanceScore(query, title = "", abstract = "") {
  const queryTokens = tokenize(query);
  const haystack = new Set(tokenize(`${title} ${abstract}`));
  if (queryTokens.length === 0) {
    return 0;
  }

  const overlap = queryTokens.filter((token) => haystack.has(token)).length;
  return overlap / queryTokens.length;
}

function relatedReviewsForHypothesis(hypothesis, experimentId) {
  const domain = detectDomain(hypothesis).name;
  const hypothesisTokens = new Set(tokenize(hypothesis));

  return reviewStore
    .map((review) => {
      const reviewTokens = new Set([
        ...tokenize(review.correction || ""),
        ...tokenize(review.section || ""),
        ...tokenize(review.hypothesis || ""),
        ...((review.tags || []).flatMap((tag) => tokenize(tag))),
      ]);

      let score = 0;
      if (review.experimentId === experimentId) {
        score += 5;
      }
      if (review.domain === domain) {
        score += 3;
      }

      for (const token of hypothesisTokens) {
        if (reviewTokens.has(token)) {
          score += 1;
        }
      }

      return { review, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.review)
    .slice(0, 8);
}

function normalizeEvidence(query, item) {
  const score = relevanceScore(query, item.title, item.abstract);
  return {
    ...item,
    score,
  };
}

async function fetchOpenAlexEvidence(hypothesis) {
  const params = new URLSearchParams({
    search: hypothesis,
    per_page: "6",
    filter: "has_abstract:true",
  });

  if (openAlexMailto) {
    params.set("mailto", openAlexMailto);
  }

  const json = await fetchJson(`${openAlexApiUrl}/works?${params.toString()}`);
  const results = Array.isArray(json?.results) ? json.results : [];

  return results.map((work) =>
    normalizeEvidence(hypothesis, {
      title: work.display_name || "Untitled work",
      abstract: abstractFromInvertedIndex(work.abstract_inverted_index),
      year: work.publication_year || null,
      doi: typeof work.doi === "string" ? work.doi.replace(/^https:\/\/doi.org\//, "") : "",
      url:
        work.primary_location?.landing_page_url ||
        work.primary_location?.pdf_url ||
        work.ids?.doi ||
        work.id ||
        "",
      source:
        work.primary_location?.source?.display_name ||
        work.host_venue?.display_name ||
        "OpenAlex",
      provenance: "openalex",
    }),
  );
}

async function fetchCrossrefEvidence(hypothesis) {
  const params = new URLSearchParams({
    "query.bibliographic": hypothesis,
    rows: "6",
  });

  if (crossrefMailto) {
    params.set("mailto", crossrefMailto);
  }

  const json = await fetchJson(`${crossrefApiUrl}/works?${params.toString()}`);
  const items = Array.isArray(json?.message?.items) ? json.message.items : [];

  return items.map((work) =>
    normalizeEvidence(hypothesis, {
      title: Array.isArray(work.title) ? work.title[0] || "Untitled work" : "Untitled work",
      abstract: stripTags(work.abstract || ""),
      year:
        work.published?.["date-parts"]?.[0]?.[0] ||
        work["published-online"]?.["date-parts"]?.[0]?.[0] ||
        null,
      doi: work.DOI || "",
      url: work.URL || (work.DOI ? `https://doi.org/${work.DOI}` : ""),
      source: Array.isArray(work["container-title"]) ? work["container-title"][0] || "Crossref" : "Crossref",
      provenance: "crossref",
    }),
  );
}

async function fetchProtocolsIoEvidence(hypothesis) {
  if (!protocolsIoApiKey) {
    return [];
  }

  const params = new URLSearchParams({
    filter: "public",
    key: hypothesis,
  });

  const json = await fetchJson(`https://www.protocols.io/api/v3/protocols?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${protocolsIoApiKey}`,
    },
  });

  const items = Array.isArray(json?.items) ? json.items : [];

  return items.map((item) =>
    normalizeEvidence(hypothesis, {
      title: item.title || "Untitled protocol",
      abstract: [parseRichText(item.description), parseRichText(item.before_start), parseRichText(item.materials_text)].filter(Boolean).join(" "),
      year: item.published_on ? new Date(item.published_on * 1000).getFullYear() : null,
      doi: item.doi ? String(item.doi).replace(/^https?:\/\/(dx\.)?doi\.org\//, "") : "",
      url: item.uri ? `https://www.protocols.io/view/${item.uri}` : "https://www.protocols.io/",
      source: "protocols.io",
      provenance: "protocols.io",
      protocolDescription: parseRichText(item.description),
      protocolBeforeStart: parseRichText(item.before_start),
      protocolMaterials: parseRichText(item.materials_text),
    }),
  );
}

async function fetchPubChemCompoundByName(name) {
  const candidates = pubchemNameCandidates(name);
  if (!candidates.length) {
    return null;
  }

  for (const candidate of candidates) {
    const encodedName = encodeURIComponent(candidate);
    const json = await fetchJson(
      `${pubchemApiUrl}/compound/name/${encodedName}/property/Title,MolecularFormula,MolecularWeight,CanonicalSMILES,IUPACName/JSON`,
    ).catch(() => null);

    const properties = json?.PropertyTable?.Properties;
    const property = Array.isArray(properties) ? properties[0] : null;
    if (!property?.CID) {
      continue;
    }

    return {
      cid: property.CID,
      title: property.Title || candidate,
      molecularFormula: property.MolecularFormula || "",
      molecularWeight: typeof property.MolecularWeight === "number" ? property.MolecularWeight : null,
      canonicalSmiles: property.CanonicalSMILES || "",
      iupacName: property.IUPACName || "",
      url: `https://pubchem.ncbi.nlm.nih.gov/compound/${property.CID}`,
    };
  }

  return null;
}

async function retrieveEvidencePack(hypothesis) {
  const settled = await Promise.allSettled([
    fetchOpenAlexEvidence(hypothesis),
    fetchCrossrefEvidence(hypothesis),
    fetchProtocolsIoEvidence(hypothesis),
  ]);

  const combined = settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  const deduped = [];
  const seen = new Set();

  for (const item of combined) {
    const key = (item.doi || item.title || "").toLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(item);
  }

  deduped.sort((left, right) => right.score - left.score || (right.year || 0) - (left.year || 0));

  return {
    items: deduped.slice(0, 8),
    providers: settled.map((result, index) => ({
      name: index === 0 ? "openalex" : index === 1 ? "crossref" : "protocols.io",
      ok: result.status === "fulfilled",
    })),
  };
}

function evidenceNovelty(hypothesis, evidencePack) {
  const top = evidencePack.items.slice(0, 3);
  const topScore = top[0]?.score || 0;

  let signal = "not found";
  if (topScore >= 0.88) {
    signal = "exact match found";
  } else if (topScore >= 0.35 || top.length > 0) {
    signal = "similar work exists";
  }

  const summary =
    signal === "exact match found"
      ? "External literature APIs returned a very close precedent for the intervention, system, and measured outcome, so this plan should be treated as an adaptation rather than a greenfield protocol."
      : signal === "similar work exists"
        ? "Related literature describes adjacent interventions and outcome metrics, but the exact combination in this hypothesis has not been fully replicated. Review the retrieved references to identify the closest prior art."
        : "No close precedent was found in the searched literature, suggesting this may represent a genuinely novel workflow — or retrieval coverage was limited. Validate with a targeted manual search.";

  return {
    signal,
    summary,
    references: top.map((item) => ({
      title: item.title,
      source: item.source,
      uri: evidenceUrl(item),
    })),
  };
}

async function buildMaterialsFromEvidence(parsed, hypothesis, evidencePack) {
  const candidates = inferMaterialCandidates(parsed, hypothesis, evidencePack);
  const compounds = await Promise.all(candidates.map((label) => fetchPubChemCompoundByName(label).catch(() => null)));
  const fallbackSource = evidencePack.items[0]?.source || "Literature evidence";

  return candidates.map((label, index) => {
    const compound = compounds[index];
    const supplier = keywordSupplier(label);
    const status = inferStatus(label, index, supplier);
    const catalogNumber = inferCatalogNumber(label, supplier, compound);
    const unitCostUsd = inferUnitCost(label, compound, supplier);
    const priceRangeUsd = inferPriceRange(label, unitCostUsd, supplier);
    const confidence = inferConfidence(label, compound, supplier);

    return {
      name: compound?.title || label,
      catalogNumber,
      supplier,
      quantity: inferQuantity(label, index, compound),
      unitCostUsd,
      priceRangeUsd,
      sourcingConfidence: confidence.sourcingConfidence,
      priceConfidence: confidence.priceConfidence,
      leadTime: status === "owned" ? "in lab" : inferLeadTime(label, supplier),
      status,
      notes: compound
        ? `Identity verified via PubChem CID ${compound.cid}; procurement profile inferred from supplier class and material type.`
        : `Derived from retrieved literature and hypothesis structure; procurement profile inferred from material class and ${fallbackSource}.`,
      pubchemCid: compound?.cid,
      molecularFormula: compound?.molecularFormula || undefined,
      molecularWeight: compound?.molecularWeight || undefined,
      canonicalSmiles: compound?.canonicalSmiles || undefined,
      iupacName: compound?.iupacName || undefined,
      sourceUri: compound?.url || undefined,
    };
  });
}

async function inferHypothesisCompoundMap(hypothesis, parsed, evidencePack, materials = []) {
  const fallbackMap = [];
  const lowerHyp = (hypothesis || "").toLowerCase();

  if (/(gold nanoparticle|aunp|turkevich|haucl4|trisodium citrate|citrate-to-gold)/.test(lowerHyp)) {
    fallbackMap.push(
      { name: "Hydrogen tetrachloroaurate (HAuCl4)", role: "reagent", rationale: "Gold precursor for Turkevich reduction." },
      { name: "Trisodium citrate", role: "reagent", rationale: "Reducing and capping agent controlling nucleation/growth." },
      { name: "Gold nanoparticles", role: "product", rationale: "Target final colloidal product from the hypothesis." },
    );
  } else {
    fallbackMap.push(
      ...materials.slice(0, 4).map((m) => ({ name: m.name, role: "reagent", rationale: "Material inferred from literature-backed planning." })),
      { name: parsed.outcome || parsed.intervention || "Target outcome species", role: "product", rationale: "Target species implied by parsed hypothesis outcome." },
    );
  }

  let aiMap = [];
  if (geminiApiKey) {
    const schema = {
      type: "OBJECT",
      properties: {
        compounds: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              name: { type: "STRING" },
              role: { type: "STRING", enum: ["reagent", "intermediate", "product"] },
              rationale: { type: "STRING" },
            },
            required: ["name", "role", "rationale"],
          },
        },
      },
      required: ["compounds"],
    };

    const prompt = `
You are extracting a chemistry compound map from a scientific hypothesis.
Return 3-8 concrete compound names with role tags.
Prefer actual chemical entities, not assay steps.

Hypothesis:
${hypothesis}

Parsed fields:
${JSON.stringify({
      intervention: parsed.intervention,
      subject: parsed.subject,
      outcome: parsed.outcome,
      mechanism: parsed.mechanism,
      control: parsed.control,
    })}

Top evidence titles:
${evidencePack.items.slice(0, 4).map((item) => `- ${item.title}`).join("\n")}

Return JSON only.
`;

    try {
      const { data } = await callGemini({ prompt, schema, grounded: false });
      aiMap = Array.isArray(data?.compounds) ? data.compounds : [];
    } catch {
      aiMap = [];
    }
  }

  const merged = [...aiMap, ...fallbackMap]
    .filter((item) => item?.name)
    .map((item) => ({
      name: String(item.name).trim(),
      role: ["reagent", "intermediate", "product"].includes(item.role) ? item.role : "reagent",
      rationale: String(item.rationale || "").trim(),
    }));

  const deduped = [];
  const seen = new Set();
  for (const item of merged) {
    const key = item.name.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(item);
  }

  const enriched = await Promise.all(
    deduped.slice(0, 10).map(async (item) => {
      const pubchem = await fetchPubChemCompoundByName(item.name).catch(() => null);
      return {
        name: pubchem?.title || item.name,
        role: item.role,
        rationale: item.rationale,
        pubchemCid: pubchem?.cid || undefined,
        molecularFormula: pubchem?.molecularFormula || undefined,
        molecularWeight: pubchem?.molecularWeight || undefined,
        iupacName: pubchem?.iupacName || undefined,
        sourceUri: pubchem?.url || undefined,
      };
    }),
  );

  return enriched;
}

/** Return a chemically meaningful quantity string for a protocol step */
function stepQuantity(label = "", units = "") {
  const lower = label.toLowerCase();
  if (/(trehalose|sucrose|glucose|sugar|disaccharide)/.test(lower))
    return "50 mg (0.146 mmol) dissolved in PBS";
  if (/(dmso|dimethyl)/.test(lower))
    return "10 µL (100% v/v stock), diluted to 10% in medium";
  if (/(antibody|anti-|igG)/.test(lower))
    return "10 µg in 100 µL PBS, 1 µg/mL working concentration";
  if (/(3-mercapto|thiol|mpa|linker)/.test(lower))
    return "1 mM in ethanol (5 mg dissolved in 50 mL EtOH)";
  if (/(ferrocene|redox)/.test(lower))
    return "5 mM in PBS (1.86 mg in 2 mL)";
  if (/fitc-dextran/.test(lower))
    return "1 mg/mL in HBSS (10 mg dissolved in 10 mL)";
  if (/(co2|carbon dioxide)/.test(lower))
    return "30 mL/min sparged at 1 atm";
  if (/(acetate|acetic acid)/.test(lower))
    return "50 mM standard in ultrapure water";
  if (/(edc|nhs|coupling)/.test(lower))
    return "EDC 0.4 mg/mL + Sulfo-NHS 0.1 mg/mL in MES buffer pH 6.0";
  if (/(electrode|spe|screen|carbon)/.test(lower))
    return "1 unit; clean with 0.5 M H2SO4 cyclic voltammetry 10 cycles";
  if (/(buffer|pbs|hbss|tris)/.test(lower))
    return "1× PBS pH 7.4, 500 µL";
  if (/(cell|culture|hela|lrgg)/.test(lower))
    return "1 × 10⁶ cells in 500 µL medium";
  if (/(kit|assay|elisa)/.test(lower))
    return "1 kit; follow manufacturer's protocol for sample prep";
  if (/(sporomusa|bacteria|microbe)/.test(lower))
    return "10 mL mid-log phase culture (OD600 ≈ 0.4)";
  return units || "See protocol step detail for specific amounts";
}

/** Map evidence-pack items to steps based on index, cycling through refs */
function refForStep(evidencePack, stepIndex) {
  const items = evidencePack.items;
  if (!items || items.length === 0) return null;
  return items[stepIndex % items.length] || items[0];
}

/** Domain-specific protocol "spine" — returns ordered step templates tuned per experimental family */
function domainProtocolSpine(domainKey, parsed, materials) {
  const assay = parsed.outcome || "primary readout";
  const intervention = parsed.intervention || "primary reagent";
  const control = parsed.control || "matched control";
  const subject = parsed.subject || "experimental system";
  const threshold = parsed.threshold || "expected threshold";
  const mechanism = parsed.mechanism || "";

  /* Helper: first material name matching a keyword */
  const mat = (rx) => materials.find((m) => rx.test(m.name.toLowerCase()))?.name || null;

  const d = domainKey.toLowerCase();
  const hypothesisText = (parsed.hypothesis || "").toLowerCase();
  const contextText = [
    parsed.intervention || "",
    parsed.subject || "",
    parsed.outcome || "",
    parsed.mechanism || "",
    ...materials.map((m) => m.name),
    hypothesisText,
  ].join(" ").toLowerCase();

  /* ── NANOPARTICLE / TURKEVICH SYNTHESIS ── */
  if (/(gold nanoparticle|nanoparticle|aunp|turkevich|trisodium citrate|chloroauric|haucl4|citrate-to-gold|uv-vis.*520)/.test(contextText)) {
    const goldPrecursor = mat(/(haucl4|chloroauric|gold chloride|tetrachloroaurate)/) || "HAuCl4·3H2O";
    const citrate = mat(/(trisodium citrate|sodium citrate|citrate)/) || "trisodium citrate";
    const reducer = mat(/(ascorbic|borohydride|nabh4|reducing)/) || citrate;
    return [
      {
        title: "Define target size window and experimental matrix",
        detail: `Set objective window to 15-20 nm mean diameter and define citrate-to-gold ratio matrix before wet work. Use at least 5 ratio conditions (e.g., 1.5:1, 2.0:1, 2.5:1, 3.0:1, 3.5:1 mol/mol) with n >= 3 replicates each. Lock stirring speed, total volume, and heating profile to isolate ratio effects on nucleation-growth balance.`,
        quantity: "1 design matrix, 5 ratio points, n >= 3 per point",
        duration: "120m",
        riskLevel: "med",
        riskNote: "If only one ratio is tested, size-control claim is not defensible.",
        validationChecks: ["Ratio matrix documented before synthesis run.", "Target acceptance criteria defined (15-20 nm, PDI <= 0.20)."],
        decisionGate: "Do not start synthesis until the ratio matrix and acceptance criteria are approved.",
        stepMaterials: [goldPrecursor, citrate, "Ultrapure water", "Calibrated pipettes"],
        safetyConstraints: ["Use splash goggles and nitrile gloves when handling gold salts.", "Prepare all solutions in clean glassware to avoid nucleation artefacts."],
        rationale: "A pre-specified matrix is required to claim that citrate ratio drives size control rather than uncontrolled process drift.",
      },
      {
        title: `Prepare precursor and reductant stocks (${goldPrecursor}, ${reducer})`,
        detail: `Prepare fresh aqueous stock of ${goldPrecursor} (e.g., 1 mM) and ${reducer} at controlled concentration. Filter solutions (0.22 µm) if particulates are present. Equilibrate both to the same starting temperature to minimise induction-time variability.`,
        quantity: `${goldPrecursor} 1 mM stock, ${reducer} stock per matrix requirements`,
        duration: "60m",
        riskLevel: "med",
        riskNote: "Concentration errors here propagate directly into wrong final size distribution.",
        validationChecks: ["Stock concentration cross-checked by mass and final volume.", "No visible particulates in prepared stocks."],
        decisionGate: "Proceed only if both stock solutions are clear and concentration-verified.",
        stepMaterials: [goldPrecursor, reducer, "Volumetric flasks", "0.22 µm filters"],
        safetyConstraints: ["Avoid skin contact with gold precursor solutions.", "Label all stock solutions with molarity and preparation time."],
        rationale: "Accurate stock preparation is the dominant determinant of reproducibility in Turkevich synthesis.",
      },
      {
        title: "Execute Turkevich reaction at controlled reflux",
        detail: `Heat precursor solution to gentle reflux under constant stirring, then add citrate rapidly for each planned ratio condition. Start timing at citrate addition and keep thermal conditions constant across all batches. Observe colour transition (pale yellow -> wine red) as a qualitative nucleation indicator.`,
        quantity: "One reaction vessel per ratio condition",
        duration: "90m",
        riskLevel: "high",
        riskNote: "Addition timing and thermal instability are primary causes of off-target nanoparticle sizes.",
        validationChecks: ["Document exact addition timestamp for each batch.", "Colour transition observed within expected window."],
        decisionGate: "Repeat batch if temperature drift exceeds ±2°C during nucleation window.",
        stepMaterials: [goldPrecursor, citrate, "Heating/stirring plate", "Reflux setup"],
        safetyConstraints: ["Use heat-resistant gloves while handling reflux glassware.", "Do not leave reflux unattended."],
        rationale: "Nucleation and early growth kinetics during this step define final particle diameter.",
      },
      {
        title: "Quench, stabilise, and age colloids before readout",
        detail: `After reaction endpoint, cool samples in a controlled manner and equilibrate to room temperature. Hold samples for a fixed aging window before characterization to avoid comparing non-equilibrated colloids. If needed, dilute to constant optical density range before UV-Vis.`,
        quantity: "All batches normalised to consistent readout concentration",
        duration: "60m",
        riskLevel: "low",
        riskNote: "Non-uniform post-reaction aging can shift apparent peak shape and inferred size.",
        validationChecks: ["All batches cooled and aged under identical timing.", "No visible aggregation/precipitation before characterization."],
        stepMaterials: ["Ice bath", "Storage vials", "Ultrapure water"],
        safetyConstraints: ["Use clean, particle-free storage containers.", "Avoid vigorous vortexing that may induce aggregation."],
        rationale: "Standardized post-synthesis handling prevents analytical bias between ratio conditions.",
      },
      {
        title: "Characterize particle size and dispersity",
        detail: `Measure UV-Vis spectra (look for LSPR peak around ~520 nm), DLS hydrodynamic diameter, and if available TEM for core-size confirmation. Compute mean size and PDI per condition. Cross-check that DLS trends and UV-Vis peak shifts are directionally consistent with citrate ratio changes.`,
        quantity: "UV-Vis + DLS for every batch; TEM for representative conditions",
        duration: "180m",
        riskLevel: "high",
        riskNote: "Using a single readout can misclassify aggregation as true size increase.",
        validationChecks: ["Per-condition mean diameter and PDI calculated.", "UV-Vis peak position and width logged for all runs.", "At least one orthogonal size method confirms trend."],
        decisionGate: "Advance only if at least one ratio condition meets 15-20 nm and PDI <= 0.20.",
        stepMaterials: ["UV-Vis spectrophotometer", "DLS instrument", "TEM access (optional)"],
        safetyConstraints: ["Follow instrument-specific laser and optical safety guidance.", "Use matched cuvettes and clean thoroughly between samples."],
        rationale: "The hypothesis claim is specifically about size control, so quantitative size/dispersity readouts are mandatory.",
      },
      {
        title: "Run control comparison and robustness checks",
        detail: `Compare intervention matrix against baseline control ratio under identical conditions. Perform repeat synthesis on a different day to quantify batch-to-batch reproducibility. Evaluate whether size-control conclusion holds across repeats and not only in a single run.`,
        quantity: "Minimum 2 independent synthesis days",
        duration: "120m",
        riskLevel: "med",
        riskNote: "Single-day success can overstate controllability due to hidden environmental factors.",
        validationChecks: ["Control ratio included in every run.", "Inter-day variance reported for key ratio conditions."],
        decisionGate: "Do not claim robust size control unless trend reproduces across independent runs.",
        stepMaterials: ["Control ratio batch records", "Repeat-run QC template"],
        safetyConstraints: ["Use the same SOP revision across repeat runs.", "Document any process deviations before interpretation."],
        rationale: "Reproducibility is required to move from exploratory chemistry to operational protocol.",
      },
      {
        title: "Analyze data and decide optimal citrate-to-gold operating window",
        detail: `Aggregate all characterization data, fit ratio-versus-size response, and identify operating window that reliably delivers 15-20 nm nanoparticles. Report confidence interval, failure cases, and practical tolerance bounds for future runs.`,
        quantity: "1 analysis package with ratio-size model and decision memo",
        duration: "120m",
        riskLevel: "low",
        riskNote: "Overfitting sparse data can produce false precision in recommended ratio windows.",
        validationChecks: ["Final recommended ratio window documented.", "Acceptance and rejection criteria for future batches defined."],
        decisionGate: "Promote to validated protocol only if recommended window meets target size across repeats.",
        stepMaterials: ["Analysis workbook", "Statistical script/notebook"],
        safetyConstraints: ["Archive raw files (UV-Vis, DLS, TEM) before reporting.", "Keep immutable copy of final decision report."],
        rationale: "This step converts exploratory synthesis results into a reusable scientist-facing protocol.",
      },
    ];
  }

  /* ── BIOSENSOR / DIAGNOSTICS ── */
  if (/(diagnostic|biosensor|crp|elisa|antibody|immunoassay|point-of-care|paper|strip)/.test(d)) {
    const electrode = mat(/(electrode|spe|screen|carbon|ito)/) || "screen-printed electrode (SPE)";
    const linker    = mat(/(thiol|mpa|3-mercapto|linker|sam)/) || "3-mercaptopropionic acid (MPA)";
    const antibody  = mat(/(antibody|anti-|igg|fab)/) || "anti-CRP antibody";
    const analyte   = mat(/(crp|analyte|antigen|protein|target)/) || intervention;
    const blocker   = mat(/(bsa|casein|block)/) || "1% BSA in PBS";
    return [
      {
        title:  "Clean and electrochemically activate electrode surface",
        detail: `Polish ${electrode} with 0.05 µm alumina slurry for 30 s, rinse with UHQ water, sonicate 30 s in isopropanol then UHQ water. Electrochemically activate with cyclic voltammetry (−0.4 to +1.6 V vs Ag/AgCl, 10 cycles, 100 mV/s) in 0.5 M H₂SO₄. Dry under N₂ stream. Confirm clean baseline by EIS (Rs, no Faradaic features).`,
        quantity: `${electrode} — 1 unit per assay; 0.5 M H₂SO₄ — 10 mL`,
        duration: "2 h",
        riskLevel: "med",
        riskNote: "Surface cleanliness determines SAM homogeneity and therefore antibody loading capacity. Skipping H₂SO₄ activation reduces sensitivity by ≥ 40%.",
        validationChecks: ["EIS baseline: Rs 50–150 Ω, no distortion at low frequency.", "CV shows oxide-reduction peak at +0.9 V before linker deposition."],
        decisionGate: "Do not proceed to SAM formation if EIS shows anomalous baseline or if Raman/XPS reveals surface contamination.",
      },
      {
        title:  `Form self-assembled monolayer (SAM) with ${linker}`,
        detail: `Immerse cleaned ${electrode} in 1 mM ${linker} in absolute ethanol for 16–18 h at RT in a sealed vial under dark conditions. Rinse 3× with ethanol then 3× with UHQ water. Dry with N₂. SAM formation confirmed by a shift in the Rct (EIS) of > 200 Ω relative to bare electrode.`,
        quantity: `${linker} — 1 mM in 99.9% ethanol, 1 mL per electrode`,
        duration: "16–18 h (overnight)",
        riskLevel: "med",
        riskNote: "Incomplete SAM leads to antibody multilayers and non-specific binding. Ethanol quality is critical.",
        validationChecks: ["EIS Rct shift ≥ 200 Ω vs bare electrode; no pinhole defects.", "Contact angle after SAM formation: 20–30°."],
        decisionGate: "Do not proceed to EDC/NHS coupling if EIS shows insufficient Rct shift or if contact angle is outside expected range.",
      },
      {
        title:  `Conjugate ${antibody} via EDC/NHS carbodiimide coupling`,
        detail: `Activate SAM carboxylate groups with 0.4 mg/mL EDC + 0.1 mg/mL sulfo-NHS in MES buffer (pH 6.0) for 30 min at RT. Remove activation solution, immediately apply ${antibody} at 10 µg/mL in PBS pH 7.4 (100 µL per electrode). Incubate 2 h at RT in humid chamber. Rinse 3× with PBS.`,
        quantity: `EDC 0.4 mg/mL + sulfo-NHS 0.1 mg/mL in MES pH 6.0; ${antibody} 10 µg/mL — 100 µL per electrode`,
        duration: "2.5 h",
        riskLevel: "high",
        riskNote: "EDC/NHS reaction window is narrow (< 15 min between activation and antibody addition). Delay or temperature fluctuation will hydrolyse active esters and abolish coupling.",
        validationChecks: ["FTIR/Raman: amide-II band at 1540 cm⁻¹ should appear post-coupling.", "EIS Rct increases by 0.5–1.5 kΩ relative to SAM electrode."],
        decisionGate: "Reject batch if EIS Rct change is outside 0.5–1.5 kΩ window. Re-activate electrode and repeat.",
      },
      {
        title:  `Block non-specific binding sites with ${blocker}`,
        detail: `Incubate antibody-modified electrode in ${blocker} for 60 min at RT. Rinse 3× with PBS, 3× with sample matrix buffer (e.g. 10× diluted whole blood or serum). This step passivates unreacted NHS esters and hydrophobic surface pockets.`,
        quantity: `${blocker} — 200 µL per electrode; pH 7.4 PBS wash buffer — 5 mL`,
        duration: "1 h",
        riskLevel: "low",
        riskNote: "Insufficient blocking leads to non-specific adsorption in complex matrices (whole blood, serum), inflating apparent signal.",
        validationChecks: ["Baseline EIS reading stable within ±3% over 30 min after blocking.", "Blank sample (0 analyte) shows no measurable current change vs buffer."],
      },
      {
        title:  `Run ${analyte} dose-response (${control} in parallel)`,
        detail: `Apply serial dilutions of ${analyte} (0, 0.1, 0.5, 1, 5, 10, 50, 100 µg/mL) in sample matrix. Incubate 30 min at RT per concentration. Measure by amperometry at −0.1 V vs Ag/AgCl (ferrocene-mediated) or DPV (−0.4 to +0.6 V, 5 mV step, 25 mV amplitude). Record peak current Ip. Run ${control} (buffer blank, non-specific protein) in parallel at every concentration. Primary readout: Δ% Ip vs baseline.`,
        quantity: `${analyte} serial dilutions in 50 µL per measurement; total volume ≈ 0.5 mL`,
        duration: "1 day",
        riskLevel: "high",
        riskNote: `Assay measures ${assay}. Failure modes: drift between replicates (> 15% CV), matrix effects from red blood cells, antibody off-rate causing signal loss at low analyte concentration.`,
        validationChecks: [
          "R² ≥ 0.98 for 4-PL calibration fit.",
          "LOD ≤ stated sensitivity goal from hypothesis.",
          `Contrast between ${control} and highest analyte ≥ 3-fold.`,
        ],
        decisionGate: `Advance to validation only if dose-response R² ≥ 0.98 and LOD meets ${threshold}.`,
      },
      {
        title:  `Validate selectivity and matrix robustness — measure ${assay} in human serum/blood`,
        detail: `Spike ${analyte} at 1 µg/mL (midpoint of linear range) into: (a) PBS, (b) 1:10 diluted human serum, (c) 1:10 diluted whole blood. Record selectivity by testing 10-fold excess of common interferents: IgG, albumin, glucose, urea. Calculate cross-reactivity (< 5% acceptable). Confirm sensor-to-sensor variability across 3 independently fabricated electrodes (inter-electrode CV ≤ 12%).`,
        quantity: "n = 3 electrodes per matrix; ≈ 0.5 mL per matrix",
        duration: "1–2 days",
        riskLevel: "med",
        riskNote: "Real-matrix performance can diverge significantly from buffered calibration. Haematocrit effects and protein crowding are the leading causes of inflated LOD in POC blood tests.",
        validationChecks: [
          "Selectivity: < 5% cross-reactivity to listed interferents.",
          "Inter-electrode CV ≤ 12%.",
          "Recovery in serum/blood matrix: 85–115%.",
        ],
        decisionGate: "Do not claim POC-readiness until whole-blood recovery is confirmed in this range.",
      },
    ];
  }

  /* ── CELL BIOLOGY / CRYOPRESERVATION ── */
  if (/(cell.biology|cryopreserv|hela|post-thaw|freezing|viability|trehalose|dmso)/.test(d) ||
      /(hela|cryoprotectant|post-thaw|freezing medium|trehalose|cell viability)/.test((parsed.intervention + " " + parsed.subject).toLowerCase())) {
    const cells    = mat(/(hela|cell|lrgg|cho|3t3|jurkat)/) || subject;
    const cryoInt  = mat(/(trehalose|dmso|glycerol|pvp|bsa|sucrose)/) || intervention;
    const cryoCtrl = mat(/(dmso|standard|control)/) || control;
    return [
      {
        title:  `Culture and quality-check ${cells} before freezing`,
        detail: `Expand ${cells} in DMEM/F12 + 10% FBS + 1% Pen-Strep at 37°C, 5% CO₂ to 80–90% confluence. Count with haemocytometer (trypan blue exclusion); target viability > 95% before freezing. Passage number must be ≤ 20 to avoid senescence artefacts. Record passage, doubling time, and morphology.`,
        quantity: `${cells} — 2 × 10⁶ cells per cryo-vial; T75 flask per condition`,
        duration: "2–3 days (culture expansion)",
        riskLevel: "high",
        riskNote: "Starting viability < 95% amplifies cryoinjury and creates floor effects that mask treatment differences. Low passage homogeneity is the biggest confound.",
        validationChecks: ["Pre-freeze viability ≥ 95% by trypan blue.", "Passage ≤ 20, morphology normal, no signs of mycoplasma."],
        decisionGate: "Do not freeze cells if pre-freeze viability < 95% or if passage number is > 20.",
      },
      {
        title:  `Prepare cryoprotectant solutions — ${cryoInt} vs ${cryoCtrl}`,
        detail: `Prepare cryoprotectant solutions in serum-free DMEM at ice-cold temperature (0–4°C) to minimise cytotoxicity during preparation: ${cryoInt} at 25 mM, 50 mM, 100 mM, 200 mM; ${cryoCtrl} at 10% v/v (standard). Sterile-filter (0.22 µm). Do not allow solutions to warm to room temperature before cell addition. Confirm osmolality of each solution (expected: PBS baseline ≈ 300 mOsm/kg; each 100 mM trehalose adds ≈ 100 mOsm/kg).`,
        quantity: `${cryoInt}: 50 mg per 1.46 mmol; dissolve in filter-sterilised PBS. ${cryoCtrl}: 10 µL DMSO per 90 µL medium per vial.`,
        duration: "1 h",
        riskLevel: "med",
        riskNote: "Room-temperature ${cryoInt} contact with cells before freezing induces osmotic stress, causing pre-freeze death that won't be distinguished from cryoinjury.",
        validationChecks: ["Osmolality measured: record per condition.", "Solutions sterile; no turbidity or precipitation."],
        decisionGate: "Reject any batch with osmolality > 700 mOsm/kg (hypertonicity risk) or if solution is turbid.",
      },
      {
        title:  "Cryopreserve cells using controlled-rate freezing",
        detail: `Resuspend ${cells} at 2 × 10⁶/mL in each cryoprotectant solution. Dispense 1 mL per cryovial. Place immediately in pre-cooled isopropanol freezing container (Mr. Frosty at 4°C). Transfer to −80°C overnight (≈ −1°C/min cooling rate). Next morning, transfer vials to liquid nitrogen (LN₂, −196°C) vapour phase for long-term storage. Log vial ID, cell line, passage, cryoprotectant, and freeze date.`,
        quantity: "1 cryovial per condition, minimum n = 3 per concentration",
        duration: "1 h hands-on + overnight",
        riskLevel: "high",
        riskNote: "Inconsistent cooling rate is the most common cause of non-reproducibility. Reusing Mr. Frosty without replacing isopropanol changes cooling rate profile by up to 0.4°C/min.",
        validationChecks: ["Mr. Frosty isopropanol filled fresh.", "Transfer to LN₂ within 16–20 h of −80°C placement."],
        decisionGate: "Discard any vials stored > 48 h at −80°C without transfer to LN₂.",
      },
      {
        title:  `Thaw and recover cells — measure post-thaw viability (${assay})`,
        detail: `Thaw vials rapidly in 37°C water bath (< 90 s). Transfer dropwise into 9 mL pre-warmed complete medium to dilute cryoprotectant (avoids osmotic shock). Centrifuge 300 × g, 5 min, 4°C. Discard supernatant. Resuspend pellet in 1 mL fresh medium. Count with haemocytometer; record viability (trypan blue) and live-cell density. Plate 5 × 10⁴ cells/well in 24-well plate for 4 h attachment before functional assays.`,
        quantity: "24-well plate; 1 mL per well; trypan blue 0.4% — 10 µL per 10 µL cell suspension",
        duration: "2 h",
        riskLevel: "med",
        riskNote: "Slow thawing (> 2 min) causes ice recrystallisation and magnifies cryoinjury. DMSO toxicity is significant at room temperature — dilute promptly.",
        validationChecks: [
          "Thaw < 90 s total.",
          "Post-thaw viability recorded for each condition within 30 min of thaw.",
          `Attach and measure ${assay} at 4 h and 24 h post-thaw.`,
        ],
        decisionGate: `Advance to statistical analysis only if ${cryoCtrl} post-thaw viability is within reported literature range (typically 70–85% for 10% DMSO).`,
      },
      {
        title:  `Quantify ${assay} — clonogenic survival and metabolic activity`,
        detail: `Run parallel readouts: (1) Trypan blue live-dead count (immediate); (2) Calcein AM / PI staining (1 µM calcein AM, 2 µM PI, 15 min, 37°C — read by fluorescence plate reader or confocal); (3) CellTiter-Glo ATP luminescence assay (quantitative metabolic proxy). Run ${cryoCtrl} (10% DMSO) and vehicle control (serum-free medium, no cryoprotectant) in parallel. Compare % viability and % recovery across all ${cryoInt} concentrations with one-way ANOVA + Tukey HSD post-hoc.`,
        quantity: "96-well plates for calcein AM / CellTiter-Glo; n ≥ 4 replicates per concentration",
        duration: "1 day",
        riskLevel: "med",
        riskNote: `Trypan blue alone underestimates sub-lethal cryoinjury. ATP assay and calcein AM capture functional recovery better and are more sensitive to dose-dependent effects of ${cryoInt}.`,
        validationChecks: [
          `${cryoCtrl} viability within ±10% of published DMSO benchmark.`,
          "Calcein AM and ATP readouts correlated (R² ≥ 0.9).",
          `Evidence of a significant ${intervention} effect vs ${control} at at least one concentration (p < 0.05).`,
        ],
        decisionGate: `Validate ${threshold} claim only if at least one ${cryoInt} concentration significantly outperforms ${cryoCtrl} on both viability metrics.`,
      },
    ];
  }

  /* ── ELECTROCHEMISTRY / BIOELECTROCHEMICAL / CO2 FIXATION ── */
  if (/(electrochem|bioelectrochem|co2|acetate|sporomusa|cathode|carbon.capture|co₂)/.test(d) ||
      /(co2|acetate|sporomusa|cathode|bioelectrochemical|she|carbon capture)/.test((parsed.intervention + " " + parsed.subject).toLowerCase())) {
    const microbe   = mat(/(sporomusa|bacteria|microbe|strain|culture)/) || subject;
    const substrate = mat(/(co2|carbon dioxide|co₂)/) || "CO₂ (100%, 30 mL/min)";
    const product   = mat(/(acetate|acetic|formate|methane)/) || assay;
    const cathode   = mat(/(electrode|cathode|carbon|graphite|ito|mxene)/) || "carbon felt cathode";
    return [
      {
        title:  `Prepare and condition ${cathode} biocathode`,
        detail: `Pre-treat ${cathode} by oxidative activation: soak in 1 M HNO₃ for 30 min, rinse 5× with UHQ water, then electrochemically condition with chronoamperometry at −1.0 V vs SHE in 50 mM phosphate buffer (pH 6.8) for 2 h. Measure electrochemical surface area (ECSA) by double-layer capacitance (CV, −0.1 to 0.1 V vs OCP, 5–200 mV/s). Record initial open-circuit potential (OCP) and impedance (EIS: 100 kHz – 0.1 Hz, 10 mV RMS).`,
        quantity: `${cathode} — 2 cm² per bioreactor; HNO₃ 1 M — 50 mL`,
        duration: "4 h",
        riskLevel: "med",
        riskNote: "Surface oxygen functional groups are required for bacterial attachment and electron transfer. Untreated carbon shows ECSA ≥ 40% lower and poor biofilm formation.",
        validationChecks: ["ECSA measured, baseline recorded.", "EIS Nyquist plot shows no short-circuit artefacts.", "OCP stable ± 5 mV over 30 min."],
        decisionGate: "Do not inoculate if ECSA < 2 mF/cm² or if electrode shows cracks or delamination.",
      },
      {
        title:  `Inoculate bioreactor with ${microbe} — strict anaerobic protocol`,
        detail: `Prepare ${microbe} mid-log phase culture (OD600 0.35–0.45) in modified DSMZ-311 medium. Sparge culture and bioreactor headspace with CO₂/N₂ (80:20) for 30 min before inoculation to achieve strict anaerobic conditions (< 5 ppm O₂). Transfer 10 mL culture into the working chamber (total volume 100 mL) via gas-tight syringe. Seal all ports. Apply −0.6 V vs SHE immediately to provide electron donor. Maintain 30°C, 100 rpm stirring.`,
        quantity: `${microbe}: 10 mL mid-log culture per bioreactor; ${substrate}: 30 mL/min CO₂/N₂ sparge`,
        duration: "1 h (setup) + 24 h equilibration",
        riskLevel: "high",
        riskNote: "O₂ contamination above 50 ppm is lethal to anaerobes and produces an oxidised cathode surface that reverses electron transfer polarity. This is the highest-risk step.",
        validationChecks: [
          "O₂ level in headspace ≤ 5 ppm (optical O₂ sensor).",
          "OD600 within 0.35–0.45 at inoculation.",
          "Reductive potential applied within 5 min of inoculation.",
        ],
        decisionGate: "Abort experiment if O₂ rises above 50 ppm at any point during inoculation.",
      },
      {
        title:  `Apply cathodic potential and measure ${product} production`,
        detail: `Set chronoamperometry at −0.6 V vs SHE (intervention arm) and −0.3 V vs SHE (reduced-potential control). Collect headspace gas samples (0.5 mL) every 4 h by gas-tight syringe for GC-FID/TCD analysis of CH₄, H₂, CO₂. Collect liquid aliquots (500 µL) every 6 h for HPLC (ion-exclusion column, 0.005 M H₂SO₄ mobile phase, 0.6 mL/min, RID detector) to quantify ${product} and any by-products (formate, ethanol). Record current density j (mA/cm²) continuously.`,
        quantity: "Bioreactor working volume 100 mL; GC headspace sample 0.5 mL; HPLC sample 500 µL",
        duration: "72 h continuous",
        riskLevel: "high",
        riskNote: `Under-potential (< −0.55 V vs SHE) favours H₂ evolution and suppresses acetogenesis. Over-potential (< −0.8 V vs SHE) causes abiotic H₂ release that confounds metabolic attribution of ${product}.`,
        validationChecks: [
          "Current density stable in range −1 to −5 mA/cm² after 12 h lag.",
          `HPLC detects ${product} ≥ 0.1 mM at 24 h.`,
          "No significant H₂ by-product if acetogenesis is the target pathway.",
        ],
        decisionGate: `Halt if current density drops below −0.2 mA/cm² by 24 h (biofilm failure). Do not claim acetogenesis if GC detects > 20% H₂ in headspace.`,
      },
      {
        title:  "Characterise biofilm and electron-transfer mechanism",
        detail: `At experiment end (72 h), remove ${cathode} from bioreactor under strict anaerobic transfer. Prepare triplicate samples for: (a) SEM/confocal fluorescence (LIVE/DEAD BacLight) — biofilm coverage and morphology; (b) EIS in fresh medium (no bacteria) — record change in Rct relative to abiotic baseline (should decrease for conductive biofilm); (c) Protein assay (BCA) — total biofilm protein per cm². Extract RNA from biofilm portion for RT-qPCR of key genes (acs, cooS) to confirm active metabolic pathway.`,
        quantity: "3× electrode cross-sections; BCA assay kit (50 µL per well); RNA extraction kit",
        duration: "1–2 days",
        riskLevel: "med",
        riskNote: "Correlation of biofilm coverage with current density and product titre is the mechanistic evidence. Without this data, the ${product} production cannot be attributed to the biofilm.",
        validationChecks: [
          "SEM shows biofilm cells on cathode, not in suspension.",
          "EIS Rct reduced vs abiotic (evidence of direct electron transfer).",
          "acs/cooS expression confirmed by RT-qPCR.",
        ],
        decisionGate: `Do not report ${product} yield as biologically attributable without RT-qPCR or EIS evidence of active biofilm.`,
      },
      {
        title:  `Calculate Faradaic efficiency and benchmark ${assay} against literature`,
        detail: `Faradaic efficiency (FE) = (n × F × n_product) / Q_total, where n is the number of electrons per mole of ${product} (8 for acetate), F = 96485 C/mol, n_product = moles of ${product} formed (from HPLC), Q_total = total charge passed (from integrating chronoamperometry). Compare against ${threshold}. Run statistical analysis (Student's t-test or Mann-Whitney if non-normal) comparing FE and product titre between ${intervention} and ${control} arms. Report with 95% CI.`,
        quantity: "All data collected from steps 3–4",
        duration: "4 h (analysis)",
        riskLevel: "low",
        riskNote: "Faradaic efficiency conflates electrode area, inoculum density, and applied potential. Report all three alongside FE to allow cross-study comparison.",
        validationChecks: [
          `FE meets or exceeds ${threshold}.`,
          "Statistical test result reported with n and p-value.",
          "Comparison to SHE control shows significant improvement (p < 0.05).",
        ],
        decisionGate: `Do not report benchmark claims without reporting absolute current density, working electrode area, and inoculum OD600 alongside FE.`,
      },
    ];
  }

  /* ── IN VIVO GUT HEALTH ── */
  if (/(in.vivo|gut|intestinal|mouse|mice|c57bl|fitc|permeability|probiotic|barrier)/.test(d) ||
      /(mouse|mice|c57bl|intestinal|fitc-dextran|in vivo|animal)/.test((parsed.intervention + " " + parsed.subject).toLowerCase())) {
    const probiotic = mat(/(probiotic|bacterium|lacto|bifido|strain|supplement)/) || intervention;
    const marker    = mat(/(fitc|dextran|fluorescein|marker|tracer)/) || "FITC-dextran (4 kDa)";
    const strain    = (parsed.subject.match(/(c57bl|balb|nude|nod|cd-1)/i) || [""])[0] || "C57BL/6J";
    return [
      {
        title:  `Animal ethics approval, acclimatisation, and group randomisation`,
        detail: `Confirm institutional IACUC/ethics approval before any animal procedure. House ${strain} mice (n = 6–8 per group) in IVC cages, 12 h light-dark cycle, ad libitum food and water, 22 ± 2°C. Acclimatise for 7 days before any intervention. Randomise allocation into: (1) ${probiotic} arm, (2) ${control} arm, (3) sham/vehicle control. Record body weight on days 0, 3, 7, 14. Blind the ${assay} measurer to treatment allocation.`,
        quantity: `n ≥ 6 mice per arm; total ≥ 18 animals; acclimatisation 7 days`,
        duration: "7 days acclimatisation",
        riskLevel: "high",
        riskNote: "Underpowered studies (n < 5 per group) cannot resolve FITC-dextran permeability differences above 30%. Randomisation failure is the primary source of bias in gut permeability studies.",
        validationChecks: [
          "IACUC/ethics approval document on file.",
          "Body weights between groups: non-significant at day 0.",
          "Blinded measurer confirmed.",
        ],
        decisionGate: "Do not begin experimental intervention without confirmed ethics approval and blinded allocation.",
      },
      {
        title:  `Administer ${probiotic} via oral gavage — daily dosing schedule`,
        detail: `Prepare ${probiotic} dose in PBS or appropriate vehicle (1 × 10⁹ CFU/mL, 200 µL per animal gavage). Administer once daily for 14 days via ball-tipped gavage needle (22G, 38 mm). Control arm receives isocaloric PBS vehicle (200 µL). Weigh animals every 3 days. Record gavage compliance (any reflux or distress). At day 14, fast animals for 4 h before ${marker} gavage to standardise GI transit time.`,
        quantity: `${probiotic}: 1 × 10⁹ CFU per animal per day, freshly prepared; total 14 doses`,
        duration: "14 days treatment",
        riskLevel: "med",
        riskNote: "CFU counts must be validated on the day of gavage — stored cultures drift by > 1 log within 24 h if not maintained at correct temperature/atmosphere.",
        validationChecks: [
          "CFU count verified on plate count agar on each gavage day ± 0.3 log.",
          "No mortality or body weight loss > 10% in any animal.",
          "Positive and negative control groups maintained identically.",
        ],
        decisionGate: "Replace any animal with > 10% body weight loss from baseline (discuss with veterinary team). Do not extrapolate dosing day results to end-of-study if > 2 animals per group drop out.",
      },
      {
        title:  `Intestinal permeability assay — oral ${marker} gavage and serum collection`,
        detail: `On day 14, after 4 h fast: gavage each fasted animal with ${marker} at 44 mg/kg body weight in sterile PBS (200 µL). After 4 h, collect blood by cardiac puncture under terminal anaesthesia (isoflurane, 3%). Centrifuge blood (2000 × g, 10 min, 4°C) to obtain serum. Measure serum FITC fluorescence (ex/em 485/528 nm) in 96-well plate against standard curve (0–2000 ng/mL FITC-dextran in naive mouse serum). Express as ng/mL FITC-dextran in serum.`,
        quantity: `${marker}: 44 mg/kg per mouse ≈ 8 mg per 200 µL gavage (20 g mouse); serum volume ≤ 50 µL per animal`,
        duration: "4 h post-gavage + 1 h sample processing",
        riskLevel: "high",
        riskNote: "Timing is critical: FITC-dextran serum concentration peaks at 4 h post-gavage. Inconsistency in collection timing is the chief source of inter-animal variability.",
        validationChecks: [
          "Standard curve R² ≥ 0.99.",
          "Collection time: 4.0 ± 0.25 h post-gavage for all animals.",
          "Naive (untreated) positive-permeability control (DSS challenge if included) shows elevated FITC signal.",
        ],
        decisionGate: `Advance to statistical comparison only if ${control} arm serum FITC is in expected range (typically 150–400 ng/mL for naive C57BL/6 at 4 h).`,
      },
      {
        title:  "Histology and tight-junction protein expression (secondary endpoint)",
        detail: `Harvest 2 cm sections of proximal colon and jejunum from all animals. Fix in 10% neutral buffered formalin (NBF) for 24 h, paraffin-embed, and section (5 µm). Stain with H&E (morphology), Alcian Blue/PAS (goblet cells, mucus layer), and immunofluorescence for tight-junction proteins: ZO-1 (1:200), Occludin (1:100), Claudin-3 (1:150). Image at 200× magnification; score villus height-to-crypt depth ratio and ZO-1 continuity by blinded scorer.`,
        quantity: "n = all animals; paraffin sections per animal: 6; primary antibodies: 3",
        duration: "2–3 days (histology workflow)",
        riskLevel: "med",
        riskNote: "Histological changes lag 2–5 days behind functional permeability changes. ZO-1 fragment distribution is a more sensitive early marker than villus height alone.",
        validationChecks: [
          "Blinded scoring confirmed.",
          "ZO-1 continuity scored semi-quantitatively (0–3 scale).",
          "Goblet cell density quantified per villus cross-section.",
        ],
        decisionGate: "Histology requires a minimum of 4 complete tissue cross-sections per animal for valid scoring.",
      },
      {
        title:  `Statistical analysis — compare ${assay} between ${intervention} and ${control}`,
        detail: `Primary endpoint: serum FITC-dextran (ng/mL). Perform Shapiro-Wilk normality test per group. If normal: unpaired two-tailed Student's t-test (${probiotic} vs ${control}). If non-normal: Mann-Whitney U. Report mean ± SEM, actual p-value, effect size (Cohen's d), and 95% CI. Secondary endpoint: ZO-1 continuity score — use same approach. Power analysis post-hoc: was the study powered to detect a 30% reduction in FITC at α = 0.05, β = 0.2?`,
        quantity: "All collected serum + histological data",
        duration: "4 h (analysis)",
        riskLevel: "low",
        riskNote: "Without reporting effect size alongside p-value, the clinical relevance of gut barrier improvement cannot be assessed.",
        validationChecks: [
          "Normality test run and result reported.",
          "Effect size and 95% CI reported alongside p-value.",
          `Stated hypothesis threshold (${threshold}) confirmed met or not met with exact FITC values.`,
        ],
        decisionGate: `Report ${threshold} as met only if both the serum FITC reduction is statistically significant (p < 0.05) and the effect size is clinically meaningful (Cohen's d ≥ 0.5).`,
      },
    ];
  }

  /* ── GENERIC MOLECULAR BIOLOGY / FALLBACK ── */
  return null; // caller will use the standard generic flow
}

function buildDynamicSteps(parsed, evidencePack, materials = []) {
  const assay        = parsed.outcome || "primary readout";
  const intervention = parsed.intervention || "the primary reagent";
  const control      = parsed.control || "matched control";
  const subject      = parsed.subject || "experimental system";
  const mechanism    = parsed.mechanism || "";
  const domainKey    = (parsed.domain || "").toLowerCase();

  const protocolRef = evidencePack.items.find((item) => item.source === "protocols.io");

  /* ── Try domain-specific spine first ── */
  const domainStepTemplates = domainProtocolSpine(domainKey, parsed, materials);

  if (domainStepTemplates) {
    /* Assign IDs, inject relevant evidence references, and return */
    return domainStepTemplates.map((tpl, idx) => {
      const ref = refForStep(evidencePack, idx);
      return {
        id: `step-${idx + 1}`,
        title:   tpl.title,
        detail:  tpl.detail + (ref && ref.title ? ` Supporting reference: "${ref.title}" (${ref.source}).` : ""),
        quantity: tpl.quantity,
        duration: tpl.duration,
        source:   ref?.source || "Literature",
        sourceUri: ref?.url || (ref?.doi ? `https://doi.org/${ref.doi}` : ""),
        sourceTitle: ref?.title || tpl.title,
        riskLevel:   tpl.riskLevel || "med",
        riskNote:    tpl.riskNote || "",
        validationChecks: tpl.validationChecks || [],
        decisionGate: tpl.decisionGate,
        stepMaterials: tpl.stepMaterials || [],
        safetyConstraints: tpl.safetyConstraints || [],
        rationale: tpl.rationale || "",
      };
    });
  }

  /* ── Generic / molecular biology fallback ── */
  const ref0 = refForStep(evidencePack, 0);
  const steps = [];

  steps.push({
    id: "step-1",
    title: "Align hypothesis against retrieved precedent",
    detail: `Confirm that the intervention arm (${intervention}) and control arm (${control}) are compatible with the target system (${subject}). Check the retrieved reference for assay format: ${ref0?.title || "see literature sources"}.${mechanism ? ` Expected mechanism: ${mechanism}.` : ""}`,
    quantity: "1 design review session (≈ 4 h)",
    duration: "4 h",
    source: ref0?.source || "Literature",
    sourceUri: ref0?.url || (ref0?.doi ? `https://doi.org/${ref0.doi}` : ""),
    sourceTitle: ref0?.title || "Retrieved precedent",
    riskLevel: "med",
    riskNote: "A mismatch between the proposed assay and the retrieved protocol family can invalidate all downstream steps.",
    validationChecks: ["Confirmed intervention/control/endpoint all appear in retrieved references."],
    decisionGate: "Do not procure materials until scientist confirms the retrieved precedent justifies the planned assay format.",
    stepMaterials: ["Hypothesis statement", "Retrieved papers/protocols"],
    safetyConstraints: ["No wet-lab execution before scientist sign-off on protocol fit."],
    rationale: "Planning alignment prevents spending time and materials on an assay family that cannot test the hypothesis.",
  });

  materials.slice(0, 5).forEach((mat, idx) => {
    const ref = refForStep(evidencePack, idx + 1);
    const qty = stepQuantity(mat.name);
    const isPrimary = idx === 0;
    steps.push({
      id: `step-${steps.length + 1}`,
      title: isPrimary ? `Prepare primary reagent — ${mat.name}` : `Prepare ${mat.name}`,
      detail: `${isPrimary ? "Intervention reagent" : "Supporting reagent"}: ${mat.name}${mat.molecularFormula ? ` (${mat.molecularFormula}` : ""}${mat.molecularWeight ? `, MW ${mat.molecularWeight.toFixed(1)} g/mol)` : (mat.molecularFormula ? ")" : "")}. Quantity: ${qty}. ${mat.iupacName ? `IUPAC: ${mat.iupacName}. ` : ""}${protocolRef?.protocolMaterials ? `Protocol notes: ${protocolRef.protocolMaterials.slice(0, 180)}.` : "Prepare in accordance with supplier specification and retrieved protocol standard."}`,
      quantity: qty,
      duration: idx === 0 ? "2 h" : "1 h",
      source:   ref?.source || mat.supplier || "PubChem",
      sourceUri: mat.sourceUri || ref?.url || (ref?.doi ? `https://doi.org/${ref.doi}` : "") || (mat.pubchemCid ? `https://pubchem.ncbi.nlm.nih.gov/compound/${mat.pubchemCid}` : ""),
      sourceTitle: ref?.title || mat.name,
      riskLevel:  isPrimary ? "med" : "low",
      riskNote:   isPrimary
        ? `Purity and stoichiometry of ${mat.name} directly set the signal-to-noise of ${assay}.`
        : `Ensure ${mat.name} is compatible with buffer conditions used for the primary assay.`,
      validationChecks: [
        `Verify ${mat.name} stock concentration by UV-Vis or NMR before use.`,
        ...(mat.pubchemCid ? [`Cross-check identity against PubChem CID ${mat.pubchemCid}.`] : []),
      ],
      decisionGate: isPrimary
        ? `Halt if ${mat.name} purity < 95% or if the measured MW deviates >2% from expected.`
        : undefined,
      stepMaterials: [mat.name],
      safetyConstraints: ["Verify SDS before handling concentrated reagents.", "Label all prepared stocks with concentration and timestamp."],
      rationale: isPrimary
        ? `Primary reagent quality sets the upper bound for interpretable ${assay} signal.`
        : "Supporting reagents must be prepared consistently to avoid introducing uncontrolled variance.",
    });
  });

  const refAssay = refForStep(evidencePack, steps.length);
  steps.push({
    id: `step-${steps.length + 1}`,
    title: `Execute primary assay — measure ${assay}`,
    detail: `Apply the prepared ${intervention} to the ${subject} under matched conditions. Run ${control} in parallel. Record ${assay} at all specified time points. ${protocolRef ? `Follow the retrieved protocol procedure: "${(protocolRef.protocolDescription || "").slice(0, 200)}".` : ""}`,
    quantity: "Pilot n ≥ 3 replicates per arm",
    duration: "1–2 days",
    source:   refAssay?.source || "Literature",
    sourceUri: refAssay?.url || (refAssay?.doi ? `https://doi.org/${refAssay.doi}` : ""),
    sourceTitle: refAssay?.title || "Primary assay reference",
    riskLevel: "high",
    riskNote: `Incorrect timing, normalisation, or control condition for ${assay} is the dominant scientific risk.`,
    validationChecks: [
      "Signal separated between intervention and control before proceeding.",
      "All replicates within 20% CV.",
    ],
    decisionGate: `Advance only if pilot data show interpretable signal in the expected direction for ${assay}.`,
    stepMaterials: [intervention, control, subject],
    safetyConstraints: ["Run intervention and control arms under identical environmental conditions.", "Capture raw readouts before any normalization."],
    rationale: `This is the first direct test of whether the intervention changes ${assay} against control.`
  });

  const refBench = refForStep(evidencePack, steps.length);
  steps.push({
    id: `step-${steps.length + 1}`,
    title: "Analyse results and benchmark against literature",
    detail: `Compare observed outcomes for ${assay} against the threshold in the hypothesis (${parsed.threshold || "see hypothesis"}). Overlay with retrieved literature benchmarks. Document divergences.`,
    quantity: "1 analysis pass (≈ 4 h)",
    duration: "4 h",
    source:   refBench?.source || "Literature",
    sourceUri: refBench?.url || (refBench?.doi ? `https://doi.org/${refBench.doi}` : ""),
    sourceTitle: refBench?.title || "Benchmark reference",
    riskLevel: "low",
    riskNote: "A plan can look scientifically plausible yet still fail if timing, variance, or procurement diverges from precedent.",
    validationChecks: [
      "All divergences from retrieved literature documented and classified.",
      "Decision gate for next iteration recorded.",
    ],
    decisionGate: "Do not claim success until observed data and execution constraints are both consistent with the retrieved evidence.",
    stepMaterials: ["Raw assay data", "Reference benchmarks"],
    safetyConstraints: ["Freeze the analysis dataset before writing conclusions.", "Document failed runs alongside successful runs."],
    rationale: "A protocol is only useful if outcomes are interpreted against predefined thresholds and literature context.",
  });

  return steps;
}


function durationToDays(duration = "") {
  const d = duration.toLowerCase();
  const dayMatch = d.match(/(\d+(?:\.\d+)?)\s*(day|days|d)\b/);
  if (dayMatch) {
    return Math.max(1, Math.round(Number(dayMatch[1])));
  }

  const hourMatch = d.match(/(\d+(?:\.\d+)?)\s*(hour|hours|h)\b/);
  if (hourMatch) {
    return 1;
  }

  const minuteMatch = d.match(/(\d+(?:\.\d+)?)\s*(minute|minutes|min|m)\b/);
  if (minuteMatch) {
    return 1;
  }

  if (d.includes("overnight")) {
    return 1;
  }

  return 2;
}

function buildDynamicTimeline(steps) {
  return steps.map((step, index) => ({
    phase: step.title,
    durationDays: durationToDays(step.duration),
    dependsOn: index === 0 ? [] : [steps[index - 1].title],
    owner: index === 0 ? "Scientific lead" : index === 1 ? "Research associate" : index === 2 ? "Assay scientist" : "Review scientist",
    deliverable: step.decisionGate || step.title,
  }));
}

function buildDynamicBenchmark(totalDays, budget) {
  return [
    { label: "This Plan (API-backed)", time: `${totalDays} d`, cost: budget.totalUsd, sustainability: 72, ours: true },
    { label: "Manual scientist scoping", time: `${Math.max(totalDays + 3, 5)} d`, cost: Math.round(budget.totalUsd * 1.22), sustainability: 66, ours: false },
    { label: "Conservative lab baseline", time: `${Math.max(totalDays + 5, 7)} d`, cost: Math.round(budget.totalUsd * 1.38), sustainability: 63, ours: false },
  ];
}

async function buildEvidenceBackedPlan(hypothesis, relatedReviews) {
  const domain = detectDomain(hypothesis);
  const parsed = await parseHypothesis(hypothesis);
  const evidencePack = await retrieveEvidencePack(hypothesis);
  const materials = await buildMaterialsFromEvidence(parsed, hypothesis, evidencePack);
  const steps = buildDynamicSteps(parsed, evidencePack, materials);
  const timeline = buildDynamicTimeline(steps);
  const budget = buildBudget(
    materials,
    {
      reagentsUsd: materials.reduce((sum, item) => sum + item.unitCostUsd, 0),
      equipmentUsd: domain.name.includes("Diagnostics") || domain.name.includes("Electrochemistry") ? 240 : 120,
      reliability: `Evidence-backed estimate built from ${evidencePack.items.length} retrieved literature records and hypothesis-derived material slots.`,
      assumptions: [
        "Material identities are derived from structured hypothesis fields and literature metadata, not from a procurement ERP.",
        "Protocol logic is synthesized from external literature APIs plus scientist review memory.",
        "Replace supplier matches and pricing with institution-specific procurement APIs when available.",
      ],
    },
    timeline,
    domain.name,
  );
  const totalDays = timeline.reduce((sum, phase) => sum + phase.durationDays, 0);

  // Derive target/final compound from parsed outcome or materials
  const targetLabel = parsed.outcome || parsed.intervention || materials[0]?.name || "";
  let targetCompound = null;
  if (targetLabel) {
    const tc = await fetchPubChemCompoundByName(targetLabel).catch(() => null);
    const topRef = evidencePack.items[0];
    targetCompound = {
      name: tc?.title || targetLabel,
      pubchemCid: tc?.cid || undefined,
      molecularFormula: tc?.molecularFormula || undefined,
      molecularWeight: tc?.molecularWeight || undefined,
      iupacName: tc?.iupacName || undefined,
      note: `Target / final compound for this project derived from the parsed outcome: "${targetLabel}".`,
      literatureRef: topRef
        ? { title: topRef.title, uri: topRef.url || (topRef.doi ? `https://doi.org/${topRef.doi}` : "") }
        : undefined,
    };
  }
  const compoundMap = await inferHypothesisCompoundMap(hypothesis, parsed, evidencePack, materials);

  return {
    experiment: {
      id: domain.id,
      project: domain.project,
      hypothesis,
      plainEnglish: domain.plainEnglish,
      domain: domain.name,
      metrics: {
        confidence: evidencePack.items.length > 2 ? "74%" : "61%",
        novelty: evidenceNovelty(hypothesis, evidencePack).signal,
        sustainability: "71",
      },
      novelty: evidenceNovelty(hypothesis, evidencePack),
      materials,
      steps,
      timeline,
      budget,
      benchmark: buildDynamicBenchmark(totalDays, budget),
      validation: {
        primaryMetric: parsed.outcome || "Primary assay readout",
        successCriteria: `Meet the hypothesis threshold (${parsed.threshold || "see hypothesis"}) while preserving a defensible comparison against ${parsed.control || "the matched control arm"}.`,
        failureCriteria: [
          "The retrieved literature does not support the transfer of the assay into the proposed system.",
          "Critical materials cannot be matched to a procurement path.",
          "Pilot data do not separate intervention and control in a scientifically interpretable way.",
        ],
        decisionGates: steps.map((step) => step.decisionGate).filter(Boolean),
      },
      reviewAdaptations: relatedReviews.map((review) => ({
        section: review.section,
        change: review.correction,
        impact: "Applied to the regenerated plan as an explicit guardrail or decision gate.",
      })),
      sources: evidencePack.items.slice(0, 5).map((item) => ({
        title: item.title,
        source: item.source,
        uri: evidenceUrl(item),
      })),
      ...(compoundMap?.length ? { compoundMap } : {}),
      ...(targetCompound ? { targetCompound } : {}),
    },
  };
}

function fallbackPublicationReferences(domainName) {
  if (domainName === "Diagnostics") {
    return [
      {
        title: "Multifunctional self-driven origami paper-based integrated microfluidic chip to detect CRP and PAB in whole blood",
        source: "pubmed.ncbi.nlm.nih.gov",
        uri: "https://pubmed.ncbi.nlm.nih.gov/35358776/",
      },
      {
        title: "Paper-based sensors and assays for personalized health care",
        source: "pubmed.ncbi.nlm.nih.gov",
        uri: "https://pubmed.ncbi.nlm.nih.gov/25943067/",
      },
      {
        title: "Recent advances in paper-based electrochemical biosensors",
        source: "pubmed.ncbi.nlm.nih.gov",
        uri: "https://pubmed.ncbi.nlm.nih.gov/33743376/",
      },
    ];
  }

  if (domainName === "In Vivo Gut Health") {
    return [
      {
        title: "Lactobacillus rhamnosus GG treatment improves intestinal permeability and modulates microbiota dysbiosis in an experimental model of sepsis",
        source: "pubmed.ncbi.nlm.nih.gov",
        uri: "https://pubmed.ncbi.nlm.nih.gov/30628657/",
      },
      {
        title: "Lactobacillus rhamnosus GG Protects the Epithelial Barrier of Wistar Rats from the PTG-Induced Enteropathy",
        source: "pubmed.ncbi.nlm.nih.gov",
        uri: "https://pubmed.ncbi.nlm.nih.gov/30405050/",
      },
      {
        title: "FITC-dextran assay as a readout of intestinal permeability in murine models",
        source: "bio-protocol.org",
        uri: "https://bio-protocol.org/en/bpdetail?id=3974&type=0",
      },
    ];
  }

  if (domainName === "Cell Biology") {
    return [
      {
        title: "Intracellular trehalose improves the survival of cryopreserved mammalian cells",
        source: "pubmed.ncbi.nlm.nih.gov",
        uri: "https://pubmed.ncbi.nlm.nih.gov/10657121/",
      },
      {
        title: "Freezing-induced uptake of trehalose into mammalian cells facilitates cryopreservation",
        source: "pubmed.ncbi.nlm.nih.gov",
        uri: "https://pubmed.ncbi.nlm.nih.gov/27003129/",
      },
      {
        title: "Trehalose in Biomedical Cryopreservation-Properties, Mechanisms, Delivery Methods, Applications, Benefits, and Problems",
        source: "pubmed.ncbi.nlm.nih.gov",
        uri: "https://pubmed.ncbi.nlm.nih.gov/36779397/",
      },
    ];
  }

  if (domainName === "Electrochemistry Climate") {
    return [
      {
        title: "Performance of different Sporomusa species for the microbial electrosynthesis of acetate from carbon dioxide",
        source: "pubmed.ncbi.nlm.nih.gov",
        uri: "https://pubmed.ncbi.nlm.nih.gov/28279911/",
      },
      {
        title: "Dual cathode configuration and headspace gas recirculation for enhancing microbial electrosynthesis using Sporomusa ovata",
        source: "pubmed.ncbi.nlm.nih.gov",
        uri: "https://pubmed.ncbi.nlm.nih.gov/34543900/",
      },
      {
        title: "Sporomusa ovata as Catalyst for Bioelectrochemical Carbon Dioxide Reduction: A Review Across Disciplines From Microbiology to Process Engineering",
        source: "pubmed.ncbi.nlm.nih.gov",
        uri: "https://pubmed.ncbi.nlm.nih.gov/35801113/",
      },
    ];
  }

  return [
    {
      title: "protocols.io experimental methods collection",
      source: "protocols.io",
      uri: "https://www.protocols.io/",
    },
    {
      title: "Bio-protocol methods collection",
      source: "bio-protocol.org",
      uri: "https://bio-protocol.org/",
    },
    {
      title: "PubMed scientific literature",
      source: "pubmed.ncbi.nlm.nih.gov",
      uri: "https://pubmed.ncbi.nlm.nih.gov/",
    },
  ];
}

function noveltyFallback(hypothesis) {
  const domain = detectDomain(hypothesis);
  return {
    signal: "similar work exists",
    summary: `The hypothesis appears to build on established ${domain.name.toLowerCase()} methods, but the exact intervention-outcome combination still needs a confirmatory expert check.`,
    references: fallbackPublicationReferences(domain.name),
  };
}

function planFallback(hypothesis) {
  const domain = detectDomain(hypothesis);
  const experimentId = domain.id;
  const relatedReviews = reviewStore.filter((review) => review.experimentId === experimentId);
  const reviewAdaptations = relatedReviews.map((review) => ({
    section: review.section,
    change: review.correction,
    impact: "Applied to the regenerated plan as an explicit guardrail or decision gate.",
  }));

  const domainPlans = {
    Diagnostics: {
      // ── 7-step protocol grounded in published paper-based electrochemical biosensor literature ──
      // References: PMID 35358776 (origami CRP chip), PMID 33743376 (paper-based EC biosensors),
      //             doi:10.1016/j.bios.2021.113085 (3-MPA SAM EDC/NHS anti-CRP coupling),
      //             Thermo Fisher EDC/NHS coupling guide ThermoFisher.com/pierce-edcnhs-crosslinking
      steps: [
        {
          id: "step-1",
          title: "Screen-print and pattern paper electrode strips",
          detail: "Print three-electrode system (working: carbon, counter: carbon, reference: Ag/AgCl) on Whatman Grade 1 (WHA1001-150) using a 200-mesh stencil. Define a 3 mm hydrophobic barrier ring around each working electrode using a wax printer (Xerox Phaser 8860) at 125 °C. Cure carbon layers at 60 °C for 20 min; cure Ag/AgCl layer at 80 °C for 15 min. Target batch: 24 strips per run.",
          quantity: "24 strips",
          duration: "1 day",
          source: "pubmed.ncbi.nlm.nih.gov/33743376",
          sourceUri: "https://pubmed.ncbi.nlm.nih.gov/33743376/",
          sourceTitle: "Recent advances in paper-based electrochemical biosensors (Biosensors 2021)",
          riskLevel: "med",
          riskNote: "Humidity above 55% RH during printing widens conductive tracks and inflates inter-strip CV. Perform in humidity-controlled room (40–50% RH). Wax patterning defects cause sample leakage — inspect under 10× magnification.",
          validationChecks: [
            "Measure open-circuit potential of each strip in 0.1 M KCl; reject strips where OCP deviates > 25 mV from batch median.",
            "Confirm strip-to-strip CV of baseline current < 8% across the 24-strip batch (EIS at 0.1 Hz – 100 kHz in 5 mM [Fe(CN)6]3-/4-).",
            "Visual inspection: hydrophobic barrier intact, no satellite ink droplets on working electrode area.",
          ],
          decisionGate: "Do not proceed to SAM formation unless ≥ 80% of strips pass all three QC checks. Reprint batch if yield < 80%.",
        },
        {
          id: "step-2",
          title: "Form 3-MPA self-assembled monolayer (SAM) on working electrode",
          detail: "Immerse qualified strips in 10 mM 3-mercaptopropionic acid (3-MPA, Sigma M5801) dissolved in absolute ethanol. Incubate 16 h at room temperature in the dark to allow complete S–Au or S–C chemisorption. Rinse 3× with ethanol then 3× with PBS pH 7.4. Keep strips hydrated in PBS until EDC/NHS step — do not allow working electrode to dry after this point.",
          quantity: "20 strips (post-QC)",
          duration: "16 hours (overnight)",
          source: "pubmed.ncbi.nlm.nih.gov/35358776",
          sourceUri: "https://pubmed.ncbi.nlm.nih.gov/35358776/",
          sourceTitle: "Multifunctional self-driven origami paper-based chip for CRP and PAB detection in whole blood (Biosensors 2022)",
          riskLevel: "high",
          riskNote: "3-MPA is toxic (LD50 oral rat ~280 mg/kg) and volatile — handle in fume hood with nitrile gloves and eye protection. Incomplete SAM (< 16 h) leaves exposed surface area for non-specific protein adsorption, the dominant source of false positives in whole blood. Ethanol purity must be ≥ 99.8%; water contamination prevents SAM ordering.",
          validationChecks: [
            "EIS Nyquist plot after SAM: electron-transfer resistance (Rct) should increase 2–5× vs. bare electrode in 5 mM [Fe(CN)6]3-/4-. If Rct increase < 2×, SAM is sparse — repeat.",
            "CV in PBS: confirm no Faradaic peaks from non-SAM surface contaminants.",
          ],
          decisionGate: "Do not proceed to antibody coupling if EIS Rct increase < 2× on > 25% of strips. Repeat SAM incubation on failed strips.",
        },
        {
          id: "step-3",
          title: "EDC/NHS activation and anti-CRP IgG covalent coupling",
          detail: "Activate carboxyl groups of 3-MPA SAM by applying 20 µL of freshly prepared EDC·HCl (0.4 M, Thermo 22981) + NHS (0.1 M, Sigma 130672) in MES buffer pH 6.0 to the working electrode. Incubate 30 min at RT. Rinse 3× with MES buffer. Immediately apply 20 µL of anti-CRP monoclonal antibody (Thermo MA1-82376, 50 µg/mL in PBS pH 7.4). Incubate 2 h at RT in a humid chamber to prevent drying. Rinse 3× with PBS.",
          quantity: "20 strips",
          duration: "3 hours",
          source: "thermofisher.com",
          sourceUri: "https://www.thermofisher.com/us/en/home/life-science/protein-biology/protein-biology-learning-center/protein-biology-resource-library/pierce-protein-methods/amine-reactive-crosslinker-chemistry.html",
          sourceTitle: "Pierce EDC/NHS Amine-Reactive Crosslinker Chemistry — Thermo Fisher",
          riskLevel: "high",
          riskNote: "EDC half-life in aqueous solution at RT ~ 30 min — prepare fresh and use immediately. Antibody concentration must be 50 µg/mL or above for reliable surface density. Over-activation (EDC > 0.6 M) can crosslink antibodies to each other rather than to the surface, reducing binding capacity. pH drift above 7.0 during EDC step deactivates NHS ester — pre-check buffer pH.",
          validationChecks: [
            "EIS Rct after antibody coupling must increase a further 3–8× vs. post-SAM value (confirms antibody attachment).",
            "Include one strip dipped in PBS instead of antibody solution as SAM-only negative control — its Rct shift after BSA blocking should be < 30% of antibody-coupled strips.",
          ],
          decisionGate: "Reject batch if < 70% of strips show expected Rct increase range. Failure indicates stale EDC, wrong pH, or loss of SAM integrity.",
        },
        {
          id: "step-4",
          title: "BSA blocking and surface passivation",
          detail: "Apply 30 µL of 1% BSA (Sigma A2153) in PBS pH 7.4 containing 0.05% Tween-20 to each electrode. Incubate 1 h at RT. Rinse 5× with PBS-T (PBS + 0.05% Tween-20), then 2× with plain PBS. Store dry at 4 °C in a desiccated container if not used immediately (stable ≤ 7 days).",
          quantity: "20 strips",
          duration: "1.5 hours",
          source: "bio-protocol.org",
          sourceUri: "https://bio-protocol.org/",
          sourceTitle: "Bio-protocol: ELISA and surface blocking protocols",
          riskLevel: "med",
          riskNote: "Insufficient blocking is the most common source of whole-blood matrix interference. BSA concentration < 0.5% or omission of Tween-20 leaves hydrophobic patches that non-specifically adsorb albumin, IgG, and haemoglobin. Do not use milk powder as alternative — it cross-reacts with anti-protein antibodies.",
          validationChecks: [
            "Run a blank whole-blood control (no added CRP) on 3 strips. Acceptable signal must be < 20% of signal at 0.5 mg/L CRP.",
            "EIS Rct after BSA blocking should increase modestly (5–20%) vs. post-antibody — larger increases suggest antibody burial under BSA layer.",
          ],
          decisionGate: "If blank blood signal exceeds 20% of 0.5 mg/L signal, increase BSA to 2% and Tween-20 to 0.1%. Repeat before proceeding.",
        },
        {
          id: "step-5",
          title: "Electrochemical characterisation — CV and EIS step-by-step verification",
          detail: "For each modification step (bare → SAM → antibody → BSA), record: (a) Cyclic voltammetry (CV) at 50 mV/s, −0.2 to +0.6 V vs. Ag/AgCl in 5 mM K3[Fe(CN)6]/K4[Fe(CN)6] + 0.1 M KCl; (b) Electrochemical impedance spectroscopy (EIS) at 0.2 V DC, 10 mV AC, 0.1 Hz – 100 kHz. Fit Randles equivalent circuit (Rs, Rct, Cdl, Zw) to extract Rct at each step. Use PalmSens4 or equivalent potentiostat.",
          quantity: "3 representative strips",
          duration: "2 hours",
          source: "pubmed.ncbi.nlm.nih.gov/33743376",
          sourceUri: "https://pubmed.ncbi.nlm.nih.gov/33743376/",
          sourceTitle: "Recent advances in paper-based electrochemical biosensors (Biosensors 2021)",
          riskLevel: "low",
          riskNote: "EIS spectra on paper substrates show higher solution resistance (Rs) than glass/Si — expect Rs of 50–200 Ω. Reference electrode chloridisation may degrade over multiple measurements — budget 2–3 reference strips per characterisation run.",
          validationChecks: [
            "Rct step sequence must show monotonic increase: bare < SAM < antibody < BSA.",
            "CV peak-to-peak separation (ΔEp) on bare electrode < 100 mV confirms adequate carbon ink conductivity.",
            "EIS Bode phase angle at 1 Hz should shift from ~70° (bare) toward ~85° after BSA (confirms near-blocking behaviour of complete surface modification).",
          ],
          decisionGate: "Non-monotonic Rct sequence indicates surface modification failure. Identify the failed step from the step-by-step EIS and rerun that step only before proceeding to calibration.",
        },
        {
          id: "step-6",
          title: "Calibration curve and limit-of-detection measurement",
          detail: "Prepare 8 CRP standards in PBS: 0, 0.1, 0.25, 0.5, 1.0, 2.0, 10, 50 mg/L using CRP recombinant protein (Sigma C4063). Apply 30 µL per strip, incubate 10 min at RT (matching target assay time). Record differential pulse voltammetry (DPV: pulse amplitude 25 mV, pulse width 50 ms, step potential 5 mV) in 5 mM [Fe(CN)6]3-/4-. Plot ΔRct (or ΔIpeak) vs. log[CRP]. Fit linear region by least-squares. Calculate LoD = 3σblank / slope where σblank = SD of 8 blank replicates.",
          quantity: "8 concentration points × 3 replicates = 24 strips",
          duration: "1 day",
          source: "pubmed.ncbi.nlm.nih.gov/35358776",
          sourceUri: "https://pubmed.ncbi.nlm.nih.gov/35358776/",
          sourceTitle: "Origami paper-based chip for CRP detection (Biosensors 2022)",
          riskLevel: "med",
          riskNote: "10-min incubation is tight for diffusion-limited binding — use gentle mixing (orbital shaker 100 rpm) to accelerate. Working electrode must be kept wet throughout. DPV is preferred over CV for sensitivity because it subtracts background current; do not substitute with chronoamperometry without re-validating the signal model.",
          validationChecks: [
            "LoD ≤ 0.5 mg/L CRP in PBS buffer (target threshold from hypothesis).",
            "Linear dynamic range spans at least 0.25–10 mg/L (covers normal–acute CRP clinical range).",
            "Intra-batch CV ≤ 12% at 0.5 mg/L and 2.0 mg/L concentration points (n=3 strips each).",
            "Calibration curve R² ≥ 0.97 in the linear region.",
          ],
          decisionGate: "Do not proceed to whole-blood validation if buffer LoD > 0.5 mg/L after two calibration attempts. Revisit antibody surface density and EDC/NHS protocol before repeating.",
        },
        {
          id: "step-7",
          title: "Selectivity panel and whole-blood ELISA benchmark",
          detail: "Selectivity: test interferents at physiological concentrations in PBS: human serum albumin (HSA, Sigma A9511, 40 g/L), human IgG (10 g/L), haemoglobin (5 g/L). Criterion: signal change < 10% vs. no-CRP blank. Whole-blood validation: use contrived EDTA whole blood spiked to 0.1, 0.5, 2.0, and 10 mg/L CRP. Compare sensor output against ELISA (Thermo Fisher CRP ELISA BMS2032) run in parallel. Statistical analysis: Bland-Altman plot and Passing-Bablok regression; acceptable 95% limits of agreement ≤ ±25% across 0.5–10 mg/L clinical range.",
          quantity: "12 strips (selectivity) + 16 strips (whole blood × 4 concentrations × 4 replicates)",
          duration: "2 days",
          source: "pubmed.ncbi.nlm.nih.gov/35358776",
          sourceUri: "https://pubmed.ncbi.nlm.nih.gov/35358776/",
          sourceTitle: "Origami paper-based chip for CRP detection (Biosensors 2022)",
          riskLevel: "high",
          riskNote: "Whole blood contains cells, lipids, and proteins at concentrations 100–1000× above CRP. Haematocrit (Hct) variation (35–55%) changes viscosity and diffusion time — record Hct for each sample. BSA at 40 g/L is the dominant interferent; if Step 4 blocking QC passed this should be manageable. Obtain whole blood under institutional ethics approval or use commercially sourced contrived samples.",
          validationChecks: [
            "Each interferent signal change < 10% of the signal at 0.5 mg/L CRP.",
            "LoD in whole blood ≤ 0.5 mg/L (IUPAC 3σ/slope method).",
            "Time-to-result ≤ 10 min for the four whole-blood concentrations tested.",
            "Bland-Altman 95% limits of agreement vs. ELISA ≤ ±25% across the 0.5–10 mg/L range.",
            "Passing-Bablok slope 0.85–1.15 and intercept ≤ 0.2 mg/L vs. ELISA reference.",
          ],
          decisionGate: "Declare success if all five checks above pass. If whole-blood LoD > 0.5 mg/L but buffer LoD ≤ 0.5 mg/L, the gap is matrix interference — return to Step 4 and increase BSA blocking stringency.",
        },
      ],
      materials: [
        { name: "Whatman Grade 1 cellulose paper", catalogNumber: "WHA1001-150", supplier: "Cytiva", quantity: "150 sheets", unitCostUsd: 48, leadTime: "3 d", status: "order",
          notes: "Standard pore size 11 µm, flow rate 2.5 mL/min. Use as-received — do not pre-wet." },
        { name: "Screen-printable carbon ink", catalogNumber: "C2130809D5", supplier: "Gwent Electronic Materials", quantity: "1 jar (125 g)", unitCostUsd: 190, leadTime: "5 d", status: "order",
          notes: "Working and counter electrode layer. Cure at 60 °C, 20 min." },
        { name: "Screen-printable Ag/AgCl reference ink", catalogNumber: "C61003P7", supplier: "Gwent Electronic Materials", quantity: "1 jar (125 g)", unitCostUsd: 125, leadTime: "5 d", status: "order",
          notes: "Reference electrode. Cure at 80 °C, 15 min. Stable in aqueous media." },
        { name: "3-Mercaptopropionic acid (3-MPA)", catalogNumber: "M5801", supplier: "Sigma-Aldrich", quantity: "5 mL (99%)", unitCostUsd: 42, leadTime: "2 d", status: "order",
          notes: "SAM linker. Handle in fume hood. Prepare 10 mM in absolute ethanol fresh daily.", pubchemCid: 75763, molecularFormula: "C3H6O2S", molecularWeight: 106.14 },
        { name: "EDC·HCl (1-Ethyl-3-(3-dimethylaminopropyl)carbodiimide)", catalogNumber: "22981", supplier: "Thermo Fisher Scientific", quantity: "1 g", unitCostUsd: 88, leadTime: "2 d", status: "order",
          notes: "Carboxyl activator for NHS coupling. Prepare 0.4 M in MES pH 6.0 immediately before use — half-life ~30 min." },
        { name: "NHS (N-Hydroxysuccinimide)", catalogNumber: "130672", supplier: "Sigma-Aldrich", quantity: "5 g", unitCostUsd: 48, leadTime: "2 d", status: "order",
          notes: "Use 0.1 M in MES pH 6.0 co-mixed with EDC. Stabilises active ester, extending coupling window to 4 h." },
        { name: "Anti-CRP monoclonal antibody (clone 8F9)", catalogNumber: "MA1-82376", supplier: "Thermo Fisher Scientific", quantity: "100 µg", unitCostUsd: 325, leadTime: "2 d", status: "in-stock",
          notes: "Validated for CRP capture in sandwich immunoassay. Use at 50 µg/mL in PBS pH 7.4 for surface coupling." },
        { name: "BSA (Bovine Serum Albumin, fraction V)", catalogNumber: "A2153", supplier: "Sigma-Aldrich", quantity: "25 g", unitCostUsd: 42, leadTime: "in lab", status: "owned",
          notes: "1% w/v in PBS + 0.05% Tween-20. Blocking step 1 h at RT." },
        { name: "CRP recombinant human protein (standards)", catalogNumber: "C4063", supplier: "Sigma-Aldrich", quantity: "1 mg lyophilised", unitCostUsd: 285, leadTime: "3 d", status: "order",
          notes: "Reconstitute in PBS at 1 mg/mL stock. Prepare working standards at 0.1–50 mg/L by serial dilution. Aliquot and store at −20 °C." },
        { name: "Potassium ferricyanide K3[Fe(CN)6]", catalogNumber: "702587", supplier: "Sigma-Aldrich", quantity: "25 g (≥99%)", unitCostUsd: 32, leadTime: "in lab", status: "owned",
          notes: "Prepare 5 mM in 0.1 M KCl as redox probe. Oxidised form of the Fe(CN)6 couple for CV/EIS characterisation." },
        { name: "Potassium ferrocyanide K4[Fe(CN)6]·3H2O", catalogNumber: "60284", supplier: "Sigma-Aldrich", quantity: "100 g (≥98.5%)", unitCostUsd: 38, leadTime: "in lab", status: "owned",
          notes: "Reduced form. Mix 1:1 molar ratio with ferricyanide for quasi-reversible 5 mM [Fe(CN)6]3-/4- solution." },
        { name: "MES buffer (2-(N-morpholino)ethanesulphonic acid)", catalogNumber: "M3671", supplier: "Sigma-Aldrich", quantity: "25 g", unitCostUsd: 28, leadTime: "2 d", status: "order",
          notes: "Prepare 0.1 M, adjust to pH 6.0 with NaOH. Required for EDC/NHS activation at correct pH." },
        { name: "PBS tablets (phosphate-buffered saline)", catalogNumber: "P4417", supplier: "Sigma-Aldrich", quantity: "100 tablets", unitCostUsd: 22, leadTime: "in lab", status: "owned",
          notes: "Reconstitute 1 tablet per 200 mL for 10 mM PBS, 2.7 mM KCl, 137 mM NaCl, pH 7.4." },
        { name: "Human serum albumin (interferent standard)", catalogNumber: "A9511", supplier: "Sigma-Aldrich", quantity: "1 g (≥96%)", unitCostUsd: 85, leadTime: "3 d", status: "order",
          notes: "Prepare at 40 g/L in PBS — physiological whole-blood level. Use for selectivity panel only." },
      ],
      timeline: [
        {
          phase: "Strip fabrication and QC",
          durationDays: 1,
          dependsOn: [],
          owner: "Assay engineer",
          deliverable: "24 printed strips, ≥80% passing OCP and CV < 8% QC",
        },
        {
          phase: "SAM formation (3-MPA overnight)",
          durationDays: 1,
          dependsOn: ["Strip fabrication and QC"],
          owner: "Assay engineer",
          deliverable: "SAM-coated strips; EIS confirms Rct increase 2–5×",
        },
        {
          phase: "EDC/NHS activation, antibody coupling, and BSA blocking",
          durationDays: 1,
          dependsOn: ["SAM formation (3-MPA overnight)"],
          owner: "Bioassay scientist",
          deliverable: "Functionalised, blocked sensor batch; EIS step-sequence verified",
        },
        {
          phase: "Electrochemical characterisation (CV and EIS)",
          durationDays: 1,
          dependsOn: ["EDC/NHS activation, antibody coupling, and BSA blocking"],
          owner: "Analytical scientist",
          deliverable: "Validated Rct step ladder; Randles fit parameters for 3 representative strips",
        },
        {
          phase: "Calibration curve and LoD determination",
          durationDays: 1,
          dependsOn: ["Electrochemical characterisation (CV and EIS)"],
          owner: "Analytical scientist",
          deliverable: "DPV calibration curve R² ≥ 0.97; LoD ≤ 0.5 mg/L in PBS; CV ≤ 12% at 0.5 mg/L",
        },
        {
          phase: "Selectivity panel",
          durationDays: 1,
          dependsOn: ["Calibration curve and LoD determination"],
          owner: "Bioassay scientist",
          deliverable: "Interferent signal < 10% at HSA 40 g/L, IgG 10 g/L, haemoglobin 5 g/L",
        },
        {
          phase: "Whole-blood validation and ELISA benchmark",
          durationDays: 2,
          dependsOn: ["Selectivity panel"],
          owner: "Analytical scientist",
          deliverable: "Bland-Altman 95% LoA ≤ ±25%; LoD ≤ 0.5 mg/L whole blood; time-to-result ≤ 10 min",
        },
      ],
      benchmark: [
        { label: "This Plan (AI-assisted)", time: "7 d", cost: 2890, sustainability: 74, ours: true },
        { label: "Traditional biosensor dev. baseline", time: "14 d", cost: 4200, sustainability: 61, ours: false },
        { label: "ELISA-only reference workflow", time: "3 d", cost: 1540, sustainability: 48, ours: false },
      ],
      budget: {
        reagentsUsd: 1143,
        equipmentUsd: 750,
        shippingUsd: 110,
        laborUsd: 595,
        contingencyUsd: 240,
        totalUsd: 2838,
        budgetCapUsd: 5000,
        savedUsd: 2162,
        reliability: "Moderate-to-high confidence. All reagent costs are based on published Sigma-Aldrich and Thermo Fisher list prices (USD, 2024–2025). Equipment assumes potentiostat at shared facility rate (£150/day × 5 active days). Does not include screen-printing stencil fabrication (~$80 one-time) or wax printer access cost.",
        assumptions: [
          "Potentiostat (PalmSens4 or equivalent) is accessed via shared instrument facility — not purchased outright.",
          "Anti-CRP antibody (MA1-82376) is available in-stock from a previous order; if purchasing fresh add 2-day lead time.",
          "Whole blood is sourced from consented volunteers under existing institutional ethical approval — no separate procurement cost.",
          "EDC and NHS are purchased as individual reagents rather than as a pre-mixed kit; kit (Thermo 77149) at ~$135 is an acceptable substitute with quicker prep.",
          "Scientist labor estimated at $85/h, 7 h/day, 7 working days total.",
        ],
        lineItems: [
          { label: "Cellulose paper + carbon ink + Ag/AgCl ink", amountUsd: 363, category: "reagents", note: "WHA1001-150 + Gwent C2130809D5 + Gwent C61003P7" },
          { label: "3-MPA SAM linker + EDC·HCl + NHS", amountUsd: 178, category: "reagents", note: "Sigma M5801 + Thermo 22981 + Sigma 130672" },
          { label: "Anti-CRP monoclonal antibody", amountUsd: 325, category: "reagents", note: "Thermo MA1-82376, 100 µg — critical-path item; order first" },
          { label: "CRP recombinant protein standards", amountUsd: 285, category: "reagents", note: "Sigma C4063 — needed for calibration and whole-blood spiking" },
          { label: "Interferent standards (HSA, PBS, MES, buffers)", amountUsd: 215, category: "reagents", note: "Sigma A9511 + P4417 + M3671 + A2153 + ferri/ferrocyanide" },
          { label: "Potentiostat facility access (5 instrument days)", amountUsd: 750, category: "equipment", note: "PalmSens4 or Bio-Logic SP-50; includes EIS, CV, DPV methods" },
          { label: "Cold-chain shipping (antibody + protein standards)", amountUsd: 110, category: "shipping", note: "Dry ice shipment for cold-chain items; Sigma standard items by ambient courier" },
          { label: "Scientist hands-on time (7 days × 8.5 h × $10/h adjusted)", amountUsd: 595, category: "labor", note: "One bioassay scientist + shared technician support for strip printing and data analysis" },
          { label: "Operational contingency (10%)", amountUsd: 240, category: "contingency", note: "Buffer for strip reprints, failed SAM batches, and additional EIS runs" },
        ],
      },
      validation: {
        primaryMetric: "Limit of detection (LoD) in whole blood and time-to-result",
        successCriteria: "Detect CRP ≤ 0.5 mg/L in post-EDC/NHS functionalised strips within 10 min contact time, with LoD calculated as 3σblank/slope ≤ 0.5 mg/L (IUPAC method), while achieving Bland-Altman 95% LoA ≤ ±25% vs. ELISA reference across the 0.5–10 mg/L clinical range.",
        failureCriteria: [
          "Buffer LoD (3σ/slope) > 0.5 mg/L after completing calibration Step 6 — indicates insufficient antibody surface density or poor EDC/NHS coupling.",
          "Whole-blood LoD > 0.5 mg/L despite buffer LoD passing — indicates matrix interference not resolved by blocking.",
          "Any single interferent (HSA 40 g/L, IgG 10 g/L, or haemoglobin 5 g/L) produces a signal change > 10% of the 0.5 mg/L CRP signal.",
          "Intra-batch CV > 15% at either 0.5 mg/L or 2.0 mg/L — indicates insufficient electrode fabrication reproducibility.",
          "Time-to-result exceeds 10 min at any validated CRP concentration in whole blood.",
          "Passing-Bablok slope vs. ELISA outside range 0.80–1.20 — indicates systematic proportional bias.",
        ],
        decisionGates: [
          "Gate 1 (after Step 1): ≥ 80% strips pass OCP + CV% QC before SAM. Reprint batch if yield < 80%.",
          "Gate 2 (after Step 2): EIS Rct increase 2–5× vs. bare confirms SAM. Fail: repeat 3-MPA incubation.",
          "Gate 3 (after Step 3): EIS Rct increase 3–8× vs. post-SAM confirms antibody loading. Fail: new EDC batch and recouple.",
          "Gate 4 (after Step 4): Blank blood signal < 20% of 0.5 mg/L CRP. Fail: increase BSA to 2% + Tween-20 to 0.1%.",
          "Gate 5 (after Step 5): Rct step sequence strictly monotonic (bare < SAM < Ab < BSA). Non-monotonic = surface modification failure — re-identify failing step.",
          "Gate 6 (after Step 6): Buffer LoD ≤ 0.5 mg/L and R² ≥ 0.97 and CV ≤ 12%. Fail: revisit Ab concentration and EDC protocol before whole-blood run.",
          "Gate 7 (after Step 7): All selectivity and whole-blood criteria met. If whole-blood LoD fails: return to Step 4 blocking. If selectivity fails: antibody specificity issue — source alternative clone.",
        ],
      },
    },
    "In Vivo Gut Health": {
      steps: [
        {
          id: "step-1",
          title: "Randomize mice and establish baseline body weight and stool logs",
          detail: "Assign matched mice to probiotic and control arms and document baseline variability before dosing.",
          quantity: "24 mice",
          duration: "2 days",
          source: "OpenWetWare",
          riskLevel: "med",
          riskNote: "Unbalanced baseline health can swamp gut permeability effects.",
          validationChecks: ["Exclude animals with baseline health outliers before dosing starts."],
          decisionGate: "Proceed only if arms are balanced for sex, weight, and baseline intake.",
        },
        {
          id: "step-2",
          title: "Administer Lactobacillus rhamnosus GG daily for 4 weeks",
          detail: "Dose consistently by gavage or feed strategy with matched control handling.",
          quantity: "28 days",
          duration: "4 weeks",
          source: "protocols.io",
          riskLevel: "high",
          riskNote: "Inconsistent dosing or stress artifacts can confound permeability outcomes.",
          validationChecks: ["Track daily intake or dose completion and weekly body weight."],
          decisionGate: "Do not continue if probiotic viability or animal welfare checks fail.",
        },
        {
          id: "step-3",
          title: "Run FITC-dextran permeability assay and tight-junction analysis",
          detail: "Measure serum fluorescence after oral FITC-dextran challenge and pair with claudin-1 and occludin expression analysis.",
          quantity: "Terminal assay",
          duration: "2 days",
          source: "bio-protocol.org",
          riskLevel: "med",
          riskNote: "Timing drift during FITC collection can distort the readout.",
          validationChecks: ["Reject batches with control variance above the predefined coefficient of variation."],
          decisionGate: "Repeat assay if control permeability values fall outside historical range.",
        },
      ],
      materials: [
        { name: "Lactobacillus rhamnosus GG", catalogNumber: "ATCC 53103", supplier: "ATCC", quantity: "1 vial", unitCostUsd: 325, leadTime: "4 d", status: "order" },
        { name: "FITC-dextran", catalogNumber: "FD4-1G", supplier: "Sigma-Aldrich", quantity: "1 g", unitCostUsd: 118, leadTime: "2 d", status: "in-stock" },
        { name: "Claudin-1 antibody", catalogNumber: "37-4900", supplier: "Thermo Fisher", quantity: "100 uL", unitCostUsd: 262, leadTime: "3 d", status: "order" },
        { name: "Occludin antibody", catalogNumber: "33-1500", supplier: "Thermo Fisher", quantity: "100 uL", unitCostUsd: 288, leadTime: "3 d", status: "order" },
      ],
      timeline: [
        { phase: "Animal randomization and baseline", durationDays: 2, dependsOn: [], owner: "In vivo lead", deliverable: "Balanced cohorts" },
        { phase: "4-week supplementation", durationDays: 28, dependsOn: ["Animal randomization and baseline"], owner: "Animal technician", deliverable: "Completed dosing log" },
        { phase: "FITC-dextran and tissue analysis", durationDays: 3, dependsOn: ["4-week supplementation"], owner: "Assay scientist", deliverable: "Permeability and protein-expression dataset" },
      ],
      benchmark: [
        { label: "This Plan (AI)", time: "33 d", cost: 1395, sustainability: 58, ours: true },
        { label: "Lab baseline", time: "40 d", cost: 1680, sustainability: 52, ours: false },
        { label: "Published mouse protocol", time: "35 d", cost: 1510, sustainability: 55, ours: false },
      ],
      budget: { reagentsUsd: 993, equipmentUsd: 402, totalUsd: 1395, budgetCapUsd: 4000, savedUsd: 2605 },
      validation: {
        primaryMetric: "Percent reduction in intestinal permeability by FITC-dextran assay",
        successCriteria: "At least 30% lower permeability than controls, supported by concordant claudin-1 and occludin upregulation.",
        failureCriteria: [
          "Treatment compliance drops below threshold.",
          "Control-arm variability makes the FITC signal uninterpretable.",
          "Protein-expression evidence contradicts the permeability effect.",
        ],
        decisionGates: [
          "Advance to terminal assay only if weekly health and dosing logs remain clean.",
          "Advance to mechanistic claims only if both FITC and tight-junction readouts align.",
        ],
      },
    },
    "Cell Biology": {
      steps: [
        {
          id: "step-1",
          title: "Culture matched HeLa batches for cryopreservation",
          detail: "Expand cells under standardized passage conditions and document confluency before freezing.",
          quantity: "6 matched flasks",
          duration: "2 days",
          source: "ATCC",
          riskLevel: "low",
          riskNote: "Passage drift can distort viability comparisons more than the cryoprotectant itself.",
          validationChecks: ["Require matched passage number and confluency windows across arms."],
          decisionGate: "Pause freezing if morphology or viability differs across pre-freeze arms.",
        },
        {
          id: "step-2",
          title: "Prepare trehalose and standard DMSO freezing media",
          detail: "Mix both media fresh, confirm osmolarity, and assign aliquots randomly to matched cell batches.",
          quantity: "2 media conditions",
          duration: "3 hours",
          source: "promega.com",
          riskLevel: "med",
          riskNote: "Improper osmolarity can cause false failures for the trehalose arm.",
          validationChecks: ["Measure osmolarity and reject any prep outside the accepted range."],
          decisionGate: "Do not freeze cells if media QC fails.",
        },
        {
          id: "step-3",
          title: "Freeze, thaw, and quantify short- and mid-term viability",
          detail: "Run immediate and 24-hour post-thaw viability assays to distinguish membrane rescue from true recovery.",
          quantity: "Replicate thaw set",
          duration: "2 days",
          source: "Thermo Fisher application notes",
          riskLevel: "high",
          riskNote: "A single timepoint can overstate success if cells die after initial recovery.",
          validationChecks: ["Require a 2-hour and 24-hour viability gate before declaring improvement."],
          decisionGate: "Only advance to optimization claims if both early and 24-hour viability improve over control.",
        },
      ],
      materials: [
        { name: "HeLa cells", catalogNumber: "CCL-2", supplier: "ATCC", quantity: "1 vial", unitCostUsd: 490, leadTime: "in lab", status: "owned" },
        { name: "Trehalose", catalogNumber: "T9449", supplier: "Sigma-Aldrich", quantity: "25 g", unitCostUsd: 72, leadTime: "2 d", status: "in-stock" },
        { name: "DMSO, cell culture grade", catalogNumber: "D2650", supplier: "Sigma-Aldrich", quantity: "100 mL", unitCostUsd: 39, leadTime: "in lab", status: "owned" },
        { name: "Cell viability reagent", catalogNumber: "A50100", supplier: "Thermo Fisher", quantity: "1 kit", unitCostUsd: 162, leadTime: "3 d", status: "order" },
      ],
      timeline: [
        { phase: "Cell expansion and QC", durationDays: 2, dependsOn: [], owner: "Cell culture scientist", deliverable: "Matched pre-freeze cell lots" },
        { phase: "Freezing media prep", durationDays: 1, dependsOn: ["Cell expansion and QC"], owner: "Research associate", deliverable: "Qualified cryomedia" },
        { phase: "Freeze-thaw viability study", durationDays: 2, dependsOn: ["Freezing media prep"], owner: "Cell assay scientist", deliverable: "2-hour and 24-hour viability comparison" },
      ],
      benchmark: [
        { label: "This Plan (AI)", time: "5 d", cost: 273, sustainability: 74, ours: true },
        { label: "Lab baseline", time: "7 d", cost: 380, sustainability: 68, ours: false },
        { label: "Published DMSO protocol", time: "4 d", cost: 240, sustainability: 65, ours: false },
      ],
      budget: { reagentsUsd: 273, equipmentUsd: 0, totalUsd: 273, budgetCapUsd: 1000, savedUsd: 727 },
      validation: {
        primaryMetric: "Change in post-thaw viability at 2 hours and 24 hours",
        successCriteria: "Trehalose increases viability by at least 15 percentage points over the standard DMSO protocol at both checkpoints.",
        failureCriteria: [
          "Trehalose improves only the immediate viability readout but not the 24-hour outcome.",
          "Osmolarity or pre-freeze cell quality differs across arms.",
          "Recovery variance across replicates exceeds the allowable threshold.",
        ],
        decisionGates: [
          "Proceed to final claim only if both 2-hour and 24-hour viability gates pass.",
          "Reject optimization claims if pre-freeze QC between arms is not matched.",
        ],
      },
    },
    "Electrochemistry Climate": {
      steps: [
        {
          id: "step-1",
          title: "Assemble and sterilize the bioelectrochemical reactor",
          detail: "Validate electrode integrity and reference potential stability before inoculation.",
          quantity: "2 reactors",
          duration: "2 days",
          source: "JOVE",
          riskLevel: "high",
          riskNote: "Reference drift can invalidate all downstream productivity claims.",
          validationChecks: ["Verify cathode potential stability against a fresh standard before inoculation."],
          decisionGate: "Do not inoculate if the reactor cannot hold the target potential within tolerance.",
        },
        {
          id: "step-2",
          title: "Introduce Sporomusa ovata under controlled cathode potential",
          detail: "Start replicate runs with matched gas feed, pH control, and current logging.",
          quantity: "Biological duplicates",
          duration: "4 days",
          source: "Nature Protocols",
          riskLevel: "med",
          riskNote: "Gas transfer instability can create misleading acetate yields.",
          validationChecks: ["Track dissolved gas and pH every shift."],
          decisionGate: "Pause productivity benchmarking if gas transfer falls outside operating range.",
        },
        {
          id: "step-3",
          title: "Quantify acetate production and benchmark against current baselines",
          detail: "Run time-normalized acetate quantification and compare against current biocatalytic benchmarks.",
          quantity: "Daily sampling",
          duration: "3 days",
          source: "ACS climate benchmark workflow",
          riskLevel: "med",
          riskNote: "Poor normalization can overstate productivity improvements.",
          validationChecks: ["Normalize against working volume, current, and viable biomass."],
          decisionGate: "Only claim a 20% benchmark outperformance if both replicate reactors agree.",
        },
      ],
      materials: [
        { name: "Sporomusa ovata culture", catalogNumber: "DSM 2662", supplier: "DSMZ", quantity: "1 culture", unitCostUsd: 420, leadTime: "7 d", status: "order" },
        { name: "Graphite felt cathode", catalogNumber: "GF-2", supplier: "Fuel Cell Store", quantity: "2 pieces", unitCostUsd: 180, leadTime: "5 d", status: "order" },
        { name: "Reference electrode", catalogNumber: "RE-5B", supplier: "BASi", quantity: "1 unit", unitCostUsd: 205, leadTime: "3 d", status: "in-stock" },
        { name: "Acetate assay kit", catalogNumber: "K-ACETRM", supplier: "Megazyme", quantity: "1 kit", unitCostUsd: 195, leadTime: "4 d", status: "order" },
      ],
      timeline: [
        { phase: "Reactor setup and QC", durationDays: 2, dependsOn: [], owner: "Electrochemistry lead", deliverable: "Qualified reactor system" },
        { phase: "Inoculation and run stabilization", durationDays: 4, dependsOn: ["Reactor setup and QC"], owner: "Bioprocess scientist", deliverable: "Stable production run" },
        { phase: "Acetate quantification and benchmark", durationDays: 3, dependsOn: ["Inoculation and run stabilization"], owner: "Analytical chemist", deliverable: "Normalized productivity benchmark" },
      ],
      benchmark: [
        { label: "This Plan (AI)", time: "9 d", cost: 1000, sustainability: 81, ours: true },
        { label: "Lab baseline", time: "14 d", cost: 1310, sustainability: 72, ours: false },
        { label: "Published benchmark", time: "11 d", cost: 1180, sustainability: 76, ours: false },
      ],
      budget: { reagentsUsd: 1000, equipmentUsd: 240, totalUsd: 1240, budgetCapUsd: 3500, savedUsd: 2260 },
      validation: {
        primaryMetric: "Acetate production rate normalized by volume and reactor conditions",
        successCriteria: "Achieve at least 150 mmol/L/day and exceed the benchmark by at least 20%.",
        failureCriteria: [
          "Reference potential drifts outside tolerance.",
          "Replicate reactors diverge materially in output.",
          "Normalization inputs are incomplete or inconsistent.",
        ],
        decisionGates: [
          "Advance to benchmarking only after stable potential control is proven.",
          "Advance to climate-performance claim only if both replicates meet the rate target.",
        ],
      },
    },
    "Molecular Biology": {
      steps: [
        {
          id: "step-1",
          title: "Translate the hypothesis into variables, controls, and assay readouts",
          detail: "Define the intervention, matched control, success threshold, and main assay before ordering materials.",
          quantity: "1 design pass",
          duration: "4 hours",
          source: "protocols.io",
          validationChecks: ["Ensure each claim in the hypothesis maps to one measurable readout."],
          decisionGate: "Do not order materials until control and success criteria are explicitly named.",
        },
        {
          id: "step-2",
          title: "Assemble a pilot protocol and stress-test operational assumptions",
          detail: "Create a first-pass workflow with equipment, reagents, lead times, and dependencies.",
          quantity: "Pilot plan",
          duration: "1 day",
          source: "OpenWetWare",
          riskLevel: "med",
          riskNote: "Operational assumptions often fail before the science does.",
          validationChecks: ["Confirm all critical reagents have identified suppliers or inventory equivalents."],
          decisionGate: "Revise the workflow if any critical reagent has no procurement path.",
        },
        {
          id: "step-3",
          title: "Run pilot execution and capture failure modes",
          detail: "Use the smallest informative run to test feasibility before scaling.",
          quantity: "1 pilot batch",
          duration: "2 days",
          source: "Supplier application notes",
          validationChecks: ["Document all deviations, assay drift, and procurement blockers."],
          decisionGate: "Scale only if the pilot clears the agreed validation checks.",
        },
      ],
      materials: [
        { name: "Primary assay reagent bundle", catalogNumber: "CUSTOM-001", supplier: "Supplier shortlist", quantity: "1 set", unitCostUsd: 350, leadTime: "5 d", status: "order" },
      ],
      timeline: [
        { phase: "Design translation", durationDays: 1, dependsOn: [], owner: "Scientific PM", deliverable: "Structured design brief" },
        { phase: "Pilot protocol build", durationDays: 2, dependsOn: ["Design translation"], owner: "Domain scientist", deliverable: "Runnable protocol" },
        { phase: "Pilot execution", durationDays: 2, dependsOn: ["Pilot protocol build"], owner: "Lab operator", deliverable: "Feasibility readout" },
      ],
      benchmark: [
        { label: "This Plan (AI)", time: "5 d", cost: 350, sustainability: 70, ours: true },
        { label: "Lab baseline", time: "10 d", cost: 650, sustainability: 62, ours: false },
      ],
      budget: { reagentsUsd: 350, equipmentUsd: 0, totalUsd: 350, budgetCapUsd: 1500, savedUsd: 1150 },
      validation: {
        primaryMetric: "Feasibility against the stated success threshold",
        successCriteria: "The pilot shows a measurable path to the hypothesis threshold with clear operational feasibility.",
        failureCriteria: [
          "No valid control condition exists.",
          "Critical materials are unavailable.",
          "The assay cannot isolate the intervention effect.",
        ],
        decisionGates: [
          "Advance only after the pilot confirms the assay is interpretable.",
        ],
      },
    },
  };

  const template = domainPlans[domain.name] || domainPlans["Molecular Biology"];
  const budget = buildBudget(template.materials, template.budget, template.timeline, domain.name);

  return {
    experiment: {
      id: experimentId,
      project: domain.project,
      hypothesis,
      plainEnglish: domain.plainEnglish,
      domain: domain.name,
      metrics: {
        confidence: "78%",
        novelty: "Moderate",
        sustainability: "74",
      },
      novelty: noveltyFallback(hypothesis),
      materials: template.materials,
      steps: template.steps,
      timeline: template.timeline,
      budget,
      benchmark: template.benchmark,
      validation: template.validation,
      reviewAdaptations,
      sources: [
        {
          title: "protocols.io workflow",
          source: "protocols.io",
          uri: directResourceUri("protocols.io", hypothesis, hypothesis),
        },
        {
          title: "Supplier technical references",
          source: "thermofisher.com",
          uri: directResourceUri("thermofisher.com", hypothesis, hypothesis),
        },
        {
          title: "Peer protocol references",
          source: "bio-protocol.org",
          uri: directResourceUri("bio-protocol.org", hypothesis, hypothesis),
        },
      ],
    },
  };
}

async function buildParsedPlan(hypothesis, relatedReviews) {
  const domain = detectDomain(hypothesis);
  const parsed = hypothesisParseFallback(hypothesis);
  const emptyEvidencePack = { items: [], providers: [] };
  const materials = await buildMaterialsFromEvidence(parsed, hypothesis, emptyEvidencePack);
  const steps = buildDynamicSteps(parsed, emptyEvidencePack);
  const timeline = buildDynamicTimeline(steps);
  const budget = buildBudget(
    materials,
    {
      reagentsUsd: materials.reduce((sum, item) => sum + item.unitCostUsd, 0),
      equipmentUsd: 0,
      reliability: "Dynamic fallback generated from the current hypothesis only because external retrieval was unavailable.",
      assumptions: [
        "This scaffold is generated directly from the current hypothesis and does not yet include literature-backed protocol specificity.",
        "Material identities may still need manual confirmation against your lab's preferred workflow.",
      ],
    },
    timeline,
    domain.name,
  );

  return {
    experiment: {
      id: domain.id,
      project: domain.project,
      hypothesis,
      plainEnglish: domain.plainEnglish,
      domain: domain.name,
      metrics: {
        confidence: "55%",
        novelty: "unverified",
        sustainability: "65",
      },
      novelty: {
        signal: "not found",
        summary: "External retrieval was unavailable, so this plan is currently driven by the hypothesis structure rather than retrieved references.",
        references: [],
      },
      materials,
      steps,
      timeline,
      budget,
      benchmark: buildDynamicBenchmark(timeline.reduce((sum, phase) => sum + phase.durationDays, 0), budget),
      validation: {
        primaryMetric: parsed.outcome || "Primary assay readout",
        successCriteria: `Meet the stated hypothesis threshold (${parsed.threshold || "see hypothesis"}) with a clear intervention-versus-control separation.`,
        failureCriteria: [
          "The intervention, control, or assay mapping is still ambiguous.",
          "Critical materials cannot be sourced or validated.",
          "Pilot data do not produce an interpretable signal.",
        ],
        decisionGates: steps.map((step) => step.decisionGate).filter(Boolean),
      },
      reviewAdaptations: relatedReviews.map((review) => ({
        section: review.section,
        change: review.correction,
        impact: "Applied to the regenerated plan as an explicit guardrail or decision gate.",
      })),
      sources: [],
    },
  };
}

async function parseHypothesis(hypothesis) {
  const domain = detectDomain(hypothesis);
  if (!geminiApiKey) {
    return hypothesisParseFallback(hypothesis);
  }

  const schema = {
    type: "OBJECT",
    properties: {
      hypothesis: { type: "STRING" },
      intervention: { type: "STRING" },
      subject: { type: "STRING" },
      outcome: { type: "STRING" },
      threshold: { type: "STRING" },
      mechanism: { type: "STRING" },
      control: { type: "STRING" },
      domain: { type: "STRING" },
    },
    required: ["hypothesis", "intervention", "subject", "outcome", "threshold", "mechanism", "control", "domain"],
  };

  const prompt = `
You are extracting structure from a scientific hypothesis for an AI experiment planning system.
Return only JSON matching the schema.
Be concrete, concise, and operational.
If the control condition is implicit, infer the most defensible standard control.
Preserve thresholds, units, and comparators.

Hypothesis:
${hypothesis}

Preferred experiment family:
${domain.name}
`;

  try {
    const { data } = await callGemini({ prompt, schema, grounded: false });
    return data;
  } catch {
    return hypothesisParseFallback(hypothesis);
  }
}

async function literatureQc(hypothesis) {
  const evidencePack = await retrieveEvidencePack(hypothesis).catch(() => ({ items: [] }));
  const apiNovelty = evidenceNovelty(hypothesis, evidencePack);

  if (!geminiApiKey) {
    return apiNovelty;
  }

  const schema = {
    type: "OBJECT",
    properties: {
      signal: { type: "STRING", enum: ["not found", "similar work exists", "exact match found"] },
      summary: { type: "STRING" },
    },
    required: ["signal", "summary"],
  };

  const prompt = `
You are doing fast literature quality control for a scientist.
Use Google Search grounding to determine whether the exact experiment or something close has been done before.
Prioritize protocol repositories, primary papers, and scientific sources.
Prefer protocols.io, Bio-protocol, Nature Protocols, JoVE, OpenWetWare, PubMed-linked papers, ATCC, Addgene, Thermo Fisher, Sigma-Aldrich, Promega, Qiagen, and IDT when relevant.
Classify conservatively:
- "exact match found" only if the intervention, system, assay, and outcome threshold substantially match
- "similar work exists" if adjacent or highly similar workflows exist
- "not found" only if grounded search does not reveal a credible close precedent
Return only JSON matching the schema.

Hypothesis:
${hypothesis}
`;

  try {
    const { data, references } = await callGemini({ prompt, schema, grounded: true });
    return {
      signal: data.signal,
      summary: data.summary,
      references:
        references.length > 0
          ? references.slice(0, 3)
          : apiNovelty.references,
    };
  } catch {
    return apiNovelty;
  }
}

async function generatePlan(hypothesis) {
  const domain = detectDomain(hypothesis);
  const experimentId = domain.id;
  const relatedReviews = relatedReviewsForHypothesis(hypothesis, experimentId);
  let fallback;

  try {
    fallback = await buildEvidenceBackedPlan(hypothesis, relatedReviews);
  } catch {
    fallback = await buildParsedPlan(hypothesis, relatedReviews);
  }

  if (!geminiApiKey) {
    return fallback;
  }

  const schema = {
    type: "OBJECT",
    properties: {
      project: { type: "STRING" },
      plainEnglish: { type: "STRING" },
      confidence: { type: "STRING" },
      noveltyLevel: { type: "STRING" },
      sustainability: { type: "STRING" },
      materials: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            name: { type: "STRING" },
            catalogNumber: { type: "STRING" },
            supplier: { type: "STRING" },
            quantity: { type: "STRING" },
            unitCostUsd: { type: "NUMBER" },
            leadTime: { type: "STRING" },
            status: { type: "STRING", enum: ["owned", "in-stock", "order"] },
            notes: { type: "STRING" },
          },
          required: ["name", "catalogNumber", "supplier", "quantity", "unitCostUsd", "leadTime", "status", "notes"],
        },
      },
      steps: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            id: { type: "STRING" },
            title: { type: "STRING" },
            detail: { type: "STRING" },
            quantity: { type: "STRING" },
            duration: { type: "STRING" },
            source: { type: "STRING" },
            riskLevel: { type: "STRING", enum: ["low", "med", "high"] },
            riskNote: { type: "STRING" },
            validationChecks: { type: "ARRAY", items: { type: "STRING" } },
            decisionGate: { type: "STRING" },
          },
          required: ["id", "title", "detail", "quantity", "duration", "source", "riskLevel", "riskNote", "validationChecks", "decisionGate"],
        },
      },
      timeline: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            phase: { type: "STRING" },
            durationDays: { type: "NUMBER" },
            dependsOn: { type: "ARRAY", items: { type: "STRING" } },
            owner: { type: "STRING" },
            deliverable: { type: "STRING" },
          },
          required: ["phase", "durationDays", "dependsOn", "owner", "deliverable"],
        },
      },
      benchmark: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            label: { type: "STRING" },
            time: { type: "STRING" },
            cost: { type: "NUMBER" },
            sustainability: { type: "NUMBER" },
            ours: { type: "BOOLEAN" },
          },
          required: ["label", "time", "cost", "sustainability", "ours"],
        },
      },
      budget: {
        type: "OBJECT",
        properties: {
          reagentsUsd: { type: "NUMBER" },
          equipmentUsd: { type: "NUMBER" },
          shippingUsd: { type: "NUMBER" },
          laborUsd: { type: "NUMBER" },
          contingencyUsd: { type: "NUMBER" },
          totalUsd: { type: "NUMBER" },
          budgetCapUsd: { type: "NUMBER" },
          savedUsd: { type: "NUMBER" },
          reliability: { type: "STRING" },
          assumptions: {
            type: "ARRAY",
            items: { type: "STRING" },
          },
          lineItems: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                label: { type: "STRING" },
                amountUsd: { type: "NUMBER" },
                category: { type: "STRING", enum: ["reagents", "equipment", "shipping", "labor", "contingency"] },
                note: { type: "STRING" },
              },
              required: ["label", "amountUsd", "category"],
            },
          },
        },
        required: ["reagentsUsd", "equipmentUsd", "totalUsd", "budgetCapUsd", "savedUsd"],
      },
      validation: {
        type: "OBJECT",
        properties: {
          primaryMetric: { type: "STRING" },
          successCriteria: { type: "STRING" },
          failureCriteria: { type: "ARRAY", items: { type: "STRING" } },
          decisionGates: { type: "ARRAY", items: { type: "STRING" } },
        },
        required: ["primaryMetric", "successCriteria", "failureCriteria", "decisionGates"],
      },
      reviewAdaptations: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            section: { type: "STRING" },
            change: { type: "STRING" },
            impact: { type: "STRING" },
          },
          required: ["section", "change", "impact"],
        },
      },
    },
    required: ["project", "plainEnglish", "confidence", "noveltyLevel", "sustainability", "materials", "steps", "timeline", "benchmark", "budget", "validation", "reviewAdaptations"],
  };

  const prompt = `
You are refining an operational experiment plan for a scientist.
Return only JSON matching the schema.

Important constraints:
- Do not invent protocols, suppliers, or budget line items from general intuition.
- Use the retrieved literature metadata and evidence-backed scaffold below as the source of truth.
- You may reorganize, tighten, or clarify the scaffold, but do not replace it with generic or unsupported content.
- If evidence is incomplete, preserve the uncertainty as a validation gate, procurement note, or budget assumption.

Goals:
- Make the plan runnable by a real lab.
- Keep materials specific to the retrieved evidence and hypothesis variables.
- Keep budget operationally realistic and tied to the listed materials, staffing, shipping, and contingency.
- Incorporate prior review memory so the next plan visibly improves.
- Prefer operational realism over breadth.
- Every step should have a measurable check or go/no-go decision.
- Make timelines dependency-aware and role-aware.
- Avoid vague phrases like "optimize as needed" or "standard procedure".

Hypothesis:
${hypothesis}

Plain-English framing:
${domain.plainEnglish}

Retrieved literature evidence:
${JSON.stringify(fallback.experiment.sources)}

Evidence-backed scaffold to refine:
${JSON.stringify({
    materials: fallback.experiment.materials,
    steps: fallback.experiment.steps,
    timeline: fallback.experiment.timeline,
    budget: fallback.experiment.budget,
    benchmark: fallback.experiment.benchmark,
    validation: fallback.experiment.validation,
  })}

Prior review memory to apply:
${JSON.stringify(relatedReviews)}

Output style:
- 3 to 5 protocol steps
- focus materials on critical reagents and assay-enabling items
- validation language should sound like a lab deciding whether to continue
- benchmark rows should compare against realistic baselines
`;

  let novelty;
  let generated;

  try {
    [novelty, generated] = await Promise.all([
      literatureQc(hypothesis),
      callGemini({ prompt, schema, grounded: false }),
    ]);
  } catch {
    return fallback;
  }

  const references = fallback.experiment.sources;
  const data = generated.data;

  // Enrich Gemini-generated materials with PubChem CIDs server-side.
  // Gemini's schema does not include pubchemCid/molecularFormula, so we resolve
  // them here — same approach as buildMaterialsFromEvidence in the fallback path.
  let enrichedGeminiMaterials = null;
  if (data.materials?.length) {
    const compounds = await Promise.all(
      data.materials.map((m) => fetchPubChemCompoundByName(m.name).catch(() => null)),
    );
    enrichedGeminiMaterials = data.materials.map((mat, i) => {
      const compound = compounds[i];
      if (!compound) return mat;
      return {
        ...mat,
        pubchemCid: compound.cid,
        molecularFormula: compound.molecularFormula || mat.molecularFormula,
        molecularWeight: compound.molecularWeight ?? mat.molecularWeight,
        canonicalSmiles: compound.canonicalSmiles || mat.canonicalSmiles,
        iupacName: compound.iupacName || mat.iupacName,
      };
    });
  }
  const materials = enrichedGeminiMaterials ?? fallback.experiment.materials;
  const timeline = data.timeline?.length ? data.timeline : fallback.experiment.timeline;
  const budget = buildBudget(materials, data.budget || fallback.experiment.budget, timeline, domain.name);

  return {
    experiment: {
      id: experimentId,
      project: data.project || domain.project,
      hypothesis,
      plainEnglish: data.plainEnglish || domain.plainEnglish,
      domain: domain.name,
      metrics: {
        confidence: data.confidence || "80%",
        novelty: data.noveltyLevel || novelty.signal,
        sustainability: data.sustainability || "70",
      },
      novelty,
      materials,
      steps: data.steps?.length ? data.steps : fallback.experiment.steps,
      timeline,
      budget,
      benchmark: data.benchmark?.length ? data.benchmark : fallback.experiment.benchmark,
      validation: data.validation || fallback.experiment.validation,
      reviewAdaptations: data.reviewAdaptations?.length
        ? data.reviewAdaptations
        : fallback.experiment.reviewAdaptations,
      sources: references,
    },
  };
}

function knowledgeGraphContext(plan, reviews) {
  const domain = detectDomain(plan.experiment.hypothesis);
  const parsed = hypothesisParseFallback(plan.experiment.hypothesis);
  const materialNodes = plan.experiment.materials.slice(0, 6).map((material, index) => ({
    id: `material-${index + 1}`,
    type: "material",
    label: `${material.name} (${material.catalogNumber})`,
    supplier: material.supplier,
    status: material.status,
  }));
  const stepNodes = plan.experiment.steps.map((step, index) => ({
    id: `step-${index + 1}`,
    type: "protocol_step",
    label: step.title,
    source: step.source,
  }));
  const sourceNodes = plan.experiment.sources.slice(0, 6).map((source, index) => ({
    id: `source-${index + 1}`,
    type: "source",
    label: source.title,
    uri: source.uri || "",
  }));
  const reviewNodes = reviews.map((review, index) => ({
    id: `review-${index + 1}`,
    type: "review",
    label: `${review.section}: ${review.reviewer}`,
    severity: review.severity,
  }));

  return {
    experimentId: plan.experiment.id,
    nodes: [
      { id: "hypothesis", type: "hypothesis", label: plan.experiment.hypothesis },
      { id: "domain", type: "domain", label: plan.experiment.domain },
      { id: "intervention", type: "intervention", label: parsed.intervention },
      { id: "subject", type: "subject", label: parsed.subject },
      { id: "control", type: "control", label: parsed.control },
      { id: "outcome", type: "outcome", label: parsed.outcome },
      { id: "threshold", type: "threshold", label: parsed.threshold },
      { id: "metric", type: "metric", label: plan.experiment.validation.primaryMetric },
      ...materialNodes,
      ...stepNodes,
      ...sourceNodes,
      ...reviewNodes,
    ],
    edges: [
      { source: "hypothesis", target: "domain", relation: "categorized_as" },
      { source: "hypothesis", target: "intervention", relation: "tests" },
      { source: "hypothesis", target: "subject", relation: "evaluated_in" },
      { source: "hypothesis", target: "control", relation: "compared_against" },
      { source: "hypothesis", target: "outcome", relation: "measures" },
      { source: "hypothesis", target: "threshold", relation: "targets" },
      { source: "hypothesis", target: "metric", relation: "evaluated_by" },
      ...materialNodes.map((material) => ({
        source: "hypothesis",
        target: material.id,
        relation: "requires",
      })),
      ...stepNodes.map((step, index) => ({
        source: index === 0 ? "hypothesis" : `step-${index}`,
        target: step.id,
        relation: index === 0 ? "starts_with" : "followed_by",
      })),
      ...stepNodes.flatMap((step) =>
        sourceNodes.slice(0, 2).map((source) => ({
          source: step.id,
          target: source.id,
          relation: "grounded_by",
        })),
      ),
      ...reviewNodes.map((review) => ({
        source: review.id,
        target: "hypothesis",
        relation: "refines",
      })),
    ],
    tags: domain.tags,
    parsedHypothesis: parsed,
    materials: plan.experiment.materials,
    protocolSteps: plan.experiment.steps.map((step) => ({
      id: step.id,
      title: step.title,
      rationale: step.decisionGate || step.detail,
    })),
    validation: plan.experiment.validation,
    sources: plan.experiment.sources,
    reviews,
  };
}

function chatFallbackAnswer(question, experiment, reviews) {
  const lower = question.toLowerCase();
  const firstGate = experiment.validation?.decisionGates?.[0] || "Review the first validation gate before moving to procurement.";
  const firstRiskyMaterial = [...(experiment.materials || [])].sort((a, b) => b.unitCostUsd - a.unitCostUsd)[0];
  const latestReview = reviews[0];

  if (lower.includes("review")) {
    return latestReview
      ? `The latest scientist correction focuses on ${latestReview.section.toLowerCase()}: "${latestReview.correction}" In the current plan, that should be treated as an explicit guardrail before the next execution round.`
      : "No scientist review note is stored yet, so the next best step is to annotate one concrete protocol or budget correction and regenerate.";
  }

  if (lower.includes("material") || lower.includes("supply")) {
    return firstRiskyMaterial
      ? `${firstRiskyMaterial.name} looks like the most operationally sensitive dependency because it combines a visible cost with a ${firstRiskyMaterial.leadTime} lead time from ${firstRiskyMaterial.supplier}.`
      : "The current plan does not isolate a single blocking material yet, so check the ordering list and cold-chain dependencies before purchase.";
  }

  if (lower.includes("budget") || lower.includes("cost")) {
    return `The current operational budget is ${experiment.budget?.totalUsd ?? 0} USD before region-specific adjustment. The fastest way to avoid wasted spend is to test this gate first: ${firstGate}`;
  }

  if (lower.includes("weak") || lower.includes("fail") || lower.includes("risk")) {
    return `The riskiest part of the current plan is the earliest stop/go gate: ${firstGate} A scientist should validate that assumption before trusting the rest of the workflow.`;
  }

  return `Start with the earliest decision gate: ${firstGate} After that, verify the most expensive or slowest material dependency and fold in the latest scientist correction before ordering.`;
}

async function chatReply(question, hypothesis, reviews, planContext) {
  const plan = planContext
    ? {
        experiment: {
          id: detectDomain(hypothesis).id,
          hypothesis,
          domain: planContext.domain || detectDomain(hypothesis).name,
          novelty: planContext.novelty || { signal: "not found", summary: "No novelty context was supplied for chat.", references: [] },
          validation: planContext.validation || { primaryMetric: "", successCriteria: "", failureCriteria: [], decisionGates: [] },
          reviewAdaptations: planContext.reviewAdaptations || [],
          materials: planContext.materials || planContext.keyMaterials || [],
          budget: planContext.budget || { totalUsd: 0, savedUsd: 0 },
          sources: planContext.sources || [],
        },
      }
    : await generatePlan(hypothesis);

  if (!geminiApiKey) {
    return {
      answer: chatFallbackAnswer(question, plan.experiment, reviews),
      citations: plan.experiment.sources.slice(0, 2).map((source) => ({
        title: source.title,
        source: source.source,
        uri: source.uri,
      })),
      followUps: [
        "Which validation gate is most likely to fail first?",
        "How did prior scientist reviews change this plan?",
      ],
      mode: "fallback",
    };
  }

  const schema = {
    type: "OBJECT",
    properties: {
      answer: { type: "STRING" },
      followUps: {
        type: "ARRAY",
        items: { type: "STRING" },
      },
    },
    required: ["answer", "followUps"],
  };

  const prompt = `
You are a scientist-facing copilot grounded in an experiment plan.
Answer the user's question crisply and operationally.
Prioritize:
1. validation gates
2. material or timeline risk
3. what prior reviews changed
4. what the scientist should do next
Do not be generic or restate the whole plan.
Return only JSON matching the schema.

Question:
${question}

Hypothesis:
${hypothesis}

Current plan summary:
${JSON.stringify({
  domain: plan.experiment.domain,
  novelty: plan.experiment.novelty,
  validation: plan.experiment.validation,
  reviewAdaptations: plan.experiment.reviewAdaptations,
  keyMaterials: plan.experiment.materials.slice(0, 4),
})}

Review memory:
${JSON.stringify(reviews)}
`;

  try {
    const { data, references } = await callGemini({ prompt, schema, grounded: true });
    return {
      answer: data.answer,
      citations: references.slice(0, 3).map((reference) => ({
        title: reference.title,
        source: reference.source,
        uri: reference.uri || directResourceUri(reference.source, reference.title, hypothesis),
      })),
      followUps: data.followUps || [],
      mode: "grounded",
    };
  } catch {
    return {
      answer: chatFallbackAnswer(question, plan.experiment, reviews),
      citations: plan.experiment.sources.slice(0, 2).map((source) => ({
        title: source.title,
        source: source.source,
        uri: source.uri,
      })),
      followUps: [
        "Which validation gate is most likely to fail first?",
        "What changed because of prior reviews?",
      ],
      mode: "fallback",
    };
  }
}

createServer(async (request, response) => {
  if (!request.url) {
    sendJson(response, 400, { error: "Missing request URL" });
    return;
  }

  if (request.method === "OPTIONS") {
    sendJson(response, 204, {});
    return;
  }

  const url = new URL(request.url, `http://127.0.0.1:${port}`);

  try {
    const requireHypothesis = () => {
      throw new Error("A hypothesis is required for this endpoint.");
    };

    if (request.method === "GET" && url.pathname === "/api/health") {
      sendJson(response, 200, {
        status: "ok",
        service: "agentic-labmate-api",
        provider: geminiApiKey ? "gemini" : "fallback",
        model: geminiModel,
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/contracts") {
      sendJson(response, 200, apiContracts);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/experiments/parse") {
      const body = await readBody(request);
      const hypothesis = body.hypothesis || requireHypothesis();
      sendJson(response, 200, await parseHypothesis(hypothesis));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/literature/qc") {
      const body = await readBody(request);
      const hypothesis = body.hypothesis || requireHypothesis();
      sendJson(response, 200, await literatureQc(hypothesis));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/experiments/plan") {
      const body = await readBody(request);
      const hypothesis = body.hypothesis || requireHypothesis();
      sendJson(response, 200, await generatePlan(hypothesis));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/chat") {
      const body = await readBody(request);
      const hypothesis = body.hypothesis || requireHypothesis();
      const experimentId = body.experimentId || detectDomain(hypothesis).id;
      const requestReviews = Array.isArray(body.reviews) ? body.reviews : [];
      const reviews = requestReviews.length > 0 ? requestReviews : relatedReviewsForHypothesis(hypothesis, experimentId);
      sendJson(response, 200, await chatReply(body.question || "", hypothesis, reviews, body.planContext));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/compound/resolve") {
      const name = (url.searchParams.get("name") || "").trim();
      if (!name) {
        sendJson(response, 400, { error: "Missing query parameter: name" });
        return;
      }
      sendJson(response, 200, await resolveCompoundVisual(name));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/compound/sdf") {
      const cidParam = url.searchParams.get("cid");
      const type = url.searchParams.get("type") === "3d" ? "3d" : "2d";
      const name = (url.searchParams.get("name") || "").trim();
      const cid = parseInt(cidParam || "", 10);
      if (!cid || isNaN(cid)) {
        response.writeHead(400, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "Missing or invalid cid parameter" }));
        return;
      }
      const sdf = await fetchSdfByCid(cid, type, name);
      if (!sdf) {
        // Try 2D fallback if 3D was requested and not available
        const fallback = type === "3d" ? await fetchSdfByCid(cid, "2d", name) : null;
        if (!fallback) {
          response.writeHead(404, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ error: `No SDF available for CID ${cid}` }));
          return;
        }
        response.writeHead(200, {
          "Content-Type": "chemical/x-mdl-sdfile",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=1800",
        });
        response.end(fallback);
        return;
      }
      response.writeHead(200, {
        "Content-Type": "chemical/x-mdl-sdfile",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=1800",
      });
      response.end(sdf);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/reviews") {
      const experimentId = url.searchParams.get("experimentId");
      const reviews = experimentId
        ? reviewStore.filter((review) => review.experimentId === experimentId)
        : reviewStore;
      sendJson(response, 200, reviews);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/reviews") {
      const body = await readBody(request);
      const review = {
        experimentId: body.experimentId || "custom-experiment",
        section: body.section || "General",
        reviewer: body.reviewer || "Scientist reviewer",
        correction: body.correction || "No correction provided.",
        severity: body.severity || "medium",
        domain: body.domain || undefined,
        hypothesis: body.hypothesis || undefined,
        tags: Array.isArray(body.tags) ? body.tags : [],
      };
      reviewStore.unshift(review);
      persistReviewStore();
      sendJson(response, 201, review);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/knowledge-graph/context") {
      const hypothesis = url.searchParams.get("hypothesis") || requireHypothesis();
      const plan = await generatePlan(hypothesis);
      const reviews = reviewStore.filter((review) => review.experimentId === plan.experiment.id);
      sendJson(response, 200, knowledgeGraphContext(plan, reviews));
      return;
    }

    sendJson(response, 404, { error: `Route not found: ${request.method} ${url.pathname}` });
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : "Unknown server error",
    });
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`API listening on http://127.0.0.1:${port}`);
});
