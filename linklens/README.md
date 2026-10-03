
# 🔍 LinkLens — AI Link Inspector & Reader

LinkLens is a browser extension that lets you preview links, extract clean reader articles, and inspect domain trustability & spam scores before clicking—all without leaving your active tab.

---

## ✨ Key Features

- **🛡️ Link Trust & Spam Scoring**: Real-time evaluation of punycode attacks, homographs, abusive redirect chains, and deceptive keywords with an AI safety verdict.
- **✨ AI Key Gist**: Groq-powered fast summarization and takeaway extraction.
- **🌐 Live Preview**: Sandboxed iframe preview stripping restrictive headers.
- **📖 Reader Mode**: Distraction-free article extraction on link hover.
- **⌨️ Alt + Hover Trigger**: Zero accidental popups—activate inspection only when you want.
- **🎨 Warm Editorial Aesthetic**: Minimal, readable parchment design.

---

## 🚀 Firefox Setup (Local / Temporary)

1. Open Firefox and go to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on...**.
3. Select `linklens/manifest.json`.
4. Hold <kbd>Alt</kbd> and hover over any link.

---

## 🛠️ Backend Setup (FastAPI + Groq)

```bash
cd linklens-backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Add your GROQ_API_KEY in .env
echo "GROQ_API_KEY=your_key_here" > .env

# Run FastAPI backend:
uvicorn server:app --host 127.0.0.1 --port 8000 --reload


---