import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {unzipSync,strFromU8} from 'fflate';
const entries=unzipSync(new Uint8Array(await readFile('package.zip')));
const manifest=JSON.parse(strFromU8(entries['plugin.json']));
const pkg=JSON.parse(await readFile('package.json','utf8'));
assert.equal(manifest.name,'siyuan-codex');assert.equal(manifest.version,pkg.version);
assert.equal(manifest.url,'https://github.com/fu1fan/siyuan-codex');assert.equal(pkg.license,'MIT');
for(const file of ['index.js','index.css','README.md',...Object.values(manifest.readme),'LICENSE','NOTICE','docs/images/chat.png','docs/images/welcome.png','licenses/DOMPurify-LICENSE','licenses/DOMPurify-MPL','licenses/marked-LICENSE'])assert.ok(entries[file]?.length,`Missing ${file}`);
for(const file of Object.keys(entries))assert.ok(!/(^|\/)(node_modules|source|\.test-workspace[^/]*|\.git|artifacts|conf|storage)(\/|$)|(^|\/)(auth\.json|settings\.json|sessions\.json|\.env)|\.sy$/.test(file),`Unexpected private/development path: ${file}`);
for(const [file,limit] of [[manifest.icon,64*1024],[manifest.preview,512*1024]]){
 assert.ok(entries[file],`Missing ${file}`);assert.ok(entries[file].length<=limit,`${file} exceeds marketplace size limit`);
 assert.equal(Buffer.from(entries[file].slice(0,8)).toString('hex'),'89504e470d0a1a0a',`${file} must be PNG`);
}
for(const file of ['README.md','README.zh-CN.md']){
 const md=strFromU8(entries[file]);
 for(const match of md.matchAll(/\]\(([^)]+)\)/g)){
  const target=match[1].split('#')[0];if(!target||/^[a-z]+:\/\//i.test(target))continue;
  assert.ok(entries[target],`${file}: missing relative link ${target}`);
 }
}
assert.equal(strFromU8(entries.LICENSE).split(/\r?\n/)[0],'MIT License');
console.log(`Verified ${manifest.name} ${manifest.version}: ${Object.keys(entries).length} package files, links, MIT notices and marketplace images.`);
