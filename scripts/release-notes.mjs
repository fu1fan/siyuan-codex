import {readFile,writeFile} from 'node:fs/promises';

const {version}=JSON.parse(await readFile('plugin.json','utf8'));
const changelog=(await readFile('CHANGELOG.md','utf8')).replace(/\r\n/g,'\n');
const sections=changelog.split(/^## /m).slice(1);
const section=sections.find(section=>section.split('\n',1)[0].trim()===version);
if(!section)throw Error(`Missing changelog section for ${version}`);
const notes=section.slice(section.indexOf('\n')+1).trim();
if(!notes)throw Error(`Empty changelog section for ${version}`);
await writeFile('release-notes.md',notes+'\n');
console.log(`Prepared release notes for ${version}`);
