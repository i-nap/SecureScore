package main

// Demo banking seed. The Go BFF keeps its own SQLite (go_bff/securescore.db),
// separate from the Python ORM DB, so the Python banking seed never reaches it.
// This makes each demo customer self-sufficient: one savings account plus ~6
// months of realistic transactions, so the real-ledger pages (spending insights,
// statements, notifications) are rich and live without any external seeding.
//
// Idempotent and non-destructive: an account is only created if the customer has
// none, and transactions are only seeded if that account has none — real usage is
// never overwritten. math/rand is fine here (demo data, not security-sensitive).

import (
	"fmt"
	"math"
	"math/rand"
	"time"
)

type demoCust struct {
	cid, branch, name string
	opening           float64
}

var demoCustomers = []demoCust{
	{"CUST100005", "kathmandu", "Aarav Thapa", 180000},
	{"CUST100004", "sarlahi", "Priya Yadav", 95000},
	{"CUST100002", "pokhara", "Bibek Magar", 140000},
}

type seedTxn struct {
	daysAgo int
	ttype   string
	desc    string
	channel string
	amount  float64
	credit  bool
}

func seedDemoBanking() {
	if !dbAvailable() {
		return
	}
	for _, dc := range demoCustomers {
		acctID := "acc_" + dc.cid
		acctNum := "0011" + dc.cid[len(dc.cid)-5:]
		var existing int
		db.QueryRow("SELECT COUNT(*) FROM accounts WHERE customer_id=?", dc.cid).Scan(&existing)
		if existing == 0 {
			db.Exec(`INSERT OR IGNORE INTO accounts (id,account_number,customer_id,branch_id,account_type,balance,interest_rate,minimum_balance)
				VALUES (?,?,?,?,'savings',?,5.0,1000)`, acctID, acctNum, dc.cid, dc.branch, dc.opening)
		} else {
			db.QueryRow("SELECT id,account_number FROM accounts WHERE customer_id=? ORDER BY opened_at LIMIT 1", dc.cid).
				Scan(&acctID, &acctNum)
		}

		// Profile row so /api/banking/profile resolves (bulk seed does this for synth customers).
		db.Exec(`INSERT OR IGNORE INTO user_profiles (id,customer_id,full_name,username,password_hash) VALUES (?,?,?,?,'')`,
			newUUID(), dc.cid, dc.name, dc.cid)

		seedDemoLoans(dc, acctID, acctNum) // own guard; a branch loan book + FD + pending items

		var txCount int
		db.QueryRow("SELECT COUNT(*) FROM transactions WHERE from_account_id=? OR to_account_id=?", acctID, acctID).Scan(&txCount)
		if txCount > 0 {
			continue // already has activity (seeded or real) — leave it alone
		}
		seedDemoTxns(dc, acctID, acctNum)
	}
}

func demoEMI(principal, annualRate float64, months int) float64 {
	r := annualRate / 12 / 100
	if r == 0 {
		return principal / float64(months)
	}
	pow := math.Pow(1+r, float64(months))
	return principal * r * pow / (pow - 1)
}

