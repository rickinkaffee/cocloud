import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const {outputFiles}=await build({entryPoints:[fileURLToPath(new URL('../src/file-download.ts',import.meta.url))],bundle:true,write:false,format:'iife',globalName:'CocloudFileDownload',target:'es2022'});
const compiled=outputFiles[0].text;
let fetches=0,clicks=0,removed=0,appended=0;
const ctx=vm.createContext({URL,navigator:{userAgent:'Browser'},window:{location:{href:'https://example.test/',origin:'https://example.test'}},
 fetch(){fetches++;throw new TypeError('Failed to fetch')},
 document:{body:{appendChild(){appended++}},createElement(){return {style:{},click(){clicks++},remove(){removed++}}}}});
vm.runInContext(compiled,ctx);
const legacy=async()=>{throw new TypeError('Failed to fetch')};
await assert.rejects(legacy,/Failed to fetch/);
await ctx.CocloudFileDownload.saveAttachment('https://example.test/api/assets/scoped-ticket/合集.zip','合集.zip',legacy);
assert.deepEqual({fetches,clicks,removed,appended},{fetches:0,clicks:1,removed:1,appended:1});
await assert.rejects(ctx.CocloudFileDownload.saveAttachment('https://other.test/api/assets/ticket/file','x',legacy),/Failed to fetch/);
ctx.navigator.userAgent='CocloudAndroid/1.0.8';
let native=false;
await ctx.CocloudFileDownload.saveAttachment('https://example.test/api/assets/ticket/file','x',async()=>{native=true});
assert.ok(native,'Android keeps the native DownloadManager bridge');
// Real HTTP transfer, same size as the reported original archive. The page's
// fetch is deliberately broken: a native attachment download must still work.
const size=108781617,chunk=Buffer.alloc(1024*1024,0x5a),hash=createHash('sha256');
for(let at=0;at<size;at+=chunk.length)hash.update(chunk.subarray(0,Math.min(chunk.length,size-at)));
const expected=hash.digest('hex');let gets=0;
const server=createServer((req,res)=>{
 gets++;res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':size,
 'Content-Disposition':"attachment; filename=collection.zip; filename*=UTF-8''%E5%90%88%E9%9B%86.zip"});
 let at=0;function send(){while(at<size){const piece=chunk.subarray(0,Math.min(chunk.length,size-at));at+=piece.length;if(!res.write(piece)){res.once('drain',send);return}}res.end()}send();
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const {chromium}=await import('playwright-core');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
try {
 const page=await browser.newPage({acceptDownloads:true});
 const origin='http://127.0.0.1:'+server.address().port;
 await page.route(origin+'/',r=>r.fulfill({contentType:'text/html',body:'<html><body></body></html>'}));
 await page.goto(origin+'/');await page.addScriptTag({content:compiled});
 await page.evaluate(()=>{window.fetch=async()=>{throw new TypeError('Failed to fetch')}});
 const waiting=page.waitForEvent('download');
 await page.evaluate(()=>CocloudFileDownload.saveAttachment(location.origin+'/api/assets/scoped-ticket/collection.zip','合集.zip',()=>{throw Error('must not buffer')}));
 const download=await waiting;
 assert.equal(await download.failure(),null);
 const actual=readFileSync(await download.path());
 assert.equal(actual.length,size);assert.equal(createHash('sha256').update(actual).digest('hex'),expected);
 assert.equal(download.suggestedFilename(),'合集.zip');assert.equal(gets,1);
 console.log('Direct attachment regression passed: original-size 108781617-byte native HTTP download and SHA-256, broken page fetch bypassed, Unicode filename, no Blob buffering, Android/cross-origin fallbacks preserved.');
}finally{await browser.close();await new Promise(r=>server.close(r))}
