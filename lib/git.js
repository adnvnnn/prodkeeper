const { execFile } = require('child_process');
const fs = require('fs');

// نام شاخه/تگ نباید با «-» شروع شود تا به‌عنوان گزینهٔ git تفسیر نشود
const NAME_RE = /^(?!-)[A-Za-z0-9._/@+-]+$/;
const okName = n => typeof n === 'string' && NAME_RE.test(n) && !n.includes('..') && n.length < 200;

function git(repo, args, { timeout = 60000 } = {}) {
  return new Promise(resolve => {
    execFile('git', ['-c', 'core.quotepath=false', ...args], {
      cwd: repo, windowsHide: true, maxBuffer: 20 * 1024 * 1024, timeout,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    }, (err, stdout, stderr) => {
      const out = String(stdout || ''), er = String(stderr || '');
      if (err) {
        const msg = err.code === 'ENOENT' ? 'Git روی این سیستم نصب نیست یا در PATH نیست' : (er.trim() || err.message);
        return resolve({ ok: false, out, err: msg });
      }
      resolve({ ok: true, out, err: er });
    });
  });
}

async function defaultBranch(repo) {
  const r = await git(repo, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  if (r.ok && r.out.trim()) return r.out.trim().replace(/^origin\//, '');
  for (const b of ['main', 'master']) {
    if ((await git(repo, ['show-ref', '--verify', '--quiet', `refs/heads/${b}`])).ok) return b;
  }
  return null;
}

async function status(repo) {
  if (!repo || !fs.existsSync(repo)) return { error: 'مسیر مخزن پیدا نشد' };
  const inside = await git(repo, ['rev-parse', '--is-inside-work-tree']);
  if (!inside.ok) return { error: inside.err.includes('نصب نیست') ? inside.err : 'این پوشه یک مخزن git نیست' };
  const st = await git(repo, ['status', '--porcelain=v1', '-b']);
  if (!st.ok) return { error: st.err };
  const lines = st.out.split('\n').filter(Boolean);
  const head = (lines.shift() || '').replace(/^## /, '');
  const m = head.match(/^(.+?)(?:\.\.\.(\S+))?(?: \[(.*)\])?$/) || [];
  const track = m[3] || '';
  const res = {
    branch: (m[1] || '').replace(/^No commits yet on /, '').replace(/^HEAD \(no branch\)$/, 'HEAD (detached)'),
    upstream: m[2] || '',
    ahead: Number((track.match(/ahead (\d+)/) || [])[1] || 0),
    behind: Number((track.match(/behind (\d+)/) || [])[1] || 0),
    gone: /gone/.test(track),
    dirty: lines.length,
    files: lines.slice(0, 30).map(l => ({ xy: l.slice(0, 2), path: l.slice(3) })),
  };
  const last = await git(repo, ['log', '-1', '--format=%h%x1f%s%x1f%an%x1f%ct']);
  if (last.ok && last.out.trim()) {
    const [hash, subject, author, ts] = last.out.trim().split('\x1f');
    res.last = { hash, subject, author, ts: Number(ts) * 1000 };
  }
  const rem = await git(repo, ['remote', 'get-url', 'origin']);
  res.remote = rem.ok ? rem.out.trim() : '';
  res.default = await defaultBranch(repo);
  return res;
}

async function branches(repo) {
  const fmt = ['%(HEAD)', '%(refname)', '%(refname:short)', '%(upstream:short)', '%(upstream:track)', '%(committerdate:unix)', '%(authorname)', '%(subject)'].join('%1f');
  const r = await git(repo, ['for-each-ref', `--format=${fmt}`, 'refs/heads', 'refs/remotes']);
  if (!r.ok) return { error: r.err };
  const def = await defaultBranch(repo);
  let merged = new Set();
  if (def) {
    const mr = await git(repo, ['for-each-ref', `--merged=${def}`, '--format=%(refname)', 'refs/heads', 'refs/remotes']);
    if (mr.ok) merged = new Set(mr.out.split('\n').filter(Boolean));
  }
  const list = [];
  let current = '';
  for (const line of r.out.split('\n').filter(Boolean)) {
    const [head, ref, short, upstream, track, ts, author, subject] = line.split('\x1f');
    if (ref.endsWith('/HEAD')) continue;
    const isRemote = ref.startsWith('refs/remotes/');
    if (head === '*') current = short;
    list.push({
      name: short, isRemote, current: head === '*', upstream, author, subject,
      ahead: Number((track.match(/ahead (\d+)/) || [])[1] || 0),
      behind: Number((track.match(/behind (\d+)/) || [])[1] || 0),
      gone: /gone/.test(track), date: Number(ts) * 1000,
      merged: merged.has(ref) && short !== def && short !== `origin/${def}`,
    });
  }
  // شاخهٔ ریموتی که نسخهٔ محلی ندارد
  const localUp = new Set(list.filter(b => !b.isRemote).map(b => b.upstream));
  const out = list.filter(b => !b.isRemote || (!localUp.has(b.name) && !list.some(l => !l.isRemote && 'origin/' + l.name === b.name)));
  return { current, default: def, branches: out };
}

async function log(repo, branch, n = 20) {
  if (branch && !okName(branch)) return { error: 'نام شاخه معتبر نیست' };
  const args = ['log', '-n', String(n), '--format=%h%x1f%s%x1f%an%x1f%ct%x1f%D'];
  if (branch) args.push(branch, '--');
  const r = await git(repo, args);
  if (!r.ok) return { error: r.err };
  return { commits: r.out.split('\n').filter(Boolean).map(l => { const [hash, subject, author, ts, refs] = l.split('\x1f'); return { hash, subject, author, ts: Number(ts) * 1000, refs }; }) };
}

async function tags(repo) {
  const r = await git(repo, ['for-each-ref', '--sort=-creatordate', '--count=15', '--format=%(refname:short)%1f%(creatordate:unix)%1f%(subject)', 'refs/tags']);
  if (!r.ok) return { error: r.err };
  return { tags: r.out.split('\n').filter(Boolean).map(l => { const [name, ts, subject] = l.split('\x1f'); return { name, ts: Number(ts) * 1000, subject }; }) };
}

const need = (...names) => names.every(okName);

// فقط عملیات فهرست‌شده اجرا می‌شود؛ آرگومان آزاد از رندرر پذیرفته نمی‌شود
async function call(op, repo, p = {}) {
  if (op === 'version') { const r = await git(process.cwd(), ['--version']); return r.ok ? { version: r.out.trim() } : { error: r.err }; }
  if (!repo || !fs.existsSync(repo)) return { error: 'مسیر مخزن پیدا نشد' };
  const act = async (args, timeout) => {
    const r = await git(repo, args, { timeout });
    return r.ok ? { ok: true, output: (r.out + r.err).trim() } : { error: r.err };
  };
  switch (op) {
    case 'status': return status(repo);
    case 'branches': return branches(repo);
    case 'log': return log(repo, p.branch, p.n || 20);
    case 'tags': return tags(repo);
    case 'fetch': return act(['fetch', '--all', '--prune'], 120000);
    case 'pull': return act(['pull', '--ff-only'], 120000);
    case 'push': return need(p.branch) ? act(p.setUpstream ? ['push', '-u', 'origin', p.branch] : ['push'], 120000) : { error: 'نام شاخه معتبر نیست' };
    case 'checkout':
      if (!need(p.name)) return { error: 'نام شاخه معتبر نیست' };
      return act(p.remote ? ['checkout', '--track', p.name] : ['checkout', p.name]);
    case 'createBranch':
      if (!need(p.name) || (p.from && !need(p.from))) return { error: 'نام شاخه معتبر نیست' };
      return act(['checkout', '-b', p.name, ...(p.from ? [p.from] : [])]);
    case 'deleteBranch': return need(p.name) ? act(['branch', p.force ? '-D' : '-d', p.name]) : { error: 'نام شاخه معتبر نیست' };
    case 'deleteRemoteBranch': return need(p.name) ? act(['push', 'origin', '--delete', p.name], 120000) : { error: 'نام شاخه معتبر نیست' };
    case 'merge': return need(p.name) ? act(['merge', '--no-edit', p.name]) : { error: 'نام شاخه معتبر نیست' };
    case 'abortMerge': return act(['merge', '--abort']);
    case 'createTag': return need(p.name) ? act(['tag', '-a', p.name, '-m', String(p.message || p.name).slice(0, 500)]) : { error: 'نام تگ معتبر نیست' };
    case 'pushTag': return need(p.name) ? act(['push', 'origin', p.name], 120000) : { error: 'نام تگ معتبر نیست' };
    default: return { error: 'عملیات ناشناخته' };
  }
}

module.exports = { call, git };
