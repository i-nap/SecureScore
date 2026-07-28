package com.securescore.compliance.kafka;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.securescore.compliance.domain.ComplianceDecision;
import com.securescore.compliance.domain.Decision;
import com.securescore.compliance.repository.ComplianceDecisionRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.support.KafkaHeaders;
import org.springframework.messaging.handler.annotation.Header;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;

/**
 * Consumes ai.risk.flags published by the Python AI service when it detects
 * high-risk transactions via its own Kafka consumer. Correlates with existing
 * compliance decisions or creates new ones for immediate escalation.
 */
@Component
public class RiskFlagConsumer {

    private static final Logger log = LoggerFactory.getLogger(RiskFlagConsumer.class);

    private final ObjectMapper mapper;
    private final ComplianceDecisionRepository decisionRepo;

    public RiskFlagConsumer(ObjectMapper mapper, ComplianceDecisionRepository decisionRepo) {
        this.mapper = mapper;
        this.decisionRepo = decisionRepo;
    }

    @KafkaListener(
        topics = "${compliance.kafka.topics.risk-flags:ai.risk.flags}",
        groupId = "compliance-engine-risk",
        containerFactory = "kafkaListenerContainerFactory"
    )
    public void consume(@Payload String message,
                        @Header(KafkaHeaders.OFFSET) long offset) {
        try {
            JsonNode flag = mapper.readTree(message);
            String transactionId = flag.path("transaction_id").asText(null);
            double fraudScore = flag.path("fraud_score").asDouble(0.0);
            String riskLevel = flag.path("risk_level").asText("low");
            boolean block = flag.path("block_transaction").asBoolean(false);

            if (transactionId == null) return;

            // If AI service says block and we don't already have a BLOCK decision, create one
            if (block && fraudScore > 0.90) {
                boolean alreadyBlocked = decisionRepo.existsByTransactionIdAndDecision(
                    transactionId, Decision.BLOCK);

                if (!alreadyBlocked) {
                    ComplianceDecision escalated = ComplianceDecision.builder()
                        .transactionId(transactionId)
                        .entityType("transaction")
                        .decision(Decision.BLOCK)
                        .regulatoryCode("AI-RISK-FLAG")
                        .decisionReason("AI service flagged for block — fraud score " + fraudScore)
                        .fraudScore(BigDecimal.valueOf(fraudScore))
                        .riskLevel(riskLevel)
                        .modelVersion(flag.path("model_version").asText("unknown"))
                        .build();

                    decisionRepo.save(escalated);
                    log.warn("Risk flag escalated to BLOCK for transaction {}", transactionId);
                }
            }

        } catch (Exception e) {
            log.error("Failed to process risk flag at offset {}: {}", offset, e.getMessage(), e);
        }
    }
}
