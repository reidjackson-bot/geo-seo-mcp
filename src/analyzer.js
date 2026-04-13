/**
 * GEO-SEO Analysis Engine
 * Ported from geo-seo-claude Python scripts to Node.js
 * Handles page fetching, citability scoring, crawler analysis, brand scanning, llms.txt
 */

import * as cheerio from "cheerio";

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

const AI_CRAWLERS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "anthropic-ai",
  "PerplexityBot",
  "CCBot",
  "Bytespider",
  "cohere-ai",
  "Google-Extended",
  "GoogleOther",
  "Applebot-Extended",
  "FacebookBot",
  "Amazonbot",
];

// ─── Fetch helpers ───────────────────────────────────────────────

async function safeFetch(url, opts = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeout || 30000);
  try {
    const res = await fetch(url, {
      headers: DEFAULT_HEADERS,
      signal: controller.signal,
      redirect: "follow",
      ...opts,
    });
    clearTimeout(timeout);
    return res;
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}

// ─── 1. Page Fetcher ─────────────────────────────────────────────

export async function fetchPage(url) {
  const result = {
    url,
    status_code: null,
    title: null,
    description: null,
    canonical: null,
    h1_tags: [],
    heading_structure: [],
    word_count: 0,
    internal_links_count: 0,
    external_links_count: 0,
    images_total: 0,
    images_missing_alt: 0,
    structured_data: [],
    has_ssr_content: true,
    security_headers: {},
    meta_tags: {},
    errors: [],
  };

  try {
    const res = await safeFetch(url);
    result.status_code = res.status;

    // Security headers
    const secHeaders = [
      "strict-transport-security",
      "content-security-policy",
      "x-frame-options",
      "x-content-type-options",
      "referrer-policy",
      "permissions-policy",
    ];
    for (const h of secHeaders) {
      result.security_headers[h] = res.headers.get(h) || null;
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    // Title
    result.title = $("title").first().text().trim() || null;

    // Meta tags
    $("meta").each((_, el) => {
      const name = $(el).attr("name") || $(el).attr("property") || "";
      const content = $(el).attr("content") || "";
      if (name && content) {
        result.meta_tags[name.toLowerCase()] = content;
        if (name.toLowerCase() === "description") result.description = content;
      }
    });

    // Canonical
    const canon = $('link[rel="canonical"]').attr("href");
    if (canon) result.canonical = canon;

    // Headings
    for (let level = 1; level <= 6; level++) {
      $(`h${level}`).each((_, el) => {
        const text = $(el).text().trim();
        result.heading_structure.push({ level, text });
        if (level === 1) result.h1_tags.push(text);
      });
    }

    // Structured data (JSON-LD)
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const data = JSON.parse($(el).html());
        result.structured_data.push(data);
      } catch {
        result.errors.push("Invalid JSON-LD detected");
      }
    });

    // Remove non-content elements for word count
    $("script, style, nav, footer, header").remove();
    const text = $.text().replace(/\s+/g, " ").trim();
    result.word_count = text.split(/\s+/).length;

    // Links
    const baseUrl = new URL(url);
    $("a[href]").each((_, el) => {
      try {
        const href = new URL($(el).attr("href"), url);
        if (href.hostname === baseUrl.hostname) result.internal_links_count++;
        else if (href.protocol.startsWith("http")) result.external_links_count++;
      } catch {}
    });

    // Images
    $("img").each((_, el) => {
      result.images_total++;
      if (!$(el).attr("alt")?.trim()) result.images_missing_alt++;
    });

    // SSR check
    const appRoots = $('[id="app"], [id="root"], [id="__next"], [id="__nuxt"]');
    if (appRoots.length > 0 && result.word_count < 200) {
      result.has_ssr_content = false;
      result.errors.push("Possible client-side only rendering — minimal server-rendered content");
    }
  } catch (e) {
    result.errors.push(`Fetch error: ${e.message}`);
  }

  return result;
}

// ─── 2. Robots.txt / AI Crawler Analysis ─────────────────────────

