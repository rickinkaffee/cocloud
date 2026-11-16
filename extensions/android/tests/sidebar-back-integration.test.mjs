import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const activity=readFileSync(root+'src/cn/cocloud/workbench/MainActivity.java','utf8');
// The old release had an empty callback and a single left exclusion rectangle.
// Guard the actual Activity wiring too, not just the standalone protocol class.
const progress=activity.match(/void onBackProgressed\(BackEvent event\)\s*\{([\s\S]*?)\n                \}/)?.[1];
assert.ok(progress?.includes('event.getProgress()') && progress.includes('postOnAnimation(backProgressFrame)'), 'Actual Activity must forward and frame-coalesce predictive progress');
assert.ok(activity.includes('dispatchSidebarProgress(sidebarBack.progress(latestBackProgress), null)'), 'Frame callback must send progress to WebView');
assert.ok(activity.includes('dispatchSidebarProgress(sidebarBack.cancel(), null)'), 'Cancellation must reach WebView');
assert.ok(activity.includes('String finish = sidebarBack.finish()'), 'Release must complete the captured gesture');
assert.ok(activity.includes('Math.max(0, width - edge)'), 'Both system edges need exclusion rectangles');
const [java,classes]=process.argv.slice(2);
const fixtures=spawnSync(java,['-cp',classes,'cn.cocloud.workbench.SidebarBackGestureTest','--script-fixtures'],{encoding:'utf8'});
assert.equal(fixtures.status,0,fixtures.stderr);
const events=[];const window={dispatchEvent(e){events.push(e);return false;}};
class CustomEvent {constructor(type,options){this.type=type;Object.assign(this,options);}}
for(const script of fixtures.stdout.trim().split('\n'))assert.equal(Function('window','CustomEvent','return '+script)(window,CustomEvent),true);
assert.deepEqual(events.map(e=>e.detail.action),['start','progress','finish','start','progress','cancel']);
assert.equal(events[1].detail.progress,.45);assert.equal(events[4].detail.progress,.6);
assert.deepEqual(events.map(e=>e.detail.id),[1,1,1,2,2,2]);
assert.ok(events.every(e=>e.type==='cocloud-native-sidebar'&&e.cancelable));
console.log('Actual Activity back callbacks and Java-generated JavaScript protocol verified.');
