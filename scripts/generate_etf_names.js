/**
 * Generate shared/etf-names.json (en / zh / ko) from etf-universe + curated overrides.
 * Run: node scripts/generate_etf_names.js
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

function loadJson(p) {
  let s = fs.readFileSync(p, "utf8");
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  return JSON.parse(s);
}

const CJK = /[\u4e00-\u9fff]/;

/** High-quality names for demo / model / client holdings and common UI tickers. */
const CURATED = {
  SPY: {
    en: "SPDR S&P 500 ETF Trust",
    zh: "標普500 ETF",
    ko: "S&P 500 ETF",
  },
  QQQ: {
    en: "Invesco QQQ Trust",
    zh: "納斯達克100 ETF",
    ko: "나스닥 100 ETF",
  },
  IWM: {
    en: "iShares Russell 2000 ETF",
    zh: "羅素2000 ETF",
    ko: "러셀 2000 ETF",
  },
  IVV: {
    en: "iShares Core S&P 500 ETF",
    zh: "標普500 ETF（iShares）",
    ko: "S&P 500 ETF (iShares)",
  },
  DIA: {
    en: "SPDR Dow Jones Industrial Average ETF",
    zh: "道瓊工業平均 ETF",
    ko: "다우존스 산업평균 ETF",
  },
  VTI: {
    en: "Vanguard Total Stock Market ETF",
    zh: "全美股市 ETF",
    ko: "미국 전체 주식 ETF",
  },
  VXUS: {
    en: "Vanguard Total International Stock ETF",
    zh: "全球（除美）股票 ETF",
    ko: "미국 제외 글로벌 주식 ETF",
  },
  EFA: {
    en: "iShares MSCI EAFE ETF",
    zh: "已開發市場（除美）ETF",
    ko: "선진국(미국 제외) ETF",
  },
  AGG: {
    en: "iShares Core U.S. Aggregate Bond ETF",
    zh: "美國綜合債券 ETF",
    ko: "미국 종합채권 ETF",
  },
  BND: {
    en: "Vanguard Total Bond Market ETF",
    zh: "美國綜合債券 ETF（Vanguard）",
    ko: "미국 종합채권 ETF (Vanguard)",
  },
  TLT: {
    en: "iShares 20+ Year Treasury Bond ETF",
    zh: "長天期美債（20年+）ETF",
    ko: "초장기 미국 국채(20년+) ETF",
  },
  IEF: {
    en: "iShares 7–10 Year Treasury Bond ETF",
    zh: "中期美債（7–10年）ETF",
    ko: "중기 미국 국채(7–10년) ETF",
  },
  SHY: {
    en: "iShares 1–3 Year Treasury Bond ETF",
    zh: "短期美債（1–3年）ETF",
    ko: "단기 미국 국채(1–3년) ETF",
  },
  LQD: {
    en: "iShares iBoxx $ Investment Grade Corporate Bond ETF",
    zh: "投資級公司債 ETF",
    ko: "투자등급 회사채 ETF",
  },
  HYG: {
    en: "iShares iBoxx $ High Yield Corporate Bond ETF",
    zh: "高收益債 ETF",
    ko: "하이일드 채권 ETF",
  },
  GLD: {
    en: "SPDR Gold Shares",
    zh: "黃金 ETF",
    ko: "금 ETF",
  },
  PDBC: {
    en: "Invesco Optimum Yield Diversified Commodity Strategy ETF",
    zh: "商品指數 ETF",
    ko: "원자재 지수 ETF",
  },
  XLV: {
    en: "Health Care Select Sector SPDR Fund",
    zh: "醫療保健類股 ETF",
    ko: "헬스케어 섹터 ETF",
  },
  XLF: {
    en: "Financial Select Sector SPDR Fund",
    zh: "金融類股 ETF",
    ko: "금융 섹터 ETF",
  },
  // Common sector / broad (pool UI)
  XLK: { en: "Technology Select Sector SPDR Fund", zh: "科技類股 ETF", ko: "기술 섹터 ETF" },
  XLE: { en: "Energy Select Sector SPDR Fund", zh: "能源類股 ETF", ko: "에너지 섹터 ETF" },
  XLI: { en: "Industrial Select Sector SPDR Fund", zh: "工業類股 ETF", ko: "산업 섹터 ETF" },
  XLY: { en: "Consumer Discretionary Select Sector SPDR Fund", zh: "非必需消費類股 ETF", ko: "경기소비재 섹터 ETF" },
  XLP: { en: "Consumer Staples Select Sector SPDR Fund", zh: "必需消費類股 ETF", ko: "필수소비재 섹터 ETF" },
  XLU: { en: "Utilities Select Sector SPDR Fund", zh: "公用事業類股 ETF", ko: "유틸리티 섹터 ETF" },
  XLB: { en: "Materials Select Sector SPDR Fund", zh: "原物料類股 ETF", ko: "소재 섹터 ETF" },
  XLC: { en: "Communication Services Select Sector SPDR Fund", zh: "通訊服務類股 ETF", ko: "커뮤니케이션 섹터 ETF" },
  XLRE: { en: "Real Estate Select Sector SPDR Fund", zh: "房地產類股 ETF", ko: "부동산 섹터 ETF" },
  EEM: { en: "iShares MSCI Emerging Markets ETF", zh: "新興市場 ETF", ko: "신흥국 ETF" },
  VWO: { en: "Vanguard FTSE Emerging Markets ETF", zh: "新興市場 ETF（Vanguard）", ko: "신흥국 ETF (Vanguard)" },
  IEFA: { en: "iShares Core MSCI EAFE ETF", zh: "已開發市場 ETF（iShares）", ko: "선진국 ETF (iShares)" },
  IEMG: { en: "iShares Core MSCI Emerging Markets ETF", zh: "新興市場 ETF（iShares Core）", ko: "신흥국 ETF (iShares Core)" },
  TIP: { en: "iShares TIPS Bond ETF", zh: "通膨連動債（TIPS）ETF", ko: "물가연동국채(TIPS) ETF" },
  SLV: { en: "iShares Silver Trust", zh: "白銀 ETF", ko: "은 ETF" },
  VNQ: { en: "Vanguard Real Estate ETF", zh: "美國 REITs ETF", ko: "미국 리츠 ETF" },
  BNDX: { en: "Vanguard Total International Bond ETF", zh: "全球債券（除美）ETF", ko: "미국 제외 글로벌 채권 ETF" },
  QQQM: { en: "Invesco NASDAQ 100 ETF", zh: "納斯達克100 ETF（低成本）", ko: "나스닥 100 ETF (저비용)" },
  SPLG: { en: "SPDR Portfolio S&P 500 ETF", zh: "標普500 ETF（低成本）", ko: "S&P 500 ETF (저비용)" },
  ITOT: { en: "iShares Core S&P Total U.S. Stock Market ETF", zh: "全美股市 ETF（iShares）", ko: "미국 전체 주식 ETF (iShares)" },
  SCHD: { en: "Schwab U.S. Dividend Equity ETF", zh: "股息成長 ETF", ko: "배당 성장 ETF" },
  VYM: { en: "Vanguard High Dividend Yield ETF", zh: "高股息 ETF", ko: "고배당 ETF" },
  USMV: { en: "iShares MSCI USA Min Vol Factor ETF", zh: "美國最小波動 ETF", ko: "미국 최소변동성 ETF" },
  MTUM: { en: "iShares MSCI USA Momentum Factor ETF", zh: "動能因子 ETF", ko: "모멘텀 팩터 ETF" },
  QUAL: { en: "iShares MSCI USA Quality Factor ETF", zh: "品質因子 ETF", ko: "퀄리티 팩터 ETF" },
  EMB: { en: "iShares J.P. Morgan USD Emerging Markets Bond ETF", zh: "新興市場美元債 ETF", ko: "신흥국 달러채권 ETF" },
  MUB: { en: "iShares National Muni Bond ETF", zh: "市政債 ETF", ko: "지방채 ETF" },
  JNK: { en: "SPDR Bloomberg High Yield Bond ETF", zh: "高收益債 ETF（SPDR）", ko: "하이일드 채권 ETF (SPDR)" },
  IAU: { en: "iShares Gold Trust", zh: "黃金 ETF（低成本）", ko: "금 ETF (저비용)" },
  DBC: { en: "Invesco DB Commodity Index Tracking Fund", zh: "商品指數 ETF", ko: "원자재 지수 ETF" },
  PFF: { en: "iShares Preferred and Income Securities ETF", zh: "優先股 ETF", ko: "우선주 ETF" },
  BKLN: { en: "Invesco Senior Loan ETF", zh: "銀行貸款 ETF", ko: "은행대출 ETF" },
  GOVT: { en: "iShares U.S. Treasury Bond ETF", zh: "美債全期限 ETF", ko: "미국 국채 전체 ETF" },
  SHV: { en: "iShares Short Treasury Bond ETF", zh: "超短期美債 ETF", ko: "초단기 미국 국채 ETF" },
  BIL: { en: "SPDR Bloomberg 1-3 Month T-Bill ETF", zh: "1–3月美債 ETF", ko: "1–3개월 단기국채 ETF" },
  ARKK: { en: "ARK Innovation ETF", zh: "創新主動 ETF", ko: "혁신 액티브 ETF" },
  SMH: { en: "VanEck Semiconductor ETF", zh: "半導體 ETF", ko: "반도체 ETF" },
  SOXX: { en: "iShares Semiconductor ETF", zh: "半導體 ETF（iShares）", ko: "반도체 ETF (iShares)" },
  KWEB: { en: "KraneShares CSI China Internet ETF", zh: "中國網路 ETF", ko: "중국 인터넷 ETF" },
  FXI: { en: "iShares China Large-Cap ETF", zh: "中國大型股 ETF", ko: "중국 대형주 ETF" },
  EWJ: { en: "iShares MSCI Japan ETF", zh: "日本 ETF", ko: "일본 ETF" },
  EWT: { en: "iShares MSCI Taiwan ETF", zh: "台灣 ETF", ko: "대만 ETF" },
  EWY: { en: "iShares MSCI South Korea ETF", zh: "南韓 ETF", ko: "한국 ETF" },
  INDA: { en: "iShares MSCI India ETF", zh: "印度 ETF", ko: "인도 ETF" },
  ACWI: { en: "iShares MSCI ACWI ETF", zh: "全球股票 ETF", ko: "글로벌 주식 ETF" },
  VT: { en: "Vanguard Total World Stock ETF", zh: "全球股市 ETF", ko: "글로벌 전체 주식 ETF" },
  URTH: { en: "iShares MSCI World ETF", zh: "全球已開發 ETF", ko: "글로벌 선진국 ETF" },
  IJR: { en: "iShares Core S&P Small-Cap ETF", zh: "S&P 小型股 600 ETF", ko: "S&P 소형주 600 ETF" },
  IJH: { en: "iShares Core S&P Mid-Cap ETF", zh: "S&P 中型股 ETF", ko: "S&P 중형주 ETF" },
  MDY: { en: "SPDR S&P MidCap 400 ETF Trust", zh: "S&P 中型股 400 ETF", ko: "S&P 중형주 400 ETF" },
  RSP: { en: "Invesco S&P 500 Equal Weight ETF", zh: "標普500等權重 ETF", ko: "S&P 500 동일가중 ETF" },
  VCIT: { en: "Vanguard Intermediate-Term Corporate Bond ETF", zh: "中期公司債 ETF", ko: "중기 회사채 ETF" },
  VCSH: { en: "Vanguard Short-Term Corporate Bond ETF", zh: "短期公司債 ETF", ko: "단기 회사채 ETF" },
  MCHI: { en: "iShares MSCI China ETF", zh: "中國大型股 ETF", ko: "중국 대형주 ETF" },
  ASHR: { en: "Xtrackers Harvest CSI 300 China A-Shares ETF", zh: "中國A股 ETF", ko: "중국 A주 ETF" },
  ICLN: { en: "iShares Global Clean Energy ETF", zh: "潔淨能源 ETF", ko: "클린에너지 ETF" },
  BOTZ: { en: "Global X Robotics & Artificial Intelligence ETF", zh: "機器人與 AI ETF", ko: "로봇·AI ETF" },
  USO: { en: "United States Oil Fund", zh: "原油 ETF", ko: "원유 ETF" },
  GDX: { en: "VanEck Gold Miners ETF", zh: "金礦股 ETF", ko: "금광 주식 ETF" },
  CPER: { en: "United States Copper Index Fund", zh: "銅 ETF", ko: "구리 ETF" },
};

