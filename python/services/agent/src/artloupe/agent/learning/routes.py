"""Authenticated bounded learning requests; no artist data or history is persisted."""

import asyncio
import logging
from uuid import uuid4

import httpx
from anthropic import APIError
from fastapi import APIRouter, HTTPException

from artloupe.agent.director import director_client
from artloupe.agent.inspiration_rate_limit import RateLimiter
from artloupe.agent.inspiration_routes import Searcher
from artloupe.agent.learning.answering import AnswerUnavailable, evidence_gap, synthesize, usable
from artloupe.agent.learning.embeddings import embed
from artloupe.agent.learning.models import Answer, Question
from artloupe.agent.learning.retrieval import CorpusUnavailable, configured_index
from artloupe.auth.dependencies import HttpClient
from artloupe.config import SecretUnavailable
from artloupe.metering import RunGuards, RunRecorder, get_metrics_sink, record_usage, use_recorder

router = APIRouter()
limiter = RateLimiter(burst=3, refill_per_second=1 / 20)
logger = logging.getLogger(__name__)


@router.post("/learning/ask", response_model=Answer)
async def ask(question: Question, user: Searcher, client: HttpClient) -> Answer:
    if retry_after := limiter.acquire(user.subject):
        raise HTTPException(
            429, "Too many learning questions.", headers={"Retry-After": str(retry_after)}
        )
    # Separate chat recorder and ceiling: never uses a project plan's credit ledger.
    recorder = RunRecorder(str(uuid4()), user.subject, RunGuards(3, 1, 60, 20000))
    try:
        async with asyncio.timeout(60):
            with use_recorder(recorder):
                index = await asyncio.to_thread(configured_index)
                mode = "hybrid" if index.vectors is not None else "keyword"
                embedding_tokens = 0
                query = question.question
                # Carry only the last artist question for underspecified follow-ups.
                previous = next(
                    (turn.content for turn in reversed(question.history) if turn.role == "user"), ""
                )
                if len(query.split()) < 8 and previous:
                    query = previous + " " + query
                async with recorder.node("learning-retrieval"):
                    vector = None
                    if mode == "hybrid":
                        vectors, embedding_tokens = await embed(client, [query])
                        vector = vectors[0]
                        record_usage(model="text-embedding-3-small", input_tokens=embedding_tokens)
                    passages = await asyncio.to_thread(index.search, query, vector)
                passages = usable(passages)
                if not passages:
                    result = evidence_gap(question, mode, index.version)
                    result.usage.embedding_tokens = embedding_tokens
                    return result
                async with recorder.node("learning-answer"):
                    result = await synthesize(
                        director_client(), question, passages, mode, index.version, embedding_tokens
                    )
                return result
    except (CorpusUnavailable, SecretUnavailable) as error:
        logger.warning("Learning is not configured: %s", type(error).__name__)
        raise HTTPException(503, "Learning is not configured.") from error
    except (APIError, httpx.HTTPError, AnswerUnavailable, ValueError) as error:
        logger.warning("Learning upstream failed: %s", type(error).__name__)
        raise HTTPException(502, "Learning is temporarily unavailable.") from error
    except TimeoutError as error:
        raise HTTPException(504, "Learning timed out.") from error
    finally:
        # Operational telemetry only, never prompts, excerpts, or artist history in logs.
        logger.info(
            "Learning request finished",
            extra={
                "run_id": recorder.run_id,
                "input_tokens": sum(part.input_tokens for part in recorder.metrics),
                "output_tokens": sum(part.output_tokens for part in recorder.metrics),
            },
        )

        try:
            await get_metrics_sink().flush(recorder.metrics)
        except Exception:
            logger.warning("Could not store learning telemetry", extra={"run_id": recorder.run_id})
