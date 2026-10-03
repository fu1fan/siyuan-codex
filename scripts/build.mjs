import {build} from 'esbuild';
import {mkdir,copyFile,readFile,cp,readdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {zipSync} from 'fflate';
await rm('dist',{recursive:true,force:true});
await mkdir('dist',{recursive:true});
await build({entryPoints:['src/index.ts'],bundle:true,platform:'node',format:'cjs',target:'chrome120',external:['siyuan','electron'],outfile:'dist/index.js'});
const documents=['plugin.json','README.md','README.zh-CN.md','CHANGELOG.md','COMPATIBILITY.md','PROMPTS.md','NATIVE-PARITY.md','MULTI-SESSION.md','WORKSPACES.md','LICENSE','NOTICE','icon.png','preview.png','codex.svg'];
for(const f of documents) await copyFile(f,`dist/${f}`);
await cp('docs','dist/docs',{recursive:true});
await mkdir('dist/licenses',{recursive:true});
await copyFile('node_modules/dompurify/LICENSE','dist/licenses/DOMPurify-LICENSE');
await copyFile('node_modules/dompurify/LICENSE-MPL','dist/licenses/DOMPurify-MPL');
await copyFile('node_modules/marked/LICENSE.md','dist/licenses/marked-LICENSE');
const {name,version}=JSON.parse(await readFile('plugin.json','utf8'));
const entries={};
async function collect(directory,prefix=''){
  for(const entry of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
    const file=join(directory,entry.name),key=prefix+entry.name;
    if(entry.isDirectory())await collect(file,key+'/');
    else if(entry.isFile())entries[key]=new Uint8Array(await readFile(file));
  }
}
await collect('dist');
const archive=zipSync(entries,{level:6});
await writeFile(`${name}-${version}.zip`,archive);
await writeFile('package.zip',archive);
console.log(`Built package.zip and ${name}-${version}.zip (${Object.keys(entries).length} files)`);
