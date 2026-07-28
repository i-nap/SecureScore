package com.securescore.auth.domain;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "login_events")
@Getter
@Setter
public class LoginEvent {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "user_id")
    private UUID userId;

    @Column(nullable = false, length = 50)
    private String username;

    @Column(nullable = false)
    private boolean success;

    @Column(name = "failure_reason", length = 100)
    private String failureReason;

    @Column(name = "ip_address", length = 45)
    private String ipAddress = "";

    @Column(name = "user_agent", columnDefinition = "TEXT")
    private String userAgent = "";

    @Column(name = "occurred_at", nullable = false)
    private Instant occurredAt = Instant.now();
}
