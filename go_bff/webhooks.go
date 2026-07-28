package main

import (
	"encoding/json"
	"io"

	"github.com/gin-gonic/gin"
)

func handleWebhookFraudAlert(c *gin.Context) {
	raw, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(400, gin.H{"error": "cannot read body"})
		return
	}
	if !verifyWebhookSignature(c, raw) {
		c.JSON(403, gin.H{"error": "invalid signature"})
		return
	}
	var body map[string]interface{}
	if err := json.Unmarshal(raw, &body); err != nil {
		c.JSON(400, gin.H{"error": "invalid json"})
		return
	}
	wsBroadcast("fraud_alert", body)
	if dbAvailable() {
		branch, _ := body["branch"].(string)
		dbInsertFraudAlert(branch, body)
	}
	c.JSON(200, gin.H{"status": "broadcast_ok"})
}

func handleWebhookAggregation(c *gin.Context) {
	raw, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(400, gin.H{"error": "cannot read body"})
		return
	}
	if !verifyWebhookSignature(c, raw) {
		c.JSON(403, gin.H{"error": "invalid signature"})
		return
	}
	var body map[string]interface{}
	if err := json.Unmarshal(raw, &body); err != nil {
		c.JSON(400, gin.H{"error": "invalid json"})
		return
	}
	wsBroadcast("aggregation_complete", body)
	c.JSON(200, gin.H{"status": "broadcast_ok"})
}

func handleWebhookWeightSubmitted(c *gin.Context) {
	raw, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(400, gin.H{"error": "cannot read body"})
		return
	}
	if !verifyWebhookSignature(c, raw) {
		c.JSON(403, gin.H{"error": "invalid signature"})
		return
	}
	var body map[string]interface{}
	if err := json.Unmarshal(raw, &body); err != nil {
		c.JSON(400, gin.H{"error": "invalid json"})
		return
	}
	wsBroadcast("weight_submission", body)
	c.JSON(200, gin.H{"status": "broadcast_ok"})
}
