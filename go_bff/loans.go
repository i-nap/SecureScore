package main

import (
	"database/sql"
	"fmt"
	"math"
	"math/rand"
	"time"

	"github.com/gin-gonic/gin"
)

// Annual interest rates per loan product (percent). Mirrors the branch
// Loan Assessment UI; the assessment grades risk, this services the loan.
var loanRates = map[string]float64{
	"home_loan":     10.0,
	"business_loan": 12.5,
	"personal_loan": 16.0,
	"microfinance":  20.0,
	"agricultural":  8.0,
}

func loanNumber() string {
	return fmt.Sprintf("LN%012d", rand.Int63n(1_000_000_000_000))
}

// assessLoan is the disbursement gate: an affordability + exposure check derived
// from the borrower's annual income (from their profile), the EMI, and the
// collateral / guarantor cover. Returns an A–F grade; grade F is declined.
// ponytail: rule-based gate, not the branch XGBoost model — the self-service
// form doesn't collect the full feature vector. Swap for branchLoanDefault if a
// manager-originated flow ever passes the full applicant data.
func assessLoan(principal, emi float64, annualIncome, collateral float64, guarantor bool) (grade, reason string, approved bool) {
	score := 100.0
	if annualIncome > 0 {
		dti := emi / (annualIncome / 12.0)
		switch {
		case dti > 0.6:
			score -= 55
		case dti > 0.45:
			score -= 35
		case dti > 0.3:
			score -= 15
		}
		exposure := principal / annualIncome
		switch {
		case exposure > 5:
			score -= 25
		case exposure > 3:
			score -= 12
		}
	} else {
		score -= 20 // unknown income — treat with caution
	}

	coverage := 0.0
	if principal > 0 {
		coverage = collateral / principal
	}
	if principal >= 1_000_000 && coverage < 0.5 && !guarantor {
		score -= 25
	}
	if guarantor {
		score += 5
	}
	if coverage >= 1 {
		score += 5
	}

	switch {
	case score >= 80:
		grade = "A"
	case score >= 65:
		grade = "B"
	case score >= 50:
		grade = "C"
	case score >= 35:
		grade = "D"
	default:
		grade = "F"
	}
	approved = grade != "F"
	if !approved {
		reason = fmt.Sprintf("Loan declined (risk grade %s): the EMI is too high for the income on file, or collateral is insufficient. Reduce the amount, extend the tenure, or add collateral / a guarantor.", grade)
	}
	return grade, reason, approved
}

type scheduleRow struct {
	No        int
	EMI       float64
	Principal float64
	Interest  float64
	Balance   float64 // outstanding principal after this installment
}

// amortize builds a reducing-balance EMI schedule. r==0 is handled (flat split).
// The final installment absorbs rounding so the schedule closes at exactly zero.
func amortize(principal, annualRate float64, n int) (emi float64, rows []scheduleRow) {
	r := annualRate / 12 / 100
	if r == 0 {
		emi = math_round(principal/float64(n), 2)
	} else {
		pow := math.Pow(1+r, float64(n))
		emi = math_round(principal*r*pow/(pow-1), 2)
	}
	bal := principal
	for i := 1; i <= n; i++ {
		interest := math_round(bal*r, 2)
		principalComp := math_round(emi-interest, 2)
		if i == n {
			// Last installment clears whatever balance remains.
			principalComp = math_round(bal, 2)
			emiLast := math_round(principalComp+interest, 2)
			rows = append(rows, scheduleRow{No: i, EMI: emiLast, Principal: principalComp, Interest: interest, Balance: 0})
			bal = 0
			break
		}
		bal = math_round(bal-principalComp, 2)
		rows = append(rows, scheduleRow{No: i, EMI: emi, Principal: principalComp, Interest: interest, Balance: bal})
	}
	return emi, rows
}