export async function fetchCrawlers(url) {
  const parsed = new URL(url);
  const robotsUrl = `${parsed.protocol}//${parsed.hostname}/robots.txt`;

  const result = {
    url: robotsUrl,
    exists: false,
    ai_crawler_status: {},
    sitemaps: [],
    errors: [],
  };

  try {
    const res = await safeFetch(robotsUrl, { timeout: 15000 });

    if (res.status === 200) {
      result.exists = true;
      const content = await res.text();
      const lines = content.split("\n");

      let currentAgent = null;
      const agentRules = {};

      for (let line of lines) {
        line = line.trim();
        if (line.toLowerCase().startsWith("user-agent:")) {
          currentAgent = line.split(":").slice(1).join(":").trim();
          if (!agentRules[currentAgent]) agentRules[currentAgent] = [];
        } else if (line.toLowerCase().startsWith("disallow:") && currentAgent) {
          const path = line.split(":").slice(1).join(":").trim();
          agentRules[currentAgent].push({ directive: "Disallow", path });
        } else if (line.toLowerCase().startsWith("allow:") && currentAgent) {
          const path = line.split(":").slice(1).join(":").trim();
          agentRules[currentAgent].push({ directive: "Allow", path });
        } else if (line.toLowerCase().startsWith("sitemap:")) {
          let sitemapUrl = line.split(/sitemap:/i)[1]?.trim();
          if (sitemapUrl && !sitemapUrl.startsWith("http")) sitemapUrl = "http" + sitemapUrl;
          if (sitemapUrl) result.sitemaps.push(sitemapUrl);
        }
      }

      for (const crawler of AI_CRAWLERS) {
        if (agentRules[crawler]) {
          const rules = agentRules[crawler];
          if (rules.some((r) => r.directive === "Disallow" && r.path === "/")) {
            result.ai_crawler_status[crawler] = "BLOCKED";
          } else if (rules.some((r) => r.directive === "Disallow" && r.path)) {
            result.ai_crawler_status[crawler] = "PARTIALLY_BLOCKED";
          } else {
            result.ai_crawler_status[crawler] = "ALLOWED";
          }
        } else if (agentRules["*"]) {
          const wildcardRules = agentRules["*"];
          if (wildcardRules.some((r) => r.directive === "Disallow" && r.path === "/")) {
            result.ai_crawler_status[crawler] = "BLOCKED_BY_WILDCARD";
          } else {
            result.ai_crawler_status[crawler] = "ALLOWED_BY_DEFAULT";
          }
        } else {
          result.ai_crawler_status[crawler] = "NOT_MENTIONED";
        }
      }
    } else if (res.status === 404) {
      result.errors.push("No robots.txt found (404)");
      for (const c of AI_CRAWLERS) result.ai_crawler_status[c] = "NO_ROBOTS_TXT";
    }
  } catch (e) {
    result.errors.push(`Error: ${e.message}`);
  }

  return result;
}

// ─── 3. Citability Scorer ────────────────────────────────────────

