# 客製化試算完成後自動建立提醒事項（Auto-Reminders）施工說明書

> **版本**：0.1（施工前設計定稿）
> **狀態**：Ready for implementation — 尚未落地
> **日期**：2026-09-04
> **讀者**：Web/BFF 工程師、RM 產品負責人
> **相關文件**：[`docs/design/overlay-drift-sync.md`](./overlay-drift-sync.md)（drift 主管門檻與 audit 留痕）、[`docs/design/needs-driven-weight-bounds.md`](./needs-driven-weight-bounds.md)（`needs_attainment` 與 `class_quota_unfilled` 訊號來源）
> **適用程式碼**：`apps/web`（Next.js 15 BFF + UI）；**不動** `apps/api` 引擎
> **已確認決策**：① 提醒事項**只有 RM 本人看**（個人待辦，不對客戶分享）→ Phase 1 採 localStorage（比照 `demo-clients-store.ts` 的 extra notes/events 模式），無多使用者同步問題；② 報告頁的完成 banner 為目前開發中的畫面，**可任意調整**——提醒 chip 直接整合進 `RmReportView` 頁首。

---

## 1. 目標與範圍

### 1.1 問題陳述

客製化投組試算完成後，結果頁（RmReportView）已呈現大量「需要後續行動」的訊號：需求未達標（needs attainment 紅燈）、空類別配額（`class_quota_unfilled`）、待主管簽核能力（pending capabilities banner）、分批部署計畫（DCA）、定期再平衡頻率等。但這些訊號**只活在報告頁面上**——RM 關掉分頁後就沒有任何機制提醒他「兩週後該再平衡」「這位客戶的回撤容忍沒達標要約談」「有三項能力還等主管簽」。典型遺漏路徑：

1. RM 為客戶跑完客製化試算，`needs_attainment` 顯示單一持股上限未達標（within_single_name_cap=false）。
2. RM 口頭告知客戶「會再調整」，關閉報告。
3. 三週後無人跟進——沒有任何系統紀錄這個未決事項。

### 1.2 目標（本功能要做的）

| # | 目標 | 說明 |
|---|---|---|
| G1 | **完成時自動派生提醒** | 客製化 job「新鮮完成」（fresh complete）時，從 request/result/overlay 訊號以規則引擎 R1–R4 派生提醒，寫入該客戶的 localStorage 提醒清單。 |
| G2 | **RM 個人待辦，不對客戶** | 提醒僅存在 RM 瀏覽器 localStorage，不送引擎、不進報告匯出、不出現在任何客戶可見文案中。 |
| G3 | **完成 banner 整合** | 試算完成進入 RM 報告時，頁首顯示「已建立 N 項提醒」chip，點擊跳轉客戶頁提醒面板。 |
| G4 | **客戶頁提醒面板** | `ClientRemindersPanel` 掛在客戶明細頁，支援篩選（待處理/已完成/已忽略）、標記完成、忽略；R6 類「建議」提醒需 RM 確認才轉正。 |
| G5 | **冪等與自動結案** | 同一 job 重複派生不產生重複（dedupe key）；同一客戶同一主題不堆疊（subject key 原地更新）；修復後的新 job 完成時自動把已解決的 R1/R4 提醒結案。 |
| G6 | **歷史還原不補建** | 從歷史紀錄/深連結重新開啟舊 job（`loadHistoricalJob`）**不**派生新提醒。 |

### 1.3 非目標（Explicit Non-Goals）

- **不改引擎**：`apps/api` 完全不動；提醒純前端產物。
- **不做伺服器端儲存 / 多裝置同步**：Phase 1 僅 localStorage；server store 列 Phase 2。
- **不做 email 摘要**：Phase 2 再評估（可複用現有 `notify_email` 管道，見 §11 相鄰機制）。
- **不阻擋任何流程**：提醒只是待辦清單，不擋列印、不擋重跑、不擋簽核。
- **不實作 LLM 文案生成**：Phase 1 提醒標題/內容一律由 i18n key + 參數組成（deterministic）；R5（LLM rerun_recommended）與 LLM 潤稿列 Phase 2。
- **不合併 `upcoming_events`**：提醒與客戶「近期事件」語意不同（§10.1），Phase 1 不自動互轉。

---

## 2. 現況分析

### 2.1 現行資料流（客製化試算完成路徑）

```
RM 啟動試算 → POST /jobs → 輪詢
新鮮完成（fresh complete）三條路徑（皆經 presentResult）：
  ① 單一 job：pollJob 完成分支（apps/web/src/app/page.tsx:581-591）
       → presentResult(id, res, req)                       （page.tsx:586）
  ② 現金客製單軌（skip-baseline）：page.tsx:890-896
       → recordCompletedBacktest(...) → presentResult(...) （page.tsx:896）
  ③ 雙軌（anchor + adjusted）：page.tsx:1016-1033
       → recordCompletedBacktest(base)（不重現）→ recordCompletedBacktest(adjusted)
       → presentResult(adjustedJob, ...)                   （page.tsx:1028-1033）
  ※ 另有 anchor 失敗變體：presentResult(adjusted, compare=null)（page.tsx:978-988）

歷史還原（非 fresh）：
  loadHistoricalJob（page.tsx:602-629）
    → 本地命中：presentResult(local.result, local.request)  （page.tsx:607）
    → API 命中：presentResult(res, req)                     （page.tsx:617,620）
  深連結 /?job=<id> → loadHistoricalJob                     （page.tsx:640-647）

presentResult（page.tsx:418-536）內部：
  → 解析 clientId（req.client_ref ?? local.clientId ?? signedOverlay.audit.client_ref，:426-430）
  → recordCompletedBacktest(id, effectiveReq, res, {...})   （:521-525）
       → upsertLocalBacktestHistory（backtest-history.ts:50-54）寫 localStorage
  → setPhase("results") → 渲染 RmReportView（page.tsx:1478-1498）
```

**關鍵觀察**：`recordCompletedBacktest`（backtest-history.ts:88-103）在 fresh 與 historical 路徑**都會**被呼叫（presentResult 內無條件呼叫），因此它**不是**「fresh-only」訊號——提醒派生不能直接掛在 `recordCompletedBacktest` 內，必須由呼叫端顯式區分（§3.5、§5-F5）。

### 2.2 提醒訊號來源盤點

