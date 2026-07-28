package com.securescore.compliance.domain;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "compliance_decisions", indexes = {
    @Index(name = "idx_cd_transaction_id", columnList = "transaction_id"),
    @Index(name = "idx_cd_customer_id", columnList = "customer_id"),
    @Index(name = "idx_cd_decision", columnList = "decision"),
    @Index(name = "idx_cd_created_at", columnList = "created_at")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ComplianceDecision {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "transaction_id", nullable = false, length = 36)
    private String transactionId;

    @Column(name = "customer_id", length = 36)
    private String customerId;

    @Column(name = "entity_type", length = 20)
    private String entityType; // "transaction" | "loan"

    @Enumerated(EnumType.STRING)
    @Column(name = "decision", nullable = false, length = 20)
    private Decision decision;

    @Column(name = "regulatory_code", length = 20)
    private String regulatoryCode;

    @Column(name = "decision_reason", length = 500)
    private String decisionReason;

    @Column(name = "fraud_score", precision = 5, scale = 4)
    private BigDecimal fraudScore;

    @Column(name = "anomaly_score", precision = 5, scale = 4)
    private BigDecimal anomalyScore;

    @Column(name = "risk_level", length = 20)
    private String riskLevel;

    @Column(name = "model_version", length = 50)
    private String modelVersion;

    @Column(name = "requires_str")
    private boolean requiresSTR;

    @Column(name = "amount", precision = 20, scale = 4)
    private BigDecimal amount;

    @Column(name = "currency", length = 3)
    private String currency;

    @Column(name = "channel", length = 30)
    private String channel;

    @Column(name = "correlation_id", length = 36)
    private String correlationId;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @PrePersist
    void prePersist() {
        createdAt = Instant.now();
    }
}
