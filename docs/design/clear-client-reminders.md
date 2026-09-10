# 「清空此客戶提醒」施工說明書

> **版本**：0.1（施工前設計定稿）
> **狀態**：Ready for implementation — 尚未落地
> **日期**：2026-09-10
> **讀者**：Web/BFF 工程師、RM 產品負責人
> **相關文件**：
> - [`docs/design/auto-reminders.md`](./auto-reminders.md)（提醒派生／合併／面板；本功能為其營運清理能力）
> - [`docs/design/overlay-defer-ticker-confirm.md`](./overlay-defer-ticker-confirm.md)（施工說明書章節風格參考）
> **適用程式碼**：`apps/web`（Next.js UI + localStorage）；**不動** `apps/api` 引擎
> **已確認決策**：① 產品預設為清空**該客戶所有狀態**的提醒（open／done／dismissed／suggested），不可逆；② 僅清除 `overrides[clientId].reminders`，**保留**同 key 下的 `extra_notes`／`extra_events`；③ 確認對話框明示不可逆；④ 後續新鮮試算仍可經 `deriveReminders` + `mergeClientReminders` 重建 open 提醒。
>
> 所有檔案路徑與行號均經實際代碼核對（2026-09-10 工作區狀態）。

---

## 1. 目標與範圍

### 1.1 問題陳述

Auto-reminders（[`auto-reminders.md`](./auto-reminders.md)）把提醒寫進單一 localStorage key `jasper_demo_clients_overrides_v1`，與該客戶的 **extra notes／extra events** 共用同一筆 `ClientProfileOverrides`。Demo／測試場景下，RM 常需要「清掉這位客戶的提醒再重跑」，但今日面板**只有單筆狀態變更**（完成／忽略／接受），**沒有批次清空**。

若誤刪整個 `jasper_demo_clients_overrides_v1`（或整筆 `overrides[clientId]`），會一併失去手寫備註與近期事件——這是不可接受的附帶損害。

典型路徑：

1. RM 對 Demo 客戶多次跑客製化試算 → 面板堆出 open／done／dismissed／suggested 提醒。
2. 想重置提醒以便驗證「新鮮派生」行為。
3. 現況只能逐筆 dismiss／done，或手動清整個 overrides key → 備註／事件也被清掉。

### 1.2 目標（本功能要做的）

| # | 目標 | 說明 |
|---|---|---|
| G1 | **單客戶提醒清空** | 提供 `clearClientReminders(clientId)`：只把該客戶的 `reminders` 清成空陣列（或移除該欄位），不碰 `extra_notes`／`extra_events`，也不刪其他客戶的 overrides。 |
| G2 | **UI 可發現、需確認** | 在 `ClientRemindersPanel` 標題列放「清空此客戶提醒」按鈕；點擊後確認對話框警告不可逆，確認後才執行。 |
| G3 | **產品預設：清全部狀態** | 一次清除 open／suggested／done／dismissed **全部**狀態（見 §1.4）；不清「僅 open」作為預設路徑。 |
| G4 | **清空後可重建** | 清空不影響後續 fresh complete 的 `deriveReminders` + `mergeClientReminders`；新 job 可再寫入 open／suggested。 |
| G5 | **跨分頁一致** | 沿用面板既有 `storage`／`focus` 刷新；清空後本分頁立刻 empty，其他分頁在 storage event 後同步。 |

### 1.3 非目標（Explicit Non-Goals）

- **不刪**整個 `jasper_demo_clients_overrides_v1`，也**不刪** `overrides[clientId]` 整筆物件。
- **不清** notes／events／其他客戶資料／backtest history。
- **不改** `deriveReminders`／`mergeReminders` 規則語意（自動結案、subject_key、dismiss 尊重等維持原樣）。
- **不做**伺服器端儲存、多裝置同步、audit log（仍屬 Phase 1 localStorage）。
- **不做**「還原清空」undo stack；確認後即不可逆（可再靠新試算重建 open 項）。
- **不新增**獨立 modal 元件庫（比照既有 `window.confirm` 先例即可；見 §4）。
- **不動** `apps/api`。

### 1.4 已確認決策