/** Map common Traditional Chinese universe labels → English short + Korean. */
const ZH_TO_EN_KO = {
  全球股票: ["Global equities", "글로벌 주식"],
  創新主動: ["ARK innovation", "혁신 액티브"],
  "機器人與 AI": ["Robotics & AI", "로봇·AI"],
  道瓊30: ["Dow Jones 30", "다우존스 30"],
  新興市場: ["Emerging markets", "신흥국"],
  "已開發市場（除美）": ["Developed markets ex-US", "선진국(미국 제외)"],
  澳洲: ["Australia", "호주"],
  加拿大: ["Canada", "캐나다"],
  德國: ["Germany", "독일"],
  日本: ["Japan", "일본"],
  台灣: ["Taiwan", "대만"],
  英國: ["United Kingdom", "영국"],
  南韓: ["South Korea", "한국"],
  巴西: ["Brazil", "브라질"],
  歐元區: ["Eurozone", "유로존"],
  歐元區大型: ["Eurozone large-cap", "유로존 대형주"],
  "中國大型 (大型)": ["China large-cap", "중국 대형주"],
  "高股息 (iShares)": ["High dividend (iShares)", "고배당 (iShares)"],
  潔淨能源: ["Clean energy", "클린에너지"],
  "已開發市場 (iShares)": ["Developed markets (iShares)", "선진국 (iShares)"],
  "新興市場 (iShares)": ["Emerging markets (iShares)", "신흥국 (iShares)"],
  歐洲: ["Europe", "유럽"],
  "S&P 中型股 (iShares)": ["S&P mid-cap (iShares)", "S&P 중형주 (iShares)"],
  "S&P 小型股 600": ["S&P SmallCap 600", "S&P 소형주 600"],
  印度: ["India", "인도"],
  "全美股市 (iShares)": ["Total US stock market (iShares)", "미국 전체 주식 (iShares)"],
  "S&P 500 (iShares)": ["S&P 500 (iShares)", "S&P 500 (iShares)"],
  羅素1000大型: ["Russell 1000", "러셀 1000"],
  羅素1000價值: ["Russell 1000 Value", "러셀 1000 가치"],
  羅素1000成長: ["Russell 1000 Growth", "러셀 1000 성장"],
  羅素2000小型股: ["Russell 2000", "러셀 2000"],
  羅素3000: ["Russell 3000", "러셀 3000"],
  "全球（除美）iShares": ["Total international (iShares)", "미국 제외 글로벌 (iShares)"],
  中國網路: ["China internet", "중국 인터넷"],
  中國大型股: ["China large-cap", "중국 대형주"],
  "S&P 中型股 400": ["S&P MidCap 400", "S&P 중형주 400"],
  動能因子: ["Momentum factor", "모멘텀 팩터"],
  納斯達克100: ["Nasdaq 100", "나스닥 100"],
  "納스達크100 (低成本)": ["Nasdaq 100 (low cost)", "나스닥 100 (저비용)"],
  品質因子: ["Quality factor", "퀄리티 팩터"],
  "全美股市 (Schwab)": ["Total US market (Schwab)", "미국 전체 시장 (Schwab)"],
  股息成長: ["Dividend growth", "배당 성장"],
  規模因子: ["Size factor", "사이즈 팩터"],
  "S&P 500低波動": ["S&P 500 low volatility", "S&P 500 저변동성"],
  "S&P 500": ["S&P 500", "S&P 500"],
  全球已開發: ["World developed", "글로벌 선진국"],
  "MSCI美國最小波動": ["MSCI USA min volatility", "MSCI 미국 최소변동성"],
  小型股: ["Small-cap", "소형주"],
  大型成長: ["Large-cap growth", "대형 성장"],
  "新興市場 (Vanguard)": ["Emerging markets (Vanguard)", "신흥국 (Vanguard)"],
  "全球（除美）": ["Total international ex-US", "미국 제외 글로벌"],
  高股息: ["High dividend yield", "고배당"],
  原物料: ["Materials", "소재"],
  通訊服務: ["Communication services", "커뮤니케이션"],
  能源類股: ["Energy sector", "에너지 섹터"],
  金融類股: ["Financials sector", "금융 섹터"],
  工業類股: ["Industrials sector", "산업 섹터"],
  科技類股: ["Technology sector", "기술 섹터"],
  必需消費: ["Consumer staples", "필수소비재"],
  公用事業: ["Utilities", "유틸리티"],
  醫療類股: ["Health care sector", "헬스케어 섹터"],
  非必需消費: ["Consumer discretionary", "경기소비재"],
  "美國綜合債券 iShares": ["US aggregate bond (iShares)", "미국 종합채권 (iShares)"],
  "1-3月美債": ["1–3 month T-bills", "1–3개월 단기국채"],
  美國綜合債券: ["US aggregate bond", "미국 종합채권"],
  "全球債券（除美）": ["International bond ex-US", "미국 제외 글로벌 채권"],
  新興市場美元債: ["EM USD bonds", "신흥국 달러채권"],
  美債全期限: ["US Treasury broad", "미국 국채 전체"],
  高收益債: ["High yield bond", "하이일드 채권"],
  "全球債券 iShares": ["International bond (iShares)", "국제 채권 (iShares)"],
  "中期美債 7-10年": ["7–10 year Treasury", "7–10년 미국 국채"],
  "中短期美債 3-7年": ["3–7 year Treasury", "3–7년 미국 국채"],
  "高收益債 (SPDR)": ["High yield (SPDR)", "하이일드 (SPDR)"],
  投資級公司債: ["Investment-grade corporate", "투자등급 회사채"],
  市政債: ["Municipal bond", "지방채"],
  超短期美債: ["Short Treasury", "초단기 미국 국채"],
  "短期美債 1-3年": ["1–3 year Treasury", "1–3년 미국 국채"],
  "短期 TIPS": ["Short-term TIPS", "단기 TIPS"],
  "通膨連動債 TIPS": ["TIPS inflation-linked", "물가연동국채 TIPS"],
  "長天期美債 20+年": ["20+ year Treasury", "20년+ 미국 국채"],
  "高收益 (iShares)": ["High yield (iShares)", "하이일드 (iShares)"],
  中期公司債: ["Intermediate corporate bond", "중기 회사채"],
  短期公司債: ["Short-term corporate bond", "단기 회사채"],
  "中期美債 Vanguard": ["Intermediate Treasury (Vanguard)", "중기 국채 (Vanguard)"],
  "長期美債 Vanguard": ["Long Treasury (Vanguard)", "장기 국채 (Vanguard)"],
  "市政債 Vanguard": ["Municipal bond (Vanguard)", "지방채 (Vanguard)"],
  "新興市場債 Vanguard": ["EM bond (Vanguard)", "신흥국 채권 (Vanguard)"],
  銅: ["Copper", "구리"],
  商品指數: ["Broad commodities", "원자재 지수"],
  金礦股: ["Gold miners", "금광 주식"],
  黃金: ["Gold", "금"],
  "商品 S&P GSCI": ["S&P GSCI commodities", "S&P GSCI 원자재"],
  "黃金 (低成本)": ["Gold (low cost)", "금 (저비용)"],
  "商品指數 (主動)": ["Broad commodities (active)", "원자재 지수 (액티브)"],
  白銀: ["Silver", "은"],
  原油: ["Crude oil", "원유"],
  美國房地產: ["US real estate", "미국 부동산"],
  "全球 REITs": ["Global REITs", "글로벌 리츠"],
  "美國 REITs Schwab": ["US REITs (Schwab)", "미국 리츠 (Schwab)"],
  "美國 REITs": ["US REITs", "미국 리츠"],
  "國際 REITs": ["International REITs", "국제 리츠"],
  房地產類股: ["Real estate sector", "부동산 섹터"],
  "MLP 能源基礎建設": ["MLP energy infrastructure", "MLP 에너지 인프라"],
  銀行貸款: ["Bank loans", "은행대출"],
  優先股: ["Preferred stock", "우선주"],
  "優先股 (全球)": ["Preferred securities", "우선주"],
};

