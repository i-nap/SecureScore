package com.securescore.compliance.service;

import com.securescore.compliance.domain.*;
import com.securescore.compliance.grpc.InferenceGrpcClient;
import com.securescore.compliance.kafka.ComplianceEventProducer;
import com.securescore.compliance.repository.ComplianceDecisionRepository;
import com.securescore.compliance.repository.STRRepository;
import com.securescore.compliance.rules.DroolsRuleEngine;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;

@Service
public class ComplianceDecisionService {

    private static final Logger log = LoggerFactory.getLogger(ComplianceDecisionService.class);

    private final InferenceGrpcClient grpcClient;
    private final DroolsRuleEngine ruleEngine;
    private final ComplianceDecisionRepository decisionRepo;
    private final STRRepository strRepo;
    private final ComplianceEventProducer producer;
    private final ReportGenerationService reportService;

    // Wire in the gRPC client, rule engine, repos, Kafka producer and report service.
    public ComplianceDecisionService(InferenceGrpcClient grpcClient,
                                     DroolsRuleEngine ruleEngine,
                                     ComplianceDecisionRepository decisionRepo,
                                     STRRepository strRepo,
                                     ComplianceEventProducer producer,
                                     ReportGenerationService reportService) {
        this.grpcClient = grpcClient;
        this.ruleEngine = ruleEngine;
        this.decisionRepo = decisionRepo;
        this.strRepo = strRepo;
        this.producer = producer;
        this.reportService = reportService;
    }

    /**
     * Full pipeline: gRPC score → Drools rules → persist → publish → optional STR.
     * Called async so Kafka consumer thread is not blocked by gRPC latency.
     */
    @Async
    @Transactional
    public void processTransaction(TransactionFact fact) {
        // 1. Enrich with ML scores from Python AI service via gRPC
        grpcClient.enrichWithScores(fact);

        // 2. Run Drools rules (mutates fact.decision, regulatoryCode, requiresSTR)
        ruleEngine.evaluate(fact);

        // 3. Persist the decision
        ComplianceDecision decision = ComplianceDecision.builder()
            .transactionId(fact.getTransactionId())
            .customerId(fact.getCustomerId())
            .entityType("transaction")
            .decision(fact.getDecision())
            .regulatoryCode(fact.getRegulatoryCode())
            .decisionReason(fact.getDecisionReason())
            .fraudScore(BigDecimal.valueOf(fact.getFraudScore()))
            .anomalyScore(BigDecimal.valueOf(fact.getAnomalyScore()))
            .riskLevel(fact.getRiskLevel())
            .modelVersion(fact.getModelVersion())
            .requiresSTR(fact.isRequiresSTR())
            .amount(fact.getAmount())
            .currency(fact.getCurrency())
            .channel(fact.getChannel())
            .correlationId(fact.getCorrelationId())
            .build();

        decision = decisionRepo.save(decision);

        // 4. Publish to compliance.decisions Kafka topic
        producer.publishDecision(decision);

        log.info("Transaction {} → {} [{}] fraud={}",
            fact.getTransactionId(), fact.getDecision(),
            fact.getRegulatoryCode() != null ? fact.getRegulatoryCode() : "none",
            String.format("%.3f", fact.getFraudScore()));

        // 5. Generate STR asynchronously if required
        if (fact.isRequiresSTR() && !strRepo.existsByTransactionId(fact.getTransactionId())) {
            reportService.generateSTR(fact, decision.getId().toString());
        }
    }

    /**
     * Full pipeline for loan state change events.
     */
    @Async
    @Transactional
    public void processLoan(LoanFact fact) {
        // 1. Get credit risk score for this customer
        grpcClient.enrichWithCreditScore(fact);

        // 2. Run loan compliance rules
        ruleEngine.evaluate(fact);

        // 3. Persist
        ComplianceDecision decision = ComplianceDecision.builder()
            .transactionId(fact.getLoanId())
            .customerId(fact.getCustomerId())
            .entityType("loan")
            .decision(fact.getDecision())
            .regulatoryCode(fact.getRegulatoryCode())
            .decisionReason(fact.getDecisionReason())
            .fraudScore(BigDecimal.valueOf(fact.getCreditRiskScore()))
            .amount(fact.getAmount())
            .correlationId(fact.getCorrelationId())
            .build();

        decision = decisionRepo.save(decision);

        // 4. Publish
        producer.publishDecision(decision);

        log.info("Loan {} {} → {} [{}]",
            fact.getLoanId(), fact.getToStatus(),
            fact.getDecision(),
            fact.getRegulatoryCode() != null ? fact.getRegulatoryCode() : "none");
    }

    /**
     * Manual scoring endpoint — called directly from the REST controller.
     */
    @Transactional
    public ComplianceDecision scoreManually(TransactionFact fact) {
        grpcClient.enrichWithScores(fact);
        ruleEngine.evaluate(fact);

        ComplianceDecision decision = ComplianceDecision.builder()
            .transactionId(fact.getTransactionId())
            .customerId(fact.getCustomerId())
            .entityType("transaction")
            .decision(fact.getDecision())
            .regulatoryCode(fact.getRegulatoryCode())
            .decisionReason(fact.getDecisionReason())
            .fraudScore(BigDecimal.valueOf(fact.getFraudScore()))
            .anomalyScore(BigDecimal.valueOf(fact.getAnomalyScore()))
            .riskLevel(fact.getRiskLevel())
            .modelVersion(fact.getModelVersion())
            .requiresSTR(fact.isRequiresSTR())
            .amount(fact.getAmount())
            .currency(fact.getCurrency())
            .channel(fact.getChannel())
            .build();

        return decisionRepo.save(decision);
    }
}