function scorePassage(text, heading = null) {
  const words = text.split(/\s+/);
  const wordCount = words.length;
  const scores = {
    answer_block_quality: 0,
    self_containment: 0,
    structural_readability: 0,
    statistical_density: 0,
    uniqueness_signals: 0,
  };

  // 1. Answer Block Quality (30%)
  let abq = 0;
  const defPatterns = [
    /\b\w+\s+is\s+(?:a|an|the)\s/i,
    /\b\w+\s+refers?\s+to\s/i,
    /\b\w+\s+means?\s/i,
    /\b\w+\s+(?:can be |are )?defined\s+as\s/i,
  ];
  if (defPatterns.some((p) => p.test(text))) abq += 15;

  const first60 = words.slice(0, 60).join(" ");
  if (/\b(?:is|are|was|were|means?|refers?)\b/i.test(first60) || /\d+%/.test(first60) || /\$[\d,]+/.test(first60)) {
    abq += 15;
  }
  if (heading && heading.endsWith("?")) abq += 10;

  const sentences = text.split(/[.!?]+/).filter((s) => s.trim());
  const clearSentences = sentences.filter((s) => {
    const wc = s.trim().split(/\s+/).length;
    return wc >= 5 && wc <= 25;
  });
  if (sentences.length) abq += Math.round((clearSentences.length / sentences.length) * 10);

  if (/(?:according to|research shows|studies? (?:show|indicate|suggest|found))/i.test(text)) abq += 10;
  scores.answer_block_quality = Math.min(abq, 30);

  // 2. Self-Containment (25%)
  let sc = 0;
  if (wordCount >= 134 && wordCount <= 167) sc += 10;
  else if (wordCount >= 100 && wordCount <= 200) sc += 7;
  else if (wordCount >= 80 && wordCount <= 250) sc += 4;
  else if (wordCount >= 30 && wordCount <= 400) sc += 2;

  const pronounCount = (text.match(/\b(?:it|they|them|their|this|that|these|those|he|she|his|her)\b/gi) || []).length;
  const pronounRatio = wordCount > 0 ? pronounCount / wordCount : 0;
  if (pronounRatio < 0.02) sc += 8;
  else if (pronounRatio < 0.04) sc += 5;
  else if (pronounRatio < 0.06) sc += 3;

  const properNouns = (text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g) || []).length;
  if (properNouns >= 3) sc += 7;
  else if (properNouns >= 1) sc += 4;
  scores.self_containment = Math.min(sc, 25);

  // 3. Structural Readability (20%)
  let sr = 0;
  if (sentences.length) {
    const avgLen = wordCount / sentences.length;
    if (avgLen >= 10 && avgLen <= 20) sr += 8;
    else if (avgLen >= 8 && avgLen <= 25) sr += 5;
    else sr += 2;
  }
  if (/(?:first|second|third|finally|additionally|moreover|furthermore)/i.test(text)) sr += 4;
  if (/(?:\d+[.)]\s|\b(?:step|tip|point)\s+\d+)/i.test(text)) sr += 4;
  if (text.includes("\n")) sr += 4;
  scores.structural_readability = Math.min(sr, 20);

  // 4. Statistical Density (15%)
  let sd = 0;
  sd += Math.min((text.match(/\d+(?:\.\d+)?%/g) || []).length * 3, 6);
  sd += Math.min((text.match(/\$[\d,]+(?:\.\d+)?/g) || []).length * 3, 5);
  sd += Math.min(
    (text.match(/\b\d+(?:,\d{3})*(?:\.\d+)?\s+(?:users|customers|pages|sites|companies|businesses|people|percent|times)/gi) || []).length * 2,
    4
  );
  if (/\b20(?:2[3-6]|1\d)\b/.test(text)) sd += 2;
  if (/(?:according to|per|from|by)\s+[A-Z]/i.test(text)) sd += 2;
  scores.statistical_density = Math.min(sd, 15);

  // 5. Uniqueness Signals (10%)
  let us = 0;
  if (/(?:our (?:research|study|data|analysis|survey|findings)|we (?:found|discovered|analyzed|surveyed|measured))/i.test(text)) us += 5;
  if (/(?:case study|for example|for instance|in practice|real-world)/i.test(text)) us += 3;
  if (/(?:using|with|via|through)\s+[A-Z][a-z]+/.test(text)) us += 2;
  scores.uniqueness_signals = Math.min(us, 10);

  const total = Object.values(scores).reduce((a, b) => a + b, 0);
  let grade, label;
  if (total >= 80) { grade = "A"; label = "Highly Citable"; }
  else if (total >= 65) { grade = "B"; label = "Good Citability"; }
  else if (total >= 50) { grade = "C"; label = "Moderate Citability"; }
  else if (total >= 35) { grade = "D"; label = "Low Citability"; }
  else { grade = "F"; label = "Poor Citability"; }

  return {
    heading,
    word_count: wordCount,
    total_score: total,
    grade,
    label,
    breakdown: scores,
    preview: words.slice(0, 25).join(" ") + (wordCount > 25 ? "..." : ""),
  };
}

