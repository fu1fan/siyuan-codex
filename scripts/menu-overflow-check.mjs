// Browser layout check with the installed SiYuan host stylesheet.
import {chromium} from 'playwright';
import {readFile,writeFile} from 'node:fs/promises';
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage({viewport:{width:800,height:700}});
  await page.setContent(`<div class="la-command-menu" style="width:300px;border-radius:12px"><div class="la-command-heading">添加</div><input class="la-command-search b3-text-field" type="search" placeholder="搜索笔记和历史对话"><div class="la-command-list">${['当前激活的笔记文件','按标题引用笔记文件','按标题引用其他对话'].map((label,i)=>`<button class="la-command-item"><span class="la-command-icon"><svg></svg></span><span class="la-command-label">${label}</span><span class="la-command-description">${i?'搜索思源笔记':'添加当前打开的笔记'}</span><span class="la-command-tail">${i?'›':''}</span></button>`).join('')}</div></div>`);
  await page.addStyleTag({content:await readFile('/Applications/SiYuan.app/Contents/Resources/stage/build/desktop/base.6ebf9935cf77dd602cbe.css','utf8')});
  await page.addStyleTag({content:await readFile('src/style.css','utf8')});
  const results=[];
  for(const width of [240,280,300,400,600]) {
    await page.locator('.la-command-menu').evaluate((e,width)=>e.style.width=width+'px',width);
    await page.locator('input').focus();
    results.push(await page.evaluate(()=>{
      const menu=document.querySelector('.la-command-menu'),r=menu.getBoundingClientRect();
      return {width:r.width,client:menu.clientWidth,scroll:menu.scrollWidth,overflow:getComputedStyle(menu).overflowX,children:[...menu.querySelectorAll('input,button,span')].map(e=>({class:e.className,width:e.getBoundingClientRect().width,right:e.getBoundingClientRect().right,box:getComputedStyle(e).boxSizing})),vertical:false};
    }));
  }
  await page.locator('.la-command-menu').evaluate(e=>{e.style.width='280px';e.style.maxHeight='150px';e.querySelector('.la-command-list').innerHTML+=e.querySelector('.la-command-list').innerHTML.repeat(10);});
  results.push(await page.locator('.la-command-menu').evaluate(e=>{e.scrollTop=80;return {vertical:true,client:e.clientWidth,scroll:e.scrollWidth,clientHeight:e.clientHeight,scrollHeight:e.scrollHeight,scrollTop:e.scrollTop};}));
  await page.screenshot({path:'artifacts/menu-overflow-check.png'});
  await writeFile('artifacts/menu-overflow-check.json',JSON.stringify(results,null,2)+'\n');
  console.log(JSON.stringify(results));
} finally {await browser.close();}
