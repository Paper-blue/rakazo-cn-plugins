#!/usr/bin/env node
/**
 * Rebuilds .cursor-plugin/marketplace.json and .cursor-plugin/plugin-index.json.
 *
 * Two kinds of entries are produced:
 *   1. Vendored plugins: every directory under plugins/ that carries a manifest is published
 *      as-is, from this repository.
 *   2. Aggregated plugins: taken from the upstream marketplaces listed in sources.json, pinned to
 *      the upstream commit we saw, and described through the component index so nothing has to be
 *      copied into this repo.
 *
 * Run with: node scripts/build-registry.mjs [--check]
 *   --check  fail instead of writing when the committed files are stale.
 */
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const run = promisify(execFile);
const root = path.resolve(import.meta.dirname, '..');
const MARKETPLACE = path.join(root, '.cursor-plugin/marketplace.json');
const INDEX = path.join(root, '.cursor-plugin/plugin-index.json');

const MANIFESTS = ['plugin.json', '.cursor-plugin/plugin.json', '.grok-plugin/plugin.json', '.zcode-plugin/plugin.json', '.claude-plugin/plugin.json'];
const HTTP_TYPES = new Set(['http', 'streamable-http', 'streamable_http', 'sse']);
const CATEGORIES = new Set([
  'productivity', 'communication', 'sales', 'marketing', 'finance', 'people', 'design', 'code', 'data', 'ops',
]);
/** Upstream registry categories mapped onto the codes Rakazo renders as sections. */
const CATEGORY_ALIASES = {
  'developer-tools': 'code',
  development: 'code',
  deployment: 'ops',
  monitoring: 'ops',
  observability: 'ops',
  security: 'ops',
  database: 'data',
  media: 'design',
  design: 'design',
  marketing: 'marketing',
  finance: 'finance',
  productivity: 'productivity',
  communication: 'communication',
  sales: 'sales',
  people: 'people',
};
const NAME_RE = /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
const SHA_RE = /^[a-f0-9]{40}$/;

const timeout = (ms) => AbortSignal.timeout(ms);
const UA = { 'user-agent': 'rakazo-cn-plugins', accept: 'application/vnd.github+json' };

async function getText(url) {
  const response = await fetch(url, { signal: timeout(25_000) });
  return response.ok ? response.text() : null;
}

async function getJson(url, headers = {}) {
  const response = await fetch(url, { headers, signal: timeout(30_000) });
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  return response.json();
}

function category(raw, fallback) {
  const value = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, '-');
  if (CATEGORIES.has(value)) return value;
  return CATEGORY_ALIASES[value] ?? CATEGORY_ALIASES[fallback] ?? 'code';
}

function httpServerCount(raw) {
  if (!raw) return 0;
  try {
    const doc = JSON.parse(raw);
    const servers = doc.mcpServers ?? doc.servers ?? {};
    return Object.values(servers).filter(
      (server) => server && typeof server === 'object' && !server.command && HTTP_TYPES.has(String(server.type ?? (server.url ? 'http' : ''))),
    ).length;
  } catch {
    return 0;
  }
}

async function repoHead(repository) {
  const slug = new URL(repository).pathname.slice(1);
  const commit = await getJson(`https://api.github.com/repos/${slug}/commits/HEAD`, UA);
  if (!SHA_RE.test(commit.sha)) throw new Error(`${slug}: unexpected commit sha`);
  return { slug, sha: commit.sha };
}

