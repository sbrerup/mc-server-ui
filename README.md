# DripCraft Admin

A web panel for the [DripCraft](https://github.com/sbrerup/dripcraft) Minecraft
server: every setting in one place, grouped by what it affects, with a tooltip
explaining each one. It also manages players, game rules, backups and world
pre-generation, and shows the server's health and log.

It is reachable only on the tailnet, and asks for a password.

## How a change reaches the server

Argo CD deploys dripcraft's manifests with self-heal on, so editing the cluster
directly would just be undone. The panel changes things the way a person would.

```text
Settings  -> review -> one commit to dripcraft -> Argo CD -> server restarts
Game rules, whitelist, console -> rcon-cli in the pod -> applies instantly
```

The review dialog lists each change and anything that follows from it, says who is
online, and can show the exact file diff. The dashboard then tracks the commit
through Argo CD to a running server.

Commits go straight to `main` by default. To review each one on GitHub instead, set
`APPLY_MODE` to `pull-request` in `manifests/deployment.yaml`.

### What it protects against

The panel runs the same rules as dripcraft's `tests/test_manifests.py`, because
nothing else stands between a commit and a redeploy:

- Settings that must agree move together: mob spawn range follows simulation
  distance, the pod's memory limit stays 4 GiB above the heap, and the shutdown
  timeout stays above the restart warning plus the save time.
- Plugins must be pinned as `project:version`.
- Changes that weaken something, such as turning off the whitelist or anti-xray or
  removing Prism, need confirming first.
- The Proxy Protocol settings and RCON are locked, because changing them also needs
  a change outside this repository.

If the same setting changed in Git after the page loaded, applying reports a
conflict rather than overwriting it.

### What it leaves alone

- **Prism's config:** it is HOCON, which the image's patcher cannot edit.
- **Restoring a backup:** it replaces the live world and needs the StatefulSet
  scaled down, so it stays a manual step (see dripcraft's README).
- **Secrets, image digests, volumes and network policies:** these stay in Git and
  the cluster. Renovate proposes image updates.
- **The uptime check:** it has nothing to configure beyond its Secret.

## Deploying

The panel follows dripcraft's pattern: its manifests live in `manifests/` here, and
dripcloud points Argo CD at them.

1. Create `sbrerup/mc-server-ui` as a public repository and push this to `main`.
   Public means Argo CD and the cluster need no credentials. The workflow runs the
   tests and publishes `ghcr.io/sbrerup/mc-server-ui`. If that package comes out
   private, make it public in its package settings.

2. Create a [fine-grained token](https://github.com/settings/personal-access-tokens)
   for `sbrerup/dripcraft` only, with **Contents: read and write**. Add
   **Pull requests: read and write** if you use `pull-request` mode.

3. Create the namespace and Secret, which live only in the cluster. Replace `TOKEN`
   with the token from step 2.

   ```bash
   kubectl create namespace dripcraft-admin
   ```

   In bash:

   ```bash
   kubectl -n dripcraft-admin create secret generic dripcraft-admin \
     --from-literal=ui-password="$(openssl rand -base64 18)" \
     --from-literal=github-token=TOKEN
   ```

   In PowerShell 7:

   ```powershell
   kubectl -n dripcraft-admin create secret generic dripcraft-admin "--from-literal=ui-password=$([Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(18)))" --from-literal=github-token=TOKEN
   ```

4. Copy `deploy/dripcloud-app.yaml` to `apps/dripcraft-admin.yaml` in dripcloud and
   merge it.

5. Open `https://dripcraft-admin.turtle-vector.ts.net`. The password is in the
   Secret.

   In bash:

   ```bash
   kubectl -n dripcraft-admin get secret dripcraft-admin -o jsonpath='{.data.ui-password}' | base64 -d
   ```

   In PowerShell:

   ```powershell
   [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String((kubectl -n dripcraft-admin get secret dripcraft-admin -o jsonpath='{.data.ui-password}')))
   ```

Renovate pins the image to a digest once it runs on this repository. Until then the
Deployment uses `latest`.

## Security

The panel can commit to a repository that Argo CD deploys automatically, and run
commands on the server, so treat access to it like cluster admin.

- It is tailnet-only, under the same `tag:k8s-admin` as Argo CD, with a password on
  top. Sessions last 30 days, and changing the password signs everyone out.
- It uses `pods/exec` rather than opening RCON to the network, so dripcraft's network
  policies are unchanged. That access covers only `minecraft-0`, and it cannot read
  Secrets. Argo CD access is read-only, for one Application.
- It runs in its own namespace with default-deny policies. It accepts traffic only
  from the Tailscale proxy, and can reach only DNS, the Kubernetes API and public
  HTTPS.
- Only values listed in the settings catalog ever reach the browser. The server's
  files contain secrets such as the RCON password, and those are never sent.

## Developing

Demo mode runs against a pretend server and repository, so nothing real is touched.
The password is `demo`.

```bash
npm install
```

```bash
npm run dev
```

Then open <http://localhost:5173>. To use the built app instead, run `npm run build`
and `npm run demo`, and open <http://localhost:8080>.

To run against the real server from your machine, use your own kubeconfig and a local
checkout of dripcraft, which it writes to without committing. Game rule and player
changes still reach the real server.

```bash
CLUSTER_MODE=kubectl LOCAL_REPO_PATH=../dripcraft UI_PASSWORD=choose-one COOKIE_SECURE=false npm run dev:server
```

### Layout

- `shared/catalog/` is every setting: its group, tooltip, default and where it is
  stored. Adding a setting here is all that's needed to make it appear.
- `shared/rules.ts` holds the links between settings and the validation. The browser
  uses it for instant feedback, and the server runs it again.
- `server/manifest.ts` edits the manifests by replacing exact byte ranges, so comments
  and formatting survive and a commit changes only what it should.
- `server/game.ts` is everything that talks to the running server.

### Testing

```bash
npm test
```

`test/fixtures/live/` holds config files copied from the running server, with secrets
removed. The tests check that every setting points at a key that really exists in
them, and that each default matches. After a Minecraft or Paper upgrade, copy those
files again and run the tests: they show which settings were renamed or removed.
Game rule names were checked with `rcon-cli gamerule NAME`, and need checking the same
way.

The tests also copy dripcraft's rules, so when its `tests/test_manifests.py` gains a
rule, add it to `shared/rules.ts` and `test/api.test.ts`.
