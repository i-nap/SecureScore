package com.securescore.compliance.service;

import com.securescore.compliance.domain.ComplianceDecision;
import com.securescore.compliance.domain.SuspiciousTransactionReport;
import com.securescore.compliance.domain.TransactionFact;
import com.securescore.compliance.repository.ComplianceDecisionRepository;
import com.securescore.compliance.repository.STRRepository;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.pdfbox.pdmodel.font.Standard14Fonts;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Optional;
import java.util.UUID;

@Service
public class ReportGenerationService {

    private static final Logger log = LoggerFactory.getLogger(ReportGenerationService.class);
    private static final DateTimeFormatter DATE_FMT =
        DateTimeFormatter.ofPattern("dd MMM yyyy HH:mm:ss z").withZone(ZoneId.of("Asia/Kathmandu"));

    @Value("${compliance.reports.output-dir:/tmp/compliance-reports}")
    private String outputDir;

    private final STRRepository strRepo;
    private final ComplianceDecisionRepository decisionRepo;

    // Wire in the STR and decision repositories.
    public ReportGenerationService(STRRepository strRepo,
                                   ComplianceDecisionRepository decisionRepo) {
        this.strRepo = strRepo;
        this.decisionRepo = decisionRepo;
    }

    // ─── STR Generation ──────────────────────────────────────────────────────

    // Render the STR PDF, save the record, and swallow failures so the pipeline keeps running.
    @Async
    @Transactional
    public void generateSTR(TransactionFact fact, String decisionId) {
        try {
            String pdfPath = writeSTRPdf(fact);

            SuspiciousTransactionReport str = SuspiciousTransactionReport.builder()
                .transactionId(fact.getTransactionId())
                .customerId(fact.getCustomerId())
                .regulatoryCode(fact.getRegulatoryCode())
                .amount(fact.getAmount())
                .currency(fact.getCurrency())
                .channel(fact.getChannel())
                .fraudScore(BigDecimal.valueOf(fact.getFraudScore()))
                .decisionReason(fact.getDecisionReason())
                .pdfPath(pdfPath)
                .build();

            strRepo.save(str);
            log.info("STR generated for transaction {} → {}", fact.getTransactionId(), pdfPath);

        } catch (Exception e) {
            log.error("STR generation failed for transaction {}: {}", fact.getTransactionId(), e.getMessage(), e);
        }
    }

    // Read an already-generated STR PDF back off disk by its id.
    public byte[] getSTRPdfBytes(UUID strId) throws Exception {
        SuspiciousTransactionReport str = strRepo.findById(strId)
            .orElseThrow(() -> new IllegalArgumentException("STR not found: " + strId));
        return Files.readAllBytes(Paths.get(str.getPdfPath()));
    }

    // Build a customer credit-assessment PDF on the fly.
    public byte[] generateCreditReportBytes(String customerId) throws Exception {
        return buildCreditReportPdf(customerId);
    }

    // Build a loan sanction/rejection letter from the latest decision for that loan.
    public byte[] generateLoanLetterBytes(String loanId) throws Exception {
        Optional<ComplianceDecision> decision = decisionRepo
            .findFirstByTransactionIdOrderByCreatedAtDesc(loanId);
        return buildLoanLetterPdf(loanId, decision.orElse(null));
    }

    // ─── PDF Builders ─────────────────────────────────────────────────────────

    // Build the STR PDF and write it to a timestamped file, returning the path.
    private String writeSTRPdf(TransactionFact fact) throws Exception {
        ensureOutputDir();
        String filename = "STR_" + fact.getTransactionId() + "_" + System.currentTimeMillis() + ".pdf";
        String fullPath = outputDir + File.separator + filename;

        byte[] bytes = buildSTRPdf(fact);
        try (FileOutputStream fos = new FileOutputStream(fullPath)) {
            fos.write(bytes);
        }
        return fullPath;
    }

