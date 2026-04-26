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

function hypothesisParseFallback(hypothesis) {
  const domain = detectDomain(hypothesis);
  return {
    hypothesis,
    intervention: "Primary intervention extracted from hypothesis",
    subject: domain.project,
    outcome: "Primary measured outcome",
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
  return "Scientific supplier API";
}

function keywordCost(label = "") {
  const lower = label.toLowerCase();

  if (/(cell|culture|animal|mice|reactor)/.test(lower)) return 420;
  if (/(antibody|assay|kit|viability|electrode)/.test(lower)) return 220;
  if (/(trehalose|dmso|buffer|dextran|reagent)/.test(lower)) return 85;
  return 160;
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
    { pattern: /carbon dioxide|\bco2\b/, label: "Carbon dioxide feed" },
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

function inferQuantity(label = "", index = 0) {
  const lower = label.toLowerCase();

  if (/(cell|culture|mice|mouse)/.test(lower)) return "1 lot";
  if (/(antibody|kit|assay)/.test(lower)) return "1 kit";
  if (/(trehalose|dmso|dextran|buffer|reagent)/.test(lower)) return "1 bottle";
  if (/(co2|carbon dioxide|electrode|reactor|substrate)/.test(lower)) return index === 0 ? "1 setup" : "1 unit";
  return index === 0 ? "1 lot" : "1 unit";
}

function inferLeadTime(label = "") {
  const lower = label.toLowerCase();

  if (/(cell|culture|mice|mouse|sporomusa)/.test(lower)) return "4-7 d";
  if (/(antibody|kit|assay|electrode)/.test(lower)) return "3-5 d";
  if (/(trehalose|dmso|dextran|buffer|reagent|co2)/.test(lower)) return "2-4 d";
  return "3-5 d";
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
  const encodedName = encodeURIComponent(name.trim());
  if (!encodedName) {
    return null;
  }

  const json = await fetchJson(
    `${pubchemApiUrl}/compound/name/${encodedName}/property/Title,MolecularFormula,MolecularWeight,CanonicalSMILES,IUPACName/JSON`,
  ).catch(() => null);

  const properties = json?.PropertyTable?.Properties;
  const property = Array.isArray(properties) ? properties[0] : null;
  if (!property?.CID) {
    return null;
  }

  return {
    cid: property.CID,
    title: property.Title || name,
    molecularFormula: property.MolecularFormula || "",
    molecularWeight: typeof property.MolecularWeight === "number" ? property.MolecularWeight : null,
    canonicalSmiles: property.CanonicalSMILES || "",
    iupacName: property.IUPACName || "",
    url: `https://pubchem.ncbi.nlm.nih.gov/compound/${property.CID}`,
  };
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
        ? "External literature APIs found related studies and protocols, but the exact intervention-outcome combination still needs scientist review."
        : "No close precedent was found in the connected literature APIs, so this may represent a more novel workflow or a weak retrieval result that needs manual review.";

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

    return {
      name: compound?.title || label,
      catalogNumber: compound?.cid ? `CID-${compound.cid}` : `${slugCatalog(label)}-${index + 1}`,
      supplier: compound ? "PubChem" : fallbackSource,
      quantity: inferQuantity(label, index),
      unitCostUsd: keywordCost(label),
      leadTime: inferLeadTime(label),
      status: index === 0 ? "order" : index === 1 ? "in-stock" : /dmso|trehalose|buffer|co2/.test(label.toLowerCase()) ? "in-stock" : "order",
      notes: compound
        ? "Matched to a live PubChem compound record and ranked against retrieved literature evidence."
        : "Derived from retrieved literature and hypothesis structure; no PubChem compound match was found.",
      pubchemCid: compound?.cid,
      molecularFormula: compound?.molecularFormula || undefined,
      molecularWeight: compound?.molecularWeight || undefined,
      canonicalSmiles: compound?.canonicalSmiles || undefined,
      iupacName: compound?.iupacName || undefined,
      sourceUri: compound?.url || undefined,
    };
  });
}

