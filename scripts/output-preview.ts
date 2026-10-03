import {ChatView} from '../src/ui';
const chat:any={status:'渲染测试 · 合成消息',busy:false,settings:{cwd:'/tmp/output-fixture',model:'gpt-6.1-sol',reasoningEffort:'medium'},session:{id:'output-preview',title:'输出模式与富文本',messages:[]},resolvedModel:'gpt-6.1-sol',resolvedEffort:'medium',requests:new Map()};
const view=new ChatView(document.querySelector('#app')!,()=>chat,{send:async()=>false,stop:()=>{chat.busy=false;view.update();},settings:()=>{},newChat:()=>{},select:()=>{},list:()=>[],attach:()=>{},clear:()=>{},context:()=>''});
const final=String.raw`这篇论文的核心是：**把多个 Attention 副本的请求汇聚到共享的专家池，让每个专家一次处理更多 token。**它主要解决 MoE 的 Decode 效率问题。

### 为什么 MoE 计算量少，服务成本却未必低？

假设全局 batch 有 \(B\) 个 token，共 \(E\) 个专家，每个 token 选择 \(K\) 个专家：

\[
\text{每个专家的 token 数}\approx\frac{BK}{E}
\]

**收益来自增加专家权重的复用次数，而不是减少模型本身的计算量。**实际路由不均匀时，还要检查最忙的专家。

### 拆分后，数据怎么走？

`+'```mermaid\nflowchart LR\n A[请求] --> B[Attention 节点]\n B --> C[共享专家池]\n C --> D[合并输出]\n```'+String.raw`

| 参数 | 数值 |
| --- | --- |
| token | 256 |
| 专家 | 64 |
| top-k | 8 |

行内公式 $x_i = \frac{BK}{E}$；金额 $25 与 $30 保留原样。

`+'```python\ndef tokens_per_expert(batch, top_k, experts):\n    return batch * top_k / experts\n```';
function start(){chat.busy=true;chat.status='正在工作…';chat.session.messages=[{id:'u',role:'user',text:'解读这篇文章，并展示公式和数据流。'},{id:'p',role:'assistant',phase:'commentary',text:'我会先读取论文，核对专家路由公式，再整理数据流图。'},{id:'shell',role:'tool',text:'rg token paper.md',status:'inProgress',tool:{type:'commandExecution',title:'运行命令',input:'rg -n "token|expert" paper.md',cwd:'/tmp/paper',output:'12: batch size 256\n24: experts 64'}},{id:'mcp',role:'tool',text:'read paper',status:'completed',tool:{type:'mcpToolCall',title:'思源 / 读取文档',input:'{ "id": "synthetic-paper" }',output:'已读取论文摘要和专家池章节。'}}];view.update();}
function finish(){if(!chat.session.messages.length)start();chat.busy=false;chat.status='已完成 · 合成消息';chat.session.messages[0].elapsedMs=115000;chat.session.messages[2].status='completed';chat.session.messages[2].tool.exitCode=0;chat.session.messages=chat.session.messages.filter((m:any)=>m.id!=='final');chat.session.messages.push({id:'final',role:'assistant',phase:'final_answer',text:final});view.update();}
const controls=document.querySelector('#fixtures')!;for(const [label,action] of [['开始生成',start],['追加过程',()=>{chat.session.messages.push({id:crypto.randomUUID(),role:'assistant',phase:'commentary',text:'已核对路由公式，正在检查专家池的数据流。'});chat.session.messages[2].tool.output+='\n32: top-k 8';view.update();}],['生成结束',finish],['错误图表',()=>{chat.session.messages.at(-1).text+='\n\n```mermaid\nflowchart LR\n A[broken\n```';view.update();}],['窄侧栏',()=>{document.querySelector<HTMLElement>('#app')!.style.width='280px';}],['宽侧栏',()=>{document.querySelector<HTMLElement>('#app')!.style.width='600px';}]] as const){const b=document.createElement('button');b.textContent=label;b.onclick=action;controls.append(b);}
finish();
