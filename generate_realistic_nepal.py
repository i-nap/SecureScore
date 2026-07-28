"""
generate_realistic_nepal.py

Helper module for Nepal-realistic synthetic data generation.
Imported by generate_data.py to enrich customer profiles with authentic
Nepali names, phone formats, NID numbers, addresses, and merchant lists.
"""

import random
import numpy as np
from typing import Optional

# ─────────────────────────────────────────────────────────────
# Names
# ─────────────────────────────────────────────────────────────

NEPALI_SURNAMES = {
    "brahmin": [
        "Sharma", "Poudel", "Adhikari", "Bhattarai", "Koirala",
        "Regmi", "Dahal", "Tiwari", "Aryal", "Ghimire",
        "Sapkota", "Bastola", "Gautam", "Dhakal", "Rijal",
    ],
    "chhetri": [
        "Thapa", "KC", "Karki", "Basnet", "Chand",
        "Roka", "Bista", "Khadka", "Shah", "Bohara",
        "Kunwar", "Rana", "Saud", "Oli", "Deuba",
    ],
    "newar": [
        "Shrestha", "Maharjan", "Manandhar", "Tuladhar", "Pradhan",
        "Rajbhandari", "Joshi", "Vaidya", "Amatya", "Bajracharya",
        "Shakya", "Sthapit", "Malla", "Nakarmi", "Dangol",
    ],
    "janajati": [
        "Tamang", "Gurung", "Magar", "Rai", "Limbu",
        "Sherpa", "Sunuwar", "Tharu", "Chaudhary", "Kumal",
        "Majhi", "Danuwar", "Jirel", "Hayu", "Pahari",
    ],
    "madhesi": [
        "Yadav", "Singh", "Sah", "Jha", "Mishra",
        "Chaudhary", "Gupta", "Agrawal", "Dubey", "Pandey",
        "Mandal", "Thakur", "Paswan", "Chamar", "Mahato",
    ],
}

NEPALI_MALE_NAMES = [
    "Ramesh", "Bijay", "Deepak", "Suresh", "Naresh",
    "Bikash", "Sanjay", "Arjun", "Roshan", "Santosh",
    "Pradip", "Rajesh", "Manoj", "Anil", "Dinesh",
    "Kamal", "Ganesh", "Binod", "Prakash", "Narayan",
    "Krishna", "Hari", "Ram", "Shyam", "Gopal",
    "Sagar", "Rajan", "Mohan", "Subash", "Prem",
    "Dil", "Tek", "Gyan", "Man", "Dev",
]

NEPALI_FEMALE_NAMES = [
    "Sunita", "Sushma", "Anita", "Reena", "Rita",
    "Sabita", "Sarita", "Puja", "Mina", "Sita",
    "Gita", "Kamala", "Shanta", "Bimala", "Laxmi",
    "Radha", "Durga", "Parvati", "Meena", "Rekha",
    "Nirmala", "Kopila", "Babita", "Kabita", "Sangita",
    "Sumitra", "Sushmita", "Nisha", "Priya", "Maya",
    "Mamata", "Manju", "Anju", "Ranju", "Tara",
]

# ─────────────────────────────────────────────────────────────
# Province & branch mapping
# ─────────────────────────────────────────────────────────────

PROVINCE_INCOME_INDEX = {
    "Bagmati":       1.35,
    "Gandaki":       1.10,
    "Lumbini":       0.95,
    "Koshi":         0.95,
    "Madhesh":       0.85,
    "Karnali":       0.72,
    "Sudurpashchim": 0.70,
}

BRANCH_PROVINCE = {
    "Kathmandu":  "Bagmati",
    "Lalitpur":   "Bagmati",
    "Pokhara":    "Gandaki",
    "Bharatpur":  "Bagmati",
    "Butwal":     "Lumbini",
    "Biratnagar": "Koshi",
    "Hetauda":    "Bagmati",
    "Itahari":    "Koshi",
    "Dharan":     "Koshi",
    "Janakpur":   "Madhesh",
    "Birgunj":    "Madhesh",
    "Nepalgunj":  "Lumbini",
    "Sarlahi":    "Madhesh",
}