function buildDynamicSteps(parsed, evidencePack) {
  const firstRef = evidencePack.items[0];
  const secondRef = evidencePack.items[1];
  const assay = parsed.outcome || "primary readout";
  const protocolRef = evidencePack.items.find((item) => item.source === "protocols.io");
  const protocolContext = protocolRef
    ? [protocolRef.protocolDescription, protocolRef.protocolBeforeStart, protocolRef.protocolMaterials]
        .filter(Boolean)
        .join(" ")
        .slice(0, 260)
    : "";

  return [
    {
      id: "step-1",
      title: "Confirm the experimental arms against retrieved precedent",
      detail: `Translate the hypothesis into an intervention arm (${parsed.intervention}) and a control arm (${parsed.control}) in the target system (${parsed.subject}). ${
        protocolContext
          ? `Use the retrieved protocol context "${protocolContext}" to sanity-check whether the assay context matches the proposed experiment.`
          : "Use the closest retrieved paper to sanity-check whether the assay context matches the proposed experiment."
      }`,
      quantity: "1 design review",
      duration: "4 hours",
      source: firstRef?.source || "literature API",
      sourceUri: firstRef?.url || evidenceUrl(firstRef),
      sourceTitle: firstRef?.title,
      riskLevel: "med",
      riskNote: "If the retrieved precedent differs materially from the proposed biological system or assay, the downstream workflow may not transfer cleanly.",
      validationChecks: [
        "Confirm the intervention, control, and assay endpoint all appear in the retrieved reference set.",
      ],
      decisionGate: "Do not order materials until the scientist confirms the retrieved precedent is close enough to justify the planned assay.",
    },
    {
      id: "step-2",
      title: "Assemble materials and setup around the retrieved workflow",
      detail: `Procure the primary intervention material, the biological system, and the assay reagents needed to measure ${assay}. ${
        protocolRef?.protocolMaterials
          ? `Prioritize materials explicitly surfaced by the retrieved protocol: ${protocolRef.protocolMaterials.slice(0, 220)}.`
          : "Match setup choices to the retrieved protocol family instead of assuming local defaults."
      }`,
      quantity: "Critical-path materials",
      duration: "1 day",
      source: secondRef?.source || firstRef?.source || "literature API",
      sourceUri: secondRef?.url || evidenceUrl(secondRef) || protocolRef?.url,
      sourceTitle: secondRef?.title || firstRef?.title,
      riskLevel: "med",
      riskNote: "Materials inferred from literature metadata can still mismatch the exact reagent format or instrument model available in the lab.",
      validationChecks: [
        "Verify every critical material has an identified supplier and acceptable lead time.",
      ],
      decisionGate: "Pause execution if a critical reagent or system component cannot be matched to the intended workflow.",
    },
    {
      id: "step-3",
      title: "Run the primary assay and record threshold-linked outcomes",
      detail: `Execute the intervention and control arms in matched conditions, then capture the primary outcome (${assay}) with the threshold specified in the hypothesis.`,
      quantity: "Pilot batch",
      duration: "2 days",
      source: firstRef?.source || "literature API",
      sourceUri: firstRef?.url || evidenceUrl(firstRef),
      sourceTitle: firstRef?.title,
      riskLevel: "high",
      riskNote: "The biggest scientific risk is measuring the right endpoint with the wrong timing, normalization, or control condition.",
      validationChecks: [
        "Confirm the measured endpoint can distinguish intervention from control before scaling.",
      ],
      decisionGate: "Advance only if the pilot data show an interpretable signal in the same direction as the hypothesis.",
    },
    {
      id: "step-4",
      title: "Benchmark against retrieved literature and review corrections",
      detail: "Compare the observed execution assumptions, timeline, and assay behavior against the retrieved references and any stored scientist review notes before deciding the next iteration.",
      quantity: "1 review pass",
      duration: "4 hours",
      source: secondRef?.source || firstRef?.source || "literature API",
      sourceUri: secondRef?.url || evidenceUrl(secondRef) || firstRef?.url || evidenceUrl(firstRef),
      sourceTitle: secondRef?.title || firstRef?.title,
      riskLevel: "med",
      riskNote: "A plan can look scientifically plausible yet still fail operationally if timing, variance, or procurement issues diverge from precedent.",
      validationChecks: [
        "Document any divergence from retrieved literature and mark whether it is a scientific choice or an operational constraint.",
      ],
      decisionGate: "Do not claim success until the observed data and execution constraints are both consistent with the retrieved evidence.",
    },
  ];
}

function buildDynamicTimeline(steps) {
  return steps.map((step, index) => ({
    phase: step.title,
    durationDays: step.duration.includes("hour") ? 1 : step.duration.includes("2 days") ? 2 : step.duration.includes("1 day") ? 1 : 2,
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
  const steps = buildDynamicSteps(parsed, evidencePack);
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
  const materials = data.materials?.length ? data.materials : fallback.experiment.materials;
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