| 訊號 | 位置 | 內容 |
|---|---|---|
| `needs_attainment` | `types.ts:269-309`（`PortfolioCandidate.needs_attainment`） | `within_drawdown_tolerance` / `within_single_name_cap` / `within_theme_cap` / `within_cash_reserve` / `within_income_need` / `within_must_include` / `within_customization_drift` / `within_class_quotas` / `within_group_bands` 等布林檢核 + actual/target 數值。 |
| `needsFloorRows()` | `needs-fulfillment.ts:74-170` | 既有 helper：把 `needs_attainment` 展平成 `{key, pass, detail}[]` 列（row key 對照表 `NEEDS_TABLE_I18N` 於 needs-fulfillment.ts:16-24）。R1 直接複用，`pass === false` 的列即未達標項。 |
| `class_quota_unfilled` | `result.narrative_facts.class_quota_unfilled`（消費例：RmReportView.tsx:671-687） | 空類別配額清單（`{asset_class, target_pct, reason?}[]`），needs-driven-weight-bounds G3 的產物。 |
| `rebalance_freq` / `end_date` | `types.ts:122`、`types.ts:103` | pandas 頻率碼（ME/QE/W-FRI/D…）；既有 `rebalanceFreqLabel`（i18n.tsx:5856-5866）定義了 W→週、ME/M/MS→月、Q→季、Y/A→年、D/B→日 的辨識規則，R2 比照。 |
| `deployment_months` / `deployment_tranches` / `cash_reserve_pct` | `types.ts:181-184`、`types.ts:177` | DCA 分批部署參數（月數、期數）與現金保留。 |
| `capabilities_used` | `types.ts:470`（`BacktestResult.capabilities_used`） | L2 能力使用快照；`pendingSupervisorCapabilities()`（proposal-capability-badge.ts:13-21）篩出 `pending_supervisor_signoff === true \|\| status === "rm_confirmed"`；消費例：RmReportView.tsx:159-167 的 `pendingCaps` 與 :443-460 的琥珀色 banner。 |
| `customization_drift` | `types.ts:160`；門檻 `DRIFT_OVERRIDE_RM_MAX = 0.6`（overlay-feasibility.ts:13）、`driftOverrideApproval()`（overlay-feasibility.ts:281-289） | drift > 60% 需主管核准留痕（overlay-drift-sync §8 政策）。 |
| `client_context.investment_horizon_years` | `types.ts:62` | 數值化投資年期（來自簽核 overlay）；fallback：`DemoClient.investment_horizon`（clients.ts:82，LocalizedText 字串，僅能萃取數字）。 |
| LLM `rerun_recommended` | `use-ai-talking-summary.ts:21,131`；產生端 `api/talking-summary/route.ts:113-118,202` | 非同步、LLM 判斷，報告頁已用於紅色警示卡（RmReportView.tsx:758-776）。**Phase 2**（R5）。 |

### 2.3 冠軍候選選取

派生提醒一律針對**冠軍組合**（RM 實際會拿給客戶的那一組）：`resolveChampionCandidateIndex(result.candidates, result.narrative_facts)`（performance-compare-chart.ts:287），用法先例見 backtest-history.ts:61-66；無冠軍時退回 `candidates[0]`。

### 2.4 可直接複用的現有機制

| 機制 | 位置 | 複用方式 |
|---|---|---|
| `demo-clients-store.ts` overrides 存取層 | storage key `jasper_demo_clients_overrides_v1`（:3-4）、`ClientProfileOverrides`（:12-15）、`readAll`/`writeAll`（:24-49）、`addClientEvent`（:85-106） | `ClientProfileOverrides` 加 `reminders?: ClientReminder[]`；readAll/writeAll、quota try/catch、id 生成（`{prefix}-{Date.now()}-{rand}`，:72,94）模式原樣沿用。 |
| `ClientCustomizedHistoryPanel` 重新整理模式 | ClientCustomizedHistoryPanel.tsx:31-47 | `refresh` + `focus`/`storage` 事件監聽（storage event 比對 key）——提醒面板跨分頁同步照抄此模式（key 改為 `DEMO_CLIENTS_OVERRIDES_STORAGE_KEY`）。 |
| `needsFloorRows` / `NEEDS_TABLE_I18N` | needs-fulfillment.ts:74-170, 16-24 | R1 列舉未達標項與 subject 標籤。 |
| `pendingSupervisorCapabilities` | proposal-capability-badge.ts:13-21 | R4 capability 分支判定，不重寫。 |
| `DRIFT_OVERRIDE_RM_MAX` / `driftOverrideApproval` | overlay-feasibility.ts:13, 281-289 | R4 drift 分支判定，不重寫。 |
| UTC-noon 日期解析 | clients.ts:318-319（`new Date(\`${d}T12:00:00Z\`)`，computeCagr） | R2/R3/R6 到期日運算避免時區翻日，照用。 |
| 多語日期格式 | RmReportView.tsx:705-709（`toLocaleString(lang === "zh" ? "zh-TW" : lang === "ko" ? "ko-KR" : "en-US", …)`） | 面板到期日顯示照用。 |
| 歷史 job 深連結格式 | ClientCustomizedHistoryPanel.tsx:99（`/?job=…&client=…`） | 提醒列「來源 job」連結同格式。 |

### 2.5 儲存現況

- `demo-clients-store.ts`：單一 localStorage key（`jasper_demo_clients_overrides_v1`），`Record<clientId, ClientProfileOverrides>`，目前欄位 `extra_notes`、`extra_events`——**新增 `reminders` 欄位完全不影響既有資料**（JSON 缺欄位即 undefined）。
- `backtest-history.ts`：`MAX_LOCAL_ENTRIES = 30`（:11）的淘汰先例；提醒各自設上限（§3.6）。

---

## 3. 核心設計

### 3.1 新模組 `apps/web/src/lib/reminders.ts`

純函式、無 React、無 LLM——與 `needs-fulfillment.ts`、`overlay-drift-sync.ts` 同級的 deterministic 模組。localStorage I/O 留在 `demo-clients-store.ts`（§3.6），本模組只做「派生」與「合併決策」，方便測試。

### 3.2 型別定義

```ts
import type { LocalizedText } from "@/lib/clients";

/** 提醒規則編號。R5/R6 為 Phase 2。 */
export type ReminderRuleId = "R1" | "R2" | "R3" | "R4" | "R5" | "R6";

/**
 * suggested：R6 類「建議型」提醒，需 RM 接受（→open）或忽略（→dismissed）。
 * open：正式待辦。done：完成（手動或自動結案）。dismissed：忽略。
 */
export type ReminderStatus = "suggested" | "open" | "done" | "dismissed";

export type ClientReminder = {
  id: string;                       // `rem-{Date.now()}-{rand}`（比照 note/event id）
  client_id: string;
  rule_id: ReminderRuleId;
  /** 機械主題鍵：如 "drawdown"、"rebalance"、"dca-tranche-2"、"supervisor-drift"。 */
  subject: string;
  /** 冪等鍵 `${job_id}:${rule_id}:${subject}` — 同一 job 重複派生不會重複。 */
  dedupe_key: string;
  /** 連續性鍵 `${rule_id}:${subject}` — 同一客戶同主題的 open/suggested 提醒只留一筆。 */
  subject_key: string;
  job_id: string;                   // 來源 job
  last_seen_job_id: string;         // 最近一次命中同 subject_key 的 job
  status: ReminderStatus;
  /** ISO 日期 YYYY-MM-DD；無到期概念（如 R1）可省略。 */
  due_date?: string;
  /** i18n 插值參數（標題/明細在渲染端組字，不存文案）。 */
  params?: Record<string, string | number>;
  created_at: string;               // ISO datetime
  updated_at: string;
  closed_at?: string;
  /** 自動結案來源（修復 run 的 job_id）；手動結案為 undefined。 */
  resolved_by_job_id?: string;
};

/** 每客戶提醒上限；超出時優先淘汰最舊的 done/dismissed。 */
export const MAX_REMINDERS_PER_CLIENT = 100;
/** 已結案提醒保留天數（寫入時順便清理）。 */
export const CLOSED_REMINDER_RETENTION_DAYS = 90;
```