func handleLoanDisburse(c *gin.Context) {
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	var req struct {
		AccountNumber   string  `json:"account_number"`
		Principal       float64 `json:"principal"`
		TenureMonths    int     `json:"tenure_months"`
		LoanType        string  `json:"loan_type"`
		Purpose         string  `json:"purpose"`
		CollateralValue float64 `json:"collateral_value"`
		HasGuarantor    bool    `json:"has_guarantor"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"detail": "invalid request"})
		return
	}
	if req.Principal < 10000 {
		c.JSON(400, gin.H{"detail": "Minimum loan amount is NPR 10,000"})
		return
	}
	if req.TenureMonths < 3 || req.TenureMonths > 360 {
		c.JSON(400, gin.H{"detail": "Tenure must be between 3 and 360 months"})
		return
	}
	rate, ok := loanRates[req.LoanType]
	if !ok {
		c.JSON(400, gin.H{"detail": "loan_type must be one of: home_loan, business_loan, personal_loan, microfinance, agricultural"})
		return
	}
	claims := c.MustGet("claims").(map[string]interface{})
	cid := coalesce(claims["customer_id"], claims["sub"])
	role, _ := claims["role"].(string)

	tx, _ := db.Begin()
	defer tx.Rollback()

	var accID, accCid, accBranch sql.NullString
	var accBal sql.NullFloat64
	err := tx.QueryRow("SELECT id, customer_id, balance, branch_id FROM accounts WHERE account_number=?", req.AccountNumber).
		Scan(&accID, &accCid, &accBal, &accBranch)
	if err == sql.ErrNoRows {
		c.JSON(404, gin.H{"detail": "Disbursement account not found"})
		return
	}
	if role == "customer" && accCid.String != cid {
		c.JSON(403, gin.H{"detail": "Account does not belong to you"})
		return
	}
	borrowerID := accCid.String

	emi, rows := amortize(req.Principal, rate, req.TenureMonths)
	outstanding := 0.0
	totalInterest := 0.0
	for _, r := range rows {
		outstanding += r.EMI
		totalInterest += r.Interest
	}
	outstanding = math_round(outstanding, 2)
	totalInterest = math_round(totalInterest, 2)

	// Disbursement gate — affordability check against income on file.
	var annualIncome sql.NullFloat64
	tx.QueryRow("SELECT annual_income FROM user_profiles WHERE customer_id=?", borrowerID).Scan(&annualIncome)
	grade, declineReason, approved := assessLoan(req.Principal, emi, annualIncome.Float64, req.CollateralValue, req.HasGuarantor)
	if !approved {
		c.JSON(422, gin.H{"detail": declineReason, "risk_grade": grade, "emi": emi})
		return
	}

	loanID := newUUID()
	lnNum := loanNumber()
	disbursedAt := time.Now().UTC()
	guarantor := 0
	if req.HasGuarantor {
		guarantor = 1
	}

	// Credit the principal into the borrower's account.
	newBal := accBal.Float64 + req.Principal
	tx.Exec("UPDATE accounts SET balance=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", newBal, accID.String)

	tx.Exec(`INSERT INTO loans (id,loan_number,customer_id,account_id,branch_id,loan_type,principal,interest_rate,tenure_months,emi,outstanding,purpose,collateral_value,has_guarantor,total_interest,risk_grade,status,disbursed_at)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'ACTIVE',?)`,
		loanID, lnNum, borrowerID, accID.String, accBranch.String, req.LoanType,
		req.Principal, rate, req.TenureMonths, emi, outstanding,
		req.Purpose, req.CollateralValue, guarantor, totalInterest, grade, disbursedAt.Format(time.RFC3339))

	for _, r := range rows {
		due := disbursedAt.AddDate(0, r.No, 0).Format("2006-01-02")
		tx.Exec(`INSERT INTO loan_schedule (loan_id,installment_no,due_date,emi,principal_component,interest_component,balance_after,status)
			VALUES (?,?,?,?,?,?,?,'PENDING')`,
			loanID, r.No, due, r.EMI, r.Principal, r.Interest, r.Balance)
	}

	ref := txRef()
	tx.Exec(`INSERT INTO transactions (id,reference_number,to_account_id,to_account_number,amount,transaction_type,description,status,balance_after,initiated_by,channel,branch_id)
		VALUES (?,?,?,?,?,'LOAN_DISBURSE',?,'COMPLETED',?,?,?,?)`,
		newUUID(), ref, accID.String, req.AccountNumber, req.Principal,
		fmt.Sprintf("Loan %s disbursed — %s, %d months @ %.1f%%", lnNum, req.LoanType, req.TenureMonths, rate),
		newBal, cid, "online", accBranch.String)

	tx.Commit()

	c.JSON(200, gin.H{
		"status": "success", "loan_number": lnNum, "principal": req.Principal,
		"interest_rate": rate, "tenure_months": req.TenureMonths, "emi": emi,
		"total_payable": outstanding, "total_interest": totalInterest, "loan_type": req.LoanType,
		"risk_grade":            grade,
		"account_balance_after": math_round(newBal, 2),
		"reference_number":      ref,
		"message":               fmt.Sprintf("NPR %.2f disbursed. EMI NPR %.2f for %d months.", req.Principal, emi, req.TenureMonths),
	})
}

// handleLoanPrepay applies a lump sum toward the loan, clearing whole
// installments from the end of the schedule (shortening the tenure). It settles
// as many tail installments as the amount fully covers.
func handleLoanPrepay(c *gin.Context) {
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	lnNum := c.Param("loan_number")
	var req struct {
		Amount float64 `json:"amount"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.Amount <= 0 {
		c.JSON(400, gin.H{"detail": "amount must be positive"})
		return
	}
	claims := c.MustGet("claims").(map[string]interface{})
	cid := coalesce(claims["customer_id"], claims["sub"])
	role, _ := claims["role"].(string)

	tx, _ := db.Begin()
	defer tx.Rollback()

	var loanID, custID, accID, branchID, status sql.NullString
	var outstanding sql.NullFloat64
	err := tx.QueryRow(`SELECT id,customer_id,account_id,branch_id,outstanding,status FROM loans WHERE loan_number=?`, lnNum).
		Scan(&loanID, &custID, &accID, &branchID, &outstanding, &status)
	if err == sql.ErrNoRows {
		c.JSON(404, gin.H{"detail": "Loan not found"})
		return
	}
	if role == "customer" && custID.String != cid {
		c.JSON(403, gin.H{"detail": "Access denied"})
		return
	}
	if status.String != "ACTIVE" {
		c.JSON(400, gin.H{"detail": fmt.Sprintf("Loan is already %s", status.String)})
		return
	}

	// Clear whole installments from the end while the budget covers them.
	rows, _ := tx.Query(`SELECT installment_no,emi FROM loan_schedule WHERE loan_id=? AND status!='PAID' ORDER BY installment_no DESC`, loanID.String)
	type inst struct {
		no  int
		emi float64
	}
	var unpaid []inst
	for rows.Next() {
		var n int
		var e float64
		rows.Scan(&n, &e)
		unpaid = append(unpaid, inst{n, e})
	}
	rows.Close()

	settled := 0.0
	cleared := []int{}
	for _, u := range unpaid {
		if math_round(settled+u.emi, 2) > req.Amount {
			continue // can't fully cover this one; skip and try smaller tail ones
		}
		settled = math_round(settled+u.emi, 2)
		cleared = append(cleared, u.no)
	}
	if len(cleared) == 0 {
		c.JSON(400, gin.H{"detail": "Amount is too small to clear a full installment. Use a larger amount or pay a single EMI."})
		return
	}

	var accNum sql.NullString
	var accBal sql.NullFloat64
	tx.QueryRow("SELECT account_number,balance FROM accounts WHERE id=?", accID.String).Scan(&accNum, &accBal)
	if accBal.Float64 < settled {
		c.JSON(400, gin.H{"detail": fmt.Sprintf("Insufficient balance. Need NPR %.2f, available NPR %.2f", settled, accBal.Float64)})
		return
	}

	for _, n := range cleared {
		tx.Exec("UPDATE loan_schedule SET status='PAID', paid_at=CURRENT_TIMESTAMP WHERE loan_id=? AND installment_no=?", loanID.String, n)
	}
	newBal := math_round(accBal.Float64-settled, 2)
	newOutstanding := math_round(outstanding.Float64-settled, 2)
	if newOutstanding < 0 {
		newOutstanding = 0
	}
	tx.Exec("UPDATE accounts SET balance=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", newBal, accID.String)

	ref := txRef()
	tx.Exec(`INSERT INTO loan_payments (id,loan_id,installment_no,amount,reference_number) VALUES (?,?,-1,?,?)`,
		newUUID(), loanID.String, settled, ref)
	tx.Exec(`INSERT INTO transactions (id,reference_number,from_account_id,from_account_number,amount,transaction_type,description,status,balance_after,initiated_by,channel,branch_id)
		VALUES (?,?,?,?,?,'LOAN_PREPAY',?,'COMPLETED',?,?,?,?)`,
		newUUID(), ref, accID.String, accNum.String, settled,
		fmt.Sprintf("Loan %s prepayment — %d installment(s) cleared", lnNum, len(cleared)), newBal, cid, "online", branchID.String)

	var remaining int
	tx.QueryRow("SELECT COUNT(*) FROM loan_schedule WHERE loan_id=? AND status!='PAID'", loanID.String).Scan(&remaining)
	loanStatus := "ACTIVE"
	if remaining == 0 {
		loanStatus = "CLOSED"
		newOutstanding = 0
		tx.Exec("UPDATE loans SET outstanding=0, status='CLOSED', closed_at=CURRENT_TIMESTAMP WHERE id=?", loanID.String)
	} else {
		tx.Exec("UPDATE loans SET outstanding=? WHERE id=?", newOutstanding, loanID.String)
	}

	tx.Commit()
	c.JSON(200, gin.H{
		"status": "success", "loan_number": lnNum, "installments_cleared": len(cleared),
		"amount_settled": settled, "outstanding": newOutstanding, "loan_status": loanStatus,
		"account_balance_after": newBal, "reference_number": ref,
		"message": fmt.Sprintf("Prepaid NPR %.2f — %d installment(s) cleared, %d remaining.", settled, len(cleared), remaining),
	})
}

