package com.securescore.compliance.kafka;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.securescore.compliance.domain.EventEnvelope;
import com.securescore.compliance.domain.TransactionFact;
import com.securescore.compliance.service.ComplianceDecisionService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.support.KafkaHeaders;
import org.springframework.messaging.handler.annotation.Header;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;

@Component
public class TransactionEventConsumer {

    private static final Logger log = LoggerFactory.getLogger(TransactionEventConsumer.class);

    private final ObjectMapper mapper;
    private final ComplianceDecisionService decisionService;

    // Wire in the JSON mapper and the decision pipeline.
    public TransactionEventConsumer(ObjectMapper mapper, ComplianceDecisionService decisionService) {
        this.mapper = mapper;
        this.decisionService = decisionService;
    }

    @KafkaListener(
        topics = "${compliance.kafka.topics.transactions:banking.transactions}",
        groupId = "compliance-engine",
        containerFactory = "kafkaListenerContainerFactory"
    )
    // Consume a transaction event, skip non-completed ones, and hand the rest to the pipeline.
    public void consume(@Payload String message,
                        @Header(KafkaHeaders.RECEIVED_TOPIC) String topic,
                        @Header(KafkaHeaders.OFFSET) long offset) {
        try {
            EventEnvelope envelope = mapper.readValue(message, EventEnvelope.class);

            // Only process completed transactions — pending/failed handled separately
            if (!"transaction.completed".equals(envelope.getEventType()) &&
                !"transaction.created".equals(envelope.getEventType())) {
                return;
            }

            TransactionFact fact = buildFact(envelope);
            decisionService.processTransaction(fact);

        } catch (Exception e) {
            log.error("Failed to process transaction event at offset {}: {}", offset, e.getMessage(), e);
            // Let the error handler retry; after exhaustion it logs and moves on
            throw new RuntimeException("Transaction event processing failed", e);
        }
    }

    // Map the loosely-typed event payload into a typed TransactionFact for the rules.
    private TransactionFact buildFact(EventEnvelope envelope) throws Exception {
        var payload = envelope.getPayload();
        TransactionFact fact = new TransactionFact();

        fact.setTransactionId(textOrNull(payload, "transaction_id", "id"));
        fact.setCustomerId(textOrNull(payload, "customer_id", "initiator_id"));
        fact.setSourceAccountId(textOrNull(payload, "source_account_id"));
        fact.setDestAccountId(textOrNull(payload, "dest_account_id"));
        fact.setType(textOrNull(payload, "type"));
        fact.setStatus(textOrNull(payload, "status"));
        fact.setChannel(textOrNull(payload, "channel"));
        fact.setInitiatorRole(textOrNull(payload, "initiator_role"));
        fact.setCurrency(textOrNull(payload, "currency"));
        fact.setCorrelationId(envelope.getCorrelationId());

        if (payload.hasNonNull("amount")) {
            fact.setAmount(new BigDecimal(payload.get("amount").asText("0")));
        }

        return fact;
    }

    // Return the first present field's text value, or null — payloads use varying key names.
    private String textOrNull(com.fasterxml.jackson.databind.JsonNode node, String... fields) {
        for (String field : fields) {
            if (node.hasNonNull(field)) return node.get(field).asText();
        }
        return null;
    }
}