export async function analyzeCitability(url) {
  try {
    const res = await safeFetch(url);
    const html = await res.text();
    const $ = cheerio.load(html);

    $("script, style, nav, footer, header, aside, form").remove();

    const blocks = [];
    let currentHeading = "Introduction";
    let currentParagraphs = [];

    $("h1, h2, h3, h4, p, ul, ol, table").each((_, el) => {
      const tag = $(el).prop("tagName").toLowerCase();
      if (tag.startsWith("h")) {
        if (currentParagraphs.length) {
          const combined = currentParagraphs.join(" ");
          if (combined.split(/\s+/).length >= 20) {
            blocks.push({ heading: currentHeading, content: combined });
          }
        }
        currentHeading = $(el).text().trim();
        currentParagraphs = [];
      } else {
        const text = $(el).text().trim();
        if (text && text.split(/\s+/).length >= 5) currentParagraphs.push(text);
      }
    });
    if (currentParagraphs.length) {
      const combined = currentParagraphs.join(" ");
      if (combined.split(/\s+/).length >= 20) {
        blocks.push({ heading: currentHeading, content: combined });
      }
    }

    const scored = blocks.map((b) => scorePassage(b.content, b.heading));
    const avgScore = scored.length ? scored.reduce((a, b) => a + b.total_score, 0) / scored.length : 0;
    const gradeDist = { A: 0, B: 0, C: 0, D: 0, F: 0 };
    scored.forEach((b) => gradeDist[b.grade]++);

    const top5 = [...scored].sort((a, b) => b.total_score - a.total_score).slice(0, 5);
    const bottom5 = [...scored].sort((a, b) => a.total_score - b.total_score).slice(0, 5);
    const optimalCount = scored.filter((b) => b.word_count >= 134 && b.word_count <= 167).length;

    return {
      url,
      total_blocks_analyzed: scored.length,
      average_citability_score: Math.round(avgScore * 10) / 10,
      optimal_length_passages: optimalCount,
      grade_distribution: gradeDist,
      top_5_citable: top5,
      bottom_5_citable: bottom5,
    };
  } catch (e) {
    return { url, error: e.message };
  }
}

// ─── 4. llms.txt Analysis ────────────────────────────────────────

export async function analyzeLlmsTxt(url) {
  const parsed = new URL(url);
  const baseUrl = `${parsed.protocol}//${parsed.hostname}`;
  const llmsUrl = `${baseUrl}/llms.txt`;
  const llmsFullUrl = `${baseUrl}/llms-full.txt`;

  const result = {
    llms_txt: { url: llmsUrl, exists: false, format_valid: false, issues: [], stats: {} },
    llms_full_txt: { url: llmsFullUrl, exists: false },
    recommendations: [],
  };

  // Check llms.txt
  try {
    const res = await safeFetch(llmsUrl, { timeout: 15000 });
    if (res.status === 200) {
      result.llms_txt.exists = true;
      const content = await res.text();
      const lines = content.trim().split("\n");

      const hasTitle = lines[0]?.startsWith("# ");
      const hasDesc = lines.some((l) => l.startsWith("> "));
      const sections = lines.filter((l) => l.startsWith("## "));
      const links = content.match(/- \[.+\]\(.+\)/g) || [];

      result.llms_txt.stats = {
        has_title: hasTitle,
        has_description: hasDesc,
        section_count: sections.length,
        link_count: links.length,
      };
      result.llms_txt.format_valid = hasTitle && hasDesc && sections.length > 0 && links.length > 0;

      if (!hasTitle) result.llms_txt.issues.push("Missing title (should start with '# Site Name')");
      if (!hasDesc) result.llms_txt.issues.push("Missing description (use '> Brief description')");
      if (!sections.length) result.llms_txt.issues.push("No sections found (use '## Section Name')");
      if (!links.length) result.llms_txt.issues.push("No page links found");
      if (links.length < 5) result.llms_txt.issues.push("Consider adding more key pages (aim for 10-20)");
    }
  } catch (e) {
    result.llms_txt.issues.push(`Error: ${e.message}`);
  }

  // Check llms-full.txt
  try {
    const res = await safeFetch(llmsFullUrl, { timeout: 15000 });
    result.llms_full_txt.exists = res.status === 200;
  } catch {}

  if (!result.llms_txt.exists) {
    result.recommendations.push(
      "Create /llms.txt — the emerging standard for helping AI crawlers understand your site",
      "Format: # Title, > Description, ## Sections, - [Page](url): description",
      "Also create /llms-full.txt with detailed page descriptions"
    );
  }

  return result;
}

// ─── 5. Brand Mention Scanner ────────────────────────────────────

