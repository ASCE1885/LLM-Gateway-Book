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
const tmp=path.resolve(process.argv[2]||path.join(root,'16-配套代码','preview'));
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

// Figure 16-1: retain the original location and file name; separate the identity dimensions.
const a=new Figure('16-租户层级',1790,'租户归属、凭证绑定与请求身份','组织、团队和应用构成示例管理主干；虚拟 Key 绑定稳定应用或服务主体，终端用户通过可信上下文关联到请求。适用权限与额度分别检查，换 Key 不自动重置应用预算。');
a.text(40,58,'租户模型：归属、凭证和用户分别表达',38,C.ink,600);
a.text(40,108,'组织关系帮助管理责任与费用；凭证和用户身份关联到具体请求。',30,C.muted);
a.panel(146,720,'01','管理主干：组织、团队与应用',C.blue,C.blueBg);
a.node(450,246,500,128,'组织',['治理边界与组织预算'],C.blue);
a.node(80,456,520,128,'客服团队',['团队策略与共享预算'],C.blue);
a.node(800,456,520,128,'搜索团队',['团队策略与共享预算'],C.blue);
a.line([[570,374],[570,414],[340,414],[340,456]],C.blue);
a.line([[830,374],[830,414],[1060,414],[1060,456]],C.blue);
a.node(80,672,520,128,'应用 / 项目 A',['稳定应用标识；跨 Key 汇总'],C.blue);
a.node(800,672,520,128,'应用 / 项目 B',['独立归属；受适用上级约束'],C.blue);
a.line([[340,584],[340,672]],C.blue);
a.line([[1060,584],[1060,672]],C.blue);
a.text(80,840,'此处是归属示例；成员、角色与跨项目授权还可有其他关系。',30,C.muted);
a.panel(906,480,'02','以应用 A 为例：不同身份关联同一次请求',C.purple,C.purpleBg);
a.node(80,1010,420,128,'虚拟 Key',['多把 Key 可绑定同一应用'],C.purple);
a.node(80,1198,420,128,'终端用户',['可信后端声明或验证身份'],C.purple);
a.node(800,1050,520,230,'应用 A 的一次请求',['组织、团队与应用归属','凭证编号与用户身份','实际模型、资源与操作'],C.purple);
a.line([[500,1074],[650,1074],[650,1115],[800,1115]],C.purple);
a.text(650,1044,'认证后关联',30,C.purple,500,'middle');
a.line([[500,1262],[700,1262],[700,1218],[800,1218]],C.purple);
a.text(650,1306,'可信身份',30,C.purple,500,'middle');
a.panel(1426,270,'03','策略落到请求，分别校验',C.teal,C.tealBg);
a.node(80,1530,600,128,'权限不越界',['模型、区域与强制策略'],C.teal);
a.node(720,1530,600,128,'额度共同检查',['各层跟踪用量，逐项准入'],C.teal);
a.text(40,1746,'Key 轮换不自动重置应用预算；终端用户不是 Key 下固定的第五层。',30,C.muted);
await a.save();