# Caste proportions per branch type
BRANCH_TYPE_CASTE_WEIGHTS = {
    "urban": {
        "brahmin": 0.30, "chhetri": 0.25, "newar": 0.25,
        "janajati": 0.15, "madhesi": 0.05,
    },
    "semi_urban": {
        "brahmin": 0.25, "chhetri": 0.30, "newar": 0.10,
        "janajati": 0.25, "madhesi": 0.10,
    },
    "rural": {
        "brahmin": 0.20, "chhetri": 0.20, "newar": 0.05,
        "janajati": 0.20, "madhesi": 0.35,
    },
}

BRANCH_TYPE_MAP = {
    "Kathmandu": "urban", "Lalitpur": "urban", "Pokhara": "urban",
    "Bharatpur": "semi_urban", "Biratnagar": "semi_urban",
    "Butwal": "semi_urban", "Hetauda": "semi_urban",
    "Itahari": "semi_urban", "Dharan": "semi_urban",
    "Janakpur": "rural", "Birgunj": "rural",
    "Nepalgunj": "rural", "Sarlahi": "rural",
}

# ─────────────────────────────────────────────────────────────
# District codes for NID (based on Nepal district numbers)
# ─────────────────────────────────────────────────────────────

BRANCH_DISTRICT_CODE = {
    "Kathmandu": 27, "Lalitpur": 26, "Pokhara": 60,
    "Bharatpur": 38, "Biratnagar": 4,  "Butwal": 49,
    "Hetauda":   36, "Itahari": 5,    "Dharan": 6,
    "Janakpur":  22, "Birgunj": 40,   "Nepalgunj": 65,
    "Sarlahi":   28,
}

# ─────────────────────────────────────────────────────────────
# Address data
# ─────────────────────────────────────────────────────────────

BRANCH_MUNICIPALITIES = {
    "Kathmandu":  ["Kathmandu Metropolitan", "Budhanilkantha", "Kageshwori-Manohara"],
    "Lalitpur":   ["Lalitpur Metropolitan", "Mahalaxmi", "Godawari"],
    "Pokhara":    ["Pokhara Metropolitan", "Annapurna", "Machhapuchchhre"],
    "Bharatpur":  ["Bharatpur Metropolitan", "Ratnanagar", "Rapti"],
    "Biratnagar": ["Biratnagar Metropolitan", "Rangeli", "Pathari-Shanischare"],
    "Butwal":     ["Butwal Sub-Metropolitan", "Tilottama", "Sainamaina"],
    "Hetauda":    ["Hetauda Sub-Metropolitan", "Makawanpurgadhi", "Thaha"],
    "Itahari":    ["Itahari Sub-Metropolitan", "Dharan Sub-Metropolitan", "Sunsari"],
    "Dharan":     ["Dharan Sub-Metropolitan", "Duhabi", "Barahkshetra"],
    "Janakpur":   ["Janakpurdham Sub-Metropolitan", "Dhanusha Rural", "Hanspur"],
    "Birgunj":    ["Birgunj Metropolitan", "Parsa", "Pokhariya"],
    "Nepalgunj":  ["Nepalgunj Sub-Metropolitan", "Duduwa", "Kohalpur"],
    "Sarlahi":    ["Lalbandi Sub-Metropolitan", "Harion", "Chakraghatta"],
}

TOLES_BY_TYPE = {
    "urban": [
        "Baneshwor", "Koteshwor", "Tinkune", "Chabahil", "Jorpati",
        "Boudha", "Kalanki", "Balaju", "Maharajgunj", "Lazimpat",
        "Jhamsikhel", "Patan Dhoka", "Satdobato", "Pulchowk", "Jawalakhel",
    ],
    "semi_urban": [
        "Bazar Tole", "School Road", "Hospital Chowk", "Bus Park Area",
        "Market Area", "New Road", "Old Bazaar", "Temple Tole",
        "River Bank", "Mango Tole",
    ],
    "rural": [
        "Ward No. 1 Tole", "Purba Tole", "Paschim Tole",
        "Uttar Tole", "Dakshin Tole", "Gaun Tole",
        "Khola Tole", "Bazar Marg",
    ],
}

# ─────────────────────────────────────────────────────────────
# Phone numbers
# ─────────────────────────────────────────────────────────────

# NTC Namaste: 98[456]XXXXXXX  (starts 984, 985, 986)
# Ncell:       98[01]XXXXXXX   (starts 980, 981, 982)
# SmartCell:   961XXXXXXX