export async function scanBrands(url, brandName = null) {
  const parsed = new URL(url);
  const domain = parsed.hostname.replace("www.", "");

  // Auto-detect brand name from homepage if not provided
  if (!brandName) {
    try {
      const res = await safeFetch(url);
      const html = await res.text();
      const $ = cheerio.load(html);
      brandName = $("title").first().text().trim().split(/[|\-\u2013\u2014]/)[0].trim() || domain;
    } catch {
      brandName = domain;
    }
  }

  const result = {
    brand_name: brandName,
    domain,
    key_insight: "Brand mentions correlate 3x more strongly with AI visibility than backlinks (Ahrefs Dec 2025)",
    platforms: {},
    wikipedia: { has_page: false, has_wikidata: false },
    overall_score: 0,
    recommendations: [],
  };

  // Check Wikipedia API
  try {
    const wikiRes = await safeFetch(
      `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(brandName)}&format=json`,
      { timeout: 10000 }
    );
    const wikiData = await wikiRes.json();
    const searchResults = wikiData?.query?.search || [];
    if (searchResults.length > 0 && searchResults[0].title.toLowerCase().includes(brandName.toLowerCase())) {
      result.wikipedia.has_page = true;
    }
  } catch {}

  // Check Wikidata
  try {
    const wdRes = await safeFetch(
      `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(brandName)}&language=en&format=json`,
      { timeout: 10000 }
    );
    const wdData = await wdRes.json();
    if (wdData?.search?.length > 0) {
      result.wikipedia.has_wikidata = true;
      result.wikipedia.wikidata_id = wdData.search[0].id;
      result.wikipedia.wikidata_description = wdData.search[0].description;
    }
  } catch {}

  // Platform check URLs (for Claude to follow up with web_search if needed)
  result.platforms = {
    youtube: {
      search_url: `https://www.youtube.com/results?search_query=${encodeURIComponent(brandName)}`,
      correlation: 0.737,
      weight: "25%",
      note: "YouTube mentions have the strongest correlation (0.737) with AI citations",
    },
    reddit: {
      search_url: `https://www.reddit.com/search/?q=${encodeURIComponent(brandName)}`,
      correlation: "High",
      weight: "25%",
    },
    linkedin: {
      search_url: `https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(brandName)}`,
      correlation: "Moderate",
      weight: "15%",
    },
    other_platforms: {
      quora: `https://www.quora.com/search?q=${encodeURIComponent(brandName)}`,
      github: `https://github.com/search?q=${encodeURIComponent(brandName)}`,
      g2: `https://www.g2.com/search?query=${encodeURIComponent(brandName)}`,
      trustpilot: `https://www.trustpilot.com/search?query=${encodeURIComponent(brandName)}`,
      product_hunt: `https://www.producthunt.com/search?q=${encodeURIComponent(brandName)}`,
    },
  };

  // Priority recommendations
  result.recommendations = [
    "Priority 1: YouTube — highest correlation (0.737). Create educational content.",
    "Priority 2: Reddit — build authentic presence in industry subreddits.",
    "Priority 3: Wikipedia/Wikidata — establish entity presence for knowledge graph.",
    "Priority 4: LinkedIn — thought leadership from founders and employees.",
    "Priority 5: Review platforms (G2, Trustpilot) — social proof signals.",
    "Schema: Add sameAs property linking to ALL platform profiles.",
  ];

  return result;
}

// ─── 6. Schema Markup Analysis ───────────────────────────────────

export async function analyzeSchema(url) {
  try {
    const res = await safeFetch(url);
    const html = await res.text();
    const $ = cheerio.load(html);

    const schemas = [];
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        schemas.push(JSON.parse($(el).html()));
      } catch {}
    });

    // Check for microdata
    const hasMicrodata = $("[itemscope]").length > 0;
    // Check for RDFa
    const hasRdfa = $("[typeof]").length > 0;

    const detectedTypes = schemas.map((s) => s["@type"] || "Unknown").flat();

    // Recommendations based on what's missing
    const recommendations = [];
    if (!schemas.length) {
      recommendations.push("CRITICAL: No JSON-LD structured data found. Add Organization schema at minimum.");
    }
    if (!detectedTypes.includes("Organization") && !detectedTypes.includes("LocalBusiness")) {
      recommendations.push("Add Organization or LocalBusiness schema with sameAs links to social profiles");
    }
    if (!detectedTypes.includes("WebSite")) {
      recommendations.push("Add WebSite schema with SearchAction for sitelinks search box");
    }
    if (!detectedTypes.includes("BreadcrumbList")) {
      recommendations.push("Add BreadcrumbList schema for navigation clarity");
    }

    // Check for sameAs (critical for GEO)
    const hasSameAs = schemas.some(
      (s) => s.sameAs && (Array.isArray(s.sameAs) ? s.sameAs.length > 0 : true)
    );
    if (!hasSameAs) {
      recommendations.push(
        "IMPORTANT: Add sameAs property with links to all social/platform profiles — this is how AI models connect your entity across the web"
      );
    }

    return {
      url,
      json_ld_count: schemas.length,
      detected_types: detectedTypes,
      has_microdata: hasMicrodata,
      has_rdfa: hasRdfa,
      has_same_as: hasSameAs,
      schemas_detail: schemas,
      recommendations,
    };
  } catch (e) {
    return { url, error: e.message };
  }
}