// handleLoanForeclose settles the entire remaining balance in one payment and
// closes the loan. The borrower saves the interest on the un-elapsed tenure.
func handleLoanForeclose(c *gin.Context) {
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	lnNum := c.Param("loan_number")
	claims := c.MustGet("claims").(map[string]interface{})
	cid := coalesce(claims["customer_id"], claims["sub"])
	role, _ := claims["role"].(string)

	tx, _ := db.Begin()
	defer tx.Rollback()

	var loanID, custID, accID, branchID, status sql.NullString
	var outstanding sql.NullFloat64
	err := tx.QueryRow(`SELECT id,customer_id,account_id,branch_id,outstanding,status FROM loans WHERE loan_number=?`, lnNum).
		Scan(&loanID, &custID, &accID, &branchID, &outstanding, &status)
	if err == sql.ErrNoRows {
		c.JSON(404, gin.H{"detail": "Loan not found"})
		return
	}
	if role == "customer" && custID.String != cid {
		c.JSON(403, gin.H{"detail": "Access denied"})
		return
	}
	if status.String != "ACTIVE" {
		c.JSON(400, gin.H{"detail": fmt.Sprintf("Loan is already %s", status.String)})
		return
	}

	// Settlement amount = remaining principal across unpaid installments (the
	// outstanding figure already excludes future interest beyond each EMI; for a
	// foreclosure the borrower clears the unpaid principal balance).
	var settlement sql.NullFloat64
	tx.QueryRow(`SELECT COALESCE(SUM(principal_component),0) FROM loan_schedule WHERE loan_id=? AND status!='PAID'`, loanID.String).Scan(&settlement)
	payoff := math_round(settlement.Float64, 2)
	if payoff <= 0 {
		payoff = math_round(outstanding.Float64, 2)
	}

	var accNum sql.NullString
	var accBal sql.NullFloat64
	tx.QueryRow("SELECT account_number,balance FROM accounts WHERE id=?", accID.String).Scan(&accNum, &accBal)
	if accBal.Float64 < payoff {
		c.JSON(400, gin.H{"detail": fmt.Sprintf("Insufficient balance to foreclose. Settlement NPR %.2f, available NPR %.2f", payoff, accBal.Float64)})
		return
	}

	newBal := math_round(accBal.Float64-payoff, 2)
	tx.Exec("UPDATE accounts SET balance=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", newBal, accID.String)
	tx.Exec("UPDATE loan_schedule SET status='PAID', paid_at=CURRENT_TIMESTAMP WHERE loan_id=? AND status!='PAID'", loanID.String)
	tx.Exec("UPDATE loans SET outstanding=0, status='CLOSED', closed_at=CURRENT_TIMESTAMP WHERE id=?", loanID.String)

	ref := txRef()
	tx.Exec(`INSERT INTO loan_payments (id,loan_id,installment_no,amount,reference_number) VALUES (?,?,0,?,?)`,
		newUUID(), loanID.String, payoff, ref)
	tx.Exec(`INSERT INTO transactions (id,reference_number,from_account_id,from_account_number,amount,transaction_type,description,status,balance_after,initiated_by,channel,branch_id)
		VALUES (?,?,?,?,?,'LOAN_FORECLOSE',?,'COMPLETED',?,?,?,?)`,
		newUUID(), ref, accID.String, accNum.String, payoff,
		fmt.Sprintf("Loan %s foreclosed", lnNum), newBal, cid, "online", branchID.String)

	tx.Commit()
	c.JSON(200, gin.H{
		"status": "success", "loan_number": lnNum, "settlement_amount": payoff,
		"loan_status": "CLOSED", "account_balance_after": newBal, "reference_number": ref,
		"message": fmt.Sprintf("Loan foreclosed. NPR %.2f settled, loan closed.", payoff),
	})
}