| 決策 | 選擇 | 理由 |
|---|---|---|
| 清空範圍 | **該客戶全部狀態**（open／suggested／done／dismissed） | Demo／測試重置要乾淨；只清 open 會留下 done／dismissed 噪音，且 merge 對 schedule 類 dismissed 會「尊重不重建」，殘留 dismissed 會阻礙重測 R2／R3／R6 |
| 確認方式 | **確認對話框**（不可逆警告） | 破壞性操作；對齊 `pool/page.tsx` 的 `window.confirm` 先例 |
| 可選「僅清 open」 | **本期不做**（文件保留為未來選項） | 降低 UI／i18n／測試面；產品預設已覆蓋主要痛點 |
| 空列表時按鈕 | **隱藏或 disabled** | 避免無意義確認；見 §4.2 |

---

## 2. 現況分析

### 2.1 儲存模型（已落地）

```
localStorage["jasper_demo_clients_overrides_v1"]
  = Record<clientId, ClientProfileOverrides>
      ├─ extra_notes?: ClientExtraNote[]
      ├─ extra_events?: ClientUpcomingEvent[]
      └─ reminders?: ClientReminder[]
```

| 座標 | 內容 |
|---|---|
| `demo-clients-store.ts:10-11` | `DEMO_CLIENTS_OVERRIDES_STORAGE_KEY = "jasper_demo_clients_overrides_v1"` |
| `:19-23` | `ClientProfileOverrides`：`extra_notes`／`extra_events`／`reminders` |
| `:32-57` | `readAll`／`writeAll`；quota／private mode 時 `writeAll` **靜默忽略** |
| `:59-63` | `getClientProfileOverrides(clientId)` |

**關鍵觀察**：提醒與 notes／events **同物件、同 key**。任何「清客戶」若寫成 `delete all[clientId]` 或 `removeItem(整 key)`，都會誤傷備註與事件。

### 2.2 提醒 API 現況（無刪除）

| API | 位置 | 行為 |
|---|---|---|
| `getClientReminders` | `:116-118` | 回 `reminders ?? []` |
| `mergeClientReminders` | `:121-139` | `mergeReminders` 後寫回 `reminders`；**保留** `...current` 其他欄位 |
| `setClientReminderStatus` | `:141-172` | 單筆改 status；不存在 id → `null` |
| ~~`clearClientReminders`~~ | — | **不存在** |
| ~~批次刪除／reset~~ | — | **不存在** |

Notes／events 同樣只有 `addClientNote`／`addClientEvent`，**也沒有**對應 delete——但那不在本功能範圍。

### 2.3 `reminders.ts`（純函式層）

| 座標 | 內容 | 與本功能關係 |
|---|---|---|
| `:20` | `ReminderStatus = "suggested" \| "open" \| "done" \| "dismissed"` | 清空須涵蓋四態 |
| `:22-44` | `ClientReminder` 型別 | 清空後陣列為 `[]`；型別不變 |
| `:46-47` | `MAX_REMINDERS_PER_CLIENT=100`、`CLOSED_REMINDER_RETENTION_DAYS=90` | 清空是顯式重置，不依賴 prune |
| `:226+` | `deriveReminders` | 清空後下一輪 fresh 可再派生 |
| `:435-540` | `mergeReminders` | 對空 `existing` + 非空 `derived` → 全數 `added`（冪等／subject 規則仍適用） |
| `:518-524` | schedule 類（R2／R3／R6）若曾 `dismissed` 則不重建 | **這是「必須清全部狀態」的技術理由之一**：只清 open 留下 dismissed，會阻礙重測排程提醒 |

本功能**不必**改 `reminders.ts` 核心邏輯；清空屬 storage 層寫入（可選在純函式層加 `clearRemindersArray` 別名，但非必要）。

### 2.4 `ClientRemindersPanel.tsx`（UI）

| 座標 | 內容 | 與本功能關係 |
|---|---|---|
| `:7-9` | import `getClientReminders`／`setClientReminderStatus` | 新增 import `clearClientReminders` |
| `:64-67` | state：`rows`、`filter` | 清空後 `refresh()` → `rows=[]` |
| `:69-71` | `refresh` → `getClientReminders` | 清空後呼叫 |
| `:78-92` | `focus`／`storage` 監聽同一 key | 多 tab 同步已具備；清空寫入後他 tab 會 refresh |
| `:98-103` | counts（all／open／done／dismissed） | 清空後全 0；篩選 chip 仍可顯示 |
| `:209-212` | `setStatus` 單筆操作 | 不變 |
| `:231-244` | **標題列**：`<h2>` + 重新整理 `↻` | **清空按鈕掛點**（標題右側、與 refresh 並列） |
| `:245` | hint | 可選在 hint 旁不重複說明；確認文案在 dialog |
| `:260-261` | empty：`reminders.panel.empty` | 清空後應落到此 empty state |
| `:309-345` | 單列 accept／done／dismiss | 不變 |