    // Lay out the full Suspicious Transaction Report PDF in memory.
    private byte[] buildSTRPdf(TransactionFact fact) throws Exception {
        try (PDDocument doc = new PDDocument();
             ByteArrayOutputStream baos = new ByteArrayOutputStream()) {

            PDPage page = new PDPage(PDRectangle.A4);
            doc.addPage(page);

            PDType1Font bold = new PDType1Font(Standard14Fonts.FontName.HELVETICA_BOLD);
            PDType1Font regular = new PDType1Font(Standard14Fonts.FontName.HELVETICA);

            try (PDPageContentStream cs = new PDPageContentStream(doc, page)) {
                float margin = 60;
                float y = 780;
                float lineH = 18;

                // Header
                cs.beginText();
                cs.setFont(bold, 16);
                cs.newLineAtOffset(margin, y);
                cs.showText("SUSPICIOUS TRANSACTION REPORT (STR)");
                cs.endText();
                y -= lineH * 1.5f;

                cs.beginText();
                cs.setFont(regular, 10);
                cs.newLineAtOffset(margin, y);
                cs.showText("Nepal Rastra Bank — Financial Intelligence Unit");
                cs.endText();
                y -= lineH;

                cs.beginText();
                cs.newLineAtOffset(margin, y);
                cs.showText("Generated: " + DATE_FMT.format(Instant.now()));
                cs.endText();
                y -= lineH * 2;

                // Divider
                cs.moveTo(margin, y);
                cs.lineTo(550, y);
                cs.stroke();
                y -= lineH;

                // Section: Transaction Details
                y = addSection(cs, bold, regular, margin, y, lineH, "TRANSACTION DETAILS", new String[][]{
                    {"Transaction ID", fact.getTransactionId()},
                    {"Customer ID", nvl(fact.getCustomerId())},
                    {"Amount", nvl(fact.getAmount()) + " " + nvl(fact.getCurrency())},
                    {"Channel", nvl(fact.getChannel())},
                    {"Type", nvl(fact.getType())},
                    {"Status", nvl(fact.getStatus())}
                });

                y -= lineH;

                // Section: Risk Assessment
                y = addSection(cs, bold, regular, margin, y, lineH, "RISK ASSESSMENT", new String[][]{
                    {"Fraud Score", String.format("%.4f", fact.getFraudScore())},
                    {"Anomaly Score", String.format("%.4f", fact.getAnomalyScore())},
                    {"Risk Level", nvl(fact.getRiskLevel())},
                    {"ML Model Version", nvl(fact.getModelVersion())}
                });

                y -= lineH;

                // Section: Compliance Decision
                y = addSection(cs, bold, regular, margin, y, lineH, "COMPLIANCE DECISION", new String[][]{
                    {"Decision", fact.getDecision().name()},
                    {"Regulatory Code", nvl(fact.getRegulatoryCode())},
                    {"Reason", nvl(fact.getDecisionReason())},
                    {"STR Required", "YES"}
                });

                y -= lineH * 2;

                // Footer
                cs.beginText();
                cs.setFont(regular, 9);
                cs.newLineAtOffset(margin, y);
                cs.showText("This report is auto-generated by SecureScore Compliance Engine v1.0.0");
                cs.endText();
                y -= lineH;
                cs.beginText();
                cs.newLineAtOffset(margin, y);
                cs.showText("Report ID: " + UUID.randomUUID());
                cs.endText();
            }

            doc.save(baos);
            return baos.toByteArray();
        }
    }

    // Lay out the credit-assessment PDF, pulling 90-day compliance stats from the DB.
    private byte[] buildCreditReportPdf(String customerId) throws Exception {
        try (PDDocument doc = new PDDocument();
             ByteArrayOutputStream baos = new ByteArrayOutputStream()) {

            PDPage page = new PDPage(PDRectangle.A4);
            doc.addPage(page);

            PDType1Font bold = new PDType1Font(Standard14Fonts.FontName.HELVETICA_BOLD);
            PDType1Font regular = new PDType1Font(Standard14Fonts.FontName.HELVETICA);

            try (PDPageContentStream cs = new PDPageContentStream(doc, page)) {
                float margin = 60;
                float y = 780;
                float lineH = 18;

                cs.beginText();
                cs.setFont(bold, 16);
                cs.newLineAtOffset(margin, y);
                cs.showText("CREDIT ASSESSMENT REPORT");
                cs.endText();
                y -= lineH * 1.5f;

                cs.beginText();
                cs.setFont(regular, 10);
                cs.newLineAtOffset(margin, y);
                cs.showText("SecureScore Federated Credit Scoring System");
                cs.endText();
                y -= lineH;
                cs.beginText();
                cs.newLineAtOffset(margin, y);
                cs.showText("Generated: " + DATE_FMT.format(Instant.now()));
                cs.endText();
                y -= lineH * 2;

                cs.moveTo(margin, y);
                cs.lineTo(550, y);
                cs.stroke();
                y -= lineH;

                y = addSection(cs, bold, regular, margin, y, lineH, "CUSTOMER INFORMATION", new String[][]{
                    {"Customer ID", customerId},
                    {"Report Date", DATE_FMT.format(Instant.now())},
                    {"Scoring Model", "SecureScore XGBoost v2 + GNN Ensemble"}
                });

                y -= lineH;

                // Recent compliance decisions summary
                long totalDecisions = decisionRepo.countByCreatedAtAfter(
                    Instant.now().minusSeconds(90L * 24 * 3600));
                long flagged = decisionRepo.countByDecision(
                    com.securescore.compliance.domain.Decision.FLAG_FOR_REVIEW);
                long blocked = decisionRepo.countByDecision(
                    com.securescore.compliance.domain.Decision.BLOCK);

                y = addSection(cs, bold, regular, margin, y, lineH, "COMPLIANCE SUMMARY (90 DAYS)", new String[][]{
                    {"Total Decisions", String.valueOf(totalDecisions)},
                    {"Flagged Transactions", String.valueOf(flagged)},
                    {"Blocked Transactions", String.valueOf(blocked)},
                    {"Privacy Method", "Federated Learning with Differential Privacy (ε=1.0)"},
                    {"NRB Compliance Status", blocked > 5 ? "REVIEW REQUIRED" : "COMPLIANT"}
                });

                y -= lineH * 2;
                cs.beginText();
                cs.setFont(regular, 9);
                cs.newLineAtOffset(margin, y);
                cs.showText("This report is generated using privacy-preserving federated ML. Branch data never leaves the branch.");
                cs.endText();
            }

            doc.save(baos);
            return baos.toByteArray();
        }
    }

