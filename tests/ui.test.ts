import {test} from 'node:test';
import assert from 'node:assert/strict';
// jsdom is test-only; avoids needing Electron to exercise UI requests and sanitation.
// @ts-ignore
import {JSDOM} from 'jsdom';
test('Chinese MCP confirmation sits next to the process, groups both choices and preserves generic form input while messages stream',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'https://localhost/'});Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLInputElement:dom.window.HTMLInputElement});
 const {ChatView}=await import('../src/ui');const {ChatSession,newSession}=await import('../src/session');const {defaults}=await import('../src/codex');const {toolRecord}=await import('../src/tool-record');
 const chat=new ChatSession(newSession('/tmp'),{...defaults,cwd:'/tmp'},()=> '');chat.busy=true;chat.workStartedAt=Date.now();chat.session.messages=[{id:'u',role:'user',text:'检查工作空间',startedAt:chat.workStartedAt},{id:'call',role:'tool',turnId:'turn',status:'inProgress',text:'',tool:toolRecord({type:'mcpToolCall',server:'siyuan-local',tool:'workspace',arguments:{action:'info'}})}];
 chat.requests.set('7',{id:7,method:'mcpServer/elicitation/request',params:{serverName:'siyuan-local',turnId:'turn',mode:'form',message:'Allow the siyuan-local MCP server to run tool "workspace"?',requestedSchema:{type:'object',properties:{}}}});let answered:any;chat.answer=(id,result)=>{answered={id,result};};
 const root=document.getElementById('root')!,view=new ChatView(root,()=>chat,{send:async()=>false,stop:()=>{},settings:()=>{},newChat:()=>{},select:()=>{},list:()=>[],attach:()=>{},clear:()=>{},context:()=>''});
 try{const card=root.querySelector('.la-approval')!;assert.match(card.querySelector('.la-approval-title')!.textContent!,/允许调用工具/);assert.match(card.querySelector('.la-approval-summary')!.textContent!,/思源 MCP.*工作空间/);assert.match(card.textContent!,/路径、版本和有效性/);assert.equal(card.querySelectorAll('.la-approval-actions button').length,2);assert.equal(root.querySelector('.la-messages-scroll>.la-approvals')!.previousElementSibling,root.querySelector('.la-log'));assert.equal(answered,undefined);
  card.querySelector<HTMLButtonElement>('.la-approval-actions button')!.click();assert.deepEqual(answered,{id:'7',result:{action:'accept',content:{}}});answered=undefined;card.querySelectorAll<HTMLButtonElement>('.la-approval-actions button')[1].click();assert.deepEqual(answered,{id:'7',result:{action:'decline',content:null}});
  chat.requests.clear();chat.requests.set('8',{id:8,method:'mcpServer/elicitation/request',params:{serverName:'service',mode:'form',message:'Please enter your name',requestedSchema:{type:'object',properties:{name:{type:'string'}},required:['name']}}});view.update();const input=root.querySelector<HTMLInputElement>('.la-mcp-form input')!;input.value='保留填写内容';input.focus();chat.session.messages.push({id:'progress',role:'assistant',phase:'commentary',text:'等待确认'});view.update();assert.equal(root.querySelector('.la-mcp-form input'),input);assert.equal(input.value,'保留填写内容');assert.equal(document.activeElement,input);
  chat.requests.clear();chat.requests.set('command',{id:'command',method:'item/commandExecution/requestApproval',params:{command:'echo synthetic-check',cwd:'/tmp',networkApprovalContext:{host:'example.test',protocol:'https'}}});chat.requests.set('file',{id:'file',method:'item/fileChange/requestApproval',params:{itemId:'change',grantRoot:'/tmp/write'}});chat.session.messages.push({id:'change',role:'tool',text:'',tool:{type:'fileChange',title:'修改 1 个文件',input:'[{"path":"/tmp/write/a.txt"}]'}});const permissions={fileSystem:{read:['/tmp/read'],write:['/tmp/write']},network:{enabled:true}};chat.requests.set('permission',{id:'permission',method:'item/permissions/requestApproval',params:{permissions,cwd:'/tmp'}});answered=undefined;view.update();
  assert.equal(answered,undefined);assert.match(root.querySelector('[data-request-id=command]')!.textContent!,/允许执行本机命令.*echo synthetic-check.*工作目录.*网络目标.*example.test/s);assert.match(root.querySelector('[data-request-id=file]')!.textContent!,/允许修改文件.*a.txt.*写入范围/s);const permission=root.querySelector('[data-request-id=permission]')!;assert.match(permission.textContent!,/读取路径.*写入路径.*允许网络访问/s);permission.querySelector<HTMLButtonElement>('.la-approval-actions button')!.click();assert.deepEqual(answered,{id:'permission',result:{permissions,scope:'turn'}});permission.querySelectorAll<HTMLButtonElement>('.la-approval-actions button')[1].click();assert.deepEqual(answered,{id:'permission',result:{permissions:{},scope:'turn'}});
 }finally{view.destroy();dom.window.close();}
});
test('UI sanitizes agent HTML and renders approval choices without auto approval',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'https://localhost/'});
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLInputElement:dom.window.HTMLInputElement});
 const {ChatView}=await import('../src/ui');
 const {ChatSession,newSession}=await import('../src/session');const {defaults}=await import('../src/codex');
 const chat=new ChatSession(newSession('/tmp'),{...defaults,cwd:'/tmp'},()=> '');
 chat.session.messages.push({id:'a',role:'assistant',text:'<img src="https://evil.example/track" onerror="alert(1)"><script>alert(1)</script>**安全内容** [bad](javascript:alert%281%29)'});
 let answered:any;chat.answer=(id,result)=>{answered={id,result};};
 chat.requests.set('8',{id:8,method:'item/commandExecution/requestApproval',params:{command:'echo test',cwd:'/tmp',reason:'test'}});
 const root=document.getElementById('root')!;
 const view=new ChatView(root,()=>chat,{send:async()=>{},stop:()=>{},settings:()=>{},newChat:()=>{},select:()=>{},list:()=>[chat.session],attach:()=>{},clear:()=>{},context:()=>''});
 assert.equal(root.querySelector('script,img'),null);assert.equal(root.querySelector('a')?.hasAttribute('href'),false);assert.match(root.textContent!,/安全内容/);assert.equal(answered,undefined);
 [...root.querySelectorAll('button')].find(b=>b.textContent==='拒绝')!.click();assert.deepEqual(answered,{id:'8',result:{decision:'decline'}});
 chat.requests.clear();chat.requests.set('9',{id:9,method:'mcpServer/elicitation/request',params:{mode:'form',message:'Allow read-only system tool?',requestedSchema:{type:'object',properties:{}}}});view.update();
 answered=undefined;assert.equal(root.querySelector('.la-mcp-form')!==null,true);assert.equal(answered,undefined);
 [...root.querySelectorAll('button')].find(b=>b.textContent==='允许本次')!.click();assert.deepEqual(answered,{id:'9',result:{action:'accept',content:{}}});
 chat.requests.clear();chat.requests.set('10',{id:10,method:'mcpServer/elicitation/request',params:{mode:'form',requestedSchema:{type:'object',properties:{name:{type:'string'},count:{type:'integer',minimum:1}},required:['name']}}});view.update();
 const inputs=root.querySelectorAll<HTMLInputElement>('.la-mcp-form input');inputs[0].value='test';inputs[1].value='2';
 [...root.querySelectorAll('button')].find(b=>b.textContent==='提交并继续')!.click();assert.deepEqual(answered,{id:'10',result:{action:'accept',content:{name:'test',count:2}}});
 dom.window.close();
});