**設計決策：不存文案字串，存 `rule_id` + `subject` + `params`**。渲染端以 `t("reminders.rule.r1.title", params)` 組字（§6）。理由：① 切換語言時既有提醒自動換語言（比照 narrative 重產生的語言跟隨原則）；② localStorage 不囤積三語重複文字；③ extra events 的 `toLocalized`（demo-clients-store.ts:19-22）是三語同文的妥協，自動派生提醒沒有這個限制。

### 3.3 派生引擎 `deriveReminders()`

```ts
export type DeriveRemindersInput = {
  jobId: string;
  clientId: string;
  request: BacktestRequest;
  result: BacktestResult;
  /** R6 年期 fallback 解析用；無則只用 client_context。 */
  client?: Pick<DemoClient, "investment_horizon"> | null;
  /** 注入時鐘方便測試；預設 new Date()。 */
  now?: Date;
};

/** 從完成的客製化 job 派生提醒（純函式；不含寫入、不含合併）。 */
export function deriveReminders(input: DeriveRemindersInput): ClientReminder[];
```

共同前置：

1. `clientId` trim 後為空 → 回傳 `[]`（非客戶 run 不派生）。
2. 冠軍 = `resolveChampionCandidateIndex(result.candidates, result.narrative_facts)`，無候選 → `[]`。
3. `completedAt = now`（job 完成時刻），`completedDateIso = toIsoDate(now)`。
4. 每條提醒組 `dedupe_key = ${jobId}:${rule}:${subject}`、`subject_key = ${rule}:${subject}`、`created_at = updated_at = now.toISOString()`。

#### R1 — 需求未滿足（auto，status=open）

- `na = champion.needs_attainment`；有值時 `needsFloorRows(na)`（needs-fulfillment.ts:74）逐列取 `pass === false` → 每列一筆：`subject = row.key`（如 `"drawdown"`、`"singleName"`、`"classQuota"`…），`params.detail = row.detail ?? ""`。
- `class_quota_unfilled`：`result.narrative_facts?.class_quota_unfilled` 為非空陣列時加一筆 `subject = "class_quota_unfilled"`，`params.classes = rows.map(r => r.asset_class).join(", ")`。**與 classQuota 列不互斥**：前者是「配額在 universe 中無成員、根本沒檢核到」（空類別），後者是「有檢核但未達標」——語意不同（needs-driven-weight-bounds §1.2 G3/G4）。
- `due_date`：不設（屬「儘速溝通」類）；排序權重見 §4.2。

#### R2 — 定期再平衡（auto，status=open）

- 觸發：`request.rebalance_freq` 可辨識且 `request.end_date` 合法。
- `due_date = nextRebalanceDate(request.end_date, request.rebalance_freq)`（§3.4）；不可辨識頻率回傳 null → 不派生。
- `subject = "rebalance"`；`params.freq = rebalance_freq`（原始碼，渲染端過 `rebalanceFreqLabel`）、`params.end = end_date`。
- 同一客戶跨 job 只留一筆 open（subject_key 原地更新，`due_date` 隨最新 job 推進——§3.5 合併語意）。

#### R3 — DCA 分批部署里程碑（auto，status=open）

- 觸發：`deployment_months > 0`；期數 `n = deployment_tranches ?? deployment_months`，`n >= 1`。
- 第 k 期（k = 1..n，**上限 6 筆**，超過則只建第 1、最後一期與等距取樣共 6 筆）：`due_date = addMonthsClamped(completedDateIso, round(k * months / n))`，`subject = \`dca-tranche-${k}\``，`params = { k, n }`。
- `cash_reserve_pct > 0` 時併入 params（`params.cashPct`）供文案提示「含現金保留 X%」；僅有 cash_reserve 而無 deployment 參數 → **不派生**（現金保留本身不是部署計畫）。

#### R4 — 主管簽核（auto，status=open）

兩個獨立 subject，可分別命中：

- `subject = "supervisor-drift"`：`driftOverrideApproval(request.customization_drift ?? 0.5).requiresSupervisor === true`（overlay-feasibility.ts:281；>60% 門檻）。`params.pct = round(drift*100)`。
- `subject = "supervisor-capability"`：`pendingSupervisorCapabilities(result.capabilities_used).length > 0`（proposal-capability-badge.ts:13）。`params.count = pending.length`。
- `due_date = completedDateIso`（當日即應處理 → 面板會立刻顯示「到期/逾期」態）。

#### R5 — 建議重跑（**Phase 2**）

LLM `rerun_recommended` 在報告頁非同步取得（use-ai-talking-summary.ts:131），不在 presentResult 的同步路徑內。Phase 2 於 `useAiTalkingSummary` 成功回應且 `rerunRecommended === true` 時派生（`subject = "rerun"`，`params.reason = rerunReason`），或直接把 RmReportView 既有紅色警示卡（RmReportView.tsx:758-776）加一顆「加入提醒」按鈕——二擇一，Phase 2 定案。

#### R6 — 年度檢視（**Phase 2**，status=suggested，RM 確認才轉 open）

- 年期解析：`request.client_context?.investment_horizon_years`（types.ts:62，數值）優先；否則從 `client.investment_horizon`（LocalizedText，取 `en` 值）萃取第一個數字。皆無或 < 1 → 不派生。
- `due_date = addMonthsClamped(completedDateIso, 12)`，`subject = "annual-review"`，`status = "suggested"`。

### 3.4 日期工具（模組內 private）

```ts
/** ISO 日期字串（YYYY-MM-DD）；以 UTC 正午錨定避免時區翻日（比照 clients.ts:318-319）。 */
function toIsoDate(d: Date): string;
function parseIsoDate(s: string): Date | null;          // new Date(`${s}T12:00:00Z`)

/** 月底 clamp：1/31 + 1mo → 2/28（UTC date-setter 語意，不進位到 3 月）。 */
export function addMonthsClamped(isoDate: string, months: number): string;

/**
 * 下次再平衡日 = end_date 之後一個頻率週期。
 * 頻率辨識比照 rebalanceFreqLabel（i18n.tsx:5856-5866）：
 *   W* → +7 日；ME/M/MS/MON* → +1 月；Q* → +3 月；Y*/A* → +12 月；D/B → +1 日；其餘 → null。
 */
export function nextRebalanceDate(endDate: string, freq: string): string | null;

/** 本地「今天」的 ISO 日期（逾期判定用）。 */
export function todayIsoDate(now?: Date): string;
```

### 3.5 合併與自動結案 `mergeReminders()`

