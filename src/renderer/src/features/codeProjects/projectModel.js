export function projectTree(files, query = '') {
  const root = { name: '', path: '', children: new Map() };
  for (const file of files.filter(f => f.path.toLowerCase().includes(query.toLowerCase()))) {
    let current = root; const parts = file.path.split('/');
    parts.forEach((part, i) => {
      if (!current.children.has(part)) current.children.set(part, { name: part, path: parts.slice(0,i+1).join('/'), children: new Map(), file: i === parts.length - 1 });
      current = current.children.get(part);
    });
  }
  return root;
}
export function gitEntries(git) {
  const map = new Map(git.commits.map(c => [c.hash,c])), branches = new Map();
  for (const ref of [...git.refs].sort((a,b) => Number(b.name === git.branch)-Number(a.name === git.branch))) {
    const queue = [ref.hash], seen = new Set();
    while (queue.length) { const hash = queue.pop(); if(seen.has(hash)) continue; seen.add(hash); const c=map.get(hash); if(!c) continue; if(!branches.has(hash)) branches.set(hash,ref.name); queue.push(...c.parents); }
  }
  return git.commits.map(c => ({ ...c, parents:c.parents.filter(p=>map.has(p)), branch:branches.get(c.hash) || git.branch || 'HEAD', author:{name:c.author}, committerDate:c.date }));
}
