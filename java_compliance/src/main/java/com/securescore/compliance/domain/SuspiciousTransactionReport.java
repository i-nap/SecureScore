package com.securescore.compliance.domain;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "suspicious_transaction_reports", indexes = {
    @Index(name = "idx_str_transaction_id", columnList = "transaction_id"),
    @Index(name = "idx_str_customer_id", columnList = "customer_id"),
    @Index(name = "idx_str_created_at", columnList = "created_at")
})
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SuspiciousTransactionReport {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "transaction_id", nullable = false, length = 36)
    private String transactionId;

    @Column(name = "customer_id", length = 36)
    private String customerId;

    @Column(name = "regulatory_code", length = 20)
    private String regulatoryCode;

    @Column(name = "amount", precision = 20, scale = 4)
    private BigDecimal amount;

    @Column(name = "currency", length = 3)
    private String currency;

    @Column(name = "channel", length = 30)
    private String channel;

    @Column(name = "fraud_score", precision = 5, scale = 4)
    private BigDecimal fraudScore;

    @Column(name = "decision_reason", length = 500)
    private String decisionReason;

    @Column(name = "pdf_path", length = 500)
    private String pdfPath;

    @Column(name = "submitted_at")
    private Instant submittedAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @PrePersist
    void prePersist() {
        createdAt = Instant.now();
    }
}