```ts
export type MergeOutcome = {
  reminders: ClientReminder[];      // 合併後完整清單（呼叫端負責寫回）
  added: ClientReminder[];          // 新建（chip 計數用）
  updated: ClientReminder[];        // 原地更新（同 subject_key）
  autoResolved: ClientReminder[];   // 自動結案
};

export function mergeReminders(
  existing: ClientReminder[],
  derived: ClientReminder[],
  opts: { now?: Date } = {},
): MergeOutcome;
```

規則（依序套用）：

1. **Dedupe（同 job 冪等）**：`derived` 中 `dedupe_key` 已存在於 `existing` → 整筆略過（不動 updated_at）。這保證 React StrictMode 雙次執行、pollJob 重入等情況不產生重複。
2. **同主題連續性**：`existing` 有同 `subject_key` 且 status ∈ {open, suggested} → **不新建**；原地更新該筆的 `last_seen_job_id`、`due_date`、`params`、`updated_at`（status 保持；suggested 不因更新轉正）。
3. **已結案後再命中**：
   - 排程類（R2/R3/R6）：同 `subject_key` 已 `dismissed` → **不再新建**（尊重 RM 的忽略決定）；已 `done` → 可新建（新一輪排程）。
   - 警示類（R1/R4/R5）：同 `subject_key` 已 closed（done/dismissed）→ **新建**一筆 open（新的 job 仍有問題 = 新的訊號實例）。
4. **自動結案（僅 R1/R4，僅在 fresh run 有對應訊號時）**：對每筆 `existing` 的 open/suggested 提醒——
   - R1 各 subject：本次 `champion.needs_attainment` **有值**且派生集合無此 subject_key → 設 `status="done"`、`closed_at=now`、`resolved_by_job_id=derived[0].job_id`（新 run）。`needs_attainment` 為 null（非客製化/舊 job 無此資料）→ 整組 R1 **不做**自動結案（避免誤殺）。
   - R4-drift：本次 request drift ≤ 60% → 結案。R4-capability：本次 `capabilities_used` **有值**（非 undefined）且無 pending → 結案；`capabilities_used === undefined` 不結案。
   - R2/R3/R6 **永不自動結案**（時間型待辦，由 RM 手動完成/忽略；逾期只是顯示態）。
5. **清理**：closed 且 `closed_at` 早於 90 天 → 移除；總數 > `MAX_REMINDERS_PER_CLIENT` → 依 `closed_at`/`updated_at` 最舊優先淘汰 closed 筆，仍超標再淘汰最舊 open。

### 3.6 儲存層（demo-clients-store.ts 擴充）

`ClientProfileOverrides` 增列 `reminders?: ClientReminder[]`，並新增：

```ts
export function getClientReminders(clientId: string): ClientReminder[];

/** 以 mergeReminders 合併 derived 並寫回；回傳 outcome 供 UI（chip 計數）。 */
export function mergeClientReminders(
  clientId: string,
  derived: ClientReminder[],
): MergeOutcome;

export function setClientReminderStatus(
  clientId: string,
  reminderId: string,
  status: ReminderStatus,           // open | done | dismissed（suggested → open 走 accept）
): ClientReminder | null;           // 找不到回 null
```

- 寫入沿用 `writeAll`（demo-clients-store.ts:39-49）的 try/catch（quota/private mode 靜默忽略）。
- `setClientReminderStatus`：`done`/`dismissed` 設 `closed_at`；`suggested → open`（RM 接受）不設 `closed_at`、清掉 `resolved_by_job_id`。

### 3.7 派生觸發點（page.tsx）

`presentResult` 加第 5 參數 `opts?: { fresh?: boolean }`，**預設 false**（安全預設：不標就不是 fresh）：

```ts
// presentResult 內，recordCompletedBacktest(...:521-525) 之後：
if (opts?.fresh && clientId) {
  const derived = deriveReminders({
    jobId: id,
    clientId,
    request: effectiveReq,
    result: res,
    client: getDemoClientById(clientId) ?? null,
  });
  const outcome = mergeClientReminders(clientId, derived);
  setReminderNotice(
    outcome.added.length + outcome.updated.length > 0
      ? { count: outcome.added.length, clientId }
      : null,
  );
}
```

呼叫端對照（§2.1）：

| 位置 | 性質 | `fresh` |
|---|---|---|
| page.tsx:586（pollJob 完成） | fresh | `true` |
| page.tsx:896（現金單軌完成） | fresh | `true` |
| page.tsx:978-988（雙軌 anchor 失敗變體） | fresh | `true` |
| page.tsx:1028-1033（雙軌完成） | fresh | `true` |
| page.tsx:607/617/620（loadHistoricalJob） | 歷史還原 | 不傳（false） |

- 只有 **adjusted（客製化）job** 會經 presentResult 派生；anchor 靜態重放 job（page.tsx:1016 的 base `recordCompletedBacktest`）不經 presentResult，自然不派生——提醒永遠針對客製化結果。
- `getDemoClientById(clientId)` 在 presentResult 內直接呼叫（不依賴 `activeClient` state，避免 useCallback deps 變動；presentResult 現有 deps `[lang, signedOverlay]` 不變，`setReminderNotice` 為穩定 setter）。
- `reminderNotice` state：新任務啟動（onRun）與 `onRerun`（page.tsx:1487-1490 的 setPhase("overlay") 處）時清 `null`。

---

## 4. UX 流程

### 4.1 完成 banner chip（RmReportView 頁首）

RmReportView 頁首現為「標題 + 三個 tab chip」（RmReportView.tsx:403-429）。於標題列右側、tab 群組**左方**插入提醒 chip（僅 `reminderNotice` 有值且 `client` 存在時渲染）：

```
┌─ 客戶報告 ────────────────────────────────────────────────┐
│ 客戶報告   [🔔 已建立 2 項提醒 →]   [ RM 視角 | 量化 | 稽核 ] │
└────────────────────────────────────────────────────────────┘
```

- chip 文案 `t("reminders.banner.created", { count })`；樣式 `pixel-chip` + 琥珀色（與既有 pixel-chip-active 區隔）。
- 點擊 → `router.push(\`/clients/${clientId}#reminders\`)`（或 `<Link>`；面板掛 `id="reminders"` anchor）。
- 進入報告時若 `count === 0`（全部原地更新、無新建）→ 不顯示 chip；但可在頁首加一行低調 hint `t("reminders.banner.refreshed")`（可選，P2 再議——Phase 1 一律不顯示）。
- chip 是「一次性通知」：由 page.tsx 的 state 驅動，重新整理頁面即消失（歷史還原時 `fresh=false` 本就不會設）。**持久入口**是客戶頁面板，不是 chip。

### 4.2 客戶頁提醒面板（ClientRemindersPanel）

掛點：`clients/[id]/page.tsx:1110` 的 `<ClientCustomizedHistoryPanel clientId={client.client_id} />` **上方**（提醒的時效性高於歷史紀錄）。

