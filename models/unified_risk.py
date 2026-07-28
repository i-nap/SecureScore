"""
models/unified_risk.py

Unified multi-dimensional risk aggregator.
Combines credit, fraud, AML, churn, and cash-flow signals into
a single composite risk score with radar-chart data for the dashboard.
"""

from __future__ import annotations
import numpy as np
import pandas as pd

DIMENSION_WEIGHTS = {
    "credit_risk":   0.35,
    "fraud_risk":    0.25,
    "aml_risk":      0.20,
    "churn_risk":    0.15,
    "cashflow_risk": 0.05,
}

GRADE_THRESHOLDS = [
    ("A", 0.00, 0.20),
    ("B", 0.20, 0.35),
    ("C", 0.35, 0.50),
    ("D", 0.50, 0.65),
    ("F", 0.65, 1.00),
]

RECOMMENDATIONS = {
    "credit_risk": {
        "high":   "Review credit limit; consider collateral requirements for new loans",
        "medium": "Monitor repayment behaviour; limit exposure to unsecured credit",
        "low":    "Eligible for premium credit products; consider limit increase",
    },
    "fraud_risk": {
        "high":   "Flag account for manual review; temporarily restrict high-value transfers",
        "medium": "Enable step-up authentication for transactions > NPR 50,000",
        "low":    "No fraud action required",
    },
    "aml_risk": {
        "high":   "File Suspicious Activity Report (SAR) with NRB; freeze pending review",
        "medium": "Enhanced Due Diligence (EDD) required; request source-of-funds documentation",
        "low":    "Standard Customer Due Diligence (CDD) sufficient",
    },
    "churn_risk": {
        "high":   "Immediate retention call; offer loyalty upgrade and cashback incentive",
        "medium": "Send personalised engagement offer; highlight unused features",
        "low":    "Customer is engaged; no retention action needed",
    },
    "cashflow_risk": {
        "high":   "Customer may face liquidity stress; consider EMI restructuring",
        "medium": "Monitor spending trends; proactively offer budget advisory",
        "low":    "Cash flow stable; eligible for premium savings products",
    },
}


