"""Rename Notices to Reminders without changing their records.

Revision ID: 0017
Revises: 0016
"""

from alembic import op

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.rename_table("notice", "reminder")
    op.rename_table("notice_mortgage", "reminder_mortgage")
    with op.batch_alter_table("reminder_mortgage") as batch:
        batch.alter_column("notice_id", new_column_name="reminder_id")
    op.execute(
        "UPDATE config SET key = replace(key, 'notice_', 'reminder_') "
        "WHERE key LIKE 'message_notice_%'"
    )


def downgrade() -> None:
    op.execute(
        "UPDATE config SET key = replace(key, 'reminder_', 'notice_') "
        "WHERE key LIKE 'message_reminder_%'"
    )
    with op.batch_alter_table("reminder_mortgage") as batch:
        batch.alter_column("reminder_id", new_column_name="notice_id")
    op.rename_table("reminder_mortgage", "notice_mortgage")
    op.rename_table("reminder", "notice")
