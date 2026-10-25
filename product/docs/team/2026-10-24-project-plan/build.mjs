import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { Workbook, SpreadsheetFile } from '@oai/artifact-tool';
import { asOf, meetingDate, outputFolder, domains, tasks, roles, decisions, gates, sources } from './planning-data.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const out = path.join(root, outputFolder);
await fs.mkdir(path.join(out, 'qa'), { recursive: true });
const xlsxPath = path.join(out, '小宇记团队开发计划与跟进.xlsx');
try { await fs.access(xlsxPath); throw new Error('交付文件已存在。避免覆盖团队已填写内容；另建日期版本后再运行。'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const wb = Workbook.create();
const sheets = Object.fromEntries(['项目总览','行动跟踪','任务验收','人员与容量','每周跟进','决策与发布'].map(name => [name, wb.worksheets.add(name)]));
const ink = '#173F3B', muted = '#526A65', line = '#D8E2DE', amber = '#FFF4DC';
const domainName = code => `${code} ${domains.find(row => row[0] === code)[1]}`;
const end = tasks.length + 5;
const quote = name => `'${name}'`;
function setup(sheet, title, context, widths, rows) {
  sheet.showGridLines = false;
  sheet.getRangeByIndexes(0, 0, rows, widths.length).format.font = { name: 'Arial', size: 11, color: ink };
  sheet.getRangeByIndexes(0, 0, rows, widths.length).format.verticalAlignment = 'top';
  sheet.getRangeByIndexes(0, 0, rows, widths.length).format.rowHeight = 26;
  widths.forEach((width, index) => sheet.getRangeByIndexes(0, index, rows, 1).format.columnWidth = width);
  sheet.getRange('A2').values = [[title]];
  sheet.getRange('A2').format.font = { name: 'Arial', size: 16, bold: true, color: ink };
  sheet.getRange('A2').format.rowHeight = 30;
  sheet.getRange('A3').values = [[context]];
  sheet.getRange('A3').format.font = { name: 'Arial', size: 10, color: muted };
  sheet.getRangeByIndexes(3, 0, 1, widths.length).format.borders = { bottom: { style: 'thin', color: line } };
}
function table(sheet, row, headers, values, name, height = 64) {
  const range = sheet.getRangeByIndexes(row - 1, 0, values.length + 1, headers.length);
  range.values = [headers, ...values];
  range.format.wrapText = true;
  let index = headers.length, endColumn = '';
  while(index > 0) { index--; endColumn = String.fromCharCode(65 + index % 26) + endColumn; index = Math.floor(index / 26); }
  sheet.tables.add(`A${row}:${endColumn}${row + values.length}`, true, name);
  range.format.fill = '#FFFFFF';
  for(let i=0;i<values.length;i++) if(i%2===1) sheet.getRangeByIndexes(row+i,0,1,headers.length).format.fill = '#F6F8F7';
  range.format.rowHeight = height;
  const header = sheet.getRangeByIndexes(row - 1, 0, 1, headers.length);
  header.format = { fill: ink, font: { name: 'Arial', size: 11, bold: true, color: '#FFFFFF' },
    horizontalAlignment: 'center', verticalAlignment: 'center', wrapText: true, rowHeight: 36 };
  return range;
}
function input(sheet, range) { sheet.getRange(range).format.fill = amber; }
function list(sheet, range, values) { sheet.getRange(range).dataValidation = { rule: { type: 'list', values } }; }
function titleRow(sheet, row, text) { sheet.getRange(`A${row}`).values = [[text]]; sheet.getRange(`A${row}`).format.font = { name:'Arial',size:13,bold:true,color:ink }; }

const action = sheets['行动跟踪'];
const headers = ['任务ID','工作域','任务','优先级','阶段','负责人','复核人','推进状态','本周承诺','预计小时','目标日期','阻塞与下一步','证据或PR链接','复核结论','更新日期','完成记录'];
const actionRows = tasks.map(t => [t.id,domainName(t.domain),t.title,t.priority,t.phase,t.owner,t.reviewer,t.status,t.thisWeek,t.hours,t.due,t.next,t.evidence,t.verdict,t.updated,null]);
setup(action, '小宇记行动跟踪', '截至2026-10-24。黄色为团队输入；候选不是承诺；任务验收表保留现有基线、范围和依赖。', [12,19,38,10,18,14,14,13,12,12,14,42,36,13,14,30],306);
table(action,5,headers,actionRows,'ActionTracker',44);
action.freezePanes.freezeRows(5); action.freezePanes.freezeColumns(3);
input(action,'F6:O305');
list(action,'D6:D305',['P0','P1','P2']);
list(action,'E6:E305',['G0共同上手','G1核心体验','G2远程试用','G3商店发布','后续可选']);
list(action,'F6:F305',['待认领','用户','同事A','同事B','对象','园长','律师']);
list(action,'G6:G305',['待确认','用户','同事A','同事B','对象','园长','律师']);
list(action,'H6:H305',['排队','进行中','待复核','已验收','阻塞','暂缓']);
list(action,'I6:I305',['否','候选','是']);
list(action,'N6:N305',['未复核','通过','退回']);
action.getRange('J6:J305').setNumberFormat('0.0');
action.getRange('K6:K305').setNumberFormat('yyyy-mm-dd');
action.getRange('O6:O305').setNumberFormat('yyyy-mm-dd');
action.getRange('P6').formulas = [[`=IF(A6="","",IF(H6<>"已验收","未验收",IF(AND(F6<>"",F6<>"待认领",G6<>"",G6<>"待确认",F6<>G6,M6<>"",N6="通过",ISNUMBER(O6)),"验收记录齐","缺负责人/独立复核/证据/日期")))`]];
action.getRange('P6:P305').fillDown();
action.getRange('H6:H305').conditionalFormats.add('containsText',{text:'阻塞',format:{fill:'#FCE5E3',font:{color:'#A33332',bold:true}}});
action.getRange('P6:P305').conditionalFormats.add('containsText',{text:'缺负责人',format:{fill:'#FCE5E3',font:{color:'#A33332'}}});
action.getRange('I6:I305').conditionalFormats.add('cellIs',{operator:'equal',formula:'"是"',format:{fill:'#DEEAF2',font:{bold:true}}});

const detail = sheets['任务验收'];
setup(detail,'任务验收与现有基础','本表描述规划范围与验收，不复制负责人和状态。来源路径相对仓库；外部资料ID见决策与发布。',[12,19,36,48,56,60,30,65],end+2);
table(detail,5,['任务ID','工作域','任务','当前基线','要交付什么','完成标准','前置任务ID','来源与代码位置'],tasks.map(t=>[t.id,domainName(t.domain),t.title,t.baseline,t.deliverable,t.acceptance,t.dependencies||'无硬前置',t.source]),'TaskAcceptance',72);
detail.freezePanes.freezeRows(5); detail.freezePanes.freezeColumns(3);

const summary = sheets['项目总览'];
summary.tabColor = ink;
setup(summary,'小宇记团队开发计划','编制2026-10-24；先中国大陆3–6岁家庭。当前为工程原型。任务记录齐全不等于产品质量或法律验收通过。',[18,30,32,30,12,8,10,8,8,12],25);
summary.getRange('A4:J4').values = [['行动项',null,'本周已承诺',null,'进行中',null,'阻塞',null,'验收齐',null]];
summary.getRange('B4').formulas = [[`=COUNTA(${quote('行动跟踪')}!A6:A305)`]];
summary.getRange('D4').formulas = [[`=COUNTIFS(${quote('行动跟踪')}!I6:I305,"是",${quote('行动跟踪')}!A6:A305,"<>")`]];
summary.getRange('F4').formulas = [[`=COUNTIFS(${quote('行动跟踪')}!H6:H305,"进行中")`]];
summary.getRange('H4').formulas = [[`=COUNTIFS(${quote('行动跟踪')}!H6:H305,"阻塞")`]];
summary.getRange('J4').formulas = [[`=COUNTIFS(${quote('行动跟踪')}!P6:P305,"验收记录齐")`]];
for(const cell of ['B4','D4','F4','H4','J4'])summary.getRange(cell).format={horizontalAlignment:'left',font:{name:'Arial',size:13,bold:true,color:ink}};
table(summary,6,['工作域','已有基础','主要开放项','近期动作','主责','任务数','本周承诺','进行中','阻塞','验收记录齐'],domains.map(d=>[domainName(d[0]),d[2],d[3],d[4],'待认领',null,null,null,null,null]),'DomainOverview',64);
input(summary,'E7:E16');
for(let i=0;i<domains.length;i++){
  const row=i+7, match=`${quote('行动跟踪')}!$B$6:$B$305,A${row}`;
  summary.getRange(`F${row}:J${row}`).formulas=[[
    `=COUNTIFS(${match})`, `=COUNTIFS(${match},${quote('行动跟踪')}!$I$6:$I$305,"是")`,
    `=COUNTIFS(${match},${quote('行动跟踪')}!$H$6:$H$305,"进行中")`,
    `=COUNTIFS(${match},${quote('行动跟踪')}!$H$6:$H$305,"阻塞")`,
    `=COUNTIFS(${match},${quote('行动跟踪')}!$P$6:$P$305,"验收记录齐")`]];
}
summary.getRange('A18:D22').values=[
 ['初始候选','VOICE-01语音基线','AI-01多轮案例','DATA-01保存选择'],
 ['容量约定','尚未确认','至少周末半天是初步讨论','先估时，再填日期'],
 ['首轮原则','共同上手后，一人一项','主责与复核人不同','候选不等于本周承诺'],
 ['阶段门槛','G0共同上手 / G1核心体验','G2受控远程试用','G3商店发布'],
 ['维护方式','黄底为待填写输入','HTML是初始只读快照','飞书与Excel只选一份主表']];
summary.getRange('A18:D22').format.wrapText=true;
summary.getRange('A18:D22').format.rowHeight=42;

const people = sheets['人员与容量'];
setup(people,'人员分工与容量','三名开发者的小时和时段都需本人确认；不把“周末半天”自动换算成4小时。扣除会议与复核后才是可排任务时间。',[14,28,62,34,26,14,16,18,40,44],20);
table(people,5,['人员','建议角色','负责范围','协作与复核','确认状态','每周可投入小时','会议复核小时','可排任务小时','可用时段','说明'],roles.map(r=>[r[0],r[1],r[2],r[3],r[4],null,null,null,r[6],r[7]]),'TeamCapacity',72);
input(people,'E6:G11'); input(people,'I6:I11');
people.getRange('F6:H11').setNumberFormat('0.0');
for(let row=6;row<=11;row++)people.getRange(`H${row}`).formulas=[[
  `=IF(AND(ISNUMBER(F${row}),ISNUMBER(G${row})),IF(AND(F${row}>=0,G${row}>=0,F${row}>=G${row}),F${row}-G${row},"核对工时"),"待确认")`]];
people.getRange('A14').values=[['三位开发者可排小时合计']];
people.getRange('H14').formulas=[['=IF(COUNT(H6:H8)=3,SUM(H6:H8),"待确认")']];
people.getRange('A16').values=[['先讨论兴趣与能力，再认领主线。技术复核时间也占容量；支持角色不默认参加每次工程周会。']];
people.freezePanes.freezeRows(5);

const weekly=sheets['每周跟进'];
setup(weekly,'每周跟进记录','每次周会按真实情况更新；计划会议不是已召开。先看结果和失败，再承诺下轮任务。',[16,14,34,24,44,50,44,44,40,14,16],22);
const weeklyRows=Array.from({length:8},()=>Array(11).fill(null));
weeklyRows[0]=[new Date(`${meetingDate}T12:00:00Z`),'计划','用户/同事A/同事B',null,'确认容量、主线、首项任务及主表',null,null,null,null,null,null];
table(weekly,5,['会议日期','会议状态','参会人','关联任务ID','本轮承诺','交付与证据','未完成或阻塞','本次决定','下轮动作','负责人','下次核对日期'],weeklyRows,'WeeklyFollowup',48);
input(weekly,'A6:K13'); list(weekly,'B6:B13',['计划','已召开','取消']);
weekly.getRange('A6:A13').setNumberFormat('yyyy-mm-dd'); weekly.getRange('K6:K13').setNumberFormat('yyyy-mm-dd');
titleRow(weekly,16,'建议周会节奏');
weekly.getRange('A17:D20').values=[['5分钟','承诺与阻塞','15分钟','演示、PR、测试或失败日志'],['10分钟','跨模块决定','5–10分钟','下一轮少量任务'],['会前','更新状态/证据/下一步','会后','每人复述承诺与需要的帮助'],['触发处理','安全、丢数据、越权、费用失控','处理方式','先停用对应路径，不等周会']];
weekly.getRange('A17:D20').format.wrapText=true;weekly.getRange('A17:D20').format.rowHeight=42;
weekly.freezePanes.freezeRows(5);

const decision=sheets['决策与发布'];
setup(decision,'决策与发布门槛','门槛由证据和指定人员复核，不按周数自动通过。法律任务由律师结合最终方案判断。',[18,48,19,38,68,40,30,16],42);
table(decision,5,['决策ID','问题','状态','参与人','需要确认的结果','关联任务'],decisions,'DecisionLog',54);
input(decision,'C6:E13'); list(decision,'C6:C13',['待确认','已决定','暂缓','需复核']);
titleRow(decision,16,'发布门槛');
table(decision,18,['门槛','允许推进','所需证据','任务参考','评审状态','证据链接','批准人','日期'],gates.map(g=>[g[0],g[1],g[2],g[3],g[4],'','',null]),'ReleaseGates',90);
input(decision,'E19:H22'); list(decision,'E19:E22',['未验收','准备复核','允许限定范围','不通过']); decision.getRange('H19:H22').setNumberFormat('yyyy-mm-dd');
titleRow(decision,25,'来源与适用边界');
table(decision,27,['来源ID','资料','路径或网址','核对说明'],sources,'PlanningSources',66);
decision.freezePanes.freezeRows(5);

// Verify that an apparently completed task stays open until every prerequisite is present.
wb.recalculate();
assert.equal(summary.getRange('B4').values[0][0],tasks.length);
assert.equal(summary.getRange('D4').values[0][0],0);
assert.equal(people.getRange('H14').values[0][0],'待确认');
action.getRange('F6:I6').values=[['同事A','同事B','已验收','是']];
action.getRange('N6:O6').values=[['通过',new Date('2026-10-24T12:00:00Z')]];
wb.recalculate();
assert.match(action.getRange('P6').values[0][0],/缺负责人/);
assert.equal(summary.getRange('J4').values[0][0],0);
action.getRange('M6').values=[['https://example.invalid/synthetic-qa-evidence']];
wb.recalculate();assert.equal(summary.getRange('J4').values[0][0],1);
action.getRange('G6').values=[['同事A']];wb.recalculate();assert.equal(summary.getRange('J4').values[0][0],0);
action.getRange('F6:O6').values=[actionRows[0].slice(5,15)];
people.getRange('F6:G6').values=[[0,0]];wb.recalculate();assert.equal(people.getRange('H6').values[0][0],0);assert.equal(people.getRange('H14').values[0][0],'待确认');
people.getRange('F6:G6').values=[[3,4]];wb.recalculate();assert.equal(people.getRange('H6').values[0][0],'核对工时');
people.getRange('F6:G6').values=[[null,null]];
wb.recalculate();
assert.equal(summary.getRange('J4').values[0][0],0);
const errors=await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#NUM!|#NULL!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:30},summary:'formula errors'});
await fs.writeFile(path.join(out,'qa','formula-scan.json'),JSON.stringify(errors,null,2));
for(const [name,range] of [['项目总览','A1:J16'],['行动跟踪','A1:I12'],['任务验收','A1:F10'],['人员与容量','A1:J15'],['每周跟进','A1:F10'],['决策与发布','A1:F13']]){
  const image=await wb.render({sheetName:name,range,scale:1.4,format:'png'});
  await fs.writeFile(path.join(out,'qa',`${name}.png`),new Uint8Array(await image.arrayBuffer()));
}
const xlsx=await SpreadsheetFile.exportXlsx(wb);await xlsx.save(xlsxPath);
const csvValue=value=>`"${String(value??'').replaceAll('"','""')}"`;
await fs.writeFile(path.join(out,'行动跟踪_飞书导入.csv'),'\uFEFF'+[headers.slice(0,15),...actionRows.map(r=>r.slice(0,15))].map(row=>row.map(csvValue).join(',')).join('\r\n'));
await fs.writeFile(path.join(out,'任务验收_飞书导入.csv'),'\uFEFF'+[['任务ID','当前基线','交付范围','验收条件','前置任务','来源'],...tasks.map(t=>[t.id,t.baseline,t.deliverable,t.acceptance,t.dependencies,t.source])].map(row=>row.map(csvValue).join(',')).join('\r\n'));

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const brand=await fs.readFile(path.join(root,'assets/xiaoyu-planet.png'));
const guide=await fs.readFile(new URL('会议与执行说明.md',import.meta.url),'utf8');
await fs.writeFile(path.join(out,'会议与执行说明.md'),guide);
const domainOptions=domains.map(d=>`<option value="${d[0]}">${esc(domainName(d[0]))}</option>`).join('');
const taskHtml=tasks.map(t=>`<details class="task" data-domain="${t.domain}" data-phase="${esc(t.phase)}" data-priority="${t.priority}"><summary><span class="task-id">${t.id}</span><strong>${esc(t.title)}</strong><span>${t.priority} · ${esc(t.phase)}</span></summary><div class="task-body"><dl><dt>已有基础</dt><dd>${esc(t.baseline)}</dd><dt>本项交付</dt><dd>${esc(t.deliverable)}</dd><dt>完成标准</dt><dd>${esc(t.acceptance)}</dd><dt>前置任务</dt><dd>${esc(t.dependencies||'无硬前置')}</dd><dt>代码或资料</dt><dd><code>${esc(t.source)}</code></dd></dl><p>负责人待认领 · 估时与日期待讨论。此处是初始只读快照，实际跟进以选定主表为准。</p></div></details>`).join('');
const html=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>小宇记 · 团队启动与开发计划</title><style>
:root{--ink:#173f3b;--muted:#526a65;--line:#d8e2de;--bg:#f6f8f7;--orange:#f39a55}*{box-sizing:border-box;letter-spacing:0}body{margin:0;color:var(--ink);background:#fff;font:16px/1.7 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}h1,h2,h3,p{margin:0}h1{font-size:36px;line-height:1.4}h2{font-size:29px;line-height:1.4}h3{font-size:21px}button,input,select{font:inherit;color:inherit}button{cursor:pointer}a{color:inherit;text-underline-offset:4px}a:focus-visible,button:focus-visible,summary:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #326a81;outline-offset:4px}[hidden]{display:none!important}header{max-width:1200px;margin:auto;padding:22px 32px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;gap:20px}.brand{display:flex;align-items:center;gap:10px;font-size:20px;font-weight:650}.brand img{width:36px;height:36px;border-radius:8px}.stamp{font-size:13px;color:var(--muted)}nav{max-width:1200px;margin:auto;padding:0 32px;display:flex;gap:26px;border-bottom:1px solid var(--line);overflow-x:auto}nav button{background:none;border:0;border-bottom:3px solid transparent;padding:17px 0 14px;white-space:nowrap;min-height:58px}nav button[aria-selected=true]{border-bottom-color:var(--ink);font-weight:650}main{max-width:1200px;margin:auto;padding:38px 32px 54px}.panel{display:flex;flex-direction:column;gap:28px}.lead{font-size:19px;max-width:900px;color:var(--muted)}.note{font-size:14px;color:var(--muted)}.band{background:var(--bg);padding:22px 26px;border-left:3px solid var(--orange)}.band p{margin-top:8px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:30px}.grid article{padding-top:18px;border-top:2px solid var(--line)}.grid p{margin-top:10px;color:var(--muted)}.links{display:flex;gap:14px 26px;flex-wrap:wrap}.links a{min-height:42px;display:flex;align-items:center;font-weight:600}.table-wrap{overflow:auto}table{border-collapse:collapse;width:100%;min-width:700px;font-size:15px}th,td{text-align:left;vertical-align:top;padding:15px 18px 15px 0;border-bottom:1px solid var(--line)}th{font-size:13px;color:var(--muted);font-weight:550}td:first-child{min-width:150px;font-weight:600}td p{margin-top:6px;color:var(--muted)}.filters{display:flex;gap:12px;flex-wrap:wrap;align-items:end}.filters label{display:flex;flex-direction:column;gap:5px;font-size:13px;color:var(--muted)}input,select{border:1px solid var(--line);border-radius:8px;background:#fff;min-height:44px;padding:8px 12px}input{width:260px}.task{border-bottom:1px solid var(--line)}summary{cursor:pointer;list-style:revert;padding:17px 0;display:grid;grid-template-columns:100px 1fr auto;gap:16px;align-items:start}.task-id{font-size:13px;color:var(--muted)}summary>span:last-child{font-size:13px;color:var(--muted)}.task-body{padding:0 0 24px 116px}.task-body dl{display:grid;grid-template-columns:90px 1fr;gap:12px;margin:0 0 16px}.task-body dt{font-size:14px;color:var(--muted)}.task-body dd{margin:0}.task-body p{font-size:13px;color:var(--muted)}code{font:13px/1.7 ui-monospace,SFMono-Regular,monospace;overflow-wrap:anywhere}.phase{padding:20px 0;border-top:1px solid var(--line);display:grid;grid-template-columns:180px 1fr;gap:28px}.phase p{margin-top:8px;color:var(--muted)}ol{padding-left:23px;margin:0}li{margin:10px 0}footer{max-width:1200px;margin:auto;padding:20px 32px;border-top:1px solid var(--line);font-size:13px;color:var(--muted)}@media(max-width:760px){header{padding:16px 20px}.stamp{max-width:140px;font-size:11px}nav{padding:0 20px;gap:22px}nav button{font-size:14px}main{padding:28px 22px 40px}h1{font-size:29px}h2{font-size:25px}.lead{font-size:17px}.grid{grid-template-columns:1fr;gap:24px}.band{padding:18px 20px}.phase{grid-template-columns:1fr;gap:6px}summary{grid-template-columns:76px 1fr;gap:8px}.task summary>span:last-child{grid-column:2}.task-body{padding-left:0}.task-body dl{grid-template-columns:74px 1fr;gap:10px}input{width:100%}.filters label:first-child{width:100%}.table-wrap{margin-right:-6px}footer{padding:18px 22px}}@media print{nav,.filters,header .stamp{display:none}.panel,.panel[hidden]{display:flex!important;break-before:page}main{padding:0}.task-body{display:block}details{break-inside:avoid}table{min-width:0;font-size:11px}header{border:0}}
</style></head><body><header><div class="brand"><img src="data:image/png;base64,${brand.toString('base64')}" alt="小宇"><span>小宇记</span></div><div class="stamp">编制 ${asOf}<br>明天会议 ${meetingDate} · 初始规划快照</div></header><nav role="tablist" aria-label="团队计划">${[['overview','会议总览'],['system','系统分工'],['tasks','任务认领'],['release','部署与上架'],['weekly','每周协作']].map(([id,title],i)=>`<button id="tab-${id}" role="tab" aria-selected="${i===0}" aria-controls="${id}" tabindex="${i===0?0:-1}" data-view="${id}">${title}</button>`).join('')}</nav><main>
<section class="panel" id="overview" role="tabpanel" aria-labelledby="tab-overview"><p class="note">一起探索小宇宙，一起记住小时候。</p><h1>先让三个人能够一起推进，<br>再把一段交流做扎实。</h1><p class="lead">先服务中国大陆3–6岁家庭。我们已有可运行原型，语音、回应质量和档案可靠性仍需打磨。明天先确认投入、主责和首项任务。</p><div class="band"><strong>容量尚未确认，不按四周承诺上线。</strong><p>“至少周末半天”是此前初步约定。先共同跑通环境，再一人一项、交叉复核；本轮列出${tasks.length}项全景待办，全部尚未认领验收。</p></div><div class="grid"><article><h3>体验与语音</h3><p>设备、断句、ASR、TTS、等待和恢复。候选首项VOICE-01：可解释的一轮阶段计时。</p></article><article><h3>对话与知识</h3><p>分享、提问、纠正、换题、自然结束。候选首项AI-01：10组多轮案例和逐轮评分。</p></article><article><h3>数据与交付</h3><p>保存选择、状态、备份、权限、CI与发布。候选首项DATA-01：清点保存路径与用户选择。</p></article></div><p class="note">三条主线是讨论建议，用户与两位同事按兴趣和可投入时间选择；候选不等于已承诺。没有替任何人分配工作。</p><div class="links"><a href="小宇记团队开发计划与跟进.xlsx">打开任务工作簿</a><a href="行动跟踪_飞书导入.csv" download>导出行动表CSV</a><a href="任务验收_飞书导入.csv" download>导出验收说明CSV</a><a href="会议与执行说明.md">完整会议与执行说明</a></div><h2>明天会议要带走的结果</h2><ol><li>各自可投入小时、协作时段与主线。</li><li>共同上手后，每人最多一项首任务；独立复核人、交付与估时。</li><li>唯一任务主表、PR/合并规则、付费评测预算与每周周会。</li></ol></section>
<section class="panel" id="system" role="tabpanel" aria-labelledby="tab-system" hidden><h2>分清职责，也看清跨层协作。</h2><p class="lead">前端呈现，应用协调管理会话与任务，后端保护接口和密钥，模型负责生成建议，数据层负责可靠留存。“中端”无需另建一套服务。</p><div class="table-wrap"><table><thead><tr><th>工作域</th><th>已有基础</th><th>主要缺口</th><th>近期动作</th></tr></thead><tbody>${domains.map(d=>`<tr><td>${esc(d[1])}<p>${d[0]}</p></td><td>${esc(d[2])}</td><td>${esc(d[3])}</td><td>${esc(d[4])}</td></tr>`).join('')}</tbody></table></div><div class="band"><strong>工程原型的边界</strong><p>当前是原生JS网页+Node，不是已发布的原生App。localStorage仍为主存，IndexedDB是整包备用；正式账号/云同步、自动声纹、多孩子和照片理解未接通。静态抽查与历史测试不证明今天的真实体验达标。</p></div></section>
<section class="panel" id="tasks" role="tabpanel" aria-labelledby="tab-tasks" hidden><h2>按阶段选任务，再共同确认验收。</h2><p class="note">本页只读。负责人、状态、日期与证据在Excel或飞书主表更新；P0是该阶段的阻断项，不表示全都要这周做。</p><div class="filters"><label>搜索<input id="search" type="search" placeholder="任务ID、标题、代码或问题"></label><label>工作域<select id="domainFilter"><option value="">全部</option>${domainOptions}</select></label><label>阶段<select id="phaseFilter"><option value="">全部</option>${['G0共同上手','G1核心体验','G2远程试用','G3商店发布','后续可选'].map(p=>`<option>${p}</option>`).join('')}</select></label><label>优先级<select id="priorityFilter"><option value="">全部</option><option>P0</option><option>P1</option><option>P2</option></select></label></div><p class="note" id="taskCount" aria-live="polite">${tasks.length} 项</p><div>${taskHtml}</div></section>
<section class="panel" id="release" role="tabpanel" aria-labelledby="tab-release" hidden><h2>先受控Web试用，再选择App发行。</h2><p class="lead">沿用现有阿里云账号方向评估大陆区域小规模Node部署。先明确访问与数据边界，再提供远程网址。没有购买或部署新资源。</p>${gates.map(g=>`<article class="phase"><div><h3>${esc(g[0])}</h3><p>当前：${esc(g[4])}</p></div><div><strong>${esc(g[1])}</strong><p>${esc(g[2])}</p><p><code>${esc(g[3])}</code></p></div></article>`).join('')}<div class="grid"><article><h3>客户数据</h3><p>先可靠本地留存。云推理会发送相应内容；要跨设备再设计大陆区域数据库与私有作品存储，逐项记录同意、保留和删除。</p></article><article><h3>手机App</h3><p>验证Capacitor等候选能否满足音频权限与升级；iOS走测试与App Store中国区，Android按家庭设备先选一个大陆商店。</p></article><article><h3>发布与法律</h3><p>律师核对最终主体/功能下的备案、儿童信息、AI及渠道要求；工程提供真实数据流。规则以发布前复核为准。</p></article></div><p class="note">依据：Apple审核及儿童体验指南、工信部APP备案通知、生成式AI暂行办法；链接和核对边界在工作簿与完整说明中。没有作项目已经合规的结论。</p></section>
<section class="panel" id="weekly" role="tabpanel" aria-labelledby="tab-weekly" hidden><h2>每周看证据和阻塞，再选下一项。</h2><div class="grid"><article><h3>会前</h3><p>更新状态、本周承诺、下一步和证据链接。卡住就说明需要谁决定，不等周会。</p></article><article><h3>30–40分钟周会</h3><p>5分钟看承诺/阻塞，15分钟演示结果或失败，10分钟做跨模块决定，5–10分钟选下轮任务。</p></article><article><h3>会后</h3><p>一人一项在做、一项以内复核。完成需要独立复核、证据与明确通过；不以代码量判断。</p></article></div><div class="table-wrap"><table><thead><tr><th>参与者</th><th>负责的交付</th><th>怎样接入开发</th></tr></thead><tbody>${roles.map(r=>`<tr><td>${esc(r[0])}<p>${esc(r[1])}</p></td><td>${esc(r[2])}</td><td>${esc(r[3])}<p>${esc(r[7])}</p></td></tr>`).join('')}</tbody></table></div><div class="band"><strong>只有一份可编辑主表</strong><p>选飞书或Excel，另一份只读归档。CSV导入不保留公式/下拉，需在飞书配置。HTML是编制日快照，不会自动同步团队后续更新。</p></div></section>
</main><footer>编制日静态核查与规划，未重跑全项目发布检查、真实模型、真机或家庭试用。未填负责人/日期是待讨论，不是遗忘。</footer><script>
const ids=['overview','system','tasks','release','weekly'],tabs=[...document.querySelectorAll('[data-view]')];function show(i,focus=false){ids.forEach((id,j)=>{document.getElementById(id).hidden=i!==j;tabs[j].setAttribute('aria-selected',String(i===j));tabs[j].tabIndex=i===j?0:-1});history.replaceState(null,'','#'+ids[i]);window.scrollTo(0,0);if(focus)tabs[i].focus({preventScroll:true})}tabs.forEach((b,i)=>{b.addEventListener('click',()=>show(i));b.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();show(e.key==='Home'?0:e.key==='End'?4:(i+(e.key==='ArrowRight'?1:-1)+5)%5,true)})});const rows=[...document.querySelectorAll('.task')];function filter(){const text=document.querySelector('#search').value.trim().toLowerCase(),d=document.querySelector('#domainFilter').value,p=document.querySelector('#phaseFilter').value,q=document.querySelector('#priorityFilter').value;let n=0;rows.forEach(r=>{r.hidden=Boolean((text&&!r.textContent.toLowerCase().includes(text))||(d&&r.dataset.domain!==d)||(p&&r.dataset.phase!==p)||(q&&r.dataset.priority!==q));if(!r.hidden)n++});document.querySelector('#taskCount').textContent=n+' 项'}document.querySelectorAll('.filters input,.filters select').forEach(el=>el.addEventListener('input',filter));show(Math.max(0,ids.indexOf(location.hash.slice(1))));
</script></body></html>`;
await fs.writeFile(path.join(out,'小宇记团队启动会议.html'),html);
await fs.writeFile(path.join(out,'qa','verification.json'),JSON.stringify({asOf,tasks:tasks.length,domains:domains.length,initialCommitted:0,initialAccepted:0,formulaWorkflowChecks:'passed; synthetic edits restored',sheets:Object.keys(sheets),limitations:['No native Excel/Feishu recalculation verification','No new product runtime or paid API tests']},null,2));
console.log(JSON.stringify({out,tasks:tasks.length,sheets:Object.keys(sheets),xlsx:xlsxPath}));
