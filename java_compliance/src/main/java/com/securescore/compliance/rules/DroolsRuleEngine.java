package com.securescore.compliance.rules;

import com.securescore.compliance.domain.LoanFact;
import com.securescore.compliance.domain.TransactionFact;
import org.kie.api.runtime.KieContainer;
import org.kie.api.runtime.KieSession;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

@Component
public class DroolsRuleEngine {

    private static final Logger log = LoggerFactory.getLogger(DroolsRuleEngine.class);

    private final KieContainer kieContainer;

    // Hold the compiled Drools rule container.
    public DroolsRuleEngine(KieContainer kieContainer) {
        this.kieContainer = kieContainer;
    }

    // Fire the transaction rules against one fact, mutating its decision in place.
    public void evaluate(TransactionFact fact) {
        KieSession session = kieContainer.newKieSession();
        try {
            session.insert(fact);
            int fired = session.fireAllRules();
            log.debug("Transaction {} — {} rules fired → decision: {} code: {}",
                fact.getTransactionId(), fired, fact.getDecision(), fact.getRegulatoryCode());
        } finally {
            session.dispose();
        }
    }

    // Fire the loan rules against one fact, mutating its decision in place.
    public void evaluate(LoanFact fact) {
        KieSession session = kieContainer.newKieSession();
        try {
            session.insert(fact);
            int fired = session.fireAllRules();
            log.debug("Loan {} — {} rules fired → decision: {} code: {}",
                fact.getLoanId(), fired, fact.getDecision(), fact.getRegulatoryCode());
        } finally {
            session.dispose();
        }
    }
}
