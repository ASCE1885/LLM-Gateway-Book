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
const tmp=path.resolve(process.argv[2]||path.join(root,'22-配套代码','preview'));
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

// Figure 22-1: correlation is conditional; content access has its own boundary.
const a=new Figure('22-信号关联与内容边界',1320,'三种观测信号与受控内容的关联','指标按低基数属性聚合，可选 exemplar 关联到被保留的链路；日志通过 trace_id 和 span_id 关联。查看内容需要独立授权，内容默认不采集，引用本身不授予访问权限。');
a.text(40,58,'从整体异常，追查到一次调用',38,C.ink,600);
a.text(40,108,'指标、链路与事件各司其职；内容采集与访问另行控制。',30,C.muted);
a.node(50,200,350,240,'Metric · 指标',['数量 / 速率 / 分布','按低基数属性聚合','发现整体异常'],C.blue,C.blueBg);
a.node(525,200,350,240,'Trace · 链路',['一次调用的过程','需要被采样并保留','定位耗时与失败环节'],C.teal,C.tealBg);
a.node(1000,200,350,240,'Log · 事件',['结果 / 原因 / 上下文','携带链路关联 ID','不默认保存对话'],C.purple,C.purpleBg);
a.line([[400,320],[525,320]],C.blue);
a.text(462,280,'可选关联',30,C.blue,500,'middle');
a.line([[875,320],[1000,320]],C.teal);
a.text(937,280,'关联 ID',30,C.teal,500,'middle');
a.rect(50,540,825,260,C.pale);
a.text(85,600,'Exemplar 只提供代表性样本',34,C.blue,600);
a.text(85,665,'记录测量值及可选的 Trace / Span ID。',30,C.muted);
a.text(85,715,'后端支持、采样与保留期决定能否继续追查。',30,C.muted);
a.text(85,765,'没有关联样本时，结合时间窗口和服务查询。',30,C.muted);
a.line([[1175,440],[1175,570]],C.purple,{dash:true});
a.text(1220,515,'可选引用',30,C.purple,500);
a.node(1000,570,350,190,'独立访问授权',['按用途与主体核验','记录必要访问审计'],C.purple,C.purpleBg);
a.line([[1175,760],[1175,900]],C.purple,{dash:true});
a.text(1220,845,'授权后',30,C.purple,500);
a.node(1000,900,350,210,'受控内容存储',['默认不采集','必要时脱敏、限期保存','引用不等于访问凭证'],C.purple,C.purpleBg);
a.rect(50,900,825,210,C.tealBg);
a.text(85,960,'关联能力，不改变权限边界',34,C.teal,600);
a.text(85,1020,'元数据也需要按最小权限访问。',30,C.muted);
a.text(85,1070,'Trace ID / 会话 ID 不进入常规指标标签。',30,C.muted);
a.text(40,1200,'虚线表示可选内容访问路径；不是每条 Trace 都采集内容。',30,C.muted);
a.text(40,1260,'指标样本不保证都有完整链路；内容上传开关需与追踪采样分别核对。',30,C.muted);
await a.save();