test('drop is copy-only and asynchronous; failed sends preserve drafts and context',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'https://localhost/'});
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLInputElement:dom.window.HTMLInputElement});
 const {ChatView}=await import('../src/ui');const {ChatSession,newSession}=await import('../src/session');const {defaults}=await import('../src/codex');
 const chat=new ChatSession(newSession('/tmp'),{...defaults,cwd:'/tmp'},()=> '');
 const root=document.getElementById('root')!;let dropped:string[]=[];let resolveDrop!:()=>void;let sends=0;let removed=-1;
 let attachments=[{id:'20261001124824-pq6acxs',title:'笔记一',text:'test'},{id:'20261001124825-abcdefg',title:'笔记二',text:'two'}];
 const view=new ChatView(root,()=>chat,{send:async()=>{sends++;return false;},stop:()=>{},settings:()=>{},newChat:()=>{},select:()=>{},list:()=>[chat.session],attach:()=>{},clear:()=>{},context:()=>'',attachments:()=>attachments,removeAttachment:i=>{removed=i;attachments.splice(i,1);view.update();},drop:async ids=>{dropped=ids;await new Promise<void>(r=>resolveDrop=r);},workspace:()=>'/test'});
 const data={types:['application/siyuan-file'],getData:(t:string)=>t==='application/siyuan-file'?'20261001124824-pq6acxs':'',dropEffect:'move'};
 const over=new dom.window.Event('dragover',{bubbles:true,cancelable:true});Object.defineProperty(over,'dataTransfer',{value:data});root.dispatchEvent(over);assert.equal(over.defaultPrevented,true);assert.equal(data.dropEffect,'copy');
 const drop=new dom.window.Event('drop',{bubbles:true,cancelable:true});Object.defineProperty(drop,'dataTransfer',{value:data});root.dispatchEvent(drop);assert.equal(drop.defaultPrevented,true);assert.deepEqual(dropped,['20261001124824-pq6acxs']);
 view.input.value='preserve me';const send=root.querySelector<HTMLButtonElement>('[aria-label="发送 · Enter"]')!;assert.equal(send.disabled,true);send.click();assert.equal(sends,0);
 resolveDrop();await new Promise(r=>setTimeout(r,0));send.click();await new Promise(r=>setTimeout(r,0));assert.equal(sends,1);assert.equal(view.input.value,'preserve me');assert.equal(root.querySelectorAll('.la-context-chip').length,2);
 root.querySelector<HTMLButtonElement>('[aria-label="移除 笔记一"]')!.click();assert.equal(removed,0);assert.equal(root.querySelectorAll('.la-context-chip').length,1);
 chat.busy=true;view.update();assert.equal(send.hidden,false);assert.equal(send.disabled,false);assert.equal(send.getAttribute('aria-label'),'加入队列 · Enter');assert.equal(root.querySelector<HTMLButtonElement>('[aria-label="停止生成"]')!.hidden,false);
 view.destroy();dom.window.close();
});

