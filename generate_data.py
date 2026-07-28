"""
generate_data.py — Regional Synthetic Data Generator for SecureScore Bank Suite

Generates branch-isolated datasets that reflect real Nepali economic geography:
  • Urban branches (Kathmandu, Lalitpur, Pokhara) → high base salaries, heavy
    digital spending, steady month-to-month transactions.
  • Semi-urban (Bharatpur, Biratnagar, Butwal, Hetauda, Itahari, Dharan) →
    moderate salaries, mixed merchant activity.
  • Rural (Janakpur, Birgunj, Nepalgunj, Sarlahi) → seasonal agricultural
    income, strong utility/grocery bias, festival & harvest spikes.

Each branch outputs its own CSV:
    generated_data/data_branch_kathmandu.csv
    generated_data/data_branch_pokhara.csv
    ...

The enriched UCP (with branch assignment and regional incomes) is also saved.

Usage:
    python generate_data.py
"""

import os
import random as _stdlib_random
import numpy as np
import pandas as pd
import generate_realistic_nepal as _nepal

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATASETS_DIR = os.path.join(BASE_DIR, "datasets")
GENERATED_DIR = os.path.join(BASE_DIR, "generated_data")
os.makedirs(GENERATED_DIR, exist_ok=True)

# Source CSVs
UCP_CSV = os.path.join(DATASETS_DIR, "unified_customer_profile_for_credit_scoring.csv")
CC_CSV  = os.path.join(DATASETS_DIR, "Credit card transactions - India - Simple.csv")

# Enriched UCP output (single file, but now has a 'branch' column)
ENRICHED_UCP_CSV = os.path.join(GENERATED_DIR, "enriched_ucp.csv")


# ═══════════════════════════════════════════════════════════
#          HARDCODED REGIONAL PROFILES (Task 2)
# ═══════════════════════════════════════════════════════════

