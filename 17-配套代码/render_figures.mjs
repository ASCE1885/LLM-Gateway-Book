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
const tmp=path.resolve(process.argv[2]||path.join(root,'17-配套代码','preview'));
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

// Figure 17-1: input categories are disjoint; reasoning is an output subset.
const a=new Figure('17-用量到计费项目',1550,'Token 用量到计费项目的映射','OpenAI 输入总量包含普通输入、缓存读取与适用的缓存写入；Anthropic 三部分分别报告。先转换成互斥输入项目。输出总量 900 中含推理 600，示例按总量计价。缺失信息保留未知，缺价保留待计价。');
a.text(40,58,'Token 计量：先拆分，再计价',38,C.ink,600);
a.text(40,108,'按厂商、接口与模型能力解释原始 usage。',30,C.muted);
a.panel(146,584,'01','输入：不同字段，归一到互斥项目',C.blue,C.blueBg);
a.node(80,244,570,210,'OpenAI 输入总量',['含普通输入、读取与适用写入','从总量中拆出缓存类别'],C.blue);
a.node(750,244,570,210,'Anthropic 输入字段',['普通输入、读取与写入分别报','三部分相加得到完整输入'],C.blue);
a.line([[365,454],[365,550]],C.blue);
a.line([[1035,454],[1035,550]],C.blue);
a.node(80,550,1240,128,'互斥的输入计费项目',['普通输入  +  缓存读取  +  各 TTL 缓存写入'],C.blue);
a.text(80,714,'写入总量用于校验；已按 TTL 拆分后，不再另加一次总量。',30,C.muted);
a.panel(770,380,'02','输出：计费总量与分析子集分别保存',C.teal,C.tealBg);
a.rect(80,870,780,200,'#FFF',C.line,12,true);
a.text(470,918,'计费输出总量：900',34,C.teal,600,'middle');
a.rect(130,955,680,78,C.tealBg,C.teal,10);
a.text(470,1005,'其中推理：600（分析明细）',30,C.teal,500,'middle');
a.node(1000,870,320,200,'按 900 计价',['推理不重复加','可见量另分析'],C.teal);
a.line([[860,970],[1000,970]],C.teal);
a.text(80,1110,'示例限同一输出单价；可见内容不等于全部计费输出。',30,C.muted);
a.panel(1190,280,'03','信息不足时保留待处理状态',C.purple,C.purpleBg);
a.node(80,1294,600,128,'用量或 TTL 未知',['保留已知部分，等待可靠证据'],C.purple);
a.node(720,1294,600,128,'缺少对应单价',['保留待计价，不退回普通价格'],C.purple);
a.text(40,1510,'字段与价格按实际接口核实；图中 Token 数为教学示例。',30,C.muted);
await a.save();

