"""Initial schema — all SecureScore tables.

Revision ID: 001
Revises:
Create Date: 2025-01-01 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── branches ───────────────────────────────────────────
    op.create_table(
        "branches",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(100), unique=True, nullable=False),
        sa.Column("branch_type", sa.String(20), nullable=False, default="unknown"),
        sa.Column("registered_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("last_seen_at", sa.DateTime(timezone=True)),
        sa.Column("is_active", sa.Boolean(), default=True),
        sa.Column("current_round", sa.Integer(), default=0),
    )
    op.create_index("ix_branches_name", "branches", ["name"])

    # ── model_versions ─────────────────────────────────────
    op.create_table(
        "model_versions",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("version", sa.Integer(), unique=True, nullable=False),
        sa.Column("round_number", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(20), default="ready"),
        sa.Column("sha256_hash", sa.String(64), nullable=False),
        sa.Column("byte_size", sa.Integer(), nullable=False),
        sa.Column("raw_model_b64", sa.Text(), nullable=False),
        sa.Column("n_estimators", sa.Integer(), default=100),
        sa.Column("max_depth", sa.Integer(), default=5),
        sa.Column("branches_included", sa.JSON()),
        sa.Column("total_training_samples", sa.Integer(), default=0),
        sa.Column("aggregated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("branch_metrics", sa.JSON()),
        sa.Column("mlflow_run_id", sa.String(64)),
        sa.Column("global_accuracy", sa.Float()),
        sa.Column("global_f1", sa.Float()),
        sa.Column("global_auc", sa.Float()),
    )
    op.create_index("ix_model_versions_version", "model_versions", ["version"])

    # ── weight_submissions ─────────────────────────────────
    op.create_table(
        "weight_submissions",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("round_number", sa.Integer(), nullable=False),
        sa.Column("branch", sa.String(100), sa.ForeignKey("branches.name"), nullable=False),
        sa.Column("branch_type", sa.String(20)),
        sa.Column("submitted_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("raw_model_b64", sa.Text(), nullable=False),
        sa.Column("sha256_hash", sa.String(64)),
        sa.Column("byte_size", sa.Integer()),
        sa.Column("n_estimators", sa.Integer()),
        sa.Column("max_depth", sa.Integer()),
        sa.Column("dp_epsilon", sa.Float(), default=0.0),
        sa.Column("dp_noise_std", sa.Float(), default=0.0),
        sa.Column("accuracy", sa.Float()),
        sa.Column("f1", sa.Float()),
        sa.Column("train_size", sa.Integer()),
        sa.Column("test_size", sa.Integer()),
        sa.Column("tn", sa.Integer()),
        sa.Column("fp", sa.Integer()),
        sa.Column("fn", sa.Integer()),
        sa.Column("tp", sa.Integer()),
        sa.Column("byzantine_safe", sa.Boolean(), default=True),
        sa.Column("byzantine_reason", sa.Text()),
        sa.Column("included_in_aggregation", sa.Boolean(), default=False),
        sa.Column("model_version_id", sa.Integer(), sa.ForeignKey("model_versions.id")),
    )
    op.create_index("ix_submissions_round_branch", "weight_submissions", ["round_number", "branch"])

    # ── audit_events ───────────────────────────────────────
    op.create_table(
        "audit_events",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("event_type", sa.String(50), nullable=False),
        sa.Column("branch", sa.String(100), nullable=False),
        sa.Column("timestamp", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("payload_hash", sa.String(64), nullable=False),
        sa.Column("prev_hash", sa.String(64), nullable=False),
        sa.Column("entry_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("details_summary", sa.JSON()),
    )
    op.create_index("ix_audit_seq", "audit_events", ["seq"])
    op.create_index("ix_audit_event_type_branch", "audit_events", ["event_type", "branch"])

    # ── round_history ──────────────────────────────────────
    op.create_table(
        "round_history",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("round_number", sa.Integer(), unique=True, nullable=False),
        sa.Column("branches_participated", sa.JSON()),
        sa.Column("total_branches", sa.Integer(), default=0),
        sa.Column("total_samples", sa.Integer(), default=0),
        sa.Column("aggregated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("model_version_id", sa.Integer(), sa.ForeignKey("model_versions.id")),
        sa.Column("avg_f1", sa.Float()),
        sa.Column("avg_accuracy", sa.Float()),
        sa.Column("byzantine_rejections", sa.Integer(), default=0),
    )
    op.create_index("ix_round_history_round", "round_history", ["round_number"])


def downgrade() -> None:
    op.drop_table("round_history")
    op.drop_table("audit_events")
    op.drop_table("weight_submissions")
    op.drop_table("model_versions")
    op.drop_table("branches")