REGIONAL_PROFILES = {
    # ── Urban ──────────────────────────────────────────────
    "Kathmandu": {
        "type": "urban",
        "income_mean": 85000,
        "income_std": 30000,
        "income_seasonal_amplitude": 0.05,        # almost flat
        "tx_count_range": (8, 40),                 # heavy digital users
        "amount_log_mu": 7.0,
        "amount_log_sigma": 0.9,
        "merchants": [
            "Daraz", "Foodmandu", "Netflix", "Spotify", "Pathao", "Tootle",
            "QFX Cinemas", "CG Electronics", "SastoDeal", "Bhat-Bhateni",
            "BigMart", "SalesBerry", "WorldLink", "Vianet", "NCell",
        ],
        "merchant_weights": None,                  # uniform across lifestyle
        "product_names": [
            "Daraz Purchase", "Foodmandu Order", "Netflix Sub", "Spotify Premium",
            "Pathao Ride", "QFX Booking", "CG Electronics Purchase",
            "SastoDeal Order", "BigMart Grocery", "SalesBerry Order",
            "Udemy Course", "Movie Ticket", "Daraz Order",
        ],
        "categories": [
            "Shopping", "Food & Dining", "Entertainment", "Subscriptions",
            "Travel", "Electronics", "Fashion", "Education", "Groceries",
        ],
        "category_weights": [0.18, 0.15, 0.13, 0.12, 0.10, 0.09, 0.08, 0.08, 0.07],
        "payment_methods": ["eSewa", "Khalti", "Credit Card", "Fonepay", "ConnectIPS", "Mobile Banking"],
        "payment_weights":  [0.22,   0.20,    0.18,          0.15,      0.13,          0.12],
        "device_probs": [0.60, 0.30, 0.10],       # mobile, desktop, tablet
        "seasonal_peak_months": [],                # no sharp seasonal peaks
        "success_rate_range": (0.92, 0.99),
    },
    "Lalitpur": {
        "type": "urban",
        "income_mean": 78000,
        "income_std": 25000,
        "income_seasonal_amplitude": 0.06,
        "tx_count_range": (7, 35),
        "amount_log_mu": 6.9,
        "amount_log_sigma": 0.85,
        "merchants": [
            "Daraz", "Foodmandu", "Netflix", "Pathao", "QFX Cinemas",
            "CG Electronics", "Bhat-Bhateni", "BigMart", "WorldLink",
            "NCell", "SalesBerry", "SastoDeal",
        ],
        "merchant_weights": None,
        "product_names": [
            "Daraz Purchase", "Foodmandu Order", "Netflix Sub", "Pathao Ride",
            "QFX Booking", "BigMart Grocery", "SalesBerry Order", "Daraz Order",
            "Udemy Course", "SastoDeal Order",
        ],
        "categories": [
            "Shopping", "Food & Dining", "Entertainment", "Subscriptions",
            "Travel", "Electronics", "Groceries", "Education",
        ],
        "category_weights": [0.18, 0.16, 0.14, 0.12, 0.10, 0.10, 0.10, 0.10],
        "payment_methods": ["eSewa", "Khalti", "Credit Card", "Fonepay", "ConnectIPS", "Mobile Banking"],
        "payment_weights":  [0.22,   0.20,    0.16,          0.15,      0.14,          0.13],
        "device_probs": [0.62, 0.28, 0.10],
        "seasonal_peak_months": [],
        "success_rate_range": (0.91, 0.99),
    },
    "Pokhara": {
        "type": "urban",
        "income_mean": 65000,
        "income_std": 22000,
        "income_seasonal_amplitude": 0.12,         # slight tourism seasonality
        "tx_count_range": (6, 30),
        "amount_log_mu": 6.7,
        "amount_log_sigma": 0.9,
        "merchants": [
            "Daraz", "Foodmandu", "Netflix", "Pathao", "Bhat-Bhateni",
            "BigMart", "SastoDeal", "NCell", "NTC", "WorldLink",
            "QFX Cinemas",
        ],
        "merchant_weights": None,
        "product_names": [
            "Daraz Purchase", "Foodmandu Order", "Netflix Sub", "Pathao Ride",
            "BigMart Grocery", "SastoDeal Order", "NTC Recharge",
            "Movie Ticket", "Daraz Order",
        ],
        "categories": [
            "Shopping", "Food & Dining", "Entertainment", "Subscriptions",
            "Travel", "Groceries", "Recharge", "Electronics",
        ],
        "category_weights": [0.17, 0.16, 0.13, 0.11, 0.13, 0.12, 0.10, 0.08],
        "payment_methods": ["eSewa", "Khalti", "Mobile Banking", "Fonepay", "Debit Card", "ConnectIPS"],
        "payment_weights":  [0.25,   0.22,    0.18,             0.15,      0.10,         0.10],
        "device_probs": [0.65, 0.25, 0.10],
        "seasonal_peak_months": [3, 4, 10, 11],   # tourism seasons
        "success_rate_range": (0.90, 0.98),
    },

    # ── Semi-urban ────────────────────────────────────────
    "Bharatpur": {
        "type": "semi_urban",
        "income_mean": 45000,
        "income_std": 15000,
        "income_seasonal_amplitude": 0.15,
        "tx_count_range": (3, 20),
        "amount_log_mu": 6.3,
        "amount_log_sigma": 0.9,
        "merchants": [
            "Daraz", "Bhat-Bhateni", "BigMart", "NTC", "NCell",
            "Nepal Electricity Authority", "eSewa", "Khalti", "IME Pay",
        ],
        "merchant_weights": None,
        "product_names": [
            "Daraz Purchase", "BigMart Grocery", "NTC Recharge", "NEA Bill",
            "eSewa Transfer", "Khalti Mall", "Daraz Order", "Petrol",
        ],
        "categories": [
            "Groceries", "Utilities", "Shopping", "Recharge", "Fuel",
            "Health", "Food & Dining", "Education",
        ],
        "category_weights": [0.20, 0.18, 0.15, 0.12, 0.10, 0.10, 0.08, 0.07],
        "payment_methods": ["eSewa", "Khalti", "Mobile Banking", "Fonepay", "IME Pay", "Debit Card"],
        "payment_weights":  [0.28,   0.22,    0.18,             0.12,      0.12,       0.08],
        "device_probs": [0.72, 0.18, 0.10],
        "seasonal_peak_months": [1, 10, 11],
        "success_rate_range": (0.85, 0.97),
    },
    "Biratnagar": {
        "type": "semi_urban",
        "income_mean": 42000, "income_std": 14000, "income_seasonal_amplitude": 0.18,
        "tx_count_range": (3, 18),
        "amount_log_mu": 6.2, "amount_log_sigma": 0.9,
        "merchants": ["Daraz", "Bhat-Bhateni", "BigMart", "NTC", "NCell", "Nepal Electricity Authority", "eSewa", "IME Pay"],
        "merchant_weights": None,
        "product_names": ["Daraz Purchase", "BigMart Grocery", "NTC Recharge", "NEA Bill", "eSewa Transfer", "Petrol", "Daraz Order"],
        "categories": ["Groceries", "Utilities", "Shopping", "Recharge", "Fuel", "Health", "Food & Dining"],
        "category_weights": [0.22, 0.20, 0.14, 0.12, 0.12, 0.10, 0.10],
        "payment_methods": ["eSewa", "Khalti", "Mobile Banking", "IME Pay", "Fonepay", "Debit Card"],
        "payment_weights":  [0.28,   0.20,    0.20,             0.14,      0.10,       0.08],
        "device_probs": [0.75, 0.15, 0.10],
        "seasonal_peak_months": [1, 4, 10, 11],
        "success_rate_range": (0.84, 0.96),
    },
    "Butwal": {
        "type": "semi_urban",
        "income_mean": 40000, "income_std": 13000, "income_seasonal_amplitude": 0.16,
        "tx_count_range": (3, 16),
        "amount_log_mu": 6.1, "amount_log_sigma": 0.85,
        "merchants": ["Daraz", "BigMart", "NTC", "NCell", "Nepal Electricity Authority", "eSewa", "IME Pay", "Prabhu Pay"],
        "merchant_weights": None,
        "product_names": ["Daraz Purchase", "BigMart Grocery", "NTC Recharge", "NEA Bill", "eSewa Transfer", "Petrol"],
        "categories": ["Groceries", "Utilities", "Shopping", "Recharge", "Fuel", "Health"],
        "category_weights": [0.22, 0.22, 0.14, 0.14, 0.14, 0.14],
        "payment_methods": ["eSewa", "Mobile Banking", "IME Pay", "Khalti", "Fonepay", "Debit Card"],
        "payment_weights":  [0.30,   0.22,             0.18,      0.14,    0.10,       0.06],
        "device_probs": [0.78, 0.12, 0.10],
        "seasonal_peak_months": [1, 4, 10],
        "success_rate_range": (0.83, 0.96),
    },
    "Hetauda": {
        "type": "semi_urban",
        "income_mean": 38000, "income_std": 12000, "income_seasonal_amplitude": 0.18,
        "tx_count_range": (2, 15),
        "amount_log_mu": 6.0, "amount_log_sigma": 0.85,
        "merchants": ["Daraz", "BigMart", "NTC", "Nepal Electricity Authority", "eSewa", "IME Pay"],
        "merchant_weights": None,
        "product_names": ["Daraz Purchase", "BigMart Grocery", "NTC Recharge", "NEA Bill", "eSewa Transfer", "Petrol"],
        "categories": ["Groceries", "Utilities", "Recharge", "Shopping", "Fuel", "Health"],
        "category_weights": [0.24, 0.22, 0.16, 0.14, 0.12, 0.12],
        "payment_methods": ["eSewa", "Mobile Banking", "IME Pay", "Khalti", "Fonepay"],
        "payment_weights":  [0.32,   0.24,             0.20,      0.14,    0.10],
        "device_probs": [0.80, 0.10, 0.10],
        "seasonal_peak_months": [1, 4, 10, 11],
        "success_rate_range": (0.82, 0.95),
    },
    "Itahari": {
        "type": "semi_urban",
        "income_mean": 38000, "income_std": 12000, "income_seasonal_amplitude": 0.17,
        "tx_count_range": (2, 15),
        "amount_log_mu": 6.0, "amount_log_sigma": 0.85,
        "merchants": ["Daraz", "BigMart", "NTC", "NCell", "Nepal Electricity Authority", "eSewa", "IME Pay"],
        "merchant_weights": None,
        "product_names": ["Daraz Purchase", "BigMart Grocery", "NTC Recharge", "NEA Bill", "eSewa Transfer"],
        "categories": ["Groceries", "Utilities", "Recharge", "Shopping", "Fuel", "Health"],
        "category_weights": [0.24, 0.22, 0.16, 0.14, 0.12, 0.12],
        "payment_methods": ["eSewa", "Mobile Banking", "IME Pay", "Fonepay", "Khalti"],
        "payment_weights":  [0.32,   0.24,             0.20,      0.14,    0.10],
        "device_probs": [0.80, 0.10, 0.10],
        "seasonal_peak_months": [1, 4, 10],
        "success_rate_range": (0.82, 0.95),
    },
    "Dharan": {
        "type": "semi_urban",
        "income_mean": 39000, "income_std": 13000, "income_seasonal_amplitude": 0.16,
        "tx_count_range": (2, 16),
        "amount_log_mu": 6.1, "amount_log_sigma": 0.85,
        "merchants": ["Daraz", "BigMart", "NTC", "NCell", "Nepal Electricity Authority", "eSewa", "IME Pay"],
        "merchant_weights": None,
        "product_names": ["Daraz Purchase", "BigMart Grocery", "NTC Recharge", "NEA Bill", "eSewa Transfer", "Petrol"],
        "categories": ["Groceries", "Utilities", "Shopping", "Recharge", "Fuel", "Health", "Food & Dining"],
        "category_weights": [0.22, 0.20, 0.14, 0.14, 0.12, 0.10, 0.08],
        "payment_methods": ["eSewa", "Mobile Banking", "IME Pay", "Khalti", "Fonepay", "Debit Card"],
        "payment_weights":  [0.30,   0.22,             0.18,      0.14,    0.10,       0.06],
        "device_probs": [0.76, 0.14, 0.10],
        "seasonal_peak_months": [1, 4, 10, 11],
        "success_rate_range": (0.83, 0.96),
    },

    # ── Rural ─────────────────────────────────────────────
    "Janakpur": {
        "type": "rural",
        "income_mean": 25000,
        "income_std": 10000,
        "income_seasonal_amplitude": 0.45,         # massive harvest swings
        "tx_count_range": (1, 8),
        "amount_log_mu": 5.5,
        "amount_log_sigma": 1.0,
        "merchants": [
            "Nepal Electricity Authority", "NTC", "eSewa", "IME Pay",
            "Prabhu Pay", "Local Cooperative",
        ],
        "merchant_weights": [0.25, 0.18, 0.20, 0.15, 0.12, 0.10],
        "product_names": [
            "NEA Bill", "NTC Recharge", "eSewa Transfer", "IME Transfer",
            "Petrol", "Insurance",
        ],
        "categories": [
            "Utilities", "Recharge", "Groceries", "Fuel", "Insurance", "Health",
        ],
        "category_weights": [0.30, 0.20, 0.20, 0.12, 0.10, 0.08],
        "payment_methods": ["eSewa", "IME Pay", "Prabhu Pay", "Mobile Banking", "Fonepay"],
        "payment_weights":  [0.35,   0.25,      0.18,         0.15,            0.07],
        "device_probs": [0.88, 0.07, 0.05],
        "seasonal_peak_months": [1, 2, 5, 6, 10, 11],  # rice harvest + festivals
        "success_rate_range": (0.75, 0.93),
    },
    "Birgunj": {
        "type": "rural",
        "income_mean": 28000, "income_std": 11000, "income_seasonal_amplitude": 0.40,
        "tx_count_range": (1, 9),
        "amount_log_mu": 5.6, "amount_log_sigma": 1.0,
        "merchants": ["Nepal Electricity Authority", "NTC", "eSewa", "IME Pay", "Prabhu Pay", "Local Cooperative"],
        "merchant_weights": [0.24, 0.18, 0.20, 0.16, 0.12, 0.10],
        "product_names": ["NEA Bill", "NTC Recharge", "eSewa Transfer", "IME Transfer", "Petrol", "Insurance"],
        "categories": ["Utilities", "Recharge", "Groceries", "Fuel", "Insurance", "Health"],
        "category_weights": [0.28, 0.20, 0.20, 0.14, 0.10, 0.08],
        "payment_methods": ["eSewa", "IME Pay", "Prabhu Pay", "Mobile Banking", "Fonepay"],
        "payment_weights":  [0.34,   0.24,      0.18,         0.16,            0.08],
        "device_probs": [0.86, 0.08, 0.06],
        "seasonal_peak_months": [1, 2, 5, 6, 10, 11],
        "success_rate_range": (0.76, 0.93),
    },
    "Nepalgunj": {
        "type": "rural",
        "income_mean": 24000, "income_std": 9000, "income_seasonal_amplitude": 0.50,
        "tx_count_range": (1, 7),
        "amount_log_mu": 5.4, "amount_log_sigma": 1.0,
        "merchants": ["Nepal Electricity Authority", "NTC", "eSewa", "IME Pay", "Prabhu Pay", "Local Cooperative"],
        "merchant_weights": [0.26, 0.18, 0.20, 0.16, 0.12, 0.08],
        "product_names": ["NEA Bill", "NTC Recharge", "eSewa Transfer", "IME Transfer", "Petrol"],
        "categories": ["Utilities", "Recharge", "Groceries", "Fuel", "Insurance", "Health"],
        "category_weights": [0.30, 0.22, 0.20, 0.12, 0.08, 0.08],
        "payment_methods": ["eSewa", "IME Pay", "Prabhu Pay", "Mobile Banking"],
        "payment_weights":  [0.38,   0.28,      0.20,         0.14],
        "device_probs": [0.90, 0.05, 0.05],
        "seasonal_peak_months": [1, 2, 5, 6, 10, 11],
        "success_rate_range": (0.73, 0.92),
    },
    "Sarlahi": {
        "type": "rural",
        "income_mean": 22000, "income_std": 8000, "income_seasonal_amplitude": 0.55,
        "tx_count_range": (1, 6),
        "amount_log_mu": 5.2, "amount_log_sigma": 1.1,
        "merchants": ["Nepal Electricity Authority", "NTC", "eSewa", "IME Pay", "Prabhu Pay", "Local Cooperative"],
        "merchant_weights": [0.28, 0.16, 0.20, 0.16, 0.12, 0.08],
        "product_names": ["NEA Bill", "NTC Recharge", "eSewa Transfer", "IME Transfer", "Petrol"],
        "categories": ["Utilities", "Recharge", "Groceries", "Fuel", "Health"],
        "category_weights": [0.32, 0.22, 0.22, 0.12, 0.12],
        "payment_methods": ["eSewa", "IME Pay", "Prabhu Pay", "Mobile Banking"],
        "payment_weights":  [0.40,   0.28,      0.18,         0.14],
        "device_probs": [0.92, 0.04, 0.04],
        "seasonal_peak_months": [1, 2, 5, 6, 10, 11],
        "success_rate_range": (0.70, 0.90),
    },
}

