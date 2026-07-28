"""
models/loan_default.py

XGBoost-based loan default predictor with NRB-compliant interest rate recommendations.
"""

from __future__ import annotations
import numpy as np
import pandas as pd
from sklearn.preprocessing import LabelEncoder, StandardScaler
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, f1_score, roc_auc_score

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

# NRB-compliant interest rate bands per risk grade
GRADE_RATE_MAP = {
    "A": {"label": "Prime Borrower",    "rate_range": (8.5,  11.0), "loan_types": ["home_loan", "agricultural"]},
    "B": {"label": "Good Standing",     "rate_range": (11.0, 14.0), "loan_types": ["business_loan", "home_loan"]},
    "C": {"label": "Standard Risk",     "rate_range": (14.0, 17.0), "loan_types": ["personal_loan", "business_loan"]},
    "D": {"label": "Elevated Risk",     "rate_range": (17.0, 20.0), "loan_types": ["personal_loan", "microfinance"]},
    "F": {"label": "High Risk / Deny",  "rate_range": (20.0, 22.0), "loan_types": ["microfinance"]},
}

LOAN_FEATURES = [
    "monthly_income",
    "debt_to_income_ratio",
    "credit_utilization",
    "cibil_score_norm",
    "num_existing_loans",
    "collateral_value_norm",
    "loan_amount_to_income",
    "loan_tenure_months_norm",
    "employment_type_enc",
    "has_guarantor",
    "digital_engagement_score",
    "spending_consistency_score",
]


