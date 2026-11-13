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
const tmp=path.resolve(process.argv[2]||path.join(root,'20-配套代码','preview'));
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

// Figure 20-1: distinguish model traffic from the actual side-effect boundaries.
const a=new Figure('20-注入攻击链与执行防线',1460,'注入攻击链与执行防线','不可信外部资料经过入口检测与来源标注后进入模型。检测可能漏报，模型提出的工具调用、文本和链接仍然需要在实际工具执行、恢复、渲染及外发位置独立验证。只控制模型请求的网关不一定控制所有副作用。');
a.text(40,58,'注入防线：检测之后，执行与外发仍需授权',38,C.ink,600);
a.text(40,108,'示例：用户只要求总结邮件；邮件正文不能授予发送权限。',30,C.muted);
a.node(80,180,520,180,'不可信的外部内容',['邮件 / 网页 / 检索 / 工具结果','其中可能夹带改变任务的指令'],C.muted,C.pale);
a.node(800,180,520,180,'入口检测与来源标注',['只覆盖实际可见、经过的内容','命中可阻断，漏报仍可能发生'],C.blue,C.blueBg);
a.text(700,240,'读取',30,C.blue,500,'middle');
a.line([[600,270],[800,270]],C.blue);
a.line([[1060,360],[1060,480]],C.blue);
a.text(1110,435,'进入模型',30,C.blue,500);
a.node(80,480,1240,180,'模型处理资料并提出输出',['工具调用建议、回答文本、链接','模型输出不授予执行或外发权限'],C.purple,C.purpleBg);
a.line([[340,660],[340,780]],C.purple);
a.text(390,730,'工具调用',30,C.purple,500);
a.line([[1060,660],[1060,780]],C.purple);
a.text(1110,730,'文本 / 链接',30,C.purple,500);
a.node(80,780,520,220,'工具执行边界',['验证主体、资源与最终参数','必要确认绑定具体操作','获准之后才执行'],C.teal,C.tealBg);
a.node(800,780,520,220,'恢复、渲染与外发边界',['按位置恢复获准字段','控制远程加载与实际目标','检查代理、重定向和出口'],C.teal,C.tealBg);
a.line([[340,1000],[340,1120]],C.teal);
a.text(390,1075,'满足条件',30,C.teal,500);
a.line([[1060,1000],[1060,1120]],C.teal);
a.text(1110,1075,'满足条件',30,C.teal,500);
a.node(80,1120,1240,170,'执行与交付',['未获准的操作不执行，未获准的数据不外发','检查放在真正控制读取、执行或外发的位置'],C.teal,C.tealBg);
a.text(80,1360,'任一执行条件不满足，应停止对应操作；最终回答中的拒绝不能撤销既有操作。',30,C.muted);
a.text(40,1420,'模型网关、工具服务与客户端各有控制范围，不能从接入模型网关推断全链路覆盖。',30,C.muted);
await a.save();

// Figure 20-2: preserve the original illustration position; draw both trust zones.
const b=new Figure('20-可逆脱敏',1510,'可逆替换与受控恢复流程','在受控边界内识别并替换敏感值，映射隔离保存，外部模型只收到处理后的输入。模型返回的占位符是引用而非授权；恢复前校验作用域、接收者、具体字段及交付位置，再满足最终交付条件。P1 为缩写，只有本次成功识别并替换的原值没有交给模型。');
b.text(40,58,'可逆替换：映射留在边界内，恢复单独授权',38,C.ink,600);
b.text(40,108,'图中只画获准展示路径；P1 是占位符的示意别名。',30,C.muted);
b.rect(40,170,860,1180,C.blueBg);
b.rect(1000,170,360,1180,C.purpleBg);
b.text(80,224,'受控边界：应用 / 网关 / 映射',34,C.blue,600);
b.text(1040,224,'外部模型',34,C.purple,600);
b.node(80,270,780,180,'01  识别与替换',['原文：电话 13812345678','替换后：电话 P1'],C.blue);
b.node(1040,500,280,200,'02  生成',['接收处理后的','有效输入'],C.purple);
b.line([[860,390],[1180,390],[1180,500]],C.blue);
b.text(1080,365,'处理后输入',30,C.blue,500,'middle');
b.line([[470,450],[470,510]],C.blue,{dash:true});
b.node(80,510,780,170,'请求映射：P1 ↔ 联系电话',['隔离主体与作用域，限制访问和生命周期','映射不发给模型，不进入共享缓存'],C.blue);
b.node(80,750,780,200,'03  校验恢复许可',['核对作用域、接收者、具体字段与交付位置','模型返回的标记不自动授权读取原值'],C.teal);
b.line([[470,680],[470,750]],C.blue);
b.text(520,725,'本地映射',30,C.blue,500);
b.line([[1180,700],[1180,850],[860,850]],C.purple);
b.text(1010,820,'带标记结果',30,C.purple,500,'middle');
b.line([[470,950],[470,1050]],C.teal);
b.text(520,1010,'允许',30,C.teal,500);
b.node(80,1050,780,200,'04  受控恢复与交付',['仅在获准的纯文本字段恢复原值','最终条件满足后，发送给获准接收者'],C.teal,C.tealBg);
b.node(1040,1050,280,200,'范围说明',['未交给模型的','仅限本次成功','替换的原值'],C.purple);
b.text(80,1310,'拒绝 / 过期 / 标记异常：不恢复，按策略结束。',30,C.red,500);
b.text(40,1410,'不要对全文、URL 或任意工具参数盲目恢复；位置改变可能改变数据用途。',30,C.muted);
b.text(40,1470,'实际占位符包含随机请求标识；号码仅作教学示意。',30,C.muted);
await b.save();