# Customer allocation fractions (must sum to 1.0)
BRANCH_ALLOCATION = {
    "Kathmandu": 0.20,
    "Lalitpur":  0.08,
    "Pokhara":   0.10,
    "Bharatpur": 0.08,
    "Biratnagar": 0.07,
    "Butwal":    0.06,
    "Hetauda":   0.05,
    "Itahari":   0.05,
    "Dharan":    0.05,
    "Janakpur":  0.08,
    "Birgunj":   0.07,
    "Nepalgunj": 0.06,
    "Sarlahi":   0.05,
}


# ═══════════════════════════════════════════════════════════
#          HELPER — SEASONAL TIMESTAMP GENERATION (Task 5)
# ═══════════════════════════════════════════════════════════

def _generate_seasonal_timestamps(rng, n, peak_months, year_start=2024, year_end=2025):
    """
    Generate n timestamps between year_start and year_end.
    If peak_months is non-empty, ~60 % of transactions land in those months;
    the remaining ~40 % are spread uniformly across other months.
    """
    all_months = list(range(1, 13))

    if not peak_months:
        # Uniform across all months
        start = pd.Timestamp(f"{year_start}-01-01")
        end = pd.Timestamp(f"{year_end}-12-31")
        s, e = int(start.timestamp()), int(end.timestamp())
        ts = rng.integers(s, e, n)
        return pd.to_datetime(ts, unit="s")

    # Build month-level weights
    off_months = [m for m in all_months if m not in peak_months]
    peak_weight_total = 0.60
    off_weight_total = 0.40
    weights = {}
    for m in all_months:
        if m in peak_months:
            weights[m] = peak_weight_total / len(peak_months)
        else:
            weights[m] = off_weight_total / len(off_months) if off_months else 0

    # For each transaction, pick year+month according to weights, then random day/time
    month_choices = list(weights.keys())
    month_probs = np.array([weights[m] for m in month_choices])
    month_probs /= month_probs.sum()

    chosen_months = rng.choice(month_choices, n, p=month_probs)
    chosen_years = rng.choice(list(range(year_start, year_end + 1)), n)

    timestamps = []
    for yr, mo in zip(chosen_years, chosen_months):
        day_start = pd.Timestamp(year=yr, month=mo, day=1)
        if mo == 12:
            day_end = pd.Timestamp(year=yr, month=12, day=31)
        else:
            day_end = pd.Timestamp(year=yr, month=mo + 1, day=1) - pd.Timedelta(seconds=1)
        s, e = int(day_start.timestamp()), int(day_end.timestamp())
        timestamps.append(rng.integers(s, max(s + 1, e)))
    return pd.to_datetime(timestamps, unit="s")


