"""How each Mortgage's Principal was handed to the Customer (Lent Through): unset for
the Mortgages made before it was asked.

Revision ID: 0014
Revises: 0013
"""

import sqlalchemy as sa
from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("mortgage") as batch:
        batch.add_column(sa.Column("lent_through", sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("mortgage") as batch:
        batch.drop_column("lent_through")
