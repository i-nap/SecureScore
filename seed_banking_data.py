"""
seed_banking_data.py — Populate securescore.db with realistic demo banking data.

Creates:
  - 5,000 customer profiles spread across 3 branches
  - 1-3 accounts per customer  (~9,000 accounts)
  - 5-25 transactions per account  (~100,000+ transactions)
  - Fixed deposits for ~30% of customers (~1,500 FDs)
  - Account applications, KYC records, EOD logs

Run once:  python seed_banking_data.py
Safe to re-run (skips if already seeded).
"""

import sqlite3
import uuid
import random
import hashlib
import os
import datetime
import math

DB_PATH = os.path.join(os.path.dirname(__file__), "securescore.db")

# ── Nepali name pools ────────────────────────────────────────────────────────

FIRST_M = [
    "Aarav","Aakash","Abhishek","Aditya","Ajay","Anil","Arjun","Arun","Ashish","Ashok",
    "Avash","Ayush","Baburam","Bahadur","Bibek","Bijay","Bikram","Bimal","Binay","Binod",
    "Bishnu","Chiranjibi","Dawa","Deep","Deepak","Dev","Dhan","Dhiraj","Dipesh","Durga",
    "Ganesh","Gaurav","Hari","Hemraj","Indra","Ishwor","Jeevan","Kamal","Kiran","Krishna",
    "Kumar","Lalit","Laxman","Laxmi","Madan","Mahesh","Manoj","Milan","Nabin","Naresh",
    "Narayan","Niraj","Nischal","Nitesh","Om","Pawan","Prabhat","Prabin","Pradip","Pramod",
    "Pranav","Prashant","Pratik","Prem","Rabindra","Rajesh","Ramesh","Ranjan","Ravi","Rohit",
    "Roshan","Sachin","Sagar","Samir","Sanjay","Santosh","Saroj","Saurav","Shiva","Shyam",
    "Siddharth","Simanta","Sujan","Suresh","Sushil","Tilak","Umesh","Vivek","Yam","Yogesh",
]
FIRST_F = [
    "Aasha","Alka","Anita","Anjali","Anju","Anushka","Archana","Asha","Ashmita","Binita",
    "Bishnu","Deepa","Devi","Dipika","Ganga","Geeta","Gita","Kabita","Kamala","Kanchan",
    "Kavita","Kopila","Krishna","Kumari","Laxmi","Mamata","Manisha","Maya","Mina","Nirmala",
    "Nisha","Nita","Parbati","Parisa","Poonam","Pooja","Pratima","Priya","Punam","Radha",
    "Radhika","Ranjana","Reena","Rita","Rojina","Rupa","Sabina","Sadhana","Sagun","Sanju",
    "Sapana","Saraswati","Sarmila","Sarita","Shanta","Sharmila","Shraddha","Shreya","Sita","Smriti",
    "Sobha","Sofia","Srijana","Subha","Sunita","Sushma","Sweta","Tara","Uma","Usha",
]
LAST = [
    "Thapa","Sharma","Gurung","Tamang","Rai","Limbu","Magar","Newar","Sherpa","Karki",
    "Basnet","Bhattarai","Khadka","Adhikari","Oli","Poudel","Gautam","Acharya","Dhakal","Koirala",
    "Regmi","Upreti","Parajuli","Subedi","Pokhrel","Devkota","Giri","Joshi","Kafle","Rijal",
    "Shrestha","Pradhan","Maharjan","Dangol","Manandhar","Bajracharya","Lama","Bista","Chand","Shah",
    "Sah","Yadav","Chaudhary","Mahato","Mandal","Tharu","Musahar","Danuwar","Rajbanshi","Santhal",
    "KC","GC","DC","BC","Pandey","Tiwari","Mishra","Tripathi","Chhetri","Rana",
]
OCCUPATIONS = [
    "Farmer","Teacher","Shopkeeper","Trader","Government Employee","Engineer","Doctor","Nurse",
    "Accountant","Driver","Laborer","Business Owner","Bank Employee","Contractor","Electrician",
    "Plumber","Mechanic","Police Officer","Army Officer","Journalist","Photographer","Chef",
    "Hotel Staff","Tour Guide","IT Professional","Software Developer","Lecturer","Professor",
    "NGO Worker","Social Worker","Retail Employee","Garment Worker","Carpenter","Tailor",
    "Painter","Welder","Brick Layer","Security Guard","Receptionist","Sales Person",
]
DISTRICTS = [
    "Kathmandu","Lalitpur","Bhaktapur","Kavre","Sindhupalchok","Nuwakot","Rasuwa",
    "Pokhara","Kaski","Gorkha","Lamjung","Syangja","Tanahun","Parbat",
    "Sarlahi","Mahottari","Dhanusha","Siraha","Saptari","Parsa","Bara",
    "Chitwan","Nawalpur","Makwanpur","Rautahat","Rupandehi","Palpa","Arghakhanchi",
    "Sunsari","Morang","Jhapa","Ilam","Taplejung","Solukhumbu","Khotang",
    "Humla","Jumla","Dolpa","Mugu","Kalikot","Darchula","Baitadi",
]
PROVINCES = [
    "Koshi Province","Madhesh Province","Bagmati Province",
    "Gandaki Province","Lumbini Province","Karnali Province","Sudurpashchim Province",
]
TX_TYPES = ["TRANSFER","DEPOSIT","WITHDRAWAL","REMITTANCE","FEE"]
TX_DESC = {
    "TRANSFER":    ["Online fund transfer","Mobile banking transfer","RTGS transfer","Fund transfer"],
    "DEPOSIT":     ["Cash deposit","Salary credit","Remittance received","Interest credit","Government transfer"],
    "WITHDRAWAL":  ["ATM withdrawal","Cash withdrawal","Counter withdrawal"],
    "REMITTANCE":  ["Western Union","IME Remittance","Himal Remittance","Prabhu Money","MoneyGram"],
    "FEE":         ["Annual fee charge","SMS charge","Cheque book fee","Maintenance fee"],
}
CHANNELS = ["online","atm","branch","mobile","imps"]