掛點：`apps/web/src/app/clients/[id]/page.tsx:1111`  
`<ClientRemindersPanel clientId={client.client_id} />`（本功能不改 page 掛載）。

### 2.5 派生串接（清空後重建路徑）

`page.tsx` 已在 fresh complete 路徑呼叫：

- `deriveReminders` + `mergeClientReminders`（約 `:544-545` 一帶）

清空後：

1. `existing = []`
2. 下一次 fresh job → `mergeReminders([], derived, …)` → 新建 open／suggested
3. **不**需要改 presentResult／fresh 旗標

### 2.6 i18n 現況

提醒相關 keys 已存在於 `i18n.tsx` 三語（en ~`:1358-1399`、zh ~`:3308-3346`、ko ~`:5259+`），包含：

- `reminders.panel.title`／`hint`／`empty`
- `reminders.filter.*`、`reminders.action.*`、`reminders.banner.created` 等

**沒有**任何 `reminders.clear*`／`reminders.action.clear*` key。

確認對話先例：

- `pool/page.tsx:127`：`window.confirm(t("pool.bulk.resetConfirm"))`
- `FinancialGoalSimulator.tsx:637`：`window.confirm(t("goalSim.extractConfirmReplace"))`

本功能沿用同一模式，避免新 modal 元件。

### 2.7 缺口摘要

| 缺口 | 說明 |
|---|---|
| Store | 無「只清 reminders」API |
| UI | 標題列無清空入口；無確認文案 |
| i18n | 無 clear 相關三語 keys |
| 測試 | `reminders.test.ts` 有 get／merge／setStatus（含 I5 缺欄位），**無** clear 案例 |

---

## 3. 核心設計

### 3.1 Store API：`clearClientReminders(clientId)`

加在 `demo-clients-store.ts`，緊鄰 `setClientReminderStatus` 之後：

```ts
/**
 * Clear all reminder rows for one client.
 * Preserves extra_notes / extra_events and other clients' overrides.
 * Returns the number of reminders removed (0 if already empty / missing).
 */
export function clearClientReminders(clientId: string): number {
  const all = readAll();
  const current = all[clientId];
  if (!current) return 0;

  const prev = current.reminders ?? [];
  if (prev.length === 0) return 0;

  // Preserve notes/events; drop reminders field (or set []).
  const { reminders: _removed, ...rest } = current;
  all[clientId] = {
    ...rest,
    // Explicit empty array keeps shape stable for readers; either [] or omit OK.
    // Prefer omit when rest has no other fields? No — keep client entry if notes/events exist.
    reminders: [],
  };

  // Optional tidy: if overrides object is fully empty, could delete all[clientId].
  // Prefer keeping `{ reminders: [] }` or stripping only reminders while notes remain.
  writeAll(all);
  return prev.length;
}
```

**寫入語意（定稿）**：

1. `readAll()` → 取 `all[clientId]`。
2. 若無 entry 或 `reminders` 空／缺 → return `0`，**不**無意義 `writeAll`（減少多 tab storage 雜訊）。
3. 否則 `all[clientId] = { ...current, reminders: [] }`（**展開保留** notes／events）。
4. `writeAll(all)`；回傳清除筆數供 UI／測試。

**不採用**：

- `delete all[clientId]`（會丟 notes／events）
- `localStorage.removeItem(DEMO_CLIENTS_OVERRIDES_STORAGE_KEY)`（全庫清空）
- 只 filter `status === "open"`（與 §1.4 產品預設不符）

### 3.2 可選擴充（本期不做，僅規格預留）

```ts
export type ClearClientRemindersOpts = {
  /** @deprecated Phase 1 unused — product clears all statuses */
  statuses?: ReminderStatus[];
};

// Future: clear only openish
// reminders: prev.filter(r => !opts.statuses.includes(r.status))
```

文件記載即可；**實作 Phase 1 不暴露此 opts**，避免半套 UI。

### 3.3 UI：標題列按鈕 + `window.confirm`