// Figure 22-2: preserve the original image's position, with a deterministic timeline.
const b=new Figure('22-观测信号',1630,'一次流式请求的 Trace 与计时边界','入站请求为零点；护栏零至三十毫秒，GenAI 逻辑调用三十至六百毫秒。第一次 HTTP 尝试三十至一百一十毫秒失败，退避至一百六十毫秒；第二次尝试至六百毫秒成功。四百六十毫秒收到首个有效内容，四百八十毫秒首次下游写出，六百二十毫秒结束交付。');
b.text(40,58,'同一条请求，三个不同的计时边界',38,C.ink,600);
b.text(40,108,'合成示例：一次 429 后重试；所有位置相对入站起点。',30,C.muted);
const x=t=>400+t*1.45;
b.text(60,190,'Span / 阶段',32,C.muted,600);
b.text(1320,190,'时间 / ms',30,C.muted,400,'end');
// Tick marks use simple SVG lines, separate from the request-flow arrows.
for(const t of [0,160,300,460,620]){
 b.text(x(t),240,String(t),30,C.muted,400,'middle');
 b.parts.push(`<line x1="${x(t)}" y1="255" x2="${x(t)}" y2="270" stroke="${C.line}" stroke-width="2"/>`);
}
const bar=(y,label,sub,start,end,color,fill)=>{
 b.text(60,y+25,label,32,color,600);b.text(60,y+69,sub,30,C.muted);
 b.rect(x(start),y,Math.max(10,(end-start)*1.45),44,fill,color,8);
 b.text(x(end),y+85,`${start}–${end} ms`,30,color,500,'end');
};
bar(290,'网关入站请求','HTTP SERVER',0,620,C.blue,C.blueBg);
bar(410,'输入护栏','INTERNAL',0,30,C.muted,C.pale);
bar(530,'GenAI 逻辑调用','CLIENT · 含自动重试',30,600,C.teal,C.tealBg);
bar(650,'第一次 HTTP 尝试','CLIENT · 返回 429',30,110,C.red,C.redBg);
bar(770,'重试退避','INTERNAL',110,160,C.amber,'#FAF3E8');
bar(890,'第二次 HTTP 尝试','CLIENT · 正常结束',160,600,C.purple,C.purpleBg);
b.rect(40,1030,1320,210,C.pale);
b.text(80,1088,'两个内容时刻：先接收，再写出',34,C.ink,600);
b.node(80,1120,560,90,'460 ms · 收到首个有效内容',[],C.teal,'#FFF');
b.node(790,1120,530,90,'480 ms · 首次下游写出',[],C.blue,'#FFF');
b.line([[640,1165],[790,1165]],C.muted);
b.text(715,1140,'20 ms',30,C.muted,500,'middle');
b.rect(40,1290,1320,260,C.blueBg);
b.text(80,1350,'首个内容的等待，必须同时说明计时起点',34,C.blue,600);
b.text(80,1410,'逻辑调用：460 − 30 = 430 ms；成功尝试：460 − 160 = 300 ms。',30,C.ink);
b.text(80,1465,'入站至首次写出：480 ms，包含护栏、失败尝试、退避和交付等待。',30,C.ink);
b.text(80,1520,'差值包含上游失败等待，不能直接称为网关自身处理开销。',30,C.muted);
b.text(40,1600,'仅角色事件在 210 ms 到达，不计为首个内容；分片数不等于 Token 数。',30,C.muted);
await b.save();

// Figure 22-3: logical pipeline and three independent processing branches.
const c=new Figure('22-采集链路与版本治理',1650,'观测数据采集、处理与导出','请求路径先完成字段最小化，再由 SDK 按信号采集和批量导出，经 Collector 分别处理指标、链路和日志。版本转换需要明确契约；队列与失败需监测。费用与必要审计记录按自身可靠性要求交付，不能默认依赖诊断采样链路。');
c.text(40,58,'让观测链路本身也可观测',38,C.ink,600);
c.text(40,108,'逻辑示意：队列与处理器按信号配置，不表示所有数据共用一个队列。',30,C.muted);
c.node(80,170,1240,150,'网关请求路径 · 测量与字段筛选',['先定义计时、用量与缺失值；移除凭证，不默认采集内容'],C.blue,C.blueBg);
c.line([[700,320],[700,410]],C.blue);
c.node(80,410,1240,170,'SDK → Collector',['按信号批量导出，限制队列容量、超时与重试','转换层固定规范快照；不能补出未采集的事实'],C.teal,C.tealBg);
c.line([[250,580],[250,690]],C.blue);
c.line([[700,580],[700,690]],C.teal);
c.line([[1150,580],[1150,690]],C.purple);
c.node(80,690,340,250,'Metric',['明确聚合与标签预算','独立于 Trace 采样记录','迁移期避免重复计数'],C.blue,C.blueBg);
c.node(530,690,340,250,'Trace',['明确采样策略','保留父子关系与来源','转换属性与结构'],C.teal,C.tealBg);
c.node(980,690,340,250,'Log / Event',['按记录目的筛选','关联 ID 与最小权限','分类留存与访问控制'],C.purple,C.purpleBg);
c.line([[250,940],[250,1030]],C.blue);
c.line([[700,940],[700,1030]],C.teal);
c.line([[1150,940],[1150,1030]],C.purple);
c.node(80,1030,340,120,'指标后端',[],C.blue);
c.node(530,1030,340,120,'链路后端',[],C.teal);
c.node(980,1030,340,120,'日志后端',[],C.purple);
c.rect(40,1220,1320,170,C.pale);
c.text(80,1280,'贯穿各段：观测自己的队列与失败',34,C.muted,600);
c.text(80,1340,'检查队列占用、导出错误、丢弃量与接收状态；有限重试不保证完整交付。',30,C.muted);
c.rect(40,1440,1320,150,C.purpleBg);
c.text(80,1500,'费用账本与必要审计：按其可靠性要求单独设计',34,C.purple,600);
c.text(80,1555,'明确持久化、重放、去重与失败处置，不默认依赖经过采样的诊断数据。',30,C.muted);
c.text(40,1630,'图中未画出可选内容存储；其上传、权限、保留与删除需另行控制。',30,C.muted);
await c.save();
