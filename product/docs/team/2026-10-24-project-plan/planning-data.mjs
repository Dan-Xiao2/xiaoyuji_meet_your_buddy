export const asOf = '2026-10-24';
export const meetingDate = '2026-10-25';
export const outputFolder = 'outputs/team-planning-01a02471-2026-10-24';

export const domains = [
  ['TEAM', '协作与工程', '已有仓库、文档、控制器和发布脚本', '三人独立运行、代码审核、状态所有权仍需闭合', '结对上手、提交审核、逐步收紧app协调', '适合喜欢梳理结构与集成的人'],
  ['UX', '前端与交互', '手机/桌面共用导航，小宇入口、按需白板、成长和设置已接通', '失败反馈、输入纠正、目标真机可用性待逐项验证', '让孩子知道何时说、等待时发生什么、如何恢复', '适合关注界面、浏览器与交互的人'],
  ['VOICE', '语音链路', '实时ASR、批量回退、TTS流式路径、设备选择已有代码', '误听、断句、首声延迟、音色与连续对话仍不稳定', '先测全链路，再改最慢/最不准的环节', '适合音频、异步流程与性能排查的人'],
  ['AI', '对话与知识', 'Qwen短答、后台补全、知识卡与本地回退已接通', '模板开场、纠正后猜测、重复追问仍有真实失败', '围绕固定多轮案例改提示、上下文和回退', '适合模型实验、语言与评测的人'],
  ['BOARD', '白板与视觉', '受限精确图形、开放图片路由、编辑及审核适配已有基础', '连续编辑失真、主题相关性、照片输入未验收', '已有对象可靠修改，开放图片分项评测', '适合图形、工具调用与图像质量的人'],
  ['DATA', '成长与存储', '本机档案、修订、备份恢复、损坏保护已有基础', 'localStorage仍主存；分条迁移、并写、完整删除与保存选择未闭合', '先明确留存选择，再做事务、迁移和作品存储', '适合数据模型、可靠性与迁移的人'],
  ['SERVER', '后端与访问边界', 'Node接口、请求上限、同源检查、公开文件白名单已有', '正式家庭身份、越权隔离、额度、幂等与运营保护未完成', '远程试用前补身份、资源授权和费用上限', '适合API、权限与服务稳定性的人'],
  ['QA', '评测与质量', '单元、模拟浏览器、真实模型评测入口和CI配置已有', '远端CI证据、完整语音专测、真机与家庭价值仍缺', '统一案例和门槛，保存失败证据而非只报通过数', '适合系统测试、分析与验收的人'],
  ['RELEASE', '部署与App发布', '当前是本机网页原型；没有正式原生App或生产部署', '云环境、域名、HTTPS/WSS、监控、回滚和上架均待做', '先受控Web试用；达到门槛再决定App路线与商店', '适合部署、终端打包与运维的人'],
  ['BIZ', '用户、成本与法律', '已有商业概念及家长访谈材料；团队支持角色已提出', '用户需求、单位成本、价格、合规适用与责任仍待验证', '对象做研究成本；园长做触达；律师审查具体方案', '工程准备材料，由对应专业角色完成判断']
];

const tasks = [];
function add(id, domain, phase, priority, title, baseline, deliverable, acceptance, dependencies, source, candidate = false) {
  tasks.push({ id, domain, phase, priority, title, baseline, deliverable, acceptance, dependencies,
    source, owner: '待认领', reviewer: '待确认', status: '排队', thisWeek: candidate ? '候选' : '否',
    hours: null, due: null, next: '会议认领后拆解、估时并确认范围', evidence: '', verdict: '未复核', updated: null });
}