// seedDemoLoans gives each demo branch a small but believable loan book (with an
// overdue installment), a fixed deposit, and one pending account application +
// cheque request — so the branch copilot and loan portfolio show real numbers
// instead of zeros. Idempotent: skipped once the customer has any loan.
func seedDemoLoans(dc demoCust, acctID, acctNum string) {
	var existing int
	db.QueryRow("SELECT COUNT(*) FROM loans WHERE customer_id=?", dc.cid).Scan(&existing)
	if existing > 0 {
		return
	}
	rng := rand.New(rand.NewSource(int64(stableHash(dc.cid + "loans"))))

	type loanTmpl struct {
		ltype    string
		principal float64
		rate     float64
		tenure   int
		agedMon  int // months since disbursement (= paid installments)
		grade    string
	}
	loans := []loanTmpl{
		{"home", 2400000 + float64(rng.Intn(600000)), 9.5, 120, 9, "A"},
		{"vehicle", 850000 + float64(rng.Intn(300000)), 11.0, 60, 6, "B"},
		{"business", 1200000 + float64(rng.Intn(500000)), 12.5, 48, 4, "B"},
	}
	overdueLoanIdx := 1 // the vehicle loan carries one overdue installment

	for i, l := range loans {
		loanID := newUUID()
		lnNum := fmt.Sprintf("LN%s%02d", dc.cid[len(dc.cid)-4:], i)
		emi := math.Round(demoEMI(l.principal, l.rate, l.tenure))
		disbursedAt := time.Now().AddDate(0, -l.agedMon, 0)
		r := l.rate / 12 / 100
		bal := l.principal
		var paidPrincipal float64

		for n := 1; n <= l.tenure; n++ {
			interest := math.Round(bal * r)
			principalComp := emi - interest
			bal -= principalComp
			if bal < 0 {
				bal = 0
			}
			status := "PENDING"
			if n <= l.agedMon {
				if i == overdueLoanIdx && n == l.agedMon {
					status = "OVERDUE"
				} else {
					status = "PAID"
					paidPrincipal += principalComp
				}
			}
			due := disbursedAt.AddDate(0, n, 0).Format("2006-01-02")
			db.Exec(`INSERT INTO loan_schedule (loan_id,installment_no,due_date,emi,principal_component,interest_component,balance_after,status)
				VALUES (?,?,?,?,?,?,?,?)`,
				loanID, n, due, emi, math.Round(principalComp), interest, math.Round(bal), status)
		}

		outstanding := math.Round(l.principal - paidPrincipal)
		totalInterest := math.Round(emi*float64(l.tenure) - l.principal)
		db.Exec(`INSERT INTO loans (id,loan_number,customer_id,account_id,branch_id,loan_type,principal,interest_rate,tenure_months,emi,outstanding,purpose,collateral_value,has_guarantor,total_interest,risk_grade,status,disbursed_at)
			VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'ACTIVE',?)`,
			loanID, lnNum, dc.cid, acctID, dc.branch, l.ltype, l.principal, l.rate, l.tenure, emi, outstanding,
			l.ltype+" loan", math.Round(l.principal*1.3), 1, totalInterest, l.grade, disbursedAt.Format(time.RFC3339))
	}

	// One active fixed deposit.
	fdPrincipal := math.Round(150000 + float64(rng.Intn(150000)))
	fdRate, fdTenure := 8.5, 12
	opened := time.Now().AddDate(0, -2, 0)
	maturity := opened.AddDate(0, fdTenure, 0)
	maturityAmt := math.Round(fdPrincipal * (1 + fdRate/100*float64(fdTenure)/12))
	db.Exec(`INSERT INTO fixed_deposits (id,fd_number,customer_id,account_id,branch_id,principal,interest_rate,tenure_months,maturity_date,maturity_amount,status)
		VALUES (?,?,?,?,?,?,?,?,?,?,'ACTIVE')`,
		newUUID(), fmt.Sprintf("FD%s", dc.cid[len(dc.cid)-5:]), dc.cid, acctID, dc.branch,
		fdPrincipal, fdRate, fdTenure, maturity.Format(time.RFC3339), maturityAmt)

	// One pending account application + one cheque-book request, so those branch
	// queues aren't empty either.
	db.Exec(`INSERT INTO account_applications (customer_id,branch_id,account_type,purpose,initial_deposit,status)
		VALUES (?,?,'current','Business current account',50000,'pending')`, dc.cid, dc.branch)
	db.Exec(`INSERT INTO cheque_book_requests (id,customer_id,account_number,branch_id,leaves,status)
		VALUES (?,?,?,?,25,'REQUESTED')`, newUUID(), dc.cid, acctNum, dc.branch)

	// Link a MeroShare/CDS demat so the capital-markets page shows as linked and
	// IPO application works out of the box in the demo.
	boid := sixteenDigits()
	db.Exec(`INSERT OR IGNORE INTO demat_accounts (customer_id,boid,dp_id) VALUES (?,?,?)`,
		dc.cid, boid, "130"+boid[3:8])
}