test('Enter clears immediately while send is pending and preserves the next draft on success or failure',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'https://localhost/'});
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLInputElement:dom.window.HTMLInputElement});
 const {ChatView}=await import('../src/ui');const {ChatSession,newSession}=await import('../src/session');const {defaults}=await import('../src/codex');
 const chat=new ChatSession(newSession('/tmp'),{...defaults,cwd:'/tmp'},()=> '');
 let complete!:(accepted:boolean)=>void;let sent='';const root=document.getElementById('root')!;
 const view=new ChatView(root,()=>chat,{send:async text=>{sent=text;return new Promise<boolean>(r=>complete=r);},stop:()=>{},settings:()=>{},newChat:()=>{},select:()=>{},list:()=>[chat.session],attach:()=>{},clear:()=>{},context:()=>''});
 const enter=()=>view.input.element.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
 try{
  view.input.value='第一条';enter();assert.equal(sent,'第一条');assert.equal(view.input.value,'');assert.equal(chat.session.draft,'');assert.equal(root.querySelector('.la-status')!.textContent,'正在发送…');assert.equal(root.querySelector<HTMLButtonElement>('[aria-label="正在发送…"]')!.disabled,true);
  view.input.value='下一条';complete(true);await new Promise(r=>setTimeout(r,0));assert.equal(view.input.value,'下一条');assert.equal(chat.session.draft,'下一条');
  enter();view.input.value='等待时继续写';complete(false);await new Promise(r=>setTimeout(r,0));assert.equal(view.input.value,'下一条\n\n等待时继续写');assert.equal(chat.session.draft,view.input.value);
  enter();complete(false);await new Promise(r=>setTimeout(r,0));assert.equal(view.input.value,'下一条\n\n等待时继续写');
 }finally{view.destroy();dom.window.close();}
});

