import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createServer} from 'node:http';
const out=process.argv[2];
const compiled=readFileSync(out+'/file-properties-compiled.js','utf8');
const {chromium}=await import('playwright-core');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const server=createServer((req,res)=>{
 const url=req.url;
 if(url.endsWith('/api/projects')) {res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({projects:[{id:'sample',workspaceRoot:'/projects/中文'}]}));}
 if(url.includes('/properties?')) {res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({name:'<报告>.txt',path:'/projects/中文/<报告>.txt',location:'/projects/中文',kind:'file',size:2048,modifiedAt:'2024-02-03T04:05:06Z',createdAt:null,accessedAt:'2024-02-03T04:05:06Z',mode:'644'}));}
 if(url.includes('/download?')) {res.writeHead(200,{'Content-Disposition':"attachment; filename*=UTF-8''%E6%8A%A5%E5%91%8A.txt",'Content-Type':'application/octet-stream'});return res.end('exact bytes');}
 res.setHeader('Content-Type','text/html');res.end('<button id="origin">File row</button>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try {
 const page=await browser.newPage({acceptDownloads:true});
 await page.goto('http://127.0.0.1:'+server.address().port+'/'); await page.addScriptTag({content:compiled}); await page.addStyleTag({content:readFileSync(new URL('../src/motion.css',import.meta.url),'utf8')});
 await page.locator('#origin').focus();
 await page.evaluate(()=>CocloudFileProperties.act('cocloud-properties','/projects/中文','<报告>.txt',()=>false));
 assert.equal(await page.getByRole('dialog').count(),1);
 const text=await page.getByRole('dialog').innerText();
 for(const expected of ['<报告>.txt 属性','完整路径','/projects/中文/<报告>.txt','2 KB','2,048','2024','644','不可用'])assert.ok(text.includes(expected),expected);
 assert.equal(await page.locator('dialog img, dialog script').count(),0,'filenames remain text');
 await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);
 assert.equal(await page.evaluate(()=>document.activeElement.id),'origin');
 await page.evaluate(()=>CocloudFileProperties.showProperties(async()=>{throw Error('权限不足')}));
 assert.equal(await page.getByRole('alert').innerText(),'权限不足');await page.getByRole('button',{name:'确定',exact:true}).click();
 const downloadEvent=page.waitForEvent('download');
 await page.evaluate(()=>CocloudFileProperties.act('cocloud-download','/projects/中文','报告.txt',()=>false));
 const download=await downloadEvent;assert.equal(download.suggestedFilename(),'报告.txt');
 assert.equal(readFileSync(await download.path(),'utf8'),'exact bytes');
 await page.setViewportSize({width:360,height:740});
 await page.evaluate(()=>CocloudFileProperties.showProperties(async()=>({name:'目录',path:'/projects/目录',location:'/projects',kind:'directory',size:0,files:0,directories:1,skipped:1,modifiedAt:null,accessedAt:null,createdAt:null,mode:'755'})));
 assert.ok((await page.getByRole('dialog').innerText()).includes('0 个文件，1 个文件夹'));
 const box=await page.getByRole('dialog').boundingBox();assert.ok(box.x>=0 && box.x+box.width<=360);
 await page.getByRole('button',{name:'确定',exact:true}).click();
 await page.evaluate(async()=>{try{await CocloudFileProperties.resolveEntry('/outside','file')}catch(e){window.failure=e.message}});
 assert.ok((await page.evaluate(()=>window.failure)).includes('不属于'));
 console.log('File properties: Chromium modal, metadata, text safety, Escape/focus, errors, exact-byte Unicode download and mobile sizing passed');
} finally {await browser.close();await new Promise(resolve=>server.close(resolve))}
