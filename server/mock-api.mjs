import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { URL } from "node:url";

loadEnvFile(".env.local");

const port = Number(process.env.PORT || 8787);
const geminiApiKey = process.env.GEMINI_API_KEY || "";
const geminiModel = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const reviewStore = [
  {
    experimentId: "diagnostics-paper-crp",
    section: "Sample handling",
    reviewer: "Dr. Patel",
    correction: "Explicitly cap hemolysis risk and add a plasma-separation fallback if whole blood noise exceeds the detection threshold.",
    severity: "high",
  },
  {
    experimentId: "cell-biology-trehalose",
    section: "Cryopreservation step",
    reviewer: "M. Chen",
    correction: "Add a viability gate at 2 hours post-thaw before committing to the 24-hour assay.",
    severity: "medium",
  },
];

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

const defaultHypothesis =
  "A paper-based electrochemical biosensor functionalized with anti-CRP antibodies will detect C-reactive protein in whole blood at concentrations below 0.5 mg/L within 10 minutes, matching laboratory ELISA sensitivity without requiring sample preprocessing.";

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
      steps: [
        {
          id: "step-1",
          title: "Fabricate the paper electrode strips",
          detail: "Pattern conductive electrodes on cellulose substrate and dry under controlled humidity before antibody functionalization.",
          quantity: "24 strips",
          duration: "1 day",
          source: "protocols.io",
          riskLevel: "med",
          riskNote: "Humidity drift can destabilize strip conductivity and inflate baseline noise.",
          validationChecks: ["Confirm baseline impedance variation stays below 10% across strips."],
          decisionGate: "Do not proceed to antibody functionalization unless at least 80% of strips pass impedance QC.",
        },
        {
          id: "step-2",
          title: "Immobilize anti-CRP antibodies and block nonspecific binding",
          detail: "Use a consistent immobilization window and protein blocking step to protect specificity in whole-blood samples.",
          quantity: "24 strips",
          duration: "6 hours",
          source: "Bio-protocol",
          riskLevel: "high",
          riskNote: "Poor blocking increases whole-blood matrix interference and false positives.",
          validationChecks: ["Run blank blood controls and reject batches with high nonspecific current."],
          decisionGate: "Repeat blocking optimization if blank control exceeds the current threshold by more than 15%.",
        },
        {
          id: "step-3",
          title: "Calibrate with CRP standards and contrived whole-blood samples",
          detail: "Generate a standard curve spanning the target threshold and compare with an ELISA reference panel.",
          quantity: "8 concentrations",
          duration: "1 day",
          source: "thermofisher.com",
          riskLevel: "med",
          riskNote: "Inadequate calibration range can hide poor performance near the target limit of detection.",
          validationChecks: ["Require R2 greater than 0.95 and accuracy within 15% around 0.5 mg/L."],
          decisionGate: "Abort patient-like sample testing if the sensor cannot separate 0.5 mg/L from blank within 10 minutes.",
        },
      ],
      materials: [
        { name: "Cellulose paper substrate", catalogNumber: "WHA1001-150", supplier: "Cytiva", quantity: "150 sheets", unitCostUsd: 48, leadTime: "3 d", status: "order" },
        { name: "Screen-printable carbon ink", catalogNumber: "C2130809D5", supplier: "Gwent", quantity: "1 jar", unitCostUsd: 190, leadTime: "5 d", status: "order" },
        { name: "Anti-CRP antibody", catalogNumber: "MA1-82376", supplier: "Thermo Fisher", quantity: "100 ug", unitCostUsd: 325, leadTime: "2 d", status: "in-stock" },
        { name: "BSA blocking reagent", catalogNumber: "A2153", supplier: "Sigma-Aldrich", quantity: "25 g", unitCostUsd: 42, leadTime: "in lab", status: "owned" },
      ],
      timeline: [
        { phase: "Strip fabrication and QC", durationDays: 2, dependsOn: [], owner: "Assay engineer", deliverable: "Qualified paper electrodes" },
        { phase: "Antibody functionalization", durationDays: 1, dependsOn: ["Strip fabrication and QC"], owner: "Bioassay scientist", deliverable: "Functionalized sensor batch" },
        { phase: "Calibration and ELISA benchmark", durationDays: 2, dependsOn: ["Antibody functionalization"], owner: "Analytical scientist", deliverable: "Performance curve and benchmark readout" },
      ],
      benchmark: [
        { label: "This Plan (AI)", time: "5 d", cost: 605, sustainability: 76, ours: true },
        { label: "Lab baseline", time: "9 d", cost: 980, sustainability: 61, ours: false },
        { label: "ELISA-only workflow", time: "3 d", cost: 1220, sustainability: 54, ours: false },
      ],
      budget: { reagentsUsd: 605, equipmentUsd: 120, totalUsd: 725, budgetCapUsd: 2000, savedUsd: 1275 },
      validation: {
        primaryMetric: "Limit of detection and time-to-result in whole blood",
        successCriteria: "Detect CRP below 0.5 mg/L within 10 minutes while matching ELISA sensitivity within agreed error bounds.",
        failureCriteria: [
          "Blank or matrix controls exceed the acceptable current noise band.",
          "Limit of detection remains above 0.5 mg/L after calibration optimization.",
          "Time-to-result exceeds 10 minutes for the validated concentration range.",
        ],
        decisionGates: [
          "Advance to whole-blood testing only if strip-to-strip baseline variation is below 10%.",
          "Advance to benchmark comparison only if calibration R2 is greater than 0.95.",
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
  if (!geminiApiKey) {
    return noveltyFallback(hypothesis);
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
      references: references.slice(0, 3),
    };
  } catch {
    return noveltyFallback(hypothesis);
  }
}