test('composer menu opening clicks never reach host outside-click dismissal',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'https://localhost/'});
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLInputElement:dom.window.HTMLInputElement});
 const {ChatView}=await import('../src/ui');const {ChatSession,newSession}=await import('../src/session');const {defaults}=await import('../src/codex');
 const chat=new ChatSession(newSession('/tmp'),{...defaults,cwd:'/tmp'},()=> '');let active='';
 const dismiss=()=>{active='';};document.addEventListener('click',dismiss);
 const root=document.getElementById('root')!;
 const view=new ChatView(root,()=>chat,{send:async()=>false,stop:()=>{},settings:()=>{},newChat:()=>{},select:()=>{},list:()=>[],attach:()=>{},clear:()=>{},context:()=>'',model:()=>{active='model';},permission:()=>{active='permission';}});
 root.querySelector<HTMLButtonElement>('.la-model')!.click();assert.equal(active,'model');
 root.querySelector<HTMLButtonElement>('.la-permission')!.click();assert.equal(active,'permission');
 document.body.click();assert.equal(active,'');
 const icons=new Set<string>();for(const mode of ['ask','auto','full'] as const){chat.settings.permissionMode=mode;view.update();const control=root.querySelector('.la-permission')!;icons.add(control.querySelector('svg')!.innerHTML);assert.equal(control.classList.contains('la-permission-full'),mode==='full');}assert.equal(icons.size,3);
 document.removeEventListener('click',dismiss);view.destroy();dom.window.close();
});
test('user hover actions edit the original text and attachments; only assistant replies branch',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'https://localhost/'});
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLInputElement:dom.window.HTMLInputElement});
 const {ChatView}=await import('../src/ui');const {ChatSession,newSession}=await import('../src/session');const {defaults}=await import('../src/codex');
 const chat=new ChatSession(newSession('/tmp'),{...defaults,cwd:'/tmp'},()=> '');
 chat.session.messages=[{id:'u',role:'user',text:'prompt with context',displayText:'original prompt',attachments:[{title:'note',text:'content'}]},{id:'a',role:'assistant',text:'reply',phase:'final_answer'}];
 let edited:any,branched='';const root=document.getElementById('root')!;
 const view=new ChatView(root,()=>chat,{send:async()=>false,stop:()=>{},settings:()=>{},newChat:()=>{},select:()=>{},list:()=>[],attach:()=>{},clear:()=>{},context:()=>'',editMessage:async(id,text)=>{edited={id,text};},branch:async id=>{branched=id;}});
 const labels=(selector:string)=>[...root.querySelectorAll(selector+' .la-message-actions button')].map(b=>b.getAttribute('aria-label'));
 assert.deepEqual(labels('.la-user'),['复制','编辑']);assert.deepEqual(labels('.la-assistant'),['复制','分支']);
 root.querySelector<HTMLButtonElement>('[aria-label="编辑"]')!.click();const editor=root.querySelector<HTMLTextAreaElement>('[aria-label="编辑消息内容"]')!;assert.equal(editor.value,'original prompt');assert.equal(view.input.value,'');assert.match(root.querySelector('.la-editing')!.textContent!,/note/);editor.value='revised';const send=[...root.querySelectorAll<HTMLButtonElement>('.la-message-edit-actions button')].find(b=>b.textContent==='发送')!;send.click();await new Promise(r=>setTimeout(r,0));assert.deepEqual(edited,{id:'u',text:'revised'});chat.busy=true;view.update();assert.equal(root.querySelector('[aria-label="编辑"]'),null);chat.busy=false;view.update();
 root.querySelector<HTMLButtonElement>('[aria-label="分支"]')!.click();assert.equal(branched,'a');view.destroy();dom.window.close();
});

