// Boots the Python forensics backend (FastAPI/uvicorn), waits for the
// health probe to come up, then opens the upload UI in the default browser.
// No external npm deps — pure Node built-ins.

const { spawn } = require("node:child_process");
const http = require("node:http");

const HOST = "127.0.0.1";
const PORT = process.env.PORT || "8000";
const URL = `http://${HOST}:${PORT}`;

console.log(`[forensics] starting Python backend on ${URL} ...`);

const py = spawn(
  "python",
  ["-m", "uvicorn", "app:app", "--host", HOST, "--port", PORT],
  { stdio: "inherit", shell: false }
);

py.on("error", (err) => {
  console.error(`[forensics] failed to spawn python: ${err.message}`);
  console.error(`[forensics] is python on PATH? try: npm run setup`);
  process.exit(1);
});

py.on("exit", (code) => {
  if (code !== 0 && code !== null) {
    console.error(`[forensics] backend exited with code ${code}`);
  }
  process.exit(code ?? 0);
});

function probe() {
  return new Promise((resolve) => {
    const req = http.get(`${URL}/healthz`, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(500, () => { req.destroy(); resolve(false); });
  });
}

(async () => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await probe()) {
      console.log(`[forensics] backend is up — opening ${URL}`);
      openBrowser(URL);
      console.log(`[forensics] drag a PDF into the page. Ctrl+C here to stop.`);
      return;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  console.error(`[forensics] backend did not become healthy in 30s — check output above`);
})();

function openBrowser(url) {
  const platform = process.platform;
  if (platform === "win32") {
    // `start` is a cmd builtin — needs shell:true, and an empty title arg
    // so URLs starting with " don't get parsed as the window title.
    spawn("cmd", ["/c", "start", "", url], { stdio: "ignore", detached: true }).unref();
  } else if (platform === "darwin") {
    spawn("open", [url], { stdio: "ignore", detached: true }).unref();
  } else {
    spawn("xdg-open", [url], { stdio: "ignore", detached: true }).unref();
  }
}

// Forward Ctrl+C cleanly to the Python child.
function shutdown() {
  if (!py.killed) py.kill("SIGINT");
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
