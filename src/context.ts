import {referencePrompt,visibleConversationText,type ConversationMessage} from './prompts';
import {noteAssetManifest,type NoteAssetManifest,type NoteAssetOptions} from './note-assets';
import {sameLocalPath} from './path-identity';
export type Reference = {id:string;title:string};
export type Attachment = {id?:string;conversationId?:string;title:string;text:string;assets?:NoteAssetManifest;media?:{key:string;kind:'image'|'file';marker:string;path?:string;url?:string;size?:number;status?:'loading'|'error';error?:string}};
const ID=/^\d{14}-[a-z0-9]{7}$/;
export const validID=(id:unknown):id is string=>typeof id==='string'&&ID.test(id);
const GUTTER='application/siyuan-gutter';
export function canDrop(types:readonly string[]){return types.some(t=>t.startsWith(GUTTER)||['Files','text/html','application/siyuan-file','application/siyuan-documents','application/siyuan-block-ref','application/siyuan-document-tab','text/uri-list','text/plain'].includes(t));}
// 思源文档树、多选块、块引用和文档页签的 DataTransfer 协议。
export function droppedIDs(data:Pick<DataTransfer,'types'|'getData'>,workspace:string,platform:NodeJS.Platform=typeof process==='object'?process.platform:'linux'):string[]{
  const ids:string[]=[];const add=(values:unknown)=>{if(Array.isArray(values))ids.push(...values.filter(validID));};
  const read=(type:string)=>{try{return JSON.parse(data.getData(type)||'null');}catch{return null;}};
  const refs=read('application/siyuan-block-ref');
  if(refs){if(refs.workspaceDir&&!sameLocalPath(refs.workspaceDir,workspace,platform))throw new Error('不能引用另一个思源工作区的块。');add(refs.ids);}
  const docs=read('application/siyuan-documents');add(docs?.ids);
  add(data.getData('application/siyuan-file').split(','));
  const tab=read('application/siyuan-document-tab');if(validID(tab?.rootId))ids.push(tab.rootId);
  for(const type of data.types){if(type.startsWith(GUTTER)){
    const parts=type.slice(GUTTER.length).split('\u200b');
    if(parts[3]&&!sameLocalPath(parts[3],workspace,platform))throw new Error('不能引用另一个思源工作区的块。');
    add(parts[2]?.split(','));
  }}
  const text=data.getData('text/uri-list')||data.getData('text/plain');
  for(const match of text.matchAll(/siyuan:\/\/blocks\/(\d{14}-[a-z0-9]{7})/g))ids.push(match[1]);
  return [...new Set(ids)];
}
export async function api(path:string,body:unknown,signal?:AbortSignal){
  const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),...(signal?{signal}:{})});
  if(!response.ok)throw new Error(`思源请求失败 (${response.status})`);
  const result=await response.json();if(result.code!==0)throw new Error(result.msg||'读取笔记失败');return result.data;
}
export function referenceAttachment(ref:Reference):Attachment{
  if(!validID(ref.id))throw new Error('无效的笔记引用');
  return {id:ref.id,title:ref.title||ref.id,text:`思源笔记引用：siyuan://blocks/${ref.id}`};
}
export async function referenceTitle(id:string):Promise<Reference>{
  if(!validID(id))throw Error('无效的笔记引用');
  const rows=await api('/api/query/sql',{stmt:`SELECT content FROM blocks WHERE id = '${id}' LIMIT 1`});
  if(!rows?.length)throw Error('笔记或内容块已不存在。');
  return {id,title:rows[0].content||id};
}
export async function searchNoteTitles(query:string):Promise<Reference[]>{
  const value=query.trim().replace(/'/g,"''");
  const rows=await api('/api/query/sql',{stmt:`SELECT id, content FROM blocks WHERE type = 'd'${value?` AND instr(lower(content), lower('${value}')) > 0`:''} ORDER BY updated DESC LIMIT 30`});
  return (Array.isArray(rows)?rows:[]).filter(row=>validID(row.id)).map(row=>({id:row.id,title:row.content||row.id}));
}
export function conversationAttachment(session:{id:string;title:string;messages:ConversationMessage[]}):Attachment{
  const text=visibleConversationText(session.messages);
  if(!text)throw new Error('此对话还没有可引用的消息。');
  return {conversationId:session.id,title:'对话 · '+session.title,text:`历史对话：${session.title}\n`+text};
}
export async function resolveReferences(refs:Reference[],extra:Attachment[],assetOptions?:NoteAssetOptions){
  const unique=[...new Map(refs.map(r=>[r.id,r])).values()];
  if(unique.filter(r=>!extra.some(a=>a.id===r.id)).length+extra.length>20)throw new Error('一次最多附加 20 篇笔记或内容块。');
  const attachments:Attachment[]=[];
  for(const item of extra){if(!item.id||!attachments.some(a=>a.id===item.id))attachments.push(item.id?referenceAttachment({id:item.id,title:item.title}):item);}
  for(const ref of unique){if(!attachments.some(a=>a.id===ref.id))attachments.push(referenceAttachment(ref));}
  if(assetOptions){
    // Request paths only, never exported Markdown, Kramdown, or attachment bodies.
    const notes=attachments.filter(a=>a.id);
    const manifests=await Promise.all(notes.map(a=>noteAssetManifest(a.id!,assetOptions,id=>api('/api/asset/getDocAssets',{id,retainQueryStr:false},AbortSignal.timeout(5000)),20)));
    let remaining=30;
    for(let i=0;i<notes.length;i++){const manifest=manifests[i];manifest.items=manifest.items.slice(0,remaining);if(manifest.status==='available')manifest.truncated=manifest.items.length<manifest.total!;notes[i].assets=manifest;remaining-=manifest.items.length;}
  }
  if(attachments.reduce((n,a)=>n+a.text.length+(a.assets?JSON.stringify(a.assets).length:0),0)>120000)throw new Error('上下文超过 120,000 字符，请移除部分资料。');
  return attachments;
}
export function contextPrompt(attachments:Attachment[]){return referencePrompt(attachments);}