NTC_PREFIXES   = ["984", "985", "986"]
NCELL_PREFIXES = ["980", "981", "982"]
SMART_PREFIXES = ["961"]

BRANCH_PHONE_WEIGHTS = {
    "urban":      {"ntc": 0.40, "ncell": 0.55, "smart": 0.05},
    "semi_urban": {"ntc": 0.60, "ncell": 0.35, "smart": 0.05},
    "rural":      {"ntc": 0.80, "ncell": 0.18, "smart": 0.02},
}

# ─────────────────────────────────────────────────────────────
# Merchants
# ─────────────────────────────────────────────────────────────

MERCHANTS_BY_CATEGORY = {
    "food_delivery": [
        "Foodmandu", "Bhojdeals", "Pathao Food", "DishHome Kitchen",
        "Mitho Khana", "Bhojan Griha", "Nepal Kitchen Delivery",
        "Thakali Kitchen", "Momo Palace Delivery", "Burger Hut",
    ],
    "restaurant": [
        "Himalayan Java", "OR2K Restaurant", "Thamel House Restaurant",
        "Old House Restaurant", "Bhojan Griha", "Roadhouse Cafe",
        "Daal Bhat Power", "Momo Station", "Burger Shack",
        "Cafe Soma", "New Everest Momo Center",
    ],
    "grocery": [
        "Bhat-Bhateni Superstore", "BigMart", "Smart Choice Supermarket",
        "Sewa Departmental Store", "Local Kiryana Pasal",
        "Daily Needs Store", "Fresh Fruits & Vegetables",
        "Sajilo Mart", "Hamro Bazaar Grocery",
    ],
    "ecommerce": [
        "Daraz Nepal", "SastoDeal", "HamroBazaar", "Thulo.com",
        "Gyapu", "Oliz Store", "Digital Pasal",
        "MeroShopping", "CG Digital",
    ],
    "utilities": [
        "Nepal Electricity Authority", "Nepal Telecom Recharge",
        "Ncell Recharge", "Prabhu TV", "DishHome",
        "Subisu Broadband", "WorldLink Communications",
        "CG Net", "Vianet Communications",
    ],
    "transport": [
        "Pathao Ride", "InDrive Nepal", "Tootle",
        "Nepal Airlines", "Buddha Air", "Yeti Airlines",
        "Sajha Yatayat", "Metro Taxi", "Kathmandu Bus",
        "Himalayan Helicopters",
    ],
    "fintech": [
        "eSewa", "Khalti", "IME Pay", "Prabhu Pay",
        "ConnectIPS", "Fonepay", "QPay Nepal",
        "IRFC", "Nabil eBank", "Bank of Kathmandu Mobile",
    ],
    "healthcare": [
        "Nepal Mediciti Hospital", "Norvic International Hospital",
        "Grande International Hospital", "B&B Hospital",
        "HAMS Hospital", "Bir Hospital", "Patan Hospital",
        "TU Teaching Hospital", "Nepal Medical College",
        "Scheer Memorial Hospital",
    ],
    "education": [
        "Kantipur Publication Books", "Oxford Book Store",
        "Ekta Books", "Educational Material Store",
        "School Fee Payment - NEA Gateway",
        "Tuition Fee - Khalti", "Library Fee",
        "Exam Fee - TU", "Skill Development Course",
    ],
    "cooperative": [
        "Sahara Saving Cooperative", "Siddhartha Cooperative",
        "SKBBL Cooperative", "Purbanchal Cooperative",
        "Gramin Cooperative Society", "Sana Kisan Cooperative",
        "Nari Shakti Cooperative", "Jagaran Cooperative",
        "Local Savings Group", "Community Finance Group",
    ],
    "government": [
        "Department of Transport Management",
        "Inland Revenue Department",
        "Department of Passport",
        "Nepal Police Service Fee",
        "Municipality Tax Payment",
        "Land Revenue Office",
        "Ward Office Service",
    ],
    "insurance": [
        "Nepal Life Insurance", "Rastriya Beema Company",
        "NIC Asia Life Insurance", "Surya Life Insurance",
        "Prabhu Insurance", "Shikhar Insurance",
    ],
}

