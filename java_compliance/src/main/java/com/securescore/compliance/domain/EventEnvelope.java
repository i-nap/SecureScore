package com.securescore.compliance.domain;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * Mirrors the Go EventEnvelope produced by the banking service on all Kafka topics.
 */
@Data
@NoArgsConstructor
@JsonIgnoreProperties(ignoreUnknown = true)
public class EventEnvelope {

    @JsonProperty("event_id")
    private String eventId;

    @JsonProperty("event_type")
    private String eventType;

    @JsonProperty("schema_version")
    private String schemaVersion;

    @JsonProperty("produced_at")
    private Instant producedAt;

    @JsonProperty("producer_service")
    private String producerService;

    @JsonProperty("correlation_id")
    private String correlationId;

    @JsonProperty("payload")
    private JsonNode payload;
}
