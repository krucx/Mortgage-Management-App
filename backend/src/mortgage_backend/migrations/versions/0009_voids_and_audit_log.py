"""Voided Payments and the audit log.

Revision ID: 0009
Revises: 0008
"""

import sqlalchemy as sa
from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("payment", sa.Column("voided_at", sa.DateTime()))
    op.add_column("payment", sa.Column("void_reason", sa.String()))
    op.create_table(
        "audit_entry",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("at", sa.DateTime(), nullable=False),
        sa.Column("entity", sa.String(), nullable=False),
        sa.Column("entity_id", sa.Integer(), nullable=False),
        sa.Column("action", sa.String(), nullable=False),
        sa.Column("field", sa.String()),
        sa.Column("old_value", sa.String()),
        sa.Column("new_value", sa.String()),
        sa.Column("note", sa.String()),
    )
    op.create_index("ix_audit_entry_entity", "audit_entry", ["entity", "entity_id"])


def downgrade() -> None:
    op.drop_index("ix_audit_entry_entity", "audit_entry")
    op.drop_table("audit_entry")
    op.drop_column("payment", "void_reason")
    op.drop_column("payment", "voided_at")
