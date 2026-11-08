#!/usr/bin/env node
/**
 * Validates the registry against the constraints Rakazo's plugin marketplace enforces, so a bad
 * entry fails here instead of silently disappearing from the market.
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const MANIFESTS = ['plugin.json', '.cursor-plugin/plugin.json', '.grok-plugin/plugin.json', '.zcode-plugin/plugin.json', '.claude-plugin/plugin.json'];
const NAME_RE = /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
const SHA_RE = /^[a-f0-9]{40}$/;
const GITHUB_RE = /^https:\/\/github\.com\/[^/]+\/[^/]+$/;
const CATEGORIES = new Set(['productivity', 'communication', 'sales', 'marketing', 'finance', 'people', 'design', 'code', 'data', 'ops']);
const COMPONENT_KINDS = new Set(['skills', 'agents', 'commands', 'mcpServers']);
const SENSITIVE_QUERY = /(auth|credential|key|password|secret|token)/i;

const problems = [];
const fail = (message) => problems.push(message);

const marketplace = JSON.parse(await readFile(path.join(root, '.cursor-plugin/marketplace.json'), 'utf8'));
const index = JSON.parse(await readFile(path.join(root, '.cursor-plugin/plugin-index.json'), 'utf8'));
const plugins = marketplace.plugins;
if (!Array.isArray(plugins) || !plugins.length) fail('marketplace.json has no plugins');

const names = new Set();
let vendored = 0;
let pinned = 0;

for (const entry of plugins) {
  const where = `plugin "${entry.name}"`;
  if (typeof entry.name !== 'string' || !NAME_RE.test(entry.name)) fail(`${where}: name does not match ${NAME_RE}`);
  if (names.has(entry.name)) fail(`${where}: duplicate name`);
  names.add(entry.name);
  if (!entry.description || typeof entry.description !== 'string') fail(`${where}: missing description`);
  if (!CATEGORIES.has(entry.category)) fail(`${where}: category "${entry.category}" is not one of ${[...CATEGORIES].join(', ')}`);
  if (entry.keywords && (!Array.isArray(entry.keywords) || entry.keywords.length > 50)) fail(`${where}: keywords must be an array of at most 50`);

  const source = entry.source;
  if (typeof source === 'string') {
    const dir = source.replace(/^\.\//, '');
    if (!dir.startsWith('plugins/')) fail(`${where}: vendored source must live under plugins/`);
    const pluginDir = path.join(root, dir);
    const exists = await stat(pluginDir).then((s) => s.isDirectory()).catch(() => false);
    if (!exists) fail(`${where}: directory ${dir} is missing`);
    else {
      const manifestPath = await Promise.all(MANIFESTS.map((manifest) => stat(path.join(pluginDir, manifest)).then(() => manifest).catch(() => null)));
      if (!manifestPath.some(Boolean)) fail(`${where}: no supported manifest in ${dir}`);
      const files = await readdir(pluginDir);
      if (files.includes('mcp.json')) {
        const raw = await readFile(path.join(pluginDir, 'mcp.json'), 'utf8');
        if (/\$\{/.test(raw)) fail(`${where}: mcp.json must not contain \${...} placeholders`);
        const doc = JSON.parse(raw);
        for (const [server, config] of Object.entries(doc.mcpServers ?? {})) {
          if (!/^https:\/\//.test(String(config.url ?? ''))) fail(`${where}/${server}: mcp endpoint must be https`);
          if (config.command) fail(`${where}/${server}: local stdio servers cannot be shipped`);
          try {
            const url = new URL(String(config.url));
            for (const key of url.searchParams.keys()) {
              if (SENSITIVE_QUERY.test(key)) fail(`${where}/${server}: credential in query parameter "${key}" is rejected by Rakazo`);
            }
          } catch {
            fail(`${where}/${server}: invalid endpoint URL`);
          }
        }
      }
    }
    vendored++;
  } else if (source && source.source === 'url') {
    if (!GITHUB_RE.test(String(source.url))) fail(`${where}: source url must be a GitHub repository`);
    if (!SHA_RE.test(String(source.sha))) fail(`${where}: source must be pinned to a full commit sha`);
    if (!source.path || typeof source.path !== 'string') fail(`${where}: source.path is required`);
    pinned++;
  } else {
    fail(`${where}: unsupported source shape`);
  }

  const component = index.plugins?.[entry.name];
  if (!component) {
    fail(`${where}: missing component index entry`);
    continue;
  }
  if (!component.components || !Object.keys(component.components).length) fail(`${where}: component index has no components`);
  for (const [kind, parts] of Object.entries(component.components ?? {})) {
    if (!COMPONENT_KINDS.has(kind)) fail(`${where}: component kind "${kind}" is not supported`);
    if (!Array.isArray(parts)) fail(`${where}: component "${kind}" must be an array`);
    if (kind === 'mcpServers') {
      for (const part of parts) if (part?.description !== 'http') fail(`${where}: only http MCP servers can be advertised through the index`);
    }
  }
  if (typeof source === 'object' && SHA_RE.test(String(source.sha)) && component.sha && component.sha !== source.sha) {
    fail(`${where}: index sha ${component.sha} does not match pinned sha ${source.sha}`);
  }
}

for (const name of Object.keys(index.plugins ?? {})) {
  if (!names.has(name)) fail(`component index lists "${name}", which is not in marketplace.json`);
}

const dirs = await readdir(path.join(root, 'plugins')).catch(() => []);
for (const dir of dirs) {
  if (!names.has(dir) && (await stat(path.join(root, 'plugins', dir)).then((s) => s.isDirectory()).catch(() => false))) {
    const manifestPath = await Promise.all(MANIFESTS.map((manifest) => stat(path.join(root, 'plugins', dir, manifest)).then(() => manifest).catch(() => null)));
    if (manifestPath.some(Boolean)) fail(`plugins/${dir} is not published in marketplace.json`);
  }
}

if (problems.length) {
  for (const problem of problems) console.error(`- ${problem}`);
  console.error(`\n${problems.length} problem(s) found`);
  process.exit(1);
}
console.log(`registry ok: ${plugins.length} plugins (${vendored} vendored, ${pinned} pinned upstream)`);
