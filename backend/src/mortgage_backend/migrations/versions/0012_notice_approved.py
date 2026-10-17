"""A Notice remembers that the Lender approved it, so its status can be worked out
from that and the "approve first" setting.

Revision ID: 0012
Revises: 0011
"""

import sqlalchemy as sa
from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "notice",
        sa.Column("approved", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    # With approval on, a queued Notice can only have got there by being approved.
    # The key and "true" are how message_settings stores `notice_approve_first`.
    op.execute(
        "UPDATE notice SET approved = 1 WHERE status = 'queued' AND EXISTS ("
        "SELECT 1 FROM config WHERE key = 'message_notice_approve_first'"
        " AND value = 'true')"
    )


def downgrade() -> None:
    with op.batch_alter_table("notice") as batch:
        batch.drop_column("approved")