class UnifiedRiskEngine:
    """
    Deterministic aggregator — no model training required.
    Collects scores from all five sub-models and produces:
      - composite_risk_score  (0–1, higher = riskier)
      - composite_risk_grade  (A–F)
      - risk_dimensions       (dict, for radar chart)
      - primary_concern       (which dimension is most alarming)
      - action_required       (bool)
      - recommendations       (list of strings)
    """

    def compute_composite_score(
        self,
        credit_prob:     float = 0.5,   # from XGBoost: P(creditworthy) → invert for risk
        fraud_score:     float = 0.0,   # from FraudDetector: ensemble_score (high = risky)
        churn_prob:      float = 0.0,   # from ChurnPredictor: 30-day churn probability
        aml_score:       float = 0.0,   # from AMLMonitor: max combined alert score
        cashflow_trend:  float = 0.0,   # from CashFlowForecaster: 0=stable, 1=declining
    ) -> dict:
        """
        Compute composite risk score from five dimensions.
        credit_prob is P(creditworthy) from XGBoost — inverted to get credit_risk.
        """
        credit_risk   = float(1.0 - np.clip(credit_prob, 0, 1))
        fraud_risk    = float(np.clip(fraud_score, 0, 1))
        aml_risk      = float(np.clip(aml_score, 0, 1))
        churn_risk    = float(np.clip(churn_prob, 0, 1))
        cashflow_risk = float(np.clip(cashflow_trend, 0, 1))

        dimensions = {
            "credit_risk":   round(credit_risk, 4),
            "fraud_risk":    round(fraud_risk, 4),
            "aml_risk":      round(aml_risk, 4),
            "churn_risk":    round(churn_risk, 4),
            "cashflow_risk": round(cashflow_risk, 4),
        }

        composite = sum(
            dimensions[dim] * DIMENSION_WEIGHTS[dim]
            for dim in DIMENSION_WEIGHTS
        )
        composite = float(np.clip(composite, 0, 1))

        grade = "A"
        for g, lo, hi in GRADE_THRESHOLDS:
            if lo <= composite < hi:
                grade = g
                break

        # Primary concern: highest weighted contribution
        contributions = {
            dim: dimensions[dim] * DIMENSION_WEIGHTS[dim]
            for dim in DIMENSION_WEIGHTS
        }
        primary_dim = max(contributions, key=contributions.get)

        # Severity labels per dimension
        def _severity(val: float) -> str:
            return "high" if val >= 0.6 else ("medium" if val >= 0.3 else "low")

        recs = []
        for dim, val in dimensions.items():
            sev = _severity(val)
            if sev in ("high", "medium"):
                rec_text = RECOMMENDATIONS.get(dim, {}).get(sev, "")
                if rec_text:
                    recs.append(f"[{dim.replace('_', ' ').title()}] {rec_text}")

        # Radar chart data
        radar_data = [
            {"axis": dim.replace("_", " ").title(), "value": round(val * 100, 1)}
            for dim, val in dimensions.items()
        ]

        return {
            "composite_risk_score": round(composite, 4),
            "composite_risk_grade": grade,
            "risk_dimensions":      dimensions,
            "radar_data":           radar_data,
            "primary_concern":      primary_dim.replace("_", " ").title(),
            "primary_concern_severity": _severity(dimensions[primary_dim]),
            "action_required":      composite >= 0.50 or aml_risk >= 0.6,
            "recommendations":      recs[:4],
            "dimension_weights":    DIMENSION_WEIGHTS,
        }

    def score_customer(
        self,
        customer_id: str,
        ucp: pd.DataFrame,
        fraud_detector=None,
        churn_predictor=None,
        aml_monitor=None,
        cashflow_forecaster=None,
        credit_prob: float | None = None,
        branch: str = "Kathmandu",
    ) -> dict:
        """
        Run all available sub-models on a single customer and aggregate.
        Sub-models can be None (score defaults to 0.0 for that dimension).
        """
        cust_row = ucp[ucp["customer_id"] == customer_id] if "customer_id" in ucp.columns else ucp.iloc[:1]
        if cust_row.empty:
            return {"error": f"Customer {customer_id} not found"}

        # Credit risk: use provided prob or read alt_credit_score proxy
        if credit_prob is None:
            alt_score = float(cust_row["alternative_credit_score"].values[0]) if "alternative_credit_score" in cust_row.columns else 600
            credit_prob = np.clip((alt_score - 300) / 600, 0, 1)

        # Fraud risk
        fraud_score = 0.0
        if fraud_detector is not None:
            try:
                fraud_df = fraud_detector.predict(cust_row)
                if not fraud_df.empty:
                    fraud_score = float(fraud_df.iloc[0]["ensemble_score"])
            except Exception:
                pass

        # AML risk
        aml_score = 0.0
        if aml_monitor is not None:
            try:
                scan = aml_monitor.full_aml_scan(cust_row)
                if scan["combined_alerts"]:
                    aml_score = float(scan["combined_alerts"][0]["aml_score"])
            except Exception:
                pass

        # Churn risk
        churn_prob = 0.0
        if churn_predictor is not None:
            try:
                churn_result = churn_predictor.predict_churn_probability(customer_id, ucp)
                churn_prob = float(churn_result.get("churn_probability_30d", 0.0))
            except Exception:
                pass

        # Cash flow risk (declining trend = risk)
        cashflow_risk = 0.0
        if cashflow_forecaster is not None:
            try:
                cf = cashflow_forecaster.forecast_customer(customer_id, ucp, branch)
                if cf.get("trend") == "decreasing":
                    cashflow_risk = 0.6
                elif cf.get("trend") == "stable":
                    cashflow_risk = 0.2
            except Exception:
                pass

        result = self.compute_composite_score(
            credit_prob=credit_prob,
            fraud_score=fraud_score,
            churn_prob=churn_prob,
            aml_score=aml_score,
            cashflow_trend=cashflow_risk,
        )
        result["customer_id"] = customer_id
        result["sub_model_scores"] = {
            "credit_prob":    round(float(credit_prob), 4),
            "fraud_score":    round(fraud_score, 4),
            "aml_score":      round(aml_score, 4),
            "churn_prob":     round(churn_prob, 4),
            "cashflow_trend": round(cashflow_risk, 4),
        }
        return result

    def branch_risk_distribution(
        self,
        ucp: pd.DataFrame,
        fraud_detector=None,
        churn_predictor=None,
        aml_monitor=None,
    ) -> dict:
        """
        Compute composite risk scores for all branch customers and return histogram.
        Uses fast batch approach — no per-customer iteration.
        """
        n = len(ucp)
        customer_ids = ucp["customer_id"].values if "customer_id" in ucp.columns else [f"C{i}" for i in range(n)]

        # Credit risk
        alt_scores = ucp.get("alternative_credit_score", pd.Series([600.0]*n)).fillna(600).values
        credit_probs = np.clip((alt_scores - 300) / 600, 0, 1)
        credit_risks = 1.0 - credit_probs

        # Fraud risk (batch)
        fraud_scores = np.zeros(n)
        if fraud_detector is not None:
            try:
                fraud_df = fraud_detector.predict(ucp)
                if "customer_id" in fraud_df.columns and "customer_id" in ucp.columns:
                    id_to_score = dict(zip(fraud_df["customer_id"], fraud_df["ensemble_score"]))
                    fraud_scores = np.array([float(id_to_score.get(str(cid), 0.0)) for cid in customer_ids])
                else:
                    fraud_scores = fraud_df["ensemble_score"].values[:n] if len(fraud_df) >= n else fraud_scores
            except Exception:
                pass

        # Churn risk (batch)
        churn_scores = np.zeros(n)
        if churn_predictor is not None:
            try:
                features = churn_predictor.compute_rfm_features(ucp)
                X = churn_predictor._scaler.transform(features.values.astype(np.float32))
                churn_scores = churn_predictor._model.predict_proba(X)[:, 1]
            except Exception:
                pass

        composite = (
            credit_risks  * DIMENSION_WEIGHTS["credit_risk"] +
            fraud_scores  * DIMENSION_WEIGHTS["fraud_risk"] +
            churn_scores  * DIMENSION_WEIGHTS["churn_risk"]
        )
        composite = np.clip(composite, 0, 1)

        grades = []
        for c in composite:
            for g, lo, hi in GRADE_THRESHOLDS:
                if lo <= c < hi:
                    grades.append(g)
                    break

        from collections import Counter
        grade_counts = Counter(grades)

        top_risk = sorted(
            [{"customer_id": str(cid), "composite_risk_score": round(float(c), 4)}
             for cid, c in zip(customer_ids, composite)],
            key=lambda x: x["composite_risk_score"], reverse=True
        )[:10]

        return {
            "total_customers": n,
            "grade_distribution": {g: grade_counts.get(g, 0) for g in ["A", "B", "C", "D", "F"]},
            "avg_composite_risk": round(float(composite.mean()), 4),
            "high_risk_count":    int((composite >= 0.5).sum()),
            "top_risk_customers": top_risk,
            "histogram_buckets": {
                "0.0-0.2": int(((composite >= 0.0) & (composite < 0.2)).sum()),
                "0.2-0.4": int(((composite >= 0.2) & (composite < 0.4)).sum()),
                "0.4-0.6": int(((composite >= 0.4) & (composite < 0.6)).sum()),
                "0.6-0.8": int(((composite >= 0.6) & (composite < 0.8)).sum()),
                "0.8-1.0": int(((composite >= 0.8) & (composite <= 1.0)).sum()),
            },
        }