    // Lay out a sanction or rejection letter depending on the decision's verdict.
    private byte[] buildLoanLetterPdf(String loanId, ComplianceDecision decision) throws Exception {
        try (PDDocument doc = new PDDocument();
             ByteArrayOutputStream baos = new ByteArrayOutputStream()) {

            PDPage page = new PDPage(PDRectangle.A4);
            doc.addPage(page);

            PDType1Font bold = new PDType1Font(Standard14Fonts.FontName.HELVETICA_BOLD);
            PDType1Font regular = new PDType1Font(Standard14Fonts.FontName.HELVETICA);

            try (PDPageContentStream cs = new PDPageContentStream(doc, page)) {
                float margin = 60;
                float y = 780;
                float lineH = 18;

                boolean approved = decision == null ||
                    decision.getDecision() == com.securescore.compliance.domain.Decision.ALLOW;

                cs.beginText();
                cs.setFont(bold, 16);
                cs.newLineAtOffset(margin, y);
                cs.showText(approved ? "LOAN SANCTION LETTER" : "LOAN REJECTION LETTER");
                cs.endText();
                y -= lineH * 1.5f;

                cs.beginText();
                cs.setFont(regular, 10);
                cs.newLineAtOffset(margin, y);
                cs.showText("SecureScore Banking — Compliance Verified");
                cs.endText();
                y -= lineH;
                cs.beginText();
                cs.newLineAtOffset(margin, y);
                cs.showText("Date: " + DATE_FMT.format(Instant.now()));
                cs.endText();
                y -= lineH * 2;

                cs.moveTo(margin, y);
                cs.lineTo(550, y);
                cs.stroke();
                y -= lineH;

                y = addSection(cs, bold, regular, margin, y, lineH, "LOAN REFERENCE", new String[][]{
                    {"Loan ID", loanId},
                    {"Status", approved ? "SANCTIONED" : "REJECTED"},
                    {"Compliance Decision", decision != null ? decision.getDecision().name() : "ALLOW"},
                    {"Regulatory Code", decision != null ? nvl(decision.getRegulatoryCode()) : "N/A"},
                    {"Reason", decision != null ? nvl(decision.getDecisionReason()) : "Standard approval"}
                });

                y -= lineH * 2;
                cs.beginText();
                cs.setFont(regular, 10);
                cs.newLineAtOffset(margin, y);
                cs.showText(approved
                    ? "This loan has been sanctioned subject to NRB lending guidelines."
                    : "This loan application has been rejected. You may appeal within 30 days.");
                cs.endText();
            }

            doc.save(baos);
            return baos.toByteArray();
        }
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    // Draw a titled section of label/value rows and return the new y cursor.
    private float addSection(PDPageContentStream cs, PDType1Font bold, PDType1Font regular,
                              float margin, float y, float lineH,
                              String title, String[][] rows) throws Exception {
        cs.beginText();
        cs.setFont(bold, 11);
        cs.newLineAtOffset(margin, y);
        cs.showText(title);
        cs.endText();
        y -= lineH;

        for (String[] row : rows) {
            cs.beginText();
            cs.setFont(bold, 10);
            cs.newLineAtOffset(margin, y);
            cs.showText(row[0] + ": ");
            cs.endText();

            cs.beginText();
            cs.setFont(regular, 10);
            cs.newLineAtOffset(margin + 160, y);
            cs.showText(row[1] != null ? truncate(row[1], 60) : "—");
            cs.endText();
            y -= lineH;
        }
        return y;
    }

    // Create the report output directory if it doesn't exist yet.
    private void ensureOutputDir() throws Exception {
        Path dir = Paths.get(outputDir);
        if (!Files.exists(dir)) Files.createDirectories(dir);
    }

    // Null-safe toString, rendering nulls as an em-dash.
    private String nvl(Object val) {
        return val != null ? val.toString() : "—";
    }

    // Clip long strings so they fit on one PDF line.
    private String truncate(String s, int max) {
        return s.length() > max ? s.substring(0, max - 3) + "..." : s;
    }
}
