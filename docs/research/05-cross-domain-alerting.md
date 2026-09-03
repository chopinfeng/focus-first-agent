# 调研五：跨领域告警设计（SRE / 航空 / 医疗 / 过程控制 / ATC / 消费级通知）

## (a) 各领域的规则、数字与机制

### 1. SRE / On-call
- Ewaschuk：page 必须 **urgent、important、actionable、real**；**对症状告警，不对原因告警**，原因放正文；"过度监控比监控不足更难治"。
- Google SRE Workbook 多窗口多燃烧率：1h 窗口 burn rate > 14.4 → page；6h > 6 → ticket；3d > 1 → 周评审；短窗口 = 长窗口的 1/12。基准：**每班 2–3 个可操作事件，≥8–10 需审计**；alert:incident 健康比 1:1–2:1；signal-to-noise < 50% 或每班 page > 5 视作可靠性事故。
- PagerDuty：`dedup_key` 合并；时间窗分组；escalation 仅在**未 ack** 时升级，ack 即停；snooze 阻止升级不阻止新 incident；auto-resolve；按 severity 选渠道；MTTA < 5 分钟。

### 2. 航空驾驶舱
- FAA AC 25.1322-1 三级：**Warning**（立即知晓+立即响应）/ **Caution**（立即知晓+后续响应）/ **Advisory**（知晓）。Warning/Caution 需至少两种感官；每次提示可确认可抑制；手动抑制必须有**清晰的"已抑制"指示**；系统必须抑制会干扰专注的错误提示（737 MAX stick shaker 无法抑制被 NTSB 点名）。
- Airbus FWC：**T.O. INHIBIT**（推力设定→1500ft）、**LDG INHIBIT**（800ft→减速 80kt）期间抑制非关键告警，退出阶段**自动重现**或 RCL 手动召回。ECAM "see-and-do"：告警自动带出处置清单。
- **Dark cockpit**：正常时什么都不亮。
- 教训：737 MAX 多告警叠加，Boeing 假设"4 秒内正确响应"未考虑叠加；AF447 失速警告启停 75 次，机组误判——**抖动比持续更有害**。

### 3. 医疗警报疲劳
- **85–99% 的 ICU 音频警报不可操作**；每床每天 350–700 次；2009–2012 年 98 起哨兵事件、80 人死亡。
- Joint Commission NPSG.06.01.01：领导层定优先级 → 数据识别重要警报 → 阈值/关闭权限/响应责任政策 → 培训。
- 干预效果：Boston Medical Center -89%；Johns Hopkins -43%，仅 SpO2 下限 90%→88% 就 -63%；行业 12–24 个月 -30% 到 -90%。手法：**默认阈值放宽、触发延迟、去重、二级响应人、明确谁有权改设置**。

### 4. 过程控制 / 核电（EEMUA 191 / ISA-18.2）
- 速率：**稳态 < 1 条/10 min/操作员**；< 6 条/h 可接受，< 12 条/h 最大可管理；**≥10 条/10 min = alarm flood**，窗口新增 < 5 条才结束。
- **常驻告警 < 10 条/操作员**；消除 chattering。
- 优先级分布 **~80% 低 / 15% 中 / 5% 高**；分布变平 = 后果分析不足。
- "不需要操作员响应的通知不是告警"；每条告警记录**原因、后果、应做动作、允许响应时间**；rationalization 通常删掉 30–60%。机制：**shelving**（临时搁置、自动到期）、**state-based suppression**。
- TMI：最初几分钟 > 100 条告警，无优先级。

### 5. ATC / 监督控制
- Cummings：利用率 > 70% 性能衰减。
- Sheridan：**Management by consent**（批准后执行）vs **management by exception**（否决窗口，超时即执行）；consent 质量更好，exception 吞吐更高，按风险选。
- Endsley：自适应自动化要显式定义切换时机与权责。

### 6. 消费级通知
- Apple 四级：**Passive** / **Active** / **Time Sensitive**（穿透 Focus）/ **Critical**（穿透静音，需审批）；Notification Summary 按时段批量。
- Android channel importance HIGH / DEFAULT / LOW / MIN，用户可按 channel 覆盖。
- Slack 通知时间表 + snooze + 恢复后集中查看；Teams/Viva focus time，**priority contacts 始终穿透**。
- Gmail Priority Inbox 按"会采取行动的概率"排序：阅读时间 -6%，读不重要邮件 -13%。

## (b) 借鉴机制 → FFA 组件映射

