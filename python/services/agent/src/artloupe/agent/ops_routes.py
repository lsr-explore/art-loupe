"""Operator-only reads for the operations dashboard. No model call, no artist data.

The operator's token proves who is asking; it is never used to read the ledger. The ledger is
read through `artloupe_ops_reader`, a role only this service holds (see `ops_cost`).
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi import status as http_status

from artloupe.agent.ops_cost import OpsDatabaseUnavailable, read_cost_report
from artloupe.agent.ops_cost_models import CostReport, CostWindow
from artloupe.auth.dependencies import require_role
from artloupe.auth.tokens import VerifiedToken

router = APIRouter()

Operator = Annotated[VerifiedToken, Depends(require_role("operator", "superuser"))]


@router.get("/ops/costs", response_model=CostReport)
async def costs(_operator: Operator, window: Annotated[CostWindow, Query()] = "7d") -> CostReport:
    try:
        return await read_cost_report(window)
    except OpsDatabaseUnavailable as exc:
        raise HTTPException(
            http_status.HTTP_503_SERVICE_UNAVAILABLE,
            "Cost data is temporarily unavailable.",
            headers={"Retry-After": "30"},
        ) from exc
