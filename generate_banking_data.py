"""
generate_banking_data.py
========================
Seeds the banking tables (UserProfile, Account, Transaction, FixedDeposit)
with realistic Nepali demo data so the UI has something to show.

Usage:
    python generate_banking_data.py [--customers 50]

The script is idempotent — running it twice does NOT duplicate records
(it checks for existing usernames before inserting).
"""

from __future__ import annotations

import argparse
import hashlib
import os
import random
import string
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

# ── Add project root to path ──────────────────────────────
sys.path.insert(0, str(Path(__file__).resolve().parent))
os.environ.setdefault("HQ_BRANCH_API_KEY", "test-key")

from db.models import (
    init_db, get_session,
    Customer, Branch,
    UserProfile, Account, Transaction, FixedDeposit,
)
from generate_realistic_nepal import (
    generate_nepali_name, generate_phone_number, generate_address,
    generate_nid, BRANCH_DISTRICT_CODE, BRANCH_PROVINCE,
)

# ── Constants ─────────────────────────────────────────────
BRANCHES = ["Kathmandu", "Pokhara", "Sarlahi", "Butwal", "Dhangadhi"]
ACCOUNT_TYPES = ["savings", "savings", "savings", "current", "salary"]
FD_RATES = {3: 6.5, 6: 7.0, 12: 8.0, 24: 8.5, 36: 9.0, 60: 9.5}
FD_TENURES = [3, 6, 12, 24, 36, 60]
TX_TYPES = ["TRANSFER", "DEPOSIT", "WITHDRAWAL", "REMITTANCE", "FEE"]
CHANNELS = ["online", "atm", "branch", "mobile"]

RNG = random.Random(42)


def _uuid() -> str:
    import uuid
    return str(uuid.uuid4())


def _account_number() -> str:
    return f"NB{RNG.randint(10000000000000, 99999999999999)}"


def _fd_number() -> str:
    return "FD" + "".join(RNG.choices(string.digits, k=10))


def _tx_ref() -> str:
    return "TXN" + "".join(RNG.choices(string.digits, k=12))


def _hash_password(pw: str) -> str:
    salt = "".join(RNG.choices(string.hexdigits, k=16))
    h = hashlib.sha256((salt + pw).encode()).hexdigest()
    return f"{salt}${h}"


def _rand_dt(days_back: int = 365) -> datetime:
    delta = timedelta(
        days=RNG.randint(0, days_back),
        hours=RNG.randint(0, 23),
        minutes=RNG.randint(0, 59),
    )
    return datetime.now(timezone.utc) - delta


def _income_for_branch(branch: str) -> float:
    base = {
        "Kathmandu": 80_000, "Pokhara": 55_000, "Sarlahi": 35_000,
        "Butwal": 45_000, "Dhangadhi": 30_000,
    }.get(branch, 40_000)
    return round(base * RNG.uniform(0.5, 2.5), -2)


def seed_branch(db, branch_name: str) -> Branch:
    b = db.query(Branch).filter(Branch.name == branch_name).first()
    if not b:
        b = Branch(name=branch_name, branch_type="urban", is_active=True)
        db.add(b)
        db.commit()
        db.refresh(b)
    return b


def generate_customer(db, branch: Branch, idx: int) -> tuple[Customer, UserProfile, list[Account]]:
    gender = RNG.choice(["male", "female"])
    name_data = generate_nepali_name(branch.name, gender=gender, rng=RNG)
    addr = generate_address(branch.name, rng=RNG)
    district_code = BRANCH_DISTRICT_CODE.get(branch.name, 27)
    nid = generate_nid(district_code=district_code, rng=RNG)
    phone = generate_phone_number(branch.name, rng=RNG)
    province = BRANCH_PROVINCE.get(branch.name, "Bagmati")
    income = _income_for_branch(branch.name)
    username = f"{name_data['first_name'].lower()}.{name_data['last_name'].lower()}{idx}"

    # Check for duplicate username
    if db.query(UserProfile).filter(UserProfile.username == username).first():
        username = username + str(RNG.randint(10, 99))

    cid = _uuid()
    customer = Customer(
        id=cid,
        branch_id=branch.name,
        phone_number=phone,
        email=f"{username}@example.com",
    )
    db.add(customer)

    profile = UserProfile(
        customer_id=cid,
        full_name=name_data["full_name"],
        date_of_birth=f"{RNG.randint(1970, 2000)}-{RNG.randint(1,12):02d}-{RNG.randint(1,28):02d}",
        gender=gender,
        nationality="Nepali",
        national_id=nid,
        address=f"Ward {addr['ward_no']}, {addr['tole']}",
        district=addr["district"],
        province=province,
        occupation=RNG.choice(["Government Employee", "Private Employee", "Business Owner", "Farmer", "Teacher", "Student"]),
        annual_income=income * 12,
        username=username,
        password_hash=_hash_password("Nepal@2024"),
        role="customer",
        is_active=True,
        last_login=_rand_dt(30),
        created_at=_rand_dt(730),
    )
    db.add(profile)

    # Create 1-3 accounts
    accounts = []
    n_accounts = RNG.randint(1, 3)
    used_types: set = set()
    for _ in range(n_accounts):
        acc_type = RNG.choice(ACCOUNT_TYPES)
        while acc_type in used_types:
            acc_type = RNG.choice(ACCOUNT_TYPES)
        used_types.add(acc_type)

        balance = round(RNG.uniform(5_000, 500_000), 2)
        acc = Account(
            account_number=_account_number(),
            customer_id=cid,
            branch_id=branch.name,
            account_type=acc_type,
            balance=balance,
            currency="NPR",
            is_active=True,
            interest_rate={"savings": 5.0, "current": 2.0, "salary": 3.5}.get(acc_type, 4.0),
            minimum_balance={"savings": 1000, "current": 5000, "salary": 500}.get(acc_type, 1000),
            opened_at=_rand_dt(700),
        )
        db.add(acc)
        accounts.append(acc)

    db.flush()  # ensure IDs are populated before FD generation
    return customer, profile, accounts


