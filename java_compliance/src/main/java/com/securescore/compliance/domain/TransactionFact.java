package com.securescore.compliance.domain;

import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.Instant;

/**
 * Drools working memory object built from a banking.transactions Kafka event.
 * Rules mutate decision, regulatoryCode, and requiresSTR fields.
 */
@Data
@NoArgsConstructor
public class TransactionFact {

    private String transactionId;
    private String customerId;
    private String sourceAccountId;
    private String destAccountId;
    private BigDecimal amount;
    private String currency;
    private String type;
    private String status;
    private String channel;
    private String initiatorRole;
    private String correlationId;
    private Instant completedAt;

    // Populated by InferenceGrpcClient before rules fire
    private double fraudScore;
    private double anomalyScore;
    private String riskLevel;
    private String modelVersion;

    // Mutated by Drools rules
    private Decision decision = Decision.ALLOW;
    private String regulatoryCode;
    private boolean requiresSTR;
    private String decisionReason;
}