async function generatePlan(hypothesis) {
  const domain = detectDomain(hypothesis);
  const experimentId = domain.id;
  const relatedReviews = reviewStore.filter((review) => review.experimentId === experimentId);
  const fallback = planFallback(hypothesis);

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
You are generating an operational experiment plan for a scientist.
Use Google Search grounding. Prioritize protocols.io, Bio-protocol, Nature Protocols, JoVE, OpenWetWare, ATCC, Addgene, Thermo Fisher, Sigma-Aldrich, Promega, Qiagen, IDT, and similar scientific sources.
Return only JSON matching the schema.

Goals:
- Make the plan runnable by a real lab.
- Include specific materials, realistic suppliers, plausible catalog numbers if available from grounded sources, and cost-aware choices.
- Use a domain-aware template for ${domain.name}.
- Add explicit validation gates and failure criteria.
- Incorporate prior review memory so the next plan visibly improves.
- Prefer operational realism over breadth.
- Every step should have a measurable check or go/no-go decision.
- Make timelines dependency-aware and role-aware.
- Budget should be frugal but credible.
- Avoid vague phrases like "optimize as needed" or "standard procedure".
- If a claim is uncertain, convert it into a validation requirement instead of asserting it.

Hypothesis:
${hypothesis}

Plain-English framing:
${domain.plainEnglish}

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
      callGemini({ prompt, schema, grounded: true }),
    ]);
  } catch {
    return fallback;
  }

  const references = generated.references.length > 0 ? generated.references : fallback.experiment.sources;
  const data = generated.data;
  const materials = data.materials?.length ? data.materials : fallback.experiment.materials;
  const timeline = data.timeline?.length ? data.timeline : fallback.experiment.timeline;
  const budget = buildBudget(materials, data.budget || fallback.experiment.budget, timeline, domain.name);
  const normalizedReferences = references.map((reference) => ({
    ...reference,
    uri: reference.uri || directResourceUri(reference.source, reference.title, hypothesis),
  }));

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
      sources: normalizedReferences,
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
          novelty: planContext.novelty || noveltyFallback(hypothesis),
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
      const hypothesis = body.hypothesis || defaultHypothesis;
      sendJson(response, 200, await parseHypothesis(hypothesis));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/literature/qc") {
      const body = await readBody(request);
      const hypothesis = body.hypothesis || defaultHypothesis;
      sendJson(response, 200, await literatureQc(hypothesis));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/experiments/plan") {
      const body = await readBody(request);
      const hypothesis = body.hypothesis || defaultHypothesis;
      sendJson(response, 200, await generatePlan(hypothesis));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/chat") {
      const body = await readBody(request);
      const hypothesis = body.hypothesis || defaultHypothesis;
      const experimentId = body.experimentId || detectDomain(hypothesis).id;
      const requestReviews = Array.isArray(body.reviews) ? body.reviews : [];
      const reviews = requestReviews.length > 0 ? requestReviews : reviewStore.filter((review) => review.experimentId === experimentId);
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
        experimentId: body.experimentId || detectDomain(defaultHypothesis).id,
        section: body.section || "General",
        reviewer: body.reviewer || "Scientist reviewer",
        correction: body.correction || "No correction provided.",
        severity: body.severity || "medium",
      };
      reviewStore.unshift(review);
      sendJson(response, 201, review);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/knowledge-graph/context") {
      const hypothesis = url.searchParams.get("hypothesis") || defaultHypothesis;
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