```tsx
// ClientRemindersPanel header sketch
<div className="mb-2 flex items-center justify-between gap-2">
  <h2 className="ui-section-title">{titleCount}</h2>
  <div className="flex items-center gap-2">
    {rows.length > 0 ? (
      <button
        type="button"
        className="ui-body text-[var(--text-dim)] hover:text-rose-600 hover:underline"
        onClick={onClearAll}
      >
        {t("reminders.action.clearAll")}
      </button>
    ) : null}
    <button type="button" /* existing refresh */>↻</button>
  </div>
</div>
```

```ts
const onClearAll = () => {
  if (!window.confirm(t("reminders.clear.confirm", { count: rows.length }))) {
    return;
  }
  clearClientReminders(clientId);
  refresh();
  setFilter("all"); // optional: reset filter so empty state 不被「已忽略」篩掉
};
```

### 3.4 與 merge 的互動（清空後再建）

| 時序 | 行為 |
|---|---|
| T0 | 客戶有 open／done／dismissed／suggested |
| T1 | `clearClientReminders` → `reminders: []`；notes／events 仍在 |
| T2 | 同 tab 面板 empty；他 tab 經 `storage` event refresh |
| T3 | 新 fresh job → `mergeClientReminders(clientId, derived)` | existing=[] → 全部依規則 `added` |
| T4 | 若 T3 前他 tab 仍持有舊記憶體 state 又 `setClientReminderStatus` | 見 §9 E4（read-modify-write 競態） |

清空**不會**寫 tombstone；因此 schedule 類「曾 dismissed 不重建」的記憶也一併消失——這正是 Demo 重置想要的。

### 3.5 回傳值與錯誤

| 情況 | 行為 |
|---|---|
| 成功 | return `number`（清除筆數） |
| 已空 | return `0` |
| `writeAll` quota 失敗 | 與既有 API 相同：靜默；呼叫端仍 `refresh()`，若寫入失敗則 UI 可能仍顯示舊資料（§9 E3） |
| SSR／無 window | `readAll`／`writeAll` 已 guard；回 `0` |

---

## 4. UX 流程與線框

### 4.1 目標流程

```
┌─────────────────────────────────────────────────────────────┐
│  ClientRemindersPanel                                       │
│  ┌─ 提醒事項（N）────────── [清空此客戶提醒] [↻] ─┐        │
│  │  hint…                                              │        │
│  │  [全部] [待處理] [已完成] [已忽略]                    │        │
│  │  · 提醒列…                                          │        │
│  └─────────────────────────────────────────────────────┘        │
│                              │                                  │
│                    點「清空此客戶提醒」                            │
│                              ▼                                  │
│              window.confirm(不可逆警告 + 筆數)                    │
│                     │ 取消          │ 確定                       │
│                     ▼               ▼                            │
│                  無變更      clearClientReminders                 │
│                              → refresh → empty state             │
│                              （notes/events 頁其他區塊不變）       │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 按鈕放置與可見性

| 規則 | 說明 |
|---|---|
| 位置 | 標題列右側，**重新整理左側**（破壞性操作靠近但不取代 refresh） |
| 可見 | `rows.length > 0` 才顯示（或 disabled + title 說明已空） |
| 樣式 | 次要文字鈕；hover 可用 rose 提示危險，**不要**做成 primary 實心大鈕 |
| 篩選無關 | 即使目前 filter=「已完成」且 visible 少，只要 `rows`（全量）>0 仍可清空**全部狀態**（按鈕語意是客戶級，不是篩選級） |

### 4.3 確認文案（產品語氣）

繁中建議（正式 key 見 §6）：

> 確定清空此客戶的全部提醒事項（共 {count} 筆，含待處理／已完成／已忽略／建議）？  
> 此操作無法復原。備註與近期事件不會受影響。之後重新跑試算仍可自動建立新提醒。

- **必須**提到：全部狀態、不可逆、notes／events 保留、可再派生。
- Cancel／OK 用瀏覽器原生 confirm 按鈕（語系依瀏覽器；可接受，與 pool reset 一致）。

### 4.4 清空後 empty state

- 顯示既有 `reminders.panel.empty`（「目前沒有提醒事項。」）
- 標題變回無括號計數的 `reminders.panel.title`（因 `openCount===0`）
- 篩選 chips 計數全 0；建議 `setFilter("all")` 避免停在空的 dismissed 篩選

### 4.5 無障礙

- 按鈕需可讀文字（不要只放圖示）；`aria-label` 可與可見文字相同或用 `reminders.action.clearAll`
- confirm 為同步阻斷——與現有 pool／goalSim 一致；不另做 focus trap modal

---

## 5. 檔案變更清單

| # | 檔案 | 變更 | 預估 |
|---|---|---|---|
| F1 | `apps/web/src/lib/demo-clients-store.ts` | 新增 `clearClientReminders(clientId): number`（§3.1） | ~25 行 |
| F2 | `apps/web/src/components/ClientRemindersPanel.tsx` | header 清空鈕 + `window.confirm` + `refresh`／filter reset | ~25 行 |
| F3 | `apps/web/src/lib/i18n.tsx` | §6 新 keys × 三語（en／zh／ko） | ~3×4 行 |
| F4 | `apps/web/src/lib/reminders.test.ts`（或同目錄 store 案例延伸） | §7 clear 單元／回歸測試 | ~60 行 |

**不改**：`reminders.ts`（除非測試 helper）、`page.tsx` 派生路徑、`clients/[id]/page.tsx` 掛載、`apps/api`。

### 5.1 F1 草圖（完整）

```ts
export function clearClientReminders(clientId: string): number {
  const all = readAll();
  const current = all[clientId];
  if (!current) return 0;
  const prevLen = (current.reminders ?? []).length;
  if (prevLen === 0) return 0;
  all[clientId] = { ...current, reminders: [] };
  writeAll(all);
  return prevLen;
}
```

### 5.2 F2 草圖（處理函式）

```ts
import {
  DEMO_CLIENTS_OVERRIDES_STORAGE_KEY,
  clearClientReminders,
  getClientReminders,
  setClientReminderStatus,
} from "@/lib/demo-clients-store";

