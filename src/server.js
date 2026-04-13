/**
 * GEO-SEO MCP Server
 * AI Search Optimization Audits — callable from Claude chat
 *
 * Architecture mirrors renny-tee-sniper: Express + StreamableHTTP MCP transport
 * Deploy to Railway, connect as MCP in Claude.ai
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
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

// ─── Tool Registration ──────────────────────────────────────────

function createMcpServer() {
  const server = new McpServer({
    name: "geo-seo",
    version: "1.0.0",
    description: "GEO-SEO Audit Tools — Optimize websites for AI-powered search engines",
  });

  server.tool(
    "geo_audit",
    "Run a full GEO + SEO audit on a URL. Returns composite GEO Score (0-100), category breakdowns, top priorities, and detailed findings.",
    { url: z.string().url().describe("The URL to audit (e.g. https://example.com)") },
    async ({ url }) => {
      try {
        const result = await fullAudit(url);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );

  server.tool(
    "geo_citability",
    "Score a page's content blocks for AI citation readiness. Returns per-block scores (0-100) with grades A-F, plus top/bottom 5 blocks.",
    { url: z.string().url().describe("The page URL to analyze for citability") },
    async ({ url }) => {
      try {
        const result = await analyzeCitability(url);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );

  server.tool(
    "geo_crawlers",
    "Check a site's robots.txt for AI crawler access. Analyzes directives for 14 AI crawlers. Returns ALLOWED/BLOCKED/PARTIALLY_BLOCKED status for each.",
    { url: z.string().url().describe("The site URL to check crawler access for") },
    async ({ url }) => {
      try {
        const result = await fetchCrawlers(url);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );

  server.tool(
    "geo_llmstxt",
    "Analyze a site's llms.txt file. Checks if /llms.txt and /llms-full.txt exist, validates format, and provides recommendations.",
    { url: z.string().url().describe("The site URL to check for llms.txt") },
    async ({ url }) => {
      try {
        const result = await analyzeLlmsTxt(url);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );

  server.tool(
    "geo_brands",
    "Scan brand mentions and entity presence across AI-cited platforms. Checks Wikipedia, Wikidata, and provides search URLs for YouTube, Reddit, LinkedIn, G2, Trustpilot.",
    {
      url: z.string().url().describe("The site URL to scan brand presence for"),
      brand_name: z.string().optional().describe("Override brand name (auto-detected from homepage if omitted)"),
    },
    async ({ url, brand_name }) => {
      try {
        const result = await scanBrands(url, brand_name || null);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );

  server.tool(
    "geo_schema",
    "Analyze structured data (JSON-LD, microdata, RDFa) on a page. Detects schema types, checks for sameAs links, and recommends missing schemas.",
    { url: z.string().url().describe("The page URL to analyze schema markup for") },
    async ({ url }) => {
      try {
        const result = await analyzeSchema(url);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );

  server.tool(
    "geo_technical",
    "Quick technical SEO audit. Checks title, meta description, H1 tags, canonical, image alt text, SSR rendering, security headers, structured data, and content depth.",
    { url: z.string().url().describe("The page URL to run technical checks on") },
    async ({ url }) => {
      try {
        const result = await technicalCheck(url);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );

  server.tool(
    "geo_fetch_page",
    "Fetch and parse a web page — returns title, meta tags, headings, word count, link counts, images, JSON-LD schemas, SSR status, and security headers.",
    { url: z.string().url().describe("The page URL to fetch and parse") },
    async ({ url }) => {
      try {
        const result = await fetchPage(url);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
      }
    }
  );

  return server;
}

// ─── Express + StreamableHTTP Transport ─────────────────────────

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;

// MCP endpoint — stateless, one server per request (same as renny-tee-sniper)
app.post("/mcp", async (req, res) => {
  try {
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("[MCP] Error:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

app.get("/mcp", async (_req, res) => {
  res.writeHead(405).end(JSON.stringify({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed. Use POST." },
    id: null,
  }));
});

app.delete("/mcp", async (_req, res) => {
  res.writeHead(405).end(JSON.stringify({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Session management not supported." },
    id: null,
  }));
});

// Health check
app.get("/", (req, res) => {
  res.json({
    name: "GEO-SEO MCP Server",
    version: "1.0.0",
    status: "running",
    mcp_endpoint: "/mcp",
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
  });
});

app.listen(PORT, () => {
  console.log(`GEO-SEO MCP Server running on port ${PORT}`);
  console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
});
