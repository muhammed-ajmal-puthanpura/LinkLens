document.addEventListener("DOMContentLoaded", async () => {
  const toggleEnable = document.getElementById("toggle-enable");
  const toggleAlt = document.getElementById("toggle-alt");
  const backendInput = document.getElementById("backend-url");
  const statusEl = document.getElementById("backend-status");
  const btnSave = document.getElementById("btn-save");

  const settings = await chrome.storage.sync.get({
    linklens_enabled: true,
    require_alt: true,
    backend_url: "https://linklens-api.onrender.com"
  });

  toggleEnable.checked = settings.linklens_enabled;
  toggleAlt.checked = settings.require_alt;
  backendInput.value = settings.backend_url;

  checkHealth(settings.backend_url, statusEl);

  btnSave.addEventListener("click", async () => {
    const backend_url = backendInput.value.trim().replace(/\/+$/, "");
    await chrome.storage.sync.set({
      linklens_enabled: toggleEnable.checked,
      require_alt: toggleAlt.checked,
      backend_url
    });
    btnSave.textContent = "Saved ✓";
    checkHealth(backend_url, statusEl);
    setTimeout(() => {
      btnSave.textContent = "Save Settings";
    }, 1200);
  });
});

async function checkHealth(url, statusEl) {
  statusEl.innerHTML = `<span class="status-dot"></span> Checking connection...`;
  try {
    const cleanUrl = url.replace(/\/+$/, "");
    const res = await fetch(`${cleanUrl}/health`, { method: "GET" });
    if (res.ok) {
      statusEl.innerHTML = `<span class="status-dot online"></span> Backend connected (Ready)`;
    } else {
      throw new Error();
    }
  } catch {
    statusEl.innerHTML = `<span class="status-dot offline"></span> Backend offline (Check port 8000)`;
  }
}