add('TEAM-01','TEAM','G0共同上手','P0','三台电脑独立运行并复现一条失败','已有README与npm脚本；新成员环境未验证','每人按运行说明启动；共享虚构案例，不共享生产密钥','三人各有环境记录；能跑发布入口，失败写明环境/代码原因；复现相同问题','','README.md; package.json; AGENTS.md');
add('TEAM-02','TEAM','G0共同上手','P0','确定分支、审核与合并规则','已有仓库；团队权限和实际审核规则待确认','主分支、短任务分支、一人复核、紧急修复规则及备用管理员','成员各自账号；一个小PR从提交到合并走通；明确谁可发布','TEAM-01','AGENTS.md; .github/workflows/release-check.yml');
add('TEAM-03','TEAM','G0共同上手','P0','统一任务、证据和决策入口','产品框架/开发日记/优化计划均已存在','选飞书或本工作簿为唯一任务主表；代码文档保留仓库真相源','负责人、状态、PR/结果链接有统一位置；不同时维护两份可编辑状态','TEAM-02','docs/development-log.md; docs/product-optimization-plan.md');
add('TEAM-04','TEAM','G1核心体验','P1','继续收紧app状态写入边界','普通对话异步提交已有限化；app仍有大量协调','选一个写入路径迁到命令/提交入口，pending与绘图逐批迁移','复现旧状态覆盖的失败先成立；修复后交错测试通过；不全站重写','TEAM-02','src/app.js; src/app/appStore.js; src/features/conversation/conversationCommit.js');
add('TEAM-05','TEAM','G1核心体验','P1','隔离旧教学状态和纯探索行为','自由聊天已隔离部分旧模板，Student结构仍有教学遗留','定义家庭、会话、回合、证据、作品的最小契约与兼容读取','分享/纠正/换题不触发旧课程；旧备份可读；不删除用户旧数据','AI-01','src/student/studentSchema.js; src/services/tutorEngine.js; src/services/conversationIntent.js');

add('UX-01','UX','G1核心体验','P0','统一说话、等待、失败与恢复反馈','首页和语音状态已存在；真实失败体验仍差','梳理倾听/处理/播报/暂停/结束/错误；每种状态一个清楚动作','在选定目标手机走完权限拒绝、重试、结束；没有假倾听或卡死','VOICE-01','src/ui/voiceState.js; src/app.js; DESIGN.md');
add('UX-02','UX','G1核心体验','P1','提供听错后的可理解纠正路径','用户可以口头纠正；转写/模型错误不总易区分','确定成人何时看本轮转写、怎样纠正并继续，孩子界面保持简洁','错字修正只作用目标回合；不覆盖已保存原始来源；纠正后跟随新内容','AI-02; DATA-01','src/ui/chat.js; src/features/conversation/conversationState.js');
add('UX-03','UX','G1核心体验','P1','复查移动端与桌面共用体验','两端共用导航和视觉变量已有','覆盖360/390/768/1440px，侧栏、长名、错误、白板和键盘','无文字/按钮遮挡；菜单焦点可返回；同一功能两端可达','UX-01','src/ui/appNavigation.js; src/styles/design-system.css; tests/production-design-browser.mjs');
add('UX-04','UX','G1核心体验','P1','成长页只呈现有依据且有用的变化','时间筛选、摘要和片段已有','验证空/一天/跨周数据和修订后的派生摘要，去除重复表达','筛选同时更新摘要和记录；无数据不造趋势；删除/纠正同步体现','DATA-03','src/ui/memoryPanel.js; src/data/growthInsights.js');
add('UX-05','UX','G2远程试用','P1','明确家长与儿童入口及帮助路径','本机家长码和设置已有；不是家庭登录系统','首次说明、保存选择、家长控制、错误求助与可访问性','新家庭能自行开始并停止；成人操作不混入孩子主页面','DATA-01; SERVER-01','src/services/parentAccess.js; index.html; docs/ui-motion-guidelines.md');

