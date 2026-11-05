// Runs the API in demo mode and the Vite dev server together: `npm run dev`.
import { spawn } from "node:child_process";

const env = { ...process.env, DEMO: process.env.DEMO ?? "1", COOKIE_SECURE: "false", PORT: "8080" };
const run = (cmd) => spawn(cmd, { stdio: "inherit", shell: true, env });

const api = run("npm run dev:server");
const web = run("npx vite --config vite.config.ts");
const stop = () => {
  api.kill();
  web.kill();
  process.exit();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