/** Vendored plugins living in this repository. */
async function vendored() {
  const dir = path.join(root, 'plugins');
  const out = [];
  let names = [];
  try {
    names = (await readdir(dir)).sort();
  } catch {
    return out;
  }
  let head = '0'.repeat(40);
  try {
    head = (await run('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
  } catch {
    /* not a git checkout: the sha is only informational for vendored entries */
  }
  for (const name of names) {
    const pluginDir = path.join(dir, name);
    if (!(await stat(pluginDir)).isDirectory()) continue;
    const manifestPath = MANIFESTS.map((m) => path.join(pluginDir, m)).find(() => true);
    const manifestFile = await Promise.all(MANIFESTS.map(async (m) => ({ m, ok: await stat(path.join(pluginDir, m)).then(() => true).catch(() => false) })));
    const found = manifestFile.find((entry) => entry.ok);
    if (!found) {
      console.warn(`skip plugins/${name}: no manifest (${manifestPath ? '' : MANIFESTS.join(', ')})`);
      continue;
    }
    const manifest = JSON.parse(await readFile(path.join(pluginDir, found.m), 'utf8'));
    const mcpText = await readFile(path.join(pluginDir, 'mcp.json'), 'utf8').catch(() => null);
    const mcpServers = httpServerCount(mcpText);
    const keywords = Array.isArray(manifest.keywords) ? manifest.keywords.slice(0, 20) : [];
    out.push({
      entry: {
        name: manifest.name,
        source: `./plugins/${name}`,
        description: String(manifest.description ?? '').slice(0, 200),
        category: category(manifest.category, 'productivity'),
        keywords,
      },
      index: SHA_RE.test(head) ? { sha: head, components: mcpServers ? { mcpServers: Array.from({ length: mcpServers }, () => ({ description: 'http' })) } : { skills: [{ description: 'skill' }] } } : { components: {} },
    });
  }
  return out;
}

/** Plugins aggregated from the upstream marketplaces in sources.json. */
async function aggregated() {
  const { sources } = JSON.parse(await readFile(path.join(root, 'sources.json'), 'utf8'));
  const out = [];
  for (const source of sources) {
    const indexText = await getText(`https://raw.githubusercontent.com/${new URL(source.repository).pathname.slice(1)}/HEAD/${source.index}`);
    if (!indexText) {
      console.warn(`${source.label}: marketplace index missing, skipped`);
      continue;
    }
    const doc = JSON.parse(indexText);
    const { slug, sha } = await repoHead(source.repository);
    const tree = await getJson(`https://api.github.com/repos/${slug}/git/trees/${sha}?recursive=1`, UA);
    const blobs = (tree.tree ?? []).filter((node) => node.type === 'blob').map((node) => node.path);
    const plugins = doc.plugins ?? [];
    const mcpCounts = await Promise.all(
      plugins.map(async (plugin) => {
        const subdir = String(typeof plugin.source === 'string' ? plugin.source : plugin.path).replace(/^\.\//, '').replace(/\/$/, '');
        const mcpPath = [`${subdir}/mcp.json`, `${subdir}/.mcp.json`].find((candidate) => blobs.includes(candidate));
        return mcpPath ? httpServerCount(await getText(`https://raw.githubusercontent.com/${slug}/HEAD/${mcpPath}`)) : 0;
      }),
    );
    let kept = 0;
    plugins.forEach((plugin, i) => {
      const subdir = String(typeof plugin.source === 'string' ? plugin.source : plugin.path).replace(/^\.\//, '').replace(/\/$/, '');
      const own = blobs.filter((blob) => blob.startsWith(`${subdir}/`)).map((blob) => blob.slice(subdir.length + 1));
      if (!MANIFESTS.some((manifest) => own.includes(manifest))) return;
      const components = {};
      const count = (re) => own.filter((blob) => re.test(blob)).length;
      const skills = count(/^skills\/[^/]+\/SKILL\.md$/);
      const agents = count(/^agents\/[^/]+\.md$/);
      const commands = count(/^commands\/[^/]+\.md$/);
      if (skills) components.skills = Array.from({ length: skills }, () => ({ description: 'skill' }));
      if (agents) components.agents = Array.from({ length: agents }, () => ({ description: 'agent' }));
      if (commands) components.commands = Array.from({ length: commands }, () => ({ description: 'command' }));
      if (mcpCounts[i] > 0) components.mcpServers = Array.from({ length: mcpCounts[i] }, () => ({ description: 'http' }));
      if (!Object.keys(components).length) return;
      out.push({
        entry: {
          name: plugin.name,
          source: { source: 'url', url: source.repository, sha, path: subdir },
          description: `${source.label}：${String(plugin.description ?? doc.name ?? '').slice(0, 160)}`,
          category: category(plugin.category, source.defaultCategory),
          keywords: [source.label, ...(Array.isArray(plugin.keywords) ? plugin.keywords : [])].slice(0, 20),
        },
        index: { sha, components },
      });
      kept++;
    });
    console.log(`${source.label}: ${kept}/${plugins.length} plugins`);
  }
  return out;
}

const vendoredPlugins = await vendored();
const aggregatedPlugins = await aggregated();

const seen = new Set();
const plugins = [];
const index = { plugins: {} };
for (const { entry, index: componentIndex } of [...vendoredPlugins, ...aggregatedPlugins]) {
  if (!NAME_RE.test(entry.name)) {
    console.warn(`skip ${entry.name}: not a valid plugin name`);
    continue;
  }
  if (seen.has(entry.name)) {
    console.warn(`skip duplicate entry ${entry.name}`);
    continue;
  }
  seen.add(entry.name);
  plugins.push(entry);
  index.plugins[entry.name] = componentIndex;
}

const marketplace = JSON.parse(await readFile(MARKETPLACE, 'utf8').catch(() => '{}'));
const nextMarketplace = {
  ...marketplace,
  name: marketplace.name ?? 'rakazo-cn',
  owner: marketplace.owner ?? { name: 'Paper Blue' },
  plugins,
};
const marketplaceText = `${JSON.stringify(nextMarketplace, null, 2)}\n`;
const indexText = `${JSON.stringify(index, null, 2)}\n`;

const check = process.argv.includes('--check');
const current = {
  marketplace: await readFile(MARKETPLACE, 'utf8').catch(() => ''),
  index: await readFile(INDEX, 'utf8').catch(() => ''),
};
const stale = current.marketplace !== marketplaceText || current.index !== indexText;

if (check) {
  if (stale) {
    console.error('registry is stale: run `node scripts/build-registry.mjs` and commit the result');
    process.exit(1);
  }
  console.log(`registry up to date (${plugins.length} plugins)`);
} else {
  await writeFile(MARKETPLACE, marketplaceText);
  await writeFile(INDEX, indexText);
  console.log(`wrote ${plugins.length} plugins (vendored ${vendoredPlugins.length}, aggregated ${aggregatedPlugins.length})`);
}