add('VOICE-01','VOICE','G1核心体验','P0','建立一轮语音的阶段耗时基线','局部计时已有；未形成可信端到端基线','关联最后声音、断句、ASR确认、短答、实际首声及回退原因','同一回合可定位最慢阶段；失败单列；无原话/录音进入诊断日志','','src/services/voiceService.js; src/services/voiceActivity.js; docs/voice-latency-check.md',true);
add('VOICE-02','VOICE','G1核心体验','P0','验证断句和首字保留','已有VAD、800ms前缀和实时/批量路径','用虚构短句、长停顿、轻声和噪声比较参数','至少30个可重复试次；报告截断、等待和失败，不以单句成功结案','VOICE-01','src/services/voiceActivity.js; src/services/recordedAudio.js; src/services/realtimeAsr.js');
add('VOICE-03','VOICE','G1核心体验','P0','让ASR回退和设备切换可解释','精确deviceId和批量回退已有','覆盖设备丢失、实时断线、批量失败、无声与权限恢复','不会静默跳到手机；每轮最多一个最终输入；回退路径可观察','VOICE-01','src/services/microphoneInput.js; src/services/realtimeAsr.js; server/realtimeAsr.mjs');
add('VOICE-04','VOICE','G1核心体验','P0','控制TTS音色与失败重播','云端流式、MP3及不同环境回退已有','逐条核对真正触发的provider/音色/语速；云端失败统一表现','相同路径不随机换音色；失败不假播或立即收音；重播不重复模型收费','VOICE-01','src/services/voiceService.js; server/qwenSpeech.mjs; server/speechStream.mjs');
add('VOICE-05','VOICE','G1核心体验','P0','验证连续会话的取消与续听','自动续听和取消已有；自动双工插话未实现','20轮合成输入覆盖暂停、结束、页面隐藏、锁屏/回来','结束后释放麦克风；无重复发送/旧播报；返回页面不自行恢复录音','VOICE-03; VOICE-04','src/services/voiceService.js; src/app.js; tests/realtime-asr.test.mjs');
add('VOICE-06','VOICE','G1核心体验','P1','按同一语料比较语音配置','现有Qwen账户适配已有；不默认换供应商','先比较配置，必要时增加一个候选ASR/TTS；固定模型、设备和网络','报告准确、重说、首声P50/P95、失败与成本；收费前确认预算','VOICE-02; VOICE-04; BIZ-02','server/qwenSpeech.mjs; .env.example; docs/realtime-voice-plan.md');
add('VOICE-07','VOICE','后续可选','P2','评估插话/全双工的收益和成本','当前并非完整全双工实时会话','做回声、打断、误触发与供应商能力的小实验','只有普通连续对话稳定后才纳入；实验不改默认行为','VOICE-05; QA-04','src/services/voiceService.js; docs/realtime-voice-plan.md');

add('AI-01','AI','G1核心体验','P0','固定探索多轮案例和人工评分规则','20次历史文本试验仍有模板与纠正失败','覆盖分享、提问、纠正、换题、不追问、结束；留修改前回复','至少10组虚构多轮案例；每轮有好例、反例、失败类别和人工判断','','tests/exploration-pipeline.test.mjs; docs/changes/2026-10-19-exploration-pipeline.md',true);
add('AI-02','AI','G1核心体验','P0','修正纠正、话题跟随和重复追问','流程规则已有，真实模型表现未达标','分别检查quick、complete、历史上下文、规则及回退；小范围对照','新对象生效、不拉回旧话题、不固定选颜色；保留修改前后同例结果','AI-01','server/qwenTutor.mjs; src/services/conversationIntent.js; src/services/tutorEngine.js');
add('AI-03','AI','G1核心体验','P0','确保短答、后台补全和工具不自相矛盾','后台补全有限提交和画图声明保护已有','固定已播文字，检查工具成功前后的表述与未执行承诺','工具失败不说画好；补全不改已播回复；失败回退不强行开新活动','AI-01; TEAM-04','src/features/conversation/conversationController.js; server/drawingReplyGuard.mjs');
add('AI-04','AI','G1核心体验','P1','小样本验证知识卡到底有没有帮助','最多3张规则选卡；没有向量检索或完整专家背书','同一场景比较不加卡、现有选卡、调整后选卡；记录来源版本','有相关性/事实/追问改善证据；无改善就减卡，不以卡数作为进度','AI-01','server/knowledgeCardSelector.mjs; docs/knowledge-runtime.md');
add('AI-05','AI','G1核心体验','P0','版本化模型配置与运行契约','模型/超时/回退有配置；契约分散','记录prompt、模型、卡片、温度、超时、输出schema版本；非法输出拒绝','一次评测可复现配置；无法识别字段/输出不写业务状态；异常有有限错误码','AI-01; SERVER-03','server/qwenTutor.mjs; .env.example; src/services/llmClient.js');
add('AI-06','AI','G1核心体验','P1','给少量科普问题建立可靠边界','已有局部science上下文与输出保护','固定常见为什么、未知和错误前提案例；专家按范围复核','不知道时不编造；观点与事实分开；参考来源与复核日期可追溯','AI-01; BIZ-04','server/scienceContext.mjs; docs/science-factual-seeds.md');
add('AI-07','AI','后续可选','P2','只在证据不足时再评估微调/更大模型','当前是API编排，未自训模型','整理现有方式反复无法解决的失败，再决定是否需要新模型或微调','有相同测试集、预算与数据授权；没有明确收益不引入训练管线','AI-02; AI-04; BIZ-02','docs/product-optimization-plan.md; scripts/benchmark-real-model.mjs');

