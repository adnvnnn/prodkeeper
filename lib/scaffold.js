'use strict';

const fs = require('fs');
const path = require('path');

const REL = ['.github', 'workflows', 'ci.yml'];
const isGitRepo = repo => typeof repo === 'string' && repo && fs.existsSync(path.join(repo, '.git'));
const has = (dir, test) => { try { return fs.readdirSync(dir).some(test); } catch { return false; } };

/** Looks at the repository root (and src/) to tell which CI template fits, and whether the workflow file already exists */
function detect(repo) {
  if (!isGitRepo(repo)) return { error: 'This project has no git repository folder' };
  let kind = 'unknown', scripts = {};
  if (has(repo, f => /\.sln$/i.test(f)) || has(repo, f => /\.csproj$/i.test(f)) || has(path.join(repo, 'src'), f => /\.(sln|csproj)$/i.test(f))) kind = 'dotnet';
  else if (fs.existsSync(path.join(repo, 'package.json'))) {
    kind = 'node';
    try { scripts = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')).scripts || {}; } catch { /* a broken package.json still means a Node project */ }
  }
  return { kind, hasBuild: !!scripts.build, hasTest: !!scripts.test, hasDocker: fs.existsSync(path.join(repo, 'Dockerfile')), exists: fs.existsSync(path.join(repo, ...REL)), file: REL.join('/') };
}

/** Writes .github/workflows/ci.yml; never overwrites a file that is already there */
function write(repo, content) {
  if (!isGitRepo(repo)) return { error: 'This project has no git repository folder' };
  if (typeof content !== 'string' || !content.trim() || content.length > 100000) return { error: 'The workflow file is empty or too large' };
  const file = path.join(repo, ...REL);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content.replace(/\r?\n/g, '\n'), { flag: 'wx' });
    return { ok: true, file: REL.join('/') };
  } catch (e) {
    return { error: e.code === 'EEXIST' ? `${REL.join('/')} already exists; it was not changed` : e.message };
  }
}

/** Writes the feature-flag files: each path is relative to the repository, a .json file, and stays inside it (existing files are replaced) */
function writeFlags(repo, files) {
  if (!isGitRepo(repo)) return { error: 'This project has no git repository folder' };
  if (!Array.isArray(files) || !files.length || files.length > 20) return { error: 'Nothing to write' };
  const root = path.resolve(repo), done = [];
  for (const f of files) {
    const rel = f && typeof f.path === 'string' ? f.path.trim() : '';
    if (!rel || !/\.json$/i.test(rel) || path.isAbsolute(rel) || typeof f.content !== 'string' || f.content.length > 500000) return { error: `Invalid flag file: ${rel || '(empty)'}` };
    const full = path.resolve(root, rel);
    if (!full.startsWith(root + path.sep) || full.split(path.sep).includes('.git')) return { error: `The file must be inside the repository: ${rel}` };
    try {
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, f.content, 'utf8');
      done.push(rel);
    } catch (e) { return { error: e.message }; }
  }
  return { ok: true, files: done };
}

module.exports = { detect, write, writeFlags };
