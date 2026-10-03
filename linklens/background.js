/**
 * LinkLens - Service Worker (v1.4.0)
 */

const RULE_ID = 1;

// Strip framing restrictions for Live Preview tab
chrome.runtime.onInstalled.addListener(() => {
  chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [RULE_ID],
    addRules: [
      {
        id: RULE_ID,
        priority: 1,
        action: {
          type: "modifyHeaders",
          responseHeaders: [
            { header: "x-frame-options", operation: "remove" },
            { header: "content-security-policy", operation: "remove" },
            { header: "frame-options", operation: "remove" },
            { header: "cross-origin-embedder-policy", operation: "remove" },
            { header: "cross-origin-opener-policy", operation: "remove" },
            { header: "cross-origin-resource-policy", operation: "remove" }
          ]
        },
        condition: {
          resourceTypes: ["sub_frame"]
        }
      }
    ]
  });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "fetchMeta") {
    fetchMetadataAndReader(request.url)
      .then((data) => sendResponse({ success: true, data }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true; // Keep message channel open
  }

  if (request.action === "analyzeLink") {
    analyzeViaBackend(request.payload)
      .then((data) => sendResponse({ success: true, data }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true; // Keep message channel open
  }
});

async function analyzeViaBackend(payload) {
  const settings = await chrome.storage.sync.get({
    backend_url: "http://127.0.0.1:8000"
  });

  const baseUrl = (settings.backend_url || "http://127.0.0.1:8000").replace(/\/+$/, "");
  const endpoint = `${baseUrl}/api/analyze`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Backend error HTTP ${response.status}`);
  }

  return await response.json();
}

async function fetchMetadataAndReader(targetUrl) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4000);

  try {
    const res = await fetch(targetUrl, {
      signal: controller.signal,
      headers: {
        "Accept": "text/html,application/xhtml+xml",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) LinkLens/1.4.0"
      }
    });
    clearTimeout(timeoutId);

    const html = await res.text();
    return parseHtml(html);
  } catch {
    return {
      title: "",
      description: "",
      paragraphs: [],
      textContent: ""
    };
  }
}

function parseHtml(html) {
  const getMatch = (re) => {
    const m = html.match(re);
    return m ? m[1].trim() : "";
  };

  const title = getMatch(/<title[^>]*>([^<]+)<\/title>/i) ||
                getMatch(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i) || "";

  const description = getMatch(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i) ||
                      getMatch(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i) || "";

  // Extract clean text paragraphs for Reader view and AI summary
  const pMatches = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)];
  const paragraphs = pMatches
    .map(m => m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim())
    .filter(t => t.length > 40)
    .slice(0, 8);

  const textContent = paragraphs.join(" ");

  return { title, description, paragraphs, textContent };
}