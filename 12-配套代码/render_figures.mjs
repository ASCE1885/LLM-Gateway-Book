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
const tmp=path.resolve(process.argv[2]||path.join(root,'12-配套代码','preview'));
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
const a=new Figure('12-两阶段限流',1340,'Token 额度的预留与结算','先估算并建立预留编号，再派发上游。结束时区分最终用量齐全与未知；相同编号幂等处理。速率退款受时间规则约束，在途计数与用量记录分别收尾。');
a.text(40,58,'Token 额度：先预留，再按用量处理差额',38,C.ink,600);
a.text(40,108,'计量口径与额度范围先确定；一次上游尝试关联一个预留编号。',30,C.muted);
a.panel(146,360,'01','先取得预留，再派发调用',C.blue,C.blueBg);
a.node(80,268,300,170,'估算本次用量',['输入与输出分别估算','明确上限与误差'],C.blue);
a.node(550,268,300,170,'检查并预留',['全部适用额度通过','记录编号与预留量'],C.blue);
a.node(1040,268,280,170,'调用上游',['成功预留后派发','持续观察调用状态'],C.blue);
a.line([[380,353],[550,353]],C.blue);a.line([[850,353],[1040,353]],C.blue);
a.text(80,477,'预留失败则不派发；重复编号不代表可以再次调用上游。',30,C.muted);
a.panel(546,450,'02','调用结束：按用量完整性处理',C.teal,C.tealBg);
a.rect(80,668,580,268,'#FFF',C.line,12,true);
a.text(370,716,'最终用量齐全',34,C.teal,600,'middle');
['核对同一口径的实报值','补扣差额，或释放可退部分','同一结算重复到达，不重复扣退'].forEach((s,i)=>a.text(370,778+i*53,s,30,C.muted,400,'middle'));
a.rect(740,668,580,268,'#FFF',C.line,12,true);
a.text(1030,716,'最终用量未知',34,C.purple,600,'middle');
['保存部分用量、来源与未知状态','不因只收到少量文本就全额退款','后续取得最终用量，再核对处理'].forEach((s,i)=>a.text(1030,778+i*53,s,30,C.muted,400,'middle'));
a.text(80,969,'部分用量不等于最终用量；可见文本不等于全部生成量。',30,C.muted);
a.rect(40,1036,1320,214,C.pale);
a.text(76,1088,'退款遵守时间规则，记录保留实际用量',34,C.ink,600);
a.text(76,1140,'旧扣减已由速率补充恢复时，不能再把同一份额度退入当前桶。',30,C.muted);
a.text(76,1186,'示例只释放仍未恢复的扣减；费用账本按自身口径核对完整差额。',30,C.muted);
a.text(40,1304,'调用结束并清理后释放在途计数；用量记录可以继续等待核对。',30,C.muted);
await a.save();

