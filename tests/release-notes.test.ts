import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

test('release notes include only the exact version section and reject absent or empty notes',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'siyuan-release-notes-'));
 try{
  await writeFile(join(directory,'plugin.json'),JSON.stringify({version:'0.5.0'}));
  for(const newline of ['\n','\r\n']){
   await writeFile(join(directory,'CHANGELOG.md'),['# Changelog','','## 0.5.1','','- Future','','## 0.5.0','','- Current change','','### Details','','More details.','','## 0.4.8','','- Historical change'].join(newline));
   const result=spawnSync(process.execPath,[resolve('scripts/release-notes.mjs')],{cwd:directory,encoding:'utf8'});
   assert.equal(result.status,0,result.stderr);
   assert.equal(await readFile(join(directory,'release-notes.md'),'utf8'),'- Current change\n\n### Details\n\nMore details.\n');
  }
  for(const content of ['## 0.5.00\n\n- Wrong version','## 0.5.0\n\n## 0.4.8\n\n- Old']){
   await writeFile(join(directory,'CHANGELOG.md'),content);
   assert.notEqual(spawnSync(process.execPath,[resolve('scripts/release-notes.mjs')],{cwd:directory}).status,0);
  }
 }finally{await rm(directory,{recursive:true,force:true});}
});