/** English phrase fragments → zh / ko (longest-first apply). */
const EN_PHRASES = [
  ["Investment-grade floating rate", "投資級浮動利率債", "투자등급 변동금리"],
  ["Dev ex-US currency hedged", "已開發市場（除美）匯率避險", "선진국(미국 제외) 환헤지"],
  ["Dev ex-US hedged", "已開發市場（除美）避險", "선진국(미국 제외) 헤지"],
  ["S&P 500 high dividend low vol", "標普500高股息低波動", "S&P 500 고배당 저변동성"],
  ["S&P 500 equal weight", "標普500等權重", "S&P 500 동일가중"],
  ["S&P 500 low cost", "標普500（低成本）", "S&P 500 (저비용)"],
  ["S&P 500 momentum", "標普500動能", "S&P 500 모멘텀"],
  ["S&P 500 quality", "標普500品質", "S&P 500 퀄리티"],
  ["S&P 500 growth", "標普500成長", "S&P 500 성장"],
  ["S&P 500 value", "標普500價值", "S&P 500 가치"],
  ["S&P mid-cap growth", "S&P中型股成長", "S&P 중형주 성장"],
  ["S&P small-cap value", "S&P小型股價值", "S&P 소형주 가치"],
  ["S&P small-cap growth", "S&P小型股成長", "S&P 소형주 성장"],
  ["S&P 400 mid-cap", "S&P 400中型股", "S&P 400 중형주"],
  ["S&P 600 small-cap", "S&P 600小型股", "S&P 600 소형주"],
  ["US small-cap value", "美國小型價值", "미국 소형 가치"],
  ["US core equity", "美國核心股票", "미국 핵심 주식"],
  ["US large-cap multifactor", "美國大型多因子", "미국 대형 멀티팩터"],
  ["US mega-cap growth", "美國超大型成長", "미국 초대형 성장"],
  ["US mega-cap", "美國超大型", "미국 초대형"],
  ["US large-cap core", "美國大型核心", "미국 대형 핵심"],
  ["US large-cap", "美國大型股", "미국 대형주"],
  ["US total market", "全美股市", "미국 전체 시장"],
  ["Total US stock market", "全美股市", "미국 전체 주식"],
  ["Emerging markets", "新興市場", "신흥국"],
  ["Frontier markets", "邊境市場", "프론티어"],
  ["Developed world", "已開發世界", "선진국"],
  ["Dividend growth", "股息成長", "배당 성장"],
  ["Dividend achievers", "股息成就者", "배당 성취"],
  ["High yield muni", "高收益市政債", "하이일드 지방채"],
  ["High yield corporate", "高收益公司債", "하이일드 회사채"],
  ["High yield", "高收益債", "하이일드"],
  ["Fallen angels", "墮落天使債", "폴른 엔젤"],
  ["Intermediate IG corporate", "中期投資級公司債", "중기 투자등급 회사채"],
  ["Long-term IG corporate", "長期投資級公司債", "장기 투자등급 회사채"],
  ["Short-term IG corporate", "短期投資級公司債", "단기 투자등급 회사채"],
  ["Global IG corporate", "全球投資級公司債", "글로벌 투자등급 회사채"],
  ["International Treasury", "國際公債", "국제 국채"],
  ["Short-term intl Treasury", "短期國際公債", "단기 국제 국채"],
  ["Intermediate Treasury", "中期美債", "중기 미국 국채"],
  ["Long-term Treasury", "長期美債", "장기 미국 국채"],
  ["Short-term Treasury", "短期美債", "단기 미국 국채"],
  ["Extended duration Treasury", "超長天期美債", "초장기 미국 국채"],
  ["Floating rate Treasury", "浮動利率美債", "변동금리 국채"],
  ["0-3 month T-bills", "0–3月國庫券", "0–3개월 단기국채"],
  ["T-bill", "國庫券", "단기국채"],
  ["EM local currency bonds", "新興市場當地貨幣債", "신흥국 현지통화 채권"],
  ["EM local currency", "新興市場當地貨幣", "신흥국 현지통화"],
  ["EM USD HY", "新興市場美元高收益債", "신흥국 달러 하이일드"],
  ["EM sovereign debt", "新興市場主權債", "신흥국 국채"],
  ["EM corporate", "新興市場公司債", "신흥국 회사채"],
  ["EM internet", "新興市場網路", "신흥국 인터넷"],
  ["EM ex-China", "新興市場（除中）", "신흥국(중국 제외)"],
  ["EM small-cap", "新興市場小型股", "신흥국 소형주"],
  ["Active EM multifactor", "新興市場主動多因子", "신흥국 액티브 멀티팩터"],
  ["China A-shares", "中國A股", "중국 A주"],
  ["China tech", "中國科技", "중국 기술"],
  ["China large-cap", "中國大型股", "중국 대형주"],
  ["China internet", "中國網路", "중국 인터넷"],
  ["Genomic revolution", "基因革命", "유전체 혁명"],
  ["Next-gen internet", "次世代網路", "차세대 인터넷"],
  ["Cloud computing", "雲端運算", "클라우드"],
  ["Electric vehicles", "電動車", "전기차"],
  ["Clean energy", "潔淨能源", "클린에너지"],
  ["Managed futures", "管理期貨", "관리 선물"],
  ["Merger arbitrage", "合併套利", "합병 차익거래"],
  ["Multi-strategy alt", "多策略另類", "멀티전략 대체"],
  ["Real assets", "實質資產", "실물자산"],
  ["Senior loans", "優先貸款", "선순위 대출"],
  ["Bank loans", "銀行貸款", "은행대출"],
  ["Preferred securities", "優先證券", "우선주"],
  ["Preferred & income", "優先股與收益", "우선주·인컴"],
  ["Preferred stock", "優先股", "우선주"],
  ["Mortgage REIT", "抵押型 REIT", "모기지 리츠"],
  ["Industrial REIT", "工業 REIT", "산업 리츠"],
  ["International residential", "國際住宅", "국제 주거"],
  ["Global REIT", "全球 REIT", "글로벌 리츠"],
  ["Broad commodities", "廣泛商品", "광범위 원자재"],
  ["Commodity broad", "廣泛商品", "광범위 원자재"],
  ["Natural gas", "天然氣", "천연가스"],
  ["Junior gold miners", "小型金礦股", "중소형 금광"],
  ["Gold miners", "金礦股", "금광 주식"],
  ["Gold mini", "迷你黃金", "미니 금"],
  ["Aerospace & defense", "航太與國防", "항공·방산"],
  ["Oil & gas equipment", "油氣設備", "석유·가스 장비"],
  ["Oil & gas exploration", "油氣探勘", "석유·가스 탐사"],
  ["Health care providers", "醫療服務提供者", "헬스케어 제공자"],
  ["Health care services", "醫療服務", "헬스케어 서비스"],
  ["Healthcare equipment", "醫療設備", "의료기기"],
  ["Medical devices", "醫療器材", "의료기기"],
  ["Consumer disc", "非必需消費", "경기소비재"],
  ["Consumer staples", "必需消費", "필수소비재"],
  ["Home construction", "住宅建設", "주택 건설"],
  ["Regional banks", "區域銀行", "지방은행"],
  ["Value line dividend", "價值線股息", "밸류라인 배당"],
  ["Russell 1000 style neutral", "羅素1000風格中性", "러셀 1000 스타일 중립"],
  ["Russell 2000 style neutral", "羅素2000風格中性", "러셀 2000 스타일 중립"],
  ["Russell 2000 value", "羅素2000價值", "러셀 2000 가치"],
  ["Russell 2000 growth", "羅素2000成長", "러셀 2000 성장"],
  ["EAFE min vol", "EAFE最小波動", "EAFE 최소변동성"],
  ["EAFE value", "EAFE價值", "EAFE 가치"],
  ["UK small-cap", "英國小型股", "영국 소형주"],
  ["Japan currency hedged", "日本匯率避險", "일본 환헤지"],
  ["Japan hedged", "日本避險", "일본 헤지"],
  ["Small-cap growth", "小型成長", "소형 성장"],
  ["Small-cap value", "小型價值", "소형 가치"],
  ["Large-cap growth", "大型成長", "대형 성장"],
  ["Covered put write", "備兌賣權", "커버드 풋"],
  ["Anti-beta", "反 Beta", "안티 베타"],
  ["Short vol", "做空波動", "숏 변동성"],
  ["Energy infrastructure", "能源基礎建設", "에너지 인프라"],
  ["Infrastructure income", "基礎建設收益", "인프라 인컴"],
  ["Ultra-short bond", "超短期債券", "초단기 채권"],
  ["Intermediate bond", "中期債券", "중기 채권"],
  ["Long-term bond", "長期債券", "장기 채권"],
  ["Short-term bond", "短期債券", "단기 채권"],
  ["Short-term HY", "短期高收益債", "단기 하이일드"],
  ["Short-term muni", "短期市政債", "단기 지방채"],
  ["Short-term TIPS", "短期 TIPS", "단기 TIPS"],
  ["Long-term TIPS", "長期 TIPS", "장기 TIPS"],
  ["TIPS broad", "廣泛 TIPS", "광범위 TIPS"],
  ["National muni", "全國市政債", "전국 지방채"],
  ["Mortgage-backed securities", "抵押擔保證券", "MBS"],
  ["US aggregate bond", "美國綜合債券", "미국 종합채권"],
  ["US aggregate", "美國綜合債券", "미국 종합채권"],
  ["Global 100", "全球100", "글로벌 100"],
  ["MSCI USA ESG", "MSCI美國 ESG", "MSCI 미국 ESG"],
  ["ESG US", "美國 ESG", "미국 ESG"],
  ["Semiconductors", "半導體", "반도체"],
  ["Semiconductor", "半導體", "반도체"],
  ["Cybersecurity", "網路安全", "사이버보안"],
  ["Biotech", "生技", "바이오"],
  ["Fintech", "金融科技", "핀테크"],
  ["Internet", "網路", "인터넷"],
  ["Software", "軟體", "소프트웨어"],
  ["Technology", "科技", "기술"],
  ["Financials", "金融", "금융"],
  ["Utilities", "公用事業", "유틸리티"],
  ["Materials", "原物料", "소재"],
  ["Transportation", "運輸", "운송"],
  ["Airlines", "航空", "항공"],
  ["Insurance", "保險", "보험"],
  ["Banks", "銀行", "은행"],
  ["Retail", "零售", "리테일"],
  ["Pharma", "製藥", "제약"],
  ["Solar", "太陽能", "태양광"],
  ["Nuclear", "核能", "원자력"],
  ["Uranium", "鈾", "우라늄"],
  ["Lithium & battery", "鋰與電池", "리튬·배터리"],
  ["Infrastructure", "基礎建設", "인프라"],
  ["Wind", "風力", "풍력"],
  ["Robotics", "機器人", "로봇"],
  ["Homebuilders", "住宅建商", "주택건설"],
  ["Metals & mining", "金屬與採礦", "금속·광업"],
  ["Telecom", "電信", "통신"],
  ["Agriculture broad", "廣泛農產品", "광범위 농산물"],
  ["Agriculture", "農產品", "농산물"],
  ["Soybeans", "大豆", "대두"],
  ["Wheat", "小麥", "밀"],
  ["Corn", "玉米", "옥수수"],
  ["Palladium", "鈀金", "팔라듐"],
  ["Platinum", "鉑金", "플래티넘"],
  ["Brent crude", "布倫特原油", "브렌트유"],
  ["Crude oil", "原油", "원유"],
  ["Oil", "石油", "석유"],
  ["Copper", "銅", "구리"],
  ["Gold", "黃金", "금"],
  ["Silver", "白銀", "은"],
  ["REIT", "REIT", "리츠"],
  ["MLP", "MLP", "MLP"],
];

