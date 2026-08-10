import type { ScenarioAnalyzeOutput } from "./scenario-schema";

export function analyzeScenarioFallback(text: string): ScenarioAnalyzeOutput {
  const t = text.toLowerCase();

  if (
    /recession|slowdown|bear|defensive|risk.?off|downturn/.test(t) ||
    /衰退|蕭條|熊市|風險趨避|防禦/.test(text)
  ) {
    return {
      title: "Custom: slowdown / defensive",
      subtitle: text.slice(0, 60),
      narrative_points: [
        "Tilt bonds and low-volatility sleeves",
        "Reduce high-beta growth exposure",
        "Prioritize drawdown control",
      ],
      defaults: {
        max_weight: 0.18,
        objective: "min_max_drawdown",
        backtest_mode: "static",
        start_date: "2018-01-01",
        end_date: "2024-12-31",
      },
      suggested_asset_classes: ["equity", "bond", "real_estate", "commodity"],
    };
  }

  if (
    /inflation|rate.?hike|higher.?for.?longer|sticky.?prices/.test(t) ||
    /通膨|升息|利率|高通膨/.test(text)
  ) {
    return {
      title: "Custom: inflation & rates",
      subtitle: text.slice(0, 60),
      narrative_points: [
        "Favor TIPS and short-duration bonds",
        "Trim long-duration risk",
        "Bias value and cash-flow factors",
      ],
      defaults: {
        max_weight: 0.2,
        objective: "max_sharpe",
        backtest_mode: "static",
        start_date: "2018-01-01",
        end_date: "2024-12-31",
      },
      suggested_asset_classes: ["bond", "commodity", "equity"],
    };
  }

  if (
    /bull|risk.?on|recovery|growth.?rally/.test(t) ||
    /牛市|復甦|做多|成長/.test(text)
  ) {
    return {
      title: "Custom: risk-on recovery",
      subtitle: text.slice(0, 60),
      narrative_points: [
        "Modest equity and growth tilt",
        "Keep diversification and name caps",
        "Target risk-adjusted return",
      ],
      defaults: {
        max_weight: 0.2,
        objective: "max_sharpe",
        backtest_mode: "static",
        start_date: "2018-01-01",
        end_date: "2024-12-31",
      },
      suggested_asset_classes: ["equity", "bond"],
    };
  }

  return {
    title: "Custom: balanced",
    subtitle: text.slice(0, 60),
    narrative_points: [
      "Multi-asset diversification",
      "Tune sleeves to user narrative",
      "Avoid single-name concentration",
    ],
    defaults: {
      max_weight: 0.2,
      objective: "max_sharpe",
      backtest_mode: "static",
      start_date: "2018-01-01",
      end_date: "2024-12-31",
    },
    suggested_asset_classes: [
      "equity",
      "bond",
      "commodity",
      "real_estate",
      "alternative",
    ],
  };
}
