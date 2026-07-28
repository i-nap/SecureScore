package com.securescore.compliance.domain;

import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.Instant;

/**
 * Drools working memory object built from a banking.loans Kafka event.
 */
@Data
@NoArgsConstructor
public class LoanFact {

    private String loanId;
    private String loanNumber;
    private String customerId;
    private String fromStatus;
    private String toStatus;
    private String actorId;
    private String actorRole;
    private BigDecimal amount;
    private Instant changedAt;
    private String correlationId;

    // Populated by gRPC ScoreAccount before rules fire
    private double creditRiskScore;
    private String riskCategory;

    // Mutated by Drools rules
    private Decision decision = Decision.ALLOW;
    private String regulatoryCode;
    private String decisionReason;
    private boolean requiresEnhancedDueDiligence;
}