// Figure 16-2: a control-plane acknowledgement does not imply data-plane convergence.
const b=new Figure('16-吊销传播与执行边界',1650,'虚拟 Key 吊销传播与不同请求阶段的处理','管理端提交吊销，权威状态先可靠记录凭证状态与版本，网关实例通过通知或补查更新并上报版本。提交确认与全部实例应用不同步。新请求、排队请求和在途调用分别检查和处理，未知用量继续核对。');
b.text(40,58,'吊销凭证：登记、传播和执行分别确认',38,C.ink,600);
b.text(40,108,'控制面成功返回，不等于所有入口完成更新，也不代表远端已经停止。',30,C.muted);
b.panel(146,780,'01','先记录，再传播，并核对实际覆盖范围',C.blue,C.blueBg);
for(const col of [{x:80,cx:255,t:'管理端',s:'提交与观察'},{x:525,cx:700,t:'权威状态',s:'可靠保存吊销版本'},{x:970,cx:1145,t:'网关实例',s:'所有入口分别更新'}]){
 b.node(col.x,246,350,128,col.t,[col.s],C.blue);
 rule(b,col.cx,400,col.cx,880,C.line,true);
}
b.text(477,422,'提交吊销',30,C.blue,500,'middle');
b.line([[255,450],[700,450]],C.blue);
b.node(525,490,350,170,'先可靠记录',['凭证状态与版本','可返回提交结果'],C.purple);
b.text(1005,548,'通知 / 补查',30,C.blue,500,'middle');
b.line([[875,575],[1145,575],[1145,650]],C.blue);
b.node(970,650,350,170,'更新与核对',['失效本地缓存','上报已应用版本'],C.teal);
b.text(477,700,'已登记 ≠ 全部生效',30,C.muted,500,'middle');
b.line([[700,660],[700,730],[255,730]],C.muted,{dash:true});
b.text(922,850,'报告已应用版本',30,C.teal,500,'middle');
b.line([[1145,872],[700,872]],C.teal,{dash:true});
b.text(80,908,'以版本核对覆盖范围；失联实例不能无限信任旧状态。',30,C.muted);
b.panel(966,540,'02','请求阶段不同，处理方式也不同',C.teal,C.tealBg);
b.node(80,1080,380,280,'新请求',['检查吊销状态','已吊销则拒绝','缓存返回也先鉴权'],C.teal);
b.node(510,1080,380,280,'排队请求',['派发前再次检查','失效则停止派发','清理等待与相关预留'],C.teal);
b.node(940,1080,380,280,'在途调用',['按策略取消或完成','核对远端终态与用量','停止接纳 ≠ 远端已停'],C.teal);
b.text(80,1430,'状态无法证明有效：按约定拒绝新派发，或在线确认后再决定。',30,C.muted);
b.text(40,1550,'推送、有限有效期与版本补查配合；实例恢复后先同步再接纳。',30,C.muted);
b.text(40,1602,'正常轮换可设重叠期；泄露处置不沿用普通轮换宽限期。',30,C.muted);
await b.save();

// Figure 16-3: separate credential identity from the actual quota domain.
const c=new Figure('16-租户与共享配额',1630,'租户限制与上游共享配额域','三个租户各设五万 TPM，上游 Key 不同但仍汇入同一个十万 TPM 配额域。合计需求可达十五万 TPM。每次派发须同时满足租户侧和上游共享约束，独立容量仍需核对上层共享限制。');
c.text(40,58,'多租户隔离：不同 Key，可能共享同一份额度',38,C.ink,600);
c.text(40,108,'连线表示配额归属；实际派发前须完成租户和共享准入。',30,C.muted);
c.panel(146,900,'01','不同凭证，不代表不同配额域',C.blue,C.blueBg);
for(const [x,label] of [[80,'A'],[520,'B'],[960,'C']]){
 c.node(x,246,360,170,`租户 ${label}`,['租户上限：5 万 TPM','各自检查预算与并发'],C.blue);
 c.line([[x+180,416],[x+180,510]],C.blue);
 c.node(x,510,360,128,`上游 Key ${label}`,['凭证各不相同'],C.purple);
 c.line([[x+180,638],[x+180,750]],C.purple);
}
c.node(80,750,1240,170,'共享上游配额域 P：10 万 TPM',['三把 Key 经核实仍属于同一配额域','5 + 5 + 5 = 15 万 TPM，可能超过共享上限'],C.purple);
c.text(80,990,'各租户低于 10 万，不足以保证合计需求不超过 10 万。',30,C.muted);
c.panel(1086,450,'02','每次派发，都要满足两侧约束',C.teal,C.tealBg);
c.node(80,1200,520,210,'租户侧约束',['权限与预算','速率、并发与排队','保证份额还需容量分配'],C.teal);
c.node(800,1200,520,210,'上游共享约束',['实际组织、项目等限额','受控汇总与共享准入','独立容量需核对上层限制'],C.teal);
c.text(700,1314,'且',38,C.teal,600,'middle');
c.text(80,1482,'全部满足才派发；不足时有界等待或拒绝，不能换 Key 绕过。',30,C.muted);
c.text(40,1586,'示例假设计量口径与窗口一致；数值不是生产配置建议。',30,C.muted);
await c.save();
