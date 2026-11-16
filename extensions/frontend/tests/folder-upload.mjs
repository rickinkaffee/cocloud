import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const out=process.argv[2];
const context=vm.createContext({});
vm.runInContext(readFileSync(out+'/folder-upload-compiled.js','utf8'),context);
const {useFolderUpload,conflictingEntries,readUploadManifest}=context.CocloudFolderUpload;
let previewRequest;
const previewSignal=new AbortController().signal;
await readUploadManifest(async(path,options)=>{previewRequest={path,options};return {};},'项目/id',previewSignal);
assert.equal(previewRequest.path,'/sync/'+encodeURIComponent('项目/id')+'/manifest?purpose=upload');
assert.equal(previewRequest.options.signal,previewSignal);
const manifest={files:[{path:'incoming/nested/a.txt'},{path:'incoming/nested/b.txt'},{path:'root.txt'}],directories:['incoming','incoming/nested']};
assert.deepEqual(Array.from(conflictingEntries(manifest,{name:'incoming'},[{path:'nested/a.txt'},{path:'nested/new.txt'}],'folder')),['incoming/nested/a.txt']);
assert.deepEqual(Array.from(conflictingEntries(manifest,{name:'incoming'},[{path:'nested/new.txt'}],'folder')),[],'same folder alone merges without conflict prompt');
assert.deepEqual(Array.from(conflictingEntries(manifest,{name:'incoming'},[{path:'root.txt'}],'root')),['root.txt']);
function harness(target={id:'project',name:'project'}) {
  let states=[],refs=[],cursor=0,refCursor=0;
  const React={Fragment:'fragment',
    createElement:(type,props,...children)=>({type,props:props??{},children:children.flat(Infinity)}),
    useState:initial=>{const index=cursor++;if(!(index in states))states[index]=initial;return [states[index],value=>states[index]=value];},
    useRef:initial=>refs[refCursor++]??(refs[refCursor-1]={current:initial}),useEffect:()=>{},
  };
  return {render(){cursor=0;refCursor=0;return useFolderUpload(React,target);}};
}
const walk=node=>!node||typeof node!=='object'?[]:[node,...node.children.flatMap(walk)];
const text=node=>typeof node==='string'?node:node&&typeof node==='object'?node.children.map(text).join(''):'';
const folder={name:'incoming'};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
let uploads=[];
const transport=async args=>{uploads.push(args);return {path:'/project'};};
const request=async()=>({exists:false});
let app=harness(),state=app.render();
let tree=state.controls({disabled:false,folder});
assert.ok(text(tree).includes('新建文件夹')&&text(tree).includes('直接传到根目录'));
const radios=walk(tree).filter(node=>node.props.type==='radio');
assert.equal(radios[0].props.checked,true);
radios[1].props.onChange();state=app.render();
assert.equal(state.path(folder),'project');
await state.upload(transport,{files:[{path:'new.txt'}],signal:new AbortController().signal},folder,manifest,request);
assert.equal(uploads.at(-1).destination.placement,'root');
state.selectFolder();state=app.render();
assert.equal(state.path(folder),'project/incoming');
let pending=state.upload(transport,{files:[{path:'nested/a.txt'},{path:'nested/b.txt'}],signal:new AbortController().signal},folder,manifest,request);
await settle();state=app.render();tree=state.controls({disabled:true,folder});
assert.equal(walk(tree).find(node=>node.props.role==='alertdialog').props['aria-label'],'同名文件');
assert.ok(text(tree).includes('incoming/nested/a.txt'));
assert.equal(uploads.length,1,'no files are staged until all conflicts are reviewed');
walk(tree).find(node=>node.type==='button'&&text(node)==='保留').props.onClick();
await settle();state=app.render();tree=state.controls({disabled:true,folder});
assert.ok(text(tree).includes('incoming/nested/b.txt'));
walk(tree).find(node=>node.type==='button'&&text(node)==='覆盖').props.onClick();
await pending;
assert.equal(uploads.at(-1).destination.fileConflicts['incoming/nested/a.txt'],'keep');
assert.equal(uploads.at(-1).destination.fileConflicts['incoming/nested/b.txt'],'overwrite');
// Apply to all uses the checkbox and still sends per-file decisions.
state=app.render();pending=state.upload(transport,{files:[{path:'nested/a.txt'},{path:'nested/b.txt'}],signal:new AbortController().signal},folder,manifest,request);
await settle();state=app.render();tree=state.controls({disabled:true,folder});
walk(tree).find(node=>node.props.type==='checkbox').props.onChange({target:{checked:true}});
state=app.render();tree=state.controls({disabled:true,folder});
walk(tree).find(node=>node.type==='button'&&text(node)==='保留').props.onClick();await pending;
assert.equal(Object.values(uploads.at(-1).destination.fileConflicts).join(','),'keep,keep');
const prior=uploads.length;
const controller=new AbortController();state=app.render();
pending=state.upload(transport,{files:[{path:'nested/a.txt'}],signal:controller.signal},folder,manifest,request);
await settle();controller.abort();assert.equal(await pending,null);assert.equal(uploads.length,prior,'cancel writes no files');
// Skip all existing conflicts: no skipped bytes enter the transport, new files remain.
state=app.render();pending=state.upload(transport,{files:[{path:'nested/a.txt'},{path:'nested/b.txt'},{path:'nested/new.txt'}],signal:new AbortController().signal},folder,manifest,request);
await settle();state=app.render();tree=state.controls({disabled:true,folder});
walk(tree).find(node=>node.props.type==='checkbox').props.onChange({target:{checked:true}});
state=app.render();tree=state.controls({disabled:true,folder});
assert.ok(walk(tree).some(node=>node.type==='button'&&text(node)==='跳过'));
walk(tree).find(node=>node.type==='button'&&text(node)==='跳过').props.onClick();await pending;
assert.equal(uploads.at(-1).files.length,1);assert.equal(uploads.at(-1).files[0].path,'nested/new.txt');
assert.equal(uploads.at(-1).destination.fileConflicts['incoming/nested/a.txt'],'skip');
assert.ok(text(app.render().controls({disabled:true,folder})).includes('本次跳过 2 个同名文件'));
// Ordinary file selection has no placement controls and targets the project root.
state=app.render();state.selectFiles();state=app.render();assert.equal(walk(state.controls({disabled:false,folder})).filter(node=>node.props.type==='radio').length,0);
await state.upload(transport,{files:[{path:'unique.txt'}],signal:new AbortController().signal},folder,manifest,request);
assert.equal(uploads.at(-1).destination.placement,'root');
// A new-project import previews and merges the existing named folder.
app=harness(null);state=app.render();
pending=state.upload(transport,{files:[{path:'root.txt'}],signal:new AbortController().signal},folder,null,async()=>({...manifest,exists:true,version:'snapshot'}));
await settle();state=app.render();tree=state.controls({disabled:true,folder});
walk(tree).find(node=>node.type==='button'&&text(node)==='覆盖').props.onClick();await pending;
assert.equal(uploads.at(-1).destination.baseVersion,'snapshot');
assert.equal(uploads.at(-1).destination.fileConflicts['root.txt'],'overwrite');
console.log('Folder upload choices, placement, skip filtering, apply-all, cancellation and ordinary files passed');
