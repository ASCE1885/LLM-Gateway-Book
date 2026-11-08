import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const modules=process.env.DIAGRAM_NODE_MODULES;
const getModule=name=>require(modules?path.join(modules,name):name);
const sharp=getModule('sharp');
const {createCanvas}=getModule('@napi-rs/canvas');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp=path.resolve(process.argv[2]||path.join(root,'15-配套代码','preview'));
fs.mkdirSync(tmp,{recursive:true});
fs.mkdirSync(path.join(root,'配图/源文件'),{recursive:true});
const C={ink:'#203348',muted:'#526477',blue:'#2E638C',teal:'#287F78',purple:'#705C97',amber:'#996B2E',red:'#9A5656',line:'#D6DFE8',pale:'#F7F9FB',blueBg:'#EAF2F8',tealBg:'#E9F4F0',purpleBg:'#F0ECF6',redBg:'#F8EFEF'};
const font=process.env.DIAGRAM_FONT||'Hiragino Sans GB';
const ctx=createCanvas(10,10).getContext('2d');
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
class Figure {
 constructor(name,h,title,desc){this.name=name;this.h=h;this.parts=[];this.texts=[];this.nodes=[];this.paths=[];this.title=title;this.desc=desc;}
 rect(x,y,w,h,fill=C.pale,stroke=C.line,r=14,node=false){this.parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`);if(node)this.nodes.push({x,y,w,h});}
 text(x,y,s,size=30,color=C.ink,weight=400,anchor='start') {ctx.font=`${weight} ${size}px "${font}"`;const m=ctx.measureText(s);let left=x-(anchor==='middle'?m.width/2:anchor==='end'?m.width:0);this.texts.push({s,x:left,y:y-m.actualBoundingBoxAscent,w:m.width,h:m.actualBoundingBoxAscent+m.actualBoundingBoxDescent,size});this.parts.push(`<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${color}" text-anchor="${anchor}">${esc(s)}</text>`);}
 line(pts,color=C.blue,{dash=false,both=false,arrow=true}={}){this.paths.push({pts});this.parts.push(`<path d="${pts.map((p,i)=>(i?'L':'M')+' '+p.join(' ')).join(' ')}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"${dash?' stroke-dasharray="10 8"':''}/>`);const head=(a,b)=>{const dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy),ux=dx/len,uy=dy/len;const q1=[b[0]-ux*11-uy*6,b[1]-uy*11+ux*6],q2=[b[0]-ux*11+uy*6,b[1]-uy*11-ux*6];this.parts.push(`<path d="M ${q1.join(' ')} L ${b.join(' ')} L ${q2.join(' ')}" fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="round"/>`);};if(arrow){head(pts.at(-2),pts.at(-1));if(both)head(pts[1],pts[0]);}}
 node(x,y,w,h,title,sub=[],color=C.blue,fill='#FFF'){this.rect(x,y,w,h,fill,C.line,12,true);this.text(x+w/2,y+48,title,34,color,600,'middle');sub.forEach((s,i)=>this.text(x+w/2,y+96+i*42,s,30,C.muted,400,'middle'));}
 panel(y,h,n,title,color,bg){this.rect(40,y,1320,h,bg);this.rect(70,y+28,50,45,'#FFF',color,8);this.text(95,y+61,n,30,color,600,'middle');this.text(144,y+62,title,34,color,600);}
 async save(){const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="150mm" height="${150*this.h/1400}mm" viewBox="0 0 1400 ${this.h}" role="img" aria-labelledby="title desc"><title id="title">${esc(this.title)}</title><desc id="desc">${esc(this.desc)}</desc><metadata>Editable book figure. Reference width 150 mm; minimum text 30 units, approximately 9.1 pt. PNG 300 dpi. Grayscale-readable labels. No external assets.</metadata><rect width="1400" height="${this.h}" fill="#FFF"/><g font-family="'${font}','PingFang SC','Microsoft YaHei',sans-serif">${this.parts.join('\n')}</g></svg>`;fs.writeFileSync(path.join(root,'配图/源文件',this.name+'.svg'),svg);const px=Math.round(150/25.4*300);const raster=await sharp(Buffer.from(svg),{density:300}).resize({width:px}).png().withMetadata({density:300}).toBuffer();fs.writeFileSync(path.join(root,'配图',this.name+'.png'),raster);await sharp(raster).resize({width:1050}).toFile(path.join(tmp,this.name+'-color.png'));await sharp(raster).greyscale().resize({width:1050}).toFile(path.join(tmp,this.name+'-gray.png'));fs.writeFileSync(path.join(tmp,this.name+'-geometry.json'),JSON.stringify({w:1400,h:this.h,texts:this.texts,nodes:this.nodes,paths:this.paths},null,2));console.log(JSON.stringify({figure:this.name,pixels:[px,Math.round(px*this.h/1400)],textCount:this.texts.length,minPt:30*150/1400*72/25.4}));}
}

// Axes, gridlines and lifelines are guides, not flow connectors.
function rule(f,x1,y1,x2,y2,color=C.line,dash=false,width=2){f.parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${width}"${dash?' stroke-dasharray="8 8"':''}/>`);}

