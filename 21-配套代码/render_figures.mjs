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
const tmp=path.resolve(process.argv[2]||path.join(root,'21-配套代码','preview'));
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

// Figure 21-1: separate record classes, then review deletion at object scope.
const a=new Figure('21-日志分层留存与删除',1740,'日志分层、留存与删除','先明确记录目的、依据、字段与期限，将必要审计记录与获准采集的内容分开管理。删除请求或期限到达后按记录复核，依法仍需保存或暂难删除的部分限制处理，可删除部分覆盖在线数据及副本。两类处置均保留必要执行记录，并跟踪剩余事项。');
a.text(40,58,'日志生命周期：分类留存，按条件处置',38,C.ink,600);
a.text(40,108,'保存什么、保存多久，由记录目的与适用依据共同决定。',30,C.muted);
a.node(80,170,1240,160,'先明确记录目的、依据与字段',['为每类记录确定保留期、责任人和到期动作'],C.blue,C.blueBg);
a.line([[360,330],[360,430]],C.blue);
a.text(410,395,'必要记录',30,C.blue,500);
a.line([[1040,330],[1040,430]],C.purple);
a.text(1090,395,'获准内容',30,C.purple,500);
a.node(80,430,560,220,'审计与处理记录',['依记录类别确定保留期','受控追加 / 完整性保护','不记录完整密钥或令牌'],C.blue,C.blueBg);
a.node(760,430,560,220,'输入、输出与附件',['有依据且必要时采集','按目的限制字段与期限','避免正文进入长期锁定存储'],C.purple,C.purpleBg);
a.line([[360,650],[360,770]],C.blue);
a.line([[1040,650],[1040,770]],C.purple);
a.text(700,725,'删除请求或期限到达',30,C.muted,500,'middle');
a.node(80,770,1240,180,'复核记录范围与处置依据',['分别判断哪些仍须保存、哪些已可删除','内部保留策略不能替代法定依据'],C.teal,C.tealBg);
a.line([[360,950],[360,1080]],C.blue);
a.text(410,1030,'限制处理',30,C.blue,500);
a.line([[1040,950],[1040,1080]],C.teal);
a.text(1090,1030,'执行清理',30,C.teal,500);
a.node(80,1080,560,220,'仍须保留或暂难删除',['依法停止其他处理','仅存储与采取必要保护','记录依据并持续复核'],C.blue,C.blueBg);
a.node(760,1080,560,220,'满足删除条件',['清理在线正文 / 缓存 / 索引','协调备份与接收方副本','分别记录完成、待办与异常'],C.teal,C.tealBg);
a.line([[360,1300],[360,1420]],C.blue);
a.line([[1040,1300],[1040,1420]],C.teal);
a.node(80,1420,1240,180,'处置记录与持续核查',['仅保留必要执行信息，不复制已删除正文','持续复核限制处理状态；备份恢复后避免数据回流'],C.muted,C.pale);
a.text(40,1660,'技术困难不等于无限期保留；副本清理和未完成事项需要持续跟踪。',30,C.muted);
a.text(40,1710,'各阶段的查看、导出与处置均受访问控制，并留下必要审计信息。',30,C.muted);
await a.save();

