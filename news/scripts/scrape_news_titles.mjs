#!/usr/bin/env node
/**
 * Local helper to fetch real page titles for the URLs in news.html.
 *
 * Why local:
 * - Wix embedded HTML runs in a browser and is blocked by CORS from scraping other sites.
 *
 * Usage (from repo root):
 *   node scripts/scrape_news_titles.mjs            (dry-run, prints proposed titles)
 *   node scripts/scrape_news_titles.mjs --write    (rewrites news.html ITEMS titles)
 */

import fs from "node:fs/promises";

const NEWS_FILE = new URL("../news.html", import.meta.url);

const SHOULD_WRITE = process.argv.includes("--write");
const FIX_INTERNATIONAL = process.argv.includes("--fix-international");
const REQUEST_DELAY_MS = 250;

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeHtmlEntities(str) {
	return String(str)
		.replaceAll(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
			try {
				return String.fromCodePoint(parseInt(hex, 16));
			} catch {
				return _;
			}
		})
		.replaceAll(/&#([0-9]+);/g, (_, dec) => {
			try {
				return String.fromCodePoint(parseInt(dec, 10));
			} catch {
				return _;
			}
		})
		.replaceAll(/&amp;/g, "&")
		.replaceAll(/&lt;/g, "<")
		.replaceAll(/&gt;/g, ">")
		.replaceAll(/&quot;/g, '"')
		.replaceAll(/&#39;/g, "'")
		.replaceAll(/&#8217;/g, "’")
		.replaceAll(/&#8211;/g, "–")
		.replaceAll(/&#8212;/g, "—")
		.replaceAll(/\s+/g, " ")
		.trim();
}

function extractTitle(html) {
	const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
	if (!match) return null;
	return decodeHtmlEntities(match[1]);
}

function extractMetaContent(html, attrName, attrValue) {
	// Example: <meta property="og:image" content="...">
	const re = new RegExp(
		`<meta[^>]+${attrName}=["']${attrValue}["'][^>]+content=["']([^"']+)["'][^>]*>`,
		"i"
	);
	const m = html.match(re);
	return m ? decodeHtmlEntities(m[1]) : null;
}

function extractFirstImageSrc(html) {
	// Very simple: first <img ... src="...">
	const m = html.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/i);
	return m ? decodeHtmlEntities(m[1]) : null;
}

function absolutizeMaybe(url, baseUrl) {
	try {
		return new URL(url, baseUrl).toString();
	} catch {
		return null;
	}
}

function getHostname(url) {
	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return "";
	}
}

function normalizeForCompare(u) {
	try {
		const U = new URL(u);
		U.hash = "";
		U.search = "";
		let s = U.toString();
		if (s.endsWith("/")) s = s.slice(0, -1);
		return s;
	} catch {
		return String(u || "").trim();
	}
}

function extractYouTubeId(url) {
	try {
		const u = new URL(url);
		if (u.hostname.includes("youtu.be")) return u.pathname.replace("/", "");
		if (u.hostname.includes("youtube.com")) return u.searchParams.get("v");
	} catch {
		// ignore
	}
	return null;
}

function classifySource(url, title) {
	const hostname = getHostname(url).toLowerCase();

	// Country-code TLDs (two-letter) other than 'us' are treated as international
	try {
		const parts = hostname.split(".");
		const tld = parts[parts.length - 1];
		if (tld.length === 2 && tld !== "us") return "international";
	} catch {
		// ignore
	}

	// Heuristic list of Florida cities / counties / keywords to consider 'local'
	const floridaKeywords = [
		"florida","miami","tampa","orlando","jacksonville","tallahassee",
		"fortmyers","fort-myers","stpetersburg","st.-petersburg","st-petersburg",
		"westpalm","west-palm","palmbeach","broward","duval","lee","sarasota",
		"pensacola","naples","capecoral","ocala","daytona","portstlucie","manatee",
		"pinellas","collier","hendry","monroe","lee-county","boca","delray","staugustine"
	];

	const hay = (url + " " + (title || "") + " " + hostname).toLowerCase();
	for (const k of floridaKeywords) {
		if (hay.includes(k)) return "local";
	}

	// If hostname explicitly ends with .us or is a known US government/edu domain, treat as nation
	if (hostname.endsWith('.us') || hostname.endsWith('.gov') || hostname.endsWith('.edu')) return 'nation';

	// Heuristic: assume .com/.org/.net without FL keywords is nation (US)
	return 'nation';
}
function cleanTitle(title, url) {
	if (!title) return null;
	let t = String(title).trim();

	// Common suffix cleanup. Keep conservative.
	if (getHostname(url).includes("youtube.com")) {
		t = t.replace(/\s*-\s*YouTube\s*$/i, "").trim();
	}

	// Normalize whitespace
	t = t.replace(/\s+/g, " ").trim();

	// Avoid writing obvious bot-check / access-block pages as titles.
	if (
		/^(verifying device|just a moment)\b/i.test(t) ||
		/checking your browser/i.test(t) ||
		/attention required/i.test(t) ||
		/access denied/i.test(t)
	) {
		return null;
	}
	return t;
}

async function fetchTitleFromHtml(url) {
	const res = await fetch(url, {
		redirect: "follow",
		headers: {
			"user-agent":
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
			accept: "text/html,application/xhtml+xml",
		},
	});

	const contentType = res.headers.get("content-type") || "";
	if (!res.ok) {
		return { title: null, ok: false, status: res.status, note: `HTTP ${res.status}` };
	}
	if (!contentType.toLowerCase().includes("text/html")) {
		return { title: null, ok: true, status: res.status, note: `Non-HTML: ${contentType}` };
	}

	const html = await res.text();
	const title = extractTitle(html);
	return { title, ok: true, status: res.status, html };
}

async function fetchYouTubeOEmbedTitle(url) {
	// YouTube supports oEmbed without an API key.
	const endpoint = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`;
	const res = await fetch(endpoint, { redirect: "follow" });
	if (!res.ok) return { title: null, ok: false, status: res.status, note: `oEmbed HTTP ${res.status}` };
	const data = await res.json();
	return { title: data?.title || null, ok: true, status: res.status };
}

async function fetchBestTitle(url) {
	const ytId = extractYouTubeId(url);
	if (ytId) {
		try {
			const o = await fetchYouTubeOEmbedTitle(url);
			if (o.title) return o;
		} catch {
			// fall back to HTML
		}
	}
	return await fetchTitleFromHtml(url);
}

function extractBestImageFromHtml(html, pageUrl) {
	const og = extractMetaContent(html, "property", "og:image") || extractMetaContent(html, "name", "og:image");
	if (og) return absolutizeMaybe(og, pageUrl);

	const tw = extractMetaContent(html, "name", "twitter:image") || extractMetaContent(html, "property", "twitter:image");
	if (tw) return absolutizeMaybe(tw, pageUrl);

	const first = extractFirstImageSrc(html);
	if (first) return absolutizeMaybe(first, pageUrl);

	return null;
}

function parseItemsFromNewsHtml(fileText) {
	const start = fileText.indexOf("const ITEMS");
	if (start === -1) throw new Error("Could not find `const ITEMS` in news.html");

	const before = fileText.slice(0, start);
	const afterStart = fileText.slice(start);

	const match = afterStart.match(/const\s+ITEMS\s*=\s*(\[[\s\S]*?\n\t\t\t\]);/);
	if (!match) throw new Error("Could not extract the ITEMS array literal.");

	const arrayLiteral = match[1];
	const arrayStart = start + match.index + match[0].indexOf(match[1]);
	const arrayEnd = arrayStart + arrayLiteral.length;

	// Evaluate the array literal. This is local-only tooling.
	// eslint-disable-next-line no-new-func
	const items = new Function(`return ${arrayLiteral};`)();
	if (!Array.isArray(items)) throw new Error("ITEMS did not evaluate to an array.");

	return { before, after: fileText.slice(arrayEnd), items, arrayLiteral, arrayStart, arrayEnd };
}

function parseLocalLinksFromNewsHtml(fileText) {
	const start = fileText.indexOf("const LOCAL_LINKS");
	if (start === -1) return null;

	const before = fileText.slice(0, start);
	const afterStart = fileText.slice(start);

	const match = afterStart.match(/const\s+LOCAL_LINKS\s*=\s*(\{[\s\S]*?\n\t\t\t\};)/);
	if (!match) return null;

	const objLiteral = match[1];
	const objStart = start + match.index + match[0].indexOf(match[1]);
	const objEnd = objStart + objLiteral.length;

	// Evaluate locally
	// eslint-disable-next-line no-new-func
	const obj = new Function(`return ${objLiteral};`)();
	return { before, after: fileText.slice(objEnd), obj, objLiteral, objStart, objEnd };
}

function formatItemsArray(items) {
	// Match the style in news.html: tabs + 4-space-ish object formatting.
	const indent1 = "\t\t\t"; // inside <script>
	const indent2 = "\t\t\t\t";
	const indent3 = "\t\t\t\t\t";

	const lines = [];
	lines.push("[");
	for (const item of items) {
		lines.push(`${indent2}{`);
		for (const key of ["type", "group", "tag", "title", "source", "url", "thumb", "description"]) {
			if (item[key] === undefined) continue;
			const value = String(item[key]).replaceAll("\\", "\\\\").replaceAll('"', "\\\"");
			lines.push(`${indent3}${key}: "${value}",`);
		}
		lines.push(`${indent2}},`);
	}
	lines.push(`${indent1}];`);
	return lines.join("\n");
}

function formatLocalLinksObject(obj) {
	const indent1 = "\t\t\t"; // inside <script>
	const indent2 = "\t\t\t\t";
	const indent3 = "\t\t\t\t\t";

	const lines = [];
	lines.push("{");
	for (const [source, links] of Object.entries(obj)) {
		lines.push(`${indent2}"${String(source).replaceAll('"', '\\"')}": [`);
		for (const l of links) {
			const url = String(l.url || "").replaceAll('\\', '\\\\').replaceAll('"', '\\"');
			const title = l.title === null || l.title === undefined ? null : String(l.title).replaceAll('\\', '\\\\').replaceAll('"', '\\"');
			if (title === null) {
				lines.push(`${indent3}{ url: "${url}", title: null },`);
			} else {
				lines.push(`${indent3}{ url: "${url}", title: "${title}" },`);
			}
		}
		lines.push(`${indent2}],`);
	}
	lines.push(`${indent1};`);
	return lines.join("\n");
}

async function main() {
	if (typeof fetch !== "function") {
		throw new Error("This script requires Node 18+ (global fetch).");
	}

	const newsHtml = await fs.readFile(NEWS_FILE, "utf8");
	const parsed = parseItemsFromNewsHtml(newsHtml);

	console.log(`Found ${parsed.items.length} ITEMS in news.html`);

	if (FIX_INTERNATIONAL) {
		console.log("Running --fix-international: scanning ITEMS for international links...");
		let changed = 0;
		for (const it of parsed.items) {
			if (!it || !it.url) continue;
			try {
				const cls = classifySource(it.url, it.title || "");
				if (cls === "international" && it.group !== "international") {
					it.group = "international";
					changed++;
					console.log(`  updated -> international: ${it.url}`);
				}
			} catch (e) {
				// ignore
			}
		}

		console.log(`Found ${changed} items to update.`);
		if (changed === 0) return;
		if (!SHOULD_WRITE) {
			console.log("Dry-run: re-run with --write to persist changes.");
			return;
		}

		const newArray = formatItemsArray(parsed.items);
		const newFile = newsHtml.slice(0, parsed.arrayStart) + newArray + newsHtml.slice(parsed.arrayEnd);
		await fs.writeFile(NEWS_FILE, newFile, "utf8");
		console.log("Wrote updated ITEMS to news.html");
		return;
	}

	const updated = [];
	// Detect a single URL argument to add
	const argUrl = process.argv.find((a) => a.startsWith('http://') || a.startsWith('https://')) || null;

	// If a single URL was provided, operate in add-only mode: check duplicates, fetch metadata for that URL only,
	// then append and optionally write. This avoids re-fetching every existing item as the list grows.
	if (argUrl) {
		process.stdout.write(`- Adding URL: ${argUrl}\n`);
		const normArg = normalizeForCompare(argUrl);

		// gather existing URLs from ITEMS and LOCAL_LINKS for duplicate detection
		const existingItemUrls = parsed.items.map((it) => (it && it.url ? normalizeForCompare(it.url) : null)).filter(Boolean);
		const localParsed = parseLocalLinksFromNewsHtml(newsHtml);
		const existingLocalUrls = (localParsed && Object.values(localParsed.obj).flat().map((l) => normalizeForCompare(l.url))) || [];
		const isDup = existingItemUrls.includes(normArg) || existingLocalUrls.includes(normArg);
		if (isDup) {
			console.log("Duplicate detected: URL already exists in ITEMS or LOCAL_LINKS. No changes made.");
			return;
		}

		try {
			const r = await fetchBestTitle(argUrl);
			const fetchedTitle = cleanTitle(r.title, argUrl) || '';
			let fetchedThumb = null;
			const isYouTube = Boolean(extractYouTubeId(argUrl));
			const shouldTryThumb = !isYouTube;
			if (shouldTryThumb && r.html) fetchedThumb = extractBestImageFromHtml(r.html, argUrl);
			await sleep(REQUEST_DELAY_MS);

			const group = classifySource(argUrl, fetchedTitle);
			const newItem = {
				type: 'article',
				group,
				tag: '',
				title: fetchedTitle || '',
				source: getHostname(argUrl),
				url: argUrl,
				thumb: fetchedThumb || '',
				description: '',
			};

			console.log(`  -> classified as ${group}`);

			if (group === 'local') {
				// add into LOCAL_LINKS under the source hostname (create source if missing)
				const lp = localParsed || { obj: {}, objStart: null, objEnd: null };
				const srcKey = newItem.source || getHostname(argUrl) || argUrl;
				if (!lp.obj[srcKey]) lp.obj[srcKey] = [];
				lp.obj[srcKey].push({ url: argUrl, title: newItem.title || null });

				if (!SHOULD_WRITE) {
					console.log('\nDry-run: not writing changes. Re-run with --write to persist.');
					console.log('Proposed local link:', JSON.stringify({ source: srcKey, url: argUrl, title: newItem.title || null }, null, 2));
					return;
				}

				// Format and write updated LOCAL_LINKS section
				const newLocal = formatLocalLinksObject(lp.obj);
				let newFile;
				if (localParsed && localParsed.objStart != null) {
					newFile = newsHtml.slice(0, localParsed.objStart) + newLocal + newsHtml.slice(localParsed.objEnd);
				} else {
					// fallback: append a LOCAL_LINKS block before ITEMS arrayStart
					const insertAt = parsed.arrayStart || newsHtml.length;
					const block = `\n\t\t\tconst LOCAL_LINKS = ${newLocal}\n\n`;
					newFile = newsHtml.slice(0, insertAt) + block + newsHtml.slice(insertAt);
				}

				await fs.writeFile(NEWS_FILE, newFile, 'utf8');
				console.log('\nAdded local link and updated news.html LOCAL_LINKS.');
				return;
			}

			// non-local: append into ITEMS
			parsed.items.push(newItem);

			if (!SHOULD_WRITE) {
				console.log('\nDry-run: not writing changes. Re-run with --write to persist.');
				console.log('Proposed item:', JSON.stringify(newItem, null, 2));
				return;
			}

			// Persist the updated ITEMS array (only formatting the array portion)
			const newArray = formatItemsArray(parsed.items);
			const newFile = newsHtml.slice(0, parsed.arrayStart) + newArray + newsHtml.slice(parsed.arrayEnd);
			await fs.writeFile(NEWS_FILE, newFile, 'utf8');
			console.log('\nAdded item and updated news.html ITEMS.');
			return;
		} catch (e) {
			process.stdout.write(`  (failed) ${String(e)}\n`);
			return;
		}
	}

	for (const item of parsed.items) {
		if (!item?.url) {
			updated.push(item);
			continue;
		}

		process.stdout.write(`- Fetching metadata: ${item.url}\n`);
		let fetchedTitle = null;
		let fetchedThumb = null;
		try {
			const r = await fetchBestTitle(item.url);
			fetchedTitle = cleanTitle(r.title, item.url);
			// Scrape thumbnails for articles, and for non-YouTube videos (FOX/etc).
			const isYouTube = Boolean(extractYouTubeId(item.url));
			const shouldTryThumb = item.type === "article" || (item.type === "video" && !isYouTube);
			if (shouldTryThumb && r.html) {
				fetchedThumb = extractBestImageFromHtml(r.html, item.url);
			}
		} catch (e) {
			process.stdout.write(`  (failed) ${String(e)}\n`);
		}
		await sleep(REQUEST_DELAY_MS);

		const next = { ...item };
		if (fetchedTitle) {
			next.title = fetchedTitle;
			process.stdout.write(`  title -> ${fetchedTitle}\n`);
		} else {
			process.stdout.write(`  title -> (no title found; kept existing)\n`);
		}

		if (fetchedThumb) {
			next.thumb = fetchedThumb;
			process.stdout.write(`  thumb -> ${fetchedThumb}\n`);
		} else if (next.thumb) {
			process.stdout.write(`  thumb -> (kept existing)\n`);
		} else {
			process.stdout.write(`  thumb -> (none)\n`);
		}

		updated.push(next);
	}

	if (!SHOULD_WRITE) {
		console.log("\nDry-run only. Re-run with --write to update news.html");
		return;
	}

	const newArray = formatItemsArray(updated);
	const newFile = newsHtml.slice(0, parsed.arrayStart) + newArray + newsHtml.slice(parsed.arrayEnd);
	await fs.writeFile(NEWS_FILE, newFile, "utf8");
	console.log("\nUpdated news.html ITEMS titles.");
}

main().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