// Figure 15-1: retrieval yields candidates; reuse requires separate validation.
const a=new Figure('15-语义缓存复用条件',1690,'语义缓存的候选检索与复用条件','先限定授权与业务范围，再检索相似候选。没有候选，或实体、时间、版本、上下文、输出约定、当前权限中任一条件不符或无法确认，都进入正常调用；全部满足才复用有效结果。');
a.text(40,58,'语义缓存：找到相似问题，还要核对能否复用',38,C.ink,600);
a.text(40,108,'向量检索提供候选；不确定是否适用时，按未命中处理。',30,C.muted);
a.panel(146,1150,'01','先限定范围，再逐项检查',C.blue,C.blueBg);
a.node(80,252,720,128,'限定可访问范围',['权限、任务、上下文与数据版本'],C.blue);
a.line([[440,380],[440,450]],C.blue);
a.node(80,450,720,128,'检索相似候选',['仅在允许范围内进行向量检索'],C.blue);
a.node(1020,450,300,128,'未命中',['正常调用模型'],C.muted);
a.text(910,490,'无候选',30,C.muted,500,'middle');
a.line([[800,514],[1020,514]],C.muted);
a.line([[440,578],[440,648]],C.blue);
a.text(480,624,'有候选',30,C.blue,500);
a.node(80,648,720,252,'核对复用条件',['实体与操作方向一致','时间、数据版本与上下文有效','输出约定满足，当前权限仍有效'],C.purple);
a.node(1020,712,300,170,'未通过',['条件不符或不确定','正常调用模型'],C.muted);
a.text(910,773,'不通过',30,C.muted,500,'middle');
a.line([[800,797],[1020,797]],C.muted);
a.line([[440,900],[440,1000]],C.teal);
a.text(480,962,'全部通过',30,C.teal,500);
a.node(80,1000,720,170,'复用有效结果',['保留来源，按当前协议返回','按本次缓存命中记录计量'],C.teal);
a.text(80,1250,'相似度分数用于筛选候选，不是答案正确的概率。',30,C.muted);
a.panel(1336,260,'02','困难负例：表述接近，答案却不能共用',C.teal,C.tealBg);
a.node(80,1440,600,128,'开通会员 ≠ 取消会员',['操作方向不同'],C.teal);
a.node(720,1440,600,128,'北京天气 ≠ 上海天气',['关键实体不同'],C.teal);
a.text(40,1648,'未命中后调用模型，仍须通过当前权限、预算和资源准入检查。',30,C.muted);
await a.save();

// Figure 15-2: the diagrams compare complete prefixes, not independent blocks.
const b=new Figure('15-前缀复用边界',1620,'稳定前缀与动态内容的复用边界','第一组请求共享稳定的指令、工具与参考材料，只改变末尾问题；第二组在参考材料之前插入变化的时间或请求编号，共同前缀缩短。示意匹配范围，不保证实际缓存命中，块宽不代表 Token 数。');
b.text(40,58,'提示词缓存：从起点连续匹配共同前缀',38,C.ink,600);
b.text(40,108,'按模型实际处理顺序示意；框内文字仅表示内容类别。',30,C.muted);
b.panel(146,480,'01','稳定内容在前：共同前缀较长',C.blue,C.blueBg);
for(const [y,label,q] of [[280,'请求 A','问题 A'],[420,'请求 B','问题 B']]){
 b.text(80,y+48,label,30,C.ink,500);
 b.rect(250,y,660,74,'#FFF',C.blue,10,true);
 b.text(580,y+48,'相同的指令、工具与参考材料',30,C.blue,500,'middle');
 b.rect(930,y,390,74,'#FFF',C.amber,10,true);
 b.text(1125,y+48,q,30,C.amber,500,'middle');
}
rule(b,920,260,920,514,C.muted,true);
rule(b,250,526,250,542,C.blue);rule(b,250,542,910,542,C.blue);rule(b,910,526,910,542,C.blue);
b.text(580,586,'可匹配的共同前缀',30,C.blue,600,'middle');
b.text(1125,586,'变化的后缀',30,C.amber,600,'middle');
b.panel(666,480,'02','动态内容提前：共同前缀缩短',C.purple,C.purpleBg);
for(const [y,label,id] of [[800,'请求 A','时间 / ID A'],[940,'请求 B','时间 / ID B']]){
 b.text(80,y+48,label,30,C.ink,500);
 b.rect(250,y,200,74,'#FFF',C.blue,10,true);b.text(350,y+48,'稳定指令',30,C.blue,500,'middle');
 b.rect(470,y,300,74,'#FFF',C.amber,10,true);b.text(620,y+48,id,30,C.amber,500,'middle');
 b.rect(790,y,530,74,'#FFF',C.muted,10,true);b.text(1055,y+48,'相同参考材料',30,C.muted,500,'middle');
}
rule(b,460,780,460,1034,C.muted,true);
rule(b,250,1046,250,1062,C.blue);rule(b,250,1062,450,1062,C.blue);rule(b,450,1046,450,1062,C.blue);
b.text(350,1106,'共同前缀',30,C.blue,600,'middle');
b.text(540,1106,'后面的相同材料不单独构成前缀',30,C.muted);
b.panel(1186,340,'03','能否实际复用，还要满足平台条件',C.teal,C.tealBg);
b.node(80,1300,400,170,'边界与长度',['前缀精确匹配','长度与断点满足规则'],C.teal);
b.node(500,1300,400,170,'状态与范围',['缓存条目仍可用','模型与缓存范围兼容'],C.teal);
b.node(920,1300,400,170,'后续仍需计算',['变化输入仍需处理','新输出仍需生成'],C.teal);
b.text(40,1576,'块宽不代表 Token 数；调整顺序不能改变角色、优先级和业务语义。',30,C.muted);
await b.save();

