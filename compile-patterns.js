// ==========================================
// compile-patterns.js
// Reads all pattern files from patterns/
// Merges them into patterns.compiled.yaml
// Run: node compile-patterns.js
// ==========================================

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// * --- Config ---
const PATTERNS_DIR = path.join(__dirname, 'patterns');
const OUTPUT_FILE = path.join(__dirname, 'patterns.compiled.yaml');
const SUPPORTED_LANGS = ['js', 'ts', 'python', 'go'];
const RESERVED_NAMES = ['core', 'custom'];

// * --- Helpers ---

function log(msg) { console.log(msg); }
function warn(msg) { console.log(`[WARN]  ${msg}`); }
function success(msg) { console.log(`[OK]    ${msg}`); }
function error(msg) { console.log(`[ERROR] ${msg}`); }

// * --- Step 1: Scan all pattern files ---
function scanPatternFiles() {
  const files = [];

  // Scan language folders
  for (const lang of SUPPORTED_LANGS) {
    const langDir = path.join(PATTERNS_DIR, lang);
    if (!fs.existsSync(langDir)) continue;

    const entries = fs.readdirSync(langDir);
    for (const entry of entries) {
      const fullPath = path.join(langDir, entry);
      const ext = path.extname(entry);
      if (!['.yaml', '.yml', '.js', '.ts', '.py', '.go'].includes(ext)) continue;
      if (entry.startsWith('.')) continue;

      // Extract framework from filename
      // e.g. react.logic.yaml → framework: react, type: logic
      // e.g. core.data.yaml → framework: null, type: data
      const baseName = path.basename(entry, ext);
      const parts = baseName.split('.');
      const framework = RESERVED_NAMES.includes(parts[0]) ? null : parts[0];
      const patternType = parts[1] || 'data';

      files.push({
        fullPath,
        lang,
        framework,
        patternType,
        ext
      });
    }
  }

  // Scan custom folder
  const customDir = path.join(PATTERNS_DIR, 'custom');
  if (fs.existsSync(customDir)) {
    const entries = fs.readdirSync(customDir);
    for (const entry of entries) {
      if (entry.startsWith('.')) continue;
      const fullPath = path.join(customDir, entry);
      const ext = path.extname(entry);
      if (!['.yaml', '.yml', '.js'].includes(ext)) continue;

      files.push({
        fullPath,
        lang: 'custom',
        framework: null,
        patternType: 'custom',
        ext
      });
    }
  }

  return files;
}

// * --- Step 2: Read patterns from a file ---
function readPatternsFromFile(file) {
  const { fullPath, lang, framework, ext } = file;
  const relativePath = path.relative(__dirname, fullPath);

  try {
    if (ext === '.yaml' || ext === '.yml') {
      const content = fs.readFileSync(fullPath, 'utf8');
      if (!content.trim()) return [];
      const parsed = yaml.load(content);
      if (!parsed || !Array.isArray(parsed)) return [];

      // Inject lang and framework from filename if not present
      return parsed.map(p => ({
        ...p,
        lang: p.lang || lang,
        framework: p.framework || framework || undefined,
        source: relativePath
      }));
    }

    if (ext === '.js') {
      // For JS files, expect module.exports = [...] 
      const mod = require(fullPath);
      const patterns = Array.isArray(mod) ? mod : mod.patterns || [];
      return patterns.map(p => ({
        ...p,
        lang: p.lang || lang,
        framework: p.framework || framework || undefined,
        source: relativePath
      }));
    }

    // For .py, .go, .ts — not yet supported, skip with warning
    warn(`Skipping ${relativePath} — native ${ext} pattern files not yet supported. Use YAML instead.`);
    return [];

  } catch (err) {
    error(`Failed to read ${relativePath}: ${err.message}`);
    return [];
  }
}

// * --- Step 3: Validate a pattern ---
function validatePattern(pattern, source) {
  const issues = [];

  if (!pattern.id) issues.push('missing required field: id');
  if (!pattern.lang) issues.push('missing required field: lang');
  if (!pattern.label) issues.push('missing required field: label');
  if (!pattern.target) issues.push('missing required field: target');
  if (!pattern.target?.kind) issues.push('missing required field: target.kind');

  // Logic patterns must have a target
  if (pattern.match && !pattern.target) {
    issues.push('logic pattern has match block but no target block');
  }

  if (issues.length > 0) {
    issues.forEach(issue => warn(`Pattern "${pattern.id || 'unknown'}" in ${source}: ${issue}`));
    return false;
  }

  return true;
}

