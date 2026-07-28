package com.securescore.auth.repository;

import com.securescore.auth.domain.RefreshToken;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface RefreshTokenRepository extends JpaRepository<RefreshToken, UUID> {

    // Look up a stored token by its SHA-256 hash.
    Optional<RefreshToken> findByTokenHash(String tokenHash);

    // All still-live tokens in a family — used to revoke the whole chain on theft.
    List<RefreshToken> findByFamilyAndRevokedFalse(UUID family);
}
