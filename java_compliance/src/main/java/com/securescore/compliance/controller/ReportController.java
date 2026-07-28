package com.securescore.compliance.controller;

import com.securescore.compliance.service.ReportGenerationService;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/compliance/reports")
public class ReportController {

    private final ReportGenerationService reportService;

    public ReportController(ReportGenerationService reportService) {
        this.reportService = reportService;
    }

    /** Download a Suspicious Transaction Report as PDF by its STR record ID. */
    @GetMapping("/str/{id}/pdf")
    public ResponseEntity<byte[]> downloadSTR(@PathVariable UUID id) {
        try {
            byte[] pdf = reportService.getSTRPdfBytes(id);
            return pdfResponse(pdf, "STR_" + id + ".pdf");
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        } catch (Exception e) {
            return ResponseEntity.internalServerError().build();
        }
    }

    /** Generate and download a credit assessment report PDF for a customer. */
    @GetMapping("/credit/{customerId}/pdf")
    public ResponseEntity<byte[]> downloadCreditReport(@PathVariable String customerId) {
        try {
            byte[] pdf = reportService.generateCreditReportBytes(customerId);
            return pdfResponse(pdf, "CreditReport_" + customerId + ".pdf");
        } catch (Exception e) {
            return ResponseEntity.internalServerError().build();
        }
    }

    /** Generate and download a loan sanction/rejection letter PDF. */
    @GetMapping("/loan/{loanId}/pdf")
    public ResponseEntity<byte[]> downloadLoanLetter(@PathVariable String loanId) {
        try {
            byte[] pdf = reportService.generateLoanLetterBytes(loanId);
            return pdfResponse(pdf, "LoanLetter_" + loanId + ".pdf");
        } catch (Exception e) {
            return ResponseEntity.internalServerError().build();
        }
    }

    /** Health check — used by Docker healthcheck and BFF proxy validation. */
    @GetMapping("/health")
    public ResponseEntity<Map<String, Object>> health() {
        return ResponseEntity.ok(Map.of(
            "status", "ok",
            "service", "compliance-report-engine",
            "timestamp", Instant.now().toString()
        ));
    }

    private ResponseEntity<byte[]> pdfResponse(byte[] pdf, String filename) {
        return ResponseEntity.ok()
            .contentType(MediaType.APPLICATION_PDF)
            .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + filename + "\"")
            .contentLength(pdf.length)
            .body(pdf);
    }
}
