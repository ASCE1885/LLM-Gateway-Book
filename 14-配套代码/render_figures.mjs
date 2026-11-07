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
const tmp=path.resolve(process.argv[2]||path.join(root,'14-配套代码','preview'));
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

const a=new Figure('14-超时预算',1490,'分阶段超时与共享总预算','同一入口时间轴上的预算示例：准备一秒，主尝试十秒，切换一秒，备用首内容等待一点五秒，生成三十秒，四十三点五秒完成。五十八秒为工作截止点，六十秒为总截止点。所有数值仅为示意。');
a.text(40,58,'超时预算：所有尝试，共用一个截止时间',38,C.ink,600);
a.text(40,108,'示例总预算 60 s；准备、等待、切换和生成均计入同一时间轴。',30,C.muted);
a.panel(146,800,'01','时间经过多少，剩余预算就减少多少',C.blue,C.blueBg);
const xa=t=>300+16*t;
a.rect(xa(0),252,960,52,'#FFF',C.line,8);
a.rect(xa(58),252,32,52,C.purpleBg,C.purple,0);
a.text(780,288,'原请求总预算：60 s',30,C.blue,600,'middle');
rule(a,xa(58),318,xa(58),770,C.purple,true);
rule(a,xa(60),318,xa(60),770,C.purple,false);
const rows=[
 {label:'准备 1 s',start:0,end:1,y:326,color:C.muted,note:'1 s：准备完成，开始主尝试'},
 {label:'主尝试 10 s',start:1,end:11,y:421,color:C.red,note:'11 s：达到首内容等待上限'},
 {label:'切换 1 s',start:11,end:12,y:516,color:C.purple,note:'12 s：通过检查，派发备用'},
 {label:'首内容 1.5 s',start:12,end:13.5,y:611,color:C.amber,note:'13.5 s：备用首内容到达'},
 {label:'生成 30 s',start:13.5,end:43.5,y:706,color:C.teal,note:'43.5 s 完成'}
];
for(const r of rows){
 a.text(80,r.y+31,r.label,30,C.ink,500);
 a.rect(xa(r.start),r.y,xa(r.end)-xa(r.start),40,r.color,r.color,3);
 a.text(xa(r.end)+24,r.y+31,r.note,30,r.color,500);
}
rule(a,xa(0),796,xa(60),796,C.muted);
for(const t of [0,15,30,45,60]){rule(a,xa(t),796,xa(t),808,C.muted);a.text(xa(t),850,`${t} s`,30,C.muted,400,'middle');}
a.text(80,908,'最晚工作截止点 58 s；预留 2 s 交付。正常完成可提前返回。',30,C.muted);
a.panel(986,390,'02','局部期限可以重叠，总截止点始终有效',C.teal,C.tealBg);
a.node(80,1108,600,170,'局部期限',['首内容等待可包含连接与上传','进度计时只由约定的有效进展更新'],C.teal);
a.node(720,1108,600,170,'全程期限',['准备、排队、退避与切换均计时','每次派发与等待都检查剩余预算'],C.teal);
a.text(80,1338,'切换还需通过重放、交付、目标和资源检查，不能只看剩余时间。',30,C.muted);
a.text(40,1438,'图中数值仅作教学示例，不代表性能或远端取消完成时间。',30,C.muted);
await a.save();