# ═══════════════════════════════════════════════════════════
#          ASSIGN BRANCHES TO CUSTOMERS
# ═══════════════════════════════════════════════════════════

def assign_branches(ucp_df, rng):
    """Assign each customer to a branch based on BRANCH_ALLOCATION fractions."""
    n = len(ucp_df)
    branches = list(BRANCH_ALLOCATION.keys())
    probs = np.array([BRANCH_ALLOCATION[b] for b in branches])
    probs /= probs.sum()  # ensure exact sum = 1
    ucp_df["branch"] = rng.choice(branches, n, p=probs)
    print(f"[+] Assigned {n:,} customers to {len(branches)} branches")
    for b in branches:
        cnt = (ucp_df["branch"] == b).sum()
        print(f"    {b:15s}: {cnt:,} customers")
    return ucp_df


# ═══════════════════════════════════════════════════════════
#          ENRICH UCP — REGIONAL INCOMES (Task 3)
# ═══════════════════════════════════════════════════════════

def enrich_ucp(df, rng):
    """
    Fill missing digital-wallet / alt-score columns with realistic
    synthetic values.  Income defaults are tied to the customer's
    branch location — never a flat 50,000.
    """
    n = len(df)

    # ── Regional income fill ──────────────────────────────
    for branch, prof in REGIONAL_PROFILES.items():
        mask = (df["branch"] == branch) & (df["monthly_income"].isna() | (df["monthly_income"] == 0))
        n_fill = mask.sum()
        if n_fill > 0:
            incomes = rng.normal(prof["income_mean"], prof["income_std"], n_fill).clip(8000, None)
            df.loc[mask, "monthly_income"] = np.round(incomes, 0)

    # ── DW feature fill ───────────────────────────────────
    need_dw = df["dw_transaction_count"] == 0
    n_fill = need_dw.sum()
    if n_fill > 0:
        # Get per-row branch profile parameters
        branches_for_fill = df.loc[need_dw, "branch"].values
        incomes = df.loc[need_dw, "monthly_income"].values

        # Regional mean incomes for normalization
        regional_means = np.array([
            REGIONAL_PROFILES.get(b, REGIONAL_PROFILES["Kathmandu"])["income_mean"]
            for b in branches_for_fill
        ], dtype=float)
        income_factor = incomes / np.maximum(regional_means, 1)

        # Transaction counts scaled by branch type
        tx_lo = np.array([REGIONAL_PROFILES.get(b, REGIONAL_PROFILES["Kathmandu"])["tx_count_range"][0] for b in branches_for_fill])
        tx_hi = np.array([REGIONAL_PROFILES.get(b, REGIONAL_PROFILES["Kathmandu"])["tx_count_range"][1] for b in branches_for_fill])
        tx_counts = np.array([rng.integers(lo, hi) for lo, hi in zip(tx_lo, tx_hi)], dtype=float)

        log_mu = np.array([REGIONAL_PROFILES.get(b, REGIONAL_PROFILES["Kathmandu"])["amount_log_mu"] for b in branches_for_fill])
        log_sig = np.array([REGIONAL_PROFILES.get(b, REGIONAL_PROFILES["Kathmandu"])["amount_log_sigma"] for b in branches_for_fill])
        avg_amounts = np.array([rng.lognormal(mu, sig) for mu, sig in zip(log_mu, log_sig)]) * income_factor

        total_spent = tx_counts * avg_amounts
        fees = total_spent * rng.uniform(0.005, 0.025, n_fill)
        cashback = total_spent * rng.uniform(0.005, 0.04, n_fill)
        loyalty = (tx_counts * rng.uniform(5, 25, n_fill)).astype(int).astype(float)
        merchants = np.minimum(rng.integers(2, 20, n_fill).astype(float), tx_counts)
        categories = np.minimum(rng.integers(2, 8, n_fill).astype(float), tx_counts)

        sr_lo = np.array([REGIONAL_PROFILES.get(b, REGIONAL_PROFILES["Kathmandu"])["success_rate_range"][0] for b in branches_for_fill])
        sr_hi = np.array([REGIONAL_PROFILES.get(b, REGIONAL_PROFILES["Kathmandu"])["success_rate_range"][1] for b in branches_for_fill])
        success = np.array([rng.uniform(lo, hi) for lo, hi in zip(sr_lo, sr_hi)])

        df.loc[need_dw, "dw_total_spent"]           = np.round(total_spent, 2)
        df.loc[need_dw, "dw_avg_transaction"]        = np.round(avg_amounts, 2)
        df.loc[need_dw, "dw_transaction_std"]        = np.round(avg_amounts * rng.uniform(0.3, 1.2, n_fill), 2)
        df.loc[need_dw, "dw_transaction_count"]      = tx_counts
        df.loc[need_dw, "dw_total_fees"]             = np.round(fees, 2)
        df.loc[need_dw, "dw_avg_fee"]                = np.round(fees / tx_counts, 2)
        df.loc[need_dw, "dw_total_cashback"]         = np.round(cashback, 2)
        df.loc[need_dw, "dw_avg_cashback"]           = np.round(cashback / tx_counts, 2)
        df.loc[need_dw, "dw_total_loyalty_points"]   = loyalty
        df.loc[need_dw, "dw_avg_loyalty_points"]     = np.round(loyalty / tx_counts, 2)
        df.loc[need_dw, "dw_unique_merchants"]       = merchants
        df.loc[need_dw, "dw_unique_categories"]      = categories
        df.loc[need_dw, "dw_primary_payment_method"] = rng.choice(
            ["eSewa", "Khalti", "IME Pay", "ConnectIPS", "Mobile Banking",
             "Credit Card", "Debit Card", "Fonepay"], n_fill)
        df.loc[need_dw, "dw_success_rate"]           = np.round(success, 4)
        df.loc[need_dw, "dw_primary_device"]         = rng.choice(["Mobile", "Desktop", "Tablet"], n_fill)
        df.loc[need_dw, "dw_merchant_diversity"]     = np.round(merchants / tx_counts, 4)
        df.loc[need_dw, "dw_cashback_ratio"]         = np.round(cashback / np.maximum(total_spent, 1), 4)
        df.loc[need_dw, "dw_fee_burden"]             = np.round(fees / np.maximum(total_spent, 1), 4)
        df.loc[need_dw, "dw_loyalty_engagement"]     = np.round(loyalty / np.maximum(tx_counts * 25, 1), 4)
        print(f"[+] Enriched {n_fill:,} customers with synthetic DW data")

    # ── Engagement & consistency ──────────────────────────
    de_miss = df["digital_engagement_score"].isna()
    if de_miss.any():
        nm = de_miss.sum()
        dw_tc = df.loc[de_miss, "dw_transaction_count"].values
        dw_md = df.loc[de_miss, "dw_merchant_diversity"].values
        dw_sr = df.loc[de_miss, "dw_success_rate"].values
        score = (np.log1p(dw_tc) / np.log1p(50) * 40 +
                 np.clip(dw_md, 0, 1) * 30 +
                 dw_sr * 30)
        df.loc[de_miss, "digital_engagement_score"] = np.round(score + rng.normal(0, 3, nm), 2)

    sc_miss = df["spending_consistency_score"] == 0
    if sc_miss.any():
        nm = sc_miss.sum()
        df.loc[sc_miss, "spending_consistency_score"] = np.round(rng.uniform(15, 85, nm), 2)

    # ── Aggregates ────────────────────────────────────────
    df["total_transaction_volume"] = df["cc_total_spent"].fillna(0) + df["dw_total_spent"].fillna(0)
    df["total_transaction_count"]  = df["cc_transaction_count"].fillna(0) + df["dw_transaction_count"].fillna(0)
    df["avg_transaction_value"] = np.where(
        df["total_transaction_count"] > 0,
        df["total_transaction_volume"] / df["total_transaction_count"], 0)
    df["financial_activity_score"] = np.round(
        np.log1p(df["total_transaction_volume"]) / np.log1p(df["total_transaction_volume"].max()) * 100, 2)

    # ── Alternative credit score ──────────────────────────
    cibil_norm   = (df["cibil_score"] - 300) / 600
    util_score   = 1 - df["credit_utilization"].fillna(0).clip(0, 1)
    dti_score    = 1 - df["debt_to_income_ratio"].fillna(0).clip(0, 1)
    approval_sc  = df["loan_approval_rate"].fillna(0)
    spend_con    = df["spending_consistency_score"].fillna(0) / 100
    digital_eng  = df["digital_engagement_score"].fillna(0) / 100
    financial_a  = df["financial_activity_score"].fillna(0) / 100
    fraud_pen    = df["has_fraud_history"].fillna(0) * 0.15

    raw = (cibil_norm  * 0.20 +
           util_score  * 0.10 +
           dti_score   * 0.10 +
           approval_sc * 0.10 +
           spend_con   * 0.15 +
           digital_eng * 0.20 +
           financial_a * 0.15 -
           fraud_pen).clip(0, 1)
    alt = 300 + raw * 600 + rng.normal(0, 12, n)
    df["alternative_credit_score"] = np.round(alt.clip(300, 900), 1)

    print(f"[+] Alt credit scores: mean={df['alternative_credit_score'].mean():.0f}, "
          f"range=[{df['alternative_credit_score'].min():.0f}, {df['alternative_credit_score'].max():.0f}]")

    # ── Nepal-realistic identity fields ───────────────────
    df = _add_nepal_identity_fields(df)
    return df


