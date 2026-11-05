/** Entry point: reads configuration from the environment and starts the server. */
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync } from "node:fs";
import path from "node:path";
import { createApp, SETTING_COUNT } from "./app";
import { Auth } from "./auth";
import { InClusterCluster, KubectlCluster, type Cluster } from "./cluster";
import { DemoCluster, DemoRepo } from "./demo";
import { Game } from "./game";
import { GithubRepo, LocalRepo, type ConfigRepo } from "./repo";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} must be set. See the README for setup.`);
    process.exit(1);
  }
  return value;
}

const demo = process.env.DEMO === "1";
const namespace = process.env.MC_NAMESPACE ?? "dripcraft-public";
const pod = process.env.MC_POD ?? "minecraft-0";

function buildCluster(): Cluster {
  if (demo) return new DemoCluster();
  switch (process.env.CLUSTER_MODE ?? "in-cluster") {
    case "kubectl":
      return new KubectlCluster(namespace, pod);
    case "proxy":
      return new InClusterCluster(namespace, pod, required("KUBE_API_URL"));
    default:
      return new InClusterCluster(namespace, pod);
  }
}

function buildRepo(cluster: Cluster): ConfigRepo {
  if (demo) return new DemoRepo(cluster as DemoCluster);
  if (process.env.LOCAL_REPO_PATH) return new LocalRepo(process.env.LOCAL_REPO_PATH);
  const [owner, repo] = (process.env.GITHUB_REPO ?? "sbrerup/dripcraft").split("/");
  return new GithubRepo({
    owner: owner!,
    repo: repo!,
    branch: process.env.GITHUB_BRANCH ?? "main",
    token: required("GITHUB_TOKEN"),
    mode: process.env.APPLY_MODE === "pull-request" ? "pull-request" : "direct",
  });
}

const cluster = buildCluster();
const repo = buildRepo(cluster);
const game = new Game(cluster, {
  namespace,
  pod,
  statefulSet: process.env.MC_STATEFULSET ?? "minecraft",
  argoNamespace: process.env.ARGO_NAMESPACE ?? "argocd",
  argoApplication: process.env.ARGO_APPLICATION ?? "dripcraft-public",
});

const password = demo ? (process.env.UI_PASSWORD ?? "demo") : required("UI_PASSWORD");
const app = createApp({
  repo,
  game,
  auth: new Auth(password),
  demo,
  cookieSecure: process.env.COOKIE_SECURE !== "false",
});

// The built browser app sits next to this bundle in dist/.
const webRoot = path.join(__dirname, "web");
if (existsSync(webRoot)) {
  const root = path.relative(process.cwd(), webRoot) || ".";
  app.use("/assets/*", serveStatic({ root }));
  app.use("/favicon.svg", serveStatic({ root }));
  app.get("*", serveStatic({ root, path: "index.html" }));
}

const port = Number(process.env.PORT ?? 8080);
serve({ fetch: app.fetch, port }, () => {
  console.log(`mc-server-ui listening on :${port} with ${SETTING_COUNT} settings${demo ? " (demo mode, password: " + password + ")" : ""}`);
});

for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => process.exit(0));