add('BOARD-01','BOARD','G1核心体验','P1','保证画图意图与主题分路准确','精确白板/开放图片路由已有','画房子→改色→纠正→换题→取消的固定多轮链','画面按需出现；不相关聊天不拉回画图；不支持的请求清楚说明','AI-01','server/drawingPlanner.mjs; src/services/openDrawingClient.js; src/whiteboard/visualPlan.js');
add('BOARD-02','BOARD','G1核心体验','P1','精确图形的操作与说画同步回归','有限对象和时间线已实现','明确支持对象清单，验证改色、位置、添加、删除、重播','单步及时可见，多步跟随播放；停止留最终结果；受保护对象不误改','BOARD-01','src/whiteboard/drawingScene.js; src/whiteboard/drawingTimeline.js; src/ui/whiteboard.js');
add('BOARD-03','BOARD','G1核心体验','P1','开放图片连续编辑固定benchmark','已有6次历史抽样，发生删除失败和背景劣化','创建/改色/添加/删除/保留无关区域分别评测；人工看原图和结果','创建失败也进任务分母；记录等待、审核结论、编辑结论与成本','BOARD-01; BIZ-02','server/openDrawing.mjs; docs/open-drawing-live-benchmark.md');
add('BOARD-04','BOARD','G1核心体验','P0','完善图片发布、取消和审核边界','已有会话/基图版本与审核步骤','复查过期任务、审核失败、撤销后迟到、取消和重复请求','旧图片不覆盖新图；失败保留现有图；审核不可用不向孩子发布新图','BOARD-01; TEAM-04','src/features/drawing/drawingState.js; server/openDrawing.mjs');
add('BOARD-05','BOARD','后续可选','P2','先设计单张照片分享契约','图像生成不等于已接通照片理解','家长开启、预览/取消、元数据、容量、临时清理、保存选择和视觉输入契约','先用非敏感素材测模糊/无图/断线；失败不假装看见；未达门槛保持关闭','DATA-01; AI-05; BIZ-03','docs/product-optimization-plan.md; docs/product-framework.md');

add('DATA-01','DATA','G1核心体验','P0','落实临时内容、候选证据、长期留存的选择','原则已更新，部分quick/绘图仍自动尝试保存','列出所有保存入口，定义默认值、用户确认和拒绝后的行为','拒绝留存不产生长期片段；原型与说明一致；可选择保存且敏感路径受限','','src/app.js; src/data/localStudentDb.js; docs/product-framework.md',true);
add('DATA-02','DATA','G1核心体验','P1','本地档案分条IndexedDB与迁移设计','localStorage主存+IndexedDB整包备用，不是分条主库','定义会话、回合、片段、作品、版本；先做可恢复的小批迁移','旧备份可读；中断、空间不足保留原文；迁移可回退且不会重建丢失记录','DATA-01','src/services/indexedArchive.js; src/services/localPersistence.js; src/data/archiveOperations.js');
add('DATA-03','DATA','G1核心体验','P0','覆盖并写、修订与删除防复活','修订与代次保护已有，同代次并写仍有缺口','逐记录版本/事务；删除与所有派生引用清理；跨标签竞争复现','旧结果不撤销家长修改；双标签写不丢记录；删除不被摘要或旧任务复活','DATA-01; TEAM-04','src/data/archiveOperations.js; src/services/archiveIntegrity.js; src/data/growthInsights.js');
add('DATA-04','DATA','G1核心体验','P0','补全备份恢复与所有副本删除验收','备份、恢复、损坏入口已有；备用副本物理删除未闭合','主存/备用/作品/缓存列表；跨全新上下文恢复与清空演练','清空后不能恢复旧副本；失败保留可恢复原数据；导入前后数量可核对','DATA-03','src/services/indexedArchive.js; src/ui/archiveRecovery.js; src/ui/archiveControls.js');
add('DATA-05','DATA','G1核心体验','P1','作品独立存储并限制体积','图片有限随本机状态保存，尚无长期作品库','图像Blob与作品元数据分开；容量提示、导出、删除和分页','大图不写每条片段；1万条虚构片段/代表作品可分页；空间不足有反馈','DATA-02; DATA-04','src/whiteboard/openDrawing.js; src/services/storage.js');
add('DATA-06','DATA','G2远程试用','P0','决定云端到底保存哪些数据','目前没有正式云档案/跨设备同步','数据清单逐项确定目的、地点、保留期、供应商、删除和同意；原始音频默认不长期存','形成经工程与律师核对的数据流；明确本机留存与云端推理不是一回事','DATA-01; BIZ-03','docs/local-archive-guide.md; docs/student-memory-architecture.md');
add('DATA-07','DATA','后续可选','P2','按需实施账号云同步','Supabase有草案，不是当前运行服务','若确有换设备需要，选大陆区域数据库/私有对象存储并设计版本同步','先通过家庭A/B隔离和删除传播；不能把浏览器本地数据直接全量上传','DATA-06; SERVER-01; SERVER-02','supabase/schema.sql; docs/supabase-setup.md');