var demoFirstNames = []string{
	"Aarav", "Priya", "Bibek", "Sita", "Ram", "Gita", "Hari", "Maya", "Nabin", "Sunita",
	"Rajesh", "Anjali", "Suresh", "Kamala", "Dipak", "Sarita", "Bishnu", "Rekha", "Krishna",
	"Laxmi", "Bikash", "Sabina", "Manoj", "Puja", "Prakash", "Nisha", "Gopal", "Sanjay",
}
var demoLastNames = []string{
	"Sharma", "Thapa", "Gurung", "Shrestha", "Yadav", "Magar", "Koirala", "Adhikari",
	"Rai", "Karki", "Bhattarai", "Tamang", "Poudel", "Khadka", "Basnet", "Lama",
}

// seedBulkPortfolio populates every branch with a realistic book — ~45 synthetic
// customers each with an account and a loan (~580 loans across 13 branches), a
// slice overdue, plus fixed deposits and recent transactions — so branch dashboards,
// the copilot, and HQ analytics show real figures instead of near-zero. Runs once
// (guarded by loan count) inside a single transaction for speed.
func seedBulkPortfolio() {
	if !dbAvailable() {
		return
	}
	var loanCount int
	db.QueryRow("SELECT COUNT(*) FROM loans").Scan(&loanCount)
	if loanCount >= 400 {
		return // already seeded
	}

	type loanKind struct {
		name   string
		rate   float64
		tenure int
		lo, hi int // principal range (in thousands)
	}
	kinds := []loanKind{
		{"home", 9.5, 120, 1500, 6000},
		{"vehicle", 11.0, 60, 500, 2500},
		{"business", 12.5, 48, 400, 3000},
		{"personal", 13.5, 36, 100, 800},
		{"education", 8.0, 84, 200, 2000},
		{"agriculture", 7.5, 60, 150, 1200},
	}
	grades := []string{"A", "A", "A", "B", "B", "B", "C", "C", "D"}

	branches := make([]string, 0, len(branchType))
	for b := range branchType {
		branches = append(branches, b)
	}

	tx, err := db.Begin()
	if err != nil {
		return
	}
	defer tx.Rollback()

	now := time.Now()
	for bi, branch := range branches {
		rng := rand.New(rand.NewSource(int64(stableHash("bulk-" + branch))))
		perBranch := 42 + rng.Intn(10) // 42–51 customers per branch
		for i := 0; i < perBranch; i++ {
			cid := fmt.Sprintf("CUSTB%02d%04d", bi, i)
			acctID := "acct_" + cid
			acctNum := fmt.Sprintf("02%02d%06d", bi, i)
			name := demoFirstNames[rng.Intn(len(demoFirstNames))] + " " + demoLastNames[rng.Intn(len(demoLastNames))]
			bal := math.Round(float64(20000 + rng.Intn(1800000)))

			tx.Exec(`INSERT OR IGNORE INTO accounts (id,account_number,customer_id,branch_id,account_type,balance,interest_rate,minimum_balance)
				VALUES (?,?,?,?,'savings',?,5.0,1000)`, acctID, acctNum, cid, branch, bal)
			tx.Exec(`INSERT OR IGNORE INTO user_profiles (id,customer_id,full_name,username,password_hash) VALUES (?,?,?,?,'')`, newUUID(), cid, name, cid)

			// 1–2 loans per customer.
			nLoans := 1
			if rng.Intn(100) < 20 {
				nLoans = 2
			}
			for li := 0; li < nLoans; li++ {
				k := kinds[rng.Intn(len(kinds))]
				principal := math.Round(float64((k.lo + rng.Intn(k.hi-k.lo)) * 1000))
				emi := math.Round(demoEMI(principal, k.rate, k.tenure))
				aged := 1 + rng.Intn(k.tenure/2)
				disbursedAt := now.AddDate(0, -aged, 0)
				// Outstanding = principal minus a paid-down fraction proportional to age.
				paidFrac := float64(aged) / float64(k.tenure) * (0.7 + rng.Float64()*0.3)
				if paidFrac > 0.95 {
					paidFrac = 0.95
				}
				outstanding := math.Round(principal * (1 - paidFrac))
				grade := grades[rng.Intn(len(grades))]
				loanID := newUUID()
				lnNum := fmt.Sprintf("LN%02d%04d%d", bi, i, li)
				tx.Exec(`INSERT INTO loans (id,loan_number,customer_id,account_id,branch_id,loan_type,principal,interest_rate,tenure_months,emi,outstanding,purpose,collateral_value,has_guarantor,total_interest,risk_grade,status,disbursed_at)
					VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'ACTIVE',?)`,
					loanID, lnNum, cid, acctID, branch, k.name, principal, k.rate, k.tenure, emi, outstanding,
					k.name+" loan", math.Round(principal*1.3), rng.Intn(2), math.Round(emi*float64(k.tenure)-principal),
					grade, disbursedAt.Format(time.RFC3339))

				// ~9% of loans carry one overdue installment.
				if rng.Intn(100) < 9 {
					due := now.AddDate(0, 0, -(10 + rng.Intn(40))).Format("2006-01-02")
					tx.Exec(`INSERT INTO loan_schedule (loan_id,installment_no,due_date,emi,principal_component,interest_component,balance_after,status)
						VALUES (?,?,?,?,?,?,?,'OVERDUE')`,
						loanID, aged+1, due, emi, math.Round(emi*0.6), math.Round(emi*0.4), outstanding)
				}
			}

			// ~30% hold a fixed deposit.
			if rng.Intn(100) < 30 {
				fdP := math.Round(float64(100000 + rng.Intn(900000)))
				opened := now.AddDate(0, -(1 + rng.Intn(10)), 0)
				tx.Exec(`INSERT INTO fixed_deposits (id,fd_number,customer_id,account_id,branch_id,principal,interest_rate,tenure_months,maturity_date,maturity_amount,status)
					VALUES (?,?,?,?,?,?,8.5,12,?,?,'ACTIVE')`,
					newUUID(), fmt.Sprintf("FDB%02d%04d", bi, i), cid, acctID, branch, fdP,
					opened.AddDate(0, 12, 0).Format(time.RFC3339), math.Round(fdP*1.085))
			}

			// A couple of recent transactions so 30-day branch volume is non-trivial.
			for t := 0; t < 2; t++ {
				amt := math.Round(float64(1000 + rng.Intn(40000)))
				daysAgo := rng.Intn(28)
				ts := now.AddDate(0, 0, -daysAgo).Format("2006-01-02 15:04:05")
				ttype, credit := "WITHDRAWAL", false
				if t%2 == 0 {
					ttype, credit = "DEPOSIT", true
				}
				ref := fmt.Sprintf("BULK-%s-%d", cid, t)
				if credit {
					tx.Exec(`INSERT OR IGNORE INTO transactions (id,reference_number,to_account_id,to_account_number,amount,transaction_type,description,status,balance_after,initiated_by,channel,branch_id,created_at)
						VALUES (?,?,?,?,?,?,'branch activity','COMPLETED',?,?,'branch',?,?)`,
						newUUID(), ref, acctID, acctNum, amt, ttype, bal, cid, branch, ts)
				} else {
					tx.Exec(`INSERT OR IGNORE INTO transactions (id,reference_number,from_account_id,from_account_number,amount,transaction_type,description,status,balance_after,initiated_by,channel,branch_id,created_at)
						VALUES (?,?,?,?,?,?,'branch activity','COMPLETED',?,?,'branch',?,?)`,
						newUUID(), ref, acctID, acctNum, amt, ttype, bal, cid, branch, ts)
				}
			}
		}
	}
	if err := tx.Commit(); err != nil {
		logf("[seed] bulk portfolio commit failed: %v", err)
		return
	}
	logf("[seed] bulk portfolio seeded across %d branches", len(branches))
}