const b=new Figure('14-三类计时器',1440,'读取空闲、业务进度与总截止时间','同一网关观测点上，二秒收到首内容，四秒和六秒收到心跳，读取空闲阈值三秒未触发。业务进度阈值六秒从二秒起算，在八秒触发停止；原定十二秒总截止点保持不变，不代表仍继续执行。');
b.text(40,58,'三类计时器：有数据，不一定有业务进展',38,C.ink,600);
b.text(40,108,'同一网关观测点：首内容在 2 s 到达，之后只有心跳。',30,C.muted);
b.panel(146,850,'01','心跳只影响相应的读取等待，不延长业务期限',C.blue,C.blueBg);
const xb=t=>340+(920/12)*t;
b.text(80,352,'收到的事件',30,C.ink,500);
rule(b,xb(0),340,xb(8),340,C.line);
for(const [t,label,color] of [[2,'内容',C.teal],[4,'心跳',C.blue],[6,'心跳',C.blue]]){
 b.rect(xb(t)-10,330,20,20,color,color,3);
 b.text(xb(t),302,label,30,color,600,'middle');
 b.text(xb(t),394,`${t} s`,30,C.muted,400,'middle');
}
b.text(80,482,'读空闲 3 s',30,C.ink,500);
for(const [s,e] of [[0,2],[2,4],[4,6],[6,8]]){
 b.rect(xb(s)+3,450,xb(e)-xb(s)-6,42,'#FFF',C.blue,6);
 b.text((xb(s)+xb(e))/2,482,'2 s',30,C.blue,500,'middle');
}
b.text(1060,482,'未触发',30,C.blue,600);
b.text(340,544,'截至终止时，读取等待均小于 3 s；心跳到达可重新计时。',30,C.muted);
b.text(80,650,'进度 6 s',30,C.ink,500);
b.rect(xb(2),612,xb(8)-xb(2),46,C.redBg,C.red,6);
b.text((xb(2)+xb(8))/2,646,'连续 6 s 无业务增量',30,C.red,600,'middle');
rule(b,xb(8),594,xb(8),680,C.red,false,4);
b.text(990,646,'8 s：触发',30,C.red,600);
b.text(340,710,'只有有效业务进展更新此期限；心跳不更新。',30,C.muted);
b.text(80,814,'总时限 12 s',30,C.ink,500);
b.rect(xb(0),778,xb(8)-xb(0),50,C.purpleBg,C.purple,6);
b.text((xb(0)+xb(8))/2,814,'原定总截止点不变',30,C.purple,600,'middle');
rule(b,xb(8)+10,803,xb(12),803,C.purple,true);
rule(b,xb(12),778,xb(12),828,C.purple,false,3);
rule(b,xb(0),880,xb(12),880,C.muted);
for(const t of [0,2,4,6,8,10,12]){rule(b,xb(t),880,xb(t),890,C.muted);b.text(xb(t),931,`${t} s`,30,C.muted,400,'middle');}
b.text(80,976,'8 s 触发终止；虚线仅示原定 12 s 截止点，不表示继续等待。',30,C.muted);
b.panel(1036,300,'02','分别维护计时状态，先到的有效期限触发处理',C.teal,C.tealBg);
b.node(80,1158,360,128,'收到数据',['检查读取等待'],C.blue);
b.node(520,1158,360,128,'有效进展',['更新业务计时'],C.teal);
b.node(960,1158,360,128,'总时间',['保持原截止点'],C.purple);
b.text(40,1394,'心跳须实际到达所观察的连接段；下游心跳不证明上游有进展。',30,C.muted);
await b.save();

const c=new Figure('14-取消传播与清理',1630,'取消传播、本地清理与远端终态核对','取消信号从客户端传至网关、上游服务和推理引擎。网关停止新派发、取消对应请求流并清理本地资源；远端终态仅在可得时确认。独立后台任务的连接和任务生命周期分开，未知用量继续核对。');
c.text(40,58,'取消传播：发出信号，还要核对停止结果',38,C.ink,600);
c.text(40,108,'同步请求提前终止示意；向右为取消传播，虚线向左为状态报告。',30,C.muted);
c.panel(146,970,'01','本地清理与远端终态，分别记录',C.blue,C.blueBg);
const cols=[{x:70,cx:200,title:'客户端',sub:'发起停止'},{x:410,cx:540,title:'网关',sub:'管理请求与尝试'},{x:750,cx:880,title:'上游服务',sub:'识别目标任务'},{x:1090,cx:1220,title:'推理引擎',sub:'执行与资源回收'}];
for(const col of cols){c.node(col.x,246,260,128,col.title,[col.sub],C.blue);rule(c,col.cx,406,col.cx,1030,C.line,true);}
c.text(370,440,'停止 / 断开',30,C.blue,500,'middle');
c.line([[200,470],[540,470]],C.blue);
c.node(410,518,260,128,'标记终止',['停止相应新工作'],C.purple);
c.text(710,685,'取消请求流',30,C.blue,500,'middle');
c.line([[540,710],[880,710]],C.blue);
c.node(410,756,260,128,'本地清理',['读写、缓冲、槽位'],C.purple);
c.text(1050,785,'传播任务取消',30,C.blue,500,'middle');
c.line([[880,810],[1220,810]],C.blue);
c.text(1050,875,'确认终态（若可得）',30,C.teal,500,'middle');
c.line([[1220,905],[880,905]],C.teal,{dash:true});
c.text(710,965,'报告已知状态',30,C.teal,500,'middle');
c.line([[880,995],[540,995]],C.teal,{dash:true});
c.text(80,1080,'引擎链路以自建服务为例；托管服务按接口语义观察和确认。',30,C.muted);
c.panel(1156,370,'02','任务生命周期不同，取消规则也不同',C.teal,C.tealBg);
c.node(80,1278,600,200,'同步请求',['提前终止时传播取消','本地清理不证明远端已立即停止','最终用量缺失时保留未知'],C.teal);
c.node(720,1278,600,200,'独立后台任务',['读取连接与任务生命周期分开','按应用契约调用任务取消接口','暂时断流可以允许任务继续'],C.teal);
c.text(40,1580,'取消单个请求流，不关闭共享连接；停止与计费结果需要分别核对。',30,C.muted);
await c.save();