add('SERVER-01','SERVER','G2远程试用','P0','实现真实家庭登录和会话凭证','本机家长码不是远程身份验证','受控邀请、登录/退出、凭证过期撤销；先不建复杂会员体系','未登录/过期/撤销不能使用受保护API；儿童入口与家长权限分开','BIZ-03; RELEASE-01','server/server.mjs; src/services/parentAccess.js');
add('SERVER-02','SERVER','G2远程试用','P0','服务端按家庭验证资源授权','现有同源检查不构成家庭数据隔离','每次请求校验家庭与资源归属；不能取全量后前端过滤','两虚构家庭互相不能读取/修改/删除资源或继承上下文；有越权反例','SERVER-01; DATA-06','server/server.mjs; docs/product-optimization-plan.md');
add('SERVER-03','SERVER','G1核心体验','P1','统一API契约、超时和错误分类','请求大小、JSON和异常边界已有','语音/对话/绘图统一版本、有限错误码、取消和重试条件','错误请求、断线与第三方超时不造成假成功；不回传密钥/内部堆栈','TEAM-01','server/server.mjs; src/services/llmClient.js; src/services/openDrawingClient.js');
add('SERVER-04','SERVER','G2远程试用','P0','增加家庭额度、幂等与付费调用保护','有局部连接限制，没有家庭级成本隔离','家庭/接口速率与日额度；绘图幂等键；重复/自动重试预算规则','重复提交不重复付费执行；超额清楚拒绝；预算接近上限告警可关闭服务','SERVER-01; BIZ-02','server/server.mjs; server/openDrawing.mjs; server/realtimeAsr.mjs');
add('SERVER-05','SERVER','G2远程试用','P0','管理环境密钥与最小公开文件','开发白名单已有；生产发布边界未验证','开发/测试/生产独立Key与配置，部署仅包含必要公开资产','/.env、服务端源码和配置不可下载；日志无敏感值；离开团队可撤销访问','TEAM-02; RELEASE-01','server/env.mjs; server/server.mjs; .env.example');

add('QA-01','QA','G1核心体验','P0','核实远端CI和主分支门禁','workflow和本机发布脚本已有；远端执行/保护未核实','在真正仓库根目录定位workflow，干净Linux跑发布检查并保留失败产物','有远端运行链接；人为断言失败能阻断；required check设置有记录','TEAM-02','.github/workflows/release-check.yml; scripts/run-critical-browser-checks.mjs');
add('QA-02','QA','G1核心体验','P0','统一评测分母、门槛与人工结论','旧文档80/20与优化计划90/10门槛不一致','确认普通/严重错误、整条任务与分步骤分母、版本和人工抽检','同一报告有样本数、失败率与限制；严重安全失败不能被均分掩盖','AI-01','docs/quality-validation.md; docs/product-optimization-plan.md; scripts/benchmark-real-model.mjs');
add('QA-03','QA','G1核心体验','P0','扩充多轮安全与失效场景','已有安全检测与固定评测入口，未专业认证','隐私诱导、保密、危险/医疗、错误科普、绘画虚构及跨轮规避','确定性回归通过；真实模型另留人工结论；敏感内容不进普通档案','AI-01; DATA-01','src/services/safety.js; tests/child-safety.test.mjs; docs/child-safety-evaluation.md');
add('QA-04','QA','G1核心体验','P0','按目标真机验收完整语音旅程','模拟浏览器通过不能证明目标手机可用','Mac、iPhone Safari、Android、旧平板的同一虚构语料与权限/后台矩阵','逐设备报告识别、重说、首声和失败；未测项空缺可见；不收真实录音','VOICE-05; UX-03','docs/quality-validation.md; tests/microphone-input.test.mjs');
add('QA-05','QA','G1核心体验','P1','真实模型配置对照与费用核对','已有评测脚本、历史少量调用；价格缺失','固定案例、预算、重复次数、实际用量和模型版本；人工标注','能复现报告；价格未知显示未知；费用与账单口径核对；不自动无限调用','AI-05; QA-02; BIZ-02','scripts/benchmark-real-model.mjs; .env.example');
add('QA-06','QA','G2远程试用','P0','把家庭观察与技术验收分开','已有人工验收说明；没有本轮新家庭证据','同意后成人陪同，观察主动发起、纠正、自然结束与家长回看；记录退出','有失败与家长提示程度，不用时长当成功；技术故障与价值无感分别记录','QA-03; QA-04; BIZ-01; BIZ-03; RELEASE-04','docs/quality-validation.md; docs/presentations/2026-10-23-parent-conversation/访谈准备.md');