function translateEnLabel(en) {
  let rest = en;
  let zh = en;
  let ko = en;
  const used = [];
  for (const [phrase, z, k] of EN_PHRASES) {
    if (rest.toLowerCase().includes(phrase.toLowerCase())) {
      const re = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      rest = rest.replace(re, "").replace(/\s+/g, " ").trim();
      zh = zh.replace(re, z);
      ko = ko.replace(re, k);
      used.push(phrase);
    }
  }
  // Clean leftover issuer tags in parentheses for zh/ko readability
  return { en, zh: zh.trim(), ko: ko.trim(), translated: used.length > 0 };
}

function ensureEtfSuffix(name, lang) {
  const n = name.trim();
  if (!n) return n;
  if (lang === "en") {
    if (/\bETF\b/i.test(n) || /\bFund\b/i.test(n) || /\bTrust\b/i.test(n) || /\bShares\b/i.test(n))
      return n;
    return `${n} ETF`;
  }
  if (/ETF$/i.test(n) || /基金$/.test(n)) return n;
  return `${n} ETF`;
}

function buildEntry(ticker, universeName) {
  if (CURATED[ticker]) return { ...CURATED[ticker] };

  const raw = (universeName || "").trim() || ticker;

  if (CJK.test(raw)) {
    const mapped = ZH_TO_EN_KO[raw];
    if (mapped) {
      return {
        en: ensureEtfSuffix(mapped[0], "en"),
        zh: ensureEtfSuffix(raw, "zh"),
        ko: ensureEtfSuffix(mapped[1], "ko"),
      };
    }
    // Unknown CJK: keep as zh, use ticker-friendly English/Korean fallbacks
    return {
      en: ticker,
      zh: ensureEtfSuffix(raw, "zh"),
      ko: ticker,
    };
  }

  const { en, zh, ko, translated } = translateEnLabel(raw);
  return {
    en: ensureEtfSuffix(en, "en"),
    zh: translated ? ensureEtfSuffix(zh, "zh") : ensureEtfSuffix(en, "zh"),
    ko: translated ? ensureEtfSuffix(ko, "ko") : ensureEtfSuffix(en, "ko"),
  };
}

