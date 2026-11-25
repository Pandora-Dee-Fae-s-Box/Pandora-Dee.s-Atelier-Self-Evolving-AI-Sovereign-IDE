const cats = [
  {name:'Orange tabby',file:'orange-tabby-cat.png'},
  {name:'Grey tabby',file:'grey-tabby-cat.png'},
  {name:'Brown tabby',file:'brown-tabby-cat.png'},
  {name:'Calico',file:'calico-cat.png'},
  {name:'Tortoiseshell',file:'tortoiseshell-cat.png'},
  {name:'Black cat',file:'black-cat.png'},
  {name:'Tuxedo',file:'Tuxedo-cat.png'},
  {name:'Grey and white cat',file:'grey-and-white-cat.png',sortColor:'grey'},
  {name:'Brown and white cat',file:'brown-and-white-cat.png',sortColor:'brown'},
  {name:'Orange and white cat',file:'orange-and-white-cat.png',sortColor:'orange'},
  {name:'Grey cat',file:'grey-cat.png'},
  {name:'Russian blue',file:'russian-blue.png',sortColor:'grey'},
  {name:'Siamese',file:'siamese-catcream-fur-brown-fur-on-ears-t.png'},
  {name:'White cat',file:'white-cat.png'},
  {name:'White cat · black patches',file:'white-cat-with-black-patches.png'},
  {name:'White cat · orange patches',file:'white-cat-with-orange-patches.png'},
  {name:'White cat · grey patches',file:'white-cat-with-grey-patches.png'},
  {name:'White cat · brown patches',file:'white-cat-with-brown-patches.png'},
  {name:'Albino',file:'albino-cat.png'},
  {name:'White Unicat',file:'White Unicat.png'},
  {name:'Unicat',file:'Unicat.png'},
  {name:'Rainbow cat',file:'rainbow-cat.png',sortColor:'other'},
  {name:'Pastel rainbow cat',file:'pastel-rainbow-cat.png',sortColor:'other'},
  {name:'Neon lights cat',file:'Neon-lights-cat.png',sortColor:'other'},
  {name:'White cat · pink heart',file:'white-cat-pink-heart.png'},
  {name:'White cat · hot pink heart',file:'white-cat-hot-pink-heart.png'},
  {name:'Heart cat',file:'Heart-cat.png'},
  {name:'Sphynx cat',file:'sphynx-cat.png'},
  {name:'Grey sphynx cat',file:'Grey-sphynx-cat.png'},
  {name:'Tiger',file:'tiger.png',sortColor:'orange'},
  {name:'Lion',file:'lion.png',sortColor:'yellow'},
  {name:'Neon pink cat',file:'neon-pink-cat.png',sortColor:'pink'},
  {name:'Neon green cat',file:'neon-green-cat.png',sortColor:'green'}
];
const foods = ['🍗','🥩','🥓','🐟'];
const $ = id => document.getElementById(id);
const stage = $('playground'), catImg = $('mainCat'), catWrap = $('catWrap');
const modal = $('catModal'), catGrid = $('catGrid'), tray = $('foodTray'), foodOptions = $('foodOptions');
const hand = $('petHand'), heart = document.querySelector('.love-heart'), headEffects = $('headEffects');
const CUSTOM_KEY='cat-club-custom-cats-v1', SELECTED_KEY='cat-club-selected-cat-v1', SORT_KEY='cat-club-cat-order-v1';
let customCats=[];
try{customCats=JSON.parse(localStorage.getItem(CUSTOM_KEY)||'[]');if(!Array.isArray(customCats))customCats=[];}catch{}
const COLOR_ORDER=['red','orange','yellow','green','blue','purple','pink','brown','black','grey','white','other'];
let sortSettings={mode:'Default',order:[],colorOrder:[...COLOR_ORDER],colorOverrides:{}};
try{const saved=JSON.parse(localStorage.getItem(SORT_KEY)||'null');if(saved&&['Default','A-Z','Z-A','Color-based','Custom'].includes(saved.mode))sortSettings={mode:saved.mode,order:Array.isArray(saved.order)?saved.order:[],colorOrder:Array.isArray(saved.colorOrder)&&saved.colorOrder.length===COLOR_ORDER.length?saved.colorOrder:[...COLOR_ORDER],colorOverrides:saved.colorOverrides&&typeof saved.colorOverrides==='object'?saved.colorOverrides:{}};}catch{}
const catKey=cat=>cat.id||cat.file;
function storeSortSettings(){try{localStorage.setItem(SORT_KEY,JSON.stringify(sortSettings));}catch{}}
function colorFromRGB(r,g,b){const max=Math.max(r,g,b),min=Math.min(r,g,b),delta=max-min;if(delta<5)return max<62?'black':max<188?'grey':'white';let hue=0;if(max===r)hue=60*(((g-b)/delta)%6);else if(max===g)hue=60*((b-r)/delta+2);else hue=60*((r-g)/delta+4);if(hue<0)hue+=360;if(hue<14||hue>=348){const lightness=(max+min)/510;return lightness>=.745?'pink':'red';}if(max<62)return'black';if(delta<13)return max<188?'grey':'white';if(hue<43)return(max<142&&r>g)?'brown':'orange';if(hue<70)return'yellow';if(hue<165)return'green';if(hue<255)return'blue';if(hue<286)return'purple';return'pink';}
function colorAtBaseShade(rgb,shade){const level=Math.max(0,Math.min(1,shade));if(level<.5)return rgb.map(channel=>Math.round(channel*level*2));const mix=(level-.5)*2;return rgb.map(channel=>Math.round(channel+(255-channel)*mix));}
function isPeachColor(r,g,b){const max=Math.max(r,g,b),min=Math.min(r,g,b),delta=max-min;if(!delta||r<=g||g<=b||r<170||g<110||b<65)return false;let hue=60*(((g-b)/delta)%6);if(hue<0)hue+=360;const saturation=delta/max;return hue>=10&&hue<=43&&saturation>=.1&&saturation<=.68;}
function catColorGroup(cat,ignoreOverride=false){
  const override=sortSettings.colorOverrides?.[catKey(cat)];if(!ignoreOverride&&override&&override!=='auto'&&COLOR_ORDER.includes(override))return override;
  if(cat.sortColor&&cat.sortColor!=='auto')return COLOR_ORDER.includes(cat.sortColor)?cat.sortColor:'other';
  if(cat.autoColor&&COLOR_ORDER.includes(cat.autoColor))return cat.autoColor;
  if(cat.color&&cat.id){const m=cat.color.match(/[0-9a-f]{2}/gi);if(m)return colorFromRGB(...m.map(v=>parseInt(v,16)));}
  const label=(cat.name+' '+cat.file).toLowerCase();
  if(/tortoiseshell|tortie|calico/.test(label))return'orange';
  if(/grey|gray/.test(label))return'grey';if(/sphynx/.test(label))return'pink';if(/white|albino/.test(label))return'white';if(/red/.test(label))return'red';if(/orange|ginger/.test(label))return'orange';if(/yellow/.test(label))return'yellow';if(/green/.test(label))return'green';if(/blue/.test(label))return'blue';if(/purple/.test(label))return'purple';if(/pink|heart/.test(label))return'pink';if(/brown|siamese|cream/.test(label))return'brown';if(/black|tuxedo/.test(label))return'black';return'other';
}
function colorSortGroup(cat){const group=catColorGroup(cat),order=sortSettings.colorOrder||COLOR_ORDER;return[order.indexOf(group)<0?order.length:order.indexOf(group),group];
}
const allCats=()=>{
  const items=[...cats,...customCats];
  if(sortSettings.mode==='A-Z')items.sort((a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:'base'}));
  else if(sortSettings.mode==='Z-A')items.sort((a,b)=>b.name.localeCompare(a.name,undefined,{sensitivity:'base'}));
  else if(sortSettings.mode==='Color-based')items.sort((a,b)=>{const x=colorSortGroup(a),y=colorSortGroup(b);return x[0]-y[0]||a.name.localeCompare(b.name,undefined,{sensitivity:'base'});});
  else if(sortSettings.mode==='Custom'){const positions=new Map(sortSettings.order.map((key,index)=>[key,index]));items.sort((a,b)=>(positions.get(catKey(a))??Infinity)-(positions.get(catKey(b))??Infinity));}
  return items;
};
let sortingEnabled=false, swapSelection=null;
let savedSelection='';try{savedSelection=localStorage.getItem(SELECTED_KEY)||'';}catch{}
let selectedCat=allCats().find(cat=>(cat.id||cat.file)===savedSelection)||cats[0], mode=null, selectedFood=foods[0], customFoods=[];
let cleanEmoji='🧽';let petTimer=null, toastTimer=null, dragFood=null, dragging=false, dragCandidate=null, dragPointer=null, suppressFoodClick=false, petting=false, petPointer=null, cleaning=false, cleanPointer=null, cleanTimer=null, cleanX=0, cleanY=0;
const tintCache=new Map(), compositionCache=new Map(), imageCache=new Map();
const drawModal=$('drawModal'), drawCanvas=$('drawCanvas'), drawCtx=drawCanvas.getContext('2d');
let draftStrokes=[], redoStrokes=[], activeStroke=null, drawTool='draw', pickingColor=false, pickingTargetColor=false, pickingAvoidColor=false, editorRenderToken=0, previewRenderToken=0, editorBaseImage=null, editorBaseTint=null, renderQueued=false;
let aiDraftImage=null, aiSourceImage=null, aiGeneratedImage=null, aiGenerationToken=0;
function loadImage(src){if(imageCache.has(src))return imageCache.get(src);const promise=new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('Could not load image'));image.src=src;});imageCache.set(src,promise);return promise;}
async function rawBaseImage(cat){
  if(cat.aiImage)return loadImage(cat.aiImage);
  if(cat.baseDefinition)return loadImage(await composedImage(cat.baseDefinition));
  if(cat.baseCatId){const parent=customCats.find(item=>item.id===cat.baseCatId);if(parent)return loadImage(await composedImage(parent));}
  return loadImage(cat.file);
}
function tintedImage(cat){
  if(cat.aiImage)return Promise.resolve(cat.aiImage);
  if(!cat.id)return Promise.resolve(cat.file);
  if(tintCache.has(cat.id))return tintCache.get(cat.id);
  const result=(async()=>{const image=await rawBaseImage(cat);const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const ctx=canvas.getContext('2d');ctx.filter=cat.grayscale&&!cat.solidColor?'grayscale(1)':'none';ctx.drawImage(image,0,0);ctx.filter='none';if(cat.solidColor){const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);const data=pixels.data;const rgb=cat.color.match(/[0-9a-f]{2}/gi).map(value=>parseInt(value,16));for(let i=0;i<data.length;i+=4){const shade=(0.2126*data[i]+0.7152*data[i+1]+0.0722*data[i+2])/255,shaded=cat.matchBaseShades?colorAtBaseShade(rgb,shade):rgb.map(channel=>Math.round(channel*shade)),highlight=cat.lightenHighlights?Math.max(0,Math.min(1,(shade-.55)/.45)):0;for(let c=0;c<3;c++)data[i+c]=Math.round(shaded[c]+(255-shaded[c])*highlight);}ctx.putImageData(pixels,0,0);}else{ctx.globalCompositeOperation='source-atop';ctx.fillStyle=cat.color;ctx.globalAlpha=Math.max(0,Math.min(1,Number(cat.opacity)/100));ctx.fillRect(0,0,canvas.width,canvas.height);}return canvas.toDataURL('image/png');})();
  tintCache.set(cat.id,result);return result;
}
function imageRect(width,height,image){const scale=Math.min(width/image.naturalWidth,height/image.naturalHeight);const w=image.naturalWidth*scale,h=image.naturalHeight*scale;return{x:(width-w)/2,y:(height-h)/2,width:w,height:h,scale};}
function renderStrokeOverlay(strokes,raw,width,height,rect,baseTint){
  const base=document.createElement('canvas');base.width=width;base.height=height;const baseCtx=base.getContext('2d',{willReadFrequently:true});baseCtx.drawImage(baseTint,rect.x,rect.y,rect.width,rect.height);
  const overlay=document.createElement('canvas');overlay.width=width;overlay.height=height;const out=overlay.getContext('2d');
  const rawCanvas=document.createElement('canvas');rawCanvas.width=width;rawCanvas.height=height;const rawCtx=rawCanvas.getContext('2d',{willReadFrequently:true});rawCtx.drawImage(raw,rect.x,rect.y,rect.width,rect.height);const sourceImageData=rawCtx.getImageData(0,0,width,height),sourcePixels=sourceImageData.data;
  const scratch=document.createElement('canvas');scratch.width=width;scratch.height=height;const sc=scratch.getContext('2d',{willReadFrequently:true});
  let eyeMaskPixels=null;if(strokes.some(stroke=>stroke.eyeMode)){const eyeMask=document.createElement('canvas');eyeMask.width=width;eyeMask.height=height;const eyeCtx=eyeMask.getContext('2d',{willReadFrequently:true});eyeCtx.fillStyle='#fff';const eyeShapes=[[[.402,.320],[.408,.309],[.423,.301],[.438,.299],[.452,.304],[.462,.313],[.466,.322],[.459,.332],[.447,.340],[.432,.344],[.418,.341],[.407,.334]],[[.598,.320],[.592,.309],[.577,.301],[.562,.299],[.548,.304],[.538,.313],[.534,.322],[.541,.332],[.553,.340],[.568,.344],[.582,.341],[.593,.334]]];for(const shape of eyeShapes){eyeCtx.beginPath();shape.forEach(([x,y],index)=>{const px=rect.x+x*rect.width,py=rect.y+y*rect.height;if(index===0)eyeCtx.moveTo(px,py);else eyeCtx.lineTo(px,py);});eyeCtx.closePath();eyeCtx.fill();}eyeMaskPixels=eyeCtx.getImageData(0,0,width,height).data;}
  for(const stroke of strokes){if(!stroke.points||!stroke.points.length)continue;sc.clearRect(0,0,width,height);sc.globalCompositeOperation='source-over';sc.globalAlpha=Math.max(0,Math.min(1,Number(stroke.opacity??1)));sc.strokeStyle=stroke.color||'#34463c';sc.fillStyle=stroke.color||'#34463c';sc.lineWidth=Math.max(1,Number(stroke.size||0.02)*rect.width);sc.lineCap='round';sc.lineJoin='round';
    const point=p=>({x:rect.x+p.x*rect.width,y:rect.y+p.y*rect.height});
    if(stroke.points.length===1){const p=point(stroke.points[0]);sc.beginPath();sc.arc(p.x,p.y,sc.lineWidth/2,0,Math.PI*2);sc.fill();}else{sc.beginPath();const first=point(stroke.points[0]);sc.moveTo(first.x,first.y);for(let i=1;i<stroke.points.length;i++){const p=point(stroke.points[i]);sc.lineTo(p.x,p.y);}sc.stroke();}
    sc.globalAlpha=1;
    if(stroke.clipToImage){sc.globalCompositeOperation='destination-in';sc.drawImage(rawCanvas,0,0);sc.globalCompositeOperation='source-over';}
    if(stroke.tool==='draw'&&((stroke.onlyColor&&stroke.onlyColor!=='all')||(stroke.avoidColor&&stroke.avoidColor!=='none')||stroke.eyeMode)){
      const pixels=sc.getImageData(0,0,width,height),d=pixels.data,basePixels=baseCtx.getImageData(0,0,width,height).data;
      const customColor=(stroke.targetColor||'#d879b5').match(/[0-9a-f]{2}/gi).map(v=>parseInt(v,16)), avoidCustomColor=(stroke.avoidTargetColor||'#d879b5').match(/[0-9a-f]{2}/gi).map(v=>parseInt(v,16)), tolerance=Math.max(0,Number(stroke.colorTolerance??70)), avoidTolerance=Math.max(0,Number(stroke.avoidColorTolerance??70));
      for(let i=0;i<d.length;i+=4){if(!d[i+3])continue;const r=basePixels[i],g=basePixels[i+1],b=basePixels[i+2];let matches=stroke.onlyColor==='all'&&basePixels[i+3]>0;if(stroke.onlyColor==='custom'){matches=basePixels[i+3]>0&&Math.hypot(r-customColor[0],g-customColor[1],b-customColor[2])<=Math.max(0,220*(1-tolerance/100));}else if(stroke.onlyColor==='all'){matches=basePixels[i+3]>0;}else if(stroke.onlyColor==='peach'){matches=basePixels[i+3]>0&&isPeachColor(r,g,b);}else if(stroke.onlyColor==='strict-grey'){matches=basePixels[i+3]>0&&Math.max(r,g,b)-Math.min(r,g,b)<=Math.max(5,Math.max(r,g,b)*.035);}else{matches=basePixels[i+3]>0&&colorFromRGB(r,g,b)===stroke.onlyColor;}if(stroke.avoidColor&&stroke.avoidColor!=='none'){const avoid=stroke.avoidColor==='custom'?Math.hypot(r-avoidCustomColor[0],g-avoidCustomColor[1],b-avoidCustomColor[2])<=Math.max(0,220*(1-avoidTolerance/100)):stroke.avoidColor==='peach'?isPeachColor(r,g,b):stroke.avoidColor==='strict-grey'?(Math.max(r,g,b)-Math.min(r,g,b)<=Math.max(5,Math.max(r,g,b)*.035)):colorFromRGB(r,g,b)===stroke.avoidColor;if(avoid)matches=false;}if(stroke.eyeMode){const eye=!!eyeMaskPixels?.[i+3];if(stroke.eyeMode==='only'?!eye:stroke.eyeMode==='avoid'&&eye)matches=false;}if(!matches)d[i+3]=0;}
      sc.putImageData(pixels,0,0);
    }
    if(stroke.tool==='draw'&&stroke.colorShades){const pixels=sc.getImageData(0,0,width,height),d=pixels.data,prior=stroke.shadeIncludesStrokes?out.getImageData(0,0,width,height).data:null;const color=(stroke.color||'#34463c').match(/[0-9a-f]{2}/gi).map(v=>parseInt(v,16));for(let i=0;i<d.length;i+=4){if(!d[i+3])continue;let r=sourcePixels[i],g=sourcePixels[i+1],b=sourcePixels[i+2],a=sourcePixels[i+3]/255;if(prior&&prior[i+3]){const pa=prior[i+3]/255,total=pa+a*(1-pa);if(total){r=(prior[i]*pa+r*a*(1-pa))/total;g=(prior[i+1]*pa+g*a*(1-pa))/total;b=(prior[i+2]*pa+b*a*(1-pa))/total;}a=total;}const lum=a?(0.2126*r+0.7152*g+0.0722*b)/255:1,shaded=stroke.matchBaseShades?colorAtBaseShade(color,lum):color.map(channel=>Math.round(channel*lum)),highlight=stroke.lightenHighlights?Math.max(0,Math.min(1,(lum-.55)/.45)):0;for(let c=0;c<3;c++)d[i+c]=Math.round(shaded[c]+(255-shaded[c])*highlight);}sc.putImageData(pixels,0,0);}
    if(stroke.tool==='image-erase'){baseCtx.globalCompositeOperation='destination-out';baseCtx.globalAlpha=1;baseCtx.drawImage(scratch,0,0);baseCtx.globalCompositeOperation='source-over';const baseAlpha=baseCtx.getImageData(0,0,width,height).data;for(let i=3;i<sourcePixels.length;i+=4)sourcePixels[i]=baseAlpha[i];rawCtx.putImageData(sourceImageData,0,0);out.globalCompositeOperation='destination-out';out.drawImage(scratch,0,0);out.globalCompositeOperation='source-over';}
    else if(stroke.tool==='erase'){out.globalCompositeOperation='destination-out';out.drawImage(scratch,0,0);out.globalCompositeOperation='source-over';}
    else if(stroke.noOpacityOverlap&&Number(stroke.opacity)<1){const src=sc.getImageData(0,0,width,height),dst=out.getImageData(0,0,width,height),s=src.data,d=dst.data;for(let i=0;i<s.length;i+=4){const sa=s[i+3]/255;if(!sa)continue;const da=d[i+3]/255;if(!da){d[i]=s[i];d[i+1]=s[i+1];d[i+2]=s[i+2];d[i+3]=s[i+3];continue;}const combined=da+sa*(1-da),finalAlpha=Math.max(da,sa);d[i]=Math.round((s[i]*sa+d[i]*da*(1-sa))/combined);d[i+1]=Math.round((s[i+1]*sa+d[i+1]*da*(1-sa))/combined);d[i+2]=Math.round((s[i+2]*sa+d[i+2]*da*(1-sa))/combined);d[i+3]=Math.round(finalAlpha*255);}out.putImageData(dst,0,0);}
    else{out.globalCompositeOperation='source-over';out.globalAlpha=1;out.drawImage(scratch,0,0);}
  }
  const composite=document.createElement('canvas');composite.width=width;composite.height=height;const ctx=composite.getContext('2d');ctx.drawImage(base,0,0);ctx.drawImage(overlay,0,0);return composite;
}
function composedImage(cat){
  if(!cat.strokes||!cat.strokes.length)return tintedImage(cat);
  if(cat.id&&cat.id!=='preview'&&compositionCache.has(cat.id))return compositionCache.get(cat.id);
  const result=(async()=>{const [raw,tintUrl]=await Promise.all([rawBaseImage(cat),tintedImage(cat)]);const tint=await loadImage(tintUrl);const rect={x:0,y:0,width:raw.naturalWidth,height:raw.naturalHeight,scale:1};return renderStrokeOverlay(cat.strokes,raw,raw.naturalWidth,raw.naturalHeight,rect,tint).toDataURL('image/png');})();
  if(cat.id&&cat.id!=='preview')compositionCache.set(cat.id,result);return result;
}
function getSelectedBaseCat(){const value=$('newCatBase').value;if(value.startsWith('custom:'))return customCats.find(cat=>cat.id===value.slice(7))||cats[0];if(value.startsWith('builtin:'))return cats.find(cat=>cat.file===value.slice(8))||cats[0];return cats.find(cat=>cat.file===value)||cats[0];}
function getDraftCat(){const base=getSelectedBaseCat();return{id:'preview',file:base.file,baseDefinition:base.id?JSON.parse(JSON.stringify(base)):undefined,aiImage:aiDraftImage||undefined,color:$('newCatColor').value,opacity:$('newCatOpacity').value,grayscale:$('newCatGrayscale').checked,solidColor:$('newCatSolidColor').checked,matchBaseShades:$('matchCatShades').checked,lightenHighlights:$('lightenCatHighlights').checked,strokes:draftStrokes};}
function drawImageRect(image){return imageRect(drawCanvas.width,drawCanvas.height,image);}
function renderEditor(){if(drawModal.hidden)return;const token=++editorRenderToken,cat=getDraftCat();Promise.all([rawBaseImage(cat),tintedImage(cat)]).then(async([raw,tintUrl])=>{const tint=await loadImage(tintUrl);if(token!==editorRenderToken||drawModal.hidden)return;editorBaseImage=raw;editorBaseTint=tint;const rect=drawImageRect(raw);drawCtx.clearRect(0,0,drawCanvas.width,drawCanvas.height);const strokes=activeStroke?[...draftStrokes,activeStroke]:draftStrokes;drawCtx.drawImage(renderStrokeOverlay(strokes,raw,drawCanvas.width,drawCanvas.height,rect,tint),0,0);}).catch(console.error);}
let lastEditorRender=0;function queueEditorRender(){if(drawModal.hidden||renderQueued)return;renderQueued=true;const wait=Math.max(0,34-(performance.now()-lastEditorRender));setTimeout(()=>requestAnimationFrame(()=>{renderQueued=false;lastEditorRender=performance.now();renderEditor();}),wait);}
function updateHistoryButtons(){$('undoDraw').disabled=draftStrokes.length===0;$('redoDraw').disabled=redoStrokes.length===0;}
function updateDrawLabel(){$('openDraw').textContent=draftStrokes.length?'✎ Draw ('+draftStrokes.length+')':'✎ Draw';}
function updateNewCatPreview(){const token=++previewRenderToken,cat=getDraftCat();if(editorBaseImage&&!editorBaseImage.src.endsWith(cat.file))editorBaseImage=null;tintCache.delete('preview');composedImage(cat).then(src=>{if(token===previewRenderToken)$('newCatPreview').src=src;}).catch(console.error);$('opacityValue').textContent=$('newCatOpacity').value+'%';queueEditorRender();}
function openDrawingEditor(){drawModal.hidden=false;editorBaseImage=null;editorBaseTint=null;renderEditor();updateHistoryButtons();}
function closeDrawingEditor(){if(activeStroke){activeStroke=null;}pickingColor=false;pickingTargetColor=false;pickingAvoidColor=false;editorBaseTint=null;$('pickColorTool').classList.remove('active');$('pickTargetColor').classList.remove('active');$('pickAvoidTargetColor').classList.remove('active');drawCanvas.classList.remove('sampling');drawModal.hidden=true;}
$('openDraw').addEventListener('click',openDrawingEditor);$('closeDraw').addEventListener('click',closeDrawingEditor);$('doneDrawing').addEventListener('click',closeDrawingEditor);$('drawBackdrop').addEventListener('click',closeDrawingEditor);
function setDrawTool(tool){drawTool=tool;pickingColor=false;pickingTargetColor=false;pickingAvoidColor=false;$('pickColorTool').classList.remove('active');$('pickTargetColor').classList.remove('active');$('pickAvoidTargetColor').classList.remove('active');drawCanvas.classList.remove('sampling');$('drawTool').classList.toggle('active',tool==='draw');$('eraseTool').classList.toggle('active',tool==='erase');$('eraseImageTool').classList.toggle('active',tool==='image-erase');}
$('drawTool').addEventListener('click',()=>setDrawTool('draw'));$('eraseTool').addEventListener('click',()=>setDrawTool('erase'));$('eraseImageTool').addEventListener('click',()=>setDrawTool('image-erase'));$('pickColorTool').addEventListener('click',()=>{pickingTargetColor=false;pickingAvoidColor=false;$('pickAvoidTargetColor').classList.remove('active');$('pickTargetColor').classList.remove('active');pickingColor=!pickingColor;$('pickColorTool').classList.toggle('active',pickingColor);drawCanvas.classList.toggle('sampling',pickingColor);$('drawStatus').textContent=pickingColor?'Click the image or a stroke to pick brush color':'New settings affect new strokes only';});
$('pickTargetColor').addEventListener('click',()=>{pickingAvoidColor=false;$('pickAvoidTargetColor').classList.remove('active');pickingColor=false;$('pickColorTool').classList.remove('active');pickingTargetColor=!pickingTargetColor;$('pickTargetColor').classList.toggle('active',pickingTargetColor);drawCanvas.classList.toggle('sampling',pickingTargetColor);$('drawStatus').textContent=pickingTargetColor?'Click a color on the cat image to match':'New settings affect new strokes only';});
$('pickAvoidTargetColor').addEventListener('click',()=>{pickingColor=false;pickingTargetColor=false;$('pickColorTool').classList.remove('active');$('pickTargetColor').classList.remove('active');pickingAvoidColor=!pickingAvoidColor;$('pickAvoidTargetColor').classList.toggle('active',pickingAvoidColor);drawCanvas.classList.toggle('sampling',pickingAvoidColor);$('drawStatus').textContent=pickingAvoidColor?'Click a color on the cat image to avoid':'New settings affect new strokes only';});
$('clearDrawing').addEventListener('click',()=>{draftStrokes=[];redoStrokes=[];activeStroke=null;updateHistoryButtons();updateDrawLabel();queueEditorRender();updateNewCatPreview();});
$('undoDraw').addEventListener('click',()=>{if(!draftStrokes.length)return;redoStrokes.push(draftStrokes.pop());updateHistoryButtons();updateDrawLabel();queueEditorRender();updateNewCatPreview();});$('redoDraw').addEventListener('click',()=>{if(!redoStrokes.length)return;draftStrokes.push(redoStrokes.pop());updateHistoryButtons();updateDrawLabel();queueEditorRender();updateNewCatPreview();});
$('brushOpacity').addEventListener('input',()=>{$('brushOpacityValue').textContent=$('brushOpacity').value+'%';});$('brushSize').addEventListener('input',()=>{$('brushSizeValue').textContent=$('brushSize').value;});
function updateColorTargetControls(){const custom=$('drawOnlyColor').value==='custom',avoidCustom=$('avoidColor').value==='custom';$('customTargetColorWrap').hidden=!custom;$('customTargetToleranceWrap').hidden=!custom;$('pickTargetColor').hidden=!custom;$('avoidTargetColorWrap').hidden=!avoidCustom;$('avoidTargetToleranceWrap').hidden=!avoidCustom;$('pickAvoidTargetColor').hidden=!avoidCustom;}
$('avoidColor').addEventListener('change',()=>{updateColorTargetControls();if($('avoidColor').value!=='custom'&&pickingAvoidColor){pickingAvoidColor=false;$('pickAvoidTargetColor').classList.remove('active');drawCanvas.classList.remove('sampling');}$('drawStatus').textContent='New settings affect new strokes only';queueEditorRender();});$('drawOnlyColor').addEventListener('change',()=>{updateColorTargetControls();if($('drawOnlyColor').value!=='custom'&&pickingTargetColor){pickingTargetColor=false;$('pickTargetColor').classList.remove('active');drawCanvas.classList.remove('sampling');}$('drawStatus').textContent='New settings affect new strokes only';queueEditorRender();});
function updateStrokeHighlightControl(){const enabled=$('shadeNewStrokes').checked;$('matchStrokeShadesWrap').hidden=!enabled;$('lightenStrokeHighlightsWrap').hidden=!enabled;}
$('shadeNewStrokes').addEventListener('change',()=>{updateStrokeHighlightControl();queueEditorRender();});$('lightenStrokeHighlights').addEventListener('change',queueEditorRender);$('matchStrokeShades').addEventListener('change',queueEditorRender);
updateStrokeHighlightControl();
$('drawTargetTolerance').addEventListener('input',()=>{$('drawTargetToleranceValue').textContent=$('drawTargetTolerance').value+'%';queueEditorRender();});$('avoidTargetTolerance').addEventListener('input',()=>{$('avoidTargetToleranceValue').textContent=$('avoidTargetTolerance').value+'%';queueEditorRender();});
updateColorTargetControls();
for(const id of ['brushColor','brushOpacity','brushSize','clipNewStrokes','shadeNewStrokes','noOpacityOverlap','ignoreDrawnForShade','drawTargetColor','drawTargetTolerance','avoidColor','avoidTargetColor','avoidTargetTolerance','avoidEyes','onlyEyes'])$(id).addEventListener('change',queueEditorRender);
function editorPointerPoint(event){if(!editorBaseImage)return null;const box=drawCanvas.getBoundingClientRect();const x=(event.clientX-box.left)*drawCanvas.width/box.width,y=(event.clientY-box.top)*drawCanvas.height/box.height;const rect=imageRect(drawCanvas.width,drawCanvas.height,editorBaseImage);return{x:(x-rect.x)/rect.width,y:(y-rect.y)/rect.height,rect};}
let drawZoom=1,panKey=false,panMode=false,panningCanvas=false,panStart=null;function setDrawZoom(value){drawZoom=Math.max(1,Math.min(4,value));drawCanvas.style.width=(drawZoom*100)+'%';drawCanvas.style.height=(drawZoom*100)+'%';$('zoomValue').textContent=Math.round(drawZoom*100)+'%';$('zoomOut').disabled=drawZoom<=1;$('zoomIn').disabled=drawZoom>=4;$('panCanvasButton').disabled=drawZoom<=1;if(drawZoom<=1){panMode=false;$('panCanvasButton').setAttribute('aria-pressed','false');$('panCanvasButton').classList.remove('active');drawCanvas.classList.remove('pan-ready');}}
$('panCanvasButton').addEventListener('click',()=>{if(drawZoom<=1)return;panMode=!panMode;$('panCanvasButton').setAttribute('aria-pressed',String(panMode));$('panCanvasButton').classList.toggle('active',panMode);drawCanvas.classList.toggle('pan-ready',panMode);});$('zoomIn').addEventListener('click',()=>setDrawZoom(drawZoom+0.25));$('zoomOut').addEventListener('click',()=>setDrawZoom(drawZoom-0.25));$('zoomReset').addEventListener('click',()=>{setDrawZoom(1);$('drawCanvas').parentElement.scrollTo(0,0);});setDrawZoom(1);
drawCanvas.addEventListener('pointerdown',event=>{if(drawZoom>1&&(event.button===1||panKey||panMode)){event.preventDefault();panningCanvas=true;panStart={x:event.clientX,y:event.clientY,left:drawCanvas.parentElement.scrollLeft,top:drawCanvas.parentElement.scrollTop};drawCanvas.setPointerCapture(event.pointerId);drawCanvas.classList.add('panning');return;}if(event.button!==undefined&&event.button!==0)return;event.preventDefault();if(pickingColor||pickingTargetColor||pickingAvoidColor){let pixel=null;if(pickingTargetColor||pickingAvoidColor){const hit=editorPointerPoint(event);if(hit&&hit.x>=0&&hit.x<=1&&hit.y>=0&&hit.y<=1&&editorBaseTint){const sample=document.createElement('canvas');sample.width=editorBaseTint.naturalWidth;sample.height=editorBaseTint.naturalHeight;const sampleCtx=sample.getContext('2d',{willReadFrequently:true});sampleCtx.drawImage(editorBaseTint,0,0);pixel=sampleCtx.getImageData(Math.min(sample.width-1,Math.floor(hit.x*sample.width)),Math.min(sample.height-1,Math.floor(hit.y*sample.height)),1,1).data;}}else{const bounds=drawCanvas.getBoundingClientRect(),x=Math.max(0,Math.min(drawCanvas.width-1,Math.floor((event.clientX-bounds.left)*drawCanvas.width/bounds.width))),y=Math.max(0,Math.min(drawCanvas.height-1,Math.floor((event.clientY-bounds.top)*drawCanvas.height/bounds.height)));pixel=drawCtx.getImageData(x,y,1,1).data;}if(pixel&&pixel[3]){const hex='#'+[pixel[0],pixel[1],pixel[2]].map(value=>value.toString(16).padStart(2,'0')).join('');if(pickingAvoidColor){$('avoidTargetColor').value=hex;$('drawStatus').textContent='Picked avoided color '+hex.toUpperCase()+' · adjust similarity if needed';}else if(pickingTargetColor){$('drawTargetColor').value=hex;$('drawStatus').textContent='Picked target '+hex.toUpperCase()+' · adjust similarity if needed';}else{$('brushColor').value=hex;$('drawStatus').textContent='Picked '+hex.toUpperCase()+' · new settings affect new strokes';}}else{$('drawStatus').textContent='Pick a color from the cat image';}pickingColor=false;pickingTargetColor=false;pickingAvoidColor=false;$('pickColorTool').classList.remove('active');$('pickTargetColor').classList.remove('active');$('pickAvoidTargetColor').classList.remove('active');drawCanvas.classList.remove('sampling');queueEditorRender();return;}const hit=editorPointerPoint(event);if(!hit)return;activeStroke={tool:drawTool,color:$('brushColor').value,opacity:Number($('brushOpacity').value)/100,size:Number($('brushSize').value)/hit.rect.width,colorShades:$('shadeNewStrokes').checked,clipToImage:$('clipNewStrokes').checked,onlyColor:$('drawOnlyColor').value,avoidColor:$('avoidColor').value,avoidTargetColor:$('avoidTargetColor').value,avoidColorTolerance:Number($('avoidTargetTolerance').value),eyeMode:$('onlyEyes').checked?'only':$('avoidEyes').checked?'avoid':'',targetColor:$('drawTargetColor').value,colorTolerance:Number($('drawTargetTolerance').value),lightenHighlights:$('lightenStrokeHighlights').checked,matchBaseShades:$('matchStrokeShades').checked,noOpacityOverlap:$('noOpacityOverlap').checked,shadeIncludesStrokes:!$('ignoreDrawnForShade').checked,points:[{x:hit.x,y:hit.y}]};drawCanvas.setPointerCapture(event.pointerId);queueEditorRender();});
drawCanvas.addEventListener('pointermove',event=>{if(panningCanvas&&panStart){const wrap=drawCanvas.parentElement;wrap.scrollLeft=panStart.left-(event.clientX-panStart.x);wrap.scrollTop=panStart.top-(event.clientY-panStart.y);return;}if(!activeStroke)return;const hit=editorPointerPoint(event);if(!hit)return;const last=activeStroke.points[activeStroke.points.length-1];if(Math.hypot((hit.x-last.x)*hit.rect.width,(hit.y-last.y)*hit.rect.height)>2.25)activeStroke.points.push({x:hit.x,y:hit.y});queueEditorRender();});
function finishDrawStroke(){if(!activeStroke)return;draftStrokes.push(activeStroke);activeStroke=null;redoStrokes=[];updateHistoryButtons();updateDrawLabel();queueEditorRender();updateNewCatPreview();}
function finishCanvasPointer(){if(panningCanvas){panningCanvas=false;panStart=null;drawCanvas.classList.remove('panning');}finishDrawStroke();}drawCanvas.addEventListener('pointerup',finishCanvasPointer);drawCanvas.addEventListener('pointercancel',finishCanvasPointer);window.addEventListener('keydown',e=>{if(e.code==='Space'&&!drawModal.hidden){panKey=true;e.preventDefault();}});window.addEventListener('keyup',e=>{if(e.code==='Space')panKey=false;});
function setSelectedCat(cat){selectedCat=cat;catImg.src=cat.file;catImg.alt=cat.name+' cat';$('selectedName').textContent=cat.name;
  if(cat.id)composedImage(cat).then(src=>{if(selectedCat===cat)catImg.src=src;}).catch(console.error);
  try{localStorage.setItem(SELECTED_KEY,cat.id||cat.file);}catch{}
}
function updateSortControls(){
  $('catSortPreset').value=sortSettings.mode;
  $('toggleSortMode').textContent=sortingEnabled?'✓ Done sorting':'↕ Sort cats';
  $('toggleSortMode').classList.toggle('sort-active',sortingEnabled);
  $('sortStatus').textContent=sortingEnabled?(swapSelection?'Selected '+swapSelection.name+' · tap another to '+($('sortAdjacent').checked?'place beside':'swap'):($('sortAdjacent').checked?'First goes to second’s place; second goes beside it':'Tap two cats to swap places')):'Choose a preset or sort cats manually';
  const tools=$('colorOrderTools');tools.hidden=sortSettings.mode!=='Color-based';tools.replaceChildren();
  if(sortSettings.mode==='Color-based'){
    for(let i=0;i<sortSettings.colorOrder.length;i++){
      const item=document.createElement('div');item.className='color-order-item';
      const label=document.createElement('span');label.textContent=sortSettings.colorOrder[i]==='other'?'Other / non-specific':sortSettings.colorOrder[i][0].toUpperCase()+sortSettings.colorOrder[i].slice(1);item.append(label);
      for(const [symbol,delta] of [['↑',-1],['↓',1]]){const button=document.createElement('button');button.type='button';button.textContent=symbol;button.disabled=i+delta<0||i+delta>=sortSettings.colorOrder.length;button.setAttribute('aria-label','Move '+label.textContent+' '+(delta<0?'earlier':'later'));button.addEventListener('click',()=>{const order=[...sortSettings.colorOrder];[order[i],order[i+delta]]=[order[i+delta],order[i]];sortSettings.colorOrder=order;storeSortSettings();buildCatPicker();});item.append(button);}
      tools.append(item);
    }
  }
}
function pickerCatClick(cat){
  if(!sortingEnabled){setSelectedCat(cat);modal.hidden=true;buildCatPicker();return;}
  if(!swapSelection){swapSelection=cat;buildCatPicker();return;}
  if(swapSelection===cat){swapSelection=null;buildCatPicker();return;}
  const ordered=allCats(),first=ordered.indexOf(swapSelection),second=ordered.indexOf(cat);
  if(first>=0&&second>=0){if($('sortAdjacent').checked){const firstCat=swapSelection,secondCat=cat;const remainder=ordered.filter(item=>item!==firstCat&&item!==secondCat);if(second===ordered.length-1){remainder.splice(Math.max(0,second-1),0,secondCat);remainder.splice(Math.min(second,remainder.length),0,firstCat);}else{remainder.splice(Math.min(second,remainder.length),0,firstCat);remainder.splice(Math.min(second+1,remainder.length),0,secondCat);}ordered.splice(0,ordered.length,...remainder);}else [ordered[first],ordered[second]]=[ordered[second],ordered[first]];sortSettings={...sortSettings,mode:'Custom',order:ordered.map(catKey)};storeSortSettings();}
  swapSelection=null;buildCatPicker();
}
function closeCatPicker(){modal.hidden=true;sortingEnabled=false;swapSelection=null;updateSortControls();}
$('catSortPreset').addEventListener('change',()=>{
  sortSettings={...sortSettings,mode:$('catSortPreset').value,order:[],colorOrder:sortSettings.colorOrder||[...COLOR_ORDER]};sortingEnabled=false;swapSelection=null;
  if(sortSettings.mode==='Custom')sortSettings.order=allCats().map(catKey);
  storeSortSettings();buildCatPicker();
});
$('toggleSortMode').addEventListener('click',()=>{sortingEnabled=!sortingEnabled;swapSelection=null;updateSortControls();buildCatPicker();});$('sortAdjacent').checked=localStorage.getItem('cat-club-sort-adjacent')==='true';$('sortAdjacent').addEventListener('change',()=>{try{localStorage.setItem('cat-club-sort-adjacent',$('sortAdjacent').checked);}catch{}updateSortControls();});
function buildCatPicker(){
  updateSortControls();catGrid.classList.toggle('sorting',sortingEnabled);catGrid.classList.toggle('color-editing',sortSettings.mode==='Color-based');catGrid.replaceChildren();
  for(const cat of allCats()){
    const wrap=document.createElement('div');wrap.className='cat-card-wrap';
    const button=document.createElement('button');button.className='cat-card'+(cat===selectedCat?' selected':'')+(cat===swapSelection?' swap-selected':'');button.type='button';
    const img=document.createElement('img');img.alt='';img.src=cat.file;if(cat.id)composedImage(cat).then(src=>{img.src=src;}).catch(console.error);
    const name=document.createElement('span');name.textContent=cat.name;button.append(img,name);
    button.addEventListener('click',()=>pickerCatClick(cat));wrap.append(button);
    if(sortSettings.mode==='Color-based'){
      const colorSelect=document.createElement('select');colorSelect.className='cat-color-select';colorSelect.setAttribute('aria-label','Color this cat counts as');
      const automatic=document.createElement('option');automatic.value='auto';const current=catColorGroup(cat,true);automatic.textContent='Auto · '+(current==='other'?'Other':current[0].toUpperCase()+current.slice(1));colorSelect.append(automatic);
      for(const color of COLOR_ORDER){const option=document.createElement('option');option.value=color;option.textContent=color==='other'?'Other / non-specific':color[0].toUpperCase()+color.slice(1);colorSelect.append(option);}
      colorSelect.value=sortSettings.colorOverrides?.[catKey(cat)]||'auto';colorSelect.addEventListener('change',()=>{sortSettings.colorOverrides=sortSettings.colorOverrides||{};if(colorSelect.value==='auto')delete sortSettings.colorOverrides[catKey(cat)];else sortSettings.colorOverrides[catKey(cat)]=colorSelect.value;storeSortSettings();buildCatPicker();});wrap.append(colorSelect);
    }
    if(cat.id){const del=document.createElement('button');del.type='button';del.className='delete-cat';del.textContent='×';del.setAttribute('aria-label','Delete '+cat.name);del.addEventListener('click',e=>{e.stopPropagation();customCats=customCats.filter(item=>item.id!==cat.id);sortSettings.order=sortSettings.order.filter(key=>key!==catKey(cat));storeSortSettings();if(swapSelection===cat)swapSelection=null;tintCache.delete(cat.id);compositionCache.delete(cat.id);try{localStorage.setItem(CUSTOM_KEY,JSON.stringify(customCats));}catch{}if(selectedCat.id===cat.id)setSelectedCat(cats[0]);populateBaseCats();buildCatPicker();});wrap.append(del);}
    catGrid.append(wrap);
  }
}
function populateBaseCats(selectedValue=''){const select=$('newCatBase'),previous=selectedValue||select.value;select.replaceChildren();allCats().forEach(cat=>{const option=document.createElement('option');option.value=cat.id?'custom:'+cat.id:'builtin:'+cat.file;option.textContent=cat.name;select.append(option);});if([...select.options].some(option=>option.value===previous))select.value=previous;}