# Category weights by branch type (must sum to 1.0 per type)
CATEGORY_WEIGHTS_BY_TYPE = {
    "urban": {
        "food_delivery": 0.08, "restaurant": 0.10, "grocery": 0.10,
        "ecommerce": 0.12, "utilities": 0.10, "transport": 0.08,
        "fintech": 0.15, "healthcare": 0.07, "education": 0.08,
        "cooperative": 0.02, "government": 0.05, "insurance": 0.05,
    },
    "semi_urban": {
        "food_delivery": 0.04, "restaurant": 0.06, "grocery": 0.14,
        "ecommerce": 0.08, "utilities": 0.15, "transport": 0.08,
        "fintech": 0.14, "healthcare": 0.09, "education": 0.09,
        "cooperative": 0.06, "government": 0.05, "insurance": 0.02,
    },
    "rural": {
        "food_delivery": 0.01, "restaurant": 0.02, "grocery": 0.18,
        "ecommerce": 0.04, "utilities": 0.20, "transport": 0.07,
        "fintech": 0.12, "healthcare": 0.10, "education": 0.08,
        "cooperative": 0.12, "government": 0.04, "insurance": 0.02,
    },
}

# ─────────────────────────────────────────────────────────────
# NRB-compliant loan products
# ─────────────────────────────────────────────────────────────

NRB_LOAN_PRODUCTS = [
    {
        "type": "home_loan",
        "label": "Home / Real Estate Loan",
        "min_rate": 8.5,
        "max_rate": 12.0,
        "max_tenure_months": 240,
        "collateral_required": True,
        "max_ltv": 0.60,
    },
    {
        "type": "business_loan",
        "label": "Business / SME Loan",
        "min_rate": 11.0,
        "max_rate": 14.0,
        "max_tenure_months": 84,
        "collateral_required": True,
        "max_ltv": 0.70,
    },
    {
        "type": "personal_loan",
        "label": "Personal / Consumer Loan",
        "min_rate": 14.0,
        "max_rate": 18.0,
        "max_tenure_months": 60,
        "collateral_required": False,
        "max_ltv": None,
    },
    {
        "type": "microfinance",
        "label": "Microfinance / Group Loan",
        "min_rate": 18.0,
        "max_rate": 22.0,
        "max_tenure_months": 36,
        "collateral_required": False,
        "max_ltv": None,
    },
    {
        "type": "agricultural",
        "label": "Agricultural / Farm Loan",
        "min_rate": 7.0,
        "max_rate": 9.0,
        "max_tenure_months": 120,
        "collateral_required": True,
        "max_ltv": 0.50,
    },
    {
        "type": "hire_purchase",
        "label": "Hire Purchase / Vehicle Loan",
        "min_rate": 12.0,
        "max_rate": 15.0,
        "max_tenure_months": 60,
        "collateral_required": True,
        "max_ltv": 0.80,
    },
    {
        "type": "education_loan",
        "label": "Education / Student Loan",
        "min_rate": 9.0,
        "max_rate": 13.0,
        "max_tenure_months": 84,
        "collateral_required": False,
        "max_ltv": None,
    },
]

# Loan product weights per branch type
LOAN_PRODUCT_WEIGHTS_BY_TYPE = {
    "urban":      [0.30, 0.25, 0.20, 0.05, 0.05, 0.10, 0.05],
    "semi_urban": [0.20, 0.25, 0.20, 0.10, 0.12, 0.08, 0.05],
    "rural":      [0.10, 0.15, 0.15, 0.30, 0.22, 0.05, 0.03],
}

# ─────────────────────────────────────────────────────────────
# Festival calendar
# ─────────────────────────────────────────────────────────────

# Keys are festival names; values are 1-indexed month numbers (Gregorian approximation)
NEPAL_FESTIVALS = {
    "Dashain":          [10],       # Ashwin/Kartik — October
    "Tihar":            [11],       # Kartik — November
    "Chhath":           [11],       # Kartik — November (Madhesh-heavy)
    "Holi":             [3],        # Falgun/Chaitra — March
    "Maghe_Sankranti":  [1],        # Magh — January
    "Teej":             [9],        # Bhadra — September
    "Buddha_Jayanti":   [5],        # Baishakh/Jestha — May
    "Indra_Jatra":      [9],        # Bhadra (Kathmandu-specific)
    "Losar":            [2],        # Magh/Falgun (Tamang/Sherpa) — February
    "Chhath_Spring":    [4],        # Chaitra — April (second Chhath)
}

