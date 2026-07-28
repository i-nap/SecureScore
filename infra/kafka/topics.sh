#!/usr/bin/env bash
# =============================================================================
#  SecureScore Banking — Kafka Topic Provisioning
#  Topic names match exactly what the Go banking service publishes/consumes.
# =============================================================================
set -euo pipefail

KAFKA_BROKER="${KAFKA_BROKER:-kafka:9092}"
REPLICATION="${REPLICATION_FACTOR:-1}"

DAY_MS=86400000
WEEK_MS=604800000
MONTH_MS=2592000000

create_topic() {
  local name="$1" partitions="$2" retention_ms="$3"
  echo "Creating: $name (p=$partitions, ret=${retention_ms}ms)"
  kafka-topics \
    --bootstrap-server "$KAFKA_BROKER" \
    --create --if-not-exists \
    --topic "$name" \
    --partitions "$partitions" \
    --replication-factor "$REPLICATION" \
    --config "retention.ms=$retention_ms"
}

echo "Waiting for Kafka at $KAFKA_BROKER..."
until kafka-topics --bootstrap-server "$KAFKA_BROKER" --list > /dev/null 2>&1; do
  sleep 3; printf "."
done
echo " Kafka ready."

# ── Transactions ─────────────────────────────────────────────────────────────
# banking service publishes to "banking.transactions"
create_topic "banking.transactions"               12  $WEEK_MS
create_topic "banking.transactions.completed"     12  $WEEK_MS
create_topic "banking.transactions.failed"         6  $WEEK_MS
create_topic "banking.transactions.reversed"       6  $MONTH_MS

# ── Accounts ─────────────────────────────────────────────────────────────────
create_topic "banking.accounts"                    6  $MONTH_MS

# ── Loans ────────────────────────────────────────────────────────────────────
# banking service publishes to "banking.loans" (state changes) and "banking.loans.closed"
create_topic "banking.loans"                       6  $MONTH_MS
create_topic "banking.loans.closed"                4  $MONTH_MS

# ── Fixed Deposits ────────────────────────────────────────────────────────────
# banking service publishes to "banking.fds.opened" and "banking.fds"
create_topic "banking.fds.opened"                  4  $MONTH_MS
create_topic "banking.fds"                         4  $MONTH_MS

# ── Scheduled job summaries ───────────────────────────────────────────────────
create_topic "banking.eod.summary"                 1  $((90 * DAY_MS))
create_topic "banking.eom.summary"                 1  $((365 * DAY_MS))
create_topic "banking.quarterly.summary"           1  $((365 * DAY_MS))
create_topic "banking.statements.generate"        12  $WEEK_MS

# ── AI / Risk pipeline ────────────────────────────────────────────────────────
create_topic "ai.risk.score_requests"              8  $DAY_MS
create_topic "ai.risk.score_results"               8  $DAY_MS
create_topic "ai.risk.flags"                       4  $WEEK_MS

# ── Audit ─────────────────────────────────────────────────────────────────────
# audit_consumer.go reads from "audit.events"
create_topic "audit.events"                       12  $((365 * DAY_MS))

# ── Dead-letter queue ─────────────────────────────────────────────────────────
create_topic "banking.dlq"                         4  $MONTH_MS

echo ""
echo "All topics provisioned:"
kafka-topics --bootstrap-server "$KAFKA_BROKER" --list
