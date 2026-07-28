"""
models/churn_predictor.py

Random Forest-based 30-day customer churn predictor using RFM features.
"""

from __future__ import annotations
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, f1_score, roc_auc_score

RFM_FEATURES = [
    "recency_score",
    "frequency_score",
    "monetary_score",
    "digital_engagement_norm",
    "channel_diversity",
    "avg_monthly_txns",
    "income_rank",
    "merchant_diversity",
    "success_rate",
    "loyalty_engagement",
]

RETENTION_ACTIONS = {
    "recency_score": "Send re-engagement push notification with personalized offer",
    "frequency_score": "Offer transaction cashback bonus for next 5 transactions",
    "monetary_score": "Provide premium credit limit upgrade offer",
    "digital_engagement_norm": "Onboard to mobile banking with digital incentives",
    "channel_diversity": "Introduce to new payment channels (QR, NFC)",
    "avg_monthly_txns": "Reward frequent transactors with loyalty points",
    "income_rank": "Offer wealth management or investment advisory service",
    "merchant_diversity": "Suggest merchant discount partnerships (Daraz, Foodmandu)",
    "success_rate": "Assist with failed transaction resolution",
    "loyalty_engagement": "Enroll in premium loyalty program tier",
}


class ChurnPredictor:
    """
    Predicts 30-day customer churn probability using RFM + digital engagement features.
    Churn label: synthetic (recency proxy > 90 days AND digital_engagement < 30).
    """

    def __init__(self, n_estimators: int = 100, max_depth: int = 6):
        self.n_estimators = n_estimators
        self.max_depth = max_depth
        self._model: RandomForestClassifier | None = None
        self._scaler = StandardScaler()
        self._trained = False
        self.feature_importance_: dict = {}
        self.accuracy_: float = 0.0
        self.f1_: float = 0.0
        self.auc_: float = 0.0

    # ──────────────────────────────────────────────────────────
    # Feature engineering
    # ──────────────────────────────────────────────────────────

    def compute_rfm_features(self, ucp: pd.DataFrame) -> pd.DataFrame:
        """
        Compute RFM + behavioral features for churn modeling.
        Returns DataFrame with RFM_FEATURES columns.
        """
        df = ucp.copy()
        n = len(df)

        tx_count = df.get("dw_transaction_count", pd.Series(np.zeros(n), index=df.index)).fillna(0)
        max_tx = max(float(tx_count.max()), 1.0)

        # Recency: inverse of relative transaction frequency (low tx_count → high recency/likely churned)
        df["recency_score"] = 1 - (tx_count / max_tx).clip(0, 1)

        # Frequency: normalized transaction count
        df["frequency_score"] = (tx_count / max_tx).clip(0, 1)

        # Monetary: normalized total spend
        total_spent = df.get("dw_total_spent", pd.Series(np.zeros(n), index=df.index)).fillna(0)
        max_spent = max(float(total_spent.max()), 1.0)
        df["monetary_score"] = (total_spent / max_spent).clip(0, 1)

        # Digital engagement
        digital = df.get("digital_engagement_score", pd.Series([50.0]*n, index=df.index)).fillna(50)
        df["digital_engagement_norm"] = (digital / 100.0).clip(0, 1)

        # Channel diversity (number of distinct payment methods proxy)
        diversity = df.get("dw_merchant_diversity", pd.Series(np.zeros(n), index=df.index)).fillna(0)
        df["channel_diversity"] = diversity.clip(0, 1)

        # Average monthly transactions
        df["avg_monthly_txns"] = (tx_count / 12.0).clip(0, 20) / 20.0

        # Income rank (relative to population)
        income = df.get("monthly_income", pd.Series([50000.0]*n, index=df.index)).fillna(50000)
        df["income_rank"] = income.rank(pct=True).clip(0, 1)

        # Merchant diversity
        df["merchant_diversity"] = df.get("dw_merchant_diversity", pd.Series(np.zeros(n), index=df.index)).fillna(0).clip(0, 1)

        # Success rate
        df["success_rate"] = df.get("dw_success_rate", pd.Series([0.9]*n, index=df.index)).fillna(0.9).clip(0, 1)

        # Loyalty engagement
        df["loyalty_engagement"] = df.get("dw_loyalty_engagement", pd.Series(np.zeros(n), index=df.index)).fillna(0).clip(0, 1)

        return df[RFM_FEATURES].fillna(0)

    # ──────────────────────────────────────────────────────────
    # Training
    # ──────────────────────────────────────────────────────────

    def train(self, ucp: pd.DataFrame) -> dict:
        """
        Train churn predictor. Returns training metrics.
        """
        features = self.compute_rfm_features(ucp)
        X = features.values.astype(np.float32)

        # Percentile-based churn label: bottom 20% digital engagement OR
        # bottom 20% transaction count → at risk of churning (~35% positive rate)
        digital  = ucp.get("digital_engagement_score", pd.Series([50.0]*len(ucp))).fillna(50)
        tx_count = ucp.get("dw_transaction_count", pd.Series(np.zeros(len(ucp)))).fillna(0)
        churn_label = (
            (digital  <= digital.quantile(0.20)) |
            (tx_count <= tx_count.quantile(0.20))
        ).astype(int).values

        X_sc = self._scaler.fit_transform(X)
        unique, counts = np.unique(churn_label, return_counts=True)
        stratify_param = churn_label if (len(unique) > 1 and counts.min() >= 2) else None
        X_train, X_test, y_train, y_test = train_test_split(
            X_sc, churn_label, test_size=0.2, random_state=42, stratify=stratify_param
        )

        self._model = RandomForestClassifier(
            n_estimators=self.n_estimators,
            max_depth=self.max_depth,
            min_samples_leaf=5,
            random_state=42,
            n_jobs=-1,
        )
        self._model.fit(X_train, y_train)

        y_pred = self._model.predict(X_test)
        y_prob = self._model.predict_proba(X_test)[:, 1]
        self.accuracy_ = float(accuracy_score(y_test, y_pred))
        self.f1_        = float(f1_score(y_test, y_pred, zero_division=0))
        try:
            self.auc_ = float(roc_auc_score(y_test, y_prob))
        except Exception:
            self.auc_ = 0.0

        self.feature_importance_ = dict(zip(RFM_FEATURES, self._model.feature_importances_.tolist()))
        self._trained = True

        churn_rate = float(churn_label.mean())
        return {
            "n_customers": len(ucp),
            "churn_rate":  round(churn_rate, 4),
            "accuracy":    round(self.accuracy_, 4),
            "f1":          round(self.f1_, 4),
            "auc":         round(self.auc_, 4),
            "feature_importance": self.feature_importance_,
        }

    # ──────────────────────────────────────────────────────────
    # Inference
    # ──────────────────────────────────────────────────────────

    def predict_churn_probability(self, customer_id: str, ucp: pd.DataFrame) -> dict:
        """
        Return 30-day churn probability and actionable retention recommendations.
        """
        if not self._trained or self._model is None:
            return {"error": "Model not trained"}

        cust_row = ucp[ucp["customer_id"] == customer_id] if "customer_id" in ucp.columns else ucp.iloc[:1]
        if cust_row.empty:
            return {"error": f"Customer {customer_id} not found"}

        features = self.compute_rfm_features(cust_row)
        X = self._scaler.transform(features.values.astype(np.float32))
        prob = float(self._model.predict_proba(X)[0][1])

        risk = "high" if prob >= 0.6 else ("medium" if prob >= 0.3 else "low")

        # Top churn drivers from feature importance * feature value
        feat_vals = features.iloc[0].to_dict()
        importance = self.feature_importance_
        driver_scores = {f: abs(feat_vals.get(f, 0) * importance.get(f, 0)) for f in RFM_FEATURES}
        top_drivers = sorted(driver_scores.items(), key=lambda x: x[1], reverse=True)[:3]
        driver_labels = [f.replace("_", " ").title() for f, _ in top_drivers]

        retention = [RETENTION_ACTIONS[f] for f, _ in top_drivers if f in RETENTION_ACTIONS]

        return {
            "customer_id":          customer_id,
            "churn_probability_30d": round(prob, 4),
            "churn_risk":            risk,
            "top_churn_drivers":     driver_labels,
            "retention_actions":     retention,
            "rfm_scores": {
                "recency":   round(float(feat_vals.get("recency_score", 0)), 3),
                "frequency": round(float(feat_vals.get("frequency_score", 0)), 3),
                "monetary":  round(float(feat_vals.get("monetary_score", 0)), 3),
            },
        }

    def branch_churn_summary(self, ucp: pd.DataFrame) -> dict:
        """Branch-level churn risk distribution."""
        if not self._trained or self._model is None:
            return {"error": "Model not trained"}

        features = self.compute_rfm_features(ucp)
        X = self._scaler.transform(features.values.astype(np.float32))
        probs = self._model.predict_proba(X)[:, 1]

        high_mask   = probs >= 0.6
        medium_mask = (probs >= 0.3) & ~high_mask
        low_mask    = ~high_mask & ~medium_mask

        customer_ids = ucp["customer_id"].values if "customer_id" in ucp.columns else [f"C{i}" for i in range(len(ucp))]
        top_at_risk = sorted(
            [{"customer_id": str(cid), "churn_probability": round(float(p), 4)}
             for cid, p in zip(customer_ids, probs)],
            key=lambda x: x["churn_probability"], reverse=True
        )[:10]

        return {
            "high_risk_count":    int(high_mask.sum()),
            "medium_risk_count":  int(medium_mask.sum()),
            "low_risk_count":     int(low_mask.sum()),
            "total_customers":    len(ucp),
            "avg_churn_probability": round(float(probs.mean()), 4),
            "top_at_risk_customers": top_at_risk,
        }
