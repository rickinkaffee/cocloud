import { writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { launchSourceBrowser, createProjectionServer, PlaywrightSourceBrowser } from '@floegence/floebrowser';
const browserData=process.env.BROWSER_DATA||'/var/lib/open-workbench-browser';
const welcome = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>共享浏览器已就绪</title><style>body{font:18px system-ui;max-width:650px;padding:24px;margin:auto;line-height:1.7}input,button{font:inherit;padding:12px;max-width:90%}a{display:block;margin:15px 0}</style><h1>Floe 共享浏览器</h1><p>网页在服务器运行，你在手机或电脑上操作实时 DOM 页面。请用顶部地址栏访问网站。</p><a href="https://example.org">打开示例网站</a><a href="https://example.com">打开示例网站</a><h2>输入与点击测试</h2><label for="test-input">输入中文</label><p><input id="test-input" placeholder="点这里，测试手机输入法"></p><button id="test-button" onclick="document.getElementById('result').textContent=document.getElementById('test-input').value||'点击成功'">测试同步</button><p id="result" role="status"></p><p>另一台设备打开时，使用 “Use in this window” 接管。当前版本同一时间由一个窗口操作。</p></html>`;
const local = createServer((req,res)=>{if(req.url!=='/'){res.writeHead(404).end();return;}res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end(welcome);}).listen(8789,'127.0.0.1');
const context = await launchSourceBrowser({profile:browserData+'/profile'});
const page = context.pages()[0] ?? await context.newPage();
const owner = new PlaywrightSourceBrowser({windowViewport:true});
const service = await createProjectionServer(await owner.adopt(page),{port:8787,authorize:()=>true});
if(page.url()==='about:blank') await page.goto('http://127.0.0.1:8789/');
await writeFile(browserData+'/run/endpoint.json',JSON.stringify({url:service.url}),{mode:0o600});
console.log('Floe source ready on loopback; viewer URL stored in private runtime file.');
let stopping=false;
async function stop(){if(stopping)return;stopping=true;await rm(browserData+'/run/endpoint.json',{force:true});await service.close();await owner.dispose();await context.close();local.close();process.exit(0);}
process.once('SIGTERM',stop);process.once('SIGINT',stop);
