"""Bounded requests and answers. Citation metadata is resolved by the server, never the model."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Turn(StrictModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=2000)


class Question(StrictModel):
    question: str = Field(min_length=3, max_length=2000)
    locale: Literal["en", "es"] = "en"
    medium: (
        Literal["graphite", "charcoal", "ink", "coloured-pencil", "watercolour", "acrylic", "oil"]
        | None
    ) = None
    history: list[Turn] = Field(default_factory=list, max_length=6)


class Passage(StrictModel):
    id: str
    book_id: str
    title: str
    author: str
    locator: str
    url: str
    license: str
    historical: bool
    text: str = Field(min_length=1, max_length=12000)
    checksum: str


class Citation(StrictModel):
    id: str
    title: str
    author: str
    locator: str
    url: str
    license: str
    historical: bool
    excerpt: str


class Claim(StrictModel):
    text: str = Field(min_length=1, max_length=1500)
    citation_ids: list[str] = Field(min_length=1, max_length=4)


class Draft(StrictModel):
    status: Literal["answered", "insufficient_evidence"]
    claims: list[Claim] = Field(max_length=8)
    # This field is explicitly a proposed artistic choice, never an uncited fact.
    practice: str | None = Field(default=None, max_length=1500)
    gap: str | None = Field(default=None, max_length=800)

    @model_validator(mode="after")
    def consistent(self):
        if self.status == "answered" and not self.claims:
            raise ValueError("An answer requires cited claims")
        if self.status == "insufficient_evidence" and (
            self.claims or self.practice or not self.gap
        ):
            raise ValueError("An evidence gap cannot carry an unsupported answer")
        return self


class Usage(StrictModel):
    input_tokens: int = Field(default=0, ge=0)
    output_tokens: int = Field(default=0, ge=0)
    embedding_tokens: int = Field(default=0, ge=0)


class Answer(Draft):
    sources: list[Citation] = Field(default_factory=list, max_length=12)
    retrieval_mode: Literal["keyword", "hybrid"]
    corpus_version: str
    usage: Usage = Field(default_factory=Usage)
