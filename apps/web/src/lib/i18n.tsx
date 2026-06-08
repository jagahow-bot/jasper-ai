"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export const LANG_STORAGE_KEY = "jasper-lang";

export type Lang = "en" | "zh" | "ko";

export const LANGUAGES: ReadonlyArray<{ code: Lang; label: string }> = [
  { code: "en", label: "EN" },
  { code: "zh", label: "中文" },
  { code: "ko", label: "한국어" },
] as const;

export const DEFAULT_LANG: Lang = "en";

function isLang(value: string | null): value is Lang {
  return value === "en" || value === "zh" || value === "ko";
}

type Dict = Record<string, string>;

const en: Dict = {
  // Header / shell
  "header.phase.scenario": "—",
  "header.phase.constraints": "CONFIG",
  "header.phase.running": "RUNNING",
  "header.phase.results": "RESULTS",
  "header.phase.export": "EXPORT",
  "header.apiOffline": "Service offline",
  "header.apiOfflineHint":
    "The analytics service is unreachable right now. Please try again in a moment.",
  "header.apiLinked": "Connected",
  "header.etfs": "{count} ETFs",
  "header.objectiveLab": "Objective Switch Lab",
  "header.terminalLog": "Terminal log",
  "lang.label": "LANG",
  "lang.aria": "Language",
  "font.label": "FONT",

  // Backtest history panel
  "history.title": "Backtest history",
  "history.refresh": "Refresh",
  "history.syncing": "Syncing…",
  "history.apiOffline": "API offline — local only",
  "history.record": "{count} record",
  "history.records": "{count} records",
  "history.empty":
    "Completed backtests appear here. After refresh, entries may still load from the API when the server retains them.",
  "history.load": "LOAD",
  "history.status.completed": "completed",
  "history.status.failed": "failed",
  "history.status.running": "running",
  "history.status.queued": "queued",

  // Constraints / config form
  "config.title": "Backtest config",
  "config.subtitle":
    "Institutional params. Each rebalance: factor screen → allocator weights.",
  "config.maxWeight": "Max single weight (hard ceiling): {pct}%",
  "config.minWeight": "Min holding weight: {pct}%",
  "config.minWeightHint":
    "Positions below this weight are dropped each rebalance; remaining weights are renormalized (dust effectively stays in cash).",
  "config.maxTurnover": "Max turnover / rebalance: {pct}%",
  "config.maxTurnoverHint":
    "Hard cap per rebalance. The optimizer only searches up to this slider, never above.",
  "config.maxHoldings": "Max portfolio holdings: {n}",
  "config.maxHoldingsHint":
    "Hard cap on the number of holdings each rebalance (the factor screen and optimizer cannot exceed this).",
  "config.topN": "Factor screen Top N: {n}",
  "config.topNHint":
    "Cross-section rank → Top N → MPT/min-var weights with position caps.",
  "config.objective": "Objective",
  "config.customObjective": "Custom objective text",
  "config.start": "Start",
  "config.startHint":
    "Prices load ~2+ years before this date for lookbacks; day-one weights use that prep (not an equal-weight placeholder).",
  "config.end": "End",
  "config.trials": "Search trials (standard): {n}",
  "config.topModels": "Models in report: {n}",
  "config.holdout":
    "Holdout split (optimize on in-sample only; holdout = OOS diagnostics)",
  "config.inSampleRatio": "In-sample ratio: {pct}% (rest = holdout tail)",
  "config.fee": "Trading cost: {bps} bps",
  "config.rebalanceFreq": "Rebalance frequency",
  "config.rebalance.weekly": "Weekly (Fri)",
  "config.rebalance.monthly": "Monthly (ME)",
  "config.rebalance.quarterly": "Quarterly (QE)",
  "config.rebalance.yearly": "Yearly (YE)",
  "config.runStandard": "Run backtest + optimize",
  "config.runPro": "Run Pro auto-convergence",

  // Pro rounds tabs
  "pro.tabsHint":
    "Pro rounds · each tab = incoming champion + round challengers; ★ = round winner (catalog tab = every model ever tried, not the active pool)",
  "pro.allRounds": "ALL ROUNDS (catalog)",
  "pro.role.incoming": "Incoming champion",
  "pro.role.challenger": "Round challenger",
  "pro.role.winner": "Round winner",

  // Results dashboard
  "results.title": "Results · institutional",
  "results.model": "model",
  "results.fullNarrative": "Full backtest narrative",
  "results.fullPeriod": "Full period",
  "results.refineHint":
    "Click to apply a parameter · double-click a chip to rerun right away.",
  "results.editConfig": "Edit configuration",
  "results.exportCsv": "Export CSV",

  // Conversation log
  "chat.welcome":
    "Jasper is online. Universe: {count} ETFs. Set your parameters below — each rebalance runs a factor screen (Top N), then builds the allocator weights (mean-variance / minimum-variance).",
  "chat.complete":
    "Backtest complete. Top model by objective: {model} vs {benchmark} — Sharpe {sharpe}, max drawdown {mdd}%, CAGR {cagr}%. Switch between models in the results panel.",
  "chat.loadHistory": "Open saved backtest {id}…",
  "chat.loadHistoryLocal": "Open saved backtest {id} (local copy)…",
  "chat.jobNotCompleted": "Backtest {id} hasn’t finished yet ({status}).",
  "chat.jobNotFound":
    "This backtest isn’t available on the server, and no local copy was found.",
  "chat.historyLoadFailed": "We couldn’t open that saved backtest.",
  "chat.runFailed": "The backtest couldn’t be completed. Please try again.",
  "chat.userRunPro": "Run Pro auto-convergence",
  "chat.userRunStandard": "Run backtest and optimize",
  "chat.ackPro":
    "Starting the Pro champion–challenger run. Overfitting safeguards are active…",
  "chat.ackStandard": "Starting the optimization run…",
  "chat.tweak": "Adjustment: {label}",
  "chat.tweakApplied":
    "Parameters updated. Make more changes, or press ↻ to rerun now.",
  "chat.tweakRerun": "Adjust and rerun: {label}",
  "chat.ackRerun": "Recomputing with the updated parameters…",
  "chat.backToConfig": "Back to configuration",
};

