import { loadEnv } from "vite";

// Vite embeds VITE_* at build time. A local ignored .env never reaches Git deployments.
// Fail before publishing a login screen with no API connection; never print its value.
const environment = loadEnv("production", process.cwd(), "VITE_");
const endpoint = (environment.VITE_APPS_SCRIPT_URL ?? "").trim();
let valid = false;
try {
  const url = new URL(endpoint);
  valid = url.protocol === "https:" && url.hostname === "script.google.com"
    && /^\/macros\/s\/[A-Za-z0-9_-]+\/exec\/?$/.test(url.pathname)
    && !url.username && !url.password && !url.search && !url.hash
    && !/\/X+\/exec\/?$/i.test(url.pathname);
} catch { /* Report the required setting without exposing configuration. */ }
if (!valid) {
  console.error("Falta una VITE_APPS_SCRIPT_URL válida para este despliegue. En Vercel → Project Settings → Environment Variables, configura la URL HTTPS /exec existente de Apps Script para Production y Preview, y vuelve a desplegar. No uses la URL del Sheet ni /dev.");
  process.exitCode = 1;
} else {
  console.log("Conexión de Apps Script configurada para la compilación.");
}
