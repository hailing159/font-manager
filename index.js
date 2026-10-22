(function(){
'use strict';
const EXT='font-manager';
const DB_NAME='font_manager_v1';
const NL=String.fromCharCode(10);
const CR=String.fromCharCode(13);
const FMT={ttf:['truetype','font/ttf'],otf:['opentype','font/otf'],woff:['woff','font/woff'],woff2:['woff2','font/woff2']};
const uid=()=>'font_'+Date.now()+'_'+Math.random().toString(36).slice(2,6);
const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stripQ=s=>String(s==null?'':s).split('"').join('').split("'").join('').trim();
const cssUrl=s=>String(s||'').split('"').join('%22');
const lines=t=>String(t||'').split(CR).join('').split(NL).map(x=>x.trim()).filter(Boolean);
function parts(name){
let n=String(name||'');
if(n.indexOf('data:')===0)return {base:'font',ext:''};
let s=n.split('?')[0].split('#')[0].split('/').pop();
try{s=decodeURIComponent(s);}catch(e){}
const i=s.lastIndexOf('.');
return i>0?{base:s.slice(0,i),ext:s.slice(i+1).toLowerCase()}:{base:s,ext:''};
}
function fmtOf(f){
const e=parts(f.originalName||f.url).ext;
if(FMT[e])return FMT[e][0];
for(const k in FMT){if(FMT[k][1]===f.type)return FMT[k][0];}
return '';
}
function srcLabel(f){return f.source==='css'?'CSS导入':(f.source==='file'?'本地文件':'链接');}
const logs=[];
let fonts=[];
let activeId='';
let root=null;
let statusTimer=null;
let dlgAnchor=null;
let blobUrl='';
let dbp=null;
function log(msg){
logs.push(new Date().toLocaleTimeString()+' '+msg);
while(logs.length>60)logs.shift();
const el=root&&root.querySelector('#fm-log');
if(el)el.textContent=logs.join(NL);
}
function status(text,bad){
const dm=document.querySelector('#fm-modal .fm-dialog-msg');
if(dm){dm.textContent=text;dm.classList.toggle('bad',!!bad);}
const el=root&&root.querySelector('#fm-status');
if(!el)return;
el.textContent=text;
el.classList.toggle('bad',!!bad);
clearTimeout(statusTimer);
statusTimer=setTimeout(()=>{el.textContent='';},6000);
}
function openDb(){
if(dbp)return dbp;
dbp=new Promise((res,rej)=>{
if(!window.indexedDB){rej(new Error('浏览器不支持 IndexedDB'));return;}
const r=indexedDB.open(DB_NAME,1);
r.onupgradeneeded=()=>{
const d=r.result;
if(!d.objectStoreNames.contains('fonts'))d.createObjectStore('fonts',{keyPath:'id'});
if(!d.objectStoreNames.contains('meta'))d.createObjectStore('meta');
};
r.onsuccess=()=>res(r.result);
r.onerror=()=>rej(r.error||new Error('IndexedDB 打开失败'));
r.onblocked=()=>rej(new Error('IndexedDB 被占用'));
});
dbp.catch(()=>{dbp=null;});
return dbp;
}
function dbReq(store,mode,fn){
return openDb().then(d=>new Promise((res,rej)=>{
const t=d.transaction(store,mode);
const r=fn(t.objectStore(store));
t.oncomplete=()=>res(r?r.result:undefined);
t.onerror=()=>rej(t.error||new Error('IndexedDB 读写失败'));
t.onabort=()=>rej(t.error||new Error('IndexedDB 事务中止'));
}));
}
async function loadAll(){
fonts=(await dbReq('fonts','readonly',s=>s.getAll()))||[];
fonts.sort((a,b)=>(a.createdAt||0)-(b.createdAt||0));
const a=await dbReq('meta','readonly',s=>s.get('active'));
activeId=a||'';
if(activeId&&!fonts.some(f=>f.id===activeId))activeId='';
}
function applyActive(){
const old=document.getElementById('fm-style');
if(old)old.remove();
if(blobUrl){URL.revokeObjectURL(blobUrl);blobUrl='';}
const f=fonts.find(x=>x.id===activeId);
if(!f)return;
const fam=stripQ(f.fontFamily||f.name);
let css='';
if(f.source==='css'){
css=f.cssImport+NL;
}else{
let src=f.url;
if(f.source==='file'&&f.blob){blobUrl=URL.createObjectURL(f.blob);src=blobUrl;}
const fm=fmtOf(f);
css='@font-face{font-family:"'+fam+'";src:url("'+cssUrl(src)+'")'+(fm?' format("'+fm+'")':'')+';font-display:swap}'+NL;
}
css+=':root,body{--mainFontFamily:"'+fam+'",sans-serif}'+NL;
css+='body,button,input,select,textarea{font-family:"'+fam+'",sans-serif}';
const s=document.createElement('style');
s.id='fm-style';
s.textContent=css;
document.head.appendChild(s);
log('已应用字体：'+fam);
}
function mk(o){
return {id:uid(),name:o.name,fontFamily:o.fontFamily||o.name,url:o.url||'',cssImport:o.cssImport||'',type:o.type||'',originalName:o.originalName||'',source:o.source,blob:o.blob||null,createdAt:Date.now()};
}
function parseCss(text){
const imports=[];
let i=0;
while(true){
const idx=text.indexOf('@import',i);
if(idx<0)break;
let end=text.indexOf(';',idx);
if(end<0)end=text.length-1;
imports.push(text.slice(idx,end+1).trim());
i=end+1;
}
const hasFace=text.indexOf('@font-face')>=0;
if(!imports.length&&!hasFace)throw new Error('未识别到 @import 或 @font-face');
let fam='';
const k=text.indexOf('font-family');
if(k>=0){
const c=text.indexOf(':',k);
let e=text.indexOf(';',c);
if(e<0)e=text.indexOf('}',c);
if(e<0)e=text.length;
fam=stripQ(text.slice(c+1,e).split('!')[0].split(',')[0]);
}
return {cssImport:hasFace?text.trim():imports.join(NL),family:fam};
}
function parseTextInput(text,nameOpt){
const ls=lines(text);
if(!ls.length)throw new Error('内容为空');
const allUrl=text.indexOf('@import')<0&&ls.every(l=>/^https?:/i.test(l));
if(allUrl){
return ls.map(u=>{
const p=parts(u);
const nm=(ls.length===1&&nameOpt)?nameOpt:p.base;
if(p.ext==='css')return mk({name:nm,fontFamily:nm,cssImport:'@import url("'+cssUrl(u)+'");',originalName:p.base+'.css',type:'text/css',source:'css'});
return mk({name:nm,fontFamily:nm,url:u,type:FMT[p.ext]?FMT[p.ext][1]:'',originalName:p.base+(p.ext?'.'+p.ext:''),source:'url'});
});
}
const r=parseCss(text);
const nm=nameOpt||r.family;
if(!nm)throw new Error('未识别到 font-family，请在字体名称里填写');
return [mk({name:nm,fontFamily:r.family||nm,cssImport:r.cssImport,originalName:nm+'.css',type:'text/css',source:'css'})];
}
function parseJsonText(text){
let data;
const t=text.trim();
try{data=JSON.parse(t);}catch(e){
let t2=t;
while(t2.length&&',; '.indexOf(t2.charAt(t2.length-1))>=0||t2.charAt(t2.length-1)===NL)t2=t2.slice(0,-1);
try{data=JSON.parse('['+t2+']');}catch(e2){throw new Error('JSON 格式无法解析');}
}
const arr=Array.isArray(data)?data:(data&&Array.isArray(data.fonts)?data.fonts:[data]);
const out=[];
arr.forEach(o=>{
if(!o||typeof o!=='object')return;
const url=typeof o.url==='string'&&o.url?o.url:(typeof o.data==='string'?o.data:'');
const css=typeof o.cssImport==='string'?o.cssImport.trim():'';
const nm=String(o.name||o.fontFamily||o.originalName||'').trim();
if(!nm||(!url&&!css))return;
if(css){out.push(mk({name:nm,fontFamily:o.fontFamily||nm,cssImport:css,type:o.type||'text/css',originalName:o.originalName||nm+'.css',source:'css'}));return;}
const p=parts(o.originalName||url);
out.push(mk({name:nm,fontFamily:o.fontFamily||nm,url:url,type:o.type||(FMT[p.ext]?FMT[p.ext][1]:''),originalName:o.originalName||'',source:'url'}));
});
if(!out.length)throw new Error('JSON 里没有可用的字体条目');
return out;
}
const keyOf=f=>f.source==='file'?'file|'+f.name+'|'+(f.blob?f.blob.size:0):f.source+'|'+(f.url||f.cssImport)+'|'+f.fontFamily;
async function addFonts(list){
let added=0;
let updated=0;
for(const n of list){
const ex=fonts.find(x=>keyOf(x)===keyOf(n));
if(ex){n.id=ex.id;n.createdAt=ex.createdAt;}
await dbReq('fonts','readwrite',s=>s.put(n));
if(ex){fonts[fonts.indexOf(ex)]=n;updated++;}else{fonts.push(n);added++;}
}
if(fonts.some(f=>f.id===activeId))applyActive();
render();
log('导入完成：新增 '+added+'，更新 '+updated);
return {added:added,updated:updated};
}
async function importFiles(files){
const list=[];
const bad=[];
for(const f of files){
const p=parts(f.name);
try{
if(p.ext==='json'){parseJsonText(await f.text()).forEach(x=>list.push(x));}
else if(p.ext==='css'||p.ext==='txt'){parseTextInput(await f.text(),'').forEach(x=>list.push(x));}
else if(FMT[p.ext]){list.push(mk({name:p.base,fontFamily:p.base,type:FMT[p.ext][1],originalName:f.name,source:'file',blob:f}));}
else bad.push(f.name+'（不支持的格式）');
}catch(e){bad.push(f.name+'（'+e.message+'）');}
}
try{
if(list.length){
const r=await addFonts(list);
status('新增 '+r.added+' 个，更新 '+r.updated+' 个'+(bad.length?'；失败 '+bad.length+' 个':''),!!bad.length);
}else status('没有可导入的内容',true);
}catch(e){status('导入失败：'+e.message,true);log('导入失败：'+e.message);}
if(bad.length)log('失败：'+bad.join('；'));
}
async function doPaste(m){
const text=m.querySelector('#fm-f-text').value;
const name=m.querySelector('#fm-f-name').value.trim();
const t=text.trim();
if(!t){status('内容不能为空',true);return false;}
let items;
try{
items=(t.charAt(0)==='['||t.charAt(0)==='{')?parseJsonText(t):parseTextInput(t,name);
}catch(e){status(e.message,true);return false;}
const r=await addFonts(items);
status('新增 '+r.added+' 个，更新 '+r.updated+' 个');
}
async function setActive(id){
activeId=id;
await dbReq('meta','readwrite',s=>s.put(id,'active'));
applyActive();
render();
status(id?'已启用':'已取消启用');
}
async function doDelete(id){
await dbReq('fonts','readwrite',s=>s.delete(id));
fonts=fonts.filter(f=>f.id!==id);
if(activeId===id){
activeId='';
await dbReq('meta','readwrite',s=>s.put('','active'));
applyActive();
}
render();
status('已删除');
}
function doExport(){
const out=[];
let skip=0;
fonts.forEach(f=>{
if(f.source==='file'){skip++;return;}
out.push({name:f.name,url:f.url,data:f.url,cssImport:f.cssImport,fontFamily:f.fontFamily,type:f.type,originalName:f.originalName});
});
if(!out.length){status('没有可导出的字体（本地字体不支持导出）',true);return;}
const blob=new Blob([JSON.stringify(out,null,2)],{type:'application/json'});
const a=document.createElement('a');
a.href=URL.createObjectURL(blob);
a.download='fonts-'+new Date().toISOString().slice(0,10)+'.json';
document.body.appendChild(a);
a.click();
setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},1000);
status('已导出 '+out.length+' 个'+(skip?'，跳过本地字体 '+skip+' 个':''));
}
function showDialog(title,html,done,label){
root.querySelectorAll('#fm-modal').forEach(n=>n.remove());
const m=document.createElement('div');
m.id='fm-modal';
m.className='fm-modal-bg';
m.innerHTML='<section class="fm-modal"><header>'+esc(title)+'<button type="button" class="fm-x">×</button></header><div class="fm-modal-content">'+html+'</div><div class="fm-dialog-msg"></div><footer><button type="button" class="fm-btn fm-light fm-cancel">取消</button><button type="button" class="fm-btn fm-primary fm-ok">'+esc(label||'确定')+'</button></footer></section>';
const card=dlgAnchor&&dlgAnchor.closest?dlgAnchor.closest('.fm-card'):null;
const list=root.querySelector('.fm-list');
dlgAnchor=null;
if(card)card.insertAdjacentElement('afterend',m);
else if(list)list.insertAdjacentElement('beforebegin',m);
else root.appendChild(m);
const close=()=>m.remove();
m.querySelector('.fm-x').onclick=close;
m.querySelector('.fm-cancel').onclick=close;
const ok=m.querySelector('.fm-ok');
ok.onclick=()=>{
let r;
try{r=done(m);}catch(e){status('出错：'+e.message,true);return;}
if(r&&typeof r.then==='function'){
ok.disabled=true;
r.then(v=>{if(v!==false)close();else ok.disabled=false;}).catch(e=>{ok.disabled=false;status('出错：'+e.message,true);});
}else if(r!==false)close();
};
try{m.scrollIntoView({block:'nearest'});}catch(e){}
}
function action(a,id,btn){
dlgAnchor=btn||null;
if(a==='paste'){
showDialog('粘贴导入','<label>粘贴 CSS 代码、字体链接（每行一个）或 JSON</label><textarea id="fm-f-text" class="fm-input" rows="6" placeholder="@import url(...) 或 https://....ttf"></textarea><label>字体名称（可选，纯链接或 CSS 识别不到时填写）</label><input id="fm-f-name" class="fm-input" placeholder="字体名称">',doPaste,'导入');
}else if(a==='file'){
const fi=root.querySelector('#fm-file');
if(fi)fi.click();
}else if(a==='export'){
doExport();
}else if(a==='toggle'){
setActive(id===activeId?'':id).catch(e=>status('出错：'+e.message,true));
}else if(a==='del'){
const f=fonts.find(x=>x.id===id);
if(!f)return;
showDialog('删除字体','<div>确定删除「'+esc(f.name)+'」吗？</div>',()=>doDelete(id),'删除');
}
}
function render(){
if(!root)return;
const list=fonts.map(f=>'<article class="fm-card"><div class="fm-info"><b>'+esc(f.name)+(f.id===activeId?' <span class="fm-tag">使用中</span>':'')+'</b><span>'+esc(srcLabel(f))+' | '+esc(f.fontFamily)+'</span></div><div class="fm-actions"><button type="button" data-a="toggle" data-id="'+esc(f.id)+'" class="'+(f.id===activeId?'fm-on':'')+'">'+(f.id===activeId?'取消启用':'启用')+'</button><button type="button" data-a="del" data-id="'+esc(f.id)+'" class="danger">删除</button></div></article>').join('');
root.innerHTML='<div class="fm-wrap"><div class="fm-top"><b>字体管理器</b><span class="fm-count">共 '+fonts.length+' 个</span></div><div class="fm-tools"><button type="button" class="fm-btn fm-primary" data-a="paste">粘贴导入</button><button type="button" class="fm-btn fm-light" data-a="file">导入文件</button><button type="button" class="fm-btn fm-light" data-a="export">导出JSON</button></div><input type="file" id="fm-file" class="fm-hidden" multiple accept=".ttf,.otf,.woff,.woff2,.json,.css,.txt"><div class="fm-list">'+list+(!fonts.length?'<div class="fm-empty">还没有字体</div>':'')+'</div><div id="fm-status"></div><details class="fm-details"><summary>运行日志（出问题时把这里的内容发给我）</summary><pre id="fm-log">'+esc(logs.join(NL))+'</pre></details></div>';
root.querySelectorAll('[data-a]').forEach(b=>{b.onclick=()=>action(b.dataset.a,b.dataset.id,b);});
const fi=root.querySelector('#fm-file');
fi.onchange=()=>{const fs=Array.from(fi.files||[]);fi.value='';if(fs.length)importFiles(fs);};
}
function createPanel(){
const panel=document.createElement('div');
panel.id='font-manager-inline';
panel.innerHTML='<div class="inline-drawer"><div class="inline-drawer-toggle inline-drawer-header"><b>字体管理器</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div><div class="inline-drawer-content"><div id="fm-manager-root"></div></div></div>';
root=panel.querySelector('#fm-manager-root');
render();
return panel;
}
function mount(){
if(document.getElementById('font-manager-inline'))return true;
const target=document.querySelector('#AdvancedFormatting')||document.querySelector('#advanced-formatting-button .drawer-content')||document.querySelector('#extensions_settings2');
if(!target)return false;
target.appendChild(createPanel());
log('面板已挂载到：'+(target.id||target.className));
return true;
}
async function init(){
try{
await loadAll();
applyActive();
}catch(e){log('读取 IndexedDB 失败：'+e.message);}
if(mount())return;
let tries=0;
const t=setInterval(()=>{tries++;if(mount()||tries>120)clearInterval(t);},1000);
}
window.fontManager={getFonts:()=>fonts.slice(),getActive:()=>activeId};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);
else init();
})();