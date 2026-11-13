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
const tmp=path.resolve(process.argv[2]||path.join(root,'18-配套代码','preview'));
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

// Figure 18-1: preserve the original image location and distinguish trust domains.
const a=new Figure('18-身份与鉴权',1660,'网关的入站与出站身份','调用方向网关提交凭证，网关按入口规则验证并建立可信身份上下文，授权当前请求及实际目标，再使用匹配目标的出站凭证。管理权限独立检查，目标服务继续授权。三组面板分别表示入站、网关授权与出站，不对认证机制作强弱排名。');
a.text(40,58,'网关身份：入站验证、请求授权与出站凭证',38,C.ink,600);
a.text(40,108,'调用主体、网关授权与上游凭证分别建立信任。',30,C.muted);
a.panel(146,600,'01','入站：凭证证明调用主体',C.blue,C.blueBg);
a.node(80,246,520,240,'调用方',['应用 / 员工 / 工作负载','持有获准访问凭证','按约定获取与更新'],C.blue);
a.node(800,246,520,240,'网关入站验证',['API Key / 访问令牌 / 证书','按入口规则验证','确认主体与使用条件'],C.blue);
a.text(700,338,'提交凭证',30,C.blue,500,'middle');
a.line([[600,366],[800,366]],C.blue);
a.line([[1060,486],[1060,576]],C.blue);
a.node(80,576,1240,128,'可信身份上下文',['分别保留服务、用户与租户；客户端字段不能覆盖'],C.blue);
a.panel(786,380,'02','网关：授权到实际目标',C.teal,C.tealBg);
a.node(80,890,520,200,'请求授权',['模型 / 接口 / 工具 / 数据','调用权限与委托关系'],C.teal);
a.node(800,890,520,200,'选择获准上游',['路由、Fallback 仍受约束','管理权限单独检查'],C.teal);
a.text(700,952,'允许',30,C.teal,500,'middle');
a.line([[600,980],[800,980]],C.teal);
a.text(80,1130,'主体可信之后，还要判断这一次操作是否被允许。',30,C.muted);
a.panel(1206,390,'03','出站：为目标使用正确凭证',C.purple,C.purpleBg);
a.node(80,1310,520,200,'网关执行身份',['受控获取密钥或短期凭证','按目标重新构造认证信息'],C.purple);
a.node(800,1310,520,200,'模型 / 工具服务',['验证面向自己的凭证','继续执行本地授权'],C.purple);
a.text(700,1372,'请求',30,C.purple,500,'middle');
a.line([[600,1400],[800,1400]],C.purple);
a.text(80,1560,'入站凭证不直接充当厂商 Key；受众与目标权限分别核对。',30,C.muted);
a.text(40,1630,'机制可以组合；凭证类型不等于身份粒度，也不决定全部权限。',30,C.muted);
await a.save();

// Figure 18-2: each rejection has its own lane; no shared overlapping error trunk.
const b=new Figure('18-凭证校验与请求授权',1470,'从凭证校验到请求授权','受保护请求经过提取凭证与选择规则、验证凭证、建立可信身份上下文、授权当前操作与实际目标后，才使用目标凭证派发。各检查失败分别拒绝，不回退到更宽松认证方式。');
b.text(40,58,'从凭证到授权：每一步都有明确的拒绝条件',38,C.ink,600);
b.text(40,108,'适用于受保护请求；格式只帮助选择验证器，不能证明身份。',30,C.muted);
const steps=[
 {y:190,h:160,t:'01  提取凭证并选择验证规则',s:['入口配置决定接受的机制','多凭证必须有明确组合语义'],ey:190,e:['凭证有歧义','或机制不支持']},
 {y:430,h:200,t:'02  验证凭证及其使用条件',s:['按类型核对签发方、受众或证书身份','验证有效性、时间与适用状态','失败不回退到更宽松机制'],ey:450,e:['凭证不合法','或无法确认有效']},
 {y:710,h:160,t:'03  建立可信身份上下文',s:['映射应用、用户、租户及获授范围','客户端声明不能覆盖已验证主体'],ey:710,e:['主体无法映射','或归属不获准']},
 {y:950,h:160,t:'04  授权当前操作与实际目标',s:['模型 / 接口 / 工具 / 数据 / 环境','重路由仍受约束；管理权限单独控制'],ey:950,e:['操作或目标','超出权限']},
 {y:1190,h:160,t:'05  使用目标凭证派发',s:['按获准上游构造认证信息','记录主体与授权结果，凭证仅留编号']}
];
steps.forEach((v,i)=>{
 b.node(80,v.y,820,v.h,v.t,v.s,i===4?C.teal:C.blue,i===4?C.tealBg:C.blueBg);
 if(i<4){
  b.node(1050,v.ey,300,160,'拒绝请求',v.e,C.red,C.redBg);
  const mid=v.ey+80;
  b.text(975,mid-30,'失败',30,C.red,500,'middle');
  b.line([[900,mid],[1050,mid]],C.red);
  b.line([[490,v.y+v.h],[490,steps[i+1].y]],C.blue);
  b.text(540,(v.y+v.h+steps[i+1].y)/2+10,'通过',30,C.blue,500);
 }
});
b.text(80,1410,'任一检查失败，都不派发上游；实际目标变化后仍需满足授权约束。',30,C.muted);
await b.save();