func handleLoanList(c *gin.Context) {
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	claims := c.MustGet("claims").(map[string]interface{})
	cid := coalesce(claims["customer_id"], claims["sub"])
	role, _ := claims["role"].(string)

	var q string
	var arg interface{}
	if role == "customer" {
		q = `SELECT l.id,l.loan_number,l.loan_type,l.principal,l.interest_rate,l.tenure_months,l.emi,l.outstanding,l.status,l.disbursed_at,
			(SELECT MIN(due_date) FROM loan_schedule s WHERE s.loan_id=l.id AND s.status!='PAID') AS next_due,
			(SELECT COUNT(*) FROM loan_schedule s WHERE s.loan_id=l.id AND s.status='PAID') AS paid_count,
			(SELECT COUNT(*) FROM loan_schedule s WHERE s.loan_id=l.id AND s.status='OVERDUE') AS overdue_count
			FROM loans l WHERE l.customer_id=? ORDER BY l.disbursed_at DESC`
		arg = cid
	} else {
		q = `SELECT l.id,l.loan_number,l.loan_type,l.principal,l.interest_rate,l.tenure_months,l.emi,l.outstanding,l.status,l.disbursed_at,
			(SELECT MIN(due_date) FROM loan_schedule s WHERE s.loan_id=l.id AND s.status!='PAID') AS next_due,
			(SELECT COUNT(*) FROM loan_schedule s WHERE s.loan_id=l.id AND s.status='PAID') AS paid_count,
			(SELECT COUNT(*) FROM loan_schedule s WHERE s.loan_id=l.id AND s.status='OVERDUE') AS overdue_count
			FROM loans l WHERE l.branch_id=? ORDER BY l.disbursed_at DESC`
		arg, _ = claims["branch_id"].(string)
	}

	rows, err := db.Query(q, arg)
	if err != nil {
		c.JSON(500, gin.H{"detail": err.Error()})
		return
	}
	defer rows.Close()
	loans := []map[string]interface{}{}
	for rows.Next() {
		var id, lnNum, lType, status, disbursedAt, nextDue sql.NullString
		var principal, rate, emi, outstanding sql.NullFloat64
		var tenure, paidCount, overdueCount sql.NullInt64
		rows.Scan(&id, &lnNum, &lType, &principal, &rate, &tenure, &emi, &outstanding, &status, &disbursedAt, &nextDue, &paidCount, &overdueCount)
		loans = append(loans, map[string]interface{}{
			"id": id.String, "loan_number": lnNum.String, "loan_type": lType.String,
			"principal": principal.Float64, "interest_rate": rate.Float64,
			"tenure_months": tenure.Int64, "emi": emi.Float64, "outstanding": outstanding.Float64,
			"status": status.String, "disbursed_at": disbursedAt.String,
			"next_due_date": nextDue.String, "paid_installments": paidCount.Int64,
			"overdue_installments": overdueCount.Int64,
		})
	}
	c.JSON(200, gin.H{"loans": loans})
}

