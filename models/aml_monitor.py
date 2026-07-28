"""
models/aml_monitor.py

Anti-Money Laundering monitor for Nepal bank branches.
Detects structuring, round-amount patterns, and behavioral anomalies.
NRB reporting threshold: NPR 10,00,000 (10 lakh).
"""

from __future__ import annotations
import numpy as np
import pandas as pd
from datetime import datetime

try:
    from sklearn.ensemble import IsolationForest
    from sklearn.preprocessing import StandardScaler
    _SKL_AVAILABLE = True
except ImportError:
    _SKL_AVAILABLE = False

NRB_REPORTING_THRESHOLD = 1_000_000   # NPR 10 lakh — triggers mandatory report
STRUCTURING_LOWER       = 800_000     # suspicious range: 8–9.9 lakh
STRUCTURING_UPPER       = 990_000
STRUCTURING_MIN_HITS    = 2           # flag if >= 2 transactions in range

AML_FEATURES = [
    "dw_merchant_diversity",
    "dw_unique_merchants",
    "dw_transaction_count",
    "dw_fee_burden",
    "dw_cashback_ratio",
    "dw_total_spent_norm",
    "digital_engagement_norm",
]


class AMLMonitor:
    """
    Three-stage AML scanner:
      1. Structuring detection — transactions just below NRB threshold
      2. Round-amount detection — suspiciously round transaction amounts
      3. Behavioral anomaly detection — IsolationForest on merchant/volume patterns
    """

    def __init__(self, contamination: float = 0.03):
        self.contamination = contamination
        self._if_model = None
        self._scaler = StandardScaler() if _SKL_AVAILABLE else None
        self._trained = False

    # ──────────────────────────────────────────────────────────
    # Detector 1: Structuring
    # ──────────────────────────────────────────────────────────

    def detect_structuring(self, ucp: pd.DataFrame) -> list[dict]:
        """
        Flag customers whose average transaction amount falls in the
        800K–990K NPR range (structuring pattern below NRB threshold).
        Uses avg_transaction and total_spent as proxies.
        """
        alerts = []
        avg_txn = ucp.get("dw_avg_transaction", pd.Series(np.zeros(len(ucp)), index=ucp.index)).fillna(0)
        total   = ucp.get("dw_total_spent", pd.Series(np.zeros(len(ucp)), index=ucp.index)).fillna(0)
        tx_cnt  = ucp.get("dw_transaction_count", pd.Series(np.zeros(len(ucp)), index=ucp.index)).fillna(0)
        cust_ids = ucp.get("customer_id", pd.Series([f"C{i}" for i in range(len(ucp))], index=ucp.index))

        for i in range(len(ucp)):
            avg = float(avg_txn.iloc[i])
            tot = float(total.iloc[i])
            cnt = float(tx_cnt.iloc[i])

            # Estimate number of near-threshold transactions
            if avg > 0:
                estimated_near_threshold = max(0, int(cnt * (
                    1 if STRUCTURING_LOWER <= avg <= STRUCTURING_UPPER else 0
                )))
                # Also check if total / count falls in range
                per_txn = tot / cnt if cnt > 0 else 0
                in_range = STRUCTURING_LOWER <= per_txn <= STRUCTURING_UPPER

                if in_range and cnt >= STRUCTURING_MIN_HITS:
                    aml_score = min(1.0, (cnt / 10.0) * ((per_txn - STRUCTURING_LOWER) / (STRUCTURING_UPPER - STRUCTURING_LOWER + 1)))
                    alerts.append({
                        "customer_id":        str(cust_ids.iloc[i]),
                        "alert_type":         "structuring",
                        "avg_transaction_npr": round(per_txn, 0),
                        "estimated_flagged_txns": int(cnt),
                        "total_volume_npr":   round(tot, 0),
                        "aml_score":          round(min(aml_score + 0.5, 1.0), 3),
                        "severity":           "high" if cnt >= 5 else "medium",
                        "nrb_threshold_npr":  NRB_REPORTING_THRESHOLD,
                        "note": "Possible structuring: repeated near-threshold amounts",
                    })

        return sorted(alerts, key=lambda x: x["aml_score"], reverse=True)

    # ──────────────────────────────────────────────────────────
    # Detector 2: Round amounts
    # ──────────────────────────────────────────────────────────

    def detect_round_amounts(self, ucp: pd.DataFrame) -> list[dict]:
        """
        Flag customers where transaction amounts are suspiciously round
        (divisible by large amounts — proxy: low cashback + high average).
        """
        alerts = []
        cashback_ratio = ucp.get("dw_cashback_ratio", pd.Series(np.zeros(len(ucp)), index=ucp.index)).fillna(0)
        avg_txn = ucp.get("dw_avg_transaction", pd.Series(np.zeros(len(ucp)), index=ucp.index)).fillna(0)
        tx_cnt  = ucp.get("dw_transaction_count", pd.Series(np.zeros(len(ucp)), index=ucp.index)).fillna(0)
        cust_ids = ucp.get("customer_id", pd.Series([f"C{i}" for i in range(len(ucp))], index=ucp.index))

        for i in range(len(ucp)):
            cb   = float(cashback_ratio.iloc[i])
            avg  = float(avg_txn.iloc[i])
            cnt  = float(tx_cnt.iloc[i])

            # Proxy: very low cashback ratio on high-value transactions → likely round amounts
            round_ratio = max(0.0, 1.0 - cb / max(0.02, cb)) if cb < 0.005 and avg > 50_000 else 0.0

            if round_ratio > 0.6 and cnt >= 3:
                severity = "high" if avg > 500_000 else "medium"
                aml_score = round(0.4 + round_ratio * 0.4, 3)
                alerts.append({
                    "customer_id":        str(cust_ids.iloc[i]),
                    "alert_type":         "round_amounts",
                    "estimated_round_ratio": round(round_ratio, 3),
                    "avg_transaction_npr":   round(avg, 0),
                    "tx_count":           int(cnt),
                    "aml_score":          aml_score,
                    "severity":           severity,
                    "note": "High proportion of round-figure transactions",
                })

        return sorted(alerts, key=lambda x: x["aml_score"], reverse=True)

    # ──────────────────────────────────────────────────────────
    # Detector 3: Behavioral anomaly (IsolationForest)
    # ──────────────────────────────────────────────────────────

    def detect_anomalies(self, ucp: pd.DataFrame) -> list[dict]:
        """
        IsolationForest on merchant/volume behavioral features.
        """
        if not _SKL_AVAILABLE:
            return []

        n = len(ucp)
        total_spent = ucp.get("dw_total_spent", pd.Series(np.zeros(n), index=ucp.index)).fillna(0)
        max_spent = max(float(total_spent.max()), 1.0)

        features = pd.DataFrame({
            "dw_merchant_diversity":  ucp.get("dw_merchant_diversity", pd.Series(np.zeros(n), index=ucp.index)).fillna(0),
            "dw_unique_merchants":    ucp.get("dw_unique_merchants", pd.Series(np.zeros(n), index=ucp.index)).fillna(0),
            "dw_transaction_count":   ucp.get("dw_transaction_count", pd.Series(np.zeros(n), index=ucp.index)).fillna(0),
            "dw_fee_burden":          ucp.get("dw_fee_burden", pd.Series(np.zeros(n), index=ucp.index)).fillna(0),
            "dw_cashback_ratio":      ucp.get("dw_cashback_ratio", pd.Series(np.zeros(n), index=ucp.index)).fillna(0),
            "dw_total_spent_norm":    total_spent / max_spent,
            "digital_engagement_norm": ucp.get("digital_engagement_score", pd.Series([50.0]*n, index=ucp.index)).fillna(50) / 100.0,
        })

        X = features.values.astype(np.float32)
        X_sc = self._scaler.fit_transform(X)

        if_model = IsolationForest(
            n_estimators=200,
            contamination=self.contamination,
            random_state=42,
            n_jobs=-1,
        )
        if_model.fit(X_sc)
        scores = if_model.decision_function(X_sc)
        labels = if_model.predict(X_sc)  # -1 = anomaly

        score_norm = 1 - (scores - scores.min()) / (np.ptp(scores) + 1e-9)
        cust_ids = ucp.get("customer_id", pd.Series([f"C{i}" for i in range(n)], index=ucp.index))

        alerts = []
        for i in range(n):
            if labels[i] == -1:
                feat_row = features.iloc[i].to_dict()
                top_feat = sorted(feat_row.items(), key=lambda x: abs(x[1]), reverse=True)[0]
                alerts.append({
                    "customer_id":      str(cust_ids.iloc[i]),
                    "alert_type":       "behavioral_anomaly",
                    "anomaly_score":    round(float(score_norm[i]), 4),
                    "aml_score":        round(float(score_norm[i]) * 0.8, 4),
                    "severity":         "high" if score_norm[i] > 0.8 else "medium",
                    "top_anomaly_feature": top_feat[0].replace("_", " ").title(),
                    "note": "Unusual behavioral pattern detected by IsolationForest",
                })

        return sorted(alerts, key=lambda x: x["aml_score"], reverse=True)

    # ──────────────────────────────────────────────────────────
    # Full scan
    # ──────────────────────────────────────────────────────────

    def full_aml_scan(self, ucp: pd.DataFrame) -> dict:
        """
        Run all three detectors and merge into combined alerts.
        """
        structuring = self.detect_structuring(ucp)
        round_amts  = self.detect_round_amounts(ucp)
        anomalies   = self.detect_anomalies(ucp)

        # Merge alerts per customer
        all_alerts: dict[str, dict] = {}

        for alert in structuring + round_amts + anomalies:
            cid = alert["customer_id"]
            if cid not in all_alerts:
                all_alerts[cid] = {
                    "customer_id": cid,
                    "aml_score":   0.0,
                    "alert_types": [],
                    "severity":    "low",
                    "details":     [],
                }
            all_alerts[cid]["aml_score"] = max(all_alerts[cid]["aml_score"], alert["aml_score"])
            all_alerts[cid]["alert_types"].append(alert["alert_type"])
            all_alerts[cid]["details"].append(alert)
            if alert["severity"] == "high":
                all_alerts[cid]["severity"] = "high"
            elif alert["severity"] == "medium" and all_alerts[cid]["severity"] == "low":
                all_alerts[cid]["severity"] = "medium"

        combined = sorted(all_alerts.values(), key=lambda x: x["aml_score"], reverse=True)
        high_count   = sum(1 for a in combined if a["severity"] == "high")
        medium_count = sum(1 for a in combined if a["severity"] == "medium")

        return {
            "scan_timestamp":          datetime.utcnow().isoformat() + "Z",
            "total_customers_scanned": len(ucp),
            "total_flagged":           len(combined),
            "high_severity_count":     high_count,
            "medium_severity_count":   medium_count,
            "nrb_threshold_npr":       NRB_REPORTING_THRESHOLD,
            "structuring_flags":       structuring[:20],
            "round_amount_flags":      round_amts[:20],
            "anomaly_flags":           anomalies[:20],
            "combined_alerts":         combined[:50],
        }

    def generate_sar_summary(self, customer_id: str, ucp: pd.DataFrame) -> dict:
        """
        Generate a Suspicious Activity Report (SAR) summary for NRB compliance.
        """
        cust_row = ucp[ucp["customer_id"] == customer_id] if "customer_id" in ucp.columns else pd.DataFrame()
        if cust_row.empty:
            return {"error": f"Customer {customer_id} not found"}

        row = cust_row.iloc[0].to_dict()
        scan = self.full_aml_scan(cust_row)

        alert_types = []
        for alert_list in [scan["structuring_flags"], scan["round_amount_flags"], scan["anomaly_flags"]]:
            for a in alert_list:
                if a["customer_id"] == customer_id:
                    alert_types.append(a["alert_type"])

        return {
            "sar_reference":      f"SAR-{customer_id}-{datetime.utcnow().strftime('%Y%m%d')}",
            "customer_id":        customer_id,
            "report_date":        datetime.utcnow().strftime("%Y-%m-%d"),
            "reporting_entity":   "SecureScore Bank Suite — Branch AML Unit",
            "nrb_threshold_npr":  NRB_REPORTING_THRESHOLD,
            "alert_types":        alert_types,
            "total_volume_npr":   round(float(row.get("dw_total_spent", 0)), 0),
            "avg_transaction_npr": round(float(row.get("dw_avg_transaction", 0)), 0),
            "transaction_count":  int(row.get("dw_transaction_count", 0)),
            "merchant_diversity": round(float(row.get("dw_merchant_diversity", 0)), 4),
            "digital_engagement": round(float(row.get("digital_engagement_score", 0)), 1),
            "requires_nrb_report": len(alert_types) > 0 and scan["combined_alerts"][0]["severity"] == "high" if scan["combined_alerts"] else False,
            "status":             "pending_review",
        }
