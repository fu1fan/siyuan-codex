import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore
import {JSDOM} from 'jsdom';
import {renderMarkdown,enhanceMarkdown} from '../src/render';
function fixture(){const dom=new JSDOM('<div id="body"></div>',{url:'http://localhost/'});Object.assign(globalThis,{window:dom.window,document:dom.window.document});return {dom,body:document.querySelector<HTMLElement>('#body')!};}
test('Codex math delimiters, Chinese strong punctuation, tables and fences retain their meaning',()=>{
 const {dom,body}=fixture();renderMarkdown(body,String.raw`**收益来自增加专家权重的复用次数，而不是减少计算量。**实际路由不同。

行内 \(B K / E\) 和 $x_i$，价格 $25 和 $30。

\[\text{每个专家的 token 数}\approx \frac{BK}{E}\]

$$
E=mc^2
$$

| A | B |
|---|---|
| 1 | 2 |

`+'```text\n\\[literal\\] **literal** $x$\n```\n\n```mermaid\nflowchart LR\n A[输入] --> B[输出]\n```');
 assert.match(body.querySelector('strong')!.textContent!,/减少计算量。/);assert.equal(body.querySelectorAll('.la-math').length,4);assert.equal(body.querySelectorAll('.la-math-display').length,2);assert.equal(body.querySelectorAll('table tbody tr').length,1);assert.match(body.querySelector('pre code')!.textContent!,/literal/);assert.equal(body.querySelector('pre .la-math'),null);assert.equal(body.querySelectorAll('.la-mermaid').length,1);assert.match(body.textContent!,/价格 \$25 和 \$30/);dom.window.close();
});
test('unclosed streamed formulas stay readable; generated HTML cannot run scripts or forge diagrams',()=>{
 const {dom,body}=fixture();renderMarkdown(body,String.raw`\[\frac{a}{b}`+'\n\n<img src=x onerror=alert(1)><script>bad()</script>[bad](javascript:alert(1))<svg onload=alert(1)><image href="https://evil.test"></image></svg>');
 assert.equal(body.querySelector('.la-math'),null);assert.match(body.textContent!,/frac/);assert.equal(body.querySelector('script,img'),null);assert.equal(body.querySelector('a')?.hasAttribute('href'),false);assert.equal(body.querySelector('[onload],[onerror]'),null);dom.window.close();
});
test('math enhancement renders once, defers collapsed history and preserves errors as source',async()=>{
 const {dom,body}=fixture();let renders=0;(window as any).katex={render:(source:string,target:HTMLElement)=>{renders++;if(source==='bad')throw Error('invalid');target.innerHTML='<span class="katex">'+source+'</span>';}};
 renderMarkdown(body,'\\(x\\)');await enhanceMarkdown(body);await enhanceMarkdown(body);assert.equal(renders,1);assert.ok(body.querySelector('.katex'));
 const details=document.createElement('details');body.replaceWith(details);details.append(body);renderMarkdown(body,'\\(y\\)');await enhanceMarkdown(body);assert.equal(renders,1);details.open=true;await enhanceMarkdown(body);assert.equal(renders,2);
 renderMarkdown(body,'\\(bad\\)');await enhanceMarkdown(body);assert.equal(body.querySelector('.la-render-error')!.textContent,'bad');dom.window.close();
});

test('diagram rendering keeps labels, removes external content, assigns unique IDs and preserves invalid source',async()=>{
 const {dom,body}=fixture();let configuration:any;let renders=0;
 (window as any).mermaid={initialize:(config:any)=>{configuration=config;},render:async(id:string,source:string)=>{renders++;if(source.includes('broken'))throw Error('syntax error');return {svg:`<svg id="${id}" viewBox="0 0 300 100"><style>#${id} .node{fill:url(https://evil.test/a);marker-end:url(#marker)} @import 'https://evil.test/b';</style><text>中文标签</text><script>alert(1)</script><foreignObject>bad</foreignObject><image href="https://evil.test/a" /></svg>`};}};
 renderMarkdown(body,'```mermaid\nflowchart LR\n A[中文标签] --> B[输出]\n```\n\n```mermaid\nflowchart LR\n A[中文标签] --> B[输出]\n```');await enhanceMarkdown(body);
 const svgs=body.querySelectorAll('svg');assert.equal(svgs.length,2);assert.notEqual(svgs[0].id,svgs[1].id);assert.equal(renders,1);assert.equal(configuration.htmlLabels,false);assert.equal(configuration.securityLevel,'strict');assert.match(svgs[0].textContent!,/中文标签/);assert.equal(body.querySelector('script,foreignObject,image'),null);assert.doesNotMatch(body.innerHTML,/https:\/\/evil/);assert.match(body.innerHTML,/url\(#marker\)/);
 renderMarkdown(body,'```mermaid\nbroken\n```');await enhanceMarkdown(body);assert.ok(body.querySelector('.la-render-error'));assert.equal(body.querySelector('details')!.open,true);assert.equal(body.querySelector('code')!.textContent,'broken');dom.window.close();
});

test('streamed rich fences wait for closure, numeric dollar math and inline code are distinct',()=>{
 const {dom,body}=fixture();renderMarkdown(body,'```mermaid\nflowchart LR\n A --> B',true);assert.equal(body.querySelector('.la-mermaid'),null);assert.match(body.querySelector('code')!.textContent!,/A --> B/);
 renderMarkdown(body,'```mermaid\nflowchart LR\n A --> B\n```',true);assert.ok(body.querySelector('.la-mermaid'));
 renderMarkdown(body,'$2x$ and `$x$` and \\$5');assert.equal(body.querySelectorAll('.la-math').length,1);assert.equal(body.querySelector('code')!.textContent,'$x$');assert.match(body.textContent!,/\$5/);dom.window.close();
});