```
┌─ 提醒事項（3 項待處理） ──────────────────────────────────┐
│ [全部 4] [待處理 3] [已完成 1] [已忽略 0]          ↻        │
│                                                            │
│ ⚠ 需求未滿足 · 單一持股上限          [逾期/到期 2026-09-04] │
│   實際 12.3% / 上限 10% — 與客戶溝通或調整後重跑            │
│   來源：Sep 4, 17:20 · fa51bebe…  [開啟報告]                │
│   [標記完成] [忽略]                                         │
│                                                            │
│ ↻ 定期再平衡                              到期 2026-10-04  │
│   頻率：每月 · 回測截止 2026-09-04 — 安排下次再平衡檢視     │
│   來源：…                                    [開啟報告]     │
│   [標記完成] [忽略]                                         │
│                                                            │
│ 💡 年度檢視（建議）                      到期 2027-09-04    │
│   承作將滿一年 — 安排年度投資檢視                           │
│   [接受] [忽略]                                             │
└────────────────────────────────────────────────────────────┘
```

- 篩選 chips：全部/待處理(open+suggested)/已完成/已忽略；計數即時。
- 排序：status（suggested/open 先）→ 逾期者最前 → due_date 升冪 → created_at 降冪。
- 每列：規則徽章（`reminders.rule.r1.label` 等，`pixel-badge` 家族色——R1 紅/琥珀、R2/R3 藍、R4 琥珀、R6 灰）、標題（`t("reminders.rule.rX.title", params)`）、明細行、來源 job 連結（`/?job=…&client=…`，ClientCustomizedHistoryPanel.tsx:99 同格式）、操作鈕。
- 到期徽章：`due_date < today` → 紅色「逾期」；`= today` → 琥珀「今天到期」；否則灰字日期。日期顯示用 §2.4 的 locale 映射。
- 已結案列（篩選「已完成/已忽略」時）：顯示 `closed_at` 與（若有）`resolved_by_job_id` 的「已由最新試算自動結案」註記（`reminders.resolvedAuto`）。
- 資料同步：`useEffect` 初始 `getClientReminders(clientId)` + `focus`/`storage` 事件監聽（key = `DEMO_CLIENTS_OVERRIDES_STORAGE_KEY`）——照抄 ClientCustomizedHistoryPanel.tsx:31-47 模式，並以 `remindersrefresh` callback 包裝。
- 客戶頁 `id` 變更時重置 state（比照 page.tsx:216-235 的 extra notes/events 重置 effect）。

### 4.3 RmReportView 既有 banner 的關係

`pendingCaps` 琥珀 banner（RmReportView.tsx:443-460）與 talking-summary 紅卡（:758-776）**保留不動**——它們是「當下這份報告」的警示；提醒是「跨 session 的待辦」。R4 提醒讓 pending 訊息在 RM 離開報告後仍可追蹤，兩者互補（§10.3）。

---

## 5. 檔案變更清單

| # | 檔案 | 變更 | 估計規模 |
|---|---|---|---|
| F1 | `apps/web/src/lib/reminders.ts` | **新增**：§3.2 型別、§3.3 deriveReminders、§3.4 日期工具、§3.5 mergeReminders | ~260 行 |
| F2 | `apps/web/src/lib/reminders.test.ts` | **新增**：§7 測試 | ~280 行 |
| F3 | `apps/web/src/lib/demo-clients-store.ts` | `ClientProfileOverrides` 加 `reminders?` 欄位；新增 `getClientReminders` / `mergeClientReminders` / `setClientReminderStatus`（§3.6） | ~60 行 |
| F4 | `apps/web/src/components/ClientRemindersPanel.tsx` | **新增**：§4.2 面板（篩選、列渲染、操作、storage/focus 同步） | ~230 行 |
| F5 | `apps/web/src/app/page.tsx` | `presentResult` 加 `opts.fresh` 參數 + 派生呼叫（§3.7）；`reminderNotice` state；四處 fresh 呼叫端傳 `{ fresh: true }`（:586、:896、:978、:1028）；新任務/rerun 時清 notice；傳 prop 給 RmReportView（:1478-1498） | ~40 行 |
| F6 | `apps/web/src/app/clients/[id]/page.tsx` | 掛 `ClientRemindersPanel`（:1110 處，ClientCustomizedHistoryPanel 上方） | ~5 行 |
| F7 | `apps/web/src/components/RmReportView.tsx` | 新增可選 prop `reminderNotice?: { count: number; clientId: string } \| null`；頁首（:403-429）渲染 chip（Link 至 `/clients/{clientId}#reminders`） | ~25 行 |
| F8 | `apps/web/src/lib/i18n.tsx` | §6 全部 keys（en dict :30 起、zh dict :2007 起、ko dict :3853 起，各一份） | ~3×20 行 |

> 註：F5 的四個 fresh 呼叫端都要顯式傳 `{ fresh: true }`；`loadHistoricalJob`（:607/617/620）**不改**——預設 false 即滿足 G6。

---

## 6. i18n 文案

新增 keys（`i18n.tsx` 三 dict 各一份；插值用既有 `{name}` 語法，`translate` 於 i18n.tsx:5782-5790）：

