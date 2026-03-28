// ==========================================
// patterns.js
// Universal pattern management system
// ==========================================
// Commands:
//   node patterns.js              → sync + compile (default)
//   node patterns.js sync         → sync JS↔YAML only
//   node patterns.js prune        → prune patterns only in one file
//   node patterns.js compile      → compile only
//   node patterns.js undo 1       → restore 1 step back
//   node patterns.js undo 2       → restore 2 steps back
//   node patterns.js undo 3       → restore 3 steps back
//   node patterns.js status       → show what changed since last compile
// ==========================================

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// * --- Config ---
const PATTERNS_DIR = path.join(__dirname, 'patterns');
const BACKUPS_DIR = path.join(__dirname, 'patterns.backups');
const COMPILED_FILE = path.join(__dirname, 'patterns.compiled.yaml');
const SUPPORTED_LANGS = ['js', 'ts', 'python', 'go'];
const MAX_BACKUPS = 3;

// * --- Logging ---
const log = (msg) => console.log(msg);
const warn = (msg) => console.warn(`⚠️  ${msg}`);
const success = (msg) => console.log(`✅ ${msg}`);
const error = (msg) => console.error(`❌ ${msg}`);
const info = (msg) => console.log(`ℹ️  ${msg}`);

// ==========================================
// BACKUP SYSTEM
// ==========================================

function createBackup() {
  log('\n📦 Creating backup...');

  if (!fs.existsSync(BACKUPS_DIR)) {
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  }

  // Shift backups down: B2→B3, B1→B2
  for (let i = MAX_BACKUPS; i >= 1; i--) {
    const backupPath = path.join(BACKUPS_DIR, `backup-${i}`);
    const prevPath = path.join(BACKUPS_DIR, `backup-${i - 1}`);

    // Delete oldest backup if it exists
    if (i === MAX_BACKUPS && fs.existsSync(backupPath)) {
      fs.rmSync(backupPath, { recursive: true });
      log(`   Deleted old backup-${MAX_BACKUPS}`);
    }

    // Shift backup down
    if (i > 1 && fs.existsSync(prevPath)) {
      fs.renameSync(prevPath, backupPath);
      log(`   backup-${i - 1} → backup-${i}`);
    }
  }

  // Copy current patterns to backup-1
  const backup1 = path.join(BACKUPS_DIR, 'backup-1');
  copyDir(PATTERNS_DIR, backup1);

  // Also backup compiled file if it exists
  if (fs.existsSync(COMPILED_FILE)) {
    fs.copyFileSync(
      COMPILED_FILE,
      path.join(backup1, 'patterns.compiled.yaml')
    );
  }

  success('Backup created → patterns.backups/backup-1');
}

function restoreBackup(steps) {
  const backupPath = path.join(BACKUPS_DIR, `backup-${steps}`);

  if (!fs.existsSync(backupPath)) {
    error(`No backup found at step ${steps}`);
    log(`   Available backups:`);
    for (let i = 1; i <= MAX_BACKUPS; i++) {
      const p = path.join(BACKUPS_DIR, `backup-${i}`);
      if (fs.existsSync(p)) {
        const stat = fs.statSync(p);
        log(`   backup-${i} — ${stat.mtime.toISOString()}`);
      }
    }
    process.exit(1);
  }

  log(`\n🔄 Restoring from backup-${steps}...`);

  // Clear current patterns dir
  if (fs.existsSync(PATTERNS_DIR)) {
    fs.rmSync(PATTERNS_DIR, { recursive: true });
  }

  // Copy backup to patterns dir
  copyDir(backupPath, PATTERNS_DIR);

  // Restore compiled file if backed up
  const backedUpCompiled = path.join(backupPath, 'patterns.compiled.yaml');
  if (fs.existsSync(backedUpCompiled)) {
    fs.copyFileSync(backedUpCompiled, COMPILED_FILE);
  }

  success(`Restored from backup-${steps}`);
}