// Figure 15-3 preserves the original coordination figure's file name and section.
const c=new Figure('15-缓存协同',1690,'三种缓存的查询、返回与写入流程','鉴权后确定结果缓存资格。已授权但不适合复用的请求绕过结果缓存。精确和语义候选均需复核，未通过或未启用则继续正常模型调用。正常调用可受益于前缀缓存，但仍生成输出。完整结果经校验后才按策略写入结果缓存。');
c.text(40,58,'三种缓存协同：有条件返回，有条件写入',38,C.ink,600);
c.text(40,108,'向下为继续处理；分支注明返回、旁路或不写入。',30,C.muted);
c.panel(146,1370,'01','鉴权、查询、生成与写入',C.blue,C.blueBg);
c.node(80,246,700,170,'鉴权与复用资格',['确定权限、结果版本及数据依赖','未授权则拒绝；已授权再判断复用'],C.blue);
c.node(980,246,300,170,'正常调用入口',['仅绕过结果缓存','仍需准入与路由'],C.muted);
c.text(880,306,'绕过',30,C.muted,500,'middle');
c.line([[780,330],[980,330]],C.muted);
c.line([[1280,330],[1330,330],[1330,1095],[780,1095]],C.muted);
c.text(1060,1066,'直接调用模型',30,C.muted,500,'middle');
c.line([[430,416],[430,490]],C.blue);
c.text(470,465,'允许缓存',30,C.blue,500);
c.node(80,490,700,128,'精确查询与复核',['键匹配，且结果仍有效'],C.blue);
c.node(980,490,300,128,'精确命中返回',['记录本次缓存命中'],C.teal);
c.text(880,530,'通过',30,C.teal,500,'middle');
c.line([[780,554],[980,554]],C.teal);
c.line([[430,618],[430,730]],C.blue);
c.text(470,686,'未命中 / 无效',30,C.blue,500);
c.node(80,730,700,170,'按需检索语义候选',['在允许范围内比较','实体、上下文等全部通过才复用'],C.purple);
c.node(980,730,300,170,'语义命中返回',['通过复用检查','记录本次缓存命中'],C.teal);
c.text(880,791,'通过',30,C.teal,500,'middle');
c.line([[780,815],[980,815]],C.teal);
c.line([[430,900],[430,1010]],C.blue);
c.text(470,968,'未通过 / 未启用',30,C.blue,500);
c.node(80,1010,700,170,'正常调用模型',['原截止时间内准入与路由','前缀可能复用，仍生成新输出'],C.blue);
c.line([[430,1180],[430,1270]],C.blue);
c.text(470,1238,'结果到达',30,C.blue,500);
c.node(80,1270,700,210,'结果完成后校验',['完整、有效且允许复用','通过后按策略写入对应缓存','不要求两类结果缓存同时写入'],C.teal);
c.node(980,1270,300,210,'不写普通缓存',['截断或被取消','无效或终态未知','需专用策略的状态'],C.muted);
c.text(880,1351,'未通过',30,C.muted,500,'middle');
c.line([[780,1375],[980,1375]],C.muted);
c.text(40,1590,'图示为缓存控制流程；实际输出可边生成边交付，写入须等待结果校验。',30,C.muted);
c.text(40,1642,'缓存回放仍遵守取消、背压与写入期限；旧结果用量不能重复记为新实耗。',30,C.muted);
await c.save();