| Key | zh（繁中） | en | ko |
|---|---|---|---|
| `reminders.panel.title` | 提醒事項 | Reminders | 알림 |
| `reminders.panel.hint` | 試算完成時依客戶需求自動建立；僅供 RM 本人檢視，不會對客戶顯示。 | Auto-created from client needs when a run completes. Visible to you (RM) only — never shown to clients. | 실행 완료 시 고객 니즈에서 자동 생성됩니다. RM 본인에게만 표시되며 고객에게는 보이지 않습니다. |
| `reminders.panel.empty` | 目前沒有提醒事項。 | No reminders yet. | 알림이 없습니다. |
| `reminders.filter.all` | 全部 | All | 전체 |
| `reminders.filter.open` | 待處理 | Open | 처리 대기 |
| `reminders.filter.done` | 已完成 | Done | 완료 |
| `reminders.filter.dismissed` | 已忽略 | Dismissed | 무시됨 |
| `reminders.rule.r1.label` | 需求未滿足 | Need unmet | 니즈 미충족 |
| `reminders.rule.r2.label` | 定期再平衡 | Rebalance | 리밸런싱 |
| `reminders.rule.r3.label` | 分批部署 | DCA milestone | 분할 투입 |
| `reminders.rule.r4.label` | 主管簽核 | Supervisor | 승인 필요 |
| `reminders.rule.r5.label` | 建議重跑 | Rerun advised | 재실행 권장 |
| `reminders.rule.r6.label` | 年度檢視 | Annual review | 연간 점검 |
| `reminders.rule.r1.title` | 需求「{subject}」未達標 | Need “{subject}” not met | 니즈 “{subject}” 미달 |
| `reminders.rule.r1.detail` | {detail} — 與客戶溝通或調整後重跑 | {detail} — discuss with client or adjust and rerun | {detail} — 고객 상담 또는 조정 후 재실행 |
| `reminders.rule.r1.quotaTitle` | 資產類別配額未生效（{classes}） | Class quota not effective ({classes}) | 자산군 쿼터 미적용({classes}) |
| `reminders.rule.r1.quotaDetail` | 配額類別在標的池中無成員，需求實際未配置——需補充標的或調整需求 | Quota class has no members in the universe; the allocation never happened — add instruments or revise the ask | 쿼터 자산군에 종목이 없어 실제 배분이 이루어지지 않았습니다 — 종목 보충 또는 니즈 조정 필요 |
| `reminders.rule.r2.title` | 安排下次再平衡檢視 | Schedule next rebalance review | 다음 리밸런싱 점검 예약 |
| `reminders.rule.r2.detail` | 頻率：{freq} · 回測截止 {end} | Frequency: {freq} · backtest ends {end} | 주기: {freq} · 백테스트 종료 {end} |
| `reminders.rule.r3.title` | 分批部署第 {k}/{n} 期 | DCA tranche {k} of {n} | 분할 투입 {k}/{n}회차 |
| `reminders.rule.r3.detail` | 確認第 {k} 期資金已依計畫投入 | Confirm tranche {k} was deployed as planned | {k}회차 자금이 계획대로 투입되었는지 확인 |
| `reminders.rule.r4.driftTitle` | 客製化偏離 {pct}% 超過 60%——需主管核准留痕 | Customization drift {pct}% exceeds 60% — supervisor approval required | 맞춤화 편차 {pct}%가 60% 초과 — 관리자 승인 필요 |
| `reminders.rule.r4.capabilityTitle` | {count} 項能力待主管批次簽核 | {count} capabilities pending supervisor sign-off | {count}개 능력 관리자 승인 대기 |
| `reminders.rule.r5.title` | 表現落後——建議調整後重跑 | Performance lags — adjust and rerun advised | 성과 부진 — 조정 후 재실행 권장 |
| `reminders.rule.r6.title` | 安排年度投資檢視 | Schedule annual investment review | 연간 투자 점검 예약 |
| `reminders.rule.r6.detail` | 承作將滿一年——與客戶檢視目標與配置 | One year since inception — review goals and allocation with the client | 운용 1년 경과 — 고객과 목표 및 배분 점검 |
| `reminders.action.done` | 標記完成 | Mark done | 완료 처리 |
| `reminders.action.dismiss` | 忽略 | Dismiss | 무시 |
| `reminders.action.accept` | 接受 | Accept | 수락 |
| `reminders.action.openReport` | 開啟報告 | Open report | 보고서 열기 |
| `reminders.due` | 到期 {date} | Due {date} | 만기 {date} |
| `reminders.dueToday` | 今天到期 | Due today | 오늘 만기 |
| `reminders.overdue` | 逾期 {date} | Overdue {date} | 기한 경과 {date} |
| `reminders.status.suggested` | 建議（待確認） | Suggested | 제안됨 |
| `reminders.resolvedAuto` | 已由最新試算自動結案 | Auto-resolved by the latest run | 최신 실행으로 자동 해결됨 |
| `reminders.banner.created` | 已建立 {count} 項提醒 → | {count} reminders created → | 알림 {count}개 생성됨 → |

`{subject}`（R1）由渲染端把 row key 經 `NEEDS_TABLE_I18N`（needs-fulfillment.ts:16-24）轉 i18n key 再 `t()` 取得本地化標籤後帶入；`{freq}` 過 `rebalanceFreqLabel`（i18n.tsx:5856-5866）；`{date}` 過 §2.4 的 locale 日期格式。

---

## 7. 測試計畫

測試框架：vitest（`apps/web/vitest.config.ts`；無 npm script，直接 `npx vitest run`）。測試檔與被測檔同目錄，比照 `overlay-feasibility.test.ts`、`talking-summary-payload.test.ts` 風格（`describe`/`it`/`expect`，fixture factory）。`now` 一律注入固定時間（如 `2026-09-04T09:36:00Z`）。

### 7.1 單元測試（`reminders.test.ts`）

| # | 案例 | 斷言 |
|---|---|---|
| U1 | 空 clientId / 無候選 | 回傳 `[]` |
| U2 | R1：champion `needs_attainment` 兩列 `pass=false`（drawdown、singleName） | 派生 2 筆 open，`subject` 正確、`params.detail` 帶入、`rule_id="R1"` |
| U3 | R1：`needs_attainment` 全過 / 為 null | 不派生 R1 |
| U4 | R1：`narrative_facts.class_quota_unfilled` 非空 | 派生 `subject="class_quota_unfilled"`，`params.classes` join 正確；與 U2 可並存 |
| U5 | R2：`rebalance_freq="ME"`、`end_date="2026-08-31"` | `due_date="2026-09-30"`（月底 clamp）；`"QE"` → +3 月；`"W-FRI"` → +7 日；`"YE"` → +12 月；未知碼 → 不派生 |
| U6 | R2：時區安全 — `end_date="2026-01-31"` + 1 月 | `2026-02-28`（不進位 3 月；UTC 正午解析，本機 TZ 不影響） |
| U7 | R3：`deployment_months=6, deployment_tranches=3` | 3 筆，due 分別 +2/+4/+6 月，`subject=dca-tranche-{1,2,3}` |
| U8 | R3：`tranches=12` | 上限 6 筆（含第 1 期與最後一期） |
| U9 | R3：僅 `cash_reserve_pct>0`、無 deployment | 不派生 |
| U10 | R4：`customization_drift=0.65` | 派生 `supervisor-drift`，`params.pct=65`；`0.6` → 不派生（對齊 `driftOverrideApproval` 的 1e-12 容差） |
| U11 | R4：`capabilities_used` 一筆 `pending_supervisor_signoff=true` | 派生 `supervisor-capability`，`params.count=1`；空陣列/全 approved → 不派生 |
| U12 | R6（Phase 2 先行實作純函式）：`client_context.investment_horizon_years=5` | 派生 suggested，`due=+12 月`；0.5 年 / 缺值 → 不派生 |
| U13 | merge：同 `dedupe_key` 重複派生 | 第二輪 `added=0`，清單不變（冪等） |
| U14 | merge：同 `subject_key` open 提醒 + 新 job 同主題 | 原地更新（`last_seen_job_id`、`due_date` 推進），`added=0, updated=1` |
| U15 | merge：R1 open 主題在新 job 已消失（`needs_attainment` 有值且全過） | 該筆 → done + `resolved_by_job_id`；`autoResolved=1` |
| U16 | merge：新 job `needs_attainment=null` | R1 不自動結案（防誤殺） |
| U17 | merge：R2 dismissed 後新 job 同主題 | 不重建（尊重忽略）；R1 dismissed 後新 job 仍 fail → 重建 open |
| U18 | merge：closed 逾 90 天清理；超過 `MAX_REMINDERS_PER_CLIENT` 淘汰順序 | closed 最舊優先淘汰 |
| U19 | `setClientReminderStatus`：suggested→open 不設 closed_at；done/dismissed 設 closed_at；不存在 id → null | 狀態機正確 |

### 7.2 整合測試

