package com.securescore.auth.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.time.Instant;

public record TokenPair(
    @JsonProperty("access_token")  String accessToken,
    @JsonProperty("refresh_token") String refreshToken,
    @JsonProperty("expires_at")    Instant expiresAt,
    @JsonProperty("token_type")    String tokenType
) {
    // Build a pair, defaulting the token type to "Bearer".
    public static TokenPair of(String access, String refresh, Instant expiresAt) {
        return new TokenPair(access, refresh, expiresAt, "Bearer");
    }
}
