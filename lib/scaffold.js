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
  return { kind, hasBuild: !!scripts.build, hasTest: !!scripts.test, exists: fs.existsSync(path.join(repo, ...REL)), file: REL.join('/') };
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

module.exports = { detect, write };