| # | 案例 | 驗證點 |
|---|---|---|
| I1 | fresh 路徑（以 `{fresh:true}` 呼叫派生流程的整合測試，或元件層模擬 presentResult 呼叫） | localStorage 出現對應 reminders；`reminderNotice.count` 正確 |
| I2 | 歷史還原路徑（`fresh` 未傳） | 不派生、不覆寫（G6） |
| I3 | 連續兩次 fresh（StrictMode 雙呼叫） | dedupe_key 防重複（U13 的端對端版） |
| I4 | 修復 run：先 fail R1-drawdown 的 job A，再全過的 job B（同 client） | job B 完成後 R1-drawdown 自動 done，其餘 open 不受影響 |
| I5 | demo-clients-store 既有資料相容：舊 overrides JSON（無 `reminders` 欄位） | `getClientReminders` 回 `[]`；extra notes/events 讀寫不受影響（regression） |
| I6 | i18n：§6 keys 三語皆存在（key-parity 斷言） | 不 fallback 成 key 字串 |

### 7.3 手動驗收（UI）

1. 客戶啟動客製化試算，需求含會失敗的 floor（如單一持股上限 5%）→ 完成後報告頁首出現「已建立 N 項提醒」chip → 點擊跳客戶頁 `#reminders`，面板可見對應 open 提醒。
2. 重新整理／從歷史面板重開同一 job → **不再**出現 chip、提醒不增加。
3. 調整需求後重跑至全過 → 回原客戶頁，R1 提醒已自動結案（顯示「已由最新試算自動結案」）。
4. drift > 60% 或帶 pending capability 的 run → R4 提醒當日到期態顯示。
5. 面板上標記完成/忽略 → 切換篩選 chips 狀態正確；另開分頁（storage event）同步。
6. 切換 EN/繁中/한국어 → 既有提醒標題隨語言切換（存 params 不存文案的驗證）。

---

## 8. 實作順序

| Phase | 內容 | 相依 | 完成判準 |
|---|---|---|---|
| **P1** 規則核心 | F1、F2、F3、F8（R1–R4 + 儲存 + i18n；R6 純函式可一併實作但不接 UI） | 無 | `npx vitest run src/lib/reminders.test.ts` 全綠；`tsc` 無誤 |
| **P2** 派生串接 | F5（presentResult fresh 派生 + notice state） | P1 | 手動驗收 #1 前半、#2、#3、#4 |
| **P3** UI | F4、F6、F7 | P1、P2 | 手動驗收 #1、#5、#6 全部 |
| **Phase 2**（另立文件） | R5（LLM `rerun_recommended` 掛接 use-ai-talking-summary 或報告紅卡「加入提醒」鈕）、R6 接 UI（suggested → 面板接受/忽略）、LLM 潤稿、server store（多裝置）、email digest | P1–P3 | 另行定義 |

P2 與 P3 可依序或可拆兩支 PR（P1+P2 一支、P3 一支）；P1 單獨合入不影響任何現有行為（純新增模組 + 儲存欄位）。

---

## 9. 邊界案例

| # | 案例 | 預期行為 |
|---|---|---|
| E1 | 歷史 job 重開（loadHistoricalJob / 深連結 `?job=`） | `fresh` 預設 false → 不派生、不更新 `last_seen`；提醒數不變（G6、手動驗收 #2） |
| E2 | 同一客戶多個 job | subject_key 連續性：open 提醒原地更新不堆疊（U14）；不同主題各自獨立 |
| E3 | 修復 run 解決 R1 | 自動結案 + `resolved_by_job_id`（U15、I4）；`needs_attainment` 缺資料時不誤殺（U16） |
| E4 | localStorage quota / private mode | writeAll 既有 try/catch 靜默忽略（demo-clients-store.ts:39-49）；寫入失敗時 chip 仍顯示（notice 是記憶體 state），但重整後提醒可能遺失——接受此限制（Phase 2 server store 解決） |
| E5 | 時鐘/時區 | 所有到期日運算以 UTC 正午錨定（U6）；「逾期」以本地今天比對 ISO 日期字串（不涉時分秒）；跨年 2/29 → 2/28 clamp |
| E6 | 日期 i18n | 顯示端統一走 zh-TW/ko-KR/en-US locale（§2.4 先例）；儲存永遠 ISO |
| E7 | 歷史 job 被 `MAX_LOCAL_ENTRIES=30` 淘汰 | 提醒的「開啟報告」連結可能 404/退回 API 查詢——深連結載入本為 best-effort（page.tsx:624-626 註解）；提醒本身保留（不隨 history 淘汰） |
| E8 | 非客戶 run（無 client_ref） | `clientId` 解析為空 → 不派生（U1）；一般量化 run 完全不受影響 |
| E9 | anchor 靜態重放 job | 不經 presentResult → 不派生（§3.7） |
| E10 | StrictMode / pollJob 重入 | dedupe_key 冪等（U13、I3） |
| E11 | R2 頻率碼無法辨識 | `nextRebalanceDate` 回 null → 不派生（不造出錯誤日期） |
| E12 | R3 期數異常（0、負數、非整數） | 正規化：`n = max(1, floor(tranches ?? months))`；months ≤ 0 → 不派生 |
| E13 | RM 忽略 R2 後又跑新 job | 排程類尊重 dismissed，不重建（U17）；RM 想恢復 → 於「已忽略」篩選無恢復鈕（Phase 1 不提供；重新產生只能靠手動——記為已知限制） |
| E14 | 瀏覽器清資料 / 換電腦 | 提醒隨 localStorage 消失——文件化告知 RM（§11 風險 R-3） |
| E15 | `capabilities_used` 欄位缺失（舊 job/引擎未回） | R4-capability 不派生也不自動結案（U11/U16 同原則：缺資料不作為） |

---

## 10. 與現有機制的關係

### 10.1 `upcoming_events`（近期事件）— 不合併

| 面向 | upcoming_events（既有） | reminders（本功能） |
|---|---|---|
| 語意 | 客戶行事曆註記（到期日+標題，clients.ts:65-69） | RM 個人待辦（狀態機 + 來源 job + 自動結案） |
| 產生 | demo 資料手刻 + RM 手動新增（addClientEvent，demo-clients-store.ts:85-106） | 規則引擎自動派生 |
| 生命週期 | 無狀態（過期即不再顯示於「近期」） | suggested/open/done/dismissed |
| 文案 | `LocalizedText` 三語同文（toLocalized） | i18n key + params，隨語言切換 |

Phase 1 **各自獨立、不自動互轉**——合併會把「RM 待辦」洩進「客戶時間軸」語意（與 G2 衝突）。Phase 2 可評估在提醒列加「轉為近期事件」手動鈕（複用 `addClientEvent`，提醒的 due_date + 標題帶入），讓 RM 自行決定哪些待辦要上浮為客戶層事件。

### 10.2 gap tickets（`apps/web/src/app/gaps`）— 不同受眾

gap tickets 是**引擎/策略能力缺口**的內部工單（behavior spec、quant 平台向；見 `api/gaps/*`、`gaps/page.tsx`）；reminders 是 **RM 對客戶的服務待辦**。受眾、儲存、生命週期皆不同，不共用任何機制；僅在主題上相鄰（都是「某事未完成」），文件並列以免混淆。