// ─── 7. Technical SEO Quick Check ────────────────────────────────

export async function technicalCheck(url) {
  const page = await fetchPage(url);

  const issues = [];
  const passed = [];

  // Title
  if (!page.title) issues.push({ severity: "critical", item: "Missing <title> tag" });
  else if (page.title.length > 60) issues.push({ severity: "medium", item: `Title too long (${page.title.length} chars, aim for \u226460)` });
  else passed.push("Title tag present and good length");

  // Description
  if (!page.description) issues.push({ severity: "high", item: "Missing meta description" });
  else if (page.description.length > 160) issues.push({ severity: "low", item: `Meta description too long (${page.description.length} chars)` });
  else passed.push("Meta description present");

  // H1
  if (page.h1_tags.length === 0) issues.push({ severity: "high", item: "No H1 tag found" });
  else if (page.h1_tags.length > 1) issues.push({ severity: "medium", item: `Multiple H1 tags (${page.h1_tags.length})` });
  else passed.push("Single H1 tag present");

  // Canonical
  if (!page.canonical) issues.push({ severity: "medium", item: "No canonical tag" });
  else passed.push("Canonical tag present");

  // Images
  if (page.images_missing_alt > 0) {
    issues.push({ severity: "medium", item: `${page.images_missing_alt} of ${page.images_total} images missing alt text` });
  } else if (page.images_total > 0) {
    passed.push(`All ${page.images_total} images have alt text`);
  }

  // SSR
  if (!page.has_ssr_content) issues.push({ severity: "critical", item: "Possible client-side rendering — AI crawlers may not see content" });
  else passed.push("Server-side rendering detected");

  // Security headers
  if (!page.security_headers["strict-transport-security"]) issues.push({ severity: "medium", item: "Missing HSTS header" });
  if (!page.security_headers["x-content-type-options"]) issues.push({ severity: "low", item: "Missing X-Content-Type-Options" });

  // Structured data
  if (page.structured_data.length === 0) issues.push({ severity: "high", item: "No JSON-LD structured data" });
  else passed.push(`${page.structured_data.length} JSON-LD schema(s) found`);

  // Word count
  if (page.word_count < 300) issues.push({ severity: "high", item: `Thin content: only ${page.word_count} words (aim for 800+)` });
  else passed.push(`Good content depth: ${page.word_count} words`);

  return {
    url,
    status_code: page.status_code,
    issues_count: issues.length,
    passed_count: passed.length,
    issues,
    passed,
    page_summary: {
      title: page.title,
      word_count: page.word_count,
      h1_tags: page.h1_tags,
      internal_links: page.internal_links_count,
      external_links: page.external_links_count,
      structured_data_types: page.structured_data.map((s) => s["@type"] || "Unknown"),
    },
  };
}

// ─── 8. Full GEO Audit (composite) ──────────────────────────────