def _add_nepal_identity_fields(df):
    """
    Append Nepal-realistic identity columns to the enriched UCP.
    Called at the end of enrich_ucp(). Non-destructive — only adds new columns.
    """
    rng_stdlib = _stdlib_random.Random(42)

    full_names, first_names, last_names, genders = [], [], [], []
    phones, nids = [], []
    ward_nos, toles, municipalities, districts, provinces = [], [], [], [], []
    loan_types, loan_labels, loan_min_rates, loan_max_rates, loan_tenures = [], [], [], [], []
    loan_collateral = []

    for _, row in df.iterrows():
        branch = row.get("branch", "Kathmandu")
        gender = row.get("gender", None)
        if isinstance(gender, str) and gender.lower() in ("male", "female"):
            gender = gender.lower()
        else:
            gender = None

        name = _nepal.generate_nepali_name(branch, gender=gender, rng=rng_stdlib)
        full_names.append(name["full_name"])
        first_names.append(name["first_name"])
        last_names.append(name["last_name"])
        genders.append(name["gender"])

        phones.append(_nepal.generate_phone_number(branch, rng=rng_stdlib))

        dist_code = _nepal.BRANCH_DISTRICT_CODE.get(branch, 27)
        nids.append(_nepal.generate_nid(district_code=dist_code, rng=rng_stdlib))

        addr = _nepal.generate_address(branch, rng=rng_stdlib)
        ward_nos.append(addr["ward_no"])
        toles.append(addr["tole"])
        municipalities.append(addr["municipality"])
        districts.append(addr["district"])
        provinces.append(addr["province"])

        loan = _nepal.get_random_loan_product(branch, rng=rng_stdlib)
        loan_types.append(loan["type"])
        loan_labels.append(loan["label"])
        loan_min_rates.append(loan["min_rate"])
        loan_max_rates.append(loan["max_rate"])
        loan_tenures.append(loan["max_tenure_months"])
        loan_collateral.append(loan["collateral_required"])

    df = df.copy()
    df["full_name"]                = full_names
    df["first_name"]               = first_names
    df["last_name"]                = last_names
    df["gender"]                   = genders
    df["phone"]                    = phones
    df["nid"]                      = nids
    df["ward_no"]                  = ward_nos
    df["tole"]                     = toles
    df["municipality"]             = municipalities
    df["district"]                 = districts
    df["province"]                 = provinces
    df["primary_loan_type"]        = loan_types
    df["primary_loan_label"]       = loan_labels
    df["loan_min_rate_pct"]        = loan_min_rates
    df["loan_max_rate_pct"]        = loan_max_rates
    df["loan_max_tenure_months"]   = loan_tenures
    df["loan_collateral_required"] = loan_collateral

    print(f"[+] Nepal identity fields added: {len(df):,} customers "
          f"(names, phones, NID, addresses, loan products)")
    return df


