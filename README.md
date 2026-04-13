# GEO-SEO MCP Server

AI Search Optimization Audits — callable from Claude chat via MCP.

Ported from [geo-seo-claude](https://github.com/zubair-trabzada/geo-seo-claude) (Claude Code skill) into a standalone MCP server deployable to Railway.

## Tools

| Tool | Description |
|------|-------------|
| `geo_audit` | Full GEO + SEO audit with composite score (0-100) |
| `geo_citability` | Score content blocks for AI citation readiness |
| `geo_crawlers` | Check robots.txt for 14 AI crawler directives |
| `geo_llmstxt` | Analyze /llms.txt and /llms-full.txt |
| `geo_brands` | Scan brand mentions + Wikipedia/Wikidata presence |
| `geo_schema` | Analyze JSON-LD, microdata, RDFa structured data |
| `geo_technical` | Quick technical SEO audit |
| `geo_fetch_page` | Raw page fetch + parse |

## Deploy to Railway

```bash
railway init
railway up
```

Then connect as MCP in Claude.ai:
```
https://your-app.up.railway.app/sse
```

## Local Development

```bash
npm install
npm run dev
```

## Architecture

- Express + SSE transport (same pattern as renny-tee-sniper)
- Node.js with Cheerio for HTML parsing
- No Python dependencies — everything ported to JS
- Single deployable server, no external dependencies