// Figure 20-3: bounded incremental parsing, then scope and sink checks.
const c=new Figure('20-流式恢复与授权边界',1540,'流式恢复与授权边界','先解析传输协议并按字段维护状态。只暂存当前已知占位符的有效前缀，完整标记继续核对作用域、接收者和具体恢复许可；示例仅支持受控纯文本。未知、改写、超限或未闭合时不猜测恢复。最终交付条件独立检查，授权来自可信应用。');
c.text(40,58,'流式恢复：拼合标记、核对许可、受控交付',38,C.ink,600);
c.text(40,108,'先解析协议，再处理具体文本字段；图中展示有效标记的正常路径。',30,C.muted);
c.node(80,190,520,170,'收到占位符前缀',['仅暂存已知标记的有效前缀','不发送半个标记'],C.blue,C.blueBg);
c.node(800,190,520,170,'拼成完整占位符',['后续片段补齐剩余部分','完整不等于获准恢复'],C.purple,C.purpleBg);
c.line([[600,275],[800,275]],C.blue);
c.text(700,245,'继续',30,C.blue,500,'middle');
c.line([[1060,360],[1060,440],[490,440],[490,500]],C.purple);
c.text(700,415,'完整标记',30,C.purple,500,'middle');
c.node(80,500,820,240,'核对恢复许可',['租户 / 请求 / 接收者一致','具体标记获准，目标为受控纯文本字段','未知、改写、跨作用域或超限均不恢复'],C.teal,C.tealBg);
c.node(1050,540,300,160,'终止该字段',['丢弃暂存','不猜测原值'],C.red,C.redBg);
c.line([[900,620],[1050,620]],C.red);
c.text(975,590,'失败',30,C.red,500,'middle');
c.line([[490,740],[490,840]],C.teal);
c.text(540,805,'允许',30,C.teal,500);
c.node(80,840,820,190,'仅恢复获准原值',['示例只支持受控纯文本展示','恢复后仍须满足最终交付条件'],C.teal,C.tealBg);
c.line([[490,1030],[490,1130]],C.teal);
c.text(540,1095,'放行',30,C.teal,500);
c.node(80,1130,820,170,'交付获准接收者',['字面展示，不解析 HTML / Markdown','不自动加载外链'],C.teal,C.tealBg);
c.rect(1000,840,360,460,C.pale);
c.text(1030,895,'状态与结束',34,C.ink,600);
for(const [i,t] of ['尾段必须完整','异常立即中止','不刷新未知暂存','限制累计输出量','取消后清理引用','已交付无法撤回'].entries())c.text(1030,950+i*52,t,30,C.muted);
c.text(40,1380,'暂存只限已知标记的前缀，不是未闭合括号后的全部文本。',30,C.muted);
c.text(40,1440,'同一恢复器只处理一个输出字段；真实网关按通道分别维护状态。',30,C.muted);
c.text(40,1500,'恢复许可来自可信应用，不能从模型输出或客户端字段直接构造。',30,C.muted);
await c.save();
