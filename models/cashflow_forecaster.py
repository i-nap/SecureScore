"""
models/cashflow_forecaster.py

Exponential smoothing + moving average cash-flow forecaster.
Produces 3-month spending forecasts with confidence intervals.
"""

from __future__ import annotations
import numpy as np
import pandas as pd
from datetime import datetime, timedelta

BRANCH_TYPE_MAP = {
    "Kathmandu": "urban", "Lalitpur": "urban", "Pokhara": "urban",
    "Bharatpur": "semi_urban", "Biratnagar": "semi_urban",
    "Butwal": "semi_urban", "Hetauda": "semi_urban",
    "Itahari": "semi_urban", "Dharan": "semi_urban",
    "Janakpur": "rural", "Birgunj": "rural",
    "Nepalgunj": "rural", "Sarlahi": "rural",
}

# Monthly seasonality index per branch type (12 months, Jan–Dec)
SEASONALITY_INDEX = {
    "urban": [1.05, 0.95, 1.10, 0.95, 0.90, 0.85, 0.85, 0.90, 1.05, 1.20, 1.25, 1.00],
    "semi_urban": [1.10, 0.90, 1.15, 0.90, 0.85, 0.80, 0.80, 0.90, 1.10, 1.30, 1.35, 0.95],
    "rural":      [1.15, 1.05, 1.20, 0.85, 1.25, 0.80, 0.75, 0.85, 1.15, 1.40, 1.35, 0.90],
}