populateBaseCats();
$('newCatBase').addEventListener('change',()=>{editorBaseImage=null;editorBaseTint=null;aiGenerationToken++;aiDraftImage=null;aiSourceImage=null;aiGeneratedImage=null;$('generateAIDrawing').disabled=false;$('regenerateAIDrawing').disabled=false;$('useAIDrawing').disabled=false;$('discardAIDrawing').disabled=false;$('aiDrawPanel').hidden=true;$('aiDrawResult').hidden=true;updateNewCatPreview();});$('newCatColor').addEventListener('input',updateNewCatPreview);$('newCatOpacity').addEventListener('input',updateNewCatPreview);$('newCatGrayscale').addEventListener('change',updateNewCatPreview);$('lightenCatHighlights').addEventListener('change',updateNewCatPreview);$('matchCatShades').addEventListener('change',updateNewCatPreview);$('newCatSolidColor').addEventListener('change',()=>{const solid=$('newCatSolidColor').checked;if(solid)$('newCatGrayscale').checked=false;$('newCatGrayscale').disabled=solid;$('newCatGrayscale').closest('label').classList.toggle('disabled',solid);$('createCatForm').classList.toggle('solid-color-mode',solid);$('matchCatShadesWrap').hidden=!solid;$('lightenCatHighlightsWrap').hidden=!solid;updateNewCatPreview();});
async function imageAsDataUrl(src){
  if(src.startsWith('data:'))return src;
  const response=await fetch(src);if(!response.ok)throw new Error('Could not load the cat image');
  const blob=await response.blob();return await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Could not read the cat image'));reader.readAsDataURL(blob);});
}
async function compactAIImage(src){
  const image=await loadImage(src),scale=Math.min(1,640/Math.max(image.naturalWidth,image.naturalHeight));
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
  canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/png');
}
$('openAIDraw').addEventListener('click',()=>{const panel=$('aiDrawPanel');panel.hidden=!panel.hidden;if(!panel.hidden)$('aiDrawPrompt').focus();});
// cleared for PDA SEASIDE: AI Draw goes to the desktop's own picture engine (SEASIDE gives games a websim.imageGen); hidden only where there's no websim at all
if(!window.websim?.imageGen){$('openAIDraw').style.display='none';$('aiDrawPanel').hidden=true;}
async function generateAIDrawing(){
  const prompt=$('aiDrawPrompt').value.trim(),status=$('aiDrawStatus');
  if(!prompt){status.textContent='Add a drawing idea first.';$('aiDrawPrompt').focus();return;}
  const token=++aiGenerationToken,generate=$('generateAIDrawing'),again=$('regenerateAIDrawing');
  generate.disabled=true;again.disabled=true;$('useAIDrawing').disabled=true;$('discardAIDrawing').disabled=true;
  status.textContent='Drawing… this usually takes about 10 seconds.';
  try{
    if(!aiSourceImage){const source=await imageAsDataUrl($('newCatPreview').src);if(token!==aiGenerationToken)return;aiSourceImage=source;}
    if(token!==aiGenerationToken)return;
    const result=await window.websim.imageGen({
      prompt:'Edit the supplied cat image. Keep the same cat, pose, anatomy, proportions, face, outline, colors, and transparent background. Add only this drawing directly on the cat: '+prompt+'. The added drawing should look like a cute, clean hand-drawn marking or accessory on the fur. Do not replace or redesign the cat. Do not add a scene, objects around the cat, a background, or any text.',
      image_inputs:[{url:aiSourceImage}],aspect_ratio:'4:3',transparent:true
    });
    if(token!==aiGenerationToken)return;
    if(!result||!result.url)throw new Error('The drawing could not be generated. Please try again.');
    const dataUrl=await imageAsDataUrl(result.url);if(token!==aiGenerationToken)return;
    aiGeneratedImage=await compactAIImage(dataUrl);$('aiDrawResultImage').src=aiGeneratedImage;$('aiDrawResult').hidden=false;
    status.textContent='Ready! Use this drawing or try another version.';
  }catch(error){if(token===aiGenerationToken)status.textContent=error?.message||'Could not generate the drawing. Please try again.';}
  finally{if(token===aiGenerationToken){generate.disabled=false;again.disabled=false;$('useAIDrawing').disabled=false;$('discardAIDrawing').disabled=false;}}
}
$('generateAIDrawing').addEventListener('click',generateAIDrawing);
$('regenerateAIDrawing').addEventListener('click',generateAIDrawing);
$('useAIDrawing').addEventListener('click',()=>{
  if(!aiGeneratedImage)return;aiDraftImage=aiGeneratedImage;aiGeneratedImage=null;aiSourceImage=null;
  draftStrokes=[];redoStrokes=[];activeStroke=null;updateHistoryButtons();updateDrawLabel();
  $('aiDrawPanel').hidden=true;$('aiDrawResult').hidden=true;$('aiDrawStatus').textContent='';updateNewCatPreview();
});
$('discardAIDrawing').addEventListener('click',()=>{
  aiGenerationToken++;aiGeneratedImage=null;aiSourceImage=null;$('generateAIDrawing').disabled=false;$('regenerateAIDrawing').disabled=false;$('useAIDrawing').disabled=false;$('discardAIDrawing').disabled=false;$('aiDrawPanel').hidden=true;$('aiDrawResult').hidden=true;$('aiDrawStatus').textContent='';
});
async function inferMostCommonColor(cat){
  const src=await composedImage(cat),image=await loadImage(src),canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;const counts=Object.fromEntries(COLOR_ORDER.map(color=>[color,0]));
  for(let i=0;i<pixels.length;i+=16){if(pixels[i+3]<100)continue;const color=colorFromRGB(pixels[i],pixels[i+1],pixels[i+2]);counts[color]++;}
  return COLOR_ORDER.reduce((best,color)=>counts[color]>counts[best]?color:best,COLOR_ORDER[0]);
}
$('createCatForm').addEventListener('submit',async e=>{e.preventDefault();const name=$('newCatName').value.trim();if(!name)return;const submit=$('createCatForm').querySelector('[type="submit"]');submit.disabled=true;const base=getSelectedBaseCat(),id='custom-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7);const cat={id,name,file:base.file,baseDefinition:base.id?JSON.parse(JSON.stringify(base)):undefined,aiImage:aiDraftImage||undefined,color:$('newCatColor').value,opacity:Number($('newCatOpacity').value),grayscale:$('newCatGrayscale').checked,solidColor:$('newCatSolidColor').checked,matchBaseShades:$('matchCatShades').checked,lightenHighlights:$('lightenCatHighlights').checked,sortColor:$('newCatSortColor').value,strokes:JSON.parse(JSON.stringify(draftStrokes))};try{cat.autoColor=await inferMostCommonColor(cat);}catch{cat.autoColor=colorFromRGB(...cat.color.match(/[0-9a-f]{2}/gi).map(v=>parseInt(v,16)));}customCats.push(cat);try{localStorage.setItem(CUSTOM_KEY,JSON.stringify(customCats));}catch{customCats.pop();showToast('Could not save cat');submit.disabled=false;return;}submit.disabled=false;$('newCatName').value='';populateBaseCats();buildCatPicker();setSelectedCat(cat);modal.hidden=true;closeDrawingEditor();draftStrokes=[];redoStrokes=[];updateDrawLabel();updateHistoryButtons();aiDraftImage=null;aiSourceImage=null;aiGeneratedImage=null;$('aiDrawPanel').hidden=true;$('aiDrawResult').hidden=true;updateNewCatPreview();});
updateNewCatPreview();
function renderFoods(scrollToEnd=false){
  foodOptions.replaceChildren();
  [...foods,...customFoods].forEach(emoji=>{
    const button=document.createElement('button'); button.type='button';button.className='food-choice'+(selectedFood===emoji?' active':'');
    button.textContent=emoji;button.setAttribute('aria-label','Drag '+emoji+' to your cat');button.dataset.food=emoji;
    button.addEventListener('pointerdown',e=>{dragCandidate={emoji,pointerId:e.pointerId,startX:e.clientX,startY:e.clientY};});
    button.addEventListener('click',e=>{if(suppressFoodClick){e.preventDefault();suppressFoodClick=false;return;}selectedFood=emoji;renderFoods();});
    foodOptions.append(button);
  });
  if(scrollToEnd)requestAnimationFrame(()=>{foodOptions.scrollLeft=foodOptions.scrollWidth;});
}
function setMode(next){
  stopPetting();stopCleaning();stopDanceLoop();
  mode=mode===next?null:next;
  stage.classList.toggle('pet-mode',mode==='pet');stage.classList.toggle('clean-mode',mode==='clean');stage.classList.toggle('feed-mode',mode==='feed');stage.classList.toggle('dance-mode',mode==='dance');stage.classList.toggle('active',!!mode);
  for(const [id,active] of [['petButton',mode==='pet'],['feedButton',mode==='feed'],['cleanButton',mode==='clean'],['danceButton',mode==='dance']])$(id).classList.toggle('selected',active);
  for(const id of ['petButton','feedButton','cleanButton'])$(id).hidden=mode==='dance';
  $('danceMoves').hidden=mode!=='dance';if(mode!=='dance')danceBuilderOpen=false;$('danceBuilder').hidden=mode!=='dance'||!danceBuilderOpen;tray.hidden=mode!=='feed';$('handForm').hidden=mode!=='pet';
  $('modeHint').textContent=mode==='pet'?'Press and hold your cat to pet':mode==='clean'?'Hold the sponge on your cat to clean':mode==='dance'?'Choose a dance move':'Choose a little something to do';
  hand.textContent=mode==='clean'?cleanEmoji:$('handEmoji').value||'🤚';$('cleanIcon').textContent=cleanEmoji;$('cleanItems').hidden=mode!=='clean';hand.style.opacity=(mode==='pet'||mode==='clean')?'1':'0';
}
$('petButton').addEventListener('click',()=>setMode('pet'));
$('feedButton').addEventListener('click',()=>setMode('feed'));
$('cleanButton').addEventListener('click',()=>setMode('clean'));$('cleanItems').addEventListener('click',event=>{const button=event.target.closest('[data-clean]');if(!button)return;cleanEmoji=button.dataset.clean;$('cleanIcon').textContent=cleanEmoji;hand.textContent=cleanEmoji;});
$('danceButton').addEventListener('click',()=>setMode('dance'));
$('hintToggle').addEventListener('click',()=>{const hidden=$('modeHint').classList.toggle('hint-hidden');$('hintToggle').textContent=hidden?'Hint off':'Hint on';$('hintToggle').setAttribute('aria-pressed',String(!hidden));});
const danceMoveClasses=['dance-up','dance-left','dance-right','dance-down','dance-spin','dance-spin-reverse','dance-shrink','dance-grow','dance-shake','dance-tilt-right','dance-tilt-left'];
const danceMoveClassMap={up:'dance-up',left:'dance-left',right:'dance-right',down:'dance-down',spin:'dance-spin','spin-reverse':'dance-spin-reverse','tilt-right':'dance-tilt-right','tilt-left':'dance-tilt-left',shrink:'dance-shrink',grow:'dance-grow',shake:'dance-shake'};
const danceMoveIcons={up:'⬆️',left:'⬅️',right:'➡️',down:'⬇️',spin:'🔁','spin-reverse':'🔁2','tilt-right':'↗️','tilt-left':'↖️',shrink:'⏬️',grow:'⏫️',shake:'📳'};
let assembledDance=[],danceLoopTimer=null,danceLoopIndex=0,danceLoopRunning=false,danceBuilderOpen=false;
function performDanceMove(move){const className=danceMoveClassMap[move];if(!className)return;catImg.classList.remove(...danceMoveClasses);void catImg.offsetWidth;catImg.classList.add(className);}
function renderDanceBuilder(){const palette=$('builderMoves'),sequence=$('assembledSequence');palette.replaceChildren();sequence.replaceChildren();if(!assembledDance.length){const empty=document.createElement('span');empty.className='sequence-empty';empty.textContent='Tap moves in order';sequence.append(empty);}else assembledDance.forEach((move,index)=>{const step=document.createElement('span');step.className='sequence-step';const number=document.createElement('small');number.textContent=String(index+1);const icon=document.createElement('span');icon.textContent=danceMoveIcons[move];const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.setAttribute('aria-label','Remove move '+(index+1));remove.addEventListener('click',()=>{if(danceLoopRunning)return;assembledDance.splice(index,1);renderDanceBuilder();});step.append(number,icon,remove);sequence.append(step);});for(const [move,icon] of Object.entries(danceMoveIcons)){const button=document.createElement('button');button.type='button';button.className='builder-move';button.textContent=icon;button.setAttribute('aria-label','Add '+move+' dance move');button.disabled=danceLoopRunning;button.addEventListener('click',()=>{if(danceLoopRunning)return;assembledDance.push(move);renderDanceBuilder();});palette.append(button);} $('playDance').disabled=!assembledDance.length||danceLoopRunning;}
function runDanceLoop(){if(!danceLoopRunning||!assembledDance.length)return;performDanceMove(assembledDance[danceLoopIndex]);danceLoopIndex=(danceLoopIndex+1)%assembledDance.length;danceLoopTimer=setTimeout(runDanceLoop,650);}
function playDanceLoop(){if(!assembledDance.length||danceLoopRunning)return;danceLoopRunning=true;danceLoopIndex=0;$('playDance').hidden=true;$('stopDance').hidden=false;$('clearDance').disabled=true;for(const button of $('danceMoves').querySelectorAll('[data-move]'))button.disabled=true;renderDanceBuilder();runDanceLoop();}
function stopDanceLoop(){if(danceLoopTimer){clearTimeout(danceLoopTimer);danceLoopTimer=null;}danceLoopRunning=false;catImg.classList.remove(...danceMoveClasses);$('playDance').hidden=false;$('stopDance').hidden=true;$('clearDance').disabled=false;if($('danceMoves'))for(const button of $('danceMoves').querySelectorAll('[data-move]'))button.disabled=false;if($('builderMoves'))renderDanceBuilder();}
$('danceMoves').addEventListener('click',event=>{const button=event.target.closest('[data-move]');if(!button||danceLoopRunning)return;performDanceMove(button.dataset.move);});
$('assembleDanceButton').addEventListener('click',()=>{if(danceLoopRunning)return;danceBuilderOpen=true;$('danceBuilder').hidden=false;renderDanceBuilder();});
$('playDance').addEventListener('click',playDanceLoop);$('stopDance').addEventListener('click',stopDanceLoop);
$('clearDance').addEventListener('click',()=>{if(danceLoopRunning)return;assembledDance=[];renderDanceBuilder();});
catImg.addEventListener('animationend',()=>catImg.classList.remove(...danceMoveClasses));
$('openCats').addEventListener('click',()=>{buildCatPicker();modal.hidden=false;});
$('closeCats').addEventListener('click',closeCatPicker);$('closeCatsX').addEventListener('click',closeCatPicker);
function applyHandEmoji(value){const emoji=value.trim();if(!emoji)return;hand.textContent=emoji;document.querySelector('#petButton .action-icon').textContent=emoji;}
$('handEmoji').addEventListener('input',e=>applyHandEmoji(e.currentTarget.value));
$('handForm').addEventListener('submit',e=>{e.preventDefault();applyHandEmoji($('handEmoji').value);});
$('customFoodForm').addEventListener('submit',e=>{e.preventDefault();const input=$('customEmoji'), emoji=input.value.trim();if(!emoji)return;customFoods=customFoods.filter(x=>x!==emoji);customFoods.push(emoji);selectedFood=emoji;input.value='';renderFoods(true);});
function isCatAt(x,y){const r=stage.getBoundingClientRect();return x>r.left+r.width*.22&&x<r.right-r.width*.22&&y>r.top+r.height*.08&&y<r.bottom-r.height*.17;}
function moveHand(x,y){const r=stage.getBoundingClientRect();hand.style.left=(x-r.left)+'px';hand.style.top=(y-r.top)+'px';}
function startPetting(pointerId){if(petting)return;petting=true;petPointer=pointerId;heart.classList.add('visible');makePurr();petTimer=setInterval(()=>{if(petting)makePurr();},500);}
function stopPetting(){petting=false;petPointer=null;if(petTimer){clearInterval(petTimer);petTimer=null;}heart.classList.remove('visible');}
function spawnCleanBubbles(){const bounds=stage.getBoundingClientRect();for(let i=0;i<2;i++){const bubble=document.createElement('i');bubble.className='clean-bubble';const size=7+Math.random()*12;bubble.style.width=size+'px';bubble.style.height=size+'px';bubble.style.left=(cleanX-bounds.left+(Math.random()*24-12))+'px';bubble.style.top=(cleanY-bounds.top-12+Math.random()*14)+'px';bubble.style.setProperty('--bubble-drift',(Math.random()*70-35)+'px');stage.append(bubble);bubble.addEventListener('animationend',()=>bubble.remove(),{once:true});}}
function startCleaning(pointerId,x,y){if(cleaning)return;cleaning=true;cleanPointer=pointerId;cleanX=x;cleanY=y;spawnCleanBubbles();cleanTimer=setInterval(spawnCleanBubbles,135);}
function stopCleaning(){cleaning=false;cleanPointer=null;if(cleanTimer){clearInterval(cleanTimer);cleanTimer=null;}}
function makePurr(){const p=document.createElement('span');p.className='purr';p.textContent='Purr';p.style.top=(17+Math.random()*12)+'px';p.style.left=(5+Math.random()*18)+'%';headEffects.append(p);p.addEventListener('animationend',()=>p.remove());}
stage.addEventListener('pointermove',e=>{
  if(mode==='pet'||mode==='clean')moveHand(e.clientX,e.clientY);
  if(cleaning&&cleanPointer===e.pointerId){cleanX=e.clientX;cleanY=e.clientY;}
});
window.addEventListener('pointermove',e=>{
  if(dragCandidate&&dragCandidate.pointerId===e.pointerId&&Math.hypot(e.clientX-dragCandidate.startX,e.clientY-dragCandidate.startY)>8){
    const emoji=dragCandidate.emoji;dragCandidate=null;suppressFoodClick=true;beginFoodDrag(emoji,e);
  }
  if(dragging&&dragPointer===e.pointerId&&dragFood){dragFood.style.left=e.clientX+'px';dragFood.style.top=e.clientY+'px';}
});
stage.addEventListener('pointerdown',e=>{
  if((mode!=='pet'&&mode!=='clean')||e.target.closest('.hand-switch'))return;
  moveHand(e.clientX,e.clientY);
  if(isCatAt(e.clientX,e.clientY)){e.preventDefault();if(mode==='pet')startPetting(e.pointerId);else startCleaning(e.pointerId,e.clientX,e.clientY);}
});
window.addEventListener('pointerup',e=>{
  if(petting&&petPointer===e.pointerId)stopPetting();if(cleaning&&cleanPointer===e.pointerId)stopCleaning();
  if(dragCandidate&&dragCandidate.pointerId===e.pointerId)dragCandidate=null;
  if(dragging&&dragPointer===e.pointerId){finishFoodDrag(e.clientX,e.clientY);setTimeout(()=>{suppressFoodClick=false;},0);}
});
window.addEventListener('pointercancel',()=>{stopPetting();stopCleaning();cancelFoodDrag();});
function beginFoodDrag(emoji,e){
  dragging=true;dragPointer=e.pointerId;dragFood=$('dragFood');dragFood.textContent=emoji;dragFood.style.display='block';dragFood.style.left=e.clientX+'px';dragFood.style.top=e.clientY+'px';
}
function finishFoodDrag(x,y){if(!dragging)return;const emoji=dragFood.textContent;dragging=false;dragPointer=null;dragFood.style.display='none';if(mode==='feed'&&isCatAt(x,y)){makeCrumbs(x,y);showToast('Yum! '+emoji);}}
function cancelFoodDrag(){dragCandidate=null;dragging=false;dragPointer=null;if(dragFood)dragFood.style.display='none';}
function makeCrumbs(x,y){const r=stage.getBoundingClientRect(),localX=x-r.left,localY=y-r.top;for(let i=0;i<10;i++){const crumb=document.createElement('i');crumb.className='crumb';crumb.style.left=(localX+(Math.random()*12-6))+'px';crumb.style.top=(localY+(Math.random()*8-4))+'px';crumb.style.setProperty('--dx',(Math.random()*65-32)+'px');crumb.style.setProperty('--dy',(28+Math.random()*65)+'px');stage.append(crumb);crumb.addEventListener('animationend',()=>crumb.remove());}}
function showToast(message){const toast=$('toast');toast.textContent=message;toast.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.classList.remove('show'),900);}
stage.addEventListener('contextmenu',e=>e.preventDefault());catImg.addEventListener('contextmenu',e=>e.preventDefault());catImg.addEventListener('dragstart',e=>e.preventDefault());
document.addEventListener('keydown',e=>{if(e.key==='Escape')modal.hidden=true;});

// Scene and appearance controls
const SCENE_KEY='cat-club-scene-v1', THEME_KEY='cat-club-theme-v1';
const sceneSelect=$('sceneSelect'), sceneOptions=$('sceneOptions');
const sceneColorInputs={plainColor:'--plain-scene',wallColor:'--wall-color',stripeColor:'--stripe-color',dotColor:'--dot-color',floorColor:'--floor-color'};
const sceneControlMap={plain:['plainColorControl'],striped:['wallColorControl','stripeColorControl','floorColorControl'],walls:['wallColorControl','floorColorControl'],interior:['wallColorControl','floorColorControl'],polkadot:['wallColorControl','dotColorControl','floorColorControl'],stripedplain:['wallColorControl','stripeColorControl','floorColorControl'],polkadotplain:['wallColorControl','dotColorControl','floorColorControl']};

const NEON_TILES=['#ff1744','#ff6d00','#eeff00','#39ff14','#00e5ff','#7c4dff','#ff00a8'];
const checkerGrid=$('checkerGrid');
function randomNeon(except=''){const choices=NEON_TILES.filter(color=>color!==except);return choices[Math.floor(Math.random()*choices.length)];}
function setDanceTiles(active){
  if(!checkerGrid)return;
  const tiles=[...checkerGrid.children];
  if(!active){tiles.forEach(tile=>clearTimeout(tile._colorTimer));return;}
  if(!tiles.length){for(let i=0;i<40;i++){const tile=document.createElement('i');tile.className='checker-tile';tile.setAttribute('aria-hidden','true');tile.style.setProperty('--tile-color',randomNeon());checkerGrid.append(tile);}}
  [...checkerGrid.children].forEach((tile,index)=>{
    clearTimeout(tile._colorTimer);
    const change=()=>{const next=randomNeon(tile.style.getPropertyValue('--tile-color').trim());tile.style.setProperty('--tile-color',next);tile._colorTimer=setTimeout(change,1400+Math.random()*1100);};
    tile._colorTimer=setTimeout(change,Math.random()*900);
  });
}

function updateScene(){const scene=sceneSelect.value;stage.dataset.scene=scene;setDanceTiles(scene==='dance');$('danceButton').hidden=scene!=='dance';if(scene!=='dance'&&mode==='dance')setMode('dance');sceneOptions.hidden=!(sceneControlMap[scene]||[]).length||!$('showSceneColors').checked;sceneOptions.classList.toggle('colors-hidden',!$('showSceneColors').checked);for(const id of ['plainColorControl','wallColorControl','stripeColorControl','dotColorControl','floorColorControl'])$(id).hidden=!(sceneControlMap[scene]||[]).includes(id);try{localStorage.setItem(SCENE_KEY,scene);}catch{}}
try{const savedScene=localStorage.getItem(SCENE_KEY);if(savedScene&&[...sceneSelect.options].some(o=>o.value===savedScene))sceneSelect.value=savedScene;}catch{}
for(const [id,variable] of Object.entries(sceneColorInputs)){const input=$(id);try{const saved=localStorage.getItem('cat-club-'+id);if(saved)input.value=saved;}catch{}stage.style.setProperty(variable,input.value);input.addEventListener('input',()=>{stage.style.setProperty(variable,input.value);try{localStorage.setItem('cat-club-'+id,input.value);}catch{}});}
sceneSelect.addEventListener('change',updateScene);$('showSceneColors').addEventListener('change',()=>{const hasColors=(sceneControlMap[sceneSelect.value]||[]).length>0;sceneOptions.classList.toggle('colors-hidden',!$('showSceneColors').checked);sceneOptions.hidden=!hasColors||!$('showSceneColors').checked;try{localStorage.setItem('cat-club-show-scene-colors',$('showSceneColors').checked?'true':'false');}catch{}});$('showSceneColors').checked=localStorage.getItem('cat-club-show-scene-colors')!=='false';updateScene();
const themeToggle=$('themeToggle');function setTheme(dark){document.body.classList.toggle('dark-theme',dark);themeToggle.textContent=dark?'☀':'☾';themeToggle.setAttribute('aria-label',dark?'Switch to light mode':'Switch to dark mode');try{localStorage.setItem(THEME_KEY,dark?'dark':'light');}catch{}}
let darkTheme=false;try{darkTheme=localStorage.getItem(THEME_KEY)==='dark';}catch{}setTheme(darkTheme);themeToggle.addEventListener('click',()=>setTheme(!document.body.classList.contains('dark-theme')));

renderFoods();buildCatPicker();setSelectedCat(selectedCat);