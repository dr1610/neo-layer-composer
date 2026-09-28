const {test}=require('node:test');
const assert=require('node:assert/strict');
const {repaintAlpha}=require('../javascript/neoReverseInpaint.js');
test('reverse preview complements the native alpha threshold for all 256 values',()=>{
    for(let a=0;a<256;a++){
        assert.equal(repaintAlpha(a,false),a>128?105:0);
        assert.equal(repaintAlpha(a,true),a>128?0:105);
        assert.equal(repaintAlpha(a,false)+repaintAlpha(a,true),105);
    }
});