### 10.3 capability 簽核流程 — 提醒只指路、不取代

R4-capability 提醒是 `pendingCaps` banner（RmReportView.tsx:443-460）的**跨 session 延伸**：實際批次簽核仍走既有 capability approval 流程（`proposal-capability-badge.ts`；列印阻擋 `proposalPrintBlockedMessage` 等行為完全不變）。提醒完成/忽略不影響簽核狀態；反之，下一個無 pending 的 run 會把提醒自動結案（§3.5-4）。drift >60% 同理：提醒引用 `driftOverrideApproval`（overlay-feasibility.ts:281）的判定結果，主管留痕本身仍由 overlay audit（overlay-drift-sync §5-F4 `drift_sync`）承載。

### 10.4 與 overlay-drift-sync / needs-driven-weight-bounds 的相依

- 本功能**消費**兩者的產物（`needs_attainment`、`class_quota_unfilled`、drift 主管門檻），但全部以**防禦式讀取**（欄位缺失即不派生）——兩份文件若未落地或部分落地，本功能不退化、不報錯（E15/U16）。
- 三者共用「警告不阻擋」的產品原則。

### 10.5 與 `notify_email` 的相鄰關係

既有 `notify_email`（types.ts:139-140；job 完成/失敗寄信 + 深連結）是 Phase 2 email digest 的天然管道——每日/每週彙整 open 提醒寄給 RM。Phase 1 不動此機制。

---

## 11. 風險與回滾

| # | 風險 | 等級 | 緩解 |
|---|---|---|---|
| R-1 | **提醒噪音**：每個 run 都產生 R2/R3 → 面板被洗版 | 中 | subject_key 原地更新（同主題只一筆 open）；R2 dismissed 不重建；上限 100 筆 + 90 天 closed 清理（§3.5-5） |
| R-2 | **誤自動結案**：新 job 資料不全（`needs_attainment` null）把 R1 全結案 | 中 | 缺資料即不結案（U16）；`capabilities_used` undefined 同理（E15） |
| R-3 | **資料遺失**：localStorage 清掉/換裝置 → 提醒消失 | 中 | 文件化限制；提醒屬「便利功能」非合規留痕（真正的留痕在 overlay audit 與 history）；Phase 2 server store 根治 |
| R-4 | **隱私**：提醒含客戶需求細節，存於 RM 瀏覽器 | 低 | 與既有 extra notes/events、backtest history 同級風險；不送伺服器反而縮小暴露面；面板 hint 明示「僅 RM 可見」（`reminders.panel.hint`） |
| R-5 | **presentResult 簽名擴充**波及既有呼叫端 | 低 | 第 5 參數 optional、預設 false；歷史路徑不改即安全（G6）；TS 編譯期即可發現漏改 |
| R-6 | **i18n 缺 key**顯示裸 key 字串 | 低 | I6 key-parity 測試；`translate` 缺 key 回 key 本身的既有行為易於目視發現 |

**回滾**：本功能純增量、無伺服器端變更、無引擎變更——
1. 還原 F5（page.tsx 派生呼叫與 notice）、F6（面板掛點）、F7（chip）即完全關閉功能；
2. 已寫入 localStorage 的 `reminders` 欄位為惰性資料，demo-clients-store 讀寫不受其存在與否影響（JSON 多出的欄位被忽略），**無需資料遷移**；
3. F1/F3/F8 保留亦無害（死碼），可隨後清理。

---

## 附錄 A：關鍵程式碼座標速查

| 符號 | 位置 |
|---|---|
| `presentResult`（派生掛點） | `apps/web/src/app/page.tsx:418-536`（`recordCompletedBacktest` 呼叫於 :521-525） |
| fresh 完成呼叫端 | `apps/web/src/app/page.tsx:586`（pollJob）、`:896`（現金單軌）、`:978`（anchor 失敗變體）、`:1028`（雙軌） |
| `loadHistoricalJob`（不派生） | `apps/web/src/app/page.tsx:602-629` |
| 結果頁 RmReportView 渲染處 | `apps/web/src/app/page.tsx:1478-1498` |
| `recordCompletedBacktest` / `MAX_LOCAL_ENTRIES=30` | `apps/web/src/lib/backtest-history.ts:88-103, :11` |
| `resolveHistoryClientId` | `apps/web/src/lib/backtest-history.ts:138-148` |
| 冠軍選取 `resolveChampionCandidateIndex` | `apps/web/src/lib/performance-compare-chart.ts:287`（用法先例 backtest-history.ts:61-66） |
| `needs_attainment` 型別 | `apps/web/src/lib/types.ts:269-309` |
| `ClientContext.investment_horizon_years` | `apps/web/src/lib/types.ts:62` |
| `rebalance_freq` / `end_date` / `deployment_*` / `capabilities_used` | `apps/web/src/lib/types.ts:122, :103, :181-184, :470` |
| `needsFloorRows` / `NEEDS_TABLE_I18N` | `apps/web/src/lib/needs-fulfillment.ts:74-170, :16-24` |
| `DRIFT_OVERRIDE_RM_MAX` / `driftOverrideApproval` | `apps/web/src/lib/overlay-feasibility.ts:13, :281-289` |
| `pendingSupervisorCapabilities` | `apps/web/src/lib/proposal-capability-badge.ts:13-21` |
| demo-clients-store（overrides 存取層） | `apps/web/src/lib/demo-clients-store.ts:3-4`（storage key）、`:12-15`（`ClientProfileOverrides`）、`:24-49`（readAll/writeAll）、`:85-106`（addClientEvent） |
| `ClientUpcomingEvent` / `getUpcomingEvents` | `apps/web/src/lib/clients.ts:65-69, :726-732` |
| UTC-noon 日期先例 | `apps/web/src/lib/clients.ts:318-319` |
| 客戶頁：extra events state/effect/合併 | `apps/web/src/app/clients/[id]/page.tsx:199-205, :216-235, :464-469` |
| 客戶頁面板掛點 | `apps/web/src/app/clients/[id]/page.tsx:1110`（ClientCustomizedHistoryPanel 上方） |
| 面板 storage/focus 同步先例 | `apps/web/src/components/ClientCustomizedHistoryPanel.tsx:31-47`（job 連結格式 :99） |
| RmReportView 頁首（chip 掛點） | `apps/web/src/components/RmReportView.tsx:403-429` |
| `pendingCaps` banner / talking-summary 紅卡 | `apps/web/src/components/RmReportView.tsx:443-460, :758-776` |
| locale 日期格式先例 | `apps/web/src/components/RmReportView.tsx:705-709` |
| i18n dicts / `translate` / `rebalanceFreqLabel` | `apps/web/src/lib/i18n.tsx:30`（en）、`:2007`（zh）、`:3853`（ko）、`:5782-5790`、`:5856-5866` |
| LLM `rerun_recommended`（Phase 2 R5） | `apps/web/src/lib/use-ai-talking-summary.ts:21,131`；`apps/web/src/app/api/talking-summary/route.ts:113-118` |
| 測試框架 | `apps/web/vitest.config.ts`（`npx vitest run`） |