| 借鉴机制 | 来源 | FFA 组件 | 具体调整 |
|---|---|---|---|
| Alarm flood | ISA-18.2 | Scheduler | 10 min ≥10 条 → 折叠为单条 flood 项，仅透出 P0；窗口新增 <5 条退出 |
| 速率上限 | EEMUA 191 | 预算 | 预算改为速率型：≤1/10min、≤6/h 滚动窗口 |
| 80/15/5 分布 | ISA-18.2 | 指标/账本 | 新增 priority distribution；某 agent P0+P1 占比 >20% → 降其标定权限 |
| Standing < 10 | EEMUA 191 | Inbox | 未处理 >10 → 停止新增 soon 级，强制合并/过期 |
| Rationalization | ISA-18.2 / Ewaschuk | AR schema | 必填 `required_action / consequence_if_ignored / time_to_irreversible`，缺项只能进 digest |
| 症状 vs 原因 | Ewaschuk | AR schema | headline 描述对人的影响，原因折叠进 context |
| 多窗口 burn rate | SRE | 预算 | 短/长双窗口判断预算消耗 |
| Ack 即停 / snooze 语义 | PagerDuty | 升级阶梯 | ack 停梯子；snooze 只压当前 AR |
| dedup + 时间窗 | PagerDuty | 合并 | 无 batch_key 但同 agent 同 risk 的 5 min 内合并 |
| Auto-resolve | PagerDuty | TTL | 到期 auto-resolved 进 digest |
| W/C/A 三级 | AC 25.1322 | Urgency × Risk | Warning = push+第二人；Caution = inbox+peripheral；Advisory = digest |
| 阶段抑制 + 自动召回 | Airbus | Quiet hours | 抑制而非丢弃，退出自动重现，显示"N 条已抑制" |
| 抑制必须可见 | AC 25.1322 | 状态灯 | shelved 独立态 |
| Dark cockpit | Airbus | 状态灯 | working 不亮 |
| 禁止抖动 | AF447 | Scheduler | 同一 AR 24h ≥3 次 → chattering，转"修规则"AR |
| 多告警叠加 | NTSB | 指标 | 同时未处理 P0/P1 >3 视为缺陷 |
| 阈值放宽 + 延迟 | 医疗 | AR 生成 | `confirm_delay` 30–120s，自愈即撤回 |
| 二级响应人 | 医疗 / PagerDuty | 升级阶梯 | 从过滤后的 AR 触发 |
| 治理 | NPSG | 账本 | 阈值修改记录责任人，agent 不能自改 |
| Consent vs Exception | Sheridan | 自治模式 | P0/不可逆 = consent；P2/可逆 = exception；P3 = 事后通知 |
| Apple 四级 | Apple | 渠道 | whenever→Passive；soon→Active；now→Time-Sensitive；Critical 需预授权 |
| Priority contacts | Teams | Quiet hours | 穿透白名单 |
| 行动概率排序 | Gmail | Digest | 按历史响应概率排序 |
| 不可操作率 | 医疗 | 指标 | rubber-stamp > 50% 触发 rationalization 审计 |

## (c) 按影响排序的设计变更
1. AR 准入门槛（rationalization）：三个必填字段，缺项只能进 digest
2. 速率型预算 + flood 模式
3. 三级告警 × 自治模式绑定（Warning=consent+push；Caution=consent+inbox；Advisory=exception）
4. 阶段抑制 + 自动召回
5. Dark cockpit 状态灯
6. Chattering 检测
7. confirm_delay
8. 优先级分布治理
9. Ack / snooze / auto-resolve 语义
10. 并发告警指标
11. 穿透白名单 + Critical 预授权
12. Digest 行动概率排序

## (d) Sources
- https://docs.google.com/document/d/199PqyG3UsyXlwieHaqbGiWVa8eMWi8zzAn0YfcApr8Q/edit
- https://sre.google/workbook/alerting-on-slos/
- https://incident.io/blog/on-call-best-practices-guide-2026
- https://pingfatigue.com/alert-to-incident-ratio
- https://support.pagerduty.com/main/docs/event-management
- https://support.pagerduty.com/main/docs/noise-reduction
- https://support.pagerduty.com/main/docs/time-based-alert-grouping
- https://www.faa.gov/documentLibrary/media/Advisory_Circular/AC_25.1322-1.pdf
- https://www.aviationhunt.com/airbus-a320-flight-phases/
- https://simpleflying.com/what-pilots-notice-switching-airbus-a350-boeing-787-cockpits/
- https://www.ntsb.gov/investigations/AccidentReports/Reports/ASR1901.pdf
- https://www.flightglobal.com/stall-warning-controversy-haunts-af447-inquiry/101420.article
- https://pingfatigue.com/joint-commission-npsg-06-01-01
- https://www.clinician.com/articles/62840-johns-hopkins-reports-that-it-has-reduced-bedside-alarms-up-to-74-in-some-units
- https://array.aami.org/doi/full/10.2345/0899-8205-56.1.19
- https://www.instrumentationblog.in/alarm-management-isa-18-2/
- https://railnetops.com/guides/alarm-flood-reduction-rail-control-rooms/
- https://www.exida.com/images/uploads/18492275-Alarm-Management-for-Process-Control.pdf
- https://onlineethics.virginia.edu/cases/three-mile-island-nuclear-accident
- https://journals.sagepub.com/doi/10.1518/001872007779598109
- http://www.dodccrp.org/files/IC2J_v1n2_01_Cummings.pdf
- https://www.hfes.org/Portals/0/Documents/Sheridan.pdf
- https://hf.tc.faa.gov/publications/2000-situation-awareness-in-air-traffic-control/
- https://documentation.onesignal.com/docs/en/ios-focus-modes-and-interruption-levels
- https://developer.android.com/develop/ui/compose/notifications/channels
- https://slack.com/help/articles/214908388-Pause-your-Slack-notifications
- https://research.google.com/pubs/archive/36955.pdf
- https://techcrunch.com/2010/12/06/gmail-priority-inbox-stats/
