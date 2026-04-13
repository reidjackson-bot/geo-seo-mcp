/**
 * GEO-SEO MCP Server
 * AI Search Optimization Audits — callable from Claude chat
 *
 * Architecture mirrors renny-tee-sniper: Express + SSE MCP transport
 * Deploy to Railway, connect as MCP in Claude.ai
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import { z } from "zod";
import {
  fetchPage,
  fetchCrawlers,
  analyzeCitability,
  analyzeLlmsTxt,
  scanBrands,
  analyzeSchema,
  technicalCheck,
  fullAudit,
} from "./analyzer.js";

// ─── MCP Server Setup ───────────────────────────────────────────

const server = new McpServer({
  name: "geo-seo",
  version: "1.0.0",
  description: "GEO-SEO Audit Tools — Optimize websites for AI-powered search engines",
});

// ─── Tool Definitions ───────────────────────────────────────────

server.tool(
  "geo_audit",
  "Run a full GEO + SEO audit on a URL. Returns composite GEO Score (0-100), category breakdowns (citability, brand authority, content quality, technical, structured data, platform optimization), top priorities, and detailed findings. This is the comprehensive analysis.",
  { url: z.string().url().describe("The URL to audit (e.g. https://example.com)") },
  async ({ url }) => {
    try {
      const result = await fullAudit(url);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: e.message }) }], isError: true };
    }
  }
);

server.tool(
  "geo_citability",
  "Score a page's content blocks for AI citation readiness. Analyzes each content section for answer block quality, self-containment, structural readability, statistical density, and uniqueness signals. Returns per-block scores (0-100) with grades A-F, plus top/bottom 5 blocks.",
  { url: z.string().url().describe("The page URL to analyze for citability") },
  async ({ url }) => {
    try {
      const result = await analyzeCitability(url);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: e.message }) }], isError: true };
    }
  }
);

server.tool(
  "geo_crawlers",
  "Check a site's robots.txt for AI crawler access. Analyzes directives for 14 AI crawlers including GPTBot, ClaudeBot, PerplexityBot, Google-Extended, and others. Returns ALLOWED/BLOCKED/PARTIALLY_BLOCKED status for each crawler, plus discovered sitemaps.",
  { url: z.string().url().describe("The site URL to check crawler access for") },
  async ({ url }) => {
    try {
      const result = await fetchCrawlers(url);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: e.message }) }], isError: true };
    }
  }
);

server.tool(
  "geo_llmstxt",
  "Analyze a site's llms.txt file — the emerging standard for helping AI crawlers understand site structure. Checks if /llms.txt and /llms-full.txt exist, validates format (title, description, sections, links), and provides recommendations.",
  { url: z.string().url().describe("The site URL to check for llms.txt") },
  async ({ url }) => {
    try {
      const result = await analyzeLlmsTxt(url);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: e.message }) }], isError: true };
    }
  }
);

server.tool(
  "geo_brands",
  "Scan brand mentions and entity presence across AI-cited platforms. Brand mentions correlate 3x more with AI visibility than backlinks. Checks Wikipedia, Wikidata, and provides search URLs for YouTube, Reddit, LinkedIn, G2, Trustpilot, and more.",
  {
    url: z.string().url().describe("The site URL to scan brand presence for"),
    brand_name: z.string().optional().describe("Override brand name (auto-detected from homepage if omitted)"),
  },
  async ({ url, brand_name }) => {
    try {
      const result = await scanBrands(url, brand_name || null);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: e.message }) }], isError: true };
    }
  }
);

server.tool(
  "geo_schema",
  "Analyze structured data (JSON-LD, microdata, RDFa) on a page. Detects schema types, checks for sameAs links (critical for AI entity recognition), and recommends missing schemas. GEO-critical: sameAs links connect your entity across the web for AI models.",
  { url: z.string().url().describe("The page URL to analyze schema markup for") },
  async ({ url }) => {
    try {
      const result = await analyzeSchema(url);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: e.message }) }], isError: true };
    }
  }
);

server.tool(
  "geo_technical",
  "Quick technical SEO audit. Checks title, meta description, H1 tags, canonical, image alt text, SSR rendering, security headers, structured data presence, and content depth. Returns categorized issues (critical/high/medium/low) and passed checks.",
  { url: z.string().url().describe("The page URL to run technical checks on") },
  async ({ url }) => {
    try {
      const result = await technicalCheck(url);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: e.message }) }], isError: true };
    }
  }
);

server.tool(
  "geo_fetch_page",
  "Fetch and parse a web page — returns structured data including title, meta tags, headings, word count, link counts, images, JSON-LD schemas, SSR status, and security headers. Use this as a building block for custom analysis.",
  { url: z.string().url().describe("The page URL to fetch and parse") },
  async ({ url }) => {
    try {
      const result = await fetchPage(url);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: e.message }) }], isError: true };
    }
  }
);

// ─── Express + SSE Transport ────────────────────────────────────

const app = express();
const PORT = process.env.PORT || 3000;

// Track active transports for cleanup
const transports = {};

app.get("/sse", async (req, res) => {
  const transport = new SSEServerTransport("/messages", res);
  transports[transport.sessionId] = transport;

  res.on("close", () => {
    delete transports[transport.sessionId];
  });

  await server.connect(transport);
});

app.post("/messages", async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = transports[sessionId];
  if (!transport) {
    return res.status(400).json({ error: "Unknown session" });
  }
  await transport.handlePostMessage(req, res);
});

// Health check
app.get("/", (req, res) => {
  res.json({
    name: "GEO-SEO MCP Server",
    version: "1.0.0",
    status: "running",
    tools: [
      "geo_audit",
      "geo_citability",
      "geo_crawlers",
      "geo_llmstxt",
      "geo_brands",
      "geo_schema",
      "geo_technical",
      "geo_fetch_page",
    ],
    description: "AI Search Optimization Audits — connect as MCP in Claude.ai",
  });
});

app.listen(PORT, () => {
  console.log(`GEO-SEO MCP Server running on port ${PORT}`);
  console.log(`SSE endpoint: http://localhost:${PORT}/sse`);
  console.log(`Health check: http://localhost:${PORT}/`);
});