const zh: Dict = {
  "header.phase.scenario": "—",
  "header.phase.constraints": "配置",
  "header.phase.running": "运行中",
  "header.phase.results": "结果",
  "header.phase.export": "导出",
  "header.apiOffline": "服务离线",
  "header.apiOfflineHint": "分析服务暂时无法连接，请稍后重试。",
  "header.apiLinked": "已连接",
  "header.etfs": "{count} 个 ETF",
  "header.objectiveLab": "目标切换实验室",
  "header.terminalLog": "终端日志",
  "lang.label": "语言",
  "lang.aria": "语言",
  "font.label": "字号",

  "history.title": "回测历史",
  "history.refresh": "刷新",
  "history.syncing": "同步中…",
  "history.apiOffline": "API 离线 — 仅本地",
  "history.record": "{count} 条记录",
  "history.records": "{count} 条记录",
  "history.empty":
    "已完成的回测会显示在此处。刷新后，若服务器仍保留记录，条目可能从 API 加载。",
  "history.load": "加载",
  "history.status.completed": "已完成",
  "history.status.failed": "失败",
  "history.status.running": "运行中",
  "history.status.queued": "排队中",

  "config.title": "回测配置",
  "config.subtitle": "机构级参数。每次再平衡：因子筛选 → 配置权重。",
  "config.maxWeight": "单一资产最大权重（硬上限）：{pct}%",
  "config.minWeight": "最小持仓权重：{pct}%",
  "config.minWeightHint":
    "每次再平衡时低于该权重的持仓会被剔除；剩余权重重新归一化（零散仓位实际留作现金）。",
  "config.maxTurnover": "每次再平衡最大换手率：{pct}%",
  "config.maxTurnoverHint":
    "每次再平衡的硬上限。优化器最多只能搜索到此滑块值，不会更高。",
  "config.maxHoldings": "组合最大持仓数：{n}",
  "config.maxHoldingsHint":
    "每次再平衡持仓数量的硬上限（因子筛选与优化器都不能超过）。",
  "config.topN": "因子筛选 Top N：{n}",
  "config.topNHint": "横截面排名 → Top N → 带仓位上限的 MPT/最小方差权重。",
  "config.objective": "优化目标",
  "config.customObjective": "自定义目标文本",
  "config.start": "开始日期",
  "config.startHint":
    "为计算回看窗口，价格数据会在此日期前加载约 2 年以上；首日权重基于该准备数据（非等权占位）。",
  "config.end": "结束日期",
  "config.trials": "搜索试验次数（标准）：{n}",
  "config.topModels": "报告中模型数：{n}",
  "config.holdout": "留出拆分（仅在样本内优化；留出 = 样本外诊断）",
  "config.inSampleRatio": "样本内比例：{pct}%（其余 = 留出尾段）",
  "config.fee": "交易成本：{bps} 基点",
  "config.rebalanceFreq": "再平衡频率",
  "config.rebalance.weekly": "每周（周五）",
  "config.rebalance.monthly": "每月（ME）",
  "config.rebalance.quarterly": "每季度（QE）",
  "config.rebalance.yearly": "每年（YE）",
  "config.runStandard": "运行回测 + 优化",
  "config.runPro": "运行 Pro 自动收敛",

  "pro.tabsHint":
    "Pro 轮次 · 每个标签 = 现任冠军 + 本轮挑战者；★ = 本轮优胜者（目录标签 = 历来尝试过的所有模型，而非当前池）",
  "pro.allRounds": "全部轮次（目录）",
  "pro.role.incoming": "现任冠军",
  "pro.role.challenger": "本轮挑战者",
  "pro.role.winner": "本轮优胜者",

  "results.title": "结果 · 机构级",
  "results.model": "模型",
  "results.fullNarrative": "完整回测说明",
  "results.fullPeriod": "全周期",
  "results.refineHint": "点击应用单项参数 · 双击标签立即重跑。",
  "results.editConfig": "编辑配置",
  "results.exportCsv": "导出 CSV",

  // Conversation log
  "chat.welcome":
    "Jasper 已就绪。投资范围：{count} 个 ETF。请在下方设置参数——每次再平衡先进行因子筛选（Top N），再构建配置权重（均值方差 / 最小方差）。",
  "chat.complete":
    "回测完成。按目标排名最优模型：{model}（对比 {benchmark}）——夏普 {sharpe}，最大回撤 {mdd}%，年化收益 {cagr}%。可在结果面板中切换模型。",
  "chat.loadHistory": "打开已保存的回测 {id}…",
  "chat.loadHistoryLocal": "打开已保存的回测 {id}（本地副本）…",
  "chat.jobNotCompleted": "回测 {id} 尚未完成（{status}）。",
  "chat.jobNotFound": "该回测在服务器上不可用，且未找到本地副本。",
  "chat.historyLoadFailed": "无法打开该已保存的回测。",
  "chat.runFailed": "回测未能完成，请重试。",
  "chat.userRunPro": "运行 Pro 自动收敛",
  "chat.userRunStandard": "运行回测并优化",
  "chat.ackPro": "正在启动 Pro 冠军—挑战者流程，过拟合防护已开启……",
  "chat.ackStandard": "正在启动优化流程……",
  "chat.tweak": "参数调整：{label}",
  "chat.tweakApplied": "参数已更新。可继续调整，或点击 ↻ 立即重跑。",
  "chat.tweakRerun": "调整并重跑：{label}",
  "chat.ackRerun": "正在使用更新后的参数重新计算……",
  "chat.backToConfig": "返回配置",
};