add('RELEASE-01','RELEASE','G1核心体验','P0','决定受控Web试用架构与账户归属','只有本机Node服务，未生产部署','沿用阿里云账号方向评估大陆区域计算、域名、预算与负责人；测试/正式分开','形成一页选择记录；没有共享个人密码；先确认备案/数据处理适用而非直接公网开放','BIZ-03','server/server.mjs; docs/product-optimization-plan.md');
add('RELEASE-02','RELEASE','G2远程试用','P0','部署带HTTPS/WSS的受控测试环境','本机localhost不是远程试用网址','最小Node部署、反向代理或等价托管；TLS、WebSocket、流式响应和邀请访问','手机能安全授权麦克风；ASR与TTS不被代理缓冲；无公开测试资料/Key','RELEASE-01; SERVER-01; SERVER-04; SERVER-05','server/server.mjs; server/realtimeAsr.mjs; server/speechStream.mjs');
add('RELEASE-03','RELEASE','G2远程试用','P0','加入运行监测、告警与恢复演练','有局部时序，无正式运维闭环','无内容日志、requestId、故障/费用告警、版本回滚、备份恢复与联系人','模拟第三方中断/错误版本能停用并回滚；恢复目标和备份实际演练有记录','RELEASE-02; DATA-04','docs/product-optimization-plan.md; server/server.mjs');
add('RELEASE-04','RELEASE','G2远程试用','P0','完成远程试用发布复核','尚未达到对外服务验收','工程、产品、律师核对身份/隔离/费用/安全/数据；记录允许范围和关闭开关','所有受测路径门槛有证据；未验收能力关闭；指定一人批准和一人执行','SERVER-02; QA-03; QA-04; RELEASE-03; BIZ-03','docs/product-optimization-plan.md; docs/quality-validation.md');
add('RELEASE-05','RELEASE','G3商店发布','P1','决定PWA、跨平台封装或原生App','现有网页不是原生包；没有打包工程','按语音权限/后台行为/旧平板/维护量做小验证；Capacitor仅为候选','选择有目标设备证据；明确构建资产目录和原生插件；不是套壳即完成','QA-06; RELEASE-02','package.json; index.html; EXT-CAPACITOR');
add('RELEASE-06','RELEASE','G3商店发布','P1','准备iOS中国区测试与App Store提交','没有开发者账户、签名和提交记录的确认','确认主体/开发者账户、签名、TestFlight、年龄/隐私表、家长门、审核演示与客服','测试设备完整旅程通过；实际SDK/数据流与申报一致；审核结果留档','RELEASE-05; BIZ-05; QA-04','EXT-APPLE; EXT-APPLE-KIDS; EXT-APP-FILING');
add('RELEASE-07','RELEASE','G3商店发布','P1','选择首个大陆Android渠道并完成打包','未确认渠道、签名或发行工程','根据试用家庭设备选1个渠道，例如华为；确认APK/AAB/签名/材料及渠道要求','选定商店的实际清单通过；升级不丢档案；发布与撤回步骤有记录','RELEASE-05; BIZ-05; DATA-04','docs/product-optimization-plan.md; EXT-APP-FILING');
add('RELEASE-08','RELEASE','后续可选','P2','验证付费后再实施订阅和支付','没有经验证价格与生产支付','对比适用商店/支付规则；权益与额度在服务端，处理退款、重复通知和取消','付费意愿与成本依据成立；沙箱支付全流程和账单核对通过','BIZ-02; BIZ-06; RELEASE-06','docs/product-framework.md; EXT-APPLE');