export async function fullAudit(url) {
  // Run all analyses in parallel
  const [page, crawlers, citability, llmsTxt, schema, brands] = await Promise.all([
    fetchPage(url),
    fetchCrawlers(url),
    analyzeCitability(url),
    analyzeLlmsTxt(url),
    analyzeSchema(url),
    scanBrands(url),
  ]);

  const technical = await technicalCheck(url);

  // Calculate composite GEO Score (0-100)
  const scores = {
    ai_citability: 0,    // 25%
    brand_authority: 0,   // 20%
    content_quality: 0,   // 20%
    technical: 0,         // 15%
    structured_data: 0,   // 10%
    platform_optimization: 0, // 10%
  };

  // AI Citability (25%)
  scores.ai_citability = Math.min(citability.average_citability_score || 0, 100);

  // Brand Authority (20%) — based on what we can check
  let brandScore = 0;
  if (brands.wikipedia?.has_page) brandScore += 40;
  if (brands.wikipedia?.has_wikidata) brandScore += 20;
  // Baseline for having a domain
  brandScore += 20;
  scores.brand_authority = Math.min(brandScore, 100);

  // Content Quality (20%)
  let contentScore = 0;
  if (page.word_count >= 800) contentScore += 30;
  else if (page.word_count >= 300) contentScore += 15;
  if (page.h1_tags.length === 1) contentScore += 15;
  if (page.description) contentScore += 15;
  if (page.heading_structure.length >= 3) contentScore += 20;
  if (page.images_total > 0 && page.images_missing_alt === 0) contentScore += 20;
  scores.content_quality = Math.min(contentScore, 100);

  // Technical (15%)
  let techScore = 100;
  technical.issues.forEach((i) => {
    if (i.severity === "critical") techScore -= 25;
    else if (i.severity === "high") techScore -= 15;
    else if (i.severity === "medium") techScore -= 8;
    else techScore -= 3;
  });
  scores.technical = Math.max(techScore, 0);

  // Structured Data (10%)
  let schemaScore = 0;
  if (schema.json_ld_count > 0) schemaScore += 40;
  if (schema.json_ld_count >= 2) schemaScore += 20;
  if (schema.has_same_as) schemaScore += 25;
  if (schema.detected_types?.includes("Organization") || schema.detected_types?.includes("LocalBusiness")) schemaScore += 15;
  scores.structured_data = Math.min(schemaScore, 100);

  // Platform Optimization (10%)
  let platformScore = 0;
  const crawlerStatuses = Object.values(crawlers.ai_crawler_status);
  const allowedCount = crawlerStatuses.filter((s) =>
    ["ALLOWED", "ALLOWED_BY_DEFAULT", "NOT_MENTIONED", "NO_ROBOTS_TXT"].includes(s)
  ).length;
  platformScore = Math.round((allowedCount / AI_CRAWLERS.length) * 70);
  if (llmsTxt.llms_txt.exists) platformScore += 30;
  scores.platform_optimization = Math.min(platformScore, 100);

  // Weighted composite
  const compositeScore = Math.round(
    scores.ai_citability * 0.25 +
    scores.brand_authority * 0.20 +
    scores.content_quality * 0.20 +
    scores.technical * 0.15 +
    scores.structured_data * 0.10 +
    scores.platform_optimization * 0.10
  );

  let grade;
  if (compositeScore >= 80) grade = "A";
  else if (compositeScore >= 65) grade = "B";
  else if (compositeScore >= 50) grade = "C";
  else if (compositeScore >= 35) grade = "D";
  else grade = "F";

  // Top priorities
  const priorities = [];
  if (scores.structured_data < 50) priorities.push("Add JSON-LD structured data with sameAs links");
  if (scores.ai_citability < 50) priorities.push("Improve content citability — use self-contained, fact-rich 134-167 word passages");
  if (scores.platform_optimization < 50) priorities.push("Ensure AI crawlers are allowed in robots.txt and create /llms.txt");
  if (scores.brand_authority < 50) priorities.push("Build brand presence on YouTube, Reddit, Wikipedia, LinkedIn");
  if (scores.content_quality < 50) priorities.push("Improve content depth, heading structure, and image alt text");
  if (scores.technical < 50) priorities.push("Fix critical technical SEO issues");

  return {
    url,
    brand_name: brands.brand_name,
    geo_score: compositeScore,
    grade,
    category_scores: scores,
    category_weights: {
      ai_citability: "25%",
      brand_authority: "20%",
      content_quality: "20%",
      technical: "15%",
      structured_data: "10%",
      platform_optimization: "10%",
    },
    top_priorities: priorities,
    details: {
      crawlers: crawlers.ai_crawler_status,
      citability_avg: citability.average_citability_score,
      citability_blocks: citability.total_blocks_analyzed,
      citability_top_3: citability.top_5_citable?.slice(0, 3),
      llms_txt_exists: llmsTxt.llms_txt.exists,
      llms_full_exists: llmsTxt.llms_full_txt.exists,
      schema_types: schema.detected_types,
      schema_has_same_as: schema.has_same_as,
      wikipedia_page: brands.wikipedia?.has_page,
      wikidata_entry: brands.wikipedia?.has_wikidata,
      technical_issues: technical.issues,
      technical_passed: technical.passed,
      page_title: page.title,
      word_count: page.word_count,
    },
  };
}