function copyDir(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  const entries = fs.readdirSync(src);
  for (const entry of entries) {
    const srcPath = path.join(src, entry);
    const destPath = path.join(dest, entry);
    const stat = fs.statSync(srcPath);
    if (stat.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// ==========================================
// FILE READERS
// ==========================================

function readYamlPatterns(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8');
  if (!content.trim()) return [];
  try {
    const parsed = yaml.load(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    warn(`Failed to parse ${filePath}: ${e.message}`);
    return [];
  }
}

function readJsPatterns(filePath) {
  if (!fs.existsSync(filePath)) return [];
  try {
    // Clear require cache so we always get fresh content
    delete require.cache[require.resolve(filePath)];
    const mod = require(filePath);
    return Array.isArray(mod) ? mod : mod.patterns || [];
  } catch (e) {
    warn(`Failed to parse ${filePath}: ${e.message}`);
    return [];
  }
}

function writeYamlPatterns(filePath, patterns, header) {
  const content = [
    header,
    '',
    yaml.dump(patterns, { lineWidth: 120, quotingType: '"' })
  ].join('\n');
  fs.writeFileSync(filePath, content, 'utf8');
}

function writeJsPatterns(filePath, patterns, header) {
  const content = [
    header,
    '',
    'module.exports = ' + JSON.stringify(patterns, null, 2) + ';'
  ].join('\n');
  fs.writeFileSync(filePath, content, 'utf8');
}

// ==========================================
// SCAN
// ==========================================

function scanPatternPairs() {
  const pairs = [];

  for (const lang of SUPPORTED_LANGS) {
    const langDir = path.join(PATTERNS_DIR, lang);
    if (!fs.existsSync(langDir)) continue;

    const entries = fs.readdirSync(langDir);
    const yamlFiles = entries.filter(e => e.endsWith('.yaml') || e.endsWith('.yml'));
    const jsFiles = entries.filter(e => e.endsWith('.js') || e.endsWith('.ts'));

    // Get all base names (e.g. react.logic, core.data)
    const baseNames = new Set([
      ...yamlFiles.map(f => f.replace(/\.(yaml|yml)$/, '')),
      ...jsFiles.map(f => f.replace(/\.(js|ts)$/, ''))
    ]);

    for (const baseName of baseNames) {
      const parts = baseName.split('.');
      const framework = ['core'].includes(parts[0]) ? null : parts[0];
      const patternType = parts[1] || 'data';

      pairs.push({
        lang,
        framework,
        patternType,
        baseName,
        yamlPath: path.join(langDir, `${baseName}.yaml`),
        jsPath: path.join(langDir, `${baseName}.js`),
      });
    }
  }

  return pairs;
}

// ==========================================
// SYNC
// ==========================================

function syncPair(pair) {
  const { yamlPath, jsPath, lang, framework, baseName } = pair;

  const yamlPatterns = readYamlPatterns(yamlPath);
  const jsPatterns = readJsPatterns(jsPath);

  const yamlById = new Map(yamlPatterns.map(p => [p.id, p]));
  const jsById = new Map(jsPatterns.map(p => [p.id, p]));

  let yamlChanged = false;
  let jsChanged = false;

  // Add patterns from JS that are missing in YAML
  for (const [id, pattern] of jsById) {
    if (!yamlById.has(id)) {
      yamlPatterns.push(pattern);
      yamlById.set(id, pattern);
      yamlChanged = true;
      info(`   [${baseName}] Added "${id}" to YAML`);
    }
  }

  // Add patterns from YAML that are missing in JS
  for (const [id, pattern] of yamlById) {
    if (!jsById.has(id)) {
      jsPatterns.push(pattern);
      jsById.set(id, pattern);
      jsChanged = true;
      info(`   [${baseName}] Added "${id}" to JS`);
    }
  }

  // Write back if changed
  const yamlHeader = buildYamlHeader(lang, framework, baseName);
  const jsHeader = buildJsHeader(lang, framework, baseName);

  if (yamlChanged) {
    writeYamlPatterns(yamlPath, yamlPatterns, yamlHeader);
  }
  if (jsChanged && fs.existsSync(jsPath)) {
    writeJsPatterns(jsPath, jsPatterns, jsHeader);
  }

  return { yamlChanged, jsChanged };
}

function syncAll() {
  log('\n🔄 Syncing JS ↔ YAML...');
  const pairs = scanPatternPairs();
  let totalChanges = 0;

  for (const pair of pairs) {
    const { yamlChanged, jsChanged } = syncPair(pair);
    if (yamlChanged || jsChanged) totalChanges++;
  }

  if (totalChanges === 0) {
    success('All files already in sync');
  } else {
    success(`Synced ${totalChanges} file pairs`);
  }
}

// ==========================================
// PRUNE
// ==========================================

function pruneAll() {
  log('\n✂️  Pruning patterns only in one file...');
  const pairs = scanPatternPairs();
  let totalPruned = 0;

  for (const pair of pairs) {
    const { yamlPath, jsPath, baseName } = pair;

    const yamlPatterns = readYamlPatterns(yamlPath);
    const jsPatterns = readJsPatterns(jsPath);

    if (yamlPatterns.length === 0 || jsPatterns.length === 0) continue;

    const yamlIds = new Set(yamlPatterns.map(p => p.id));
    const jsIds = new Set(jsPatterns.map(p => p.id));

    // Find patterns only in one file
    const onlyInYaml = yamlPatterns.filter(p => !jsIds.has(p.id));
    const onlyInJs = jsPatterns.filter(p => !yamlIds.has(p.id));

    if (onlyInYaml.length > 0 || onlyInJs.length > 0) {
      // Remove from YAML what's not in JS
      const prunedYaml = yamlPatterns.filter(p => jsIds.has(p.id));
      // Remove from JS what's not in YAML
      const prunedJs = jsPatterns.filter(p => yamlIds.has(p.id));

      const yamlHeader = buildYamlHeader(pair.lang, pair.framework, pair.baseName);
      const jsHeader = buildJsHeader(pair.lang, pair.framework, pair.baseName);

      writeYamlPatterns(yamlPath, prunedYaml, yamlHeader);
      if (fs.existsSync(jsPath)) {
        writeJsPatterns(jsPath, prunedJs, jsHeader);
      }

      onlyInYaml.forEach(p => {
        warn(`   [${baseName}] Pruned "${p.id}" — only existed in YAML`);
        totalPruned++;
      });
      onlyInJs.forEach(p => {
        warn(`   [${baseName}] Pruned "${p.id}" — only existed in JS`);
        totalPruned++;
      });
    }
  }

  if (totalPruned === 0) {
    success('Nothing to prune — all files consistent');
  } else {
    success(`Pruned ${totalPruned} orphaned patterns`);
  }
}

// ==========================================
// COMPILE
// ==========================================

function compileAll() {
  log('\n⚙️  Compiling patterns...');
  // Just call compile-patterns.js logic inline
  const compileScript = path.join(__dirname, 'compile-patterns.js');
  require(compileScript);
}

// ==========================================
// STATUS
// ==========================================

function showStatus() {
  log('\n📊 Pattern Status');
  log('==========================================');

  const pairs = scanPatternPairs();

  for (const pair of pairs) {
    const { yamlPath, jsPath, baseName } = pair;
    const yamlPatterns = readYamlPatterns(yamlPath);
    const jsPatterns = readJsPatterns(jsPath);

    const yamlIds = new Set(yamlPatterns.map(p => p.id));
    const jsIds = new Set(jsPatterns.map(p => p.id));

    const onlyInYaml = yamlPatterns.filter(p => !jsIds.has(p.id));
    const onlyInJs = jsPatterns.filter(p => !yamlIds.has(p.id));
    const inBoth = yamlPatterns.filter(p => jsIds.has(p.id));

    log(`\n${baseName}:`);
    log(`   In both:     ${inBoth.length} patterns`);

    if (onlyInYaml.length > 0) {
      warn(`   Only in YAML: ${onlyInYaml.map(p => p.id).join(', ')}`);
    }
    if (onlyInJs.length > 0) {
      warn(`   Only in JS:   ${onlyInJs.map(p => p.id).join(', ')}`);
    }
    if (onlyInYaml.length === 0 && onlyInJs.length === 0) {
      success(`   Fully in sync`);
    }
  }

  // Check if compiled file is stale
  log('\n==========================================');
  if (!fs.existsSync(COMPILED_FILE)) {
    warn('patterns.compiled.yaml does not exist — run: node patterns.js compile');
  } else {
    const compiledStat = fs.statSync(COMPILED_FILE);
    log(`   Last compiled: ${compiledStat.mtime.toISOString()}`);
  }
}

// ==========================================
// HEADERS
// ==========================================

function buildYamlHeader(lang, framework, baseName) {
  return [
    '# ==========================================',
    `# ${lang}/${baseName}.yaml`,
    `# ${framework ? framework + ' specific' : 'Core'} patterns for ${lang.toUpperCase()}`,
    '# Write patterns here OR in the .js version',
    '# Both files are synced by: node patterns.js sync',
    '# DO NOT EDIT patterns.compiled.yaml directly',
    '# Run: node patterns.js to sync + compile',
    '# ==========================================',
  ].join('\n');
}

function buildJsHeader(lang, framework, baseName) {
  return [
    '// ==========================================',
    `// ${lang}/${baseName}.js`,
    `// ${framework ? framework + ' specific' : 'Core'} patterns for ${lang.toUpperCase()}`,
    '// Write patterns here OR in the .yaml version',
    '// Both files are synced by: node patterns.js sync',
    '// DO NOT EDIT patterns.compiled.yaml directly',
    '// Run: node patterns.js to sync + compile',
    '// ==========================================',
  ].join('\n');
}

// ==========================================
// MAIN
// ==========================================

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'default';

  log('\n==========================================');
  log('patterns.js — Pattern Management System');
  log('==========================================');

  switch (command) {
    case 'sync':
      createBackup();
      syncAll();
      break;

    case 'prune':
      createBackup();
      pruneAll();
      break;

    case 'compile':
      createBackup();
      compileAll();
      break;

    case 'undo': {
      const steps = parseInt(args[1]) || 1;
      if (steps < 1 || steps > MAX_BACKUPS) {
        error(`Invalid undo steps. Must be between 1 and ${MAX_BACKUPS}`);
        process.exit(1);
      }
      restoreBackup(steps);
      break;
    }

    case 'status':
      showStatus();
      break;

    default:
      // Default: sync + compile
      createBackup();
      syncAll();
      compileAll();
      break;
  }
}

main().catch(err => {
  error(`patterns.js crashed: ${err.message}`);
  console.error(err);
  process.exit(1);
});