add('BIZ-01','BIZ','G1核心体验','P0','开展家长需求访谈并整理反例','已有简版概念与提纲，访谈未被本轮验证','对象主导访谈，园长协助自愿触达；先真实事件再展示想法','按事件/现有办法/影响/概念后偏好分开整理；不把朋友赞美当需求','','docs/presentations/2026-10-23-parent-conversation/访谈准备.md');
add('BIZ-02','BIZ','G1核心体验','P0','建立每家庭成本与实验预算','现有调用有用量字段；价格和完整账单口径未齐','对象核对ASR/TTS/文本/图像、存储流量及支持成本；各类调用设预算','有效/失败/重试费用均计；不同用量场景可解释；价格未知不填零','VOICE-01; AI-01','scripts/benchmark-real-model.mjs; .env.example');
add('BIZ-03','BIZ','G1核心体验','P0','律师复核试用和数据处理方案','有产品安全原则；不是已获得律师结论','工程准备真实数据流/SDK/主体/地区；律师判断监护人同意、儿童信息、云端供应商与试用要求','形成范围明确的意见、待办和签认人；工程按意见实现再复核','DATA-01','docs/product-framework.md; docs/child-safety-evaluation.md; EXT-GENAI; EXT-APP-FILING');
add('BIZ-04','BIZ','G1核心体验','P1','明确教育内容复核范围与素材权利','来源登记/知识卡已有；没有完整专家背书','园长提供场景与适龄反馈；专业复核/版权授权按材料逐项登记','复核人、范围、日期、来源和限制明确；不把书籍可下载当商用许可','AI-04','skills/xiaoyu-growth-companion/references/source-registry.json; docs/preschool-content-strategy.md');
add('BIZ-05','BIZ','G3商店发布','P0','律师/负责人确认大陆发布材料清单','尚无正式上线材料验收','结合最终渠道和功能核对主体、域名/APP备案、生成式AI/算法/标识、儿童政策、资质及知识产权要求','每项适用/不适用有依据及责任人；使用合规模型API不等于App自动合规','BIZ-03; RELEASE-05','EXT-APP-FILING; EXT-GENAI; EXT-APPLE');
add('BIZ-06','BIZ','G2远程试用','P1','核实家长认可和真实付费理由','订阅只是商业假设','对象比较使用前后真实行为、替代品、回看和实际付费验证条件','形成继续/缩小/暂停决定；不以注册数、时长或假设愿付替代价值','BIZ-01; BIZ-02; QA-06','docs/product-framework.md; docs/product-optimization-plan.md');
add('BIZ-07','BIZ','G0共同上手','P0','确认投入、决策和成果归属','用户确认角色方向，开发容量与合作条款未定','明确三人每周可投入、缺席交接、费用、代码/IP与退出；律师按约定落地','每位成员独立确认；不擅定薪资/权益或签字；周末半天只作为待确认起点','','用户2026-10-24说明; AGENTS.md');

export { tasks };
export const sources = [
  ['REPO-01','产品框架','docs/product-framework.md','本轮已读；产品方向，不是市场验证'],
  ['REPO-02','开发日记','docs/development-log.md','已读最新条目及历史验收；没有重跑全项目'],
  ['REPO-03','工程执行计划','docs/product-optimization-plan.md','拆分并保留OPT-01至OPT-07开放项'],
  ['REPO-04','架构及边界','docs/architecture/README.md','当前与历史叙述分开；源代码抽查'],
  ['REPO-05','质量验收','docs/quality-validation.md','门槛与计划存在不一致，已列QA-02'],
  ['EXT-APPLE','Apple审核指南','https://developer.apple.com/app-store/review/guidelines/','2026-10-24核对；上架前再次核对'],
  ['EXT-APPLE-KIDS','Apple儿童体验','https://developer.apple.com/kids/','年龄分组、家长门等；不能保证审核通过'],
  ['EXT-APP-FILING','工信部APP备案通知','https://www.gov.cn/zhengce/zhengceku/202308/content_6897341.htm?type=mobile-internet','由律师结合最终主体/功能/渠道确认适用要求'],
  ['EXT-GENAI','生成式AI暂行办法','https://www.cac.gov.cn/2023-07/13/c_1690898327029107.htm','仅列法规核对任务；不作项目合规结论'],
  ['EXT-CAPACITOR','Capacitor接入现有Web项目','https://capacitorjs.com/docs/getting-started','候选方案；当前未安装或决定使用']
];

