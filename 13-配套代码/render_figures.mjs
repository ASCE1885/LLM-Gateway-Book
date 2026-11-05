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
const tmp=path.resolve(process.argv[2]||path.join(root,'13-配套代码','preview'));
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
const a=new Figure('13-重试风暴',1570,'两层重试的尝试次数放大','一次业务调用经应用 SDK 最多到达网关三次，每个网关请求又最多向上游尝试三次，两层都耗尽次数时合计最多九次。这里不包含额外的出站 SDK 重试层。次数上限不是 QPS 倍数。');
a.text(40,58,'两层重试：一次业务调用，最多九次尝试',38,C.ink,600);
a.text(40,108,'示例：应用 SDK 与网关各允许重试 2 次，即每层最多尝试 3 次。',30,C.muted);
a.panel(146,780,'01','两层都耗尽次数时，尝试数相乘',C.blue,C.blueBg);
a.text(700,246,'SDK → 网关',30,C.blue,600,'middle');
a.text(1180,246,'网关 → 上游',30,C.blue,600,'middle');
a.node(80,476,300,168,'业务调用',['1 次'],C.blue);
for(const [i,y] of [[1,276],[2,496],[3,716]]){
 a.node(550,y,300,128,`网关请求 ${i}`,['应用 SDK 派发'],C.blue);
 a.node(1040,y,280,128,'最多 3 次',['上游尝试'],C.teal);
 a.line([[850,y+64],[1040,y+64]],C.teal);
}
a.line([[380,514],[440,514],[440,340],[550,340]],C.blue);
a.line([[380,560],[550,560]],C.blue);
a.line([[380,606],[440,606],[440,780],[550,780]],C.blue);
a.text(80,893,'图中只有两层重试；网关出站 SDK 若再重试，需要另外计入。',30,C.muted);
a.rect(40,966,1320,136,C.tealBg);
a.text(700,1018,'1 次业务调用 × 3 × 3 ＝ 最多 9 次上游尝试',36,C.teal,600,'middle');
a.text(700,1068,'条件：错误持续可重试，且未被取消、时限、限流或熔断提前终止。',30,C.muted,400,'middle');
a.panel(1142,340,'02','控制放大，需要同时约束三个方面',C.purple,C.purpleBg);
a.node(80,1264,360,170,'责任层',['协调隐含 SDK 重试','区分调用与任务恢复'],C.purple);
a.node(520,1264,360,170,'共享预算',['次数、总时限、额外量','切换目标不重置'],C.purple);
a.node(960,1264,360,170,'执行资格',['重放、交付与目标约束','每次调用重新准入'],C.purple);
a.text(40,1530,'次数上限不等于 QPS 倍数：退避和超时改变时间，保护机制会截断路径。',30,C.muted);
await a.save();

const b=new Figure('13-熔断状态与恢复',1400,'熔断的三种状态与受控恢复','关闭时统计符合条件的尝试结果，满足失败阈值后打开并阻止新调用。冷却后进入半开，限制探测数量，失败重新打开，成功条件满足后恢复资格并逐步放量。状态范围、探测并发和多实例协调均需明确。');
b.text(40,58,'熔断：隔离故障，再用有限探测验证恢复',38,C.ink,600);
b.text(40,108,'状态按已识别的故障范围维护；打开不会自动取消原有在途请求。',30,C.muted);
b.panel(146,720,'01','三种状态，四条明确的转换路径',C.blue,C.blueBg);
b.node(80,386,300,170,'关闭 Closed',['允许业务调用','统计已归因的结果'],C.blue);
b.node(550,386,300,170,'打开 Open',['阻止新业务调用','原在途请求另行处理'],C.purple);
b.node(1040,386,280,170,'半开 Half-open',['限量发起探测','按成功条件判定'],C.teal);
b.line([[380,471],[550,471]],C.blue);b.text(465,355,'失败达阈值',30,C.blue,500,'middle');
b.line([[850,471],[1040,471]],C.purple);b.text(945,355,'冷却到期',30,C.purple,500,'middle');
b.line([[1180,386],[1180,280],[230,280],[230,386]],C.teal);
b.text(700,256,'成功条件满足：恢复资格，再逐步放量',30,C.teal,500,'middle');
b.line([[1180,556],[1180,666],[700,666],[700,556]],C.purple);
b.text(940,714,'探测失败或超时：重新打开',30,C.purple,500,'middle');
b.text(80,778,'冷却到期不代表健康；零探测不能视为成功。',30,C.muted);
b.text(80,824,'探测应检查调用的协议完成状态，不能只看 HTTP 200 或首 Token。',30,C.muted);
b.panel(906,388,'02','状态之外，还要约束范围、数量与结果',C.teal,C.tealBg);
b.node(80,1028,360,170,'统计口径',['时间窗口与最少样本','错误分类与排除项'],C.teal);
b.node(520,1028,360,170,'探测额度',['限制总并发与超时','多实例协调同一上限'],C.teal);
b.node(960,1028,360,170,'结果与放量',['结果绑定恢复轮次','旧结果不得误关熔断'],C.teal);
b.text(80,1256,'配额或凭证问题按自身机制处理，不强行套用部署熔断。',30,C.muted);
b.text(40,1360,'图示为通用设计；冷却机制不自动包含半开探测和渐进恢复。',30,C.muted);
await b.save();

