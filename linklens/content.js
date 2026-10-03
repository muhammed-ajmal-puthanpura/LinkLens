/**
 * LinkLens - Content Script (v1.4.0 - AMO Verified)
 */

(function () {
  let activeCard = null;
  let hoverTimeout = null;
  let dismissalGraceTimeout = null;
  let currentTargetLink = null;
  let isMouseInsideCard = false;

  let altPressed = false;
  let pointerX = 0;
  let pointerY = 0;
  let pointerKnown = false;

  let userSettings = {
    linklens_enabled: true,
    require_alt: true,
    backend_url: "https://linklens-api.onrender.com"
  };

  function loadSettings() {
    if (chrome?.storage?.sync) {
      chrome.storage.sync.get(userSettings, (items) => {
        if (items) userSettings = Object.assign({}, userSettings, items);
      });

      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "sync") {
          for (let key in changes) {
            userSettings[key] = changes[key].newValue;
          }
        }
      });
    }
  }

  function init() {
    loadSettings();

    document.addEventListener("mousemove", (e) => {
      pointerX = e.clientX;
      pointerY = e.clientY;
      pointerKnown = true;
    }, true);

    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("keyup", handleKeyUp, true);
    document.addEventListener("mouseover", handleMouseOver, true);
    document.addEventListener("mouseout", handleMouseOut, true);

    window.addEventListener("blur", () => {
      altPressed = false;
      clearTimeout(hoverTimeout);
      if (activeCard && isMouseInsideCard) {
        clearTimeout(dismissalGraceTimeout);
      }
    });
  }

  function isAltKey(e) {
    return e.key === "Alt" || e.code === "AltLeft" || e.code === "AltRight";
  }

  function handleKeyDown(e) {
    if (!isAltKey(e)) return;
    altPressed = true;

    if (!userSettings.linklens_enabled) return;
    if (!pointerKnown) return;

    const target = document.elementFromPoint(pointerX, pointerY);
    if (!target || target.closest("#linklens-card")) return;

    const anchor = target.closest("a");
    if (isValidLink(anchor)) {
      schedulePreview(anchor);
    }
  }

  function handleKeyUp(e) {
    if (!isAltKey(e)) return;
    altPressed = false;
    clearTimeout(hoverTimeout);
    hoverTimeout = null;
    if (!activeCard) currentTargetLink = null;
  }

  function handleMouseOver(e) {
    if (!userSettings.linklens_enabled) return;

    const target = e.target instanceof Element ? e.target : null;
    if (!target) return;

    if (target.closest("#linklens-card")) {
      isMouseInsideCard = true;
      clearTimeout(dismissalGraceTimeout);
      return;
    }

    const anchor = target.closest("a");
    if (!isValidLink(anchor)) return;

    if (e.altKey) altPressed = true;
    if (userSettings.require_alt && !altPressed) return;

    schedulePreview(anchor);
  }

  function schedulePreview(anchor) {
    if (!isValidLink(anchor)) return;

    if (currentTargetLink === anchor && activeCard) {
      clearTimeout(dismissalGraceTimeout);
      return;
    }

    if (currentTargetLink === anchor && hoverTimeout) return;

    clearTimeout(hoverTimeout);
    clearTimeout(dismissalGraceTimeout);
    currentTargetLink = anchor;

    hoverTimeout = setTimeout(() => {
      hoverTimeout = null;
      if (userSettings.require_alt && !altPressed) {
        if (!activeCard && currentTargetLink === anchor) currentTargetLink = null;
        return;
      }
      if (!anchor.isConnected) return;
      renderCard(anchor);
    }, 250);
  }

  function handleMouseOut(e) {
    const related = e.relatedTarget;

    if (related && (related.closest("#linklens-card") || related.closest("a") === currentTargetLink)) {
      return;
    }

    if (e.target.closest && e.target.closest("#linklens-card")) {
      isMouseInsideCard = false;
    }

    clearTimeout(hoverTimeout);
    clearTimeout(dismissalGraceTimeout);

    dismissalGraceTimeout = setTimeout(() => {
      if (!isMouseInsideCard) removeCard();
    }, 220);
  }

  function isValidLink(anchor) {
    if (!anchor || !anchor.href) return false;
    const href = anchor.href.trim();
    if (href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:") || href.startsWith("tel:")) {
      return false;
    }
    try {
      const url = new URL(href);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }

  function removeCard() {
    if (activeCard) {
      activeCard.classList.remove("linklens-visible");
      setTimeout(() => {
        if (activeCard && activeCard.parentNode) {
          activeCard.parentNode.removeChild(activeCard);
        }
        activeCard = null;
        currentTargetLink = null;
        isMouseInsideCard = false;
      }, 150);
    }
  }

  function positionCard(card, targetAnchor) {
    const rect = targetAnchor.getBoundingClientRect();
    const cardWidth = 540;
    const cardHeight = 480;
    const margin = 12;

    let top = rect.bottom + window.scrollY + margin;
    let left = rect.left + window.scrollX;

    if (rect.bottom + cardHeight + margin > window.innerHeight && rect.top - cardHeight - margin > 0) {
      top = rect.top + window.scrollY - cardHeight - margin;
      card.classList.add("position-top");
    } else {
      card.classList.remove("position-top");
    }

    if (left + cardWidth > window.innerWidth - 20) {
      left = window.innerWidth - cardWidth - 20;
    }
    if (left < 10) left = 10;

    card.style.top = top + "px";
    card.style.left = left + "px";
  }

  function getClientPreflight(urlStr) {
    try {
      const url = new URL(urlStr);
      const isHttp = url.protocol === "http:";
      const isPuny = url.hostname.includes("xn--");
      const isIp = /^(\d{1,3}\.){3}\d{1,3}$/.test(url.hostname);

      if (isIp || isPuny) return { score: 40, level: "danger", verdict: "High Risk" };
      if (isHttp) return { score: 70, level: "caution", verdict: "Unencrypted" };
      return { score: 95, level: "safe", verdict: "Scanning..." };
    } catch {
      return { score: 50, level: "caution", verdict: "Unknown" };
    }
  }

  function getTrustIcon(level) {
    if (level === "safe") return "🛡️";
    if (level === "caution") return "⚠️";
    return "🚨";
  }

  function setText(el, val) {
    if (el) el.textContent = val || "";
  }

  // Static shell template without variable interpolation to satisfy AMO linters
  const CARD_SHELL = `
    <div class="linklens-header">
      <div class="linklens-domain-group">
        <img class="linklens-favicon" id="linklens-favicon-img" src="" alt="" />
        <div class="linklens-url-wrap">
          <span class="linklens-domain" id="linklens-domain-txt"></span>
          <span class="linklens-path" id="linklens-path-txt"></span>
        </div>
      </div>
      <div class="linklens-header-badges">
        <div class="linklens-trust-badge" id="linklens-trust-pill">
          <span class="trust-icon" id="linklens-trust-icon"></span>
          <span class="trust-label" id="linklens-trust-label"></span>
        </div>
      </div>
    </div>

    <div class="linklens-nav">
      <button class="linklens-tab-btn active" data-tab="summary">✨ Summary & Trust</button>
      <button class="linklens-tab-btn" data-tab="preview">🌐 Live Preview</button>
      <button class="linklens-tab-btn" data-tab="reader">📖 Reader</button>
    </div>

    <div class="linklens-body">
      <div class="linklens-tab-content tab-summary active" id="tab-summary">
        <div class="linklens-safety-card" id="linklens-safety-card">
          <div class="safety-score-row">
            <div class="safety-gauge-wrap">
              <div class="safety-score-num" id="safety-score-num">--</div>
              <div class="safety-score-title">Trust</div>
            </div>
            <div class="safety-status-desc">
              <div class="safety-status-headline" id="safety-status-headline">Analyzing Link Safety...</div>
              <div class="safety-status-sub" id="safety-status-sub">Scanning destination for threats, spam, and tracking payload.</div>
            </div>
          </div>
          <div class="safety-flags-list" id="safety-flags-list"></div>
        </div>

        <div class="linklens-meta-section">
          <h4 class="linklens-title" id="linklens-meta-title">Fetching metadata...</h4>
          <p class="linklens-desc" id="linklens-meta-desc">Reading destination headers...</p>
        </div>

        <div class="linklens-ai-section">
          <div class="linklens-ai-header">
            <span class="ai-sparkle">✦</span>
            <span class="ai-label">AI Key Gist</span>
            <span class="ai-tag" id="ai-category-tag">Analyzing</span>
          </div>
          <p class="linklens-ai-summary" id="linklens-ai-summary">
            <span class="linklens-shimmer">Synthesizing page content and scanning for spam patterns...</span>
          </p>
          <ul class="linklens-takeaways" id="linklens-takeaways"></ul>
        </div>
      </div>

      <div class="linklens-tab-content tab-preview" id="tab-preview">
        <div class="linklens-preview-barrier" id="linklens-preview-barrier" style="display: none;">
          <div class="barrier-warning">
            <span class="barrier-icon">🚨</span>
            <h3>High Risk Link Blocked</h3>
            <p>This destination was flagged as spam or high-risk. Preview is held to safeguard your session.</p>
            <button class="btn-override-load" id="btn-override-load">Load Anyway (Sandboxed)</button>
          </div>
        </div>
        <iframe 
          class="linklens-iframe" 
          id="linklens-iframe"
          sandbox="allow-scripts allow-same-origin allow-forms"
          loading="lazy"
          src="about:blank">
        </iframe>
      </div>

      <div class="linklens-tab-content tab-reader" id="tab-reader">
        <div class="linklens-reader-body" id="linklens-reader-body">
          <p class="linklens-shimmer">Extracting clean readable content...</p>
        </div>
      </div>
    </div>

    <div class="linklens-footer">
      <span class="linklens-shortcut-hint" id="linklens-shortcut-hint">Alt + hover to inspect • Move inside to scroll</span>
      <a class="linklens-external-link" id="linklens-external-link" href="#" target="_blank" rel="noopener noreferrer">
        Open in New Tab ↗
      </a>
    </div>
  `;

  function renderCard(anchor) {
    removeCard();

    const targetUrl = anchor.href;
    const preflight = getClientPreflight(targetUrl);
    let parsedUrl;
    try {
      parsedUrl = new URL(targetUrl);
    } catch {
      return;
    }

    const card = document.createElement("div");
    card.id = "linklens-card";
    card.innerHTML = CARD_SHELL;

    // Safely populate dynamic attributes & text nodes
    const faviconImg = card.querySelector("#linklens-favicon-img");
    if (faviconImg) {
      faviconImg.src = "https://www.google.com/s2/favicons?domain=" + encodeURIComponent(parsedUrl.hostname) + "&sz=32";
    }

    setText(card.querySelector("#linklens-domain-txt"), parsedUrl.hostname);
    setText(card.querySelector("#linklens-path-txt"), parsedUrl.pathname + parsedUrl.search);

    const trustPill = card.querySelector("#linklens-trust-pill");
    if (trustPill) {
      trustPill.className = "linklens-trust-badge linklens-trust-" + preflight.level;
    }
    setText(card.querySelector("#linklens-trust-icon"), getTrustIcon(preflight.level));
    setText(card.querySelector("#linklens-trust-label"), preflight.verdict);

    const shortcutHint = card.querySelector("#linklens-shortcut-hint");
    setText(shortcutHint, (userSettings.require_alt ? "Alt + hover to inspect" : "Hover to inspect") + " • Move inside to scroll");

    const extLink = card.querySelector("#linklens-external-link");
    if (extLink) {
      extLink.href = targetUrl;
    }

    document.body.appendChild(card);
    activeCard = card;
    positionCard(card, anchor);

    requestAnimationFrame(() => {
      card.classList.add("linklens-visible");
    });

    // Tab buttons
    card.querySelectorAll(".linklens-tab-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        switchTab(card, btn.getAttribute("data-tab"), targetUrl);
      });
    });

    // Mouse tracking inside card
    card.addEventListener("mouseenter", () => {
      isMouseInsideCard = true;
      clearTimeout(dismissalGraceTimeout);
    });

    card.addEventListener("mouseleave", (e) => {
      if (e.relatedTarget && e.relatedTarget.closest("a") === currentTargetLink) return;
      isMouseInsideCard = false;
      clearTimeout(dismissalGraceTimeout);
      dismissalGraceTimeout = setTimeout(() => {
        if (!isMouseInsideCard) removeCard();
      }, 200);
    });

    loadCardData(targetUrl, card);
  }

  function switchTab(card, tabName, targetUrl) {
    card.querySelectorAll(".linklens-tab-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-tab") === tabName);
    });
    card.querySelectorAll(".linklens-tab-content").forEach((content) => {
      content.classList.toggle("active", content.id === "tab-" + tabName);
    });

    if (tabName === "preview") {
      const iframe = card.querySelector("#linklens-iframe");
      const barrier = card.querySelector("#linklens-preview-barrier");
      if (card.dataset.safetyLevel === "danger" && !card.dataset.forceLoaded) {
        barrier.style.display = "flex";
      } else if (iframe && (iframe.src === "about:blank" || !iframe.src)) {
        iframe.src = targetUrl;
      }
    }
  }

  async function loadCardData(targetUrl, card) {
    let extractedText = "";

    chrome.runtime.sendMessage({ action: "fetchMeta", url: targetUrl }, (res) => {
      if (!activeCard || activeCard !== card) return;

      if (res && res.success && res.data) {
        const { title, description, paragraphs, textContent } = res.data;
        extractedText = textContent || "";

        setText(card.querySelector("#linklens-meta-title"), title || "Untitled Page");
        setText(card.querySelector("#linklens-meta-desc"), description || "No meta description provided.");

        const readerBody = card.querySelector("#linklens-reader-body");
        if (readerBody) {
          readerBody.textContent = "";
          if (paragraphs && paragraphs.length > 0) {
            paragraphs.forEach((p) => {
              const pEl = document.createElement("p");
              pEl.textContent = p;
              readerBody.appendChild(pEl);
            });
          } else {
            const pEl = document.createElement("p");
            pEl.textContent = "No clean readable body content could be parsed.";
            readerBody.appendChild(pEl);
          }
        }
      }

      chrome.runtime.sendMessage(
        {
          action: "analyzeLink",
          payload: { url: targetUrl, extracted_text: extractedText }
        },
        (backendRes) => {
          if (!activeCard || activeCard !== card) return;

          if (backendRes && backendRes.success && backendRes.data) {
            applyAnalysis(card, backendRes.data, targetUrl);
          } else {
            const aiSummary = card.querySelector("#linklens-ai-summary");
            if (aiSummary) {
              aiSummary.textContent = "Summary engine offline. Live preview & Reader mode remain active.";
            }
          }
        }
      );
    });
  }

  function applyAnalysis(card, data, targetUrl) {
    const { summary, key_takeaways, category, safety } = data;

    const trustPill = card.querySelector("#linklens-trust-pill");
    const trustLabel = card.querySelector("#linklens-trust-label");
    if (trustPill && safety) {
      card.dataset.safetyLevel = safety.level;
      trustPill.className = "linklens-trust-badge linklens-trust-" + safety.level;
      setText(card.querySelector("#linklens-trust-icon"), getTrustIcon(safety.level));
      if (trustLabel) trustLabel.textContent = safety.score + "% Trust • " + safety.verdict;
    }

    const safetyCard = card.querySelector("#linklens-safety-card");
    const scoreNum = card.querySelector("#safety-score-num");
    const headline = card.querySelector("#safety-status-headline");
    const sub = card.querySelector("#safety-status-sub");
    const flagsList = card.querySelector("#safety-flags-list");

    if (safetyCard && safety) {
      safetyCard.className = "linklens-safety-card safety-" + safety.level;
      setText(scoreNum, String(safety.score));
      setText(
        headline,
        safety.level === "safe"
          ? "Verified Structure"
          : safety.level === "caution"
          ? "Proceed with Caution"
          : "Spam or Phishing Risk"
      );
      setText(
        sub,
        safety.level === "safe"
          ? "No deceptive redirects, homograph spoofing, or spam patterns detected."
          : "Suspicious traits or marketing tracker loops were identified."
      );

      if (flagsList) {
        flagsList.textContent = "";
        if (safety.flags && safety.flags.length > 0) {
          safety.flags.forEach((flag) => {
            const span = document.createElement("span");
            span.className = "safety-flag-tag";
            span.textContent = "⚠️ " + flag;
            flagsList.appendChild(span);
          });
        } else {
          const span = document.createElement("span");
          span.className = "safety-flag-tag flag-ok";
          span.textContent = "✓ Safe Protocol & Domain";
          flagsList.appendChild(span);
        }
      }
    }

    const overrideBtn = card.querySelector("#btn-override-load");
    if (overrideBtn) {
      overrideBtn.onclick = () => {
        card.dataset.forceLoaded = "true";
        card.querySelector("#linklens-preview-barrier").style.display = "none";
        card.querySelector("#linklens-iframe").src = targetUrl;
      };
    }

    setText(card.querySelector("#linklens-ai-summary"), summary || "No summary available.");
    setText(card.querySelector("#ai-category-tag"), category || "General");

    const takeawaysList = card.querySelector("#linklens-takeaways");
    if (takeawaysList && key_takeaways && key_takeaways.length > 0) {
      takeawaysList.textContent = "";
      key_takeaways.forEach((item) => {
        const li = document.createElement("li");
        li.textContent = item;
        takeawaysList.appendChild(li);
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();