package com.securescore.compliance.config;

import org.kie.api.KieServices;
import org.kie.api.builder.*;
import org.kie.api.runtime.KieContainer;
import org.kie.api.runtime.KieSession;
import org.kie.internal.io.ResourceFactory;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class DroolsConfig {

    private static final Logger log = LoggerFactory.getLogger(DroolsConfig.class);

    private static final String[] RULE_FILES = {
        "rules/aml_rules.drl",
        "rules/loan_rules.drl",
        "rules/transaction_rules.drl"
    };

    @Bean
    public KieContainer kieContainer() {
        KieServices ks = KieServices.Factory.get();
        KieFileSystem kfs = ks.newKieFileSystem();

        for (String ruleFile : RULE_FILES) {
            kfs.write(ResourceFactory.newClassPathResource(ruleFile));
            log.info("Loaded Drools rule file: {}", ruleFile);
        }

        KieBuilder kb = ks.newKieBuilder(kfs).buildAll();
        Results results = kb.getResults();

        if (results.hasMessages(Message.Level.ERROR)) {
            results.getMessages(Message.Level.ERROR)
                   .forEach(m -> log.error("Drools compile error: {}", m.getText()));
            throw new IllegalStateException("Drools rule compilation failed — check .drl files");
        }

        if (results.hasMessages(Message.Level.WARNING)) {
            results.getMessages(Message.Level.WARNING)
                   .forEach(m -> log.warn("Drools warning: {}", m.getText()));
        }

        log.info("Drools KieContainer built successfully with {} rule files", RULE_FILES.length);
        return ks.newKieContainer(ks.getRepository().getDefaultReleaseId());
    }
}
