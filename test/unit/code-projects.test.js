import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {projectTree,gitEntries} from '../../src/renderer/src/features/codeProjects/projectModel.js';
import {visibleProjectPath} from '../../src/server/assets/codeProjectFiles.js';
import {jivaModules,jivaJourneys} from '../../src/renderer/src/features/codeProjects/jivaGuide.js';

test('directory filtering retains ancestors; file paths reject hidden, traversal and sensitive files',()=>{
  const tree=projectTree([{path:'src/a.js'},{path:'src/b.js'},{path:'docs/readme.md'}],'a.js');
  assert.deepEqual([...tree.children.keys()],['src']);assert.deepEqual([...tree.children.get('src').children.keys()],['a.js']);
  for(const name of ['../x.js','src/../../x.js','.env','src/.git/config.js','credentials.json','src/secret.key','src\\a.js'])assert.equal(visibleProjectPath(name),false,name);
  assert.equal(visibleProjectPath('src/worker.js'),true);
});
test('Git library input preserves merge parents and real branch names',()=>{
  const git={branch:'main',refs:[{name:'feature',hash:'b'},{name:'main',hash:'m'}],commits:[{hash:'m',parents:['a','b'],author:'Test',date:'2026-11-02',message:'merge'},{hash:'b',parents:['r'],author:'Test',date:'2026-11-01',message:'feature'},{hash:'a',parents:['r'],author:'Test',date:'2026-11-01',message:'main'},{hash:'r',parents:[],author:'Test',date:'2026-10-31',message:'root'}]};
  const entries=gitEntries(git);assert.deepEqual(entries[0].parents,['a','b']);assert.equal(entries[0].branch,'main');assert.equal(entries[0].author.name,'Test');
});
test('Jiva guide files and source anchors exist in the actual project',async()=>{
  const entries=[...jivaModules.flatMap(m=>m.files),...jivaJourneys.flatMap(j=>j.steps)];
  for(const entry of entries){const text=await readFile(new URL('../../'+entry.file,import.meta.url),'utf8');assert.ok(text.includes(entry.anchor),entry.file+': '+entry.anchor);}
});