# ═══════════════════════════════════════════════════════════
#     GENERATE TRANSACTIONS — GROUPED BY BRANCH (Tasks 1,4,5)
# ═══════════════════════════════════════════════════════════

def generate_branch_transactions(ucp_df, rng, n_per_customer=5):
    """
    Generate synthetic DW transactions **per branch**.
    Returns a dict  {branch_name: DataFrame}.
    Each branch's transactions are shaped by its regional profile:
      - merchants, categories, product names drawn from profile
      - amounts scaled to regional income
      - timestamps biased toward seasonal peaks
    """
    branch_frames = {}

    for branch, prof in REGIONAL_PROFILES.items():
        cust_mask = ucp_df["branch"] == branch
        customers = ucp_df.loc[cust_mask, "customer_id"].values
        n_cust = len(customers)
        if n_cust == 0:
            continue

        lo, hi = prof["tx_count_range"]
        tx_counts = rng.integers(max(1, lo), hi + 1, n_cust)
        total_rows = int(tx_counts.sum())
        cust_ids = np.repeat(customers, tx_counts)

        # ── Categories (correlated to environment) ────────
        cat_choices = prof["categories"]
        cat_probs = np.array(prof["category_weights"], dtype=float)
        cat_probs /= cat_probs.sum()
        categories = rng.choice(cat_choices, total_rows, p=cat_probs)

        # ── Merchants (correlated to environment) ─────────
        merch_choices = prof["merchants"]
        if prof["merchant_weights"]:
            merch_probs = np.array(prof["merchant_weights"], dtype=float)
            merch_probs /= merch_probs.sum()
        else:
            merch_probs = np.ones(len(merch_choices)) / len(merch_choices)
        merchants = rng.choice(merch_choices, total_rows, p=merch_probs)

        # ── Product names ─────────────────────────────────
        product_names = rng.choice(prof["product_names"], total_rows)

        # ── Amounts (regional scale) ──────────────────────
        amounts = np.round(rng.lognormal(prof["amount_log_mu"],
                                          prof["amount_log_sigma"],
                                          total_rows), 2)

        fees     = np.round(amounts * rng.uniform(0.0, 0.02, total_rows), 2)
        cashback = np.round(amounts * rng.uniform(0.0, 0.05, total_rows), 2)
        loyalty  = rng.integers(0, 50, total_rows)

        # ── Payment methods ───────────────────────────────
        pay_choices = prof["payment_methods"]
        pay_probs = np.array(prof["payment_weights"], dtype=float)
        pay_probs /= pay_probs.sum()
        methods = rng.choice(pay_choices, total_rows, p=pay_probs)

        statuses = rng.choice(
            ["Success", "Success", "Success", "Success", "Success",
             "Success", "Success", "Failed", "Pending"], total_rows)
        devices = rng.choice(["Mobile", "Desktop", "Tablet"], total_rows,
                              p=prof["device_probs"])

        # ── Seasonal timestamps (Task 5) ──────────────────
        timestamps = _generate_seasonal_timestamps(
            rng, total_rows, prof["seasonal_peak_months"])
        dates = timestamps.strftime("%Y-%m-%d")

        tx_ids = [f"TXN_{branch[:3].upper()}_{i:07d}" for i in range(total_rows)]
        m_ids  = [f"MERCH_{rng.integers(1000, 9999)}" for _ in range(total_rows)]

        frame = pd.DataFrame({
            "transaction_id":   tx_ids,
            "user_id":          cust_ids,
            "branch":           branch,
            "transaction_date": dates,
            "product_category": categories,
            "product_name":     product_names,
            "merchant_name":    merchants,
            "product_amount":   amounts,
            "transaction_fee":  fees,
            "cashback":         cashback,
            "loyalty_points":   loyalty,
            "payment_method":   methods,
            "transaction_status": statuses,
            "merchant_id":      m_ids,
            "device_type":      devices,
            "location":         branch,
        })
        branch_frames[branch] = frame
        print(f"  {branch:15s}: {total_rows:>7,} transactions  ({n_cust:,} customers)")

    return branch_frames


