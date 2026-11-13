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
const tmp=path.resolve(process.argv[2]||path.join(root,'19-配套代码','preview'));
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

// Figure 19-1: an optional speculative-generation path, after mandatory prerequisites.
const a=new Figure('19-护栏执行与并行检查',1530,'护栏执行链与并行检查前提','先满足授权、数据处理与目标约束，再按策略选择并行输入检查和模型推理。输出留在缓冲区，输入允许、输出检查与顺序条件共同控制交付。任一强制条件拒绝或超时，停止交付并传播取消。取消不保证上游立即停算。');
a.text(40,58,'护栏执行：先满足前置条件，再选择并行',38,C.ink,600);
a.text(40,108,'图示为阻断式策略；并行路径必须事先获准。',30,C.muted);
a.node(80,180,820,200,'01  前置条件',['调用授权、数据处理与实际目标约束','生成模型与远程审核服务均需满足条件'],C.blue,C.blueBg);
a.node(1050,200,300,160,'拒绝派发',['条件未满足','不调用生成模型'],C.red,C.redBg);
a.text(975,250,'失败',30,C.red,500,'middle');
a.line([[900,280],[1050,280]],C.red);
// One shared stem, two distinct branches; no duplicated overlapping paths.
a.line([[490,380],[490,430]],C.blue,{arrow:false});
a.line([[490,430],[340,430],[340,540]],C.blue);
a.line([[490,430],[1060,430],[1060,540]],C.blue);
a.text(780,410,'允许提前推理，才进入并行路径',30,C.blue,500,'middle');
a.node(80,540,520,200,'02a  剩余输入检查',['仅限允许与推理并行的项','产生允许、拒绝或未知结果'],C.blue,C.blueBg);
a.node(800,540,520,200,'02b  推理与输出检查',['生成结果保留在缓冲区','输出需满足对应交付条件'],C.purple,C.purpleBg);
a.line([[340,740],[340,900]],C.blue);
a.text(390,825,'输入判断',30,C.blue,500);
a.line([[1060,740],[1060,900]],C.purple);
a.text(1110,825,'输出判断',30,C.purple,500);
a.node(80,900,1240,200,'03  共同放行条件',['输入检查允许，待交付内容满足输出检查','按协议与顺序放行；结果未知不视为通过'],C.teal,C.tealBg);
a.line([[340,1100],[340,1220]],C.teal);
a.text(390,1170,'全部满足',30,C.teal,500);
a.line([[1060,1100],[1060,1220]],C.red);
a.text(1110,1170,'拒绝 / 超时',30,C.red,500);
a.node(80,1220,520,200,'交付下游',['仅发送已批准的连续前缀','工具执行仍需独立获准'],C.teal,C.tealBg);
a.node(800,1220,520,200,'停止交付并传播取消',['丢弃尚未发送的缓冲内容','取消不保证上游立即停算'],C.red,C.redBg);
a.text(40,1480,'并行可以隐藏部分等待；不撤回已发送的数据，也不消除提前调用的开销。',30,C.muted);
await a.save();

function chip(f,x,y,w,label,fill=C.blueBg,color=C.blue){
 f.rect(x,y,w,46,fill,color,7,true);
 f.text(x+w/2,y+33,label,30,color,500,'middle');
}
function timeRows(f,y){
 f.text(80,y+112,'生成',30,C.muted,500);
 f.text(80,y+172,'审查',30,C.muted,500);
 f.text(80,y+232,'交付',30,C.muted,500);
 f.text(1250,y+62,'时间 →',30,C.muted,400,'end');
 for(const [i,x] of [300,430,560].entries())chip(f,x,y+80,120,['A','B','C'][i],C.pale,C.muted);
}