func handleLoanDetail(c *gin.Context) {
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	lnNum := c.Param("loan_number")
	claims := c.MustGet("claims").(map[string]interface{})
	cid := coalesce(claims["customer_id"], claims["sub"])
	role, _ := claims["role"].(string)

	var id, custID, lType, status, disbursedAt, purpose sql.NullString
	var principal, rate, emi, outstanding, collateral, totalInterest sql.NullFloat64
	var tenure, guarantor sql.NullInt64
	err := db.QueryRow(`SELECT id,customer_id,loan_type,principal,interest_rate,tenure_months,emi,outstanding,purpose,collateral_value,has_guarantor,total_interest,status,disbursed_at FROM loans WHERE loan_number=?`, lnNum).
		Scan(&id, &custID, &lType, &principal, &rate, &tenure, &emi, &outstanding, &purpose, &collateral, &guarantor, &totalInterest, &status, &disbursedAt)
	if err == sql.ErrNoRows {
		c.JSON(404, gin.H{"detail": "Loan not found"})
		return
	}
	if role == "customer" && custID.String != cid {
		c.JSON(403, gin.H{"detail": "Access denied"})
		return
	}

	rows, _ := db.Query(`SELECT installment_no,due_date,emi,principal_component,interest_component,balance_after,status,paid_at FROM loan_schedule WHERE loan_id=? ORDER BY installment_no ASC`, id.String)
	defer rows.Close()
	schedule := []map[string]interface{}{}
	for rows.Next() {
		var no sql.NullInt64
		var due, sStatus, paidAt sql.NullString
		var sEmi, pComp, iComp, balAfter sql.NullFloat64
		rows.Scan(&no, &due, &sEmi, &pComp, &iComp, &balAfter, &sStatus, &paidAt)
		schedule = append(schedule, map[string]interface{}{
			"installment_no": no.Int64, "due_date": due.String, "emi": sEmi.Float64,
			"principal": pComp.Float64, "interest": iComp.Float64,
			"balance_after": balAfter.Float64, "status": sStatus.String, "paid_at": paidAt.String,
		})
	}

	c.JSON(200, gin.H{
		"loan_number": lnNum, "loan_type": lType.String, "principal": principal.Float64,
		"interest_rate": rate.Float64, "tenure_months": tenure.Int64, "emi": emi.Float64,
		"outstanding": outstanding.Float64, "status": status.String,
		"purpose": purpose.String, "collateral_value": collateral.Float64,
		"has_guarantor": guarantor.Int64 == 1, "total_interest": totalInterest.Float64,
		"disbursed_at": disbursedAt.String, "schedule": schedule,
	})
}