class LoanDefaultPredictor:
    """
    Predicts probability of loan default using customer financial profile.
    Maps probability to NRB-compliant risk grades and interest rate suggestions.
    """

    def __init__(self):
        self._model = None
        self._scaler = StandardScaler()
        self._emp_encoder = LabelEncoder()
        self._trained = False
        self._shap_explainer = None
        self.feature_importance_: dict = {}
        self.accuracy_: float = 0.0
        self.f1_: float = 0.0
        self.auc_: float = 0.0
        self._income_mean: float = 50000.0
        self._income_std: float = 30000.0

    # ──────────────────────────────────────────────────────────
    # Training
    # ──────────────────────────────────────────────────────────

    def train(self, ucp: pd.DataFrame) -> dict:
        """
        Train on enriched UCP. Synthetic default label based on percentile thresholds
        so that ~20-30% of customers are labelled default regardless of scale.
        """
        df = ucp.copy().dropna(subset=["monthly_income"])

        # Percentile-based label — guarantees ~25% positive rate on any distribution.
        # Each condition only activates when that column has real variance (avoids
        # degenerate all-True from constant/missing columns).
        cibil  = df.get("cibil_score", pd.Series([600] * len(df), index=df.index)).fillna(600)
        dti    = df.get("debt_to_income_ratio", pd.Series(np.zeros(len(df)), index=df.index)).fillna(0)
        alt_cs = df.get("alt_credit_score",
                        df.get("alternative_credit_score",
                               pd.Series([600] * len(df), index=df.index))).fillna(600)

        # Only apply percentile conditions when the column has meaningful variance
        cibil_q20 = cibil.quantile(0.20)
        alt_q15   = alt_cs.quantile(0.15)
        # DTI condition: only meaningful when values are non-constant and non-trivial
        dti_q80 = dti.quantile(0.80) if (dti.std() > 1e-6 and dti.quantile(0.80) > 1e-6) else np.inf

        default_label = (
            (cibil  <= cibil_q20) |
            (alt_cs <= alt_q15)   |
            (dti    >= dti_q80)
        ).astype(int)

        self._income_mean = float(df["monthly_income"].mean())
        self._income_std  = float(df["monthly_income"].std()) + 1e-9

        emp_types = df.get("employment_type", pd.Series(["salaried"] * len(df))).fillna("salaried")
        self._emp_encoder.fit(emp_types)
        emp_enc = self._emp_encoder.transform(emp_types).astype(float)

        X = self._build_feature_matrix(df, emp_enc)
        y = default_label.values

        X_sc = self._scaler.fit_transform(X)
        # Only stratify when both classes have enough samples
        unique, counts = np.unique(y, return_counts=True)
        stratify_param = y if (len(unique) > 1 and counts.min() >= 2) else None
        X_train, X_test, y_train, y_test = train_test_split(
            X_sc, y, test_size=0.2, stratify=stratify_param, random_state=42
        )

        if _XGB_AVAILABLE:
            scale_pos_weight = max(1.0, (y == 0).sum() / max((y == 1).sum(), 1))
            self._model = xgb.XGBClassifier(
                n_estimators=100,
                max_depth=4,
                learning_rate=0.1,
                subsample=0.8,
                colsample_bytree=0.8,
                scale_pos_weight=scale_pos_weight,
                eval_metric="logloss",
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

            self.feature_importance_ = dict(zip(LOAN_FEATURES, self._model.feature_importances_.tolist()))

            if _SHAP_AVAILABLE:
                try:
                    self._shap_explainer = shap.TreeExplainer(self._model)
                except Exception:
                    self._shap_explainer = None
        else:
            # Fallback: logistic regression
            from sklearn.linear_model import LogisticRegression
            self._model = LogisticRegression(max_iter=1000, random_state=42)
            self._model.fit(X_train, y_train)
            y_pred = self._model.predict(X_test)
            self.accuracy_ = float(accuracy_score(y_test, y_pred))
            self.f1_        = float(f1_score(y_test, y_pred, zero_division=0))
            self.feature_importance_ = {f: 1.0 / len(LOAN_FEATURES) for f in LOAN_FEATURES}

        self._trained = True
        default_rate = float(default_label.mean())
        return {
            "n_customers":   len(df),
            "default_rate":  round(default_rate, 4),
            "accuracy":      round(self.accuracy_, 4),
            "f1":            round(self.f1_, 4),
            "auc":           round(self.auc_, 4),
            "feature_importance": self.feature_importance_,
        }

    # ──────────────────────────────────────────────────────────
    # Inference
    # ──────────────────────────────────────────────────────────

    def predict_default_risk(
        self,
        loan_amount: float,
        loan_tenure_months: int,
        monthly_income: float,
        dti: float,
        cibil_score: int,
        credit_utilization: float = 0.3,
        num_existing_loans: int = 0,
        employment_type: str = "salaried",
        collateral_value: float = 0.0,
        has_guarantor: bool = False,
        digital_engagement: float = 50.0,
        spending_consistency: float = 50.0,
    ) -> dict:
        """
        Predict default probability and return NRB-compliant loan assessment.
        """
        if not self._trained or self._model is None:
            return {"error": "Model not trained. Call train() first."}

        emp_enc = self._encode_employment(employment_type)

        features_dict = {
            "monthly_income":          monthly_income,
            "debt_to_income_ratio":    dti,
            "credit_utilization":      credit_utilization,
            "cibil_score_norm":        (cibil_score - 300) / 600,
            "num_existing_loans":      float(num_existing_loans),
            "collateral_value_norm":   min(collateral_value / max(monthly_income * 12, 1), 5.0),
            "loan_amount_to_income":   loan_amount / max(monthly_income, 1),
            "loan_tenure_months_norm": loan_tenure_months / 240.0,
            "employment_type_enc":     float(emp_enc),
            "has_guarantor":           float(has_guarantor),
            "digital_engagement_score": digital_engagement / 100.0,
            "spending_consistency_score": spending_consistency / 100.0,
        }

        X = np.array([[features_dict[f] for f in LOAN_FEATURES]], dtype=np.float32)
        X_sc = self._scaler.transform(X)
        default_prob = float(self._model.predict_proba(X_sc)[0][1])

        grade = self._prob_to_grade(default_prob)
        rate_info = GRADE_RATE_MAP[grade]
        mid_rate = (rate_info["rate_range"][0] + rate_info["rate_range"][1]) / 2
        suggested_rate = round(mid_rate + (default_prob - 0.5) * 3, 2)
        suggested_rate = max(rate_info["rate_range"][0], min(rate_info["rate_range"][1], suggested_rate))

        # Max recommended loan = 60x monthly income * (1 - default_prob) * grade_factor
        grade_factor = {"A": 1.0, "B": 0.85, "C": 0.70, "D": 0.50, "F": 0.25}[grade]
        max_loan = round(monthly_income * 60 * (1 - default_prob) * grade_factor, 0)

        shap_factors = self._get_shap_factors(X_sc, features_dict)

        return {
            "default_probability":      round(default_prob, 4),
            "risk_grade":               grade,
            "risk_label":               rate_info["label"],
            "suggested_interest_rate":  round(suggested_rate, 2),
            "rate_range":               rate_info["rate_range"],
            "recommended_max_loan_npr": max_loan,
            "eligible_loan_types":      rate_info["loan_types"],
            "shap_factors":             shap_factors,
            "nrb_compliant":            True,
        }

    def portfolio_risk_summary(self, ucp: pd.DataFrame) -> dict:
        """Branch-level loan portfolio grade distribution."""
        if not self._trained or self._model is None:
            return {"error": "Model not trained"}

        df = ucp.copy()
        emp_types = df.get("employment_type", pd.Series(["salaried"] * len(df))).fillna("salaried")
        emp_enc = self._encode_employment_batch(emp_types)

        X = np.zeros((len(df), len(LOAN_FEATURES)), dtype=np.float32)
        income = df.get("monthly_income", pd.Series([self._income_mean] * len(df))).fillna(self._income_mean).values
        X[:, 0]  = income
        X[:, 1]  = df.get("debt_to_income_ratio", pd.Series(np.zeros(len(df)))).fillna(0).values
        X[:, 2]  = df.get("credit_utilization", pd.Series(np.zeros(len(df)))).fillna(0).values
        X[:, 3]  = ((df.get("cibil_score", pd.Series([500]*len(df))).fillna(500).values - 300) / 600)
        X[:, 4]  = 0.0
        X[:, 5]  = 0.0
        X[:, 6]  = df.get("total_loan_requested", pd.Series(np.zeros(len(df)))).fillna(0).values / np.maximum(income, 1)
        X[:, 7]  = 0.5
        X[:, 8]  = emp_enc
        X[:, 9]  = 0.0
        X[:, 10] = df.get("digital_engagement_score", pd.Series([50.0]*len(df))).fillna(50).values / 100.0
        X[:, 11] = df.get("spending_consistency_score", pd.Series([50.0]*len(df))).fillna(50).values / 100.0

        X_sc = self._scaler.transform(X)
        probs = self._model.predict_proba(X_sc)[:, 1]
        grades = [self._prob_to_grade(p) for p in probs]

        from collections import Counter
        counts = Counter(grades)
        return {
            "total_customers": len(df),
            "grade_distribution": {g: counts.get(g, 0) for g in ["A", "B", "C", "D", "F"]},
            "avg_default_probability": round(float(probs.mean()), 4),
            "high_risk_count": int((probs >= 0.6).sum()),
        }

    # ──────────────────────────────────────────────────────────
    # Helpers
    # ──────────────────────────────────────────────────────────

    def _build_feature_matrix(self, df: pd.DataFrame, emp_enc: np.ndarray) -> np.ndarray:
        income = df["monthly_income"].fillna(self._income_mean).values
        X = np.column_stack([
            income,
            df.get("debt_to_income_ratio", pd.Series(np.zeros(len(df)))).fillna(0).values,
            df.get("credit_utilization", pd.Series(np.zeros(len(df)))).fillna(0).values,
            (df.get("cibil_score", pd.Series([500]*len(df))).fillna(500).values - 300) / 600,
            np.zeros(len(df)),  # num_existing_loans (not in UCP)
            np.zeros(len(df)),  # collateral_value_norm
            df.get("total_loan_requested", pd.Series(np.zeros(len(df)))).fillna(0).values / np.maximum(income, 1),
            np.full(len(df), 0.5),  # tenure_norm placeholder
            emp_enc,
            np.zeros(len(df)),  # has_guarantor
            df.get("digital_engagement_score", pd.Series([50.0]*len(df))).fillna(50).values / 100.0,
            df.get("spending_consistency_score", pd.Series([50.0]*len(df))).fillna(50).values / 100.0,
        ])
        return X.astype(np.float32)

    def _encode_employment(self, emp: str) -> float:
        try:
            return float(self._emp_encoder.transform([emp])[0])
        except Exception:
            return 0.0

    def _encode_employment_batch(self, emp_series: pd.Series) -> np.ndarray:
        try:
            known = set(self._emp_encoder.classes_)
            mapped = emp_series.apply(lambda x: x if x in known else self._emp_encoder.classes_[0])
            return self._emp_encoder.transform(mapped).astype(float)
        except Exception:
            return np.zeros(len(emp_series))

    def _prob_to_grade(self, prob: float) -> str:
        if prob < 0.15:   return "A"
        if prob < 0.30:   return "B"
        if prob < 0.50:   return "C"
        if prob < 0.70:   return "D"
        return "F"

    def _get_shap_factors(self, X_sc: np.ndarray, features_dict: dict) -> list[dict]:
        if _SHAP_AVAILABLE and self._shap_explainer is not None:
            try:
                shap_vals = self._shap_explainer.shap_values(X_sc)
                pairs = list(zip(LOAN_FEATURES, shap_vals[0].tolist()))
                pairs.sort(key=lambda x: abs(x[1]), reverse=True)
                return [{"feature": f.replace("_", " ").title(), "shap_value": round(v, 4)}
                        for f, v in pairs[:5]]
            except Exception:
                pass
        return [
            {"feature": f.replace("_", " ").title(), "value": round(features_dict.get(f, 0), 4)}
            for f in list(features_dict.keys())[:5]
        ]