// Lifelines are visual guides; they are not authentication or delegation arrows.
function lifeline(f,x,y1,y2){f.parts.push(`<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" stroke="${C.line}" stroke-width="2" stroke-dasharray="8 8"/>`);}

// White backing keeps lifeline guides out of sequence labels.
function floatLabel(f,x,y,s,color,weight=500){
 ctx.font=`${weight} 30px "${font}"`;
 const m=ctx.measureText(s);
 f.rect(x-m.width/2-8,y-m.actualBoundingBoxAscent-4,m.width+16,m.actualBoundingBoxAscent+m.actualBoundingBoxDescent+8,'#FFF','#FFF',4);
 f.text(x,y,s,30,color,weight,'middle');
}

// Figure 18-3: a four-party sequence, with separate rows for exchange and return.
const c=new Figure('18-代表用户的令牌交换',1690,'代表用户调用工具的令牌交换','用户令牌 A 面向网关。网关验证并授权，再以自身获准客户端身份向授权服务器申请交换，指定目标工单服务与只读权限。授权服务器根据策略签发令牌 B。网关核对后使用 B 调用工单服务，工具服务继续验证并检查具体工单权限。仅画允许路径。');
c.text(40,58,'令牌交换：代表用户访问另一资源',38,C.ink,600);
c.text(40,108,'示例：用户查询工单；各方保留自己的验证与授权职责。',30,C.muted);
for(const lane of [
 {x:65,cx:200,t:'调用方',s:'用户请求'},
 {x:385,cx:520,t:'网关 G',s:'客户端身份'},
 {x:745,cx:880,t:'授权服务器',s:'交换策略'},
 {x:1065,cx:1200,t:'工单服务',s:'资源权限'}
]){
 c.node(lane.x,170,270,128,lane.t,[lane.s],C.blue,C.blueBg);
 lifeline(c,lane.cx,320,1550);
}
floatLabel(c,360,340,'① 请求 + 令牌 A',C.blue,500);
c.line([[200,370],[520,370]],C.blue);
c.node(65,430,270,170,'令牌 A',['aud：网关','代表用户 U'],C.blue);
c.node(385,420,270,160,'验证并授权',['确认用户与操作','校验令牌 A'],C.blue);
floatLabel(c,700,638,'② 网关认证 + A',C.purple,500);
c.line([[520,680],[880,680]],C.purple);
floatLabel(c,700,724,'目标工单 / 请求只读',C.purple,400);
c.node(730,770,300,170,'检查交换资格',['用户与代理关系','目标与获准范围'],C.purple,C.purpleBg);
floatLabel(c,700,968,'③ 返回令牌 B',C.purple,500);
c.line([[880,1000],[520,1000]],C.purple,{dash:true});
c.node(300,1050,440,200,'核对令牌 B',['aud：工单服务','获准的只读范围','用户与代理方按约定关联'],C.teal,C.tealBg);
floatLabel(c,860,1308,'④ 令牌 B + 工单请求',C.teal,500);
c.line([[520,1340],[1200,1340]],C.teal);
c.node(1040,1380,320,170,'验证并授权',['校验令牌 B','检查具体工单权限'],C.teal,C.tealBg);
c.text(40,1598,'令牌交换本身不保证缩权；授权服务器决定获授范围。',30,C.muted);
c.text(40,1648,'图中只画允许路径；任一验证或授权失败，应停止后续派发。',30,C.muted);
await c.save();