const onClearAll = () => {
  if (rows.length === 0) return;
  const ok = window.confirm(
    t("reminders.clear.confirm", { count: rows.length }),
  );
  if (!ok) return;
  clearClientReminders(clientId);
  setFilter("all");
  refresh();
};
```

---

## 6. i18n（zh / en / ko）

新增 keys（`apps/web/src/lib/i18n.tsx` 三 dict 各一份；插值用既有 `{name}` 語法）：

| Key | zh（繁中） | en | ko |
|---|---|---|---|
| `reminders.action.clearAll` | 清空此客戶提醒 | Clear reminders for this client | 이 고객 알림 비우기 |
| `reminders.clear.confirm` | 確定清空此客戶的全部提醒事項（共 {count} 筆，含待處理／已完成／已忽略／建議）？此操作無法復原。備註與近期事件不會受影響；之後重新跑試算仍可自動建立新提醒。 | Clear all reminders for this client ({count}, including open, done, dismissed, and suggested)? This cannot be undone. Notes and upcoming events are kept. A fresh backtest can recreate open reminders. | 이 고객의 모든 알림({count}건, 대기·완료·무시·제안 포함)을 삭제할까요? 되돌릴 수 없습니다. 메모·예정 이벤트는 유지되며, 이후 새 백테스트로 대기 알림을 다시 만들 수 있습니다. |

可選（若要用 disabled 空態 tooltip）：

| Key | zh | en | ko |
|---|---|---|---|
| `reminders.clear.disabledEmpty` | 目前沒有可清空的提醒 | No reminders to clear | 비울 알림이 없습니다 |

既有 keys **保留不動**：`reminders.panel.*`、`reminders.filter.*`、`reminders.action.done|dismiss|accept|openReport` 等。

---

## 7. 測試計畫

測試框架：vitest（`npx vitest run`；延續 `reminders.test.ts` 的 localStorage stub 模式，見既有 `setClientReminderStatus + store` describe ~`:565-616`）。

### 7.1 單元測試（store）

| # | 案例 | 斷言 |
|---|---|---|
| C1 | 客戶有 3 筆 reminders（open／done／dismissed）+ notes + events | `clearClientReminders` 回 `3`；`getClientReminders` → `[]`；`getExtraNotes`／`getExtraEvents` **不變** |
| C2 | 僅有 notes、無 reminders 欄位 | 回 `0`；notes 仍在；storage JSON 不無故改寫（或允許 no-op） |
| C3 | 無該 clientId entry | 回 `0` |
| C4 | 含 suggested 狀態 | suggested 一併清除（全狀態） |
| C5 | 清空後 `mergeClientReminders` 新 derived | `added` 含新提醒；行為與空 existing 一致 |
| C6 | 清空後 schedule 類曾 dismissed 的「不重建」記憶消失 | 同 subject R2 可再次 `added`（對照 merge U17 的反向：清空 = 重置 dismiss 記憶） |
| C7 | 其他 clientId 的 reminders 不受影響 | 只動目標客戶 |

### 7.2 UI／手動驗收

| # | 步驟 | 期望 |
|---|---|---|
| M1 | 客戶頁有提醒 → 見「清空此客戶提醒」 | 按鈕可見 |
| M2 | 點擊 → Cancel | 清單不變 |
| M3 | 點擊 → OK | 立刻 empty；notes／events 區塊仍在 |
| M4 | 另開同分頁客戶頁（或兩 tab） | storage 後同步 empty |
| M5 | 清空後再跑一輪會派生提醒的 fresh 試算 | 面板再度出現 open 提醒 |
| M6 | 切換 zh／en／ko | 按鈕與 confirm 文案正確 |
| M7 | 已空面板 | 無清空鈕（或 disabled） |

### 7.3 回歸

| # | 案例 | 期望 |
|---|---|---|
| R1 | 既有 U19／I5（缺 reminders 欄位） | 仍綠 |
| R2 | i18n key-parity：新 keys 三語皆在 | 不顯示裸 key |

---

## 8. 實作順序

| Phase | 內容 | 相依 | 完成判準 |
|---|---|---|---|
| **P1** Store + 測試 | F1、F4（C1–C7） | 無 | `npx vitest run src/lib/reminders.test.ts` 全綠 |
| **P2** i18n + UI | F3、F2 | P1 | 手動 M1–M7；三語目視 |
| **P3**（可選後續） | 「僅清待處理」進階選項 | 產品再確認 | 另開小 PR；需新 confirm 文案與 filter 語意 |

P1 可獨立合入（死碼 API 無害）。建議單一小型 PR：P1+P2。

---

## 9. 邊界案例

| # | 案例 | 預期行為 |
|---|---|---|
| E1 | **空列表** | 不顯示清空鈕；若仍呼叫 API → return `0` |
| E2 | **並發：清空後立刻新 job merge** | 以 write 時序為準：後寫勝。通常 clear → refresh → 之後 merge 寫入新清單。若 merge 在 clear 的 read／write 之間插入，可能先 merge 出清單再被 clear 清掉（或反之）。可接受；Demo 操作幾乎序列化。若要更硬：clear 與 merge 都可改成「read → mutate → write」並接受 last-write-wins（與現況 setStatus 相同模型） |
| E3 | **storage quota／private mode** | `writeAll` 靜默失敗；confirm 後 UI `refresh` 可能仍見舊資料。可選：比較 clear 前後 `getClientReminders().length`，若未變則 `alert`／toast（本期可不做，與 addNote 同級限制） |
| E4 | **多 tab 同步** | Tab A clear → `storage` event → Tab B `refresh`。Tab B 若在 event 前對舊 id `setStatus`，會 read-modify-write 把舊陣列寫回——**可能「復活」提醒**。緩解：setStatus／merge／clear 皆整陣列覆寫；文件化為已知限制；實務上 Demo 單人單 tab。進階（非本期）：寫入前用 version／timestamp 樂觀鎖 |
| E5 | **只剩 reminders: [] 的 client entry** | 可保留 `{ reminders: [] }`；或若 notes／events 亦空則 `delete all[clientId]`。建議：**有其他欄位就保留 entry；僅 reminders 空陣列即可**，實作簡單 |
| E6 | **篩選在 dismissed 時清空** | 清全量後 reset filter=all，顯示 empty，避免「篩選後 0 筆但 rows 已空」的困惑 |
| E7 | **StrictMode 雙呼叫** | clear 冪等（第二次 `0`） |
| E8 | **clientId 切換** | 既有 effect 已在 clientId 變更時 refresh／reset filter；清空鈕綁當前 clientId，不會清錯人 |

---

## 10. 與 auto-reminders 的關係

| 面向 | auto-reminders | 本功能 |
|---|---|---|
| 角色 | 建立／合併／結案／面板操作 | **營運重置**：單客戶提醒垃圾桶 |
| 資料 | 寫入 `overrides[clientId].reminders` | **只刪**同欄位內容 |
| 規則引擎 | `deriveReminders`／`mergeReminders` | **不改**規則；清空後下次 fresh 照常派生 |
| dismiss 記憶 | schedule 類 dismissed 不重建（auto-reminders U17） | 清空會抹除該記憶 → Demo 可重測 R2／R3／R6 |
| 面板 | `ClientRemindersPanel` 讀寫狀態 | 同面板新增破壞性動作 |
| 非目標對齊 | 不對客戶顯示、不上 server | 同樣僅 RM 本機 |

本功能是 auto-reminders 的**配套清理工具**，不是替代自動結案（auto-resolve）或單筆 dismiss。產品敘事：

- **日常**：用完成／忽略／接受管理待辦。
- **Demo／重測**：用「清空此客戶提醒」一次重置，再跑 fresh backtest 驗證派生。

---

## 11. 風險與回滾

| # | 風險 | 等級 | 緩解 |
|---|---|---|---|
| R-1 | **誤清正式客戶提醒** | 中 | 確認對話明示不可逆與筆數；按鈕非 primary；僅 RM 本機（無伺服器擴散） |
| R-2 | **開發者誤實作成刪整 key／整 client** | 高（若發生） | 程式碼審查對照 §3.1；C1 測試鎖定 notes／events 保留 |
| R-3 | **多 tab 復活**（E4） | 低 | 文件化；與既有 setStatus 同模型 |
| R-4 | **quota 寫入失敗以為已清** | 低 | 與既有 writeAll 一致；可選事後長度檢查 |
| R-5 | **i18n 缺 key** | 低 | R2 key-parity；confirm 文案過長時原生 dialog 仍可讀 |

**回滾**：

1. 還原 F2（UI 按鈕）即關閉使用者入口；
2. F1 API 可留作死碼或一併刪除；
3. 已寫入的 `reminders: []` 無需遷移；
4. 無引擎／API／DB 變更 → 回滾成本極低。

---

## 附錄 A：關鍵程式碼座標速查

| 符號 | 位置 |
|---|---|
| Storage key | `apps/web/src/lib/demo-clients-store.ts:10-11` |
| `ClientProfileOverrides` | `demo-clients-store.ts:19-23` |
| `readAll`／`writeAll` | `demo-clients-store.ts:32-57` |
| `getClientReminders` | `demo-clients-store.ts:116-118` |
| `mergeClientReminders` | `demo-clients-store.ts:121-139` |
| `setClientReminderStatus` | `demo-clients-store.ts:141-172` |
| `ReminderStatus`／`ClientReminder` | `apps/web/src/lib/reminders.ts:20-44` |
| `mergeReminders`（含 dismiss 不重建） | `reminders.ts:435-540`（schedule 分支 `:518-524`） |
| `deriveReminders` | `reminders.ts:226+` |
| 面板標題列／empty／storage 同步 | `ClientRemindersPanel.tsx:78-92, :231-244, :260-261` |
| 面板掛載 | `apps/web/src/app/clients/[id]/page.tsx:1111` |
| fresh merge 呼叫 | `apps/web/src/app/page.tsx` ~`:544-545`（`deriveReminders` + `mergeClientReminders`） |
| `window.confirm` 先例 | `apps/web/src/app/pool/page.tsx:127`；`FinancialGoalSimulator.tsx:637` |
| 既有 reminders i18n | `i18n.tsx` en ~`:1358-1399`、zh ~`:3308-3346`、ko ~`:5259+` |
| 既有 store 測試 stub | `reminders.test.ts:565-616` |
| 設計母文件 | `docs/design/auto-reminders.md` |

---

## 附錄 B：驗收清單（Definition of Done）

- [ ] `clearClientReminders` 只清目標客戶 `reminders`，notes／events／其他客戶不變（C1／C7）
- [ ] 四態皆清（含 suggested／dismissed）（C4／C6）
- [ ] 面板標題列有「清空此客戶提醒」；空列表不顯示
- [ ] 確認對話可取消；確認後 empty state
- [ ] 三語 i18n keys 齊全
- [ ] 清空後 fresh 試算可再建提醒（M5）
- [ ] 測試 C1–C7 綠；既有 reminders 測試無回歸
- [ ] **未**實作刪除整個 `jasper_demo_clients_overrides_v1`
