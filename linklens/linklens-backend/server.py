import os
import re
import json
import hashlib
import ipaddress
import urllib.parse
from typing import Dict, Any, List, Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import httpx
from bs4 import BeautifulSoup
from cachetools import TTLCache
from openai import AsyncOpenAI
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="LinkLens Trust & Summary Backend", version="1.4.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

analysis_cache = TTLCache(maxsize=1000, ttl=3600)

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_MODELS = ["openai/gpt-oss-20b", "qwen/qwen3.8-27b", "openai/gpt-oss-120b"]

groq_client = None
if GROQ_API_KEY:
    groq_client = AsyncOpenAI(
        base_url="https://api.groq.com/openai/v1",
        api_key=GROQ_API_KEY
    )

# High-risk / spam-heavy top-level domains
HIGH_RISK_TLDS = {
    "top", "click", "buzz", "work", "fit", "surf", "zip", "mov", "rest", "cam", 
    "country", "stream", "gq", "cf", "tk", "ml", "ga", "loan", "men", "mom", "date"
}

# Suspicious keywords in subdomains/paths often used in phishing
SUSPICIOUS_KEYWORDS = [
    "verify-account", "login-security", "update-payment", "secure-banking",
    "wallet-connect", "account-alert", "claim-reward", "free-gift", "crypto-airdrop",
    "paypal-login", "apple-id-verify", "bank-auth"
]

class AnalyzeRequest(BaseModel):
    url: str
    extracted_text: Optional[str] = ""
    redirect_count: Optional[int] = 0

def evaluate_url_heuristics(url: str, redirect_count: int = 0) -> Dict[str, Any]:
    """Inspects the URL for spam, phishing, homograph attacks, and tracking bloat."""
    score = 100
    flags = []
    
    parsed = urllib.parse.urlparse(url)
    hostname = (parsed.hostname or "").lower()
    path = parsed.path.lower()
    query = parsed.query.lower()
    
    # 1. Protocol check
    if parsed.scheme == "http":
        score -= 20
        flags.append("Insecure protocol (HTTP)")
    
    # 2. IP Address Host check
    try:
        ipaddress.ip_address(hostname)
        score -= 35
        flags.append("Direct IP address used instead of domain")
    except ValueError:
        pass
    
    # 3. Punycode / Homograph attack check
    if "xn--" in hostname:
        score -= 30
        flags.append("Punycode detected (potential homograph/spoofing attack)")
    
    # 4. High-risk TLD check
    parts = hostname.split(".")
    if len(parts) > 1:
        tld = parts[-1]
        if tld in HIGH_RISK_TLDS:
            score -= 25
            flags.append(f"High-risk spam TLD (.${tld})")
            
    # 5. Excessive Subdomain Stacking
    if len(parts) > 4:
        score -= 15
        flags.append(f"Suspicious subdomain depth ({len(parts)} levels)")
        
    # 6. Phishing keywords in hostname
    for kw in SUSPICIOUS_KEYWORDS:
        if kw in hostname or kw in path:
            score -= 35
            flags.append(f"Deceptive keyword detected: '{kw}'")
            break
            
    # 7. URL Tracker / Affiliate overload
    trackers = ["utm_source", "aff_id", "click_id", "ref_id", "fbclid", "gclid", "sub_id"]
    detected_trackers = [t for t in trackers if t in query]
    if len(detected_trackers) >= 3:
        score -= 10
        flags.append(f"Heavy affiliate/tracking payload ({len(detected_trackers)} trackers)")
        
    # 8. Excessive Redirects
    if redirect_count >= 2:
        score -= 15
        flags.append(f"Multiple redirection hops detected ({redirect_count} hops)")
        
    # Clamp score between 5 and 100
    score = max(5, min(100, score))
    
    # Determine level and verdict
    if score >= 85:
        verdict = "Trustworthy"
        level = "safe"
    elif score >= 60:
        verdict = "Caution Advised"
        level = "caution"
    else:
        verdict = "Spam / High Risk"
        level = "danger"
        
    return {
        "score": score,
        "verdict": verdict,
        "level": level,
        "flags": flags
    }

