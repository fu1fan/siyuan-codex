// @ts-ignore
import {JSDOM} from 'jsdom';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ChatView} from '../src/ui';
import {ChatSession,newSession} from '../src/session';
import {defaults} from '../src/codex';
import {menuTrigger,menuMatches} from '../src/composer-trigger';
import {editorCursor,selectEditorRange} from '../src/composer-cursor';
import {conversationAttachment,searchNoteTitles} from '../src/context';
const catalog=[{model:'gpt-test',displayName:'GPT Test',defaultReasoningEffort:'medium',supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'medium'},{reasoningEffort:'high'},{reasoningEffort:'xhigh'}]}];
const note={id:'20261001124824-pq6acxs',title:'研究笔记'};
function fixture(extra:any={}){
 const dom=new JSDOM('<div id="root"></div>',{url:'https://localhost/'});
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLInputElement:dom.window.HTMLInputElement});
 const root=document.getElementById('root')!;const chat=new ChatSession(newSession('/tmp'),{...defaults,cwd:'/tmp',model:'gpt-test',reasoningEffort:'medium'},()=> '');
 const patches:any[]=[],drops:any[]=[],conversations:string[]=[];let sends=0,attaches=0;
 const view=new ChatView(root,()=>chat,{send:async()=>{sends++;return true;},stop:()=>{},settings:()=>{},newChat:()=>{},select:()=>{},list:()=>[chat.session,{id:'other',title:'研究讨论'}],attach:()=>{attaches++;return [note];},clear:()=>{},context:()=>'',models:async()=>catalog,quickSetting:async patch=>{patches.push(patch);Object.assign(chat.settings,patch);view.update();},searchNotes:async()=>[note],drop:async ids=>{drops.push(ids);return [note];},referenceConversation:async id=>{conversations.push(id);},...extra});
 const input=view.input.element as HTMLTextAreaElement;const menu=()=>document.querySelector<HTMLElement>('.la-command-menu')!;
 const key=(key:string,options:any={})=>{const e=new dom.window.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...options});input.dispatchEvent(e);return e;};
 return {dom,view,chat,input,menu,key,patches,drops,conversations,get sends(){return sends;},get attaches(){return attaches;},dispose(){view.destroy();dom.window.close();}};
}
const tick=()=>new Promise(r=>setTimeout(r,0));
const rows=()=>Array.from(document.querySelectorAll<HTMLButtonElement>('.la-command-item'));
function click(label:string){rows().find(row=>row.querySelector('.la-command-label')?.textContent===label)!.click();}
test('slash is first-character only; mentions use the caret anywhere, with pinyin and initials matching',()=>{
 assert.equal(menuTrigger(' /模型',4),undefined);assert.equal(menuTrigger('正文 /模型',6),undefined);assert.equal(menuTrigger('\n/模型',4),undefined);
 assert.deepEqual(menuTrigger('/tuili',6),{kind:'function',start:0,end:6,query:'tuili'});
 assert.deepEqual(menuTrigger('前文@研究 后文',5),{kind:'add',start:2,end:5,query:'研究'});
 assert.equal(menuTrigger('前文@研究\n另起一行',11),undefined);
 assert.equal(menuMatches('tuǐ lí','推理','tuili'),true);assert.equal(menuMatches('TL','推理','tl'),true);
});
test('function menu filters pinyin, selects real effort and fast options, and never sends Enter',async()=>{
 const f=fixture();try{
 f.view.input.value='/';await tick();assert.deepEqual(rows().map(r=>r.querySelector('.la-command-label')!.textContent),['状态','快速','推理','模型','为模型提供当前活动']);
 f.view.input.value='/tl';assert.equal(rows().length,1);f.key('Enter');assert.equal(f.sends,0);assert.match(f.menu().textContent!,/极高/);
 f.view.input.value='/jigao';assert.equal(rows().length,1);f.key('Enter');await tick();assert.equal(f.patches.at(-1).reasoningEffort,'xhigh');assert.equal(f.view.input.value,'');assert.equal(f.menu().hidden,true);
 f.view.input.value='/kskq';await tick();assert.match(rows()[0].textContent!,/开启快速模式/);f.key('Enter');await tick();assert.equal(f.patches.at(-1).fastMode,true);
 f.view.input.value='/gpttest';await tick();f.key('Enter');await tick();assert.equal(f.patches.at(-1).model,'gpt-test');assert.equal(f.sends,0);
 }finally{f.dispose();}
});
test('Escape, IME composition, Shift+Enter and non-leading slash preserve editor behavior',async()=>{
 const f=fixture();try{
 f.view.input.value='/';await tick();assert.equal(f.key('Enter',{shiftKey:true}).defaultPrevented,false);assert.equal(f.sends,0);
 f.key('Escape');assert.equal(f.menu().hidden,true);document.dispatchEvent(new f.dom.window.Event('selectionchange'));assert.equal(f.menu().hidden,true);
 f.view.input.value='/mx';assert.equal(f.menu().hidden,false);
 f.input.dispatchEvent(new f.dom.window.CompositionEvent('compositionstart',{bubbles:true}));assert.equal(f.menu().hidden,true);f.view.input.value='/模型';assert.equal(f.menu().hidden,true);f.key('Enter',{isComposing:true});assert.equal(f.sends,0);
 f.input.dispatchEvent(new f.dom.window.CompositionEvent('compositionend',{bubbles:true}));assert.equal(f.menu().hidden,false);
 f.view.input.value='文字/模型';assert.equal(f.menu().hidden,true);
 }finally{f.dispose();}
});
test('add menu searches notes and other conversations, removes only the mention, and plus preserves drafts',async()=>{
 const f=fixture();try{
 f.view.input.value='前文@研究 后文';f.input.setSelectionRange(5,5);f.input.dispatchEvent(new f.dom.window.Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,180));
 assert.deepEqual(rows().map(r=>r.querySelector('.la-command-description')!.textContent),['笔记','历史对话']);click('研究笔记');await tick();assert.deepEqual(f.drops,[[note.id]]);assert.equal(f.view.input.value,`前文((${note.id} '${note.title}'))  后文`);assert.deepEqual(f.view.input.references(),[note]);
 f.view.input.value='前文@研究';await new Promise(r=>setTimeout(r,180));click('研究讨论');await tick();assert.deepEqual(f.conversations,['other']);assert.equal(f.view.input.value,'前文');
 f.view.input.value='保留草稿';f.input.setSelectionRange(2,2);f.view.root.querySelector<HTMLButtonElement>('.la-add')!.click();assert.equal(f.menu().hidden,false);assert.match(f.menu().textContent!,/当前激活的笔记文件/);click('当前激活的笔记文件');await tick();assert.equal(f.attaches,1);assert.equal(f.view.input.value,`保留((${note.id} '${note.title}')) 草稿`);
 }finally{f.dispose();}
});
test('late searches cannot overwrite newer results or reopen a closed menu; failed additions preserve tokens',async()=>{
 let resolve!:(notes:any)=>void;let calls=0;
 const f=fixture({searchNotes:async(query:string)=>{calls++;if(query==='旧')return await new Promise(r=>resolve=r);return [{...note,title:'新的笔记'}];},drop:async()=>{throw Error('笔记不可用');}});try{
 f.view.input.value='@旧';await new Promise(r=>setTimeout(r,170));f.view.input.value='@新';await new Promise(r=>setTimeout(r,170));assert.equal(calls,2);resolve([{...note,title:'旧的笔记'}]);await tick();assert.match(f.menu().textContent!,/新的笔记/);assert.doesNotMatch(f.menu().textContent!,/旧的笔记/);
 click('新的笔记');await tick();assert.equal(f.view.input.value,'@新');assert.match(f.menu().querySelector('[role=alert]')!.textContent!,/笔记不可用/);assert.equal(rows()[0].disabled,false);
 f.key('Escape');assert.equal(f.menu().hidden,true);await tick();assert.equal(f.menu().hidden,true);
 }finally{f.dispose();}
});
test('native DOM ranges preserve rich text, paragraph boundaries and references around mentions',()=>{
 const dom=new JSDOM('<div id="editor"><div data-node-id="a"><div contenteditable><strong>前文</strong>@研究 <span data-type="block-ref">现有引用</span></div></div><div data-node-id="b"><div contenteditable>后文</div></div></div>');Object.assign(globalThis,{window:dom.window,document:dom.window.document});
 try{const root=document.getElementById('editor')!;selectEditorRange(root,5,5);assert.deepEqual(editorCursor(root),{text:'前文@研究 现有引用\n后文',offset:5});selectEditorRange(root,2,5).deleteContents();assert.ok(root.querySelector('strong'));assert.equal(root.querySelector('[data-type=block-ref]')?.textContent,'现有引用');assert.match(root.textContent!,/前文 现有引用后文/);}
 finally{dom.window.close();}
});
test('title search escapes SQL literals and conversation references contain user-visible messages as data',async()=>{
 const original=globalThis.fetch;let stmt='';globalThis.fetch=async(_,options)=>{stmt=JSON.parse(options!.body as string).stmt;return new Response(JSON.stringify({code:0,data:[{id:note.id,content:'标题'},{id:'bad',content:'bad'}]}));};
 try{assert.deepEqual(await searchNoteTitles("A'B%_"),[{id:note.id,title:'标题'}]);assert.match(stmt,/type = 'd'/);assert.match(stmt,/A''B%_/);assert.match(stmt,/instr\(/);}finally{globalThis.fetch=original;}
 const attachment=conversationAttachment({id:'other',title:'研究',messages:[{role:'user',text:'prompt+hidden context',displayText:'prompt'},{role:'assistant',phase:'commentary',text:'working'},{role:'tool',text:'tool output'},{role:'assistant',phase:'final_answer',text:'answer'}]});
 assert.equal(attachment.conversationId,'other');assert.match(attachment.text,/用户：prompt\n\n助手：answer/);assert.doesNotMatch(attachment.text,/hidden|working|tool output/);
});

test('status displays thread usage and account limits; models arriving after close stay closed',async()=>{
 let resolve!:(models:any)=>void;const f=fixture({models:()=>new Promise(r=>resolve=r)});try{
 f.chat.session.threadId='thread-status';f.chat.tokenUsage={last:{totalTokens:1200,inputTokens:1000,outputTokens:200},modelContextWindow:20000};f.chat.refreshRateLimits=async()=>{f.chat.rateLimits={codex:{primary:{usedPercent:25,windowDurationMins:300}}};};
 f.view.input.value='/zt';f.key('Enter');await tick();assert.match(f.menu().textContent!,/thread-status/);assert.match(f.menu().textContent!,/1,200/);assert.match(f.menu().textContent!,/75%/);assert.equal(f.sends,0);
 f.key('Escape');resolve(catalog);await tick();assert.equal(f.menu().hidden,true);
 }finally{f.dispose();}
});

test('plus search keeps its input and caret through Chinese composition and async results',async()=>{
 const f=fixture();try{
 f.view.root.querySelector<HTMLButtonElement>('.la-add')!.click();const input=f.menu().querySelector<HTMLInputElement>('input')!;input.focus();
 input.dispatchEvent(new f.dom.window.CompositionEvent('compositionstart',{bubbles:true}));input.value='研究';input.setSelectionRange(2,2);input.dispatchEvent(new f.dom.window.Event('input',{bubbles:true}));
 assert.equal(f.menu().querySelector('input'),input);assert.match(f.menu().textContent!,/当前激活的笔记/);
 input.dispatchEvent(new f.dom.window.CompositionEvent('compositionend',{bubbles:true}));await new Promise(r=>setTimeout(r,180));
 assert.equal(f.menu().querySelector('input'),input);assert.equal(document.activeElement,input);assert.equal(input.selectionStart,2);assert.match(f.menu().textContent!,/研究讨论/);
 input.value='';input.dispatchEvent(new f.dom.window.Event('input',{bubbles:true}));assert.match(f.menu().textContent!,/当前激活的笔记/);assert.doesNotMatch(f.menu().textContent!,/正在搜索/);
 }finally{f.dispose();}
});

test('current activity toggle supports slash aliases, persists selection and preserves user text while busy',async()=>{
 let enabled=false;const changes:boolean[]=[];
 const f=fixture({activeTabContext:()=>enabled,setActiveTabContext:async(value:boolean)=>{changes.push(value);enabled=value;}});try{
 f.chat.busy=true;f.view.input.value='/dqhd 保留正文';f.input.setSelectionRange(5,5);f.input.dispatchEvent(new f.dom.window.Event('input',{bubbles:true}));
 assert.equal(rows().length,1);assert.equal(rows()[0].disabled,false);assert.match(rows()[0].textContent!,/已关闭/);
 f.key('Enter');await tick();assert.deepEqual(changes,[true]);assert.equal(f.sends,0);assert.equal(f.view.input.value,' 保留正文');
 f.view.input.value='/weimoxingtigongdangqianhuodong';assert.equal(rows().length,1);assert.match(rows()[0].textContent!,/已开启/);assert.equal(rows()[0].querySelector('.la-command-tail')!.textContent,'✓');
 f.key('Enter');await tick();assert.deepEqual(changes,[true,false]);assert.equal(f.view.input.value,'');
 }finally{f.dispose();}
});
test('failed activity preference saves retain the command and leave the toggle off',async()=>{
 const f=fixture({activeTabContext:()=>false,setActiveTabContext:async()=>{throw Error('保存失败');}});try{
 f.view.input.value='/wmxtgdqhd';f.key('Enter');await tick();assert.equal(f.view.input.value,'/wmxtgdqhd');assert.match(f.menu().querySelector('[role=alert]')!.textContent!,/保存失败/);assert.match(rows()[0].textContent!,/已关闭/);assert.equal(f.sends,0);
 }finally{f.dispose();}
});
