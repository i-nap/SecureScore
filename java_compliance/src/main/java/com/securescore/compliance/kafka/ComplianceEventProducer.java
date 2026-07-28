package com.securescore.compliance.kafka;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.securescore.compliance.domain.ComplianceDecision;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

@Component
public class ComplianceEventProducer {

    private static final Logger log = LoggerFactory.getLogger(ComplianceEventProducer.class);

    private final KafkaTemplate<String, String> kafkaTemplate;
    private final ObjectMapper mapper;

    @Value("${compliance.kafka.topics.decisions:compliance.decisions}")
    private String decisionsTopic;

    public ComplianceEventProducer(KafkaTemplate<String, String> kafkaTemplate, ObjectMapper mapper) {
        this.kafkaTemplate = kafkaTemplate;
        this.mapper = mapper;
    }

    public void publishDecision(ComplianceDecision decision) {
        try {
            Map<String, Object> envelope = new HashMap<>();
            envelope.put("event_id", UUID.randomUUID().toString());
            envelope.put("event_type", "compliance.decision." + decision.getDecision().name().toLowerCase());
            envelope.put("schema_version", "1.0");
            envelope.put("produced_at", Instant.now().toString());
            envelope.put("producer_service", "compliance-engine");
            envelope.put("correlation_id", decision.getCorrelationId());

            Map<String, Object> payload = new HashMap<>();
            payload.put("decision_id", decision.getId() != null ? decision.getId().toString() : null);
            payload.put("transaction_id", decision.getTransactionId());
            payload.put("customer_id", decision.getCustomerId());
            payload.put("entity_type", decision.getEntityType());
            payload.put("decision", decision.getDecision().name());
            payload.put("regulatory_code", decision.getRegulatoryCode());
            payload.put("decision_reason", decision.getDecisionReason());
            payload.put("fraud_score", decision.getFraudScore());
            payload.put("requires_str", decision.isRequiresSTR());
            payload.put("created_at", decision.getCreatedAt() != null ? decision.getCreatedAt().toString() : null);
            envelope.put("payload", payload);

            String json = mapper.writeValueAsString(envelope);
            kafkaTemplate.send(decisionsTopic, decision.getTransactionId(), json);

            log.debug("Published compliance decision {} for txn {}",
                decision.getDecision(), decision.getTransactionId());

        } catch (Exception e) {
            log.error("Failed to publish compliance decision for txn {}: {}",
                decision.getTransactionId(), e.getMessage(), e);
        }
    }
}