# ═══════════════════════════════════════════════════════════
#          MAIN PIPELINE
# ═══════════════════════════════════════════════════════════

def main():
    rng = np.random.default_rng(2024)

    print("=" * 64)
    print("  SecureScore — Regional Synthetic Data Generator")
    print("=" * 64)

    # ── 1. Load source UCP ────────────────────────────────
    print("\n[1/4] Loading source UCP dataset ...")
    try:
        ucp_df = pd.read_csv(UCP_CSV)
        print(f"  UCP: {len(ucp_df):,} rows, {len(ucp_df.columns)} columns")
    except Exception as exc:
        print(f"  [!] UCP load error: {exc}")
        return

    # ── 2. Assign branches ────────────────────────────────
    print("\n[2/4] Assigning customers to regional branches ...")
    ucp_df = assign_branches(ucp_df, rng)

    # ── 3. Enrich UCP with regional incomes + DW features ─
    print("\n[3/4] Enriching UCP (regional incomes, DW features, alt scores) ...")
    ucp_df = enrich_ucp(ucp_df, rng)
    ucp_df.to_csv(ENRICHED_UCP_CSV, index=False)
    print(f"  Saved: {ENRICHED_UCP_CSV}")

    # ── 4. Generate per-branch transaction files ──────────
    print("\n[4/4] Generating branch-isolated transaction files ...")
    branch_frames = generate_branch_transactions(ucp_df, rng)

    saved_files = []
    for branch, frame in branch_frames.items():
        slug = branch.lower().replace(" ", "_")
        path = os.path.join(GENERATED_DIR, f"data_branch_{slug}.csv")
        frame.to_csv(path, index=False)
        saved_files.append(path)

    # ── Summary ───────────────────────────────────────────
    total_tx = sum(len(f) for f in branch_frames.values())
    print(f"\n{'=' * 64}")
    print(f"  Done!  {total_tx:,} total transactions across {len(branch_frames)} branches.")
    print(f"  Output directory: {GENERATED_DIR}")
    print(f"{'=' * 64}")
    print("\nGenerated files:")
    print(f"  1. {os.path.basename(ENRICHED_UCP_CSV)}  (enriched customer profiles)")
    for i, p in enumerate(saved_files, 2):
        print(f"  {i}. {os.path.basename(p)}")
    print("\nYou can now run bank_app.py or centralized_baseline.py.")


if __name__ == "__main__":
    main()