# Spending multiplier applied to transaction amounts during festival months
FESTIVAL_SPEND_MULTIPLIER = {
    "urban":      1.6,
    "semi_urban": 1.9,
    "rural":      2.3,
}

# Which festivals are prominent by branch type
BRANCH_TYPE_FESTIVALS = {
    "urban":      ["Dashain", "Tihar", "Holi", "Buddha_Jayanti", "Indra_Jatra"],
    "semi_urban": ["Dashain", "Tihar", "Holi", "Maghe_Sankranti", "Teej"],
    "rural":      ["Dashain", "Tihar", "Chhath", "Maghe_Sankranti", "Holi", "Chhath_Spring"],
}

# ─────────────────────────────────────────────────────────────
# Generator functions
# ─────────────────────────────────────────────────────────────

def generate_nepali_name(branch: str, gender: Optional[str] = None, rng=None) -> dict:
    """
    Generate a realistic Nepali customer name appropriate for the branch region.
    Returns {full_name, first_name, last_name, gender}.
    """
    if rng is None:
        rng = random.Random()

    branch_type = BRANCH_TYPE_MAP.get(branch, "semi_urban")
    caste_weights = BRANCH_TYPE_CASTE_WEIGHTS[branch_type]
    castes = list(caste_weights.keys())
    weights = list(caste_weights.values())
    caste = rng.choices(castes, weights=weights, k=1)[0]

    last_name = rng.choice(NEPALI_SURNAMES[caste])

    if gender is None:
        gender = rng.choice(["male", "female"])

    if gender == "male":
        first_name = rng.choice(NEPALI_MALE_NAMES)
    else:
        first_name = rng.choice(NEPALI_FEMALE_NAMES)

    # Some names have middle names (Bahadur, Kumar, Prasad, Devi, Kumari)
    middle_male   = ["Bahadur", "Kumar", "Prasad", "Raj", "Man"]
    middle_female = ["Kumari", "Devi", "Maya", "Laxmi"]
    if rng.random() < 0.30:
        if gender == "male":
            mid = rng.choice(middle_male)
        else:
            mid = rng.choice(middle_female)
        full_name = f"{first_name} {mid} {last_name}"
    else:
        full_name = f"{first_name} {last_name}"

    return {
        "full_name":  full_name,
        "first_name": first_name,
        "last_name":  last_name,
        "gender":     gender,
    }


def generate_phone_number(branch: str, rng=None) -> str:
    """
    Generate a Nepali mobile phone number in international format.
    Format: +977-9XXXXXXXXX
    """
    if rng is None:
        rng = random.Random()

    branch_type = BRANCH_TYPE_MAP.get(branch, "semi_urban")
    weights_dict = BRANCH_PHONE_WEIGHTS[branch_type]

    operator = rng.choices(
        ["ntc", "ncell", "smart"],
        weights=[weights_dict["ntc"], weights_dict["ncell"], weights_dict["smart"]],
        k=1
    )[0]

    if operator == "ntc":
        prefix = rng.choice(NTC_PREFIXES)
    elif operator == "ncell":
        prefix = rng.choice(NCELL_PREFIXES)
    else:
        prefix = rng.choice(SMART_PREFIXES)

    suffix = "".join([str(rng.randint(0, 9)) for _ in range(7)])
    return f"+977-{prefix}{suffix}"


def generate_nid(district_code: Optional[int] = None, rng=None) -> str:
    """
    Generate a Nepal citizenship certificate number.
    Format: DD-WW-XXXXXX (district-ward-serial)
    """
    if rng is None:
        rng = random.Random()

    if district_code is None:
        district_code = rng.randint(1, 77)

    ward = rng.randint(1, 33)
    serial = rng.randint(100000, 999999)
    return f"{district_code:02d}-{ward:02d}-{serial}"


def generate_address(branch: str, rng=None) -> dict:
    """
    Generate a realistic Nepali address for a given branch city.
    Returns {ward_no, tole, municipality, district, province}.
    """
    if rng is None:
        rng = random.Random()

    branch_type = BRANCH_TYPE_MAP.get(branch, "semi_urban")
    province = BRANCH_PROVINCE.get(branch, "Bagmati")
    municipalities = BRANCH_MUNICIPALITIES.get(branch, [branch])
    municipality = rng.choice(municipalities)
    toles = TOLES_BY_TYPE[branch_type]
    tole = rng.choice(toles)
    ward_no = rng.randint(1, 33)

    return {
        "ward_no":      ward_no,
        "tole":         tole,
        "municipality": municipality,
        "district":     branch,
        "province":     province,
    }


