package com.securescore.compliance.grpc;

import ai.inference.v1.*;
import com.google.protobuf.Timestamp;
import com.securescore.compliance.domain.LoanFact;
import com.securescore.compliance.domain.TransactionFact;
import io.grpc.StatusRuntimeException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.concurrent.TimeUnit;

@Component
public class InferenceGrpcClient {

    private static final Logger log = LoggerFactory.getLogger(InferenceGrpcClient.class);

    // Optional — null when compliance.grpc.enabled=false or AI service is not in docker-compose
    @Autowired(required = false)
    private InferenceServiceGrpc.InferenceServiceBlockingStub stub;

    @Value("${compliance.grpc.timeout-seconds:3}")
    private int timeoutSeconds;

    @Value("${compliance.grpc.enabled:true}")
    private boolean enabled;

    /**
     * Enriches a TransactionFact with fraud/anomaly scores from the Python AI service.
     * Falls back to safe defaults (score=0, ALLOW path) on any failure so the compliance
     * engine never blocks transactions due to AI unavailability.
     */
    // Fill in fraud/anomaly scores from the AI service; degrade to safe defaults if it's unreachable.
    public void enrichWithScores(TransactionFact fact) {
        if (!enabled || stub == null) {
            applyDefaultScores(fact);
            return;
        }

        try {
            Instant ts = fact.getCompletedAt() != null ? fact.getCompletedAt() : Instant.now();
            ScoreTransactionRequest request = ScoreTransactionRequest.newBuilder()
                .setTransactionId(nullToEmpty(fact.getTransactionId()))
                .setAccountId(nullToEmpty(fact.getSourceAccountId()))
                .setCustomerId(nullToEmpty(fact.getCustomerId()))
                .setTransactionType(nullToEmpty(fact.getType()))
                .setAmount(fact.getAmount() != null ? fact.getAmount().toPlainString() : "0")
                .setCurrency(fact.getCurrency() != null ? fact.getCurrency() : "NPR")
                .setChannel(nullToEmpty(fact.getChannel()))
                .setTimestamp(Timestamp.newBuilder()
                    .setSeconds(ts.getEpochSecond())
                    .setNanos(ts.getNano())
                    .build())
                .build();

            ScoreTransactionResponse response = stub
                .withDeadlineAfter(timeoutSeconds, TimeUnit.SECONDS)
                .scoreTransaction(request);

            fact.setFraudScore(response.getFraudScore());
            fact.setAnomalyScore(response.getAnomalyScore());
            fact.setRiskLevel(response.getRiskLevel());
            fact.setModelVersion(response.getModelVersion());

            log.debug("gRPC scored txn {} → fraud={:.4f} anomaly={:.4f} risk={}",
                fact.getTransactionId(), response.getFraudScore(),
                response.getAnomalyScore(), response.getRiskLevel());

        } catch (StatusRuntimeException e) {
            log.warn("gRPC call failed for txn {} ({}), applying safe defaults",
                fact.getTransactionId(), e.getStatus().getCode());
            applyDefaultScores(fact);
        } catch (Exception e) {
            log.warn("Unexpected gRPC error for txn {}: {}", fact.getTransactionId(), e.getMessage());
            applyDefaultScores(fact);
        }
    }

    /**
     * Enriches a LoanFact with account-level credit risk score.
     */
    // Fill in the account-level credit risk score for a loan, defaulting to "unknown" on failure.
    public void enrichWithCreditScore(LoanFact fact) {
        if (!enabled || stub == null) {
            fact.setCreditRiskScore(0.0);
            fact.setRiskCategory("unknown");
            return;
        }

        try {
            ScoreAccountRequest request = ScoreAccountRequest.newBuilder()
                .setCustomerId(nullToEmpty(fact.getCustomerId()))
                .setAccountId(nullToEmpty(fact.getLoanId()))
                .setLookbackDays(90)
                .build();

            ScoreAccountResponse response = stub
                .withDeadlineAfter(timeoutSeconds, TimeUnit.SECONDS)
                .scoreAccount(request);

            fact.setCreditRiskScore(response.getRiskScore());
            fact.setRiskCategory(response.getRiskCategory());

            log.debug("gRPC scored loan {} → risk={:.4f} category={}",
                fact.getLoanId(), response.getRiskScore(), response.getRiskCategory());

        } catch (StatusRuntimeException e) {
            log.warn("gRPC credit score failed for loan {} ({}), applying safe defaults",
                fact.getLoanId(), e.getStatus().getCode());
            fact.setCreditRiskScore(0.0);
            fact.setRiskCategory("unknown");
        } catch (Exception e) {
            log.warn("Unexpected gRPC error for loan {}: {}", fact.getLoanId(), e.getMessage());
            fact.setCreditRiskScore(0.0);
            fact.setRiskCategory("unknown");
        }
    }

    // Neutral scores used whenever the AI service can't be reached — never block on outage.
    private void applyDefaultScores(TransactionFact fact) {
        fact.setFraudScore(0.0);
        fact.setAnomalyScore(0.0);
        fact.setRiskLevel("low");
        fact.setModelVersion("unavailable");
    }

    // Protobuf strings can't be null — coerce to empty.
    private String nullToEmpty(String s) {
        return s != null ? s : "";
    }
}