// * --- Step 4: Check for duplicates ---
function checkDuplicates(allPatterns) {
  const seen = new Map();
  const duplicates = [];

  for (const pattern of allPatterns) {
    if (seen.has(pattern.id)) {
      duplicates.push({
        id: pattern.id,
        first: seen.get(pattern.id),
        second: pattern.source
      });
      warn(`Duplicate pattern id: "${pattern.id}"`);
      warn(`  Defined in: ${seen.get(pattern.id)} AND ${pattern.source}`);
      warn(`  Using: ${seen.get(pattern.id)} version`);
      warn(`  Remove one to silence this warning`);
    } else {
      seen.set(pattern.id, pattern.source);
    }
  }

  // Remove duplicates — keep first occurrence
  const deduped = [];
  const usedIds = new Set();
  for (const pattern of allPatterns) {
    if (!usedIds.has(pattern.id)) {
      usedIds.add(pattern.id);
      deduped.push(pattern);
    }
  }

  return deduped;
}

// * --- Step 5: Check if compiled file is stale ---
function checkStaleness(files) {
  if (!fs.existsSync(OUTPUT_FILE)) return;

  const compiledStat = fs.statSync(OUTPUT_FILE);
  const compiledTime = compiledStat.mtimeMs;

  for (const file of files) {
    const fileStat = fs.statSync(file.fullPath);
    if (fileStat.mtimeMs > compiledTime) {
      warn(`${path.relative(__dirname, file.fullPath)} was modified after last compile`);
    }
  }
}

// * --- Main ---
async function main() {
  log('\n==========================================');
  log('compile-patterns.js');
  log('==========================================\n');

  // Step 1: Scan files
  log('📁 Scanning pattern files...');
  const files = scanPatternFiles();
  log(`   Found ${files.length} pattern files\n`);

  if (files.length === 0) {
    warn('No pattern files found. Make sure patterns/ folder exists.');
    process.exit(1);
  }

  // Step 2: Read all patterns
  log('📖 Reading patterns...');
  let allPatterns = [];
  for (const file of files) {
    const patterns = readPatternsFromFile(file);
    const relativePath = path.relative(__dirname, file.fullPath);
    log(`   ${relativePath} → ${patterns.length} patterns`);
    allPatterns = allPatterns.concat(patterns);
  }
  log(`   Total: ${allPatterns.length} patterns\n`);

  // Step 3: Validate
  log('🔍 Validating patterns...');
  const validPatterns = allPatterns.filter(p => validatePattern(p, p.source));
  const invalidCount = allPatterns.length - validPatterns.length;
  if (invalidCount > 0) {
    warn(`${invalidCount} invalid patterns skipped`);
  } else {
    log('   All patterns valid\n');
  }

  // Step 4: Check duplicates
  log('🔎 Checking for duplicates...');
  const deduped = checkDuplicates(validPatterns);
  const dupCount = validPatterns.length - deduped.length;
  if (dupCount > 0) {
    warn(`${dupCount} duplicate patterns removed`);
  } else {
    log('   No duplicates found\n');
  }

  // Step 5: Build output
  const sources = [...new Set(deduped.map(p => p.source))];
  const languages = [...new Set(deduped.map(p => p.lang))];

  const output = {
    meta: {
      generated_at: new Date().toISOString(),
      total_patterns: deduped.length,
      languages,
      sources
    },
    patterns: deduped
  };

  // Step 6: Write compiled file
  log('✍️  Writing patterns.compiled.yaml...');
  const yamlOutput = [
    '# ==========================================',
    '# patterns.compiled.yaml',
    '# AUTO-GENERATED — DO NOT EDIT',
    `# Generated: ${output.meta.generated_at}`,
    `# Total patterns: ${output.meta.total_patterns}`,
    `# Languages: ${output.meta.languages.join(', ')}`,
    '# Run: node compile-patterns.js to regenerate',
    '# ==========================================',
    '',
    yaml.dump(output, { lineWidth: 120, quotingType: '"' })
  ].join('\n');

  fs.writeFileSync(OUTPUT_FILE, yamlOutput, 'utf8');

  // Step 7: Check staleness of existing compiled file
  checkStaleness(files);

  log('');
  success(`Done! ${deduped.length} patterns compiled into patterns.compiled.yaml`);
  log(`   Languages: ${languages.join(', ')}`);
  log(`   Sources: ${sources.length} files`);
  log('==========================================\n');
}

main().catch(err => {
  error(`Compiler crashed: ${err.message}`);
  console.error(err);
  process.exit(1);
});