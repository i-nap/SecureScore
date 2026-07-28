package com.securescore.compliance.repository;

import com.securescore.compliance.domain.ComplianceDecision;
import com.securescore.compliance.domain.Decision;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface ComplianceDecisionRepository extends JpaRepository<ComplianceDecision, UUID> {

    Optional<ComplianceDecision> findFirstByTransactionIdOrderByCreatedAtDesc(String transactionId);

    Page<ComplianceDecision> findAllByOrderByCreatedAtDesc(Pageable pageable);

    Page<ComplianceDecision> findByDecisionOrderByCreatedAtDesc(Decision decision, Pageable pageable);

    boolean existsByTransactionIdAndDecision(String transactionId, Decision decision);

    long countByDecision(Decision decision);

    long countByCreatedAtAfter(Instant since);

    @Query("SELECT COUNT(d) FROM ComplianceDecision d WHERE d.requiresSTR = true AND d.createdAt > :since")
    long countSTRRequiredSince(Instant since);

    @Query("SELECT d.decision, COUNT(d) FROM ComplianceDecision d GROUP BY d.decision")
    List<Object[]> countByDecisionGrouped();
}