async def run_ai_safety_and_summary(url: str, text: str, initial_safety: Dict[str, Any]) -> Dict[str, Any]:
    """Uses Groq to generate a summary and verify contextual link spam/safety."""
    if not groq_client:
        return {
            "summary": "AI summary unavailable (no API key configured).",
            "key_takeaways": [],
            "category": "General",
            "safety": initial_safety
        }

    clean_text = text[:3500].strip()
    
    system_prompt = (
        "You are an expert web security analyst and content summarizer. "
        "Analyze the provided webpage URL and text for credibility, spam, phishing, and content substance.\n"
        "Return STRICT JSON only matching this exact structure without markdown backticks:\n"
        "{\n"
        '  "summary": "1 to 2 clear, objective sentences summarizing what the link contains.",\n'
        '  "key_takeaways": ["Takeaway 1", "Takeaway 2", "Takeaway 3"],\n'
        '  "category": "Technology | News | E-commerce | Blog | Spam / Adware | Security Alert",\n'
        '  "is_spam": true/false,\n'
        '  "spam_reason": "Brief reason if spam/suspicious, or \'Legitimate content\' if safe."\n'
        "}"
    )

    user_prompt = f"Target URL: {url}\n\nWebpage Extract:\n{clean_text if clean_text else 'No text extracted (blank or JS-rendered).'}"

    for model in GROQ_MODELS:
        try:
            response = await groq_client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                temperature=0.2,
                max_tokens=400,
            )
            raw = response.choices[0].message.content.strip()
            # Clean markdown codeblocks if returned
            if raw.startswith("```"):
                raw = re.sub(r"^```(?:json)?\n?", "", raw)
                raw = re.sub(r"\n?```$", "", raw)
            
            parsed = json.loads(raw)
            
            # Merge AI spam verdict into the heuristic safety score
            final_safety = dict(initial_safety)
            if parsed.get("is_spam") is True:
                final_safety["score"] = min(final_safety["score"], 45)
                final_safety["verdict"] = "Spam / High Risk"
                final_safety["level"] = "danger"
                final_safety["flags"].append(f"AI Warning: {parsed.get('spam_reason', 'Spam detected')}")
            
            return {
                "summary": parsed.get("summary", "No summary available."),
                "key_takeaways": parsed.get("key_takeaways", []),
                "category": parsed.get("category", "General"),
                "safety": final_safety
            }
        except Exception:
            continue

    # Fallback if LLM fails
    return {
        "summary": clean_text[:200] + "..." if clean_text else "Page preview available in live tab.",
        "key_takeaways": [],
        "category": "General",
        "safety": initial_safety
    }

@app.post("/api/analyze")
async def analyze_link(req: AnalyzeRequest):
    url_hash = hashlib.md5(req.url.encode("utf-8")).hexdigest()
    if url_hash in analysis_cache:
        return analysis_cache[url_hash]

    # 1. Run immediate rule-based heuristics
    initial_safety = evaluate_url_heuristics(req.url, req.redirect_count or 0)

    # 2. Fetch page text if not supplied by client
    extracted_text = req.extracted_text
    if not extracted_text:
        try:
            async with httpx.AsyncClient(timeout=4.0, follow_redirects=True) as client:
                resp = await client.get(req.url, headers={"User-Agent": "Mozilla/5.0 LinkLensBot/1.4"})
                if resp.status_code == 200:
                    soup = BeautifulSoup(resp.text, "html.parser")
                    for s in soup(["script", "style", "nav", "footer", "header", "svg"]):
                        s.decompose()
                    extracted_text = " ".join(soup.stripped_strings)[:4000]
        except Exception:
            extracted_text = ""

    # 3. Run AI Trust & Summary Analysis
    result = await run_ai_safety_and_summary(req.url, extracted_text, initial_safety)
    
    analysis_cache[url_hash] = result
    return result

@app.get("/health")
def health_check():
    return {"status": "ok", "service": "LinkLens Trust & Summary Engine", "version": "1.4.0"}