class CashFlowForecaster:
    """
    Simple two-method cash-flow forecaster:
      Method 1: Exponential smoothing (alpha=0.3)
      Method 2: 3-period moving average
    Ensemble: average of both methods.
    Confidence interval: ±1.5 × rolling std.
    """

    def __init__(self, alpha: float = 0.3, window: int = 3):
        self.alpha = alpha
        self.window = window

    # ──────────────────────────────────────────────────────────
    # Series construction
    # ──────────────────────────────────────────────────────────

    def build_monthly_series(self, customer_id: str, ucp: pd.DataFrame,
                              branch: str = "Kathmandu") -> np.ndarray:
        """
        Reconstruct a synthetic 24-month monthly spending series for a customer.
        Uses dw_total_spent + branch-specific seasonality to distribute.
        """
        cust = ucp[ucp["customer_id"] == customer_id] if "customer_id" in ucp.columns else ucp.iloc[:1]
        if cust.empty:
            return np.zeros(24)

        row = cust.iloc[0]
        annual_spend = float(row.get("dw_total_spent", 0)) or 1.0
        # Distribute annually → monthly. Guard against legacy data generated
        # with a 0.02 scaling bug: if monthly < NPR 500, scale up by 50.
        avg_monthly = annual_spend / 12.0
        if avg_monthly < 500:
            avg_monthly *= 50

        branch_type = BRANCH_TYPE_MAP.get(branch, "semi_urban")
        season = SEASONALITY_INDEX[branch_type]  # 12 values

        # Build 24 months with seasonality + noise
        rng = np.random.default_rng(hash(customer_id) % (2**32))
        series = []
        for m in range(24):
            month_idx = m % 12
            base = avg_monthly * season[month_idx]
            noise = rng.normal(0, base * 0.10)
            series.append(max(0.0, base + noise))

        return np.array(series, dtype=np.float64)

    # ──────────────────────────────────────────────────────────
    # Forecasting methods
    # ──────────────────────────────────────────────────────────

    def _exponential_smoothing(self, series: np.ndarray) -> np.ndarray:
        """Single exponential smoothing."""
        smoothed = np.zeros_like(series)
        smoothed[0] = series[0]
        for t in range(1, len(series)):
            smoothed[t] = self.alpha * series[t] + (1 - self.alpha) * smoothed[t - 1]
        return smoothed

    def _moving_average(self, series: np.ndarray) -> np.ndarray:
        """Simple moving average with window=3."""
        ma = np.zeros_like(series)
        for t in range(len(series)):
            start = max(0, t - self.window + 1)
            ma[t] = np.mean(series[start: t + 1])
        return ma

    def _forecast_next_n(self, smoothed: np.ndarray, ma: np.ndarray,
                          n: int = 3, branch_type: str = "semi_urban") -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """
        Project next n months. Ensemble = average of ES and MA extrapolations.
        Returns (forecast, lower_ci, upper_ci).
        """
        last_es = smoothed[-1]
        last_ma = ma[-1]

        # Trend from last 3 periods
        if len(smoothed) >= 3:
            trend_es = (smoothed[-1] - smoothed[-4]) / 3 if len(smoothed) >= 4 else 0
            trend_ma = (ma[-1] - ma[-4]) / 3 if len(ma) >= 4 else 0
        else:
            trend_es = trend_ma = 0

        season = SEASONALITY_INDEX[branch_type]
        current_month = datetime.now().month

        forecast = []
        for i in range(n):
            month_idx = (current_month + i) % 12
            s_idx = season[month_idx]
            es_val = (last_es + trend_es * (i + 1)) * s_idx
            ma_val = (last_ma + trend_ma * (i + 1)) * s_idx
            ensemble = (es_val + ma_val) / 2.0
            forecast.append(max(0.0, ensemble))

        forecast = np.array(forecast)

        # CI: ±1.5 × std of last 6 periods
        recent_std = float(np.std(smoothed[-6:])) if len(smoothed) >= 6 else float(np.std(smoothed))
        lower_ci = np.maximum(0, forecast - 1.5 * recent_std)
        upper_ci = forecast + 1.5 * recent_std

        return forecast, lower_ci, upper_ci

    # ──────────────────────────────────────────────────────────
    # Public API
    # ──────────────────────────────────────────────────────────

    def forecast_3_months(self, series: np.ndarray, branch_type: str = "semi_urban") -> dict:
        """
        Forecast next 3 months from a 24-month historical series.
        """
        smoothed = self._exponential_smoothing(series)
        ma       = self._moving_average(series)
        forecast, lower_ci, upper_ci = self._forecast_next_n(smoothed, ma, n=3, branch_type=branch_type)

        # Trend assessment
        if len(series) >= 3:
            recent = float(np.mean(series[-3:]))
            earlier = float(np.mean(series[-6:-3])) if len(series) >= 6 else recent
            if recent > earlier * 1.05:
                trend = "increasing"
            elif recent < earlier * 0.95:
                trend = "decreasing"
            else:
                trend = "stable"
        else:
            trend = "stable"

        # Festival note
        current_month = datetime.now().month
        festival_months = [10, 11]
        next_3 = [(current_month + i) % 12 + 1 for i in range(1, 4)]
        fest_note = ""
        if any(m in festival_months for m in next_3):
            fest_note = "Dashain/Tihar festival spike expected — spending may increase 20–40%"
        elif 1 in next_3:
            fest_note = "Maghe Sankranti — moderate spending increase expected"
        elif 3 in next_3:
            fest_note = "Holi festival — slight spending increase expected"

        # Build month labels
        month_names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
        forecast_months = [month_names[(current_month + i) % 12] for i in range(1, 4)]

        return {
            "next_3_months":    [round(float(v), 2) for v in forecast],
            "forecast_months":  forecast_months,
            "confidence_low":   [round(float(v), 2) for v in lower_ci],
            "confidence_high":  [round(float(v), 2) for v in upper_ci],
            "trend":            trend,
            "seasonal_note":    fest_note or "No major festivals expected in forecast window",
            "historical_avg_monthly": round(float(series.mean()), 2),
            "method": "Exponential Smoothing (α=0.3) + Moving Average (window=3) ensemble",
        }

    def forecast_customer(self, customer_id: str, ucp: pd.DataFrame,
                           branch: str = "Kathmandu") -> dict:
        """End-to-end: build series + forecast for a single customer."""
        series = self.build_monthly_series(customer_id, ucp, branch)
        branch_type = BRANCH_TYPE_MAP.get(branch, "semi_urban")
        forecast = self.forecast_3_months(series, branch_type)
        forecast["customer_id"] = customer_id
        forecast["branch"]      = branch
        forecast["historical_series"] = [round(float(v), 2) for v in series[-12:]]
        forecast["historical_months"]  = [
            ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m % 12]
            for m in range(datetime.now().month - 12, datetime.now().month)
        ]
        return forecast

    def branch_aggregate_forecast(self, ucp: pd.DataFrame,
                                   branch: str = "Kathmandu") -> dict:
        """Aggregate 3-month forecast across all branch customers."""
        branch_type = BRANCH_TYPE_MAP.get(branch, "semi_urban")
        total_spent = ucp.get("dw_total_spent", pd.Series(np.zeros(len(ucp)))).fillna(0).values
        annual_sum  = float(total_spent.sum())
        avg_monthly = annual_sum / 12.0
        # Compensate for legacy 0.02-scaled data
        if len(ucp) > 0 and avg_monthly / len(ucp) < 500:
            avg_monthly *= 50

        season = SEASONALITY_INDEX[branch_type]
        current_month = datetime.now().month
        month_names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]

        next_3 = [avg_monthly * season[(current_month + i) % 12] for i in range(1, 4)]
        months = [month_names[(current_month + i) % 12] for i in range(1, 4)]

        std_dev = float(np.std(total_spent)) / 12.0

        return {
            "branch":             branch,
            "n_customers":        len(ucp),
            "forecast_months":    months,
            "aggregate_forecast": [round(v, 0) for v in next_3],
            "confidence_low":     [round(max(0, v - 1.5*std_dev), 0) for v in next_3],
            "confidence_high":    [round(v + 1.5*std_dev, 0) for v in next_3],
            "avg_monthly_historic": round(avg_monthly, 0),
            "currency":           "NPR",
        }