def generate_transactions(db, account: Account, n: int = 20) -> None:
    for _ in range(n):
        tx_type = RNG.choice(TX_TYPES)
        amount  = round(RNG.uniform(500, 150_000), 2)
        direction = RNG.choice(["debit", "credit"])
        created = _rand_dt(180)

        tx = Transaction(
            reference_number=_tx_ref(),
            from_account_id=account.id if direction == "debit" else None,
            to_account_id=account.id if direction == "credit" else None,
            from_account_number=account.account_number if direction == "debit" else f"NB{RNG.randint(10000000000000, 99999999999999)}",
            to_account_number=account.account_number if direction == "credit" else f"NB{RNG.randint(10000000000000, 99999999999999)}",
            amount=amount,
            fee=round(amount * 0.001, 2) if amount > 10_000 else 0,
            transaction_type=tx_type,
            description={
                "TRANSFER": "Online fund transfer",
                "DEPOSIT": "Cash deposit at branch",
                "WITHDRAWAL": "ATM cash withdrawal",
                "REMITTANCE": "Inward remittance",
                "FEE": "Service charge",
            }.get(tx_type, "Transaction"),
            status=RNG.choices(["COMPLETED", "COMPLETED", "COMPLETED", "FAILED"], weights=[85, 5, 5, 5])[0],
            balance_after=round(account.balance + RNG.uniform(-5000, 5000), 2),
            channel=RNG.choice(CHANNELS),
            branch_id=account.branch_id,
            created_at=created,
        )
        db.add(tx)


def generate_fds(db, customer_id: str, account: Account, n: int = 2) -> None:
    for _ in range(n):
        tenure = RNG.choice(FD_TENURES)
        rate   = FD_RATES[tenure]
        principal = round(RNG.choice([10_000, 25_000, 50_000, 1_00_000, 2_00_000, 5_00_000]), 2)
        interest   = principal * (rate / 100) * (tenure / 12)
        maturity_amount = round(principal + interest, 2)
        opened_at = _rand_dt(500)
        maturity_date = opened_at + timedelta(days=tenure * 30)
        status = "MATURED" if maturity_date < datetime.now(timezone.utc) else "ACTIVE"

        fd = FixedDeposit(
            fd_number=_fd_number(),
            customer_id=customer_id,
            account_id=account.id,
            branch_id=account.branch_id,
            principal=principal,
            interest_rate=rate,
            tenure_months=tenure,
            maturity_date=maturity_date,
            maturity_amount=maturity_amount,
            status=status,
            auto_renew=RNG.choice([True, False]),
            opened_at=opened_at,
            matured_at=maturity_date if status == "MATURED" else None,
        )
        db.add(fd)


def main(n_customers: int = 50):
    print("Initialising DB …")
    init_db()
    db = get_session()

    inserted = 0
    try:
        for branch_name in BRANCHES:
            branch = seed_branch(db, branch_name)
            per_branch = max(5, n_customers // len(BRANCHES))
            print(f"  Seeding {per_branch} customers for {branch_name} …")

            for i in range(per_branch):
                customer, profile, accounts = generate_customer(db, branch, i)
                for acc in accounts:
                    generate_transactions(db, acc, n=RNG.randint(10, 40))
                if accounts:
                    generate_fds(db, customer.id, accounts[0], n=RNG.randint(0, 3))
                inserted += 1

        db.commit()
        print(f"\nDone — {inserted} customers seeded across {len(BRANCHES)} branches.")
        print("Default password for all demo accounts: Nepal@2024")
        print("\nSearch demo:")
        # Print a few account numbers for demo
        accs = db.query(Account).limit(5).all()
        for a in accs:
            print(f"  Account: {a.account_number}  Customer: {a.customer_id}  Balance: NPR {a.balance:,.2f}")
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--customers", type=int, default=50, help="Total customers to seed")
    args = parser.parse_args()
    main(args.customers)
