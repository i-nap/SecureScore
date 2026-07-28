"""
db/models.py — SQLAlchemy ORM models for SecureScore Bank Suite.

Replaces JSON file state with a proper relational database.
Supports PostgreSQL (production) and SQLite (development/testing).

Tables:
  - branches          : registered edge nodes
  - model_versions    : global model registry (replaces registry/*.json)
  - weight_submissions: per-round branch submissions (replaces round*_submission_*.json)
  - audit_events      : tamper-evident audit log (replaces audit_chain.jsonl)
  - round_history     : federated round metadata
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import (
    create_engine,
    Column,
    Integer,
    String,
    Float,
    Boolean,
    Text,
    DateTime,
    JSON,
    Index,
    ForeignKey,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, relationship, Session
from sqlalchemy.pool import StaticPool
from sqlalchemy.sql import func

# ── Database URL ─────────────────────────────────────────
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "sqlite:///./securescore.db",  # SQLite for dev, PostgreSQL for prod
)

_is_memory = DATABASE_URL == "sqlite:///:memory:"

engine = create_engine(
    DATABASE_URL,
    echo=False,
    pool_pre_ping=True,
    # StaticPool shares a single in-memory connection across all sessions so
    # tables created by init_db() are visible to every subsequent get_session().
    **({"connect_args": {"check_same_thread": False}, "poolclass": StaticPool} if _is_memory else {}),
    # PostgreSQL-specific pool settings (ignored by SQLite)
    **({"pool_size": 10, "max_overflow": 20} if "postgresql" in DATABASE_URL else {}),
)


class Base(DeclarativeBase):
    pass


def _uuid() -> str:
    return str(uuid.uuid4())


# ═══════════════════════════════════════════════════════════
#          BRANCHES
# ═══════════════════════════════════════════════════════════

class Branch(Base):
    __tablename__ = "branches"

    id = Column(Integer, primary_key=True, autoincrement=True)
    uuid = Column(String(36), unique=True, default=_uuid, index=True)
    name = Column(String(100), unique=True, nullable=False, index=True)
    branch_type = Column(String(20), nullable=False, default="unknown")  # urban/semi_urban/rural
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    region = Column(String(20), nullable=True)  # mountain/plain/valley
    population_density = Column(Float, nullable=True)
    avg_customer_income = Column(Float, nullable=True)
    num_customers = Column(Integer, nullable=True)
    registered_at = Column(DateTime(timezone=True), server_default=func.now())
    last_seen_at = Column(DateTime(timezone=True), onupdate=func.now())
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    is_active = Column(Boolean, default=True)
    current_round = Column(Integer, default=0)

    # Relationships
    submissions = relationship("WeightSubmission", back_populates="branch_rel", lazy="dynamic")

    def __repr__(self):
        return f"<Branch {self.name} ({self.branch_type})>"


# ═══════════════════════════════════════════════════════════
#          MODEL VERSIONS (Global Model Registry)
# ═══════════════════════════════════════════════════════════

class ModelVersion(Base):
    __tablename__ = "model_versions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    version = Column(Integer, unique=True, nullable=False, index=True)
    round_number = Column(Integer, nullable=False)
    status = Column(String(20), default="ready")  # ready, deprecated, rollback_target
    sha256_hash = Column(String(64), nullable=False)
    byte_size = Column(Integer, nullable=False)
    raw_model_b64 = Column(Text, nullable=False)  # base64-encoded XGBoost model
    n_estimators = Column(Integer, default=100)
    max_depth = Column(Integer, default=5)

    # Aggregation metadata
    branches_included = Column(JSON)  # list of branch names
    total_training_samples = Column(Integer, default=0)
    aggregated_at = Column(DateTime(timezone=True), server_default=func.now())

    # Per-branch metrics snapshot
    branch_metrics = Column(JSON)  # dict: branch -> {accuracy, f1, ...}

    # MLflow experiment tracking
    mlflow_run_id = Column(String(64), nullable=True)
    global_accuracy = Column(Float, nullable=True)
    global_f1 = Column(Float, nullable=True)
    global_auc = Column(Float, nullable=True)

    def __repr__(self):
        return f"<ModelVersion v{self.version} ({self.status})>"


# ═══════════════════════════════════════════════════════════
#          WEIGHT SUBMISSIONS
# ═══════════════════════════════════════════════════════════

class WeightSubmission(Base):
    __tablename__ = "weight_submissions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    round_number = Column(Integer, nullable=False, index=True)
    branch = Column(String(100), ForeignKey("branches.name"), nullable=False)
    branch_type = Column(String(20))
    submitted_at = Column(DateTime(timezone=True), server_default=func.now())

    # Model payload
    raw_model_b64 = Column(Text, nullable=False)
    sha256_hash = Column(String(64))
    byte_size = Column(Integer)
    n_estimators = Column(Integer)
    max_depth = Column(Integer)

    # DP parameters
    dp_epsilon = Column(Float, default=0.0)
    dp_noise_std = Column(Float, default=0.0)

    # Training metrics
    accuracy = Column(Float)
    f1 = Column(Float)
    train_size = Column(Integer)
    test_size = Column(Integer)
    tn = Column(Integer)
    fp = Column(Integer)
    fn = Column(Integer)
    tp = Column(Integer)

    # Byzantine check result
    byzantine_safe = Column(Boolean, default=True)
    byzantine_reason = Column(Text)

    # Included in aggregation?
    included_in_aggregation = Column(Boolean, default=False)
    model_version_id = Column(Integer, ForeignKey("model_versions.id"), nullable=True)

    branch_rel = relationship("Branch", back_populates="submissions")

    __table_args__ = (
        Index("ix_submissions_round_branch", "round_number", "branch"),
    )

    def __repr__(self):
        return f"<WeightSubmission round={self.round_number} branch={self.branch}>"


# ═══════════════════════════════════════════════════════════
#          AUDIT EVENTS (Hash Chain)
# ═══════════════════════════════════════════════════════════

class AuditEvent(Base):
    __tablename__ = "audit_events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    seq = Column(Integer, nullable=False, index=True)
    event_type = Column(String(50), nullable=False, index=True)
    branch = Column(String(100), nullable=False)
    timestamp = Column(DateTime(timezone=True), server_default=func.now())

    # Hash chain fields
    payload_hash = Column(String(64), nullable=False)
    prev_hash = Column(String(64), nullable=False)
    entry_hash = Column(String(64), nullable=False, unique=True)

    # Summary (non-sensitive human-readable details)
    details_summary = Column(JSON)

    __table_args__ = (
        Index("ix_audit_event_type_branch", "event_type", "branch"),
    )

    def __repr__(self):
        return f"<AuditEvent #{self.seq} {self.event_type}/{self.branch}>"


# ═══════════════════════════════════════════════════════════
#          ROUND HISTORY
# ═══════════════════════════════════════════════════════════

class RoundHistory(Base):
    __tablename__ = "round_history"

    id = Column(Integer, primary_key=True, autoincrement=True)
    round_number = Column(Integer, unique=True, nullable=False, index=True)
    branches_participated = Column(JSON)  # list of branch names
    total_branches = Column(Integer, default=0)
    total_samples = Column(Integer, default=0)
    aggregated_at = Column(DateTime(timezone=True), server_default=func.now())
    model_version_id = Column(Integer, ForeignKey("model_versions.id"), nullable=True)

    # Aggregate metrics
    avg_f1 = Column(Float, nullable=True)
    avg_accuracy = Column(Float, nullable=True)
    byzantine_rejections = Column(Integer, default=0)

    def __repr__(self):
        return f"<RoundHistory round={self.round_number}>"


# ═══════════════════════════════════════════════════════════
#          LOAN DECISIONS (Branch-level)
# ═══════════════════════════════════════════════════════════

class LoanDecision(Base):
    __tablename__ = "loan_decisions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    branch = Column(String(100), nullable=False, index=True)
    customer_id = Column(String(100), nullable=True, index=True)
    requested_at = Column(DateTime(timezone=True), server_default=func.now())

    # Request + response payloads
    request_payload = Column(JSON)
    response_payload = Column(JSON)

    # Decision summary fields for query filters
    default_probability = Column(Float, nullable=True)
    risk_grade = Column(String(5), nullable=True)
    suggested_interest_rate = Column(Float, nullable=True)
    recommended_max_loan_npr = Column(Float, nullable=True)
    nrb_compliant = Column(Boolean, default=True)

    __table_args__ = (
        Index("ix_loan_decision_branch_time", "branch", "requested_at"),
    )

    def __repr__(self):
        return f"<LoanDecision branch={self.branch} grade={self.risk_grade}>"


# ═══════════════════════════════════════════════════════════
#          HQ UNIFIED ASSESSMENTS (Fingerprint Decisions)
# ═══════════════════════════════════════════════════════════

class HQFingerprintDecision(Base):
    __tablename__ = "hq_fingerprint_decisions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    fingerprint_id = Column(String(32), unique=True, index=True)
    branch_id = Column(String(100), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Decision summary
    hq_grade = Column(String(5))
    branch_adjusted_grade = Column(String(5))
    default_probability = Column(Float)
    branch_recommended_rate = Column(Float)
    max_approved_loan_npr = Column(Float)
    hq_model_version = Column(Integer)
    nrb_compliant = Column(Boolean, default=True)
    requires_guarantor = Column(Boolean, default=False)

    # Full context
    applicant_payload = Column(JSON)
    branch_params = Column(JSON)
    risk_dimensions = Column(JSON)
    decision_explanation = Column(JSON)
    response_payload = Column(JSON)

    __table_args__ = (
        Index("ix_hq_fp_branch_time", "branch_id", "created_at"),
    )

    def __repr__(self):
        return f"<HQFingerprintDecision {self.fingerprint_id} {self.branch_id}>"


# ═══════════════════════════════════════════════════════════
#          FRAUD ALERT EVENTS (Live + ML)
# ═══════════════════════════════════════════════════════════

class FraudAlertEvent(Base):
    __tablename__ = "fraud_alert_events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    branch = Column(String(100), nullable=False, index=True)
    customer_id = Column(String(100), nullable=True, index=True)
    detected_at = Column(DateTime(timezone=True), server_default=func.now())

    # Alert details
    severity = Column(String(20))
    metric = Column(String(100))
    value = Column(Float)
    z_score = Column(Float)
    reason = Column(String(100))
    source = Column(String(50), default="transaction_ingest")

    payload = Column(JSON)

    __table_args__ = (
        Index("ix_fraud_alert_branch_time", "branch", "detected_at"),
    )

    def __repr__(self):
        return f"<FraudAlertEvent {self.branch} {self.severity}>"


# ═══════════════════════════════════════════════════════════
#          CUSTOMER + SCORING WORKFLOWS (Spec)
# ═══════════════════════════════════════════════════════════

class Customer(Base):
    __tablename__ = "customers"

    id = Column(String(36), primary_key=True, default=_uuid)
    branch_id = Column(String(100), ForeignKey("branches.name"), nullable=False, index=True)
    branch_uuid = Column(String(36), ForeignKey("branches.uuid"), nullable=True, index=True)
    phone_number = Column(String(32), nullable=False)
    email = Column(String(200), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class CustomerApplication(Base):
    __tablename__ = "customer_applications"

    id = Column(String(36), primary_key=True, default=_uuid)
    customer_id = Column(String(36), ForeignKey("customers.id"), nullable=False, index=True)
    branch_id = Column(String(100), ForeignKey("branches.name"), nullable=False, index=True)
    branch_uuid = Column(String(36), ForeignKey("branches.uuid"), nullable=True, index=True)
    age = Column(Integer)
    income = Column(Float)
    savings_balance = Column(Float)
    employment = Column(String(50))
    transaction_count_30d = Column(Integer)
    features_payload = Column(JSON)  # stores all other features
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class ScoringDecision(Base):
    __tablename__ = "scoring_decisions"

    id = Column(String(36), primary_key=True, default=_uuid)
    customer_id = Column(String(36), ForeignKey("customers.id"), nullable=False, index=True)
    branch_id = Column(String(100), ForeignKey("branches.name"), nullable=False, index=True)
    branch_uuid = Column(String(36), ForeignKey("branches.uuid"), nullable=True, index=True)
    timestamp = Column(DateTime(timezone=True), server_default=func.now())
    local_score = Column(Float)
    local_percentile = Column(Float)
    hq_score = Column(Float)
    hq_percentile = Column(Float)
    averaged_score = Column(Float)
    averaged_percentile = Column(Float)
    immediate_decision = Column(String(20))
    interest_rate = Column(Float)
    processing_time_ms = Column(Integer)
    status = Column(String(40), default="IMMEDIATE_APPROVAL_GIVEN")
    verification_status = Column(String(40), default="PENDING")
    verified_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("ix_scoring_decision_branch_time", "branch_id", "timestamp"),
    )


class VerificationLog(Base):
    __tablename__ = "verification_logs"

    id = Column(String(36), primary_key=True, default=_uuid)
    scoring_decision_id = Column(String(36), ForeignKey("scoring_decisions.id"), nullable=False)
    customer_id = Column(String(36), ForeignKey("customers.id"), nullable=False, index=True)
    immediate_percentile = Column(Float)
    hq_fresh_percentile = Column(Float)
    divergence = Column(Float)
    requires_reverification = Column(Boolean, default=False)
    timestamp = Column(DateTime(timezone=True), server_default=func.now())


class ReverificationQueue(Base):
    __tablename__ = "reverification_queue"

    id = Column(String(36), primary_key=True, default=_uuid)
    customer_id = Column(String(36), ForeignKey("customers.id"), nullable=False, index=True)
    phone_number = Column(String(32), nullable=False)
    immediate_decision = Column(String(20))
    revised_decision = Column(String(20))
    immediate_percentile = Column(Float)
    hq_percentile = Column(Float)
    divergence = Column(Float)
    queued_at = Column(DateTime(timezone=True), server_default=func.now())
    deadline = Column(DateTime(timezone=True))
    called_at = Column(DateTime(timezone=True), nullable=True)
    customer_confirmed = Column(Boolean, nullable=True)
    final_decision = Column(String(20), nullable=True)
    status = Column(String(30), default="PENDING_CALL")
    error = Column(Text, nullable=True)


class GradientUpload(Base):
    __tablename__ = "gradient_uploads"

    id = Column(String(36), primary_key=True, default=_uuid)
    branch_id = Column(String(100), ForeignKey("branches.name"), nullable=False, index=True)
    branch_uuid = Column(String(36), ForeignKey("branches.uuid"), nullable=True, index=True)
    timestamp = Column(DateTime(timezone=True), server_default=func.now())
    data_volume = Column(Integer, default=0)
    compressed_gradients = Column(JSON)
    model_version = Column(String(50))


# ═══════════════════════════════════════════════════════════
#          BANKING MODELS
# ═══════════════════════════════════════════════════════════

def _account_number() -> str:
    """Generate a 16-digit account number."""
    import random
    return f"NB{random.randint(10000000000000, 99999999999999)}"


class UserProfile(Base):
    __tablename__ = "user_profiles"

    id = Column(String(36), primary_key=True, default=_uuid)
    customer_id = Column(String(36), ForeignKey("customers.id"), unique=True, nullable=False, index=True)
    full_name = Column(String(200), nullable=False)
    date_of_birth = Column(String(20), nullable=True)
    gender = Column(String(10), nullable=True)
    nationality = Column(String(50), default="Nepali")
    national_id = Column(String(50), nullable=True, unique=True)
    pan_number = Column(String(20), nullable=True)
    address = Column(Text, nullable=True)
    district = Column(String(100), nullable=True)
    province = Column(String(50), nullable=True)
    occupation = Column(String(100), nullable=True)
    annual_income = Column(Float, nullable=True)
    # Auth fields (hashed)
    username = Column(String(100), unique=True, nullable=False, index=True)
    password_hash = Column(String(256), nullable=False)
    role = Column(String(20), default="customer")
    is_active = Column(Boolean, default=True)
    last_login = Column(DateTime(timezone=True), nullable=True)
    failed_login_attempts = Column(Integer, default=0)
    locked_until = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())



class Account(Base):
    __tablename__ = "accounts"

    id = Column(String(36), primary_key=True, default=_uuid)
    account_number = Column(String(20), unique=True, nullable=False, index=True, default=_account_number)
    customer_id = Column(String(36), ForeignKey("customers.id"), nullable=False, index=True)
    branch_id = Column(String(100), ForeignKey("branches.name"), nullable=False, index=True)
    account_type = Column(String(30), nullable=False, default="savings")  # savings / current / salary
    balance = Column(Float, nullable=False, default=0.0)
    currency = Column(String(5), default="NPR")
    is_active = Column(Boolean, default=True)
    interest_rate = Column(Float, default=5.0)  # annual %
    minimum_balance = Column(Float, default=1000.0)
    opened_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    sent_transactions = relationship("Transaction",
                                     foreign_keys="Transaction.from_account_id",
                                     back_populates="from_account", lazy="dynamic")
    received_transactions = relationship("Transaction",
                                         foreign_keys="Transaction.to_account_id",
                                         back_populates="to_account", lazy="dynamic")


class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(String(36), primary_key=True, default=_uuid)
    reference_number = Column(String(30), unique=True, nullable=False, index=True)
    from_account_id = Column(String(36), ForeignKey("accounts.id"), nullable=True, index=True)
    to_account_id = Column(String(36), ForeignKey("accounts.id"), nullable=True, index=True)
    from_account_number = Column(String(20), nullable=True)
    to_account_number = Column(String(20), nullable=True)
    amount = Column(Float, nullable=False)
    currency = Column(String(5), default="NPR")
    transaction_type = Column(String(30), nullable=False)
    # Types: TRANSFER / DEPOSIT / WITHDRAWAL / FD_OPEN / FD_MATURITY / INTEREST / FEE / REMITTANCE
    description = Column(Text, nullable=True)
    status = Column(String(20), default="COMPLETED")  # COMPLETED / PENDING / FAILED / REVERSED
    balance_after = Column(Float, nullable=True)  # sender balance after tx
    fee = Column(Float, default=0.0)
    initiated_by = Column(String(36), nullable=True)   # user_profile.id
    channel = Column(String(20), default="online")     # online / atm / branch / mobile
    branch_id = Column(String(100), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    from_account = relationship("Account", foreign_keys=[from_account_id],
                                back_populates="sent_transactions")
    to_account = relationship("Account", foreign_keys=[to_account_id],
                              back_populates="received_transactions")


class FixedDeposit(Base):
    __tablename__ = "fixed_deposits"

    id = Column(String(36), primary_key=True, default=_uuid)
    fd_number = Column(String(20), unique=True, nullable=False, index=True)
    customer_id = Column(String(36), ForeignKey("customers.id"), nullable=False, index=True)
    account_id = Column(String(36), ForeignKey("accounts.id"), nullable=False, index=True)
    branch_id = Column(String(100), ForeignKey("branches.name"), nullable=False, index=True)
    principal = Column(Float, nullable=False)
    interest_rate = Column(Float, nullable=False)  # annual %
    tenure_months = Column(Integer, nullable=False)
    maturity_date = Column(DateTime(timezone=True), nullable=False)
    maturity_amount = Column(Float, nullable=False)
    status = Column(String(20), default="ACTIVE")  # ACTIVE / MATURED / BROKEN / RENEWED
    auto_renew = Column(Boolean, default=False)
    opened_at = Column(DateTime(timezone=True), server_default=func.now())
    matured_at = Column(DateTime(timezone=True), nullable=True)
    broken_at = Column(DateTime(timezone=True), nullable=True)
    penalty_applied = Column(Float, default=0.0)
    notes = Column(Text, nullable=True)


# ═══════════════════════════════════════════════════════════
#          DATABASE HELPERS
# ═══════════════════════════════════════════════════════════

def init_db():
    """Create all tables. Safe to call multiple times."""
    Base.metadata.create_all(engine)


def get_session() -> Session:
    """Get a new database session. Caller is responsible for closing."""
    return Session(engine)


def get_db():
    """FastAPI dependency: yields a DB session and closes it after request."""
    db = Session(engine)
    try:
        yield db
    finally:
        db.close()