// Figure 17-2: ownership links and the actual fallback edge have separate lanes.
const b=new Figure('17-请求与调用成本归属',1490,'一次业务请求与多次实际调用的成本归属','业务请求 R 关联 Embedding E1、超时模型尝试 A1、Fallback 后成功的模型尝试 A2。已计价部分 0.002 加 0.066 等于 0.068 元；A1 金额未知，最终总额待确认。补报关联原调用，保留修订依据并幂等更新有效汇总。');
b.text(40,58,'成本归属：一个答案，多次实际调用',38,C.ink,600);
b.text(40,108,'上方连线表示归属；模型尝试之间的横向箭头表示 Fallback。',30,C.muted);
b.node(360,165,680,170,'业务请求 R',['可信归属：客服团队 / 应用 A','凭证轮换后仍按稳定应用汇总'],C.blue,C.blueBg);
b.line([[450,335],[450,390],[260,390],[260,470]],C.blue);
b.line([[700,335],[700,470]],C.blue);
b.line([[950,335],[950,390],[1140,390],[1140,470]],C.blue);
b.node(80,470,360,240,'Embedding E1',['语义缓存辅助调用','完整用量 · 已计价','0.002 元（虚构）'],C.teal,C.tealBg);
b.node(520,470,360,240,'模型尝试 A1',['超时后等待核对','输出用量未知','金额：待确认'],C.amber,'#FBF4E8');
b.node(960,470,360,240,'模型尝试 A2',['Fallback 后成功','完整用量 · 已计价','0.066 元（虚构）'],C.teal,C.tealBg);
b.text(920,542,'切换',30,C.muted,500,'middle');
b.line([[880,570],[960,570]],C.muted);
for(const x of [260,700,1140]) b.line([[x,710],[x,810]],C.blue);
b.node(80,810,1240,190,'已计价部分：0.068 元；最终总额：待确认',['0.002 + 0.066；模型 A1 的费用尚未确认','成功返回保留前序调用记录，未知金额继续核对'],C.blue,C.blueBg);
b.panel(1040,370,'01','补报与修订：关联原调用，更新有效结果',C.purple,C.purpleBg);
b.node(80,1144,520,180,'补报 / 结算证据',['关联同一次实际调用','保留来源与修订依据'],C.purple);
b.node(800,1144,520,180,'更新有效汇总',['重复补报只计一次','原估算不与新实报相加'],C.purple);
b.text(700,1202,'核对',30,C.purple,500,'middle');
b.line([[600,1232],[800,1232]],C.purple);
b.text(80,1374,'无法按请求匹配的差额，在可核对的汇总层级单列。',30,C.muted);
b.text(40,1450,'图中金额为虚构示例；各次调用保留独立 ID 和用量状态。',30,C.muted);
await b.save();

// Figure 17-3: retain the original filename and section; show the feedback loop.
const c=new Figure('17-成本治理',1430,'成本治理的闭环','用量、计价、归属与对账建立可核对的成本记录。看得见、能优化、管得住与效果复核构成闭环；对账差异修正计量和价表，效果评估调整路由、缓存和预算。质量、成功率和延迟共同约束单位成果成本。');
c.text(40,58,'成本治理：记录、核对与持续改进',38,C.ink,600);
c.text(40,108,'让每次优化都能解释费用变化，并满足质量与服务目标。',30,C.muted);
c.panel(146,450,'01','建立可核对的成本记录',C.blue,C.blueBg);
const tops=[
 [80,'用量',['互斥计费项目','来源与完整性','原始证据']],
 [403,'计价',['实际执行目标','单价与版本','币种与单位']],
 [726,'归属',['业务请求关联','各次实际调用','稳定应用归属']],
 [1049,'对账',['统一核对范围','结算调整','差异单列']]
];
for(const [x,t,sub] of tops) c.node(x,256,270,240,t,sub,C.blue);
for(const [x1,x2] of [[350,403],[673,726],[996,1049]]) c.line([[x1,376],[x2,376]],C.blue);
c.text(80,558,'未知用量、未分类项和缺价单列；补报与修订只计一次。',30,C.muted);
c.panel(636,640,'02','用业务成果评价优化，再调整策略',C.teal,C.tealBg);
c.node(80,746,350,240,'看得见',['团队 / 应用 / 功能','单位业务成果成本','估算与未知占比'],C.teal);
c.node(525,746,350,240,'能优化',['分流与缓存','减少无效重试','验证净收益与质量'],C.teal);
c.node(970,746,350,240,'管得住',['预算与准入','异常分析','策略调整与回退'],C.teal);
c.line([[430,866],[525,866]],C.teal);
c.line([[875,866],[970,866]],C.teal);
c.line([[1145,986],[1145,1080]],C.teal);
c.node(80,1080,1240,120,'复核效果：单位成果成本 + 质量 + 成功率 + 延迟',['在任务类型、质量目标和统计口径可比的前提下判断'],C.teal,C.tealBg);
c.line([[80,1140],[55,1140],[55,866],[80,866]],C.teal);
c.text(80,1240,'效果反馈到看板与下一轮决策；变化无法解释时继续排查。',30,C.muted);
c.text(40,1330,'对账差异 → 修正用量适配与价表；保留修订依据。',30,C.purple,500);
c.text(40,1385,'效果评估 → 调整路由、缓存与预算；持续跟踪服务目标。',30,C.purple,500);
await c.save();