test('work opens while generating, tools preserve expansion, completion collapses once and final remains visible',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'});Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLInputElement:dom.window.HTMLInputElement});
 const {ChatView}=await import('../src/ui');const {ChatSession,newSession}=await import('../src/session');const {defaults}=await import('../src/codex');const chat=new ChatSession(newSession('/tmp'),{...defaults,cwd:'/tmp'},()=> '');
 chat.busy=true;chat.session.messages=[{id:'u',role:'user',text:'q'},{id:'p',role:'assistant',text:'checking',phase:'commentary'},{id:'t',role:'tool',text:'cmd',status:'inProgress',tool:{type:'commandExecution',title:'运行命令',input:'echo hello',output:'hello'}}];
 const root=document.getElementById('root')!;const view=new ChatView(root,()=>chat,{send:async()=>false,stop:()=>{},settings:()=>{},newChat:()=>{},select:()=>{},list:()=>[],attach:()=>{},clear:()=>{},context:()=>''});
 assert.equal(root.querySelector<HTMLDetailsElement>('.la-work')!.open,true);assert.equal(root.querySelector<HTMLDetailsElement>('.la-tool')!.open,false);
 const body=root.querySelector('.la-assistant .la-body');root.querySelector<HTMLDetailsElement>('.la-tool')!.open=true;chat.session.messages[2].tool!.output+=' world';view.update();assert.equal(root.querySelector<HTMLDetailsElement>('.la-tool')!.open,true);assert.equal(root.querySelector('.la-assistant .la-body'),body);
 chat.session.messages.push({id:'a',role:'assistant',phase:'final_answer',text:'**最终结果。**完成'});chat.busy=false;chat.session.messages[0].elapsedMs=90000;view.update();assert.equal(root.querySelector<HTMLDetailsElement>('.la-work')!.open,false);assert.equal(root.querySelector('.la-log>.la-assistant strong')!.textContent,'最终结果。');
 root.querySelector<HTMLDetailsElement>('.la-work')!.open=true;chat.session.messages[3].text+='。';view.update();assert.equal(root.querySelector<HTMLDetailsElement>('.la-work')!.open,true);assert.match(root.textContent!,/hello world/);
 view.destroy();dom.window.close();
});

test('message and queue edits remain scoped while another chat finishes an asynchronous regeneration',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'});Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLInputElement:dom.window.HTMLInputElement});
 const {ChatView}=await import('../src/ui');const {ChatSession,newSession}=await import('../src/session');const {defaults}=await import('../src/codex');
 const a=new ChatSession(newSession('/tmp'),{...defaults,cwd:'/tmp'},()=>''),b=new ChatSession(newSession('/tmp'),{...defaults,cwd:'/tmp'},()=> '');
 for(const chat of [a,b]){chat.session.messages=[{id:'same-user',role:'user',text:chat===a?'A 原消息':'B 原消息'}];chat.session.queue=[{id:'same-queue',text:'queue',displayText:'queue'}];chat.session.queuePaused=true;}
 let active=a,release!:()=>void;const root=document.getElementById('root')!,view=new ChatView(root,()=>active,{send:async()=>false,stop:()=>{},settings:()=>{},newChat:()=>{},select:()=>{},list:()=>[],attach:()=>{},clear:()=>{},context:()=>'',editMessage:async()=>new Promise<void>(r=>release=r)});
 root.querySelector<HTMLButtonElement>('[aria-label="编辑"]')!.click();const editorA=root.querySelector<HTMLTextAreaElement>('[aria-label="编辑消息内容"]')!;editorA.value='A 修改';editorA.dispatchEvent(new dom.window.Event('input'));
 [...root.querySelectorAll<HTMLButtonElement>('.la-message-edit-actions button')].find(b=>b.textContent==='发送')!.click();
 active=b;view.update();root.querySelector<HTMLButtonElement>('[aria-label="编辑"]')!.click();const editorB=root.querySelector<HTMLTextAreaElement>('[aria-label="编辑消息内容"]')!;editorB.value='B 修改';editorB.dispatchEvent(new dom.window.Event('input'));
 release();await new Promise(r=>setTimeout(r,0));assert.equal(root.querySelector<HTMLTextAreaElement>('[aria-label="编辑消息内容"]')!.value,'B 修改');
 [...root.querySelectorAll<HTMLButtonElement>('.la-queue-menu button')].find(b=>b.textContent==='编辑消息')!.click();root.querySelector<HTMLTextAreaElement>('[aria-label="编辑排队消息"]')!.value='B 排队草稿';root.querySelector('[aria-label="编辑排队消息"]')!.dispatchEvent(new dom.window.Event('input'));
 active=a;view.update();assert.equal(root.querySelector('[aria-label="编辑消息内容"]'),null);assert.equal(root.querySelector('[aria-label="编辑排队消息"]'),null);
 active=b;view.update();assert.equal(root.querySelector<HTMLTextAreaElement>('[aria-label="编辑消息内容"]')!.value,'B 修改');assert.equal(root.querySelector<HTMLTextAreaElement>('[aria-label="编辑排队消息"]')!.value,'B 排队草稿');
 view.destroy();dom.window.close();
});