func seedDemoTxns(dc demoCust, acctID, acctNum string) {
	rng := rand.New(rand.NewSource(int64(stableHash(dc.cid))))
	bills := []string{"NEA electricity bill", "Khanepani water bill", "WorldLink internet", "NTC mobile top-up"}
	merchants := []string{"Bhatbhateni Supermarket", "Himalayan Java Coffee", "Sastodeal order", "Bhat-Bhateni fuel", "Daraz purchase"}

	var txns []seedTxn
	for m := 5; m >= 0; m-- {
		monthStart := m * 30
		// Salary credit near the 1st of each month.
		txns = append(txns, seedTxn{monthStart + 28, "DEPOSIT", "Salary credit", "online", float64(45000 + rng.Intn(15000)), true})
		// Rent / family transfer out.
		txns = append(txns, seedTxn{monthStart + 24, "TRANSFER", "Rent transfer", "online", float64(12000 + rng.Intn(6000)), false})
		// Two utility bills.
		for i := 0; i < 2; i++ {
			txns = append(txns, seedTxn{monthStart + 20 - i*4, "BILL_PAYMENT", bills[rng.Intn(len(bills))], "online", float64(800 + rng.Intn(2500)), false})
		}
		// A few card purchases.
		for i := 0; i < 3; i++ {
			txns = append(txns, seedTxn{monthStart + 15 - i*5, "CARD_POS", merchants[rng.Intn(len(merchants))], "card", float64(600 + rng.Intn(4000)), false})
		}
		// One ATM withdrawal.
		txns = append(txns, seedTxn{monthStart + 8, "WITHDRAWAL", "ATM withdrawal", "atm", float64(5000 + rng.Intn(10000)), false})
	}

	// Oldest first so the running balance is chronological.
	for i := 0; i < len(txns); i++ {
		for j := i + 1; j < len(txns); j++ {
			if txns[j].daysAgo > txns[i].daysAgo {
				txns[i], txns[j] = txns[j], txns[i]
			}
		}
	}

	bal := dc.opening
	now := time.Now()
	for i, t := range txns {
		if t.credit {
			bal += t.amount
		} else {
			bal -= t.amount
		}
		ts := now.AddDate(0, 0, -t.daysAgo).Format("2006-01-02 15:04:05")
		ref := fmt.Sprintf("SEED-%s-%03d", dc.cid, i)
		if t.credit {
			db.Exec(`INSERT OR IGNORE INTO transactions (id,reference_number,to_account_id,to_account_number,amount,transaction_type,description,status,balance_after,initiated_by,channel,branch_id,created_at)
				VALUES (?,?,?,?,?,?,?,'COMPLETED',?,?,?,?,?)`,
				newUUID(), ref, acctID, acctNum, t.amount, t.ttype, t.desc, bal, dc.cid, t.channel, dc.branch, ts)
		} else {
			db.Exec(`INSERT OR IGNORE INTO transactions (id,reference_number,from_account_id,from_account_number,amount,transaction_type,description,status,balance_after,initiated_by,channel,branch_id,created_at)
				VALUES (?,?,?,?,?,?,?,'COMPLETED',?,?,?,?,?)`,
				newUUID(), ref, acctID, acctNum, t.amount, t.ttype, t.desc, bal, dc.cid, t.channel, dc.branch, ts)
		}
	}
	// Account balance reflects the final running balance.
	db.Exec("UPDATE accounts SET balance=? WHERE id=?", bal, acctID)

	// A couple of unread notifications so the bell is alive on first login.
	notify(dc.cid, "transfer", "Welcome back — your recent statement is ready to view.")
	if len(txns) > 0 {
		last := txns[len(txns)-1]
		notify(dc.cid, "card", fmt.Sprintf("Recent activity: %s · NPR %.0f", last.desc, last.amount))
	}
}
