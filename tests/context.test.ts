import {test} from 'node:test';
import assert from 'node:assert/strict';
import {droppedIDs,resolveReferences,contextPrompt,referenceTitle} from '../src/context';
import {InputHistory} from '../src/composer';
const a='20261001124824-pq6acxs',b='20261001124825-abcdefg';
function transfer(data:Record<string,string>){return{types:Object.keys(data),getData:(t:string)=>data[t]||''};}
test('SiYuan file tree, multi-block, reference and tab payloads resolve without duplicates',()=>{
 assert.deepEqual(droppedIDs(transfer({'application/siyuan-file':`${a},${b}`, 'application/siyuan-documents':JSON.stringify({ids:[a,b]})}),'/test'),[a,b]);
 assert.deepEqual(droppedIDs(transfer({[`application/siyuan-gutternodeparagraph\u200b\u200b${a},${b}\u200b/test`]:'<div>source</div>'}),'/test'),[a,b]);
 assert.deepEqual(droppedIDs(transfer({'application/siyuan-block-ref':JSON.stringify({ids:[a,'bad',a],workspaceDir:'/test'})}),'/test'),[a]);
 assert.deepEqual(droppedIDs(transfer({'application/siyuan-document-tab':JSON.stringify({rootId:a,tabId:'tab',title:'标题'})}),'/test'),[a]);
 assert.deepEqual(droppedIDs(transfer({'text/plain':`[笔记](siyuan://blocks/${a})`}),'/test'),[a]);
 assert.deepEqual(droppedIDs(transfer({'application/siyuan-file':'notebook-not-a-document','application/siyuan-documents':'{invalid'}),'/test'),[]);
 assert.throws(()=>droppedIDs(transfer({'application/siyuan-block-ref':JSON.stringify({ids:[a],workspaceDir:'/other'})}),'/test'),/另一个/);
 assert.throws(()=>droppedIDs(transfer({[`application/siyuan-gutternodeparagraph\u200b\u200b${a}\u200b/other`]:''}),'/test'),/另一个/);
});
test('note references never fetch bodies, discard old snapshots and retain explicit text/media context',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async()=>{throw Error('Sending references must not fetch note contents');};
 try{
  const media={title:'image',text:'IMAGE_PATH',media:{key:'image',kind:'image' as const,marker:'image',path:'/tmp/image.png'}};
  const conversation={conversationId:'chat',title:'历史对话',text:'EXPLICIT_CHAT_CONTEXT'};
  const result=await resolveReferences([{id:a,title:'doc'},{id:b,title:'block'},{id:a,title:'duplicate'}],[{id:a,title:'saved doc',text:'OLD_DOC_BODY'.repeat(12000)},conversation,media]);
  assert.equal(result.length,4);assert.equal(result[0].title,'saved doc');assert.equal(result[3].id,b);
  const prompt=contextPrompt(result);assert.match(prompt,/<note_reference/);assert.match(prompt,new RegExp(`siyuan://blocks/${a}`));assert.match(prompt,new RegExp(b));
  assert.doesNotMatch(JSON.stringify(result),/OLD_DOC_BODY/);assert.doesNotMatch(prompt,/OLD_DOC_BODY/);
  assert.equal(result[1],conversation);assert.equal(result[2],media);assert.match(prompt,/EXPLICIT_CHAT_CONTEXT/);assert.match(prompt,/IMAGE_PATH/);
  await assert.rejects(resolveReferences([],[{title:'large',text:'x'.repeat(120001)}]),/120,000/);
  await assert.rejects(resolveReferences([],Array.from({length:21},()=>({title:'item',text:'x'}))),/20/);
  await assert.rejects(resolveReferences([{id:'bad',title:'invalid'}],[]),/无效/);
  assert.equal((await resolveReferences([{id:a,title:''}],[]))[0].title,a);
 }finally{globalThis.fetch=original;}
});
test('reference title lookup preserves missing-note errors without exporting content',async()=>{
 const original=globalThis.fetch;const calls:string[]=[];
 globalThis.fetch=async path=>{calls.push(String(path));return new Response(JSON.stringify({code:0,data:[{content:'文档标题'}]}));};
 try{
  assert.deepEqual(await referenceTitle(a),{id:a,title:'文档标题'});assert.deepEqual(calls,['/api/query/sql']);
  globalThis.fetch=async()=>new Response(JSON.stringify({code:0,data:[]}));await assert.rejects(referenceTitle(a),/已不存在/);
  globalThis.fetch=async()=>new Response(JSON.stringify({code:-1,msg:'笔记不可用'}));await assert.rejects(referenceTitle(a),/笔记不可用/);
 }finally{globalThis.fetch=original;}
});
test('composer history preserves draft boundaries and deduplicates adjacent sends',()=>{
 const history=new InputHistory();history.push('one');history.push('two');history.push('two');
 assert.equal(history.up('unfinished'),undefined);assert.equal(history.up(''),'two');assert.equal(history.up('two'),'one');assert.equal(history.down(),'two');assert.equal(history.down(),'');assert.equal(history.down(),undefined);
});
