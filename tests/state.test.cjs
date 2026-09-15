// Exercise the production state/transform methods without emulating a browser UI.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../javascript/neoLayerComposer.js'), 'utf8');
const context = {crypto: require('node:crypto'), document: {readyState:'loading', addEventListener(){}}, console};
vm.createContext(context);
vm.runInContext(source.replace('    function mount() {', '    this.ComposerForTest = Composer;\n    function mount() {'), context);
const C = context.ComposerForTest;
function fixture() {
    const c = Object.create(C.prototype);
    c.state = {background:'bg', selected:'one', layers:[{id:'one',asset:'a',name:'one',x:100,y:100,scale:1,rotation:0,flip:false,visible:true,locked:false}]};
    c.assets = new Map([['bg',{image:{width:400,height:300}}], ['a',{image:{width:200,height:200,nlcBounds:{x:50,y:20,width:100,height:160}}}]]);
    c.history = [JSON.parse(JSON.stringify(c.state))]; c.index=0; c.zoom=1;
    c.render=()=>{}; c.draw=()=>{}; c.message=()=>{}; c.eventPoint=e=>e;
    return c;
}
test('locked layers resist edits/deletion; unlocked edits are undoable',()=>{
    const c=fixture(); c.state.layers[0].locked=true; c.modify(l=>l.x=999); c.remove(); assert.equal(c.selected().x,100); assert.equal(c.state.layers.length,1);
    c.state.layers[0].locked=false; c.modify(l=>l.x=150); c.undo(-1); assert.equal(c.selected().x,100); c.undo(1); assert.equal(c.selected().x,150);
});
test('new edit after undo discards redo and keeps current images',()=>{
    const c=fixture(); c.modify(l=>l.x=120); c.modify(l=>l.x=140); c.undo(-1); c.modify(l=>l.x=170); c.undo(1); assert.equal(c.selected().x,170); assert.equal(c.index,2); assert.ok(c.assets.has('a'));
});
test('history is bounded to 50 undo steps',()=>{
    const c=fixture(); for(let i=0;i<70;i++) c.modify(l=>l.x++); assert.equal(c.history.length,51); for(let i=0;i<60;i++)c.undo(-1); assert.equal(c.selected().x,120);
});
test('rotation handles follow the nontransparent image bounds',()=>{
    const c=fixture(); const l=c.selected(); l.rotation=90; const p=c.points(l); assert.ok(Math.abs(p[0].x-180)<1e-8); assert.ok(Math.abs(p[0].y-50)<1e-8); assert.ok(Math.abs(p[4].x-210)<1e-8);
});
test('pointer resize preserves ratio, and cancel restores original state',()=>{
    const c=fixture(), original=JSON.parse(JSON.stringify(c.selected()));
    c.drag={id:'one',original,start:{x:150,y:180},handle:2,changed:false}; c.pointerMove({x:200,y:260}); assert.equal(c.selected().scale,2); c.finishDrag(true); assert.equal(c.selected().scale,1); assert.equal(c.history.length,1);
});
test('pointer rotation snaps to 15 degrees with Shift',()=>{
    const c=fixture(), original=JSON.parse(JSON.stringify(c.selected())); c.drag={id:'one',original,start:{x:100,y:0},handle:4,changed:false}; c.pointerMove({x:200,y:100,shiftKey:true}); assert.equal(c.selected().rotation,90); c.finishDrag(); assert.equal(c.history.length,2);
});
test('foreground render respects visibility, alpha crop, rotation and mirroring',()=>{
    const c=fixture(), calls=[]; const ctx=new Proxy({}, {get:(_,k)=>(...args)=>calls.push([k,...args]),set:()=>true});
    c.selected().flip=true; c.selected().rotation=30; c.paint(ctx);
    assert.ok(calls.some(v=>v[0]==='scale'&&v[1]===-1&&v[2]===1)); const imageCalls=calls.filter(v=>v[0]==='drawImage'); assert.equal(imageCalls.length,2); assert.deepEqual(imageCalls[1].slice(2),[50,20,100,160,-50,-80,100,160]);
    c.selected().visible=false; calls.length=0; c.paint(ctx); assert.equal(calls.filter(v=>v[0]==='drawImage').length,1);
});
test('malformed project cannot overwrite an existing composition',async()=>{
    const c=fixture(), before=JSON.stringify(c.state); await assert.rejects(c.loadProject({size:10,text:async()=>JSON.stringify({format:'wrong',version:1})})); assert.equal(JSON.stringify(c.state),before);
});
test('reset clears both layers and reference; undo restores assets',()=>{
    const c=fixture(); let cleared=false; c.target={querySelector:()=>({click:()=>cleared=true})};
    c.reset(); assert.equal(c.state.background,null); assert.equal(c.state.layers.length,0); assert.ok(cleared);
    c.undo(-1); assert.equal(c.background().width,400); assert.equal(c.selected().asset,'a');
});
test('size synchronization uses native pixels and emits Gradio input events',()=>{
    const c=fixture(), events=[]; const w={dispatchEvent:e=>events.push(['w',e.type])},h={dispatchEvent:e=>events.push(['h',e.type])}; let selected=false;
    context.Event=class {constructor(type){this.type=type;}};
    context.document.querySelector=s=>s.includes('width')?w:s.includes('height')?h:{click:()=>selected=true};
    c.syncGenerationSize(1024,768);assert.equal(w.value,'1024');assert.equal(h.value,'768');assert.deepEqual(events,[['w','input'],['h','input']]);assert.ok(selected);
});