BRANCHES = ["kathmandu","pokhara","sarlahi"]
BRANCH_WEIGHTS = [0.5, 0.3, 0.2]

def uid(): return str(uuid.uuid4())
def accnum(): return f"NB{random.randint(10000000000000, 99999999999999)}"
def txref(): return f"TXN{random.randint(100000000000, 999999999999)}"
def fdnum(): return f"FD{random.randint(1000000000, 9999999999)}"
def custid(n): return f"CUST{100100 + n}"
def pw_hash(pw):
    salt = uuid.uuid4().hex[:16]
    h = hashlib.sha256((salt + pw).encode()).hexdigest()
    return f"{salt}${h}"
def randate(days_back_min=0, days_back_max=730):
    d = random.randint(days_back_min, days_back_max)
    return (datetime.datetime.now() - datetime.timedelta(days=d)).strftime("%Y-%m-%d %H:%M:%S")
def randob():
    year = random.randint(1960, 2000)
    month = random.randint(1, 12)
    day = random.randint(1, 28)
    return f"{year}-{month:02d}-{day:02d}"
def nat_id(n): return f"NID{1000000 + n:07d}"
def uname(first, last, n):
    base = (first[:3] + last[:4]).lower().replace(" ","")
    return f"{base}{n}"

def main():
    if not os.path.exists(DB_PATH):
        print(f"ERROR: {DB_PATH} not found. Run start.py first to initialize the DB.")
        return

    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA foreign_keys=OFF")
    cur = conn.cursor()

    # Check if already seeded
    cur.execute("SELECT COUNT(*) FROM user_profiles WHERE role='customer'")
    existing = cur.fetchone()[0]
    if existing >= 1000:
        print(f"Already seeded: {existing} customer profiles found. Skipping.")
        conn.close()
        return
    print(f"Starting seed (existing profiles: {existing})...")

    # Ensure accounts table has account_status column
    try:
        cur.execute("ALTER TABLE accounts ADD COLUMN account_status TEXT DEFAULT 'active'")
    except Exception:
        pass
    try:
        cur.execute("ALTER TABLE accounts ADD COLUMN minimum_balance REAL DEFAULT 1000.0")
    except Exception:
        pass

    N_CUSTOMERS = 5000
    FD_RATE_MAP = {3: 6.5, 6: 7.0, 12: 8.0, 24: 8.5, 36: 9.0, 60: 9.5}
    ACC_INTEREST = {"savings": 5.0, "current": 0.0, "salary": 4.5}
    ACC_MIN_BAL  = {"savings": 1000.0, "current": 0.0, "salary": 0.0}

    profiles, accounts, transactions, fds, apps = [], [], [], [], []

    print(f"Generating {N_CUSTOMERS} customers...")
    used_usernames = set()
    used_nids = set()

    for i in range(N_CUSTOMERS):
        gender = random.choice(["Male","Female","Male","Male"])  # slight male skew
        first = random.choice(FIRST_M if gender != "Female" else FIRST_F)
        last  = random.choice(LAST)
        full_name = f"{first} {last}"
        cid = custid(i)
        branch = random.choices(BRANCHES, weights=BRANCH_WEIGHTS)[0]
        dist = random.choice(DISTRICTS)
        prov = random.choice(PROVINCES)
        occ  = random.choice(OCCUPATIONS)
        income = round(random.choice([
            random.uniform(15000, 25000),  # low
            random.uniform(25000, 60000),  # mid
            random.uniform(60000, 200000), # high
        ]), -2)

        un = uname(first, last, i)
        while un in used_usernames:
            un = un + str(random.randint(1,9))
        used_usernames.add(un)

        nid = nat_id(i)
        while nid in used_nids:
            nid = nat_id(i + random.randint(10000, 99999))
        used_nids.add(nid)

        profiles.append((
            uid(), cid, full_name, randob(), gender, "Nepali",
            nid, None, random.choice([
                f"Ward {random.randint(1,32)}, {dist}",
                f"{random.randint(1,15)}-{random.randint(100,999)} {dist}",
                f"Tole {random.randint(1,10)}, {dist}",
            ]),
            dist, prov, occ, income,
            un, pw_hash("customer123"), "customer", 1,
            randate(0, 30), randate(180, 1000),
        ))

        # 1-3 accounts per customer
        n_accounts = random.choices([1, 2, 3], weights=[0.4, 0.45, 0.15])[0]
        acc_types_pool = list({"savings"} | ({"current"} if n_accounts > 1 else set()) | ({"salary"} if n_accounts > 2 else set()))
        acc_types = random.sample(["savings","current","salary"], min(n_accounts, 3))
        if not acc_types: acc_types = ["savings"]

        cust_acc_ids = []
        for acc_type in acc_types:
            balance = round(random.choices([
                random.uniform(1000, 15000),
                random.uniform(15000, 150000),
                random.uniform(150000, 1000000),
                random.uniform(1000000, 5000000),
            ], weights=[0.35, 0.40, 0.20, 0.05])[0], 2)
            acc_id = uid()
            acc_num = accnum()
            opened = randate(30, 1500)
            accounts.append((
                acc_id, acc_num, cid, branch, acc_type,
                balance, "NPR", 1,
                ACC_INTEREST.get(acc_type, 5.0),
                ACC_MIN_BAL.get(acc_type, 1000.0),
                opened, "active",
            ))
            cust_acc_ids.append((acc_id, acc_num, balance, branch, acc_type))

            # Transactions for this account
            n_tx = random.randint(5, 25)
            running_bal = balance
            for _ in range(n_tx):
                tx_type = random.choices(TX_TYPES, weights=[30,35,25,8,2])[0]
                amt = round(random.choices([
                    random.uniform(500, 5000),
                    random.uniform(5000, 50000),
                    random.uniform(50000, 200000),
                ], weights=[0.60, 0.35, 0.05])[0], 2)
                amt = min(amt, max(100, running_bal * 0.9)) if tx_type in ("WITHDRAWAL","TRANSFER") else amt
                desc = random.choice(TX_DESC.get(tx_type, ["Transaction"]))
                is_debit = tx_type in ("WITHDRAWAL","TRANSFER","FEE")
                if is_debit:
                    running_bal = max(0, running_bal - amt)
                else:
                    running_bal += amt
                transactions.append((
                    uid(), txref(),
                    acc_id if is_debit else None,
                    None if is_debit else acc_id,
                    acc_num if is_debit else None,
                    None if is_debit else acc_num,
                    amt, "NPR", tx_type, desc, "COMPLETED",
                    round(running_bal, 2), 0.0, cid,
                    random.choice(CHANNELS), branch,
                    randate(0, 700),
                ))

        # FD for ~30% of customers (savings account needed)
        sav_accs = [(a,n,b,br,t) for a,n,b,br,t in cust_acc_ids if t == "savings" and b > 5000]
        if sav_accs and random.random() < 0.30:
            acc_id, acc_num, bal, br, _ = random.choice(sav_accs)
            tenure = random.choice([3, 6, 12, 24, 36, 60])
            rate = FD_RATE_MAP[tenure]
            principal = round(random.uniform(5000, min(bal * 0.7, 500000)), -2)
            if principal >= 1000:
                interest = principal * (rate / 100) * (tenure / 12)
                maturity_amt = round(principal + interest, 2)
                opened_dt = datetime.datetime.now() - datetime.timedelta(days=random.randint(0, 400))
                maturity_dt = opened_dt + datetime.timedelta(days=tenure * 30)
                status = "MATURED" if maturity_dt < datetime.datetime.now() else "ACTIVE"
                fds.append((
                    uid(), fdnum(), cid, acc_id, br,
                    principal, rate, tenure,
                    maturity_dt.strftime("%Y-%m-%d %H:%M:%S"),
                    maturity_amt, status, 0,
                    opened_dt.strftime("%Y-%m-%d %H:%M:%S"), 0.0,
                ))

        # Account application for ~20% of customers
        if random.random() < 0.20:
            app_type = random.choice(["savings","current","salary"])
            app_status = random.choices(["pending","approved","rejected"], weights=[0.5,0.35,0.15])[0]
            apps.append((
                cid, branch, app_type,
                random.choice(["Personal savings","Business use","Salary account","Emergency fund","Investment"]),
                round(random.uniform(0, 50000), -2),
                app_status,
                randate(0, 90),
            ))

        if (i + 1) % 500 == 0:
            print(f"  Generated {i+1}/{N_CUSTOMERS} customers...")

    # ── Batch insert ─────────────────────────────────────────────────────────
    print("Inserting user profiles...")
    cur.executemany("""
        INSERT OR IGNORE INTO user_profiles
          (id,customer_id,full_name,date_of_birth,gender,nationality,national_id,pan_number,
           address,district,province,occupation,annual_income,username,password_hash,role,
           is_active,last_login,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    """, profiles)

    print("Inserting accounts...")
    cur.executemany("""
        INSERT OR IGNORE INTO accounts
          (id,account_number,customer_id,branch_id,account_type,balance,currency,is_active,
           interest_rate,minimum_balance,opened_at,account_status)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    """, accounts)

    print(f"Inserting {len(transactions)} transactions...")
    CHUNK = 5000
    for start in range(0, len(transactions), CHUNK):
        cur.executemany("""
            INSERT OR IGNORE INTO transactions
              (id,reference_number,from_account_id,to_account_id,from_account_number,
               to_account_number,amount,currency,transaction_type,description,status,
               balance_after,fee,initiated_by,channel,branch_id,created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, transactions[start:start+CHUNK])
        conn.commit()
        print(f"  Transactions: {min(start+CHUNK, len(transactions))}/{len(transactions)}")

    print(f"Inserting {len(fds)} fixed deposits...")
    cur.executemany("""
        INSERT OR IGNORE INTO fixed_deposits
          (id,fd_number,customer_id,account_id,branch_id,principal,interest_rate,
           tenure_months,maturity_date,maturity_amount,status,auto_renew,opened_at,penalty_applied)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    """, fds)

    print(f"Inserting {len(apps)} account applications...")
    cur.executemany("""
        INSERT OR IGNORE INTO account_applications
          (customer_id,branch_id,account_type,purpose,initial_deposit,status,created_at)
        VALUES (?,?,?,?,?,?,?)
    """, apps)

    # Add a few EOD log entries to show history
    eod_logs = []
    for d in range(1, 8):
        dt = (datetime.datetime.now() - datetime.timedelta(days=d)).strftime("%Y-%m-%d %H:%M:%S")
        for br in BRANCHES:
            eod_logs.append((
                "EOD", "admin", br,
                random.randint(50, 300), round(random.uniform(5000, 80000), 2),
                random.randint(0, 5), random.randint(0, 3), round(random.uniform(0, 200000), 2),
                "success", dt, dt,
            ))
    cur.executemany("""
        INSERT OR IGNORE INTO eod_logs
          (process_type,run_by,branch_id,interest_posted_count,interest_posted_total,
           dormant_marked_count,fd_matured_count,fd_matured_total,status,started_at,completed_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)
    """, eod_logs)

    conn.commit()
    conn.close()

    print("=" * 50)
    print("  Seed complete!")
    print("=" * 50)
    print(f"  Customer profiles : {len(profiles)}")
    print(f"  Accounts          : {len(accounts)}")
    print(f"  Transactions      : {len(transactions)}")
    print(f"  Fixed Deposits    : {len(fds)}")
    print(f"  Applications      : {len(apps)}")
    print(f"  EOD log entries   : {len(eod_logs)}")
    print("=" * 50)
    print("Restart start.py / bff_gateway.exe for changes to take effect.")

if __name__ == "__main__":
    main()