// Figure 21-2: independent flows; the gateway does not own every exit.
const b=new Figure('21-数据驻留与跨境访问',1700,'数据驻留与跨境访问边界','示例中模型推理在境内，但审核和观测数据、备份复制以及境外运维查询分别构成需要核对的其他路径。境外运维箭头表示查询及返回数据。图中跨境连线仅表示待审查的数据或访问路径，不表示已获准，实际控制点按所在组件设置。');
b.text(40,58,'数据驻留：处理、保存与访问都要核对',38,C.ink,600);
b.text(40,108,'示例：模型在境内，其他路径仍可能跨境；连线不表示已经获准。',30,C.muted);
b.rect(40,170,840,1200,C.blueBg);
b.rect(1000,170,360,1200,C.purpleBg);
b.text(80,225,'境内处理 / 存储',34,C.blue,600);
b.text(1030,225,'境外处理 / 访问',34,C.purple,600);
b.node(80,270,300,180,'应用与网关',['统一模型入口','控制经过的流量'],C.blue);
b.node(540,270,300,180,'境内模型',['本例推理位置','不代表其他路径'],C.blue);
b.line([[380,360],[540,360]],C.blue);
b.text(460,330,'推理',30,C.blue,500,'middle');
b.node(1040,270,280,180,'分别核对',['接收方与用途','区域与访问权限'],C.purple);
b.node(80,540,760,180,'数据外发点',['审核输入 / Trace / 运行日志','应用、网关或代理核对实际外发字段'],C.blue);
b.node(1040,540,280,180,'审核 / 观测',['境外服务','也接收业务数据'],C.purple);
b.line([[840,630],[1040,630]],C.purple);
b.text(940,600,'外发',30,C.purple,500,'middle');
b.node(80,840,760,180,'境内日志与备份',['保存位置与复制目标分别核对','副本不继承模型路由的区域结论'],C.blue);
b.node(1040,840,280,180,'境外备份',['副本复制','另行核对条件'],C.purple);
b.line([[840,930],[1040,930]],C.purple);
b.text(940,900,'复制',30,C.purple,500,'middle');
b.node(80,1140,760,180,'境内存储的数据',['从境外查询、调取也需识别','通过身份与访问控制落实边界'],C.blue);
b.node(1040,1140,280,180,'境外运维',['访问发生在境外','核对查询和取回'],C.purple);
b.line([[840,1230],[1040,1230]],C.purple,{both:true});
b.text(940,1200,'查询 / 返回',30,C.purple,500,'middle');
b.node(80,1430,1240,160,'每条路径分别确认：获准后才处理或传输',['覆盖用途、数据类别、接收方、区域、留存与后续处理'],C.teal,C.tealBg);
b.text(40,1650,'模型地址不能证明整条链路的驻留情况；实际出口和访问点需分别执行控制。',30,C.muted);
await b.save();

// Figure 21-3: retain the original summary figure in its section.
const c=new Figure('21-合规能力',1540,'请求生命周期中的合规检查点','一次受控允许调用从应用提交，经网关检查派发到上游；上游生成返回，网关控制后续交付，应用负责展示导出。各阶段均由适用与配置、留存与审计、处置与复核支撑。返回路径上的审核依实际策略执行；下方治理工作不是调用结束后才开始。');
c.text(40,58,'合规检查点：一次请求需要多方协作',38,C.ink,600);
c.text(40,108,'图中为允许路径；各方按实际控制能力承担职责。',30,C.muted);
c.text(250,210,'应用',34,C.blue,600,'middle');
c.text(700,210,'LLM 网关',34,C.teal,600,'middle');
c.text(1150,210,'上游服务',34,C.purple,600,'middle');
c.node(80,250,340,210,'发起调用',['确认应用身份','限定数据与用途','落实必要告知'],C.blue,C.blueBg);
c.node(530,250,340,210,'检查与派发',['校验权限及策略','核对服务和区域','重试仍受约束'],C.teal,C.tealBg);
c.node(980,250,340,210,'按约定处理',['落实用途与留存','约束后续接收方','提供必要来源信息'],C.purple,C.purpleBg);
c.line([[420,355],[530,355]],C.blue);
c.text(475,325,'提交',30,C.blue,500,'middle');
c.line([[870,355],[980,355]],C.teal);
c.text(925,325,'派发',30,C.teal,500,'middle');
c.line([[1150,460],[1150,620]],C.purple);
c.text(1200,550,'处理',30,C.purple,500);
c.node(980,620,340,210,'生成并返回',['携带必要标识','配合取消与处置','返回实际用量'],C.purple,C.purpleBg);
c.node(530,620,340,210,'接收与控制',['按策略审核输出','传递标识与编号','异常中断并记录'],C.teal,C.tealBg);
c.node(80,620,340,210,'展示与交付',['按场景呈现标识','核对下载与导出','处理已存内容'],C.blue,C.blueBg);
c.line([[980,725],[870,725]],C.purple);
c.text(925,695,'返回',30,C.purple,500,'middle');
c.line([[530,725],[420,725]],C.teal);
c.text(475,695,'交付',30,C.teal,500,'middle');
c.rect(40,940,1320,420,C.pale);
c.text(80,1002,'贯穿各阶段的治理工作',34,C.muted,600);
c.node(80,1050,340,240,'适用与配置',['确认适用依据','维护获准服务','跟踪变更与公示'],C.muted);
c.node(530,1050,340,240,'留存与审计',['分类保存与授权','核查实际目标','处理记录失败'],C.muted);
c.node(980,1050,340,240,'处置与复核',['投诉与整改报告','删除与副本清理','跟踪未完成事项'],C.muted);
c.text(40,1430,'任何必要条件不满足，应在实际控制点停止对应操作。',30,C.muted);
c.text(40,1490,'网关仅覆盖经过自身的链路；独立出口与供应商内部处理需另行约束。',30,C.muted);
await c.save();
