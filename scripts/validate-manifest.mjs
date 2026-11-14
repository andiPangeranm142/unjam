#!/usr/bin/env node
/**
 * validate-manifest.mjs — local stand-in for `forge lint`.
 *
 * `forge lint` requires a logged-in Forge CLI, which is unavailable in this
 * sandbox, so this script replicates its main manifest checks:
 *
 *   - YAML parses; required top-level keys present; manifest < 200 KB
 *   - runtime is nodejs24.x; no license key (installation-link sharing)
 *   - every function handler's file exists under src/ and exports the named
 *     function
 *   - every action key referenced by rovo:agent actions[] and rovo:mcp tools[]
 *     exists as an action module, with a valid actionVerb and a function
 *     module behind it
 *   - every skill key in rovo:agent skills[] exists as a rovo:skill module,
 *     its source.dir exists, and its SKILL.md frontmatter name matches the
 *     directory name
 *   - at most one rovo:mcp; rovo:agent name <= 30 chars
 *   - scheduledTrigger intervals are valid
 *   - every resource path exists on disk (and agent prompt files resolve)
 *   - every scope is in the known list
 *
 * Usage: node scripts/validate-manifest.mjs
 * Exit code 0 when all checks pass, 1 otherwise.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_PATH = path.join(ROOT, 'manifest.yml');
const MAX_MANIFEST_BYTES = 200 * 1024;
const VALID_INTERVALS = new Set(['fiveMinute', 'hour', 'day', 'week']);
const VALID_ACTION_VERBS = new Set(['GET', 'CREATE', 'UPDATE', 'DELETE', 'TRIGGER']);
const KNOWN_SCOPES = new Set([
  'read:jira-work',
  'read:jira-user',
  'write:jira-work',
  'storage:app',
  'read:graph:issue:jira',
  'read:graph:issue-status:jira',
  'read:graph:issue-comment:jira',
  'read:graph:user:atlassian',
  'read:graph:team:atlassian',
  'read:graph:goal:atlassian',
  'read:graph:page:confluence',
  'read:graph:pull-request:external',
  'read:confluence-content.all',
]);

const results = [];

function check(name, pass, detail = '') {
  results.push({ name, pass, detail });
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

// ---------------------------------------------------------------------------
// Load the manifest
// ---------------------------------------------------------------------------

let manifest = null;
let manifestBytes = 0;

try {
  const raw = fs.readFileSync(MANIFEST_PATH, 'utf8');
  manifestBytes = Buffer.byteLength(raw, 'utf8');
  manifest = yaml.load(raw);
  check('manifest YAML parses', true, `${MANIFEST_PATH}`);
} catch (err) {
  check('manifest YAML parses', false, String(err.message));
}

if (manifest === null || typeof manifest !== 'object') {
  printSummary();
  process.exit(1);
}

const modules = manifest.modules ?? {};
const resources = asArray(manifest.resources);
const permissions = manifest.permissions ?? {};
const scopes = asArray(permissions.scopes);
const app = manifest.app ?? {};

// ---------------------------------------------------------------------------
// Structure and size
// ---------------------------------------------------------------------------

check(
  'required top-level keys present (modules, permissions, app, resources)',
  ['modules', 'permissions', 'app', 'resources'].every((k) => k in manifest),
  `found: ${Object.keys(manifest).join(', ')}`,
);

check(
  'manifest is smaller than 200 KB',
  manifestBytes < MAX_MANIFEST_BYTES,
  `${manifestBytes} bytes`,
);

check(
  'no license key present (required for installation-link sharing)',
  !('license' in manifest) && !('license' in app),
  'license' in manifest || 'license' in app ? 'license key found' : 'no license key',
);

check(
  'app.runtime.name is nodejs24.x',
  app.runtime?.name === 'nodejs24.x',
  `runtime: ${app.runtime?.name ?? '(missing)'}`,
);

check(
  'app.id is an ecosystem ARI',
  typeof app.id === 'string' && app.id.startsWith('ari:cloud:ecosystem::app/'),
  `id: ${app.id ?? '(missing)'}`,
);

// ---------------------------------------------------------------------------
// Functions and handlers
// ---------------------------------------------------------------------------

const functionModules = asArray(modules.function);
const functionKeys = new Set(functionModules.map((f) => f.key));

for (const fn of functionModules) {
  const label = `function '${fn.key}' handler '${fn.handler}' exists and exports the function`;
  if (typeof fn.handler !== 'string' || !fn.handler.includes('.')) {
    check(label, false, 'handler must be in the form <file>.<export>');
    continue;
  }
  const dot = fn.handler.lastIndexOf('.');
  const filePart = fn.handler.slice(0, dot);
  const exportName = fn.handler.slice(dot + 1);
  const candidates = ['.js', '.jsx', '.mjs'].map((ext) =>
    path.join(ROOT, 'src', `${filePart}${ext}`),
  );
  const filePath = candidates.find((p) => fs.existsSync(p));
  if (!filePath) {
    check(label, false, `no file found under src/ for '${filePart}' (tried .js/.jsx/.mjs)`);
    continue;
  }
  const source = fs.readFileSync(filePath, 'utf8');
  const exportPattern = new RegExp(
    `(export\\s+(async\\s+)?function\\s+${exportName}\\b)` +
      `|(export\\s+const\\s+${exportName}\\b)` +
      `|(export\\s*\\{[^}]*\\b${exportName}\\b[^}]*\\})`,
  );
  check(
    label,
    exportPattern.test(source),
    exportPattern.test(source)
      ? `${path.relative(ROOT, filePath)} exports ${exportName}`
      : `${path.relative(ROOT, filePath)} does not export ${exportName}`,
  );
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

const actionModules = asArray(modules.action);
const actionKeys = new Set(actionModules.map((a) => a.key));

for (const action of actionModules) {
  check(
    `action '${action.key}' has a valid actionVerb`,
    VALID_ACTION_VERBS.has(action.actionVerb),
    `actionVerb: ${action.actionVerb ?? '(missing)'}`,
  );
  check(
    `action '${action.key}' references an existing function module`,
    typeof action.function === 'string' && functionKeys.has(action.function),
    `function: ${action.function ?? '(missing)'}`,
  );
  check(
    `action '${action.key}' has a name and description`,
    typeof action.name === 'string' && action.name.length > 0 &&
      typeof action.description === 'string' && action.description.length > 0,
    '',
  );
  check(
    `action '${action.key}' key is shorter than 64 characters (MCP limit)`,
    typeof action.key === 'string' && action.key.length < 64,
    `${action.key?.length ?? 0} chars`,
  );
}

// Every action key referenced by rovo:agent and rovo:mcp must exist.
const agents = asArray(modules['rovo:agent']);
const mcpModules = asArray(modules['rovo:mcp']);

for (const agent of agents) {
  for (const key of asArray(agent.actions)) {
    check(
      `rovo:agent '${agent.key}' action '${key}' exists as an action module`,
      actionKeys.has(key),
      actionKeys.has(key) ? '' : `no action module with key '${key}'`,
    );
  }
}

for (const mcp of mcpModules) {
  for (const key of asArray(mcp.tools)) {
    check(
      `rovo:mcp '${mcp.key}' tool '${key}' exists as an action module`,
      actionKeys.has(key),
      actionKeys.has(key) ? '' : `no action module with key '${key}'`,
    );
  }
  check(
    `rovo:mcp '${mcp.key}' exposes at most 50 tools`,
    asArray(mcp.tools).length <= 50,
    `${asArray(mcp.tools).length} tools`,
  );
  check(
    `rovo:mcp '${mcp.key}' name is at most 30 characters`,
    typeof mcp.name === 'string' && mcp.name.length <= 30,
    `name: ${mcp.name ?? '(missing)'}`,
  );
  check(
    `rovo:mcp '${mcp.key}' declares only key, name, tools (no description property exists for this module)`,
    Object.keys(mcp).every((k) => ['key', 'name', 'tools'].includes(k)),
    `properties: ${Object.keys(mcp).join(', ')}`,
  );
}

check(
  'at most one rovo:mcp module',
  mcpModules.length <= 1,
  `${mcpModules.length} rovo:mcp module(s)`,
);

// ---------------------------------------------------------------------------
// Rovo agents
// ---------------------------------------------------------------------------

for (const agent of agents) {
  check(
    `rovo:agent '${agent.key}' name is at most 30 characters`,
    typeof agent.name === 'string' && agent.name.length <= 30,
    `name: ${agent.name ?? '(missing)'}`,
  );
  check(
    `rovo:agent '${agent.key}' has a prompt`,
    typeof agent.prompt === 'string' && agent.prompt.length > 0,
    `prompt: ${agent.prompt ?? '(missing)'}`,
  );
}

// Agent prompt resource references must resolve to a real file.
const resourceByKey = new Map(resources.map((r) => [r.key, r.path]));
for (const agent of agents) {
  if (typeof agent.prompt !== 'string' || !agent.prompt.startsWith('resource:')) continue;
  const ref = agent.prompt.slice('resource:'.length);
  const [resourceKey, ...rest] = ref.split(';');
  const relPath = rest.join(';');
  const label = `rovo:agent '${agent.key}' prompt resource '${agent.prompt}' resolves to a file`;
  if (!resourceByKey.has(resourceKey)) {
    check(label, false, `no resource with key '${resourceKey}'`);
    continue;
  }
  const filePath = path.join(ROOT, resourceByKey.get(resourceKey), relPath);
  check(label, fs.existsSync(filePath), fs.existsSync(filePath) ? path.relative(ROOT, filePath) : `missing: ${path.relative(ROOT, filePath)}`);
}

// ---------------------------------------------------------------------------
// Rovo skills
// ---------------------------------------------------------------------------

const skillModules = asArray(modules['rovo:skill']);
const skillByKey = new Map(skillModules.map((s) => [s.key, s]));

for (const agent of agents) {
  for (const key of asArray(agent.skills)) {
    check(
      `rovo:agent '${agent.key}' skill '${key}' exists as a rovo:skill module`,
      skillByKey.has(key),
      skillByKey.has(key) ? '' : `no rovo:skill module with key '${key}'`,
    );
  }
}

for (const skill of skillModules) {
  const dir = skill.source?.dir;
  const dirLabel = `rovo:skill '${skill.key}' source.dir exists`;
  if (typeof dir !== 'string' || dir.length === 0) {
    check(dirLabel, false, 'source.dir is missing');
    continue;
  }
  const dirPath = path.join(ROOT, dir);
  check(dirLabel, fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory(), dir);

  const skillMdPath = path.join(dirPath, 'SKILL.md');
  const existsLabel = `rovo:skill '${skill.key}' SKILL.md exists`;
  if (!fs.existsSync(skillMdPath)) {
    check(existsLabel, false, `missing: ${path.relative(ROOT, skillMdPath)}`);
    continue;
  }
  check(existsLabel, true, path.relative(ROOT, skillMdPath));

  const content = fs.readFileSync(skillMdPath, 'utf8');
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  const fmLabel = `rovo:skill '${skill.key}' SKILL.md frontmatter parses`;
  if (!frontmatterMatch) {
    check(fmLabel, false, 'no YAML frontmatter block found at the top of SKILL.md');
    continue;
  }
  let frontmatter;
  try {
    frontmatter = yaml.load(frontmatterMatch[1]);
    check(fmLabel, true, '');
  } catch (err) {
    check(fmLabel, false, String(err.message));
    continue;
  }

  const dirName = path.basename(dirPath);
  check(
    `rovo:skill '${skill.key}' frontmatter name matches the directory name`,
    frontmatter?.name === dirName,
    `name: ${frontmatter?.name ?? '(missing)'}, directory: ${dirName}`,
  );
  check(
    `rovo:skill '${skill.key}' frontmatter description is at least 50 characters`,
    typeof frontmatter?.description === 'string' && frontmatter.description.length >= 50,
    `${frontmatter?.description?.length ?? 0} chars`,
  );
  const bodyLines = content.slice(frontmatterMatch[0].length).split('\n').length;
  check(
    `rovo:skill '${skill.key}' body is at most 500 lines`,
    bodyLines <= 500,
    `${bodyLines} lines`,
  );

  // allowed-tools must cover every action in dependencies.tools.
  const dependencyTools = asArray(skill.dependencies?.tools);
  for (const tool of dependencyTools) {
    check(
      `rovo:skill '${skill.key}' dependency tool '${tool}' exists as an action module`,
      actionKeys.has(tool),
      actionKeys.has(tool) ? '' : `no action module with key '${tool}'`,
    );
  }
  if (dependencyTools.length > 0) {
    const allowed = new Set(
      typeof frontmatter?.['allowed-tools'] === 'string'
        ? frontmatter['allowed-tools'].split(/\s+/).filter(Boolean)
        : [],
    );
    const missing = dependencyTools.filter((t) => !allowed.has(t));
    check(
      `rovo:skill '${skill.key}' allowed-tools covers all dependency tools`,
      missing.length === 0,
      missing.length === 0 ? `allowed-tools: ${[...allowed].join(' ')}` : `missing: ${missing.join(', ')}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Scheduled triggers
// ---------------------------------------------------------------------------

for (const trigger of asArray(modules.scheduledTrigger)) {
  check(
    `scheduledTrigger '${trigger.key}' interval is valid`,
    VALID_INTERVALS.has(trigger.interval),
    `interval: ${trigger.interval ?? '(missing)'} (valid: ${[...VALID_INTERVALS].join(', ')})`,
  );
  check(
    `scheduledTrigger '${trigger.key}' references an existing function module`,
    typeof trigger.function === 'string' && functionKeys.has(trigger.function),
    `function: ${trigger.function ?? '(missing)'}`,
  );
}

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

for (const resource of resources) {
  const resourcePath = path.join(ROOT, resource.path);
  check(
    `resource '${resource.key}' path exists on disk`,
    fs.existsSync(resourcePath),
    `${resource.path}${fs.existsSync(resourcePath) ? '' : ' (missing)'}`,
  );
}

// UI modules must reference declared resources and resolver functions.
for (const [moduleType, entries] of Object.entries(modules)) {
  if (!moduleType.startsWith('jira:')) continue;
  for (const entry of asArray(entries)) {
    if (entry.resource) {
      check(
        `${moduleType} '${entry.key}' resource '${entry.resource}' is declared`,
        resourceByKey.has(entry.resource),
        resourceByKey.has(entry.resource) ? '' : `no resource with key '${entry.resource}'`,
      );
    }
    if (entry.resolver?.function) {
      check(
        `${moduleType} '${entry.key}' resolver function '${entry.resolver.function}' exists`,
        functionKeys.has(entry.resolver.function),
        functionKeys.has(entry.resolver.function)
          ? ''
          : `no function module with key '${entry.resolver.function}'`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Scopes
// ---------------------------------------------------------------------------

for (const scope of scopes) {
  check(
    `scope '${scope}' is in the known list`,
    KNOWN_SCOPES.has(scope),
    KNOWN_SCOPES.has(scope) ? '' : 'unknown scope — check the spelling against the Forge scopes reference',
  );
}
check(
  'at least one scope is declared',
  scopes.length > 0,
  `${scopes.length} scope(s)`,
);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

function printSummary() {
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  console.log('\nUnjam manifest validation\n========================\n');
  for (const r of results) {
    const mark = r.pass ? 'PASS' : 'FAIL';
    console.log(`[${mark}] ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
  }
  console.log(`\n${passed} passed, ${failed.length} failed, ${results.length} total.`);
  if (failed.length > 0) {
    console.log('\nValidation FAILED. Fix the checks above, then run `npm run validate` again.');
    console.log('Note: handler-export checks fail while sibling files under src/ are still');
    console.log('being written — re-run once src/index.js, src/resolver.js, and');
    console.log('src/scheduled.js exist.');
  } else {
    console.log('\nValidation PASSED.');
  }
}

printSummary();
process.exit(results.some((r) => !r.pass) ? 1 : 0);