// handleLoanRepay pays the next outstanding installment (overdue first, then
// earliest pending) from the loan's linked account.
func handleLoanRepay(c *gin.Context) {
	if !dbAvailable() {
		c.JSON(503, gin.H{"detail": "Database not available"})
		return
	}
	lnNum := c.Param("loan_number")
	// Optional: pay a specific installment instead of the next due one.
	var body struct {
		InstallmentNo int `json:"installment_no"`
	}
	c.ShouldBindJSON(&body)
	claims := c.MustGet("claims").(map[string]interface{})
	cid := coalesce(claims["customer_id"], claims["sub"])
	role, _ := claims["role"].(string)

	tx, _ := db.Begin()
	defer tx.Rollback()

	var loanID, custID, accID, branchID, status sql.NullString
	var outstanding sql.NullFloat64
	err := tx.QueryRow(`SELECT id,customer_id,account_id,branch_id,outstanding,status FROM loans WHERE loan_number=?`, lnNum).
		Scan(&loanID, &custID, &accID, &branchID, &outstanding, &status)
	if err == sql.ErrNoRows {
		c.JSON(404, gin.H{"detail": "Loan not found"})
		return
	}
	if role == "customer" && custID.String != cid {
		c.JSON(403, gin.H{"detail": "Access denied"})
		return
	}
	if status.String != "ACTIVE" {
		c.JSON(400, gin.H{"detail": fmt.Sprintf("Loan is already %s", status.String)})
		return
	}

	var instNo sql.NullInt64
	var instEMI sql.NullFloat64
	if body.InstallmentNo > 0 {
		err = tx.QueryRow(`SELECT installment_no,emi FROM loan_schedule WHERE loan_id=? AND installment_no=? AND status!='PAID'`,
			loanID.String, body.InstallmentNo).Scan(&instNo, &instEMI)
	} else {
		// Overdue installments are settled before pending ones.
		err = tx.QueryRow(`SELECT installment_no,emi FROM loan_schedule WHERE loan_id=? AND status!='PAID'
			ORDER BY (status='OVERDUE') DESC, installment_no ASC LIMIT 1`, loanID.String).Scan(&instNo, &instEMI)
	}
	if err == sql.ErrNoRows {
		c.JSON(400, gin.H{"detail": "No matching outstanding installment"})
		return
	}

	var accNum sql.NullString
	var accBal sql.NullFloat64
	tx.QueryRow("SELECT account_number,balance FROM accounts WHERE id=?", accID.String).Scan(&accNum, &accBal)
	if accBal.Float64 < instEMI.Float64 {
		c.JSON(400, gin.H{"detail": fmt.Sprintf("Insufficient balance. EMI NPR %.2f, available NPR %.2f", instEMI.Float64, accBal.Float64)})
		return
	}

	newBal := math_round(accBal.Float64-instEMI.Float64, 2)
	newOutstanding := math_round(outstanding.Float64-instEMI.Float64, 2)
	if newOutstanding < 0 {
		newOutstanding = 0
	}

	tx.Exec("UPDATE accounts SET balance=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", newBal, accID.String)
	tx.Exec("UPDATE loan_schedule SET status='PAID', paid_at=CURRENT_TIMESTAMP WHERE loan_id=? AND installment_no=?", loanID.String, instNo.Int64)

	ref := txRef()
	tx.Exec(`INSERT INTO loan_payments (id,loan_id,installment_no,amount,reference_number) VALUES (?,?,?,?,?)`,
		newUUID(), loanID.String, instNo.Int64, instEMI.Float64, ref)
	tx.Exec(`INSERT INTO transactions (id,reference_number,from_account_id,from_account_number,amount,transaction_type,description,status,balance_after,initiated_by,channel,branch_id)
		VALUES (?,?,?,?,?,'LOAN_EMI',?,'COMPLETED',?,?,?,?)`,
		newUUID(), ref, accID.String, accNum.String, instEMI.Float64,
		fmt.Sprintf("Loan %s EMI #%d", lnNum, instNo.Int64), newBal, cid, "online", branchID.String)

	// Close the loan when nothing remains unpaid.
	var remaining int
	tx.QueryRow("SELECT COUNT(*) FROM loan_schedule WHERE loan_id=? AND status!='PAID'", loanID.String).Scan(&remaining)
	loanStatus := "ACTIVE"
	if remaining == 0 {
		loanStatus = "CLOSED"
		newOutstanding = 0
		tx.Exec("UPDATE loans SET outstanding=0, status='CLOSED', closed_at=CURRENT_TIMESTAMP WHERE id=?", loanID.String)
	} else {
		tx.Exec("UPDATE loans SET outstanding=? WHERE id=?", newOutstanding, loanID.String)
	}

	tx.Commit()
	c.JSON(200, gin.H{
		"status": "success", "loan_number": lnNum, "installment_no": instNo.Int64,
		"emi_paid": instEMI.Float64, "outstanding": newOutstanding, "loan_status": loanStatus,
		"account_balance_after": newBal, "reference_number": ref,
		"message": fmt.Sprintf("EMI #%d of NPR %.2f paid. Outstanding NPR %.2f.", instNo.Int64, instEMI.Float64, newOutstanding),
	})
}