const b=new Figure('12-令牌桶速率与容量',1440,'令牌桶的速率、容量与大请求','每秒补充 1000，最大容量 10000。余额 2000 时申请 6000，需要等待 4 秒，前提是无其他竞争。申请 15000 超过容量，无法只靠等待解决。准入额度不等于生成速度。');
b.text(40,58,'补充速率与突发容量，是两个独立参数',38,C.ink,600);
b.text(40,108,'以下单位均为本地 Token 计量额度；默认要求完整额度准入。',30,C.muted);
b.panel(146,298,'01','同一速率，可以配置不同的突发容量',C.blue,C.blueBg);
b.rect(80,266,560,136,'#FFF',C.line,12,true);
b.text(360,314,'补充速率 r',32,C.blue,600,'middle');b.text(360,370,'1000 / 秒 ＝ 60000 / 分钟',34,C.ink,500,'middle');
b.rect(760,266,560,136,'#FFF',C.line,12,true);
b.text(1040,314,'桶容量 B',32,C.blue,600,'middle');b.text(1040,370,'10000（可积攒 10 秒额度）',34,C.ink,500,'middle');
b.panel(484,560,'02','暂时缺额可以等，超过容量等不到',C.teal,C.tealBg);
b.node(80,606,300,128,'当前余额 2000',['容量 10000'],C.teal);
b.node(550,606,300,128,'申请 6000',['暂时缺少 4000'],C.teal);
b.node(1040,606,280,128,'可等待 4 秒',['没有其他竞争时'],C.teal);
b.line([[380,670],[550,670]],C.teal);b.line([[850,670],[1040,670]],C.teal);
b.text(80,789,'等待时间 ＝（申请量 − 当前余额）÷ 补充速率',30,C.muted);
b.node(80,844,300,128,'满桶 10000',['等待不会扩大容量'],C.purple);
b.node(550,844,300,128,'申请 15000',['超过单桶容量'],C.purple);
b.node(1040,844,280,128,'等待无法通过',['拒绝或另行规划'],C.purple);
b.line([[380,908],[550,908]],C.purple);b.line([[850,908],[1040,908]],C.purple);
b.text(80,1016,'大请求通道也须遵守全局与上游限制，不能绕开原有约束。',30,C.muted);
b.rect(40,1084,1320,246,C.pale);
b.text(76,1136,'平均速率不等于严格滑动窗口上限',34,C.ink,600);
b.text(76,1190,'标准无退款、无透支令牌桶：T 秒内准入量 ≤ B ＋ rT。',30,C.muted);
b.text(76,1238,'本例满桶开始的 60 秒理论上可准入 70000 单位。',30,C.muted);
b.text(76,1286,'这一上界不直接表示实际生成速度，也不直接覆盖异步结算。',30,C.muted);
b.text(40,1387,'主动透支需要单独设置边界；预估不足的结算欠额应如实记录。',30,C.muted);
await b.save();

const c=new Figure('12-多实例多层级准入',1390,'多个网关实例下的多层级准入','多个实例共享准入状态。按可信上下文选择调用方、应用、团队和上游配额域的全部适用条件，在可原子协调的范围内先检查再扣减。多键同槽和跨分片协调有不同边界。');
c.text(40,58,'多实例共享额度，多层级共同决定准入',38,C.ink,600);
c.text(40,108,'一次调用需要通过全部适用约束；配置条目数不代表独立容量。',30,C.muted);
c.panel(146,360,'01','不同网关实例，访问同一份准入状态',C.blue,C.blueBg);
c.node(80,268,300,170,'网关实例 A',['一次上游尝试','预留编号与上下文'],C.blue);
c.node(550,268,300,170,'共享准入协调器',['检查与记录','控制并发修改'],C.blue);
c.node(1040,268,280,170,'网关实例 B',['一次上游尝试','预留编号与上下文'],C.blue);
c.line([[380,353],[550,353]],C.blue);c.line([[1040,353],[850,353]],C.blue);
c.text(80,477,'身份与归属来自可信上下文；上游配额按实际共享范围映射。',30,C.muted);
c.panel(546,470,'02','在可原子协调的范围内，先检查全部条件',C.teal,C.tealBg);
c.rect(80,668,740,276,'#FFF',C.line,12,true);
c.text(450,716,'调用方 / 应用 / 团队 / 上游配额域',32,C.teal,600,'middle');
c.text(450,782,'各层按配置检查 RPM、Token 与并发',30,C.muted,400,'middle');
c.text(450,836,'额度维度、作用域与记录统一关联',30,C.muted,400,'middle');
c.text(450,890,'检查通过后，一起建立预留和扣减',30,C.muted,400,'middle');
c.node(1040,668,280,120,'全部通过',['记录并预留'],C.teal);
c.node(1040,824,280,120,'任一不足',['不建新预留'],C.purple);
c.line([[820,728],[1040,728]],C.teal);c.line([[820,884],[1040,884]],C.purple);
c.text(80,985,'原子范围外的部分成功，需要有编号的补偿与状态核对。',30,C.muted);
c.rect(40,1056,1320,250,C.pale);
c.text(76,1108,'原子性有范围，故障恢复需要明确协议',34,C.ink,600);
c.text(76,1162,'Redis Cluster 多键操作受同槽约束，跨分片需要另行协调。',30,C.muted);
c.text(76,1210,'超时后按预留编号重试或查询，避免重复扣减和盲目退款。',30,C.muted);
c.text(76,1258,'本地额度须有归属与有效期，不能在故障时重新均分总额度。',30,C.muted);
c.text(40,1360,'租户上限提供隔离；保证服务份额还需要实际容量与公平调度。',30,C.muted);
await c.save();
