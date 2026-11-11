// Shown when the server can't render a page (e.g. the preview is still waking up).
// It retries on its own a few times so a temporary hiccup never leaves you stuck here.
export function renderErrorPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>DocuALL is loading…</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#090A0F" />
    <style>
      body { font: 15px/1.5 system-ui, -apple-system, sans-serif; background: #090A0F; color: #FFFFFF; display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 1.5rem; }
      .card { max-width: 28rem; width: 100%; text-align: center; padding: 2rem; }
      h1 { font-size: 1.25rem; margin: 0 0 0.5rem; color: #FFFFFF; }
      p { color: #FFFFFF; margin: 0 0 1.5rem; }
      .spin { width: 36px; height: 36px; margin: 0 auto 1.25rem; border-radius: 50%; border: 3px solid #1E232E; border-top-color: #3B82F6; animation: s 0.9s linear infinite; }
      @keyframes s { to { transform: rotate(360deg); } }
      .actions { display: none; gap: 0.5rem; justify-content: center; flex-wrap: wrap; }
      a, button { min-height: 48px; padding: 0.5rem 1.25rem; border-radius: 0.75rem; font: inherit; font-weight: 600; cursor: pointer; text-decoration: none; border: 1px solid transparent; display: inline-flex; align-items: center; }
      .primary { background: #3B82F6; color: #FFFFFF; }
      .secondary { background: #12151B; color: #FFFFFF; border-color: #1E232E; }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="spin" id="spin"></div>
      <h1 id="title">Getting DocuALL ready…</h1>
      <p id="msg">One moment.</p>
      <div class="actions" id="actions">
        <button class="primary" onclick="sessionStorage.removeItem('docuall-retry');location.reload()">Try again</button>
        <a class="secondary" href="/">Go home</a>
      </div>
    </div>
    <script>
      (function () {
        var key = 'docuall-retry';
        var n = Number(sessionStorage.getItem(key) || '0');
        if (n < 4) {
          sessionStorage.setItem(key, String(n + 1));
          setTimeout(function () { location.reload(); }, 1200 + n * 800);
        } else {
          sessionStorage.removeItem(key);
          document.getElementById('spin').style.display = 'none';
          document.getElementById('title').textContent = "This page didn't load";
          document.getElementById('msg').textContent = 'Something went wrong on our end. Try again or head back home.';
          document.getElementById('actions').style.display = 'flex';
        }
      })();
    </script>
  </body>
</html>`;
}