// Figure 19-2: redraw the existing illustration, keeping its original article position.
const b=new Figure('19-流式审查',1600,'流式审查：检测方式与交付策略','三行分别对比全量缓冲、分段检查后交付、直接交付并旁路检测。各行时间向右，只表示先后不表示实际耗时。底部把批量或分段检测与增量检测列为独立选择，流式检测器可与缓冲策略组合，不能保证首个违规 Token 即被识别。');
b.text(40,58,'流式审查：检测方式与交付策略分别选择',38,C.ink,600);
b.text(40,108,'时间向右；A、B、C 等为有序内容段，距离不代表实际耗时。',30,C.muted);
b.panel(150,340,'01','全量缓冲后交付',C.blue,C.blueBg);
timeRows(b,150);
chip(b,710,290,220,'检查 A–C','#FFF',C.purple);
chip(b,960,350,340,'A → B → C',C.tealBg,C.teal);
b.text(80,460,'完整生成且检查通过后才开始交付；可以一次返回，也可以分块发送。',30,C.muted);
b.panel(520,340,'02','分段检查后交付',C.teal,C.tealBg);
timeRows(b,520);
for(const v of [{x:440,t:'检 A',dx:580,d:'A'},{x:690,t:'检 B',dx:830,d:'B'},{x:940,t:'检 C',dx:1080,d:'C'}]){
 chip(b,v.x,660,120,v.t,'#FFF',C.purple);
 chip(b,v.dx,720,100,v.d,C.tealBg,C.teal);
}
b.text(80,830,'分段通过后按序发送；跨段含义仍需上下文判断。',30,C.muted);
b.panel(890,340,'03','直接交付，旁路检测',C.red,C.redBg);
timeRows(b,890);
chip(b,690,970,120,'D',C.pale,C.muted);
chip(b,440,1030,520,'旁路检测 → 发现问题','#FFF',C.purple);
for(const [i,x] of [440,570,700,830].entries())chip(b,x,1090,90,['A','B','C','D'][i],C.tealBg,C.teal);
b.rect(988,1086,4,54,C.red,C.red,0);
b.text(1050,1123,'停止后续',30,C.red,600);
b.text(80,1200,'展示可以隐藏；已经交付的内容无法真正收回。',30,C.muted);
b.rect(40,1270,1320,240,C.purpleBg);
b.text(80,1332,'另一维度：选择检测技术',34,C.purple,600);
b.node(80,1360,560,125,'批量 / 分段检测',['规则、分类模型、大模型评审'],C.purple);
b.node(760,1360,560,125,'增量检测',['流式模型持续更新判断'],C.purple);
b.text(40,1560,'流式检测不保证首个违规 Token 即被识别；检测效果与开销均需实测。',30,C.muted);
await b.save();

// Figure 19-3: a snapshot plus two outcomes; separate branches never cross.
const c=new Figure('19-流式缓冲与放行边界',1620,'流式缓冲与放行边界','同一有序输出通道中，A 已通过且发送，B 等待检查，C 的检查已允许但仍不能越过 B。B 允许且上下文等条件满足才按序交付 B、C；B 拒绝或按强制策略超时则停止交付并取消。尾段要检查，正常结束不能倾倒未经批准的缓冲，容量与时限均有界。');
c.text(40,58,'流式放行：只发送满足条件的连续前缀',38,C.ink,600);
c.text(40,108,'以同一有序输出通道为例；检查完成顺序可以不同于生成顺序。',30,C.muted);
c.panel(150,410,'01','当前状态：A 已发送，B 等待，C 检查先返回',C.blue,C.blueBg);
c.node(80,250,380,190,'A  已通过',['已发送到下游','不在待发缓冲区'],C.teal,C.tealBg);
c.node(510,250,380,190,'B  等待检查',['保留在缓冲区','放行边界在此之前'],C.blue,'#FFF');
c.node(940,250,380,190,'C  检查已允许',['仍保留在缓冲区','不得越过 B 提前发送'],C.purple,C.purpleBg);
c.text(80,510,'当前已交付 A；B、C 仍受顺序与上下文条件约束。',30,C.muted);
c.panel(600,630,'02','B 的结果决定后续如何处理',C.teal,C.pale);
c.node(500,700,400,90,'B 返回检查结果',[],C.blue,'#FFF');
c.line([[700,790],[700,830]],C.blue,{arrow:false});
c.line([[700,830],[340,830],[340,900]],C.teal);
c.line([[700,830],[1060,830],[1060,900]],C.red);
c.text(390,875,'允许',30,C.teal,500);
c.text(1110,875,'拒绝 / 超时',30,C.red,500);
c.node(80,900,520,210,'满足条件后按序交付',['B → C','必要的上下文复核先完成','不得超过批准的连续前缀'],C.teal,C.tealBg);
c.node(800,900,520,210,'停止后续交付',['B、C 不再发送','传播取消并清理任务','按协议表达拒绝或中断'],C.red,C.redBg);
c.text(80,1180,'图中超时按强制阻断策略处理；不能用放行缓冲来恢复服务。',30,C.muted);
c.panel(1270,250,'03','完成与容量也有边界',C.purple,C.purpleBg);
c.text(80,1390,'尾段通过必需检查后再正常结束；结束事件不触发未经批准的放行。',30,C.muted);
c.text(80,1450,'限制缓冲、并发与总时限；客户端断开后清理状态与后台任务。',30,C.muted);
c.text(40,1580,'“通过”仅代表当前策略判断；后续上下文仍可能揭示新的风险。',30,C.muted);
await c.save();