function main() {
  const universe = loadJson(path.join(root, "shared", "etf-universe.json"));
  const demo = loadJson(path.join(root, "shared", "demo-tickers.json"));
  const models = loadJson(
    path.join(root, "shared", "model-portfolios", "model-portfolios.json"),
  );
  const clients = loadJson(path.join(root, "shared", "clients", "demo-clients.json"));

  const names = {};
  for (const item of universe.universe) {
    names[item.ticker] = buildEntry(item.ticker, item.name);
  }

  // Ensure demo / model / client tickers exist even if missing from universe
  const extra = new Set(demo.tickers);
  for (const p of models.portfolios || []) {
    for (const h of p.holdings || []) extra.add(h.ticker);
  }
  for (const c of clients.clients || []) {
    for (const h of c.holdings || []) {
      if (h.ticker && h.ticker.toUpperCase() !== "CASH") extra.add(h.ticker);
    }
  }
  for (const t of extra) {
    if (!names[t]) names[t] = buildEntry(t, "");
  }

  // Stable key order
  const sorted = {};
  for (const t of Object.keys(names).sort()) sorted[t] = names[t];

  const out = {
    version: "1.0",
    updated: new Date().toISOString().slice(0, 10),
    description:
      "Localized ETF display names (en / zh-TW / ko) keyed by ticker for JASPER UI.",
    names: sorted,
  };

  const sharedPath = path.join(root, "shared", "etf-names.json");
  const webPath = path.join(root, "apps", "web", "src", "data", "etf-names.json");
  const text = `${JSON.stringify(out, null, 2)}\n`;
  fs.writeFileSync(sharedPath, text, "utf8");
  fs.writeFileSync(webPath, text, "utf8");

  console.log(`Wrote ${Object.keys(sorted).length} tickers →`);
  console.log(`  ${sharedPath}`);
  console.log(`  ${webPath}`);
  for (const t of ["SPY", "QQQ", "AGG"]) {
    console.log(t, JSON.stringify(sorted[t]));
  }
}

main();
