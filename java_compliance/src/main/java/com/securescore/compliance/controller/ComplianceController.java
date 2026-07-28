package com.securescore.compliance.controller;

import com.securescore.compliance.domain.*;
import com.securescore.compliance.repository.ComplianceDecisionRepository;
import com.securescore.compliance.repository.STRRepository;
import com.securescore.compliance.service.ComplianceDecisionService;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.*;

@RestController
@RequestMapping("/api/compliance")
public class ComplianceController {

    private final ComplianceDecisionRepository decisionRepo;
    private final STRRepository strRepo;
    private final ComplianceDecisionService decisionService;

    public ComplianceController(ComplianceDecisionRepository decisionRepo,
                                STRRepository strRepo,
                                ComplianceDecisionService decisionService) {
        this.decisionRepo = decisionRepo;
        this.strRepo = strRepo;
        this.decisionService = decisionService;
    }

    /**
     * Paginated list of all compliance decisions, optionally filtered by decision type.
     * GET /api/compliance/decisions?page=0&size=20&decision=BLOCK
     */
    @GetMapping("/decisions")
    @Transactional(readOnly = true)
    public ResponseEntity<Page<ComplianceDecision>> listDecisions(
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size,
            @RequestParam(required = false) String decision) {

        PageRequest pageable = PageRequest.of(page, size, Sort.by("createdAt").descending());

        if (decision != null && !decision.isBlank()) {
            Decision d;
            try {
                d = Decision.valueOf(decision.trim().toUpperCase());
            } catch (IllegalArgumentException e) {
                throw new IllegalArgumentException(
                    "Invalid decision value '" + decision + "'. Valid values: " +
                    Arrays.toString(Decision.values()));
            }
            return ResponseEntity.ok(decisionRepo.findByDecisionOrderByCreatedAtDesc(d, pageable));
        }

        return ResponseEntity.ok(decisionRepo.findAllByOrderByCreatedAtDesc(pageable));
    }

    /**
     * Get the most recent compliance decision for a specific transaction.
     * GET /api/compliance/decisions/{transactionId}
     */
    @GetMapping("/decisions/{transactionId}")
    @Transactional(readOnly = true)
    public ResponseEntity<ComplianceDecision> getDecision(@PathVariable String transactionId) {
        return decisionRepo.findFirstByTransactionIdOrderByCreatedAtDesc(transactionId)
            .map(ResponseEntity::ok)
            .orElse(ResponseEntity.notFound().build());
    }

    /**
     * Paginated list of all Suspicious Transaction Reports.
     * GET /api/compliance/str?page=0&size=20
     */
    @GetMapping("/str")
    @Transactional(readOnly = true)
    public ResponseEntity<Page<SuspiciousTransactionReport>> listSTRs(
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size) {

        PageRequest pageable = PageRequest.of(page, size, Sort.by("createdAt").descending());
        return ResponseEntity.ok(strRepo.findAllByOrderByCreatedAtDesc(pageable));
    }

    /**
     * Manually score a transaction through the full pipeline: gRPC → Drools → persist.
     * Useful for testing rules and for BFF-initiated scoring outside Kafka flow.
     * POST /api/compliance/score
     */
    @PostMapping("/score")
    @Transactional
    public ResponseEntity<ComplianceDecision> manualScore(@RequestBody ManualScoreRequest req) {
        if (req.transactionId() == null && req.amount() == null) {
            throw new IllegalArgumentException("At least one of transactionId or amount must be provided");
        }

        TransactionFact fact = new TransactionFact();
        fact.setTransactionId(req.transactionId() != null ? req.transactionId() : UUID.randomUUID().toString());
        fact.setCustomerId(req.customerId());
        fact.setSourceAccountId(req.sourceAccountId());
        fact.setAmount(req.amount());
        fact.setCurrency(req.currency() != null ? req.currency() : "NPR");
        fact.setChannel(req.channel());
        fact.setType(req.type());
        fact.setStatus("completed");

        return ResponseEntity.ok(decisionService.scoreManually(fact));
    }

    /**
     * Dashboard summary stats for the HQ admin panel.
     * GET /api/compliance/dashboard
     */
    @GetMapping("/dashboard")
    @Transactional(readOnly = true)
    public ResponseEntity<Map<String, Object>> dashboard() {
        Instant since24h = Instant.now().minusSeconds(86_400L);
        Instant since7d  = Instant.now().minusSeconds(7L * 86_400L);
        Instant since30d = Instant.now().minusSeconds(30L * 86_400L);

        Map<String, Object> stats = new LinkedHashMap<>();
        stats.put("decisions_last_24h",  decisionRepo.countByCreatedAtAfter(since24h));
        stats.put("decisions_last_7d",   decisionRepo.countByCreatedAtAfter(since7d));
        stats.put("decisions_last_30d",  decisionRepo.countByCreatedAtAfter(since30d));
        stats.put("str_last_7d",         decisionRepo.countSTRRequiredSince(since7d));
        stats.put("total_blocked",       decisionRepo.countByDecision(Decision.BLOCK));
        stats.put("total_flagged",       decisionRepo.countByDecision(Decision.FLAG_FOR_REVIEW));
        stats.put("total_str_required",  decisionRepo.countByDecision(Decision.REQUIRES_STR));
        stats.put("total_allowed",       decisionRepo.countByDecision(Decision.ALLOW));
        stats.put("total_strs_filed",    strRepo.count());

        // Decision breakdown for chart
        Map<String, Long> byDecision = new LinkedHashMap<>();
        for (Object[] row : decisionRepo.countByDecisionGrouped()) {
            byDecision.put(((Decision) row[0]).name(), (Long) row[1]);
        }
        stats.put("by_decision", byDecision);
        stats.put("generated_at", Instant.now().toString());

        return ResponseEntity.ok(stats);
    }

    // ── Request DTO ──────────────────────────────────────────────────────────

    record ManualScoreRequest(
        String transactionId,
        String customerId,
        String sourceAccountId,
        @NotNull BigDecimal amount,
        String currency,
        String channel,
        String type
    ) {}
}
