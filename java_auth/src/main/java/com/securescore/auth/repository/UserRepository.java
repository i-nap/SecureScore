package com.securescore.auth.repository;

import com.securescore.auth.domain.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

public interface UserRepository extends JpaRepository<User, UUID> {

    // Find a user by their login name.
    Optional<User> findByUsername(String username);

    // Bump the failed-login counter by one.
    @Modifying
    @Query("UPDATE User u SET u.failedAttempts = u.failedAttempts + 1 WHERE u.id = :id")
    void incrementFailedAttempts(@Param("id") UUID id);

    // Clear the failed-login counter after a good login.
    @Modifying
    @Query("UPDATE User u SET u.failedAttempts = 0 WHERE u.id = :id")
    void resetFailedAttempts(@Param("id") UUID id);

    // Lock the account and record when it happened.
    @Modifying
    @Query("UPDATE User u SET u.locked = true, u.lockedAt = :now WHERE u.id = :id")
    void lockAccount(@Param("id") UUID id, @Param("now") Instant now);

    // Stamp the last successful login time.
    @Modifying
    @Query("UPDATE User u SET u.lastLoginAt = :now WHERE u.id = :id")
    void updateLastLogin(@Param("id") UUID id, @Param("now") Instant now);
}