def province_adjusted_income(base_income: float, branch: str) -> float:
    """
    Scale income by province's income index relative to national average.
    """
    province = BRANCH_PROVINCE.get(branch, "Bagmati")
    index = PROVINCE_INCOME_INDEX.get(province, 1.0)
    return base_income * index


def get_festival_months(branch: str) -> list[int]:
    """
    Return list of month numbers (1-indexed) that are peak spending months
    due to festivals for the given branch.
    """
    branch_type = BRANCH_TYPE_MAP.get(branch, "semi_urban")
    relevant_festivals = BRANCH_TYPE_FESTIVALS[branch_type]
    months = set()
    for fest in relevant_festivals:
        for m in NEPAL_FESTIVALS.get(fest, []):
            months.add(m)
    return sorted(months)


def get_festival_multiplier(branch: str) -> float:
    """Spending multiplier for peak/festival months."""
    branch_type = BRANCH_TYPE_MAP.get(branch, "semi_urban")
    return FESTIVAL_SPEND_MULTIPLIER[branch_type]


def get_merchant_for_category(category: str, rng=None) -> str:
    """Pick a random merchant from the given category."""
    if rng is None:
        rng = random.Random()
    merchants = MERCHANTS_BY_CATEGORY.get(category, ["Local Merchant"])
    return rng.choice(merchants)


def get_random_category(branch: str, rng=None) -> str:
    """Pick a transaction category appropriate for the branch type."""
    if rng is None:
        rng = random.Random()
    branch_type = BRANCH_TYPE_MAP.get(branch, "semi_urban")
    weights = CATEGORY_WEIGHTS_BY_TYPE[branch_type]
    categories = list(weights.keys())
    probs = list(weights.values())
    return rng.choices(categories, weights=probs, k=1)[0]


def get_random_loan_product(branch: str, rng=None) -> dict:
    """Return a random NRB-compliant loan product appropriate for the branch."""
    if rng is None:
        rng = random.Random()
    branch_type = BRANCH_TYPE_MAP.get(branch, "semi_urban")
    weights = LOAN_PRODUCT_WEIGHTS_BY_TYPE[branch_type]
    idx = rng.choices(range(len(NRB_LOAN_PRODUCTS)), weights=weights, k=1)[0]
    return NRB_LOAN_PRODUCTS[idx]


def enrich_customer_row(row: dict, branch: str, rng=None) -> dict:
    """
    Given a customer row dict, add all Nepal-realistic fields in-place.
    Returns the same dict with new keys added.
    """
    if rng is None:
        rng = random.Random()

    # Gender from existing column if present, else generate
    gender = row.get("gender", None)
    if isinstance(gender, str) and gender.lower() in ("male", "female"):
        gender = gender.lower()
    else:
        gender = rng.choice(["male", "female"])

    name_data = generate_nepali_name(branch, gender=gender, rng=rng)
    row["full_name"]  = name_data["full_name"]
    row["first_name"] = name_data["first_name"]
    row["last_name"]  = name_data["last_name"]
    row["gender"]     = name_data["gender"]

    row["phone"] = generate_phone_number(branch, rng=rng)

    district_code = BRANCH_DISTRICT_CODE.get(branch, 27)
    row["nid"] = generate_nid(district_code=district_code, rng=rng)

    addr = generate_address(branch, rng=rng)
    row["ward_no"]      = addr["ward_no"]
    row["tole"]         = addr["tole"]
    row["municipality"] = addr["municipality"]
    row["district"]     = addr["district"]
    row["province"]     = addr["province"]

    loan = get_random_loan_product(branch, rng=rng)
    row["primary_loan_type"]         = loan["type"]
    row["primary_loan_label"]        = loan["label"]
    row["loan_min_rate_pct"]         = loan["min_rate"]
    row["loan_max_rate_pct"]         = loan["max_rate"]
    row["loan_max_tenure_months"]    = loan["max_tenure_months"]
    row["loan_collateral_required"]  = loan["collateral_required"]

    return row
