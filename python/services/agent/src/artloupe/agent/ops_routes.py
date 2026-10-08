"""Operator-only reads for the operations dashboard. No model call, no artist data.

The operator's token proves who is asking; it is never used to read the database. Every read
goes through `artloupe_ops_reader`, a role only this service holds (see `ops_db`).
"""

from collections.abc import Awaitable
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi import status as http_status

from artloupe.agent.ops_cost import read_cost_report
from artloupe.agent.ops_cost_models import CostReport, CostWindow
from artloupe.agent.ops_db import OpsDatabaseUnavailable
from artloupe.agent.ops_runs import RunNotFound, read_run_detail, read_run_health
from artloupe.agent.ops_runs_models import RunDetail, RunHealthReport
from artloupe.auth.dependencies import require_role
from artloupe.auth.tokens import VerifiedToken

router = APIRouter()

Operator = Annotated[VerifiedToken, Depends(require_role("operator", "superuser"))]
Window = Annotated[CostWindow, Query()]


async def _answer[T](read: Awaitable[T]) -> T:
    try:
        return await read
    except OpsDatabaseUnavailable as exc:
        raise HTTPException(
            http_status.HTTP_503_SERVICE_UNAVAILABLE,
            "Operations data is temporarily unavailable.",
            headers={"Retry-After": "30"},
        ) from exc


@router.get("/ops/costs", response_model=CostReport)
async def costs(_operator: Operator, window: Window = "7d") -> CostReport:
    return await _answer(read_cost_report(window))


@router.get("/ops/runs", response_model=RunHealthReport)
async def runs(_operator: Operator, window: Window = "7d") -> RunHealthReport:
    return await _answer(read_run_health(window))


@router.get("/ops/runs/{run_id}", response_model=RunDetail)
async def run(_operator: Operator, run_id: UUID) -> RunDetail:
    try:
        return await _answer(read_run_detail(run_id))
    except RunNotFound as exc:
        raise HTTPException(http_status.HTTP_404_NOT_FOUND, "No such run.") from exc
