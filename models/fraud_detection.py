"""
models/fraud_detection.py

ML-based fraud detection using IsolationForest + XGBoost ensemble.
Better than z-score approach — captures multi-dimensional anomalies.
"""

from __future__ import annotations
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler

try:
    import xgboost as xgb
    _XGB_AVAILABLE = True
except ImportError:
    _XGB_AVAILABLE = False

try:
    import shap
    _SHAP_AVAILABLE = True
except ImportError:
    _SHAP_AVAILABLE = False

FRAUD_FEATURES = [
    "tx_velocity",
    "merchant_risk_score",
    "night_txn_ratio",
    "round_amount_ratio",
    "avg_txn_amount",
    "txn_std_norm",
    "repeat_merchant_ratio",
    "fee_burden_norm",
]

# High-risk merchant categories (mapped from UCP merchant diversity features)
HIGH_RISK_CATEGORIES = {"cooperative", "government"}


class FraudDetector:
    """
    Two-stage fraud detector:
      Stage 1: IsolationForest on 8 behavioral features → anomaly score
      Stage 2: XGBClassifier using IF score + original features → fraud probability

    Ensemble score = 0.4 * IF_score_norm + 0.6 * XGB_prob
    """

    def __init__(self, contamination: float = 0.05, n_estimators: int = 100):
        self.contamination = contamination
        self.n_estimators = n_estimators
        self._if_model: IsolationForest | None = None
        self._xgb_model = None
        self._scaler = StandardScaler()
        self._shap_explainer = None
        self._trained = False
        self.feature_importance_: dict = {}
        self.n_flagged_: int = 0
        self.ensemble_auc_: float = 0.0

    # ──────────────────────────────────────────────────────────
    # Feature engineering
    # ──────────────────────────────────────────────────────────

    def extract_features(self, ucp: pd.DataFrame) -> pd.DataFrame:
        """
        Compute per-customer fraud-relevant behavioral features from UCP.
        Returns DataFrame indexed by customer_id with FRAUD_FEATURES columns.
        """
        df = ucp.copy()

        # tx_velocity — transaction frequency relative to median
        tx_count = df.get("dw_transaction_count", pd.Series(np.zeros(len(df)), index=df.index))
        tx_median = tx_count.median() if tx_count.median() > 0 else 1.0
        df["tx_velocity"] = (tx_count / tx_median).clip(0, 10)

        # merchant_risk_score — merchant diversity as proxy for risk
        # (high diversity can indicate rapid merchant switching)
        diversity = df.get("dw_merchant_diversity", pd.Series(np.zeros(len(df)), index=df.index))
        df["merchant_risk_score"] = diversity.fillna(0).clip(0, 1)

        # night_txn_ratio — proxy: customers with very low fees tend to do
        # off-hours transactions where fraud is harder to detect
        fee_burden = df.get("dw_fee_burden", pd.Series(np.zeros(len(df)), index=df.index))
        df["night_txn_ratio"] = (1 - fee_burden.fillna(0).clip(0, 0.1) / 0.1).clip(0, 1) * 0.4

        # round_amount_ratio — proxy from cashback_ratio (round amounts earn less cashback)
        cashback_ratio = df.get("dw_cashback_ratio", pd.Series(np.zeros(len(df)), index=df.index))
        df["round_amount_ratio"] = (1 - cashback_ratio.fillna(0).clip(0, 0.05) / 0.05).clip(0, 1)

        # avg_txn_amount — normalized log
        avg_txn = df.get("dw_avg_transaction", pd.Series(np.ones(len(df)), index=df.index))
        df["avg_txn_amount"] = np.log1p(avg_txn.fillna(0).clip(0)) / 15.0

        # txn_std_norm — coefficient of variation
        txn_std = df.get("dw_transaction_std", pd.Series(np.zeros(len(df)), index=df.index))
        df["txn_std_norm"] = (txn_std.fillna(0) / np.maximum(avg_txn.fillna(1), 1)).clip(0, 5)

        # repeat_merchant_ratio — 1 - merchant_diversity (more repeat = less risky normally)
        df["repeat_merchant_ratio"] = (1 - df["merchant_risk_score"]).clip(0, 1)

        # fee_burden_norm
        df["fee_burden_norm"] = fee_burden.fillna(0).clip(0, 0.1) / 0.1

        feat_df = df[FRAUD_FEATURES].fillna(0)
        if "customer_id" in df.columns:
            feat_df = feat_df.set_index(df["customer_id"].values)
        return feat_df

    # ──────────────────────────────────────────────────────────
    # Training
    # ──────────────────────────────────────────────────────────

    def train(self, ucp: pd.DataFrame) -> dict:
        """
        Train IsolationForest + XGBoost ensemble on branch UCP data.
        Returns training metrics dict.
        """
        features = self.extract_features(ucp)
        X = features.values.astype(np.float32)

        # Scale
        X_scaled = self._scaler.fit_transform(X)

        # Stage 1: IsolationForest
        self._if_model = IsolationForest(
            n_estimators=200,
            contamination=self.contamination,
            random_state=42,
            n_jobs=-1,
        )
        self._if_model.fit(X_scaled)
        if_scores = self._if_model.decision_function(X_scaled)  # higher = more normal
        if_labels = (self._if_model.predict(X_scaled) == -1).astype(int)  # 1=anomaly

        # Normalize IF score to [0,1] where 1 = most anomalous
        if_score_norm = 1 - (if_scores - if_scores.min()) / (np.ptp(if_scores) + 1e-9)

        self.n_flagged_ = int(if_labels.sum())

        if _XGB_AVAILABLE:
            # Stage 2: XGBoost with IF score as additional feature
            X_aug = np.column_stack([X_scaled, if_score_norm])
            self._xgb_model = xgb.XGBClassifier(
                n_estimators=self.n_estimators,
                max_depth=4,
                learning_rate=0.1,
                subsample=0.8,
                colsample_bytree=0.8,
                eval_metric="logloss",
                random_state=42,
                n_jobs=-1,
            )
            self._xgb_model.fit(X_aug, if_labels)

            # Feature importance
            aug_names = FRAUD_FEATURES + ["if_score"]
            imp = self._xgb_model.feature_importances_
            self.feature_importance_ = dict(zip(aug_names, imp.tolist()))

            # SHAP explainer
            if _SHAP_AVAILABLE:
                try:
                    self._shap_explainer = shap.TreeExplainer(self._xgb_model)
                except Exception:
                    self._shap_explainer = None

            # Approximate AUC using IF labels vs XGB probabilities
            xgb_probs = self._xgb_model.predict_proba(X_aug)[:, 1]
            from sklearn.metrics import roc_auc_score
            try:
                self.ensemble_auc_ = float(roc_auc_score(if_labels, xgb_probs))
            except Exception:
                self.ensemble_auc_ = 0.0
        else:
            self.feature_importance_ = {f: 1.0 / len(FRAUD_FEATURES) for f in FRAUD_FEATURES}

        self._trained = True
        return {
            "n_customers": len(ucp),
            "n_flagged": self.n_flagged_,
            "contamination": self.contamination,
            "ensemble_auc": round(self.ensemble_auc_, 4),
            "feature_importance": self.feature_importance_,
        }

    # ──────────────────────────────────────────────────────────
    # Inference
    # ──────────────────────────────────────────────────────────

    def predict(self, ucp: pd.DataFrame) -> pd.DataFrame:
        """
        Run fraud detection on a UCP DataFrame.
        Returns DataFrame with fraud risk scores per customer.
        """
        if not self._trained or self._if_model is None:
            self.train(ucp)

        features = self.extract_features(ucp)
        X = features.values.astype(np.float32)
        X_scaled = self._scaler.transform(X)

        if_scores = self._if_model.decision_function(X_scaled)
        if_score_norm = 1 - (if_scores - if_scores.min()) / (np.ptp(if_scores) + 1e-9)

        if _XGB_AVAILABLE and self._xgb_model is not None:
            X_aug = np.column_stack([X_scaled, if_score_norm])
            xgb_probs = self._xgb_model.predict_proba(X_aug)[:, 1]
            ensemble_scores = 0.4 * if_score_norm + 0.6 * xgb_probs
        else:
            xgb_probs = if_score_norm
            ensemble_scores = if_score_norm

        risk_levels = np.where(
            ensemble_scores >= 0.7, "high",
            np.where(ensemble_scores >= 0.4, "medium", "low")
        )

        # Top flag reason from feature importance
        top_reasons = []
        for i in range(len(features)):
            feat_vals = features.iloc[i].values
            top_idx = int(np.argmax(feat_vals))
            top_reasons.append(FRAUD_FEATURES[top_idx].replace("_", " ").title())

        result = pd.DataFrame({
            "customer_id":    ucp["customer_id"].values if "customer_id" in ucp.columns else [f"C{i}" for i in range(len(ucp))],
            "if_score":       np.round(if_score_norm, 4),
            "xgb_fraud_prob": np.round(xgb_probs, 4),
            "ensemble_score": np.round(ensemble_scores, 4),
            "risk_level":     risk_levels,
            "top_flag_reason": top_reasons,
        })
        return result.sort_values("ensemble_score", ascending=False).reset_index(drop=True)

    def explain(self, customer_id: str, ucp: pd.DataFrame) -> dict:
        """Return SHAP-based explanation for a specific customer's fraud score."""
        if not self._trained:
            return {"error": "Model not trained"}

        cust_row = ucp[ucp["customer_id"] == customer_id]
        if cust_row.empty:
            return {"error": f"Customer {customer_id} not found"}

        features = self.extract_features(cust_row)
        X = features.values.astype(np.float32)
        X_scaled = self._scaler.transform(X)

        if_score = float(self._if_model.decision_function(X_scaled)[0])
        if_norm = float(1 - (if_score - (-1)) / (1 - (-1) + 1e-9))

        factors = []
        if _SHAP_AVAILABLE and self._shap_explainer is not None and _XGB_AVAILABLE:
            X_aug = np.column_stack([X_scaled, [[if_norm]]])
            shap_vals = self._shap_explainer.shap_values(X_aug)
            aug_names = FRAUD_FEATURES + ["if_score"]
            pairs = list(zip(aug_names, shap_vals[0].tolist()))
            pairs.sort(key=lambda x: abs(x[1]), reverse=True)
            factors = [{"feature": f.replace("_", " ").title(), "shap_value": round(v, 4)}
                       for f, v in pairs[:5]]
        else:
            feat_vals = features.iloc[0].to_dict()
            sorted_feats = sorted(feat_vals.items(), key=lambda x: abs(x[1]), reverse=True)
            factors = [{"feature": f.replace("_", " ").title(), "value": round(v, 4)}
                       for f, v in sorted_feats[:5]]

        return {
            "customer_id": customer_id,
            "if_anomaly_score": round(if_norm, 4),
            "top_fraud_factors": factors,
        }