test('elapsed timer ticks without stream events, preserves forms and expansion, switches clocks and freezes at completion',async t=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'});Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLInputElement:dom.window.HTMLInputElement});
 const {ChatView}=await import('../src/ui');const {ChatSession,newSession}=await import('../src/session');const {defaults}=await import('../src/codex');
 t.mock.timers.enable({apis:['Date','setInterval'],now:1700000000000});
 const a=new ChatSession(newSession('/tmp'),{...defaults,cwd:'/tmp'},()=>''),b=new ChatSession(newSession('/tmp'),{...defaults,cwd:'/tmp'},()=> '');
 a.busy=b.busy=true;a.workStartedAt=Date.now()-1584000;b.workStartedAt=Date.now()-7000;
 a.session.messages=[{id:'u',role:'user',text:'A',startedAt:a.workStartedAt},{id:'p',role:'assistant',text:'真实过程输出',phase:'commentary'}];
 a.requests.set('7',{id:7,method:'item/tool/requestUserInput',params:{questions:[{id:'q',question:'审批表单测试'}]}});
 let active=a;const root=document.getElementById('root')!,view=new ChatView(root,()=>active,{send:async()=>false,stop:()=>{},settings:()=>{},newChat:()=>{},select:()=>{},list:()=>[],attach:()=>{},clear:()=>{},context:()=>''});
 try{
  const summary=root.querySelector<HTMLElement>('.la-work>summary')!,work=root.querySelector<HTMLDetailsElement>('.la-work')!,body=root.querySelector('.la-assistant .la-body'),form=root.querySelector<HTMLInputElement>('[aria-label="审批表单测试"]')!;
  assert.equal(summary.textContent,'已处理 26分钟 24秒');form.value='保留回答';form.focus();work.open=false;view.input.value='保留草稿';
  t.mock.timers.tick(2000);assert.equal(summary.textContent,'已处理 26分钟 26秒');assert.equal(root.querySelector('.la-work>summary'),summary);assert.equal(root.querySelector('.la-assistant .la-body'),body);assert.equal(work.open,false);assert.equal(document.activeElement,form);assert.equal(form.value,'保留回答');assert.equal(view.input.value,'保留草稿');
  // Startup before the first streamed message still has a timer and no placeholder prose.
  active=b;view.update();assert.equal(root.querySelector('.la-work>summary')!.textContent,'已处理 9秒');assert.equal(root.querySelector('.la-work-content,.la-work-waiting,.la-empty'),null);t.mock.timers.tick(1000);assert.equal(root.querySelector('.la-work>summary')!.textContent,'已处理 10秒');
  active=a;view.update();assert.equal(root.querySelector('.la-work>summary')!.textContent,'已处理 26分钟 27秒');
  a.busy=false;a.session.messages[0].elapsedMs=Date.now()-a.workStartedAt!;a.session.messages.push({id:'final',role:'assistant',text:'最终结果',phase:'final_answer'});view.update();
  const completed=root.querySelector<HTMLDetailsElement>('.la-work')!;assert.equal(completed.open,false);assert.equal(completed.querySelector('summary')!.textContent,'用时 26分钟 27秒');assert.match(root.querySelector('.la-log>.la-assistant')!.textContent!,/最终结果/);assert.equal((view as any).workTimer,undefined);
  completed.open=true;t.mock.timers.tick(10000);view.update();assert.equal(completed.open,true);assert.equal(completed.querySelector('summary')!.textContent,'用时 26分钟 27秒');
  active=b;view.update();const last=root.querySelector('.la-work>summary')!.textContent;view.destroy();assert.equal((view as any).workTimer,undefined);t.mock.timers.tick(2000);assert.equal(root.querySelector('.la-work>summary')!.textContent,last);
 }finally{view.destroy();t.mock.timers.reset();dom.window.close();}
});
