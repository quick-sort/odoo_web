import logging

_logger = logging.getLogger(__name__)


def post_init_hook(env):
    """Auto-configure sync target for pharmcube_clinical_trial_tracking."""
    table = env["aws.glue.table"].search(
        [("name", "=", "pharmcube_clinical_trial_tracking")], limit=1
    )
    if not table:
        _logger.info("pharmcube_clinical_trial_tracking table not found in Glue, skipping sync target setup.")
        return

    existing = env["aws.glue.sync.target"].search(
        [("table_id", "=", table.id), ("target_model", "=", "pharmcube.tracking")],
        limit=1,
    )
    if not existing:
        env["aws.glue.sync.target"].create({
            "table_id": table.id,
            "target_model": "pharmcube.tracking",
        })
        _logger.info("Created sync target: pharmcube_clinical_trial_tracking → pharmcube.tracking")