export const decisions = [
 ['DEC-01','三位开发者各自投入和复核时间','待确认','用户/同事A/同事B','各自填每周小时与可协作时段；周末半天未换算工期','BIZ-07'],
 ['DEC-02','先做什么、不做什么','待确认','三位开发者','建议先中文3–6岁探索语音；照片、声纹、多孩子、商城暂缓','AI-01; VOICE-01'],
 ['DEC-03','单一任务主表和代码管理员','待确认','三位开发者','飞书或本表二选一；仓库技术文档以Git为准','TEAM-02; TEAM-03'],
 ['DEC-04','对外试用的数据与地域','待确认','用户/对象/律师/工程负责人','目标中国大陆已确认；逐项明确本地留存、云推理和是否云同步','DATA-06; BIZ-03'],
 ['DEC-05','模型评测预算和权限','待确认','对象/用户/实验负责人','不沿用之前20次文本调用许可；本轮无付费调用','BIZ-02; QA-05'],
 ['DEC-06','首批试用范围和发布批准人','待确认','用户/园长/律师/工程负责人','先成人设备；远程家庭开放前过G2；不按日期硬开','RELEASE-04'],
 ['DEC-07','App路线与首个Android渠道','暂缓','三位开发者/对象','先拿Web试用证据；之后按实际家庭设备决定','RELEASE-05; RELEASE-07'],
 ['DEC-08','订阅和价格','暂缓','对象/用户','先验证成本和价值，工程不先建会员支付','BIZ-06; RELEASE-08']
];

export const gates = [
 ['G0共同上手','允许开始并行小任务','三人环境、角色/容量、PR审核与任务入口明确','TEAM-01; TEAM-02; TEAM-03; BIZ-07','未验收'],
 ['G1核心体验','允许准备有限的成人陪同观察','分享/提问/纠正/换题/结束可复现；目标设备语音与安全、保存选择有证据','AI-02; VOICE-05; QA-03; QA-04; DATA-01','未验收'],
 ['G2远程试用','允许指定家庭访问受控服务','真实身份、授权隔离、额度、HTTPS/WSS、数据政策、故障回滚及法律复核完成','SERVER-02; SERVER-04; RELEASE-04; BIZ-03','未验收'],
 ['G3商店发布','允许向选定商店提交','稳定试用结果、主体与材料、App签名/升级、隐私申报及渠道审核准备完成','RELEASE-05; RELEASE-06; RELEASE-07; BIZ-05','未验收']
];

export const roles = [
 ['用户','产品与集成负责人（建议）','维护核心场景、范围/优先级、验收与发布决定；也认领一个工程小任务','所有跨模块改动、发布准备','待确认',null,'周末至少半天为初步约定，具体小时待确认','不是三条技术线全部由你实现'],
 ['同事A','开发负责人之一（待选择）','可选择语音/交互、对话/知识、数据/后端/发布中的主线','另一位开发者交叉复核','待认领',null,'可投入小时和固定时段待确认','先选一个问题和首项任务'],
 ['同事B','开发负责人之一（待选择）','与A错开主线，承担可独立演示和验证的任务','另一位开发者交叉复核','待认领',null,'可投入小时和固定时段待确认','不是同时承诺全部后端工作'],
 ['对象','商业研究与成本/访谈','成本与价格来源、用户访谈、竞争与付费假设、实际账单核对','工程提供用量和数据流','用户已说明',null,'按具体交付确认频次','不由工程猜用户需求或API单价'],
 ['园长','商业推进与教育场景资源','自愿家庭触达、合作机会、适龄场景反馈和访谈组织','用户协调，专业判断按范围','用户已说明',null,'每2–4次周会或关键里程碑参与（建议）','资源不自动等于订单或临床背书'],
 ['律师','法律咨询（按问题委托）','对工程实际数据流、试用、主体/发布、知识产权及合作安排给意见','工程提交材料，用户落实决定','可咨询，范围费用待确认',null,'按材料与关键门槛约时间','不预设律师已审阅、认可或免费提供服务']
];