const ko: Dict = {
  "header.phase.scenario": "—",
  "header.phase.constraints": "설정",
  "header.phase.running": "실행 중",
  "header.phase.results": "결과",
  "header.phase.export": "내보내기",
  "header.apiOffline": "서비스 오프라인",
  "header.apiOfflineHint": "분석 서비스에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.",
  "header.apiLinked": "연결됨",
  "header.etfs": "ETF {count}개",
  "header.objectiveLab": "목적 전환 랩",
  "header.terminalLog": "터미널 로그",
  "lang.label": "언어",
  "lang.aria": "언어",
  "font.label": "글꼴",

  "history.title": "백테스트 기록",
  "history.refresh": "새로고침",
  "history.syncing": "동기화 중…",
  "history.apiOffline": "API 오프라인 — 로컬 전용",
  "history.record": "{count}건",
  "history.records": "{count}건",
  "history.empty":
    "완료된 백테스트가 여기에 표시됩니다. 새로고침 후 서버가 기록을 보관 중이면 API에서 불러올 수 있습니다.",
  "history.load": "불러오기",
  "history.status.completed": "완료됨",
  "history.status.failed": "실패",
  "history.status.running": "실행 중",
  "history.status.queued": "대기 중",

  "config.title": "백테스트 설정",
  "config.subtitle": "기관용 파라미터. 각 리밸런스: 팩터 스크리닝 → 배분 가중치.",
  "config.maxWeight": "단일 종목 최대 비중(상한): {pct}%",
  "config.minWeight": "최소 보유 비중: {pct}%",
  "config.minWeightHint":
    "이 비중 미만 종목은 매 리밸런스마다 제외되고 남은 비중은 재정규화됩니다(잔여분은 사실상 현금 유지).",
  "config.maxTurnover": "리밸런스당 최대 회전율: {pct}%",
  "config.maxTurnoverHint":
    "리밸런스당 상한. 옵티마이저는 이 슬라이더까지만 탐색하며 초과하지 않습니다.",
  "config.maxHoldings": "포트폴리오 최대 보유 종목: {n}",
  "config.maxHoldingsHint":
    "매 리밸런스 보유 종목 수의 상한(팩터 스크리닝과 옵티마이저 모두 초과 불가).",
  "config.topN": "팩터 스크리닝 Top N: {n}",
  "config.topNHint":
    "횡단면 랭킹 → Top N → 비중 상한이 적용된 MPT/최소분산 가중치.",
  "config.objective": "목적 함수",
  "config.customObjective": "사용자 정의 목적 텍스트",
  "config.start": "시작일",
  "config.startHint":
    "룩백 계산을 위해 이 날짜 이전 약 2년 이상의 가격을 불러옵니다. 첫날 비중은 이 준비 데이터를 사용합니다(균등 비중 자리표시자 아님).",
  "config.end": "종료일",
  "config.trials": "탐색 시도(표준): {n}",
  "config.topModels": "보고서 모델 수: {n}",
  "config.holdout": "홀드아웃 분할(인샘플에서만 최적화; 홀드아웃 = OOS 진단)",
  "config.inSampleRatio": "인샘플 비율: {pct}% (나머지 = 홀드아웃 구간)",
  "config.fee": "거래 비용: {bps} bps",
  "config.rebalanceFreq": "리밸런스 주기",
  "config.rebalance.weekly": "매주(금)",
  "config.rebalance.monthly": "매월(ME)",
  "config.rebalance.quarterly": "분기(QE)",
  "config.rebalance.yearly": "매년(YE)",
  "config.runStandard": "백테스트 + 최적화 실행",
  "config.runPro": "Pro 자동 수렴 실행",

  "pro.tabsHint":
    "Pro 라운드 · 각 탭 = 현 챔피언 + 라운드 도전자; ★ = 라운드 승자 (카탈로그 탭 = 시도된 모든 모델, 현재 풀 아님)",
  "pro.allRounds": "전체 라운드(카탈로그)",
  "pro.role.incoming": "현 챔피언",
  "pro.role.challenger": "라운드 도전자",
  "pro.role.winner": "라운드 승자",

  "results.title": "결과 · 기관용",
  "results.model": "모델",
  "results.fullNarrative": "전체 백테스트 설명",
  "results.fullPeriod": "전체 기간",
  "results.refineHint": "클릭하면 파라미터 적용 · 칩을 더블클릭하면 즉시 재실행.",
  "results.editConfig": "설정 편집",
  "results.exportCsv": "CSV 내보내기",

  // Conversation log
  "chat.welcome":
    "Jasper가 준비되었습니다. 유니버스: ETF {count}개. 아래에서 파라미터를 설정하세요 — 매 리밸런스마다 팩터 스크리닝(Top N) 후 배분 가중치(평균-분산 / 최소분산)를 산출합니다.",
  "chat.complete":
    "백테스트 완료. 목적 함수 기준 최상위 모델: {model} (vs {benchmark}) — 샤프 {sharpe}, 최대 낙폭 {mdd}%, CAGR {cagr}%. 결과 패널에서 모델을 전환할 수 있습니다.",
  "chat.loadHistory": "저장된 백테스트 {id} 열기…",
  "chat.loadHistoryLocal": "저장된 백테스트 {id} 열기 (로컬 사본)…",
  "chat.jobNotCompleted": "백테스트 {id}가 아직 완료되지 않았습니다 ({status}).",
  "chat.jobNotFound": "이 백테스트는 서버에서 사용할 수 없으며 로컬 사본도 찾을 수 없습니다.",
  "chat.historyLoadFailed": "저장된 백테스트를 열 수 없습니다.",
  "chat.runFailed": "백테스트를 완료하지 못했습니다. 다시 시도해 주세요.",
  "chat.userRunPro": "Pro 자동 수렴 실행",
  "chat.userRunStandard": "백테스트 실행 및 최적화",
  "chat.ackPro": "Pro 챔피언–도전자 실행을 시작합니다. 과적합 점검이 활성화되었습니다…",
  "chat.ackStandard": "최적화 실행을 시작합니다…",
  "chat.tweak": "조정: {label}",
  "chat.tweakApplied": "파라미터가 업데이트되었습니다. 더 조정하거나 ↻를 눌러 지금 재실행하세요.",
  "chat.tweakRerun": "조정 후 재실행: {label}",
  "chat.ackRerun": "업데이트된 파라미터로 다시 계산하는 중…",
  "chat.backToConfig": "설정으로 돌아가기",
};