const c=new Figure('13-Fallback资格与停止条件',1490,'Fallback 的执行资格、目标资格与停止条件','先确认请求仍有效、允许安全重放且能保留交付契约，再筛选满足区域、账户、能力、状态和输出要求的目标。每次尝试共用原请求预算，没有合格目标或预算不足时明确停止；降级和异步处理需预先约定。');
c.text(40,58,'Fallback：先筛资格，再按共享预算尝试',38,C.ink,600);
c.text(40,108,'顺序偏好不等于降级授权；没有合格路径时，明确失败也是结果。',30,C.muted);
c.panel(146,390,'01','本次请求是否仍允许继续执行',C.blue,C.blueBg);
c.node(80,268,300,170,'请求仍有效',['未取消、仍有时间','仍有继续执行的必要'],C.blue);
c.node(550,268,300,170,'允许安全重放',['检查状态与副作用','结果未知先核对'],C.blue);
c.node(1040,268,280,170,'保留交付契约',['响应头不能改写','输出后不透明切换'],C.blue);
c.line([[380,353],[550,353]],C.blue);c.line([[850,353],[1040,353]],C.blue);
c.text(80,495,'任一条件不满足：停止该执行路径，按协议失败或交由应用恢复。',30,C.muted);
c.panel(576,610,'02','筛选合格目标，每次派发前复查预算',C.teal,C.tealBg);
c.rect(80,698,740,170,'#FFF',C.line,12,true);
c.text(450,746,'合格候选集合',34,C.teal,600,'middle');
c.text(450,794,'区域 / 账户 / 能力 / 状态 / 输出契约',30,C.muted,400,'middle');
c.text(450,836,'Embedding 与索引兼容配置一致',30,C.muted,400,'middle');
c.node(1040,698,280,170,'再次检查预算',['次数 / 时间 / 额度','全部通过才派发'],C.teal);
c.line([[820,783],[1040,783]],C.teal);
c.node(80,948,740,170,'无候选或预算不足',['明确失败；获准时才降级或异步处理'],C.purple);
c.node(1040,948,280,170,'一次上游尝试',['记录结果与用量'],C.teal);
c.line([[450,868],[450,948]],C.purple);c.text(320,918,'无合格目标',30,C.purple,500,'middle');
c.line([[1180,868],[1180,948]],C.teal);c.text(1260,918,'满足',30,C.teal,500,'middle');
c.line([[1040,829],[920,829],[920,1033],[820,1033]],C.purple);c.text(888,930,'不足',30,C.purple,500,'end');
c.text(80,1156,'失败后再试：重新检查以上条件，沿用原预算，不重置、不循环。',30,C.muted);
c.rect(40,1226,1320,190,C.pale);
c.text(76,1278,'候选需要经过验证，结束方式需要符合契约',34,C.ink,600);
c.text(76,1330,'同名模型不保证状态兼容；同档次模型不保证业务质量相当。',30,C.muted);
c.text(76,1378,'降级与异步兜底需要事先约定，不能伪装成原请求已成功。',30,C.muted);
c.text(40,1460,'每次尝试都要计入总消耗；已交付的业务输出不能被静默替换。',30,C.muted);
await c.save();
