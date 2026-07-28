package main

import (
	"fmt"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// Branch analytics copilot — a second, larger LLM that answers a branch
// manager's natural-language questions about their branch. It only ever sees
// AGGREGATE figures (counts, totals, rates) computed here from branch-local
// data — never customer names, account numbers, or any PII. That keeps it
// inside the federated privacy boundary even though Groq is an external service.

type branchMetrics struct {
	Accounts        int
	TotalDeposits   float64
	DormantAccounts int
	Txn30dCount     int
	Txn30dVolume    float64
	ActiveLoans     int
	LoanOutstanding float64
	OverdueInst     int
	ActiveFDs       int
	FDPrincipal     float64
	PendingApps     int
	PendingCheques  int
}

func gatherBranchMetrics(branchID string) branchMetrics {
	var m branchMetrics
	if !dbAvailable() {
		return m
	}
	cutoff := time.Now().AddDate(0, 0, -30).Format("2006-01-02")

	db.QueryRow(`SELECT COUNT(*), COALESCE(SUM(balance),0) FROM accounts WHERE branch_id=? AND is_active=1`, branchID).
		Scan(&m.Accounts, &m.TotalDeposits)
	db.QueryRow(`SELECT COUNT(*) FROM accounts WHERE branch_id=? AND is_active=1 AND account_status='dormant'`, branchID).
		Scan(&m.DormantAccounts)
	db.QueryRow(`SELECT COUNT(*), COALESCE(SUM(amount),0) FROM transactions WHERE branch_id=? AND DATE(created_at)>=DATE(?)`, branchID, cutoff).
		Scan(&m.Txn30dCount, &m.Txn30dVolume)
	db.QueryRow(`SELECT COUNT(*), COALESCE(SUM(outstanding),0) FROM loans WHERE branch_id=? AND status='ACTIVE'`, branchID).
		Scan(&m.ActiveLoans, &m.LoanOutstanding)
	db.QueryRow(`SELECT COUNT(*) FROM loan_schedule s JOIN loans l ON l.id=s.loan_id WHERE l.branch_id=? AND s.status='OVERDUE'`, branchID).
		Scan(&m.OverdueInst)
	db.QueryRow(`SELECT COUNT(*), COALESCE(SUM(principal),0) FROM fixed_deposits WHERE branch_id=? AND status='ACTIVE'`, branchID).
		Scan(&m.ActiveFDs, &m.FDPrincipal)
	db.QueryRow(`SELECT COUNT(*) FROM account_applications WHERE branch_id=? AND status='pending'`, branchID).Scan(&m.PendingApps)
	db.QueryRow(`SELECT COUNT(*) FROM cheque_book_requests WHERE branch_id=? AND status='REQUESTED'`, branchID).Scan(&m.PendingCheques)
	return m
}

func (m branchMetrics) text() string {
	npr := func(f float64) string { return fmt.Sprintf("NPR %.0f", f) }
	return strings.Join([]string{
		fmt.Sprintf("- Active accounts: %d (%d dormant)", m.Accounts, m.DormantAccounts),
		fmt.Sprintf("- Total customer deposits: %s", npr(m.TotalDeposits)),
		fmt.Sprintf("- Transactions last 30 days: %d, volume %s", m.Txn30dCount, npr(m.Txn30dVolume)),
		fmt.Sprintf("- Active loans: %d, outstanding %s, overdue installments %d", m.ActiveLoans, npr(m.LoanOutstanding), m.OverdueInst),
		fmt.Sprintf("- Active fixed deposits: %d, principal %s", m.ActiveFDs, npr(m.FDPrincipal)),
		fmt.Sprintf("- Pending account applications: %d, pending cheque-book requests: %d", m.PendingApps, m.PendingCheques),
	}, "\n")
}

func (m branchMetrics) asJSON() gin.H {
	return gin.H{
		"active_accounts": m.Accounts, "dormant_accounts": m.DormantAccounts,
		"total_deposits": math_round(m.TotalDeposits, 2),
		"txn_30d_count":  m.Txn30dCount, "txn_30d_volume": math_round(m.Txn30dVolume, 2),
		"active_loans": m.ActiveLoans, "loan_outstanding": math_round(m.LoanOutstanding, 2),
		"overdue_installments": m.OverdueInst,
		"active_fds":           m.ActiveFDs, "fd_principal": math_round(m.FDPrincipal, 2),
		"pending_applications": m.PendingApps, "pending_cheques": m.PendingCheques,
	}
}

// copilotFallback answers without an LLM when no GROQ key is set.
func copilotFallback(m branchMetrics, q string) string {
	ql := strings.ToLower(q)
	switch {
	case strings.Contains(ql, "loan") || strings.Contains(ql, "overdue") || strings.Contains(ql, "npl"):
		return fmt.Sprintf("You have %d active loans with NPR %.0f outstanding. %d installments are overdue — prioritise follow-up on those to keep the portfolio healthy.",
			m.ActiveLoans, m.LoanOutstanding, m.OverdueInst)
	case strings.Contains(ql, "deposit") || strings.Contains(ql, "balance") || strings.Contains(ql, "liquid"):
		return fmt.Sprintf("Total customer deposits are NPR %.0f across %d active accounts, plus NPR %.0f in %d fixed deposits. %d accounts are dormant — a re-activation campaign could lift balances.",
			m.TotalDeposits, m.Accounts, m.FDPrincipal, m.ActiveFDs, m.DormantAccounts)
	case strings.Contains(ql, "pending") || strings.Contains(ql, "queue") || strings.Contains(ql, "today"):
		return fmt.Sprintf("Open work items: %d account applications and %d cheque-book requests await action. 30-day activity: %d transactions, NPR %.0f volume.",
			m.PendingApps, m.PendingCheques, m.Txn30dCount, m.Txn30dVolume)
	default:
		return fmt.Sprintf("Branch snapshot: %d accounts, NPR %.0f deposits, %d active loans (NPR %.0f outstanding, %d overdue), %d FDs. %d applications and %d cheque requests pending. Ask about loans, deposits, or your work queue for detail.",
			m.Accounts, m.TotalDeposits, m.ActiveLoans, m.LoanOutstanding, m.OverdueInst, m.ActiveFDs, m.PendingApps, m.PendingCheques)
	}
}

func handleBranchCopilot(c *gin.Context) {
	if !requireManager(c) {
		return
	}
	var req struct {
		Question string `json:"question"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.Question) == "" {
		c.JSON(400, gin.H{"detail": "question is required"})
		return
	}
	claims := c.MustGet("claims").(map[string]interface{})
	branchID, _ := claims["branch_id"].(string)
	branchName := strings.Title(strings.ReplaceAll(branchID, "_", " "))

	metrics := gatherBranchMetrics(branchID)

	system := fmt.Sprintf(`You are the operations copilot for the %s branch of SecureScore Bank.
You can ONLY see the aggregate branch figures provided below — never individual customer data, names, or account numbers.
Answer the manager's question using ONLY these figures. Be concise (2-4 sentences), specific, and cite the numbers.
If asked about a specific customer, explain you only have aggregate access. Give a practical, actionable banking insight where relevant.

Branch metrics:
%s`, branchName, metrics.text())

	source := "llm"
	answer := groqChatWith(groqCopilotModel, system, req.Question, 400)
	if answer == "" {
		source = "rule-based"
		answer = copilotFallback(metrics, req.Question)
	}

	c.JSON(200, gin.H{
		"answer":  answer,
		"source":  source,
		"model":   map[bool]string{true: groqCopilotModel, false: "rule-based"}[source == "llm"],
		"metrics": metrics.asJSON(),
		"branch":  branchName,
		"note":    "The copilot reasons only over aggregate figures — no customer PII leaves the branch.",
	})
}