const DICTS: Record<Lang, Dict> = { en, zh, ko };

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in params ? String(params[key]) : match,
  );
}

export type TFn = (key: string, params?: Record<string, string | number>) => string;

export function translate(lang: Lang, key: string, params?: Record<string, string | number>): string {
  const template = DICTS[lang]?.[key] ?? DICTS.en[key] ?? key;
  return interpolate(template, params);
}

export function readStoredLang(): Lang {
  if (typeof window === "undefined") return DEFAULT_LANG;
  try {
    const raw = localStorage.getItem(LANG_STORAGE_KEY);
    return isLang(raw) ? raw : DEFAULT_LANG;
  } catch {
    return DEFAULT_LANG;
  }
}

function persistLang(lang: Lang): void {
  try {
    localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    /* private mode / quota */
  }
}

type I18nContextValue = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: TFn;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(DEFAULT_LANG);

  useEffect(() => {
    setLangState(readStoredLang());
  }, []);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    persistLang(next);
    if (typeof document !== "undefined") {
      document.documentElement.lang = next;
    }
  }, []);

  const value = useMemo<I18nContextValue>(
    () => ({
      lang,
      setLang,
      t: (key, params) => translate(lang, key, params),
    }),
    [lang, setLang],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within an I18nProvider");
  }
  return ctx;
}
