"""Reproducible corpus preparation and evaluations. Paid steps require explicit CLI flags."""

import argparse
import asyncio
import json
from pathlib import Path

from artloupe.agent.learning.corpus import ingest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("verify", help="Validate provider authentication without generation")
    extract = commands.add_parser("ingest")
    extract.add_argument("--books", type=Path, required=True)
    extract.add_argument("--manifest", type=Path, required=True)
    extract.add_argument("--output", type=Path, required=True)
    vectors = commands.add_parser("embed", help="Paid: sends extracted text to OpenAI")
    vectors.add_argument("--corpus", type=Path, required=True)
    vectors.add_argument("--allow-paid", action="store_true", required=True)
    publish = commands.add_parser(
        "publish", help="Publish existing passages and vectors to PostgreSQL"
    )
    publish.add_argument("--corpus", type=Path, required=True)
    evaluate = commands.add_parser("eval")
    evaluate.add_argument("--backend", choices=["files", "pgvector"], default="files")
    evaluate.add_argument("--corpus", type=Path, required=True)
    evaluate.add_argument("--cases", type=Path, required=True)
    evaluate.add_argument("--output", type=Path, required=True)
    evaluate.add_argument(
        "--live", action="store_true", help="Paid: synthesize answers and judge semantic grounding"
    )
    args = parser.parse_args()
    if args.command == "verify":
        from artloupe.agent.learning.verification import verify

        result = asyncio.run(verify())
    elif args.command == "ingest":
        result = ingest(args.books, args.manifest, args.output)
    elif args.command == "embed":
        from artloupe.agent.learning.embeddings import build_vectors

        result = asyncio.run(build_vectors(args.corpus))
    elif args.command == "publish":
        from artloupe.agent.learning.postgres import publish

        result = publish(args.corpus)
    else:
        from artloupe.agent.learning.evaluation import evaluate

        result = asyncio.run(
            evaluate(args.corpus, args.cases, args.output, live=args.live, backend=args.backend)
        )
    print(json.dumps(result, indent=2))
    if args.command in {"eval", "verify"} and not result["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
