package com.securescore.compliance.kafka;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.securescore.compliance.domain.EventEnvelope;
import com.securescore.compliance.domain.LoanFact;
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
public class LoanEventConsumer {

    private static final Logger log = LoggerFactory.getLogger(LoanEventConsumer.class);

    private final ObjectMapper mapper;
    private final ComplianceDecisionService decisionService;

    // Wire in the JSON mapper and the decision pipeline.
    public LoanEventConsumer(ObjectMapper mapper, ComplianceDecisionService decisionService) {
        this.mapper = mapper;
        this.decisionService = decisionService;
    }

    @KafkaListener(
        topics = "${compliance.kafka.topics.loans:banking.loans}",
        groupId = "compliance-engine",
        containerFactory = "kafkaListenerContainerFactory"
    )
    // Consume a loan state-change event and run it through the compliance pipeline.
    public void consume(@Payload String message,
                        @Header(KafkaHeaders.RECEIVED_TOPIC) String topic,
                        @Header(KafkaHeaders.OFFSET) long offset) {
        try {
            EventEnvelope envelope = mapper.readValue(message, EventEnvelope.class);
            LoanFact fact = buildFact(envelope);
            decisionService.processLoan(fact);
        } catch (Exception e) {
            log.error("Failed to process loan event at offset {}: {}", offset, e.getMessage(), e);
            throw new RuntimeException("Loan event processing failed", e);
        }
    }

    // Map the event payload into a typed LoanFact for the rules.
    private LoanFact buildFact(EventEnvelope envelope) {
        JsonNode payload = envelope.getPayload();
        LoanFact fact = new LoanFact();

        fact.setLoanId(textOrNull(payload, "loan_id", "id"));
        fact.setLoanNumber(textOrNull(payload, "loan_number"));
        fact.setCustomerId(textOrNull(payload, "customer_id"));
        fact.setFromStatus(textOrNull(payload, "from_status"));
        fact.setToStatus(textOrNull(payload, "to_status"));
        fact.setActorId(textOrNull(payload, "actor_id"));
        fact.setActorRole(textOrNull(payload, "actor_role"));
        fact.setCorrelationId(envelope.getCorrelationId());

        if (payload.hasNonNull("amount")) {
            fact.setAmount(new BigDecimal(payload.get("amount").asText("0")));
        }

        return fact;
    }

    private String textOrNull(JsonNode node, String... fields) {
        for (String field : fields) {
            if (node != null && node.hasNonNull(field)) return node.get(field).asText();
        }
        return null;
    }
}
