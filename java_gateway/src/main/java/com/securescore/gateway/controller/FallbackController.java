package com.securescore.gateway.controller;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.Map;

/**
 * Circuit breaker fallback responses.
 * Returned when a downstream service is unreachable or timing out.
 */
@RestController
@RequestMapping("/fallback")
public class FallbackController {

    // Served when the banking service trips its circuit breaker.
    @GetMapping("/banking")
    public ResponseEntity<Map<String, Object>> bankingFallback() {
        return ServiceUnavailable("banking-service",
            "Banking service is temporarily unavailable. Please try again in a moment.");
    }

    // Served when the compliance engine trips its circuit breaker.
    @GetMapping("/compliance")
    public ResponseEntity<Map<String, Object>> complianceFallback() {
        return ServiceUnavailable("compliance-service",
            "Compliance engine is temporarily unavailable. Decisions will be processed when service recovers.");
    }

    // GET /fallback/health — the gateway's own liveness check.
    @GetMapping("/health")
    public ResponseEntity<Map<String, Object>> health() {
        return ResponseEntity.ok(Map.of(
            "status", "ok",
            "service", "securescore-gateway",
            "timestamp", Instant.now().toString()
        ));
    }

    // Shared 503 envelope naming the downstream service that's down.
    private ResponseEntity<Map<String, Object>> ServiceUnavailable(String service, String message) {
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(Map.of(
            "status", 503,
            "error", "Service Unavailable",
            "service", service,
            "message", message,
            "timestamp", Instant.now().toString()
        ));
    }